import { api } from "../api.js";
import { ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from "../order-status.js";
import { renderPager } from "../pagination.js";

const rowsEl = document.getElementById("order-rows");
const emptyStateEl = document.getElementById("empty-state");
const searchEl = document.getElementById("search");
const pagerEl = document.getElementById("pager");
const requestsSection = document.getElementById("portal-requests-section");
const requestsList = document.getElementById("portal-requests-list");

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function formatMoney(value) {
  return `${Number(value).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
}

function renderRows(orders) {
  rowsEl.innerHTML = orders
    .map(
      (o) => `
      <tr class="cursor-pointer hover:bg-slate-50" data-order-id="${o.id}">
        <td class="py-2 pr-4 font-medium text-slate-900">${escapeHtml(o.order_number)}</td>
        <td class="py-2 pr-4">${escapeHtml(o.customer_name)}</td>
        <td class="py-2 pr-4">
          <span class="rounded-full px-2 py-0.5 text-xs font-medium ${ORDER_STATUS_COLORS[o.status] ?? ""}">${ORDER_STATUS_LABELS[o.status] ?? o.status}</span>
        </td>
        <td class="py-2 pr-4 text-slate-500">${new Date(o.created_at).toLocaleDateString("sv-SE")}</td>
        <td class="py-2 pr-4 text-right">${formatMoney(o.total_amount)}</td>
        <td class="py-2 pr-4 text-right">
          <button type="button" class="text-blue-700 underline text-xs whitespace-nowrap" data-reorder="${o.id}">Beställ igen</button>
        </td>
      </tr>`
    )
    .join("");

  emptyStateEl.classList.toggle("hidden", orders.length > 0);
}

rowsEl.addEventListener("click", async (event) => {
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

let searchTimer;
async function loadOrders(page = currentPage) {
  currentPage = page;
  const params = new URLSearchParams({ search: searchEl.value, page: currentPage, pageSize: PAGE_SIZE });
  const { rows, total } = await api.get(`/orders?${params}`);
  renderRows(rows);
  renderPager(pagerEl, { page: currentPage, pageSize: PAGE_SIZE, total, onChange: loadOrders });
}

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
              <span class="text-slate-600">${formatQty(l.quantity)} st · ${formatMoney(l.unit_price)}</span>
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

loadOrders();
loadPortalRequests();
