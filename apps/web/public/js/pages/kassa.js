import { api } from "../api.js";

let session = null;
let selectedCustomer = null;
let paymentRows = [];

// key: variant_id -> { name, color, size, unitPrice, taxRatePercent, qty }
const cart = new Map();

const el = {
  sessionBar: document.getElementById("session-bar"),
  sessionInfo: document.getElementById("session-info"),
  closeSessionBtn: document.getElementById("close-session-btn"),
  openSessionCard: document.getElementById("open-session-card"),
  openSessionName: document.getElementById("open-session-name"),
  openSessionFloat: document.getElementById("open-session-float"),
  openSessionBtn: document.getElementById("open-session-btn"),
  posMain: document.getElementById("pos-main"),
  scanInput: document.getElementById("scan-input"),
  scanError: document.getElementById("scan-error"),
  customerSearch: document.getElementById("customer-search"),
  customerResults: document.getElementById("customer-results"),
  customerSelected: document.getElementById("customer-selected"),
  customerSelectedName: document.getElementById("customer-selected-name"),
  customerChangeBtn: document.getElementById("customer-change-btn"),
  cartRows: document.getElementById("cart-rows"),
  emptyCart: document.getElementById("empty-cart"),
  cartTotal: document.getElementById("cart-total"),
  cartMargin: document.getElementById("cart-margin"),
  payBtn: document.getElementById("pay-btn"),
  payDialog: document.getElementById("pay-dialog"),
  payTotal: document.getElementById("pay-total"),
  paymentRowsEl: document.getElementById("payment-rows"),
  addPaymentRowBtn: document.getElementById("add-payment-row-btn"),
  payRemaining: document.getElementById("pay-remaining"),
  payError: document.getElementById("pay-error"),
  cancelPayBtn: document.getElementById("cancel-pay-btn"),
  completeSaleBtn: document.getElementById("complete-sale-btn"),
  receiptDialog: document.getElementById("receipt-dialog"),
  receiptSaleNumber: document.getElementById("receipt-sale-number"),
  receiptLink: document.getElementById("receipt-link"),
  newSaleBtn: document.getElementById("new-sale-btn"),
  closeSessionDialog: document.getElementById("close-session-dialog"),
  closingFloatInput: document.getElementById("closing-float-input"),
  closeSessionForm: document.getElementById("close-session-form"),
  closeSessionResult: document.getElementById("close-session-result"),
  closeSessionSummary: document.getElementById("close-session-summary"),
  cancelCloseBtn: document.getElementById("cancel-close-btn"),
  confirmCloseBtn: document.getElementById("confirm-close-btn"),
  closeSessionDoneBtn: document.getElementById("close-session-done-btn"),
};

const PAYMENT_LABELS = { CASH: "Kontant", CARD: "Kort", SWISH: "Swish", INVOICE: "Faktura" };

function formatMoney(value) {
  return `${Number(value).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function cartTotals() {
  const items = [...cart.values()];
  const subtotal = items.reduce((sum, i) => sum + i.unitPrice * i.qty, 0);
  const vat = items.reduce((sum, i) => sum + i.unitPrice * i.qty * (i.taxRatePercent / 100), 0);
  return { subtotal, vat, total: subtotal + vat };
}

// null when the product has no cost price on file — margin is unknown,
// not zero.
function itemMargin(item) {
  if (item.costPrice === null || item.costPrice === undefined) return null;
  return (item.unitPrice - item.costPrice) * item.qty;
}

function marginLabel(margin) {
  return margin === null ? "–" : formatMoney(margin);
}

function renderCart() {
  const items = [...cart.entries()];
  el.emptyCart.classList.toggle("hidden", items.length > 0);

  el.cartRows.innerHTML = items
    .map(
      ([variantId, item]) => `
      <tr>
        <td class="py-2 pr-4 font-medium text-slate-900">${escapeHtml(item.name)}</td>
        <td class="py-2 pr-4">${escapeHtml([item.color, item.size].filter(Boolean).join(" / "))}</td>
        <td class="py-2 pr-4 text-right">${item.qty}</td>
        <td class="py-2 pr-4 text-right">${formatMoney(item.unitPrice)}</td>
        <td class="py-2 pr-4 text-right">${formatMoney(item.unitPrice * item.qty)}</td>
        <td class="py-2 pr-4 text-right text-slate-500">${marginLabel(itemMargin(item))}</td>
        <td class="py-2 pr-2"><button type="button" class="text-slate-400 hover:text-red-600" data-remove="${variantId}">✕</button></td>
      </tr>`
    )
    .join("");

  const { total } = cartTotals();
  const margins = items.map(([, item]) => itemMargin(item)).filter((m) => m !== null);
  const marginAmount = margins.reduce((sum, m) => sum + m, 0);

  el.cartTotal.textContent = formatMoney(total);
  el.cartMargin.textContent = marginLabel(marginAmount) + (margins.length < items.length && items.length > 0 ? " *" : "");
  el.payBtn.disabled = items.length === 0;
}

el.cartRows.addEventListener("click", (event) => {
  const id = event.target.dataset.remove;
  if (id === undefined) return;
  cart.delete(Number(id));
  renderCart();
});

async function handleScan(barcode) {
  el.scanError.classList.add("hidden");
  try {
    const variant = await api.get(`/products/by-barcode/${encodeURIComponent(barcode)}`);
    const unitPrice = Number(variant.price_override ?? variant.base_price);
    const existing = cart.get(variant.variant_id);
    if (existing) {
      existing.qty += 1;
    } else {
      cart.set(variant.variant_id, {
        name: variant.name,
        color: variant.color,
        size: variant.size,
        unitPrice,
        taxRatePercent: Number(variant.tax_rate_percent),
        costPrice: variant.cost_price === null || variant.cost_price === undefined ? null : Number(variant.cost_price),
        qty: 1,
      });
    }
    renderCart();
  } catch (err) {
    el.scanError.textContent = err.message;
    el.scanError.classList.remove("hidden");
  }
}

el.scanInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const barcode = el.scanInput.value.trim();
  el.scanInput.value = "";
  if (barcode) handleScan(barcode);
});

// --- Optional customer -----------------------------------------------

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
  selectedCustomer = { id: Number(button.dataset.id), name: button.dataset.name };
  el.customerSearch.value = "";
  el.customerResults.innerHTML = "";
  el.customerSearch.parentElement.classList.add("hidden");
  el.customerSelected.classList.remove("hidden");
  el.customerSelected.classList.add("flex");
  el.customerSelectedName.textContent = selectedCustomer.name;
});

el.customerChangeBtn.addEventListener("click", () => {
  selectedCustomer = null;
  el.customerSelected.classList.add("hidden");
  el.customerSelected.classList.remove("flex");
  el.customerSearch.parentElement.classList.remove("hidden");
});

// --- Payment dialog ----------------------------------------------------

function renderPaymentRows() {
  const { total } = cartTotals();
  const paid = paymentRows.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const remaining = Math.round((total - paid) * 100) / 100;

  el.paymentRowsEl.innerHTML = paymentRows
    .map(
      (p, index) => `
      <div class="flex items-center gap-2">
        <select class="input" data-field="method" data-index="${index}">
          ${Object.entries(PAYMENT_LABELS).map(([value, label]) => `<option value="${value}" ${p.method === value ? "selected" : ""}>${label}</option>`).join("")}
        </select>
        <input type="number" step="0.01" class="input" data-field="amount" data-index="${index}" value="${p.amount}" />
        <button type="button" class="text-slate-400 hover:text-red-600" data-remove-payment="${index}" ${paymentRows.length <= 1 ? "disabled" : ""}>✕</button>
      </div>`
    )
    .join("");

  el.payRemaining.textContent = formatMoney(remaining);
  el.payRemaining.className = `font-medium ${Math.abs(remaining) < 0.01 ? "text-green-700" : "text-red-600"}`;
  el.completeSaleBtn.disabled = Math.abs(remaining) >= 0.01;
}

el.paymentRowsEl.addEventListener("input", (event) => {
  const { field, index } = event.target.dataset;
  if (field === undefined) return;
  paymentRows[Number(index)][field] = field === "amount" ? Number(event.target.value) : event.target.value;
  renderPaymentRows();
});

el.paymentRowsEl.addEventListener("click", (event) => {
  const index = event.target.dataset.removePayment;
  if (index === undefined) return;
  paymentRows.splice(Number(index), 1);
  renderPaymentRows();
});

el.addPaymentRowBtn.addEventListener("click", () => {
  const { total } = cartTotals();
  const paid = paymentRows.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  paymentRows.push({ method: "CASH", amount: Math.max(0, Math.round((total - paid) * 100) / 100) });
  renderPaymentRows();
});

el.payBtn.addEventListener("click", () => {
  const { total } = cartTotals();
  el.payTotal.textContent = formatMoney(total);
  paymentRows = [{ method: "CARD", amount: Math.round(total * 100) / 100 }];
  el.payError.classList.add("hidden");
  renderPaymentRows();
  el.payDialog.showModal();
});

el.cancelPayBtn.addEventListener("click", () => el.payDialog.close());

el.completeSaleBtn.addEventListener("click", async () => {
  el.payError.classList.add("hidden");
  const payload = {
    sessionId: session.id,
    customerId: selectedCustomer?.id ?? null,
    lines: [...cart.entries()].map(([variantId, item]) => ({
      productVariantId: variantId,
      quantity: item.qty,
      unitPrice: item.unitPrice,
      discountPercent: 0,
    })),
    payments: paymentRows.map((p) => ({ method: p.method, amount: p.amount })),
  };

  try {
    const sale = await api.post("/pos/sales", payload);
    el.payDialog.close();
    cart.clear();
    selectedCustomer = null;
    el.customerSelected.classList.add("hidden");
    el.customerSelected.classList.remove("flex");
    el.customerSearch.parentElement.classList.remove("hidden");
    renderCart();

    el.receiptSaleNumber.textContent = sale.sale_number;
    el.receiptLink.href = `/api/pos/sales/${sale.id}/receipt`;
    el.receiptDialog.showModal();
  } catch (err) {
    el.payError.textContent = err.message;
    el.payError.classList.remove("hidden");
  }
});

el.newSaleBtn.addEventListener("click", () => {
  el.receiptDialog.close();
  el.scanInput.focus();
});

// --- Session gate --------------------------------------------------------

function showSessionUi(open) {
  el.openSessionCard.classList.toggle("hidden", open);
  el.posMain.classList.toggle("hidden", !open);
  el.sessionBar.classList.toggle("hidden", !open);
  el.sessionBar.classList.toggle("flex", open);
}

async function refreshSession() {
  session = await api.get("/pos/session");
  if (session) {
    el.sessionInfo.textContent = `${session.name} · öppnad ${new Date(session.opened_at).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })} av ${session.opened_by_name}`;
  }
  showSessionUi(Boolean(session));
}

el.openSessionBtn.addEventListener("click", async () => {
  await api.post("/pos/session/open", {
    name: el.openSessionName.value,
    openingFloat: Number(el.openSessionFloat.value) || 0,
  });
  await refreshSession();
});

el.closeSessionBtn.addEventListener("click", () => {
  el.closeSessionForm.classList.remove("hidden");
  el.closeSessionResult.classList.add("hidden");
  el.closingFloatInput.value = "";
  el.closeSessionDialog.showModal();
});

el.cancelCloseBtn.addEventListener("click", () => el.closeSessionDialog.close());

el.confirmCloseBtn.addEventListener("click", async () => {
  const result = await api.post(`/pos/session/${session.id}/close`, {
    closingFloat: Number(el.closingFloatInput.value) || 0,
  });

  const methodRows = Object.entries(result.totalsByMethod)
    .map(([method, amount]) => `<div class="flex justify-between"><dt>${PAYMENT_LABELS[method] ?? method}</dt><dd>${formatMoney(amount)}</dd></div>`)
    .join("");

  el.closeSessionSummary.innerHTML = `
    ${methodRows}
    <div class="flex justify-between border-t border-slate-200 pt-1 mt-1"><dt>Förväntat kontantbelopp</dt><dd>${formatMoney(result.expectedCash)}</dd></div>
    <div class="flex justify-between"><dt>Räknat belopp</dt><dd>${formatMoney(el.closingFloatInput.value)}</dd></div>
    <div class="flex justify-between font-semibold ${Math.abs(result.diff) < 0.01 ? "text-green-700" : "text-red-600"}"><dt>Differens</dt><dd>${formatMoney(result.diff)}</dd></div>
  `;

  el.closeSessionForm.classList.add("hidden");
  el.closeSessionResult.classList.remove("hidden");
});

el.closeSessionDoneBtn.addEventListener("click", () => {
  el.closeSessionDialog.close();
  refreshSession();
});

refreshSession();
