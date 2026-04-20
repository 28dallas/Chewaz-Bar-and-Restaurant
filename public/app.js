const state = {
  settings: null,
  categories: [],
  products: [],
  visibleProducts: [],
  inventory: [],
  stockMovements: [],
  cart: [],
  orders: []
};

const $ = (sel) => document.querySelector(sel);

async function api(path, options = {}) {
  const pin = sessionStorage.getItem("adminPin");
  if (pin) {
    options.headers = { ...options.headers, "X-Admin-Pin": pin };
  }
  const res = await fetch(path, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function currency(value) {
  const curr = state.settings?.currency || "KES";
  return `${curr} ${value}`;
}

function totalBottleEquivalent(product) {
  return product.stockBottles + product.stockCrates * product.bottlesPerCrate;
}

function getStockStatus(product) {
  const equivalent = totalBottleEquivalent(product);
  if (equivalent <= 0) {
    return { label: "Out of stock", className: "stock-out", rank: 0 };
  }
  if (equivalent <= product.bottlesPerCrate) {
    return { label: "Low stock", className: "stock-low", rank: 1 };
  }
  return { label: "In stock", className: "stock-in", rank: 2 };
}

function addToCart(productId, unit, qty) {
  const parsedQty = Number(qty);
  if (!parsedQty || parsedQty <= 0) return;

  const existing = state.cart.find((c) => c.productId === productId && c.unit === unit);
  if (existing) {
    existing.qty += parsedQty;
  } else {
    state.cart.push({ productId, unit, qty: parsedQty });
  }
  renderCart();
}

function updateCheckoutTotal() {
  let total = 0;
  state.cart.forEach(item => {
    const product = state.products.find(p => p.id === item.productId);
    if (!product) return;
    const unitPrice = item.unit === 'bottle' ? product.priceBottle : product.priceCrate;
    total += unitPrice * item.qty;
  });
  const el = $("#checkoutLiveTotal");
  if (el) el.textContent = total > 0 ? `Order Total: ${currency(total)}` : "";
}

function renderCart() {
  const box = $("#cart");
  if (!state.cart.length) {
    box.innerHTML = "<p>Cart is empty.</p>";
    updateCheckoutTotal();
    return;
  }

  let total = 0;
  const cartItems = state.cart
    .map((item, idx) => {
      const product = state.products.find((p) => p.id === item.productId);
      if (!product) return '';

      const unitPrice = item.unit === 'bottle' ? product.priceBottle : product.priceCrate;
      const lineTotal = unitPrice * item.qty;
      total += lineTotal;

      return `
        <div class="product cart-item">
          <div class="product-header">
            <strong>#${product.productNumber} ${product.name}</strong>
            <button data-cart-rm="${idx}" class="remove-btn">×</button>
          </div>
          <div class="product-details">
            <div class="detail-row">
              <span>Brand: ${product.brand}</span>
              <span>Size: ${product.sizeMl}ml</span>
            </div>
            <div class="detail-row">
              <span>Category: ${product.category}</span>
              <span>Unit: ${item.unit}</span>
            </div>
            <div class="detail-row">
              <span>Quantity: ${item.qty}</span>
              <span>Price: ${currency(unitPrice)}</span>
            </div>
            <div class="detail-row total-row">
              <strong>Subtotal: ${currency(lineTotal)}</strong>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  box.innerHTML = `
    <div class="cart-summary">
      ${cartItems}
      <div class="cart-total">
        <strong>Total: ${currency(total)}</strong>
      </div>
    </div>
  `;

  box.querySelectorAll("[data-cart-rm]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.cart.splice(Number(btn.getAttribute("data-cart-rm")), 1);
      renderCart();
    });
  });
  updateCheckoutTotal();
}

function applyCatalogFilters() {
  const selectedCategory = state.selectedCategory || "All";
  const search = $("#catalogSearch").value.trim().toLowerCase();
  const sort = $("#sortFilter").value;

  let filtered = state.products.filter((product) => {
    if (selectedCategory && selectedCategory !== "All" && product.category !== selectedCategory) return false;
    if (!search) return true;

    const haystack = [
      String(product.productNumber || ""),
      product.name,
      product.brand,
      product.category,
      String(product.sizeMl || "")
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(search);
  });

  filtered = filtered.sort((a, b) => {
    if (sort === "price_asc") return a.priceBottle - b.priceBottle;
    if (sort === "price_desc") return b.priceBottle - a.priceBottle;
    if (sort === "name_asc") return a.name.localeCompare(b.name);
    if (sort === "stock_desc") return totalBottleEquivalent(b) - totalBottleEquivalent(a);
    return a.productNumber - b.productNumber;
  });

  state.visibleProducts = filtered;
  renderCatalog();
}

function showCatalogSkeletons() {
  const catalog = $("#catalog");
  catalog.innerHTML = Array(6).fill('<div class="skeleton skeleton-card"></div>').join("");
}

function renderCatalog() {
  const catalog = $("#catalog");

  if (!state.visibleProducts.length) {
    catalog.innerHTML = "<p>No products match your filters.</p>";
    return;
  }

  catalog.innerHTML = state.visibleProducts
    .map((p) => {
      const stockStatus = getStockStatus(p);
      return `
        <article class="product">
          <div class="product-content">
            <h4>#${p.productNumber} ${p.name}</h4>
            <div class="meta">${p.category} | ${p.sizeMl}ml | ${p.brand}</div>
            <div class="meta">Bottle: ${currency(p.priceBottle)} | Crate: ${currency(p.priceCrate)}</div>
            <div class="meta stock-line"><span class="stock-badge ${stockStatus.className}">${stockStatus.label}</span>Stock: ${p.stockBottles} bottles, ${p.stockCrates} crates</div>
            <div class="row">
              <select data-unit="${p.id}">
                <option value="bottle">Bottle</option>
                <option value="crate">Crate</option>
              </select>
              <input type="number" min="1" value="1" data-qty="${p.id}" />
              <button data-add="${p.id}">Add</button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  catalog.querySelectorAll("[data-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-add");
      const unit = catalog.querySelector(`[data-unit='${id}']`).value;
      const qty = catalog.querySelector(`[data-qty='${id}']`).value;
      addToCart(id, unit, qty);
    });
  });
}

function buildTopSellerRows() {
  const salesByProduct = new Map();

  state.stockMovements
    .filter((m) => m.type === "stock_out" && m.source === "sale_order")
    .forEach((movement) => {
      const product = state.products.find((p) => p.id === movement.productId);
      if (!product) return;
      const soldEquivalent = Number(movement.bottlesOut || 0) + Number(movement.cratesOut || 0) * product.bottlesPerCrate;
      if (!soldEquivalent) return;

      const existing = salesByProduct.get(product.id) || { product, soldEquivalent: 0 };
      existing.soldEquivalent += soldEquivalent;
      salesByProduct.set(product.id, existing);
    });

  const sorted = [...salesByProduct.values()].sort((a, b) => b.soldEquivalent - a.soldEquivalent);
  if (sorted.length) return sorted.slice(0, 6);

  return state.products
    .slice()
    .sort((a, b) => a.productNumber - b.productNumber)
    .slice(0, 6)
    .map((product) => ({ product, soldEquivalent: null }));
}

function renderTopSellers() {
  const box = $("#topSellers");
  if (!box) return;

  const rows = buildTopSellerRows();
  if (!rows.length) {
    box.innerHTML = "<p>No top seller data yet.</p>";
    return;
  }

  box.innerHTML = rows
    .map(({ product, soldEquivalent }) => {
      const stockStatus = getStockStatus(product);
      const soldLabel = soldEquivalent == null ? "No sales history yet" : `Sold: ${soldEquivalent} bottle-eq`;
      return `
        <article class="top-seller">
          <div class="product-content">
            <h4>#${product.productNumber} ${product.name}</h4>
            <div class="meta">${product.brand} | ${product.sizeMl}ml</div>
            <div class="meta">Bottle: ${currency(product.priceBottle)}</div>
            <div class="meta stock-line"><span class="stock-badge ${stockStatus.className}">${stockStatus.label}</span>${soldLabel}</div>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderInventory() {
  const isAdmin = !!sessionStorage.getItem("adminPin");
  const table = `
    <table class="table">
      <thead>
        <tr><th>No.</th><th>Product</th><th>Category</th><th>Size</th><th>Bottle Price</th><th>Bottles</th><th>Crates</th>${isAdmin ? '<th>Action</th>' : ''}</tr>
      </thead>
      <tbody>
        ${state.inventory.map(row => `
          <tr>
            <td>${row.productNumber}</td>
            <td>${row.name}</td>
            <td>${row.category}</td>
            <td>${row.sizeMl}ml</td>
            <td>KES ${row.priceBottle}</td>
            <td>${row.stockBottles}</td>
            <td>${row.stockCrates}</td>
            ${isAdmin ? `<td><button class="edit-product-btn" data-id="${row.id}" style="padding:0.3rem 0.8rem;font-size:0.8rem;">✏️ Edit</button></td>` : ''}
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
  $("#inventoryTable").innerHTML = table;

  if (isAdmin) {
    $("#inventoryTable").querySelectorAll(".edit-product-btn").forEach(btn => {
      btn.addEventListener("click", () => openEditModal(btn.getAttribute("data-id")));
    });
  }
}

function renderStockMovements() {
  const rows = state.stockMovements
    .slice(0, 30)
    .map((m) => `
      <tr>
        <td>${new Date(m.createdAt).toLocaleString()}</td>
        <td>#${m.productNumber} ${m.productName}</td>
        <td>${m.type}</td>
        <td>${m.bottlesIn}</td>
        <td>${m.cratesIn}</td>
        <td>${m.bottlesOut}</td>
        <td>${m.cratesOut}</td>
      </tr>
    `)
    .join("");

  $("#stockMovementTable").innerHTML = `
    <table class="table">
      <thead>
        <tr><th>Time</th><th>Product</th><th>Type</th><th>Bottles In</th><th>Crates In</th><th>Bottles Out</th><th>Crates Out</th></tr>
      </thead>
      <tbody>${rows || "<tr><td colspan='7'>No movement yet.</td></tr>"}</tbody>
    </table>
  `;
}
function isWithinTimeframe(dateStr, timeframe) {
  if (timeframe === "all") return true;
  const date = new Date(dateStr);
  const now = new Date();

  if (timeframe === "daily") {
    return date.toDateString() === now.toDateString();
  }
  if (timeframe === "weekly") {
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    return date >= startOfWeek;
  }
  if (timeframe === "monthly") {
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  }
  if (timeframe === "yearly") {
    return date.getFullYear() === now.getFullYear();
  }
  return true;
}

function renderOrders() {
  const statusFilter = $("#orderStatusFilter").value;
  const timeframeFilter = $("#orderTimeframeFilter").value;

  const filtered = state.orders.filter(o => {
    const matchesStatus = statusFilter === "all" || o.paymentStatus === statusFilter || (statusFilter === "pending_delivery" && !o.paymentStatus);
    const matchesTimeframe = isWithinTimeframe(o.createdAt, timeframeFilter);
    return matchesStatus && matchesTimeframe;
  });

  const rows = filtered
    .map((o) => {
      const status = o.paymentStatus || "pending";
      const statusClass = `status-${status}`;
      const isPaid = status === "paid";
      return `
      <tr>
        <td>${new Date(o.createdAt).toLocaleString()}</td>
        <td style="font-size:0.8rem;">${o.id}</td>
        <td>${o.customer.name}<br><small>${o.customer.phone}</small></td>
        <td>${currency(o.total)}</td>
        <td><span class="status-pill ${statusClass}">${status}</span></td>
        <td>
          ${!isPaid ? `<button class="mark-paid-btn cta-btn" data-order-id="${o.id}" style="padding:0.25rem 0.6rem;font-size:0.75rem;background:#22c55e;margin-bottom:4px;">✓ Mark Paid</button><br>` : ''}
          <button class="receipt-btn" data-order-id="${o.id}" style="padding:0.25rem 0.6rem;font-size:0.75rem;background:var(--muted);">🧾 Receipt</button>
        </td>
      </tr>
    `;
    })
    .join("");

  const tableBody = $("#ordersTableBody");
  if (tableBody) {
    tableBody.innerHTML = rows || "<tr><td colspan='6'>No orders found.</td></tr>";

    tableBody.querySelectorAll(".receipt-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const order = state.orders.find(o => o.id === btn.getAttribute("data-order-id"));
        if (order) openHtmlReceiptInTab(generateCustomerHtmlReceipt(order));
      });
    });

    tableBody.querySelectorAll(".mark-paid-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const orderId = btn.getAttribute("data-order-id");
        try {
          await api(`/api/orders/${orderId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paymentStatus: "paid" })
          });
          await loadAdminData();
        } catch (err) {
          alert("Failed to update: " + err.message);
        }
      });
    });
  }
}

function renderDailySales() {
  const today = new Date().toISOString().split("T")[0];
  const todayOrders = state.orders.filter(o => o.createdAt.startsWith(today));
  const paidOrders = todayOrders.filter(o => o.paymentStatus === "paid");

  const totalRevenue = todayOrders.reduce((sum, o) => sum + o.total, 0);
  const paidRevenue = paidOrders.reduce((sum, o) => sum + o.total, 0);

  $("#dailySalesSummary").innerHTML = `
    <div class="summary-card">
      <h4>Today's Total Orders</h4>
      <div class="value">${todayOrders.length}</div>
    </div>
    <div class="summary-card">
      <h4>Expected Revenue</h4>
      <div class="value">${currency(totalRevenue)}</div>
    </div>
    <div class="summary-card">
      <h4>Confirmed Revenue (Paid)</h4>
      <div class="value">${currency(paidRevenue)}</div>
    </div>
  `;
}

async function pollPaymentStatus(orderId, maxAttempts = 12) {
  let attempts = 0;
  const interval = setInterval(async () => {
    attempts++;
    try {
      const orders = await api("/api/orders");
      const order = orders.find(o => o.id === orderId);
      if (order && order.paymentStatus === "paid") {
        clearInterval(interval);
        $("#checkoutStatus").textContent = `Payment confirmed for order ${orderId}! 🥂`;
        await refreshData();
      } else if (order && order.paymentStatus === "failed") {
        clearInterval(interval);
        $("#checkoutStatus").textContent = `Payment failed for order ${orderId}. Please try again or pay via cash.`;
      } else if (attempts >= maxAttempts) {
        clearInterval(interval);
        $("#checkoutStatus").textContent += "\nPayment verification timed out. Please check with staff or refresh orders.";
      }
    } catch (err) {
      console.error("Polling error:", err);
    }
  }, 5000); // Poll every 5 seconds
}

async function loadCatalog(forceReload = false) {
  if (forceReload || !state.products.length) {
    showCatalogSkeletons();
    state.products = await api("/api/catalog");
  }
  applyCatalogFilters();
  renderTopSellers();
}

async function loadBasics() {
  const [settings, categories, inventory] = await Promise.all([
    api("/api/settings"),
    api("/api/categories"),
    api("/api/inventory")
  ]);

  state.settings = settings;
  state.categories = categories;
  state.inventory = inventory;

  $("#businessName").textContent = settings.businessName;
  $("#businessMeta").textContent = `Till Number: ${settings.tillNumber}`;
  $("#salesPhones").textContent = `Sales: ${settings.salesPhones.join(" / ")}`;
  $("#deliveryHours").textContent = `Delivery: ${settings.deliveryHours}`;

  state.selectedCategory = "All";
  const tabs = $("#categoryTabs");
  const catList = ["All", ...categories];
  tabs.innerHTML = catList
    .map(c => `<button class="category-tab ${c === "All" ? "active" : ""}" data-cat="${c}">${c}</button>`)
    .join("");

  tabs.querySelectorAll(".category-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      tabs.querySelectorAll(".category-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.selectedCategory = btn.getAttribute("data-cat");
      applyCatalogFilters();
    });
  });

  const productOptions = inventory.map((p) => `<option value="${p.id}">#${p.productNumber} ${p.name}</option>`).join("");
  if ($("#restockProduct")) $("#restockProduct").innerHTML = productOptions;
  if ($("#priceProduct")) $("#priceProduct").innerHTML = productOptions;

  renderInventory();

  if (sessionStorage.getItem("adminPin")) {
    await loadAdminData();
  }
}

async function loadAdminData() {
  try {
    const [stockMovements, orders] = await Promise.all([
      api("/api/stock/movements"),
      api("/api/orders")
    ]);
    state.stockMovements = stockMovements;
    state.orders = orders;

    renderStockMovements();
    renderOrders();
    renderDailySales();
    renderTopSellers();
  } catch (err) {
    if (err.message.includes("Unauthorized") || err.message.includes("Admin PIN") || err.message.includes("Invalid PIN")) {
      sessionStorage.removeItem("adminPin");
      checkAdminPanelState();
    }
  }
}

async function onCheckout(ev) {
  ev.preventDefault();
  const form = new FormData(ev.target);

  const payload = {
    customer: {
      name: form.get("name"),
      phone: form.get("phone"),
      idNumber: form.get("idNumber")
    },
    confirmAge: Boolean(form.get("confirmAge")),
    items: state.cart
  };

  try {
    const order = await api("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const paymentMethod = form.get("paymentMethod");
    let statusText = `Order ${order.id} created. Total: ${currency(order.total)}.`;

    if (paymentMethod === "mpesa") {
      statusText += " Initializing M-Pesa payment prompt...";
      $("#checkoutStatus").textContent = statusText;

      try {
        const mpesaResult = await api("/api/payments/stkpush", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone: payload.customer.phone,
            amount: order.total,
            orderId: order.id
          })
        });

        if (mpesaResult.ResponseCode === "0") {
          statusText = `Order ${order.id} created. Please check your phone for the M-Pesa PIN prompt to pay ${currency(order.total)}.`;
          pollPaymentStatus(order.id);
        } else {
          statusText = `Order ${order.id} created, but M-Pesa prompt failed: ${mpesaResult.ResponseDescription || "Unknown error"}. Please pay via cash on delivery.`;
        }
      } catch (err) {
        statusText = `Order ${order.id} created, but M-Pesa prompt failed: ${err.message}. Please pay via cash on delivery.`;
      }
    } else {
      statusText += ` Please pay ${currency(order.total)} via cash on delivery.`;
    }

    $("#checkoutStatus").textContent = statusText;
    state.cart = [];
    renderCart();
    await refreshData();

    const modal = $("#orderSuccessModal");
    if (modal) {
      $("#successOrderId").textContent = `Order ID: ${order.id}`;
      $("#successTotal").textContent = currency(order.total);
      modal.classList.remove("hidden");
    }

    // Generate and open printable HTML receipt
    const htmlReceipt = generateCustomerHtmlReceipt(order);
    openHtmlReceiptInTab(htmlReceipt);

  } catch (err) {
    $("#checkoutStatus").textContent = err.message;
  }
}

async function onRestock(ev) {
  ev.preventDefault();
  const form = new FormData(ev.target);
  try {
    await api("/api/inventory/restock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId: form.get("productId"),
        bottles: Number(form.get("bottles")),
        crates: Number(form.get("crates"))
      })
    });
    await refreshData();
  } catch (err) {
    alert(err.message);
  }
}

async function onPricing(ev) {
  ev.preventDefault();
  const form = new FormData(ev.target);
  try {
    await api("/api/pricing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId: form.get("productId"),
        priceBottle: Number(form.get("priceBottle")),
        priceCrate: Number(form.get("priceCrate"))
      })
    });
    await refreshData();
  } catch (err) {
    alert(err.message);
  }
}

async function onMarketing(ev) {
  ev.preventDefault();
  const form = new FormData(ev.target);
  try {
    const result = await api("/api/marketing/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: form.get("channel"),
        message: form.get("message"),
        salesPhones: state.settings.salesPhones
      })
    });
    $("#marketingStatus").textContent = `Queued ${result.queued} ${result.channel} prompts via ${result.provider}`;
  } catch (err) {
    $("#marketingStatus").textContent = err.message;
  }
}

async function refreshData() {
  const [inventory] = await Promise.all([
    api("/api/inventory")
  ]);

  state.inventory = inventory;

  renderInventory();
  await loadCatalog(true);

  if (sessionStorage.getItem("adminPin")) {
    await loadAdminData();
  }
}

async function onScanAdd() {
  const code = Number($("#scanCode").value);
  const unit = $("#scanUnit").value;
  const qty = Number($("#scanQty").value || 1);

  if (!code || qty <= 0) return;

  try {
    const product = await api(`/api/catalog/scan?code=${code}`);
    addToCart(product.id, unit, qty);
    $("#scanCode").value = "";
  } catch (err) {
    alert(err.message);
  }
}

async function onPosPush(ev) {
  ev.preventDefault();
  const form = new FormData(ev.target);
  const statusEl = $("#posPushStatus");
  statusEl.style.display = "block";
  statusEl.textContent = "Initiating push...";

  try {
    const res = await api("/api/mpesa/admin-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: form.get("phone"),
        amount: Number(form.get("amount"))
      })
    });
    statusEl.textContent = res.message || "Success";
    ev.target.reset();
  } catch (err) {
    statusEl.textContent = "Error: " + err.message;
  }
}

function generateCustomerHtmlReceipt(order) {
  const businessName = state.settings?.businessName || "Chewaz Bar & Restaurant";
  const tillNumber = state.settings?.tillNumber || "3706694";
  const salesPhones = state.settings?.salesPhones?.join(" / ") || "N/A";
  const status = order.paymentStatus || "pending";
  const statusLabel = status.toUpperCase();

  const itemsHtml = order.items.map(item => `
    <tr>
      <td>
        <strong>${item.name}</strong><br>
        <small>${item.unit} x${item.qty}</small>
      </td>
      <td style="text-align: right;">${currency(item.unitPrice)}</td>
      <td style="text-align: right; font-weight:bold;">${currency(item.lineTotal)}</td>
    </tr>
  `).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Receipt - ${order.id}</title>
      <style>
        body { font-family: 'Lexend', sans-serif; color: #333; margin: 0; padding: 10px; background: #f9f9f9; font-size: 13px; }
        .receipt-card { max-width: 480px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
        .header { text-align: center; border-bottom: 2px solid #d4af37; padding-bottom: 12px; margin-bottom: 16px; }
        .header h1 { color: #d4af37; margin: 0; font-size: 18px; text-transform: uppercase; }
        .header p { margin: 3px 0; color: #666; font-size: 11px; }
        .status-badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 10px; font-weight: bold; text-transform: uppercase; margin-top: 6px; }
        .status-paid { background: #e6fffa; color: #2c7a7b; border: 1px solid #b2f5ea; }
        .status-pending { background: #fffaf0; color: #9c4221; border: 1px solid #feebc8; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; font-size: 12px; }
        .info-box h3 { font-size: 10px; color: #999; text-transform: uppercase; margin-bottom: 3px; }
        .info-box p { margin: 0; font-size: 12px; font-weight: 500; }
        .items-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
        .items-table th { text-align: left; font-size: 10px; color: #999; text-transform: uppercase; padding: 6px 4px; border-bottom: 1px solid #eee; }
        .items-table td { padding: 5px 4px; border-bottom: 1px solid #f5f5f5; font-size: 12px; }
        .items-table td small { font-size: 10px; color: #888; }
        .total-section { border-top: 2px solid #000; padding-top: 10px; text-align: right; }
        .total-row { font-size: 15px; font-weight: bold; }
        .footer { text-align: center; margin-top: 16px; font-size: 10px; color: #999; border-top: 1px dashed #ccc; padding-top: 8px; }
        @media print {
          body { background: white; padding: 0; font-size: 11px; }
          .receipt-card { box-shadow: none; border: none; max-width: 100%; padding: 5px; }
          .no-print { display: none; }
          * { color: #000 !important; background: white !important; border-color: #000 !important; }
        }
      </style>
    </head>
    <body>
      <div class="receipt-card">
        <div class="header">
          <h1>${businessName}</h1>
          <p>Till Number: ${tillNumber} | Sales: ${salesPhones}</p>
          <div class="status-badge status-${status}">${statusLabel}</div>
        </div>
        
        <div class="info-grid">
          <div class="info-box">
            <h3>Waiter</h3>
            <p>${order.customer.name}</p>
            <p>${order.customer.phone}</p>
          </div>
          <div class="info-box" style="text-align: right;">
            <h3>Order Details</h3>
            <p><strong>ID:</strong> ${order.id}</p>
            <p><strong>Date:</strong> ${new Date(order.createdAt).toLocaleString()}</p>
          </div>
        </div>

        <table class="items-table">
          <thead>
            <tr>
              <th>Item</th>
              <th style="text-align: right;">Price</th>
              <th style="text-align: right;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        <div class="total-section">
          <div class="total-row">Total: ${currency(order.total)}</div>
          <p style="margin-top: 10px; font-size: 14px; color: #666;">Payment: ${order.paymentStatus === 'paid' ? 'Paid via M-Pesa' : 'Pay on Delivery'}</p>
        </div>

        <div class="footer">
          <p>Thank you for choosing ${businessName}!</p>
          <p>Please present this receipt for verification.</p>
        </div>
        
        <div class="no-print" style="margin-top: 30px; text-align: center;">
          <button onclick="window.print()" style="background: #d4af37; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-weight: bold;">Print / Save as PDF</button>
        </div>
      </div>
    </body>
    </html>
  `;
}

function openHtmlReceiptInTab(html) {
  try {
    const win = window.open('', '_blank');
    if (!win) throw new Error("Popup blocked");
    win.document.write(html);
    win.document.close();
  } catch (err) {
    console.error("Window open failed:", err);
    // Fallback: create a temporary modal if popup is blocked
    const modal = document.createElement("div");
    modal.style.position = "fixed";
    modal.style.top = "0";
    modal.style.left = "0";
    modal.style.width = "100%";
    modal.style.height = "100%";
    modal.style.background = "rgba(0,0,0,0.8)";
    modal.style.zIndex = "9999";
    modal.style.overflow = "auto";
    modal.innerHTML = `
      <div style="padding: 20px; max-width: 800px; margin: 20px auto;">
        <button onclick="this.parentElement.parentElement.remove()" style="margin-bottom: 20px; background: #d4af37; color: white; border: none; padding: 10px 20px; cursor: pointer;">Close & Return</button>
        <div style="background: white; border-radius: 8px;">${html}</div>
      </div>
    `;
    document.body.appendChild(modal);
  }
}

function generateCustomerReceipt(order) {
  const businessName = state.settings?.businessName || "Raven Store";
  const businessMeta = `Till Number: ${state.settings?.tillNumber || "N/A"}`;
  const salesPhones = state.settings?.salesPhones?.join(" / ") || "N/A";

  let receiptContent = `${businessName}\n`;
  receiptContent += `${businessMeta}\n`;
  receiptContent += `Sales: ${salesPhones}\n`;
  receiptContent += `Delivery: ${state.settings?.deliveryHours || "N/A"}\n\n`;

  receiptContent += `RECEIPT\n`;
  receiptContent += `Order ID: ${order.id}\n`;
  receiptContent += `Date: ${new Date(order.createdAt).toLocaleString()}\n`;
  receiptContent += `Customer: ${order.customer.name}\n`;
  receiptContent += `Phone: ${order.customer.phone}\n`;
  if (order.customer.idNumber) {
    receiptContent += `ID Number: ${order.customer.idNumber}\n`;
  }
  receiptContent += `\n`;

  receiptContent += `ITEMS:\n`;
  receiptContent += `-`.repeat(50) + `\n`;

  order.items.forEach(item => {
    receiptContent += `${item.productNumber} ${item.name}\n`;
    receiptContent += `  ${item.qty} x ${item.unit} @ ${currency(item.unitPrice)}\n`;
    if (item.discountPercent > 0) {
      receiptContent += `  Discount: ${item.discountPercent}%\n`;
    }
    receiptContent += `  Subtotal: ${currency(item.lineTotal)}\n\n`;
  });

  receiptContent += `-`.repeat(50) + `\n`;
  receiptContent += `TOTAL: ${currency(order.total)}\n`;
  receiptContent += `Payment Status: ${order.paymentStatus || "Pending"}\n\n`;

  receiptContent += `Thank you for your business!\n`;
  receiptContent += `Please verify ID on delivery.\n`;

  return receiptContent;
}

function downloadTextFile(content, filename) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function onAdminLogin(ev) {
  ev.preventDefault();
  const form = new FormData(ev.target);
  const pin = form.get("pin");

  try {
    await api("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin })
    });
    sessionStorage.setItem("adminPin", pin);
    checkAdminPanelState();
    await loadAdminData();
    ev.target.reset();
  } catch (err) {
    alert("Login failed: " + err.message);
  }
}

function generateProfessionalHtmlReport(orders, timeframe) {
  const businessName = state.settings?.businessName || "Chewaz Bar & Restaurant";
  const tillNumber = state.settings?.tillNumber || "3706694";
  const salesPhones = state.settings?.salesPhones?.join(" / ") || "N/A";

  // Calculate aggregate stats
  const totalOrders = orders.length;
  const paidOrders = orders.filter(o => o.paymentStatus === "paid");
  const pendingOrders = orders.filter(o => !o.paymentStatus || o.paymentStatus === "pending" || o.paymentStatus === "pending_delivery");
  const failedOrders = orders.filter(o => o.paymentStatus === "failed");
  const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
  const paidRevenue = paidOrders.reduce((sum, o) => sum + o.total, 0);
  const pendingRevenue = pendingOrders.reduce((sum, o) => sum + o.total, 0);

  // Calculate product-wise breakdown
  const productStats = {};
  orders.forEach(order => {
    order.items.forEach(item => {
      if (!productStats[item.productId]) {
        productStats[item.productId] = {
          name: item.name,
          productNumber: item.productNumber,
          bottles: 0,
          crates: 0,
          revenue: 0
        };
      }
      if (item.unit === 'bottle') productStats[item.productId].bottles += item.qty;
      else productStats[item.productId].crates += item.qty;
      productStats[item.productId].revenue += item.lineTotal;
    });
  });

  const productRows = Object.values(productStats)
    .sort((a, b) => b.revenue - a.revenue)
    .map(p => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #eee;">#${p.productNumber} ${p.name}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${p.bottles}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${p.crates}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">${currency(p.revenue)}</td>
      </tr>
    `).join('');

  const orderRows = orders.map(o => {
    const itemsList = o.items.map(item =>
      `${item.qty} x ${item.name} (${item.unit}) @ ${currency(item.unitPrice)} = ${currency(item.lineTotal)}`
    ).join('<br>');
    return `
    <tr>
      <td style="padding: 8px; border-bottom: 1px solid #eee; font-size: 11px;">${new Date(o.createdAt).toLocaleString()}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee; font-size: 11px;">${o.id}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee; font-size: 11px;">${o.customer.name}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee; font-size: 11px;">${itemsList}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee; font-size: 11px; text-align: right; font-weight:bold;">${currency(o.total)}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee; font-size: 11px; text-align: center;">
        <span style="padding: 2px 6px; border-radius: 4px; font-size: 10px; background: ${o.paymentStatus === 'paid' ? '#e6fffa' : '#fffaf0'}; color: ${o.paymentStatus === 'paid' ? '#2c7a7b' : '#9c4221'};">
          ${(o.paymentStatus || 'pending').toUpperCase()}
        </span>
      </td>
    </tr>
  `}).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Sales Report - ${timeframe}</title>
      <style>
        body { font-family: 'Lexend', sans-serif; color: #333; margin: 0; padding: 20px; background: #f9f9f9; }
        .report-container { max-width: 800px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
        .header { text-align: center; border-bottom: 2px solid #d4af37; padding-bottom: 20px; margin-bottom: 30px; }
        .header h1 { color: #d4af37; margin: 0; font-size: 28px; }
        .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 40px; }
        .summary-card { background: #fdfaf0; padding: 15px; border-radius: 8px; text-align: center; border: 1px solid #f9ebbe; }
        .summary-card h3 { font-size: 11px; color: #888; text-transform: uppercase; margin: 0 0 5px 0; }
        .summary-card p { font-size: 18px; font-weight: bold; margin: 0; color: #333; }
        .section-title { font-size: 14px; text-transform: uppercase; color: #d4af37; border-bottom: 1px solid #eee; padding-bottom: 5px; margin: 30px 0 15px 0; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; font-size: 11px; color: #999; text-transform: uppercase; padding: 8px; border-bottom: 2px solid #eee; }
        @media print {
          body { background: white; padding: 0; }
          .report-container { box-shadow: none; border: none; width: 100%; max-width: 100%; }
          .no-print { display: none; }
          * { color: #000 !important; background: white !important; border-color: #000 !important; }
        }
      </style>
    </head>
    <body>
      <div class="report-container">
        <div class="header">
          <h1>${businessName}</h1>
          <p style="margin:4px 0; font-size:13px;">Till: ${tillNumber} | Sales: ${salesPhones}</p>
          <p style="font-weight:bold; font-size:16px; margin:8px 0;">SALES REPORT — ${timeframe.toUpperCase()}</p>
          <p style="font-size: 12px; color: #888;">Generated: ${new Date().toLocaleString()}</p>
        </div>

        <div class="summary-grid">
          <div class="summary-card"><h3>Total Orders</h3><p>${totalOrders}</p></div>
          <div class="summary-card"><h3>Paid Orders</h3><p>${paidOrders.length}</p></div>
          <div class="summary-card"><h3>Pending Orders</h3><p>${pendingOrders.length}</p></div>
          <div class="summary-card"><h3>Failed Orders</h3><p>${failedOrders.length}</p></div>
          <div class="summary-card"><h3>Total Revenue</h3><p>${currency(totalRevenue)}</p></div>
          <div class="summary-card"><h3>Confirmed (Paid)</h3><p>${currency(paidRevenue)}</p></div>
          <div class="summary-card"><h3>Pending Amount</h3><p>${currency(pendingRevenue)}</p></div>
        </div>

        <div class="section-title">Product sales breakdown</div>
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th style="text-align: center;">Bottles</th>
              <th style="text-align: center;">Crates</th>
              <th style="text-align: right;">Revenue</th>
            </tr>
          </thead>
          <tbody>${productRows}</tbody>
        </table>

        <div class="section-title">Detailed Order History</div>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Order ID</th>
              <th>Waiter</th>
              <th>Items Sold</th>
              <th style="text-align: right;">Total</th>
              <th style="text-align: center;">Status</th>
            </tr>
          </thead>
          <tbody>${orderRows}</tbody>
        </table>

        <div style="text-align:right; margin-top:20px; padding-top:15px; border-top:2px solid #000;">
          <p style="font-size:13px; margin:4px 0;">Total Orders: <strong>${totalOrders}</strong> &nbsp;|&nbsp; Paid: <strong>${paidOrders.length}</strong> &nbsp;|&nbsp; Pending: <strong>${pendingOrders.length}</strong> &nbsp;|&nbsp; Failed: <strong>${failedOrders.length}</strong></p>
          <p style="font-size:13px; margin:4px 0;">Pending Amount (collect on delivery): <strong>${currency(pendingRevenue)}</strong></p>
          <p style="font-size:18px; margin:8px 0;">Confirmed (Paid): <strong>${currency(paidRevenue)}</strong></p>
          <p style="font-size:18px; margin:4px 0; border-top:1px solid #000; padding-top:8px;">GRAND TOTAL: <strong>${currency(totalRevenue)}</strong></p>
        </div>

        <div class="no-print" style="margin-top: 40px; text-align: center;">
          <button onclick="window.print()" style="background: #d4af37; color: white; border: none; padding: 12px 30px; border-radius: 4px; cursor: pointer; font-weight: bold;">🖨️ Print / Save as PDF</button>
        </div>
      </div>
    </body>
    </html>
  `;
}

async function onAddProduct(ev) {
  ev.preventDefault();
  const form = new FormData(ev.target);
  const statusEl = $("#addProductStatus");
  statusEl.style.display = "block";
  statusEl.textContent = "Saving...";
  try {
    const product = await api("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        brand: form.get("brand"),
        category: form.get("category"),
        sizeMl: Number(form.get("sizeMl")),
        bottlesPerCrate: Number(form.get("bottlesPerCrate")),
        priceBottle: Number(form.get("priceBottle")),
        priceCrate: Number(form.get("priceCrate")),
        stockBottles: Number(form.get("stockBottles") || 0),
        stockCrates: Number(form.get("stockCrates") || 0)
      })
    });
    statusEl.textContent = `✅ #${product.productNumber} ${product.name} added to catalog.`;
    ev.target.reset();
    await refreshData();
  } catch (err) {
    statusEl.textContent = `❌ ${err.message}`;
  }
}

function openEditModal(productId) {
  const product = state.inventory.find(p => p.id === productId);
  if (!product) return;
  const form = $("#editProductForm");
  form.querySelector('[name=productId]').value = product.id;
  form.querySelector('[name=name]').value = product.name;
  form.querySelector('[name=brand]').value = product.brand || '';
  form.querySelector('[name=category]').value = product.category;
  form.querySelector('[name=sizeMl]').value = product.sizeMl;
  form.querySelector('[name=bottlesPerCrate]').value = product.bottlesPerCrate;
  form.querySelector('[name=priceBottle]').value = product.priceBottle;
  form.querySelector('[name=priceCrate]').value = product.priceCrate;
  form.querySelector('[name=stockBottles]').value = product.stockBottles;
  form.querySelector('[name=stockCrates]').value = product.stockCrates;
  const statusEl = $("#editProductStatus");
  statusEl.style.display = 'none';
  statusEl.textContent = '';
  $("#editProductModal").classList.remove("hidden");
}

async function onSaveProduct(ev) {
  ev.preventDefault();
  const form = new FormData(ev.target);
  const productId = form.get("productId");
  const statusEl = $("#editProductStatus");
  statusEl.style.display = 'block';
  statusEl.textContent = 'Saving...';
  try {
    await api(`/api/products/${productId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.get('name'),
        brand: form.get('brand'),
        category: form.get('category'),
        sizeMl: Number(form.get('sizeMl')),
        bottlesPerCrate: Number(form.get('bottlesPerCrate')),
        priceBottle: Number(form.get('priceBottle')),
        priceCrate: Number(form.get('priceCrate')),
        stockBottles: Number(form.get('stockBottles')),
        stockCrates: Number(form.get('stockCrates'))
      })
    });
    statusEl.textContent = '✅ Saved!';
    await refreshData();
    setTimeout(() => $("#editProductModal").classList.add("hidden"), 800);
  } catch (err) {
    statusEl.textContent = '❌ ' + err.message;
  }
}

function onPrintReport() {
  const statusFilter = $("#orderStatusFilter").value;
  const timeframeFilter = $("#orderTimeframeFilter").value;

  const filtered = state.orders.filter(o => {
    const matchesStatus = statusFilter === "all" || o.paymentStatus === statusFilter || (statusFilter === "pending_delivery" && !o.paymentStatus);
    const matchesTimeframe = isWithinTimeframe(o.createdAt, timeframeFilter);
    return matchesStatus && matchesTimeframe;
  });

  if (!filtered.length) {
    alert("No orders found for the selected filters.");
    return;
  }

  const html = generateProfessionalHtmlReport(filtered, timeframeFilter);
  openHtmlReceiptInTab(html);
}

function generateSellerReceipt(orders, timeframeFilter) {
  const businessName = state.settings?.businessName || "Raven Store";
  const businessMeta = `Till Number: ${state.settings?.tillNumber || "N/A"}`;

  let receiptContent = `${businessName} - SALES REPORT\n`;
  receiptContent += `${businessMeta}\n`;
  receiptContent += `Report Period: ${timeframeFilter === "all" ? "All Time" : timeframeFilter}\n`;
  receiptContent += `Generated: ${new Date().toLocaleString()}\n\n`;

  receiptContent += `SUMMARY:\n`;
  receiptContent += `-`.repeat(60) + `\n`;

  const totalOrders = orders.length;
  const paidOrders = orders.filter(o => o.paymentStatus === "paid");
  const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
  const paidRevenue = paidOrders.reduce((sum, o) => sum + o.total, 0);

  receiptContent += `Total Orders: ${totalOrders}\n`;
  receiptContent += `Paid Orders: ${paidOrders.length}\n`;
  receiptContent += `Expected Revenue: ${currency(totalRevenue)}\n`;
  receiptContent += `Confirmed Revenue: ${currency(paidRevenue)}\n\n`;

  receiptContent += `DETAILED SALES:\n`;
  receiptContent += `-`.repeat(60) + `\n`;

  orders.forEach(order => {
    receiptContent += `Order ID: ${order.id}\n`;
    receiptContent += `Date: ${new Date(order.createdAt).toLocaleString()}\n`;
    receiptContent += `Customer: ${order.customer.name} (${order.customer.phone})\n`;
    receiptContent += `Status: ${order.paymentStatus || "pending"}\n`;
    receiptContent += `Items:\n`;

    order.items.forEach(item => {
      receiptContent += `  - ${item.productNumber} ${item.name}: ${item.qty} ${item.unit} @ ${currency(item.unitPrice)} = ${currency(item.lineTotal)}\n`;
    });

    receiptContent += `Total: ${currency(order.total)}\n\n`;
  });

  receiptContent += `-`.repeat(60) + `\n`;
  receiptContent += `END OF REPORT\n`;

  return receiptContent;
}

function generateCsvReport(orders, timeframeFilter) {
  const businessName = state.settings?.businessName || "Chewaz Bar & Restaurant";
  const rows = [];

  rows.push(`${businessName} - Sales Report`);
  rows.push(`Period: ${timeframeFilter} | Generated: ${new Date().toLocaleString()}`);
  rows.push('');
  rows.push('Date,Order ID,Waiter,Phone,Items,Total (KES),Status');

  orders.forEach(o => {
    const items = o.items.map(i => `${i.qty}x ${i.name} (${i.unit})`).join(' | ');
    const status = o.paymentStatus || 'pending';
    const row = [
      new Date(o.createdAt).toLocaleString(),
      o.id,
      o.customer.name,
      o.customer.phone,
      `"${items}"`,
      o.total,
      status
    ].join(',');
    rows.push(row);
  });

  rows.push('');
  const paid = orders.filter(o => o.paymentStatus === 'paid');
  const pending = orders.filter(o => !o.paymentStatus || o.paymentStatus === 'pending' || o.paymentStatus === 'pending_delivery');
  rows.push(`Total Orders,${orders.length}`);
  rows.push(`Paid Orders,${paid.length},KES ${paid.reduce((s,o)=>s+o.total,0)}`);
  rows.push(`Pending Orders,${pending.length},KES ${pending.reduce((s,o)=>s+o.total,0)}`);
  rows.push(`Grand Total,,KES ${orders.reduce((s,o)=>s+o.total,0)}`);

  return rows.join('\n');
}

function onDownloadReceipts() {
  const timeframeFilter = $("#orderTimeframeFilter").value;

  // Always include both paid AND pending in CSV
  const filtered = state.orders.filter(o => {
    const status = o.paymentStatus || 'pending';
    const includedStatuses = ['paid', 'pending', 'pending_delivery'];
    return includedStatuses.includes(status) && isWithinTimeframe(o.createdAt, timeframeFilter);
  });

  if (!filtered.length) {
    alert("No orders found for the selected period.");
    return;
  }

  const csv = generateCsvReport(filtered, timeframeFilter);
  const dateStr = timeframeFilter === "all" ? new Date().toISOString().split("T")[0] : `${timeframeFilter}_${new Date().toISOString().split("T")[0]}`;
  downloadTextFile(csv, `sales_report_${dateStr}.csv`);
}

function checkAdminPanelState() {
  const isLoggedIn = !!sessionStorage.getItem("adminPin");
  if (isLoggedIn) {
    if ($("#adminLoginPanel")) $("#adminLoginPanel").style.display = "none";
    if ($("#adminDashboardPanel")) $("#adminDashboardPanel").style.display = "block";
  } else {
    if ($("#adminLoginPanel")) $("#adminLoginPanel").style.display = "block";
    if ($("#adminDashboardPanel")) $("#adminDashboardPanel").style.display = "none";
  }
}

function initAgeGate() {
  const accepted = localStorage.getItem("raven_age_ok") === "1";
  const gate = $("#ageGate");

  if (accepted) gate.classList.add("hidden");

  $("#ageConfirmBtn").addEventListener("click", () => {
    localStorage.setItem("raven_age_ok", "1");
    gate.classList.add("hidden");
  });
}

async function main() {
  initAgeGate();

  if ($("#adminLoginForm")) $("#adminLoginForm").addEventListener("submit", onAdminLogin);
  if ($("#adminLogoutBtn")) {
    $("#adminLogoutBtn").addEventListener("click", () => {
      sessionStorage.removeItem("adminPin");
      checkAdminPanelState();
    });
  }
  checkAdminPanelState();

  await loadBasics();
  await loadCatalog(true);
  renderCart();

  $("#reloadCatalog").addEventListener("click", () => loadCatalog(true));
  $("#catalogSearch").addEventListener("input", applyCatalogFilters);
  $("#sortFilter").addEventListener("change", applyCatalogFilters);
  $("#checkoutForm").addEventListener("submit", onCheckout);
  if ($("#restockForm")) $("#restockForm").addEventListener("submit", onRestock);
  if ($("#pricingForm")) $("#pricingForm").addEventListener("submit", onPricing);
  $("#marketingForm").addEventListener("submit", onMarketing);
  $("#scanAddBtn").addEventListener("click", onScanAdd);

  $("#orderStatusFilter").addEventListener("change", renderOrders);
  $("#orderTimeframeFilter").addEventListener("change", renderOrders);
  $("#refreshOrders").addEventListener("click", refreshData);

  if ($("#posPushForm")) $("#posPushForm").addEventListener("submit", onPosPush);
  if ($("#downloadReceiptsBtn")) $("#downloadReceiptsBtn").addEventListener("click", onDownloadReceipts);
  if ($("#printReportBtn")) $("#printReportBtn").addEventListener("click", onPrintReport);
  if ($("#addProductForm")) $("#addProductForm").addEventListener("submit", onAddProduct);
  if ($("#editProductForm")) $("#editProductForm").addEventListener("submit", onSaveProduct);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  alert(err.message);
});
