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
          <button type="button" class="text-blue-700 underline text-xs" data-adjust="${r.variant_id}" data-warehouse="${r.warehouse_id}">Justera</button>
          <button type="button" class="ml-2 text-blue-700 underline text-xs" data-reorder="${r.variant_id}" data-warehouse="${r.warehouse_id}" data-point="${r.reorder_point ?? ""}" data-qty="${r.reorder_quantity ?? ""}">Min-saldo</button>
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
    <button type="button" class="text-xs text-blue-700 underline" data-decide="${kind}:${id}:ADJUST">Justera</button>
    <button type="button" class="ml-2 text-xs text-blue-700 underline" data-decide="${kind}:${id}:KEEP">Behåll</button>`;
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

async function loadSuggestions() {
  const { bySupplier } = await api.get("/inventory/purchase-suggestions");
  suggestionsEmpty.classList.toggle("hidden", bySupplier.length > 0);

  suggestionsContainer.innerHTML = bySupplier
    .map((group) => {
      const orderRows = group.order_driven
        .flatMap((g) =>
          g.lines.map(
            (l) => `
            <tr>
              <td class="py-1.5 pr-2">${escapeHtml(l.product_name)} <span class="text-slate-500">${escapeHtml([l.color, l.size].filter(Boolean).join(" / "))}</span></td>
              <td class="py-1.5 pr-2 text-slate-500">${escapeHtml(g.order_number)} (${escapeHtml(g.customer_name)})</td>
              <td class="py-1.5 pr-2 text-right">${l.suggested_qty}${l.forced ? ' <span class="text-xs text-amber-600">beställ ändå</span>' : ""}</td>
            </tr>`
          )
        )
        .join("");

      const restockRows = group.restock_driven
        .map(
          (r) => `
          <tr>
            <td class="py-1.5 pr-2">${escapeHtml(r.product_name)} <span class="text-slate-500">${escapeHtml([r.color, r.size].filter(Boolean).join(" / "))}</span></td>
            <td class="py-1.5 pr-2 text-slate-500">Saldo ${r.quantity_on_hand} / min ${r.reorder_point}</td>
            <td class="py-1.5 pr-2 text-right">${r.suggested_qty}</td>
          </tr>`
        )
        .join("");

      return `
        <div class="card">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-medium text-slate-900">${escapeHtml(group.supplier_name)}</h2>
            <button type="button" class="btn-secondary text-xs" data-create-po="${group.supplier_id}">Skapa inköpsorder</button>
          </div>
          ${
            orderRows
              ? `<h3 class="mt-3 text-xs font-medium uppercase text-slate-500">Från ordrar</h3>
                 <table class="mt-1 min-w-full text-sm"><tbody>${orderRows}</tbody></table>`
              : ""
          }
          ${
            restockRows
              ? `<h3 class="mt-3 text-xs font-medium uppercase text-slate-500">Under min-saldo</h3>
                 <table class="mt-1 min-w-full text-sm"><tbody>${restockRows}</tbody></table>`
              : ""
          }
        </div>`;
    })
    .join("");

  suggestionsContainer.dataset.groups = JSON.stringify(bySupplier);
}

suggestionsContainer.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-create-po]");
  if (!btn) return;
  const groups = JSON.parse(suggestionsContainer.dataset.groups || "[]");
  const group = groups.find((g) => String(g.supplier_id) === btn.dataset.createPo);
  if (!group) return;

  const lines = [
    ...group.order_driven.flatMap((g) =>
      g.lines.map((l) => ({
        product_variant_id: l.product_variant_id,
        product_name: l.product_name,
        color: l.color,
        size: l.size,
        sku: l.sku,
        quantity: l.suggested_qty,
        costPrice: 0,
      }))
    ),
    ...group.restock_driven.map((r) => ({
      product_variant_id: r.product_variant_id,
      product_name: r.product_name,
      color: r.color,
      size: r.size,
      sku: r.sku,
      quantity: r.suggested_qty,
      costPrice: 0,
    })),
  ];

  activateTab("inleverans");
  openNewPoDialog({ supplierId: group.supplier_id, lines });
});

activateTab("saldo");
