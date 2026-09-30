import { api } from "../api.js";
import { renderPager } from "../pagination.js";

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function money(value) {
  return `${Number(value).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
}

function variantLabel(v) {
  return [v.product_name, [v.color, v.size].filter(Boolean).join(" / "), v.sku].filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------

const tabButtons = [...document.querySelectorAll(".tab-btn")];
const tabPanels = Object.fromEntries(
  ["saldo", "inkopsordrar", "inleverans", "inventering", "inkopsforslag"].map((key) => [
    key,
    document.getElementById(`tab-${key}`),
  ])
);

function activateTab(key) {
  for (const btn of tabButtons) btn.setAttribute("aria-selected", String(btn.dataset.tab === key));
  for (const [k, el] of Object.entries(tabPanels)) el.classList.toggle("hidden", k !== key);
  if (key === "saldo") loadSaldo();
  if (key === "inkopsordrar") loadAllPurchaseOrders();
  if (key === "inleverans") loadPurchaseOrders();
  if (key === "inventering") loadStockCounts();
  if (key === "inkopsforslag") loadSuggestions();
}

tabButtons.forEach((btn) => btn.addEventListener("click", () => activateTab(btn.dataset.tab)));

// ---------------------------------------------------------------------
// Saldo
// ---------------------------------------------------------------------

const saldoSearch = document.getElementById("saldo-search");
const saldoLowOnly = document.getElementById("saldo-low-only");
const saldoRows = document.getElementById("saldo-rows");
const saldoEmpty = document.getElementById("saldo-empty");
const saldoPager = document.getElementById("saldo-pager");

const SALDO_PAGE_SIZE = 50;
let saldoPage = 1;

async function loadSaldo(page = saldoPage) {
  saldoPage = page;
  const params = new URLSearchParams({
    search: saldoSearch.value,
    lowStockOnly: String(saldoLowOnly.checked),
    page: saldoPage,
    pageSize: SALDO_PAGE_SIZE,
  });
  const { rows, total } = await api.get(`/inventory/stock-levels?${params}`);
  saldoEmpty.classList.toggle("hidden", rows.length > 0);
  renderPager(saldoPager, { page: saldoPage, pageSize: SALDO_PAGE_SIZE, total, onChange: loadSaldo });
  saldoRows.innerHTML = rows
    .map(
      (r) => `
      <tr>
        <td class="py-2 pr-3">
          <div class="font-medium text-slate-900">${escapeHtml(r.product_name)}</div>
          <div class="text-xs text-slate-500">${escapeHtml([r.color, r.size, r.sku].filter(Boolean).join(" · "))}</div>
        </td>
        <td class="py-2 pr-3 text-right ${r.reorder_point !== null && r.quantity_on_hand < r.reorder_point ? "font-semibold text-red-600" : ""}">${r.quantity_on_hand}</td>
        <td class="py-2 pr-3 text-right text-slate-500">${r.reorder_point ?? "–"}</td>
        <td class="py-2 pr-3 text-right text-slate-500">${r.reorder_quantity ?? "–"}</td>
        <td class="py-2 pr-2 text-right whitespace-nowrap">
          <button type="button" class="link text-xs" data-adjust="${r.variant_id}" data-warehouse="${r.warehouse_id}">Justera</button>
          <button type="button" class="link ml-2 text-xs" data-reorder="${r.variant_id}" data-warehouse="${r.warehouse_id}" data-point="${r.reorder_point ?? ""}" data-qty="${r.reorder_quantity ?? ""}">Min-saldo</button>
        </td>
      </tr>`
    )
    .join("");
}

saldoSearch.addEventListener("input", () => loadSaldo(1));
saldoLowOnly.addEventListener("change", () => loadSaldo(1));

const adjustDialog = document.getElementById("adjust-dialog");
let adjustTarget = null;
saldoRows.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-adjust]");
  if (!btn) return;
  adjustTarget = { variantId: btn.dataset.adjust, warehouseId: btn.dataset.warehouse };
  document.getElementById("adjust-quantity").value = "";
  document.getElementById("adjust-note").value = "";
  adjustDialog.showModal();
});
document.getElementById("cancel-adjust-btn").addEventListener("click", () => adjustDialog.close());
document.getElementById("save-adjust-btn").addEventListener("click", async () => {
  await api.post(`/inventory/stock-levels/${adjustTarget.variantId}/${adjustTarget.warehouseId}/adjust`, {
    newQuantity: Number(document.getElementById("adjust-quantity").value),
    note: document.getElementById("adjust-note").value || null,
  });
  adjustDialog.close();
  loadSaldo();
});

const reorderDialog = document.getElementById("reorder-dialog");
let reorderTarget = null;
saldoRows.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-reorder]");
  if (!btn) return;
  reorderTarget = { variantId: btn.dataset.reorder, warehouseId: btn.dataset.warehouse };
  document.getElementById("reorder-point").value = btn.dataset.point;
  document.getElementById("reorder-quantity").value = btn.dataset.qty;
  reorderDialog.showModal();
});
document.getElementById("cancel-reorder-btn").addEventListener("click", () => reorderDialog.close());
document.getElementById("save-reorder-btn").addEventListener("click", async () => {
  await api.patch(`/inventory/stock-levels/${reorderTarget.variantId}/${reorderTarget.warehouseId}/reorder`, {
    reorderPoint: document.getElementById("reorder-point").value || null,
    reorderQuantity: document.getElementById("reorder-quantity").value || null,
  });
  reorderDialog.close();
  loadSaldo();
});

// ---------------------------------------------------------------------
// Inköpsordrar / Inleverans (purchase orders)
// ---------------------------------------------------------------------

const POStatusLabels = {
  DRAFT: "Utkast",
  ORDERED: "Beställd",
  PARTIALLY_RECEIVED: "Delvis mottagen",
  RECEIVED: "Mottagen",
};
const LineStatusLabels = { BACKORDERED: "Restnoterad", CLOSED: "Borttagen" };
const LineStatusColors = {
  BACKORDERED: "bg-amber-100 text-amber-700",
  CLOSED: "bg-slate-200 text-slate-600",
};

function poRowHtml(po) {
  return `
    <tr class="cursor-pointer hover:bg-slate-50" data-po="${po.id}">
      <td class="py-2 pr-3 font-medium text-slate-900">${escapeHtml(po.supplier_name)}</td>
      <td class="py-2 pr-3">${POStatusLabels[po.status] ?? po.status}</td>
      <td class="py-2 pr-3 text-right">${po.total_received_qty} / ${po.total_qty}</td>
      <td class="py-2 pr-3 text-slate-500">${new Date(po.created_at).toLocaleDateString("sv-SE")}</td>
    </tr>`;
}

// --- Inköpsordrar: full overview, every status ---

const poAllRows = document.getElementById("po-all-rows");
const poAllEmpty = document.getElementById("po-all-empty");

async function loadAllPurchaseOrders() {
  const { rows } = await api.get("/inventory/purchase-orders");
  poAllEmpty.classList.toggle("hidden", rows.length > 0);
  poAllRows.innerHTML = rows.map(poRowHtml).join("");
}

poAllRows.addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-po]");
  if (!row) return;
  activateTab("inleverans");
  openPoDetail(Number(row.dataset.po));
});

// --- Inleverans: open orders + receiving ---

const poListView = document.getElementById("po-list-view");
const poDetailView = document.getElementById("po-detail-view");
const poRows = document.getElementById("po-rows");
const poEmpty = document.getElementById("po-empty");
let currentPoId = null;

async function loadPurchaseOrders() {
  const { rows } = await api.get("/inventory/purchase-orders");
  const open = rows.filter((po) => po.status !== "RECEIVED");
  poEmpty.classList.toggle("hidden", open.length > 0);
  poRows.innerHTML = open.map(poRowHtml).join("");
}

poRows.addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-po]");
  if (!row) return;
  openPoDetail(Number(row.dataset.po));
});

async function openPoDetail(id) {
  currentPoId = id;
  poListView.classList.add("hidden");
  poDetailView.classList.remove("hidden");
  await renderPoDetail();
}

function poLineRowHtml(l) {
  const received = Number(l.received_qty);
  const ordered = Number(l.quantity);
  const outstanding = Math.max(0, ordered - received);
  const done = received >= ordered || l.line_status === "CLOSED";

  const statusBadge = done
    ? l.line_status === "CLOSED"
      ? `<span class="rounded-full px-2 py-0.5 text-xs font-medium ${LineStatusColors.CLOSED}">${LineStatusLabels.CLOSED}</span>`
      : `<span class="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Mottagen</span>`
    : l.line_status === "BACKORDERED"
      ? `<span class="rounded-full px-2 py-0.5 text-xs font-medium ${LineStatusColors.BACKORDERED}">${LineStatusLabels.BACKORDERED}</span>`
      : `<span class="text-xs text-slate-400">Väntar</span>`;

  const receiveInput = done
    ? ""
    : `<input type="number" min="0" step="1" class="input w-20" data-receive-qty="${l.id}" value="${outstanding}" />`;

  const actionSelect = done
    ? ""
    : `<select class="input" data-receive-action="${l.id}">
        <option value="">—</option>
        <option value="BACKORDER" ${l.line_status === "BACKORDERED" ? "selected" : ""}>Restnoterad</option>
        <option value="REMOVE">Ta bort resten</option>
      </select>`;

  return `
    <tr>
      <td class="py-2 pr-3">${escapeHtml(variantLabel(l))}</td>
      <td class="py-2 pr-3 text-right">${ordered}</td>
      <td class="py-2 pr-3 text-right">${received}</td>
      <td class="py-2 pr-3 text-right">${receiveInput}</td>
      <td class="py-2 pr-3">${actionSelect}</td>
      <td class="py-2 pr-3">${statusBadge}</td>
    </tr>`;
}

async function renderPoDetail() {
  const po = await api.get(`/inventory/purchase-orders/${currentPoId}`);
  document.getElementById("po-detail-title").textContent = `Inköpsorder – ${po.supplier_name}`;
  document.getElementById("po-detail-status").textContent = POStatusLabels[po.status] ?? po.status;
  document.getElementById("po-line-rows").innerHTML = po.lines.map(poLineRowHtml).join("");
  document.getElementById("po-submit-receiving-btn").classList.toggle("hidden", po.status === "RECEIVED");
}

document.getElementById("po-back-btn").addEventListener("click", () => {
  poDetailView.classList.add("hidden");
  poListView.classList.remove("hidden");
  loadPurchaseOrders();
});

const poScanInput = document.getElementById("po-scan-input");
const poScanError = document.getElementById("po-scan-error");
poScanInput.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter") return;
  const barcode = poScanInput.value.trim();
  poScanInput.value = "";
  if (!barcode) return;
  poScanError.classList.add("hidden");
  try {
    await api.post(`/inventory/purchase-orders/${currentPoId}/receive`, { barcode, quantity: 1, warehouseId: 1 });
    await renderPoDetail();
  } catch (err) {
    poScanError.textContent = err.message;
    poScanError.classList.remove("hidden");
  }
});

const poReceiveError = document.getElementById("po-receive-error");
document.getElementById("po-submit-receiving-btn").addEventListener("click", async () => {
  poReceiveError.classList.add("hidden");
  const lines = [...document.querySelectorAll("[data-receive-qty]")]
    .map((input) => {
      const lineId = input.dataset.receiveQty;
      const receivedQty = Number(input.value) || 0;
      const action = document.querySelector(`[data-receive-action="${lineId}"]`)?.value || undefined;
      return { lineId, receivedQty, action };
    })
    .filter((l) => l.receivedQty > 0 || l.action);

  if (lines.length === 0) return;

  try {
    await api.post(`/inventory/purchase-orders/${currentPoId}/submit-receiving`, { lines, warehouseId: 1 });
    await renderPoDetail();
  } catch (err) {
    poReceiveError.textContent = err.message;
    poReceiveError.classList.remove("hidden");
  }
});

// --- New PO dialog ---

const newPoDialog = document.getElementById("new-po-dialog");
const poSupplierSelect = document.getElementById("po-supplier-select");
const poLineSearch = document.getElementById("po-line-search");
const poLineResults = document.getElementById("po-line-results");
const poNewLineRows = document.getElementById("po-new-line-rows");
const poFormError = document.getElementById("po-form-error");
let newPoLines = [];

async function openNewPoDialog(prefill) {
  poFormError.classList.add("hidden");
  newPoLines = prefill?.lines ?? [];
  const { rows: suppliers } = await api.get("/suppliers");
  poSupplierSelect.innerHTML = suppliers.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
  if (prefill?.supplierId) poSupplierSelect.value = String(prefill.supplierId);
  renderNewPoLines();
  newPoDialog.showModal();
}

function renderNewPoLines() {
  poNewLineRows.innerHTML = newPoLines
    .map(
      (l, index) => `
      <tr>
        <td class="py-1.5 pr-2">${escapeHtml(variantLabel(l))}</td>
        <td class="py-1.5 pr-2"><input type="number" min="1" step="1" class="input" data-field="quantity" data-index="${index}" value="${l.quantity}" /></td>
        <td class="py-1.5 pr-2"><input type="number" min="0" step="0.01" class="input" data-field="costPrice" data-index="${index}" value="${l.costPrice}" /></td>
        <td><button type="button" class="text-slate-400 hover:text-red-600" data-remove="${index}">✕</button></td>
      </tr>`
    )
    .join("");
}

poNewLineRows.addEventListener("input", (event) => {
  const { field, index } = event.target.dataset;
  if (field === undefined) return;
  newPoLines[Number(index)][field] = Number(event.target.value);
});
poNewLineRows.addEventListener("click", (event) => {
  const index = event.target.dataset.remove;
  if (index === undefined) return;
  newPoLines.splice(Number(index), 1);
  renderNewPoLines();
});

document.getElementById("new-po-btn").addEventListener("click", () => openNewPoDialog());
document.getElementById("cancel-po-btn").addEventListener("click", () => newPoDialog.close());

let poLineSearchTimer;
poLineSearch.addEventListener("input", () => {
  clearTimeout(poLineSearchTimer);
  const q = poLineSearch.value.trim();
  if (!q) {
    poLineResults.innerHTML = "";
    return;
  }
  poLineSearchTimer = setTimeout(async () => {
    const { rows } = await api.get(`/products/search?q=${encodeURIComponent(q)}`);
    poLineResults.innerHTML = rows
      .map(
        (v) => `
        <button type="button" class="block w-full px-3 py-2 text-left hover:bg-slate-50" data-variant='${JSON.stringify(v).replace(/'/g, "&#39;")}'>
          <div class="font-medium text-slate-900">${escapeHtml(v.name)}</div>
          <div class="text-xs text-slate-500">${escapeHtml([v.color, v.size, v.sku].filter(Boolean).join(" · "))}</div>
        </button>`
      )
      .join("");
  }, 200);
});

poLineResults.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-variant]");
  if (!button) return;
  const v = JSON.parse(button.dataset.variant);
  newPoLines.push({
    variant_id: v.variant_id,
    product_variant_id: v.variant_id,
    product_name: v.name,
    color: v.color,
    size: v.size,
    sku: v.sku,
    quantity: 1,
    costPrice: Number(v.cost_price ?? 0),
  });
  poLineSearch.value = "";
  poLineResults.innerHTML = "";
  renderNewPoLines();
});

document.getElementById("create-po-btn").addEventListener("click", async () => {
  poFormError.classList.add("hidden");
  if (newPoLines.length === 0) {
    poFormError.textContent = "Lägg till minst en rad.";
    poFormError.classList.remove("hidden");
    return;
  }
  try {
    await api.post("/inventory/purchase-orders", {
      supplierId: Number(poSupplierSelect.value),
      lines: newPoLines.map((l) => ({
        productVariantId: l.product_variant_id ?? l.variant_id,
        quantity: l.quantity,
        costPrice: l.costPrice,
      })),
    });
    newPoDialog.close();
    loadPurchaseOrders();
  } catch (err) {
    poFormError.textContent = err.message;
    poFormError.classList.remove("hidden");
  }
});

// ---------------------------------------------------------------------
// Inventering (stock counts)
// ---------------------------------------------------------------------

const countListView = document.getElementById("count-list-view");
const countDetailView = document.getElementById("count-detail-view");
const countRows = document.getElementById("count-rows");
const countEmpty = document.getElementById("count-empty");
let currentCountId = null;

async function loadStockCounts() {
  const { rows } = await api.get("/inventory/stock-counts");
  countEmpty.classList.toggle("hidden", rows.length > 0);
  countRows.innerHTML = rows
    .map(
      (c) => `
      <tr class="cursor-pointer hover:bg-slate-50" data-count="${c.id}">
        <td class="py-2 pr-3">${c.status === "IN_PROGRESS" ? "Pågår" : "Avslutad"}</td>
        <td class="py-2 pr-3 text-slate-500">${new Date(c.started_at).toLocaleString("sv-SE")}</td>
        <td class="py-2 pr-3 text-slate-500">${escapeHtml(c.started_by_name ?? "")}</td>
      </tr>`
    )
    .join("");
}

document.getElementById("new-count-btn").addEventListener("click", async () => {
  const created = await api.post("/inventory/stock-counts", {});
  openCountDetail(created.id);
});

countRows.addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-count]");
  if (!row) return;
  openCountDetail(Number(row.dataset.count));
});

async function openCountDetail(id) {
  currentCountId = id;
  countListView.classList.add("hidden");
  countDetailView.classList.remove("hidden");
  await renderCountDetail();
}

document.getElementById("count-back-btn").addEventListener("click", () => {
  countDetailView.classList.add("hidden");
  countListView.classList.remove("hidden");
  loadStockCounts();
});

function decisionButtons(kind, id, decision) {
  if (decision !== "PENDING") {
    return `<span class="text-xs text-slate-500">${decision === "ADJUST" ? "Justerad" : "Behållen"}</span>`;
  }
  return `
    <button type="button" class="link text-xs" data-decide="${kind}:${id}:ADJUST">Justera</button>
    <button type="button" class="link ml-2 text-xs" data-decide="${kind}:${id}:KEEP">Behåll</button>`;
}

async function renderCountDetail() {
  const count = await api.get(`/inventory/stock-counts/${currentCountId}`);
  const inProgress = count.status === "IN_PROGRESS";

  document.getElementById("count-detail-title").textContent = "Inventering";
  document.getElementById("count-detail-status").textContent = inProgress ? "Pågår" : "Avslutad";
  document.getElementById("count-detail-status").className = `rounded-full px-2 py-0.5 text-xs font-medium ${inProgress ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`;
  document.getElementById("count-scan-area").classList.toggle("hidden", !inProgress);

  const mismatchLines = count.lines.filter((l) => Number(l.counted_qty) !== Number(l.expected_qty));
  const matchLines = count.lines.filter((l) => Number(l.counted_qty) === Number(l.expected_qty));

  document.getElementById("count-scanned-rows").innerHTML = [...mismatchLines, ...matchLines]
    .map(
      (l) => `
      <tr>
        <td class="py-2 pr-3">${escapeHtml(variantLabel(l))}</td>
        <td class="py-2 pr-3 text-right ${Number(l.counted_qty) !== Number(l.expected_qty) ? "font-semibold text-red-600" : ""}">${l.counted_qty}</td>
        <td class="py-2 pr-3 text-right text-slate-500">${l.expected_qty}</td>
        <td class="py-2 pr-3">${Number(l.counted_qty) === Number(l.expected_qty) ? '<span class="text-xs text-slate-400">Stämmer</span>' : decisionButtons("line", l.id, l.decision)}</td>
      </tr>`
    )
    .join("");

  document.getElementById("count-missing-rows").innerHTML = count.missing
    .map(
      (m) => `
      <tr>
        <td class="py-2 pr-3">${escapeHtml(variantLabel(m))}</td>
        <td class="py-2 pr-3 text-right font-semibold text-red-600">${m.expected_qty}</td>
        <td class="py-2 pr-3">${decisionButtons("missing", m.product_variant_id, m.decision)}</td>
      </tr>`
    )
    .join("");

  const noDiscrepancies = mismatchLines.length === 0 && count.missing.length === 0;
  document.getElementById("count-clean").classList.toggle("hidden", !noDiscrepancies);
  document.getElementById("decide-all-adjust-btn").classList.toggle("hidden", noDiscrepancies || !inProgress);
  document.getElementById("decide-all-keep-btn").classList.toggle("hidden", noDiscrepancies || !inProgress);
  document.getElementById("complete-count-btn").classList.toggle("hidden", !inProgress);
}

document.getElementById("count-scanned-rows").addEventListener("click", handleDecideClick);
document.getElementById("count-missing-rows").addEventListener("click", handleDecideClick);

async function handleDecideClick(event) {
  const btn = event.target.closest("[data-decide]");
  if (!btn) return;
  const [kind, id, decision] = btn.dataset.decide.split(":");
  if (kind === "line") {
    await api.post(`/inventory/stock-counts/${currentCountId}/lines/${id}/decide`, { decision });
  } else {
    await api.post(`/inventory/stock-counts/${currentCountId}/missing/${id}/decide`, { decision });
  }
  renderCountDetail();
}

const countScanInput = document.getElementById("count-scan-input");
const countScanError = document.getElementById("count-scan-error");
countScanInput.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter") return;
  const barcode = countScanInput.value.trim();
  countScanInput.value = "";
  if (!barcode) return;
  countScanError.classList.add("hidden");
  try {
    await api.post(`/inventory/stock-counts/${currentCountId}/scan`, { barcode, quantity: 1 });
    renderCountDetail();
  } catch (err) {
    countScanError.textContent = err.message;
    countScanError.classList.remove("hidden");
  }
});

const countManualSearch = document.getElementById("count-manual-search");
const countManualResults = document.getElementById("count-manual-results");
let countManualTimer;
countManualSearch.addEventListener("input", () => {
  clearTimeout(countManualTimer);
  const q = countManualSearch.value.trim();
  if (!q) {
    countManualResults.innerHTML = "";
    return;
  }
  countManualTimer = setTimeout(async () => {
    const { rows } = await api.get(`/products/search?q=${encodeURIComponent(q)}`);
    countManualResults.innerHTML = rows
      .map(
        (v) => `<button type="button" class="block w-full px-3 py-2 text-left hover:bg-slate-50" data-variant-id="${v.variant_id}">${escapeHtml(v.name)} — ${escapeHtml([v.color, v.size].filter(Boolean).join(" / "))}</button>`
      )
      .join("");
  }, 200);
});
countManualResults.addEventListener("click", async (event) => {
  const btn = event.target.closest("button[data-variant-id]");
  if (!btn) return;
  await api.post(`/inventory/stock-counts/${currentCountId}/lines`, {
    productVariantId: Number(btn.dataset.variantId),
    quantity: 1,
  });
  countManualSearch.value = "";
  countManualResults.innerHTML = "";
  renderCountDetail();
});

document.getElementById("decide-all-adjust-btn").addEventListener("click", async () => {
  await api.post(`/inventory/stock-counts/${currentCountId}/decide-all`, { decision: "ADJUST" });
  renderCountDetail();
});
document.getElementById("decide-all-keep-btn").addEventListener("click", async () => {
  await api.post(`/inventory/stock-counts/${currentCountId}/decide-all`, { decision: "KEEP" });
  renderCountDetail();
});

const completeError = document.getElementById("complete-error");
document.getElementById("complete-count-btn").addEventListener("click", async () => {
  completeError.classList.add("hidden");
  try {
    await api.post(`/inventory/stock-counts/${currentCountId}/complete`, {});
    renderCountDetail();
  } catch (err) {
    completeError.textContent = err.message;
    completeError.classList.remove("hidden");
  }
});

// ---------------------------------------------------------------------
// Inköpsförslag
// ---------------------------------------------------------------------

const suggestionsContainer = document.getElementById("suggestions-container");
const suggestionsEmpty = document.getElementById("suggestions-empty");
const suggestionsSummary = document.getElementById("suggestions-summary");
let suggestionGroups = [];
let supplierOptions = null;

function reasonChips(line) {
  return line.reasons
    .map((r) => {
      if (r.type === "restock") {
        return `<span class="chip">Min-saldo ${r.quantity_on_hand}/${r.reorder_point}</span>`;
      }
      return `<span class="chip" title="${escapeHtml(r.customer_name)}">${escapeHtml(r.order_number)} · ${r.quantity} st</span>`;
    })
    .join("");
}

function groupTotal(group, card) {
  let total = 0;
  let missingPrice = false;
  group.lines.forEach((l, i) => {
    const checked = card ? card.querySelector(`[data-pick="${i}"]`).checked : true;
    if (!checked) return;
    const qty = card ? Number(card.querySelector(`[data-qty="${i}"]`).value) || 0 : l.suggested_qty;
    if (l.cost_price === null) missingPrice = true;
    total += qty * (l.cost_price ?? 0);
  });
  return { total, missingPrice };
}

function suggestionCardHtml(group, index) {
  const noSupplier = group.supplier_id === 0;
  const { total, missingPrice } = groupTotal(group);
  const rows = group.lines
    .map(
      (l, i) => `
      <tr>
        <td class="w-8 py-2 pl-1"><input type="checkbox" data-pick="${i}" checked class="rounded border-slate-300" /></td>
        <td class="py-2 pr-3">
          <div class="font-medium text-slate-900">${escapeHtml(l.product_name)}</div>
          <div class="text-xs text-slate-500">${escapeHtml([[l.color, l.size].filter(Boolean).join(" / "), l.supplier_sku ? `Lev.art ${l.supplier_sku}` : l.sku].filter(Boolean).join(" · "))}</div>
        </td>
        <td class="py-2 pr-3"><div class="flex flex-wrap gap-1">${reasonChips(l)}</div></td>
        <td class="num py-2 pr-4 text-slate-500">${l.stock_on_hand}${l.already_on_order_qty > 0 ? `<div class="text-xs">+${l.already_on_order_qty} beställt</div>` : ""}</td>
        <td class="py-2 pr-3"><input type="number" min="0" step="1" value="${l.suggested_qty}" data-qty="${i}" class="input num w-20" /></td>
        <td class="num py-2 pr-1 text-slate-500">${l.cost_price === null ? "–" : money(l.cost_price)}</td>
      </tr>`
    )
    .join("");

  const supplierPicker = noSupplier
    ? `<select data-supplier-select class="input w-56"><option value="">Välj leverantör…</option>${(supplierOptions ?? [])
        .map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`)
        .join("")}</select>`
    : "";

  return `
    <section class="card p-0" data-group="${index}">
      <header class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 class="text-base font-semibold text-slate-900">${noSupplier ? "Saknar leverantör" : escapeHtml(group.supplier_name)}</h2>
          <p class="text-xs text-slate-500">
            ${group.lines.length} ${group.lines.length === 1 ? "rad" : "rader"} ·
            <span data-group-total>${money(total)}${missingPrice ? " + rader utan inpris" : ""}</span>
          </p>
        </div>
        <div class="flex items-center gap-2">
          ${supplierPicker}
          <button type="button" class="btn" data-create-po>Skapa inköpsorder</button>
        </div>
      </header>
      ${noSupplier ? `<p class="border-b border-slate-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">Välj leverantör för just den här ordern — eller sätt leverantör på produkten så hamnar den rätt nästa gång.</p>` : ""}
      <div class="overflow-x-auto px-4">
        <table class="min-w-full text-sm">
          <thead>
            <tr class="th-row">
              <th class="w-8 py-2"></th><th class="py-2 pr-3">Produkt</th><th class="py-2 pr-3">Orsak</th><th class="py-2 pr-4 text-right">I lager</th><th class="py-2 pr-3">Antal</th><th class="py-2 pr-1 text-right">Inpris</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">${rows}</tbody>
        </table>
      </div>
      <p class="hidden px-4 pb-3 text-sm text-red-600" data-group-error></p>
    </section>`;
}

async function loadSuggestions() {
  const { bySupplier } = await api.get("/inventory/purchase-suggestions");
  suggestionGroups = bySupplier;
  if (bySupplier.some((g) => g.supplier_id === 0) && !supplierOptions) {
    supplierOptions = (await api.get("/suppliers")).rows;
  }
  suggestionsEmpty.classList.toggle("hidden", bySupplier.length > 0);
  const lineCount = bySupplier.reduce((n, g) => n + g.lines.length, 0);
  const total = bySupplier.reduce((sum, g) => sum + groupTotal(g).total, 0);
  suggestionsSummary.textContent = bySupplier.length
    ? `${lineCount} ${lineCount === 1 ? "rad" : "rader"} att köpa in · ca ${money(total)}`
    : "";
  suggestionsContainer.innerHTML = bySupplier.map(suggestionCardHtml).join("");
}

suggestionsContainer.addEventListener("input", (event) => {
  const card = event.target.closest("[data-group]");
  if (!card) return;
  const group = suggestionGroups[Number(card.dataset.group)];
  const { total, missingPrice } = groupTotal(group, card);
  card.querySelector("[data-group-total]").textContent = `${money(total)}${missingPrice ? " + rader utan inpris" : ""}`;
});
suggestionsContainer.addEventListener("change", (event) => {
  if (event.target.matches("[data-pick]")) event.target.dispatchEvent(new Event("input", { bubbles: true }));
});

suggestionsContainer.addEventListener("click", async (event) => {
  const btn = event.target.closest("[data-create-po]");
  if (!btn) return;
  const card = btn.closest("[data-group]");
  const group = suggestionGroups[Number(card.dataset.group)];
  const errorEl = card.querySelector("[data-group-error]");
  errorEl.classList.add("hidden");

  const supplierId = group.supplier_id || Number(card.querySelector("[data-supplier-select]")?.value);
  const lines = group.lines
    .map((l, i) => ({
      productVariantId: l.product_variant_id,
      quantity: Number(card.querySelector(`[data-qty="${i}"]`).value) || 0,
      costPrice: l.cost_price ?? 0,
      picked: card.querySelector(`[data-pick="${i}"]`).checked,
    }))
    .filter((l) => l.picked && l.quantity > 0)
    .map(({ picked, ...l }) => l);

  const fail = (message) => {
    errorEl.textContent = message;
    errorEl.classList.remove("hidden");
  };
  if (!supplierId) return fail("Välj en leverantör först.");
  if (lines.length === 0) return fail("Välj minst en rad med antal.");

  btn.disabled = true;
  try {
    const po = await api.post("/inventory/purchase-orders", { supplierId, lines });
    card.outerHTML = `
      <section class="card flex items-center justify-between gap-3">
        <p class="text-sm text-slate-700">Inköpsorder skapad hos <strong>${escapeHtml(po.supplier_name ?? group.supplier_name ?? "")}</strong> — ${lines.length} ${lines.length === 1 ? "rad" : "rader"}.</p>
        <button type="button" class="btn-secondary" data-open-po="${po.id}">Visa inköpsorder</button>
      </section>`;
  } catch (err) {
    btn.disabled = false;
    fail(err.message);
  }
});

suggestionsContainer.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-open-po]");
  if (!btn) return;
  activateTab("inleverans");
  openPoDetail(Number(btn.dataset.openPo));
});

activateTab("saldo");
