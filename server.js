const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || "127.0.0.1";
const DATA_PATH = path.join(__dirname, "data", "store.json");
const PUBLIC_DIR = path.join(__dirname, "public");

function readStore() {
  const store = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  if (!Array.isArray(store.stockMovements)) store.stockMovements = [];
  if (!store.settings.businessName) store.settings.businessName = "Chewaz Bar and Restaurant";
  if (!store.settings.tillNumber) store.settings.tillNumber = "3706694";
  if (!Array.isArray(store.settings.salesPhones)) {
    store.settings.salesPhones = ["0759305448", "0718236550"];
  }
  store.products = (store.products || []).map((product, index) => ({
    ...product,
    productNumber: Number(product.productNumber || index + 1)
  }));
  return store;
}

function writeStore(store) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(store, null, 2));
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function getDiscountPercent(product, unit, qty) {
  const matches = (product.bulkDiscounts || [])
    .filter((rule) => rule.unit === unit && qty >= rule.minQty)
    .sort((a, b) => b.percent - a.percent);
  return matches.length ? matches[0].percent : 0;
}

function fulfillBottleQty(product, qty) {
  if (qty <= product.stockBottles) {
    product.stockBottles -= qty;
    return { cratesBroken: 0 };
  }

  if (!product.allowCaseBreak) {
    throw new Error(`Insufficient bottle stock for ${product.name}`);
  }

  const needed = qty - product.stockBottles;
  const cratesToBreak = Math.ceil(needed / product.bottlesPerCrate);

  if (cratesToBreak > product.stockCrates) {
    throw new Error(`Insufficient stock for ${product.name}`);
  }

  product.stockCrates -= cratesToBreak;
  product.stockBottles += cratesToBreak * product.bottlesPerCrate;
  product.stockBottles -= qty;
  return { cratesBroken: cratesToBreak };
}

function buildDailyPricePrompt(store, products, currency) {
  const lines = products.map((p) => `#${p.productNumber} ${p.name} ${p.sizeMl}ml: ${currency} ${p.priceBottle} / bottle`);
  return [
    `${store.settings.businessName} Stock Alert: Today's prices`,
    lines.join("\n"),
    `Till Number: ${store.settings.tillNumber}`,
    `Order: ${store.settings.salesPhones.join(" / ")}`
  ].join("\n");
}

function simulateChannelSend(channel, phone, message) {
  return {
    channel,
    phone,
    message,
    status: "queued",
    provider: process.env.MARKETING_PROVIDER || "mock"
  };
}

function routeApi(req, res, url) {
  const method = req.method || "GET";
  const store = readStore();

  if (method === "GET" && url.pathname === "/api/settings") {
    return sendJson(res, 200, store.settings);
  }

  if (method === "GET" && url.pathname === "/api/catalog") {
    const category = url.searchParams.get("category");
    const products = store.products
      .filter((p) => p.active && (!category || p.category === category))
      .sort((a, b) => a.productNumber - b.productNumber);
    return sendJson(res, 200, products);
  }

  if (method === "GET" && url.pathname === "/api/catalog/scan") {
    const code = Number(url.searchParams.get("code"));
    if (!code) return sendJson(res, 400, { error: "Scan code is required" });

    const product = store.products.find((p) => p.productNumber === code && p.active);
    if (!product) return sendJson(res, 404, { error: `No active product for code #${code}` });
    return sendJson(res, 200, product);
  }

  if (method === "GET" && url.pathname === "/api/categories") {
    const categories = [...new Set(store.products.filter((p) => p.active).map((p) => p.category))];
    return sendJson(res, 200, categories);
  }

  if (method === "GET" && url.pathname === "/api/inventory") {
    return sendJson(res, 200, store.products
      .slice()
      .sort((a, b) => a.productNumber - b.productNumber)
      .map((p) => ({
        productNumber: p.productNumber,
        id: p.id,
        name: p.name,
        category: p.category,
        stockBottles: p.stockBottles,
        stockCrates: p.stockCrates,
        bottlesPerCrate: p.bottlesPerCrate
      })));
  }

  if (method === "POST" && url.pathname === "/api/inventory/restock") {
    return parseBody(req)
      .then((body) => {
        const product = store.products.find((p) => p.id === body.productId);
        if (!product) return sendJson(res, 404, { error: "Product not found" });

        const addBottles = Number(body.bottles || 0);
        const addCrates = Number(body.crates || 0);
        if (addBottles < 0 || addCrates < 0) return sendJson(res, 400, { error: "Invalid restock quantities" });
        if (addBottles === 0 && addCrates === 0) return sendJson(res, 400, { error: "Restock quantities cannot both be zero" });

        product.stockBottles += addBottles;
        product.stockCrates += addCrates;
        store.stockMovements.unshift({
          id: `stk_${Date.now()}`,
          createdAt: new Date().toISOString(),
          productId: product.id,
          productNumber: product.productNumber,
          productName: product.name,
          type: "stock_in",
          source: "manual_restock",
          bottlesIn: addBottles,
          cratesIn: addCrates,
          bottlesOut: 0,
          cratesOut: 0,
          note: body.note || null
        });
        writeStore(store);

        return sendJson(res, 200, { ok: true, product });
      })
      .catch((err) => sendJson(res, 400, { error: err.message }));
  }

  if (method === "POST" && url.pathname === "/api/pricing") {
    return parseBody(req)
      .then((body) => {
        const product = store.products.find((p) => p.id === body.productId);
        if (!product) return sendJson(res, 404, { error: "Product not found" });

        const priceBottle = Number(body.priceBottle);
        const priceCrate = Number(body.priceCrate);
        if (Number.isNaN(priceBottle) || Number.isNaN(priceCrate) || priceBottle <= 0 || priceCrate <= 0) {
          return sendJson(res, 400, { error: "Invalid prices" });
        }

        product.priceBottle = priceBottle;
        product.priceCrate = priceCrate;

        if (Array.isArray(body.bulkDiscounts)) {
          product.bulkDiscounts = body.bulkDiscounts
            .filter((rule) => ["bottle", "crate"].includes(rule.unit))
            .map((rule) => ({
              unit: rule.unit,
              minQty: Number(rule.minQty),
              percent: Number(rule.percent)
            }))
            .filter((rule) => rule.minQty > 0 && rule.percent >= 0 && rule.percent <= 100);
        }

        writeStore(store);
        return sendJson(res, 200, { ok: true, product });
      })
      .catch((err) => sendJson(res, 400, { error: err.message }));
  }

  if (method === "POST" && url.pathname === "/api/orders") {
    return parseBody(req)
      .then((body) => {
        if (!body.confirmAge) {
          return sendJson(res, 400, { error: `Customer must confirm ${store.settings.legalAge}+ age gate` });
        }
        if (!body.customer || !body.customer.phone) {
          return sendJson(res, 400, { error: "Customer phone is required" });
        }
        if (!Array.isArray(body.items) || body.items.length === 0) {
          return sendJson(res, 400, { error: "Order items are required" });
        }

        const lines = [];
        let total = 0;

        for (const item of body.items) {
          const qty = Number(item.qty);
          const unit = item.unit;
          if (!["bottle", "crate"].includes(unit) || qty <= 0) {
            return sendJson(res, 400, { error: "Invalid item unit or qty" });
          }

          const product = store.products.find((p) => p.id === item.productId && p.active);
          if (!product) return sendJson(res, 404, { error: `Product not found: ${item.productId}` });

          const unitPrice = unit === "bottle" ? product.priceBottle : product.priceCrate;
          const discountPercent = getDiscountPercent(product, unit, qty);
          const gross = unitPrice * qty;
          const discountAmount = Math.round((gross * discountPercent) / 100);
          const lineTotal = gross - discountAmount;

          if (unit === "bottle") {
            const bottleResult = fulfillBottleQty(product, qty);
            store.stockMovements.unshift({
              id: `stk_${Date.now()}_${product.id}`,
              createdAt: new Date().toISOString(),
              productId: product.id,
              productNumber: product.productNumber,
              productName: product.name,
              type: "stock_out",
              source: "sale_order",
              bottlesIn: 0,
              cratesIn: 0,
              bottlesOut: qty,
              cratesOut: 0,
              cratesBrokenForBottles: bottleResult.cratesBroken,
              note: `Order sale (${unit})`
            });
          } else {
            if (qty > product.stockCrates) {
              return sendJson(res, 400, { error: `Insufficient crate stock for ${product.name}` });
            }
            product.stockCrates -= qty;
            store.stockMovements.unshift({
              id: `stk_${Date.now()}_${product.id}`,
              createdAt: new Date().toISOString(),
              productId: product.id,
              productNumber: product.productNumber,
              productName: product.name,
              type: "stock_out",
              source: "sale_order",
              bottlesIn: 0,
              cratesIn: 0,
              bottlesOut: 0,
              cratesOut: qty,
              cratesBrokenForBottles: 0,
              note: `Order sale (${unit})`
            });
          }

          total += lineTotal;
          lines.push({
            productId: product.id,
            productNumber: product.productNumber,
            name: product.name,
            qty,
            unit,
            unitPrice,
            discountPercent,
            lineTotal
          });
        }

        const order = {
          id: `ord_${Date.now()}`,
          createdAt: new Date().toISOString(),
          customer: {
            name: body.customer.name || "Guest",
            phone: body.customer.phone,
            idNumber: body.customer.idNumber || null,
            verifyOnDelivery: true
          },
          confirmAge: true,
          items: lines,
          total,
          status: "pending_delivery",
          salesContacts: store.settings.salesPhones
        };

        store.orders.unshift(order);
        writeStore(store);
        return sendJson(res, 201, order);
      })
      .catch((err) => sendJson(res, 400, { error: err.message }));
  }

  if (method === "GET" && url.pathname === "/api/orders") {
    return sendJson(res, 200, store.orders);
  }

  if (method === "POST" && url.pathname === "/api/marketing/broadcast") {
    return parseBody(req)
      .then((body) => {
        const channel = body.channel;
        if (!["sms", "whatsapp"].includes(channel)) {
          return sendJson(res, 400, { error: "Channel must be sms or whatsapp" });
        }

        const productIds = Array.isArray(body.productIds) ? body.productIds : [];
        const focusProducts = productIds.length
          ? store.products.filter((p) => productIds.includes(p.id))
          : store.products.filter((p) => p.active);

        const rawMessage = body.message && String(body.message).trim().length
          ? String(body.message).trim()
          : buildDailyPricePrompt(store, focusProducts, store.settings.currency);
        const salesLine = `Order: ${store.settings.salesPhones.join(" / ")}`;
        const message = rawMessage.includes("Order:") ? rawMessage : `${rawMessage}\n${salesLine}`;

        const recipients = store.customers.filter((c) => c.channels && c.channels[channel] && c.phone);
        const results = recipients.map((recipient) => simulateChannelSend(channel, recipient.phone, message));

        const log = {
          id: `mkt_${Date.now()}`,
          createdAt: new Date().toISOString(),
          channel,
          recipients: recipients.length,
          message,
          resultPreview: results.slice(0, 5)
        };

        store.marketingLogs.unshift(log);
        writeStore(store);

        return sendJson(res, 200, {
          ok: true,
          queued: results.length,
          channel,
          message,
          provider: process.env.MARKETING_PROVIDER || "mock"
        });
      })
      .catch((err) => sendJson(res, 400, { error: err.message }));
  }

  if (method === "GET" && url.pathname === "/api/marketing/logs") {
    return sendJson(res, 200, store.marketingLogs);
  }

  if (method === "GET" && url.pathname === "/api/stock/movements") {
    return sendJson(res, 200, store.stockMovements.slice(0, 250));
  }

  return sendJson(res, 404, { error: "Not found" });
}

const mimeByExt = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml"
};

function serveStatic(req, res, url) {
  let pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    return res.end("Not found");
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeByExt[ext] || "application/octet-stream";
  const content = fs.readFileSync(filePath);

  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": content.length
  });
  res.end(content);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if ((req.method === "POST" || req.method === "PUT" || req.method === "PATCH") && req.headers["content-type"]?.includes("application/json") === false) {
    return sendJson(res, 415, { error: "Content-Type must be application/json" });
  }

  if (url.pathname.startsWith("/api/")) {
    return routeApi(req, res, url);
  }

  return serveStatic(req, res, url);
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Raven Store running at http://${HOST}:${PORT}`);
});
