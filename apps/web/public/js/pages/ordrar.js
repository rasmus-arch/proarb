import { api } from "../api.js";
import { ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from "../order-status.js";
import { renderPager } from "../pagination.js";

const rowsEl = document.getElementById("order-rows");
const emptyStateEl = document.getElementById("empty-state");
const searchEl = document.getElementById("search");
const pagerEl = document.getElementById("pager");
const requestsSection = document.getElementById("portal-requests-section");
const requestsList = document.getElementById("portal-requests-list");
const statusTabs = document.getElementById("status-tabs");
const bulkBar = document.getElementById("bulk-bar");
const bulkCount = document.getElementById("bulk-count");
const bulkInvoiceBtn = document.getElementById("bulk-invoice-btn");
const bulkResult = document.getElementById("bulk-result");
const selectAll = document.getElementById("select-all");
const selectAllCell = document.getElementById("select-all-cell");

const STATUS_TABS = [
  { key: "", label: "Alla" },
  { key: "NEW", label: "Order" },
  { key: "READY_FOR_PICKUP", label: "Redo för utlämning" },
  { key: "DELIVERED", label: "Utlämnad, ej fakturerad" },
  { key: "INVOICED", label: "Fakturerad" },
  { key: "CANCELLED", label: "Avbruten" },
  { key: "UNPAID", label: "Obetalda" },
];
let currentStatus = new URLSearchParams(location.search).get("status") || "";
const selected = new Set();

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function formatMoney(value) {
  return `${Number(value).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
}

function renderRows(orders) {
  const selectable = currentStatus === "DELIVERED";
  selectAllCell.classList.toggle("hidden", !selectable);
  bulkBar.classList.toggle("hidden", !selectable);
  rowsEl.innerHTML = orders
    .map(
      (o) => `
      <tr class="cursor-pointer hover:bg-slate-50" data-order-id="${o.id}">
        ${selectable ? `<td class="w-8 py-2" data-select-cell><input type="checkbox" data-select="${o.id}" ${selected.has(o.id) ? "checked" : ""} /></td>` : ""}
        <td class="py-2 pr-4 font-medium text-slate-900">${escapeHtml(o.order_number)}</td>
        <td class="py-2 pr-4">${escapeHtml(o.customer_name)}</td>
        <td class="py-2 pr-4">
          <span class="rounded-full px-2 py-0.5 text-xs font-medium ${ORDER_STATUS_COLORS[o.status] ?? ""}">${ORDER_STATUS_LABELS[o.status] ?? o.status}</span>${
            o.paid_at ? ` <span class="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Betald</span>` : ""
          }
        </td>
        <td class="py-2 pr-4 text-slate-500">${new Date(o.created_at).toLocaleDateString("sv-SE")}${
          o.status === "DELIVERED" && o.delivered_at ? `<div class="text-xs">Utlämnad ${new Date(o.delivered_at).toLocaleDateString("sv-SE")}</div>` : ""
        }</td>
        <td class="py-2 pr-4 text-right">${formatMoney(o.total_amount)}</td>
        <td class="py-2 pr-4 text-right">
          <button type="button" class="link text-xs whitespace-nowrap" data-reorder="${o.id}">Beställ igen</button>
          ${o.status === "CANCELLED" ? `<button type="button" class="ml-3 text-xs text-slate-500 hover:text-red-600" data-delete="${o.id}" data-number="${escapeHtml(o.order_number)}">Ta bort</button>` : ""}
        </td>
      </tr>`
    )
    .join("");

  emptyStateEl.classList.toggle("hidden", orders.length > 0);
}

function updateBulkBar() {
  bulkCount.textContent = selected.size ? `${selected.size} markerade` : "";
  bulkInvoiceBtn.disabled = selected.size === 0;
  const boxes = [...rowsEl.querySelectorAll("[data-select]")];
  selectAll.checked = boxes.length > 0 && boxes.every((b) => b.checked);
}

rowsEl.addEventListener("click", async (event) => {
  if (event.target.closest("[data-select-cell]")) {
    const box = event.target.closest("[data-select-cell]").querySelector("[data-select]");
    if (event.target !== box) box.checked = !box.checked;
    const id = Number(box.dataset.select);
    if (box.checked) selected.add(id);
    else selected.delete(id);
    updateBulkBar();
    return;
  }
  const deleteBtn = event.target.closest("button[data-delete]");
  if (deleteBtn) {
    if (!confirm(`Ta bort order ${deleteBtn.dataset.number}? Det går inte att ångra.`)) return;
    try {
      await api.delete(`/orders/${deleteBtn.dataset.delete}`);
      deleteBtn.closest("tr").remove();
    } catch (err) {
      alert(err.message);
    }
    return;
  }
  const reorderBtn = event.target.closest("button[data-reorder]");
  if (reorderBtn) {
    // Reuses the same "duplicera" backend flow as the order editor's own
    // button — a fresh order (status NEW) with the same customer/rader,
    // just reachable straight from the list so staff don't need to open
    // the old order first to reorder something a customer wants again.
    const duplicate = await api.post(`/orders/${reorderBtn.dataset.reorder}/duplicate`, {});
    location.href = `/order-editor.html?id=${duplicate.id}`;
    return;
  }
  const row = event.target.closest("tr[data-order-id]");
  if (row) location.href = `/order-editor.html?id=${row.dataset.orderId}`;
});

const PAGE_SIZE = 25;
let currentPage = 1;
const customerId = new URLSearchParams(location.search).get("customerId") || "";

if (customerId) {
  api.get(`/customers/${customerId}`).then((customer) => {
    document.getElementById("customer-filter-name").textContent = `Kund: ${customer.name}`;
    document.getElementById("customer-filter").classList.remove("hidden");
  });
}

let searchTimer;
async function loadOrders(page = currentPage) {
  currentPage = page;
  const params = new URLSearchParams({ search: searchEl.value, status: currentStatus, customerId, page: currentPage, pageSize: PAGE_SIZE });
  const { rows, total } = await api.get(`/orders?${params}`);
  renderRows(rows);
  updateBulkBar();
  renderPager(pagerEl, { page: currentPage, pageSize: PAGE_SIZE, total, onChange: loadOrders });
}

async function loadStatusTabs() {
  const summary = await api.get(`/orders/status-summary?customerId=${customerId}`);
  statusTabs.innerHTML = STATUS_TABS.map((t) => {
    const count = t.key ? summary.counts[t.key] ?? 0 : summary.total;
    const attention = t.key === "DELIVERED" && count > 0;
    return `<button type="button" class="tab-btn" data-status-tab="${t.key}" aria-selected="${t.key === currentStatus}">
      ${t.label} <span class="ml-1 rounded px-1.5 py-0.5 text-xs ${attention ? "bg-accent-100 text-accent-700" : "bg-slate-100 text-slate-500"}">${count}</span>
    </button>`;
  }).join("");
}

statusTabs.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-status-tab]");
  if (!tab) return;
  currentStatus = tab.dataset.statusTab;
  selected.clear();
  bulkResult.classList.add("hidden");
  const url = new URL(location.href);
  if (currentStatus) url.searchParams.set("status", currentStatus);
  else url.searchParams.delete("status");
  history.replaceState(null, "", url);
  statusTabs.querySelectorAll("[data-status-tab]").forEach((b) => b.setAttribute("aria-selected", String(b === tab)));
  loadOrders(1);
});

selectAll.addEventListener("change", () => {
  rowsEl.querySelectorAll("[data-select]").forEach((box) => {
    box.checked = selectAll.checked;
    const id = Number(box.dataset.select);
    if (box.checked) selected.add(id);
    else selected.delete(id);
  });
  updateBulkBar();
});

bulkInvoiceBtn.addEventListener("click", async () => {
  if (!confirm(`Markera ${selected.size} order som fakturerade? Fakturorna skickas via Fortnox om det är kopplat.`)) return;
  bulkInvoiceBtn.disabled = true;
  const { results } = await api.post("/orders/bulk-invoice", { ids: [...selected] });
  const ok = results.filter((r) => r.ok);
  const notSent = ok.filter((r) => r.notification && r.notification.sent === false);
  const failed = results.filter((r) => !r.ok);
  bulkResult.innerHTML = `
    <p class="font-medium text-slate-900">${ok.length} ${ok.length === 1 ? "order" : "ordrar"} markerade som fakturerade.</p>
    ${notSent.length ? `<p class="mt-1 text-amber-700">Fakturan kunde inte skickas via Fortnox för ${notSent.map((r) => `${escapeHtml(r.order_number)} (${escapeHtml(r.notification.reason ?? "okänt fel")})`).join(", ")}.</p>` : ""}
    ${failed.length ? `<p class="mt-1 text-red-600">Misslyckades: ${failed.map((r) => `${escapeHtml(r.order_number ?? r.id)} (${escapeHtml(r.error)})`).join(", ")}.</p>` : ""}`;
  bulkResult.classList.remove("hidden");
  selected.clear();
  await Promise.all([loadStatusTabs(), loadOrders(1)]);
});

searchEl.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadOrders(1), 250);
});

function daysSince(dateString) {
  return Math.floor((Date.now() - new Date(dateString).getTime()) / (1000 * 60 * 60 * 24));
}

async function loadPortalRequests() {
  const { rows } = await api.get("/portal-requests?status=NEW");
  requestsSection.classList.toggle("hidden", rows.length === 0);
  requestsList.innerHTML = rows
    .map(
      (r) => `
      <li class="py-2 text-sm" data-request-id="${r.id}">
        <div class="flex items-center justify-between">
          <div>
            <span class="font-medium text-slate-900">${escapeHtml(r.customer_name)}</span>
            ${r.requested_by_name ? `<span class="ml-2 text-slate-600">(${escapeHtml(r.requested_by_name)})</span>` : ""}
            ${r.reference_contact_name ? `<span class="ml-2 text-xs text-slate-500">Hämtas ut av: ${escapeHtml(r.reference_contact_name)}</span>` : ""}
            <span class="ml-2 text-xs text-slate-500">${r.line_count} rad${r.line_count === 1 ? "" : "er"} · ${daysSince(r.created_at) === 0 ? "idag" : `${daysSince(r.created_at)} dagar sedan`}</span>
          </div>
          <span class="flex gap-2">
            <button type="button" class="btn-secondary" data-preview-request="${r.id}">Förhandsgranska</button>
            <button type="button" class="btn-secondary" data-dismiss-request="${r.id}">Avfärda</button>
            <button type="button" class="btn" data-convert-request="${r.id}">Skapa order</button>
          </span>
        </div>
        <div class="hidden mt-2 rounded-md bg-slate-50 p-2" data-preview-body="${r.id}"></div>
      </li>`
    )
    .join("");
}

function formatQty(value) {
  return Number(value).toLocaleString("sv-SE", { maximumFractionDigits: 2 });
}

requestsList.addEventListener("click", async (event) => {
  const previewId = event.target.dataset.previewRequest;
  const convertId = event.target.dataset.convertRequest;
  const dismissId = event.target.dataset.dismissRequest;

  if (previewId !== undefined) {
    const body = requestsList.querySelector(`[data-preview-body="${previewId}"]`);
    const isHidden = body.classList.contains("hidden");
    if (isHidden && !body.dataset.loaded) {
      const request = await api.get(`/portal-requests/${previewId}`);
      body.innerHTML = `
        <ul class="divide-y divide-slate-200">
          ${request.lines
            .map(
              (l) => `
            <li class="flex items-center justify-between py-1.5 text-xs">
              <span>${escapeHtml(l.product_name)}${l.color || l.size ? ` <span class="text-slate-500">(${[l.color, l.size].filter(Boolean).map(escapeHtml).join(" / ")})</span>` : ""}</span>
              <span class="text-slate-600">${formatQty(l.quantity)} st · ${formatMoney(
                Number(l.unit_price) * (1 - Number(l.discount_percent) / 100) - Number(l.discount_amount || 0)
              )}${l.print_price !== null && l.print_price !== undefined ? ` + tryck ${formatMoney(Number(l.print_price) * (1 - Number(l.print_discount_percent || 0) / 100))}` : ""}</span>
            </li>`
            )
            .join("")}
        </ul>`;
      body.dataset.loaded = "1";
    }
    body.classList.toggle("hidden", !isHidden);
    return;
  }
  if (convertId !== undefined) {
    const order = await api.post(`/portal-requests/${convertId}/convert`, {});
    location.href = `/order-editor.html?id=${order.id}`;
    return;
  }
  if (dismissId !== undefined) {
    if (!confirm("Avfärda beställningsförfrågan utan att skapa en order?")) return;
    await api.post(`/portal-requests/${dismissId}/dismiss`, {});
    loadPortalRequests();
  }
});

loadStatusTabs();
loadOrders();
loadPortalRequests();
