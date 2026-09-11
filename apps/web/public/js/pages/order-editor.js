import { api } from "../api.js";
import { ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from "../order-status.js";

const params = new URLSearchParams(location.search);
const orderId = params.get("id");

const state = {
  customerId: null,
  customerName: "",
  lines: [],
  contacts: [],
};

const el = {
  title: document.getElementById("page-title"),
  statusBadge: document.getElementById("status-badge"),
  actionButtons: document.getElementById("action-buttons"),
  customerPicker: document.getElementById("customer-picker"),
  customerSearch: document.getElementById("customer-search"),
  customerResults: document.getElementById("customer-results"),
  customerSelected: document.getElementById("customer-selected"),
  customerSelectedName: document.getElementById("customer-selected-name"),
  customerChangeBtn: document.getElementById("customer-change-btn"),
  referenceSelect: document.getElementById("reference-select"),
  deliveryMethod: document.getElementById("delivery-method"),
  lineSearchWrap: document.getElementById("line-search-wrap"),
  lineSearch: document.getElementById("line-search"),
  lineResults: document.getElementById("line-results"),
  lineRows: document.getElementById("line-rows"),
  linesEmpty: document.getElementById("lines-empty"),
  totalsSubtotal: document.getElementById("totals-subtotal"),
  totalsVat: document.getElementById("totals-vat"),
  totalsTotal: document.getElementById("totals-total"),
  formError: document.getElementById("form-error"),
  saveRow: document.getElementById("save-row"),
  saveBtn: document.getElementById("save-btn"),
  pickupSection: document.getElementById("pickup-section"),
  pickupContactSelect: document.getElementById("pickup-contact-select"),
  pickupNameInput: document.getElementById("pickup-name-input"),
  pickupError: document.getElementById("pickup-error"),
  pickupBtn: document.getElementById("pickup-btn"),
  historySection: document.getElementById("history-section"),
  historyList: document.getElementById("history-list"),
};

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function money(value) {
  return `${Number(value).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
}

function lineTotal(line) {
  return Number(line.quantity) * Number(line.unitPrice) * (1 - Number(line.discountPercent) / 100);
}

function renderTotals() {
  const subtotal = state.lines.reduce((sum, l) => sum + lineTotal(l), 0);
  const vat = state.lines.reduce((sum, l) => sum + lineTotal(l) * (Number(l.taxRatePercent) / 100), 0);
  el.totalsSubtotal.textContent = money(subtotal);
  el.totalsVat.textContent = money(vat);
  el.totalsTotal.textContent = money(subtotal + vat);
}

const isNewOrder = () => !orderId;

function renderLines() {
  el.linesEmpty.classList.toggle("hidden", state.lines.length > 0);

  el.lineRows.innerHTML = state.lines
    .map((line, index) => {
      const productCell = `<div class="font-medium text-slate-900">${escapeHtml(line.name)}</div><div class="text-xs text-slate-500">${escapeHtml(line.colorSize)}</div>`;

      if (!isNewOrder()) {
        return `
          <tr>
            <td class="py-2 pr-3">${productCell}</td>
            <td class="py-2 pr-3">${line.quantity}</td>
            <td class="py-2 pr-3">${money(line.unitPrice)}</td>
            <td class="py-2 pr-3">${line.discountPercent} %</td>
            <td class="py-2 pr-3 text-right">${money(lineTotal(line))}</td>
            <td></td>
          </tr>`;
      }

      return `
        <tr>
          <td class="py-2 pr-3">${productCell}</td>
          <td class="py-2 pr-3"><input type="number" min="0.01" step="1" class="input" data-field="quantity" data-index="${index}" value="${line.quantity}" /></td>
          <td class="py-2 pr-3"><input type="number" min="0" step="0.01" class="input" data-field="unitPrice" data-index="${index}" value="${line.unitPrice}" /></td>
          <td class="py-2 pr-3"><input type="number" min="0" max="100" step="1" class="input" data-field="discountPercent" data-index="${index}" value="${line.discountPercent}" /></td>
          <td class="py-2 pr-3 text-right">${money(lineTotal(line))}</td>
          <td><button type="button" class="text-slate-400 hover:text-red-600" data-remove="${index}">✕</button></td>
        </tr>`;
    })
    .join("");

  renderTotals();
}

el.lineRows.addEventListener("input", (event) => {
  const { field, index } = event.target.dataset;
  if (field === undefined) return;
  state.lines[Number(index)][field] = Number(event.target.value);
  renderTotals();
  const row = event.target.closest("tr");
  row.querySelector("td:nth-last-child(2)").textContent = money(lineTotal(state.lines[Number(index)]));
});

el.lineRows.addEventListener("click", (event) => {
  const index = event.target.dataset.remove;
  if (index === undefined) return;
  state.lines.splice(Number(index), 1);
  renderLines();
});

let lineSearchTimer;
el.lineSearch.addEventListener("input", () => {
  clearTimeout(lineSearchTimer);
  const q = el.lineSearch.value.trim();
  if (!q) {
    el.lineResults.innerHTML = "";
    return;
  }
  lineSearchTimer = setTimeout(async () => {
    const { rows } = await api.get(`/products/search?q=${encodeURIComponent(q)}`);
    el.lineResults.innerHTML = rows
      .map(
        (v) => `
        <button type="button" class="block w-full px-3 py-2 text-left hover:bg-slate-50" data-variant='${JSON.stringify(v).replace(/'/g, "&#39;")}'>
          <div class="font-medium text-slate-900">${escapeHtml(v.name)}</div>
          <div class="text-xs text-slate-500">${escapeHtml([v.color, v.size, v.sku].filter(Boolean).join(" · "))} — ${money(v.price_override ?? v.base_price)}</div>
        </button>`
      )
      .join("");
  }, 200);
});

el.lineResults.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-variant]");
  if (!button) return;
  const v = JSON.parse(button.dataset.variant);
  state.lines.push({
    productVariantId: v.variant_id,
    name: v.name,
    colorSize: [v.color, v.size, v.sku].filter(Boolean).join(" · "),
    quantity: 1,
    unitPrice: Number(v.price_override ?? v.base_price),
    discountPercent: 0,
    taxRatePercent: Number(v.tax_rate_percent),
  });
  el.lineSearch.value = "";
  el.lineResults.innerHTML = "";
  renderLines();
});

// --- Customer picker (shared pattern with offert-editor) -----------------

function selectCustomer(id, name) {
  state.customerId = id;
  state.customerName = name;
  el.customerPicker.classList.add("hidden");
  el.customerSelected.classList.remove("hidden");
  el.customerSelected.classList.add("flex");
  el.customerSelectedName.textContent = name;
  loadContacts(id);
}

async function loadContacts(customerId, selectedId) {
  const customer = await api.get(`/customers/${customerId}`);
  state.contacts = customer.contacts;
  el.referenceSelect.innerHTML =
    `<option value="">Ingen referens</option>` +
    customer.contacts
      .map((c) => `<option value="${c.id}" ${String(selectedId) === String(c.id) ? "selected" : ""}>${escapeHtml(c.name)}${c.can_pickup ? " (hämtbehörig)" : ""}</option>`)
      .join("");

  el.pickupContactSelect.innerHTML =
    `<option value="">— Välj —</option>` +
    customer.contacts
      .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}${c.can_pickup ? " (hämtbehörig)" : ""}</option>`)
      .join("");
}

let customerSearchTimer;
el.customerSearch.addEventListener("input", () => {
  clearTimeout(customerSearchTimer);
  const q = el.customerSearch.value.trim();
  if (!q) {
    el.customerResults.innerHTML = "";
    return;
  }
  customerSearchTimer = setTimeout(async () => {
    const { rows } = await api.get(`/customers?search=${encodeURIComponent(q)}`);
    el.customerResults.innerHTML = rows
      .map(
        (c) => `<button type="button" class="block w-full px-3 py-2 text-left hover:bg-slate-50" data-id="${c.id}" data-name="${escapeHtml(c.name)}">${escapeHtml(c.name)}</button>`
      )
      .join("");
  }, 200);
});

el.customerResults.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-id]");
  if (!button) return;
  selectCustomer(Number(button.dataset.id), button.dataset.name);
  el.customerSearch.value = "";
  el.customerResults.innerHTML = "";
});

el.customerChangeBtn.addEventListener("click", () => {
  el.customerSelected.classList.add("hidden");
  el.customerSelected.classList.remove("flex");
  el.customerPicker.classList.remove("hidden");
});

// --- Save (new orders only) ----------------------------------------------

el.saveBtn.addEventListener("click", async () => {
  el.formError.classList.add("hidden");
  if (!state.customerId) {
    el.formError.textContent = "Välj en kund först.";
    el.formError.classList.remove("hidden");
    return;
  }
  if (state.lines.length === 0) {
    el.formError.textContent = "Lägg till minst en rad.";
    el.formError.classList.remove("hidden");
    return;
  }

  const payload = {
    customerId: state.customerId,
    referenceContactId: el.referenceSelect.value || null,
    deliveryMethod: el.deliveryMethod.value,
    lines: state.lines.map((l) => ({
      productVariantId: l.productVariantId,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPercent: l.discountPercent,
    })),
  };

  try {
    const created = await api.post("/orders", payload);
    location.href = `/order-editor.html?id=${created.id}`;
  } catch (err) {
    el.formError.textContent = err.message;
    el.formError.classList.remove("hidden");
  }
});

// --- Status actions + pickup ----------------------------------------------

async function changeStatus(orderId, status) {
  await api.patch(`/orders/${orderId}/status`, { status });
  location.reload();
}

function renderActionButtons(order) {
  el.actionButtons.innerHTML = order.allowed_next_statuses
    .map((s) => `<button type="button" class="btn-secondary" data-status="${s}">${ORDER_STATUS_LABELS[s]}</button>`)
    .join("");
  el.actionButtons.querySelectorAll("button[data-status]").forEach((btn) => {
    btn.addEventListener("click", () => changeStatus(order.id, btn.dataset.status));
  });
}

el.pickupBtn.addEventListener("click", async () => {
  el.pickupError.classList.add("hidden");
  try {
    await api.post(`/orders/${orderId}/pickup`, {
      pickedUpByContactId: el.pickupContactSelect.value || null,
      pickedUpByName: el.pickupNameInput.value || null,
    });
    location.reload();
  } catch (err) {
    el.pickupError.textContent = err.message;
    el.pickupError.classList.remove("hidden");
  }
});

function applyReadOnlyState() {
  const editable = isNewOrder();
  el.lineSearchWrap.classList.toggle("hidden", !editable);
  el.saveRow.classList.toggle("hidden", !editable);
  el.customerChangeBtn.classList.toggle("hidden", !editable);
  el.referenceSelect.disabled = !editable;
  el.deliveryMethod.disabled = !editable;
}

async function init() {
  if (orderId) {
    const order = await api.get(`/orders/${orderId}`);
    state.lines = order.lines.map((l) => ({
      productVariantId: l.product_variant_id,
      name: l.product_name,
      colorSize: [l.color, l.size, l.sku].filter(Boolean).join(" · "),
      quantity: Number(l.quantity),
      unitPrice: Number(l.unit_price),
      discountPercent: Number(l.discount_percent),
      taxRatePercent: Number(l.tax_rate_percent),
    }));

    el.title.textContent = `Order ${order.order_number}`;
    el.statusBadge.textContent = ORDER_STATUS_LABELS[order.status] ?? order.status;
    el.statusBadge.className = `mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${ORDER_STATUS_COLORS[order.status] ?? ""}`;
    el.deliveryMethod.value = order.delivery_method;

    selectCustomer(order.customer_id, order.customer_name);
    await loadContacts(order.customer_id, order.reference_contact_id);

    renderActionButtons(order);
    el.pickupSection.classList.toggle("hidden", !order.can_pickup);

    if (order.pickups?.length > 0) {
      el.historySection.classList.remove("hidden");
      el.historyList.innerHTML = order.pickups
        .map(
          (p) =>
            `<li>${new Date(p.picked_up_at).toLocaleString("sv-SE")} – hämtat av ${escapeHtml(p.picked_up_by_contact_name ?? p.picked_up_by_name ?? "okänd")}</li>`
        )
        .join("");
    }
  }

  applyReadOnlyState();
  renderLines();
}

init();
