import { api } from "../api.js";
import { ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from "../order-status.js";

const rowsEl = document.getElementById("order-rows");
const emptyStateEl = document.getElementById("empty-state");
const searchEl = document.getElementById("search");

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
      <tr class="cursor-pointer hover:bg-slate-50" onclick="location.href='/order-editor.html?id=${o.id}'">
        <td class="py-2 pr-4 font-medium text-slate-900">${escapeHtml(o.order_number)}</td>
        <td class="py-2 pr-4">${escapeHtml(o.customer_name)}</td>
        <td class="py-2 pr-4">
          <span class="rounded-full px-2 py-0.5 text-xs font-medium ${ORDER_STATUS_COLORS[o.status] ?? ""}">${ORDER_STATUS_LABELS[o.status] ?? o.status}</span>
        </td>
        <td class="py-2 pr-4 text-slate-500">${new Date(o.created_at).toLocaleDateString("sv-SE")}</td>
        <td class="py-2 pr-4 text-right">${formatMoney(o.total_amount)}</td>
      </tr>`
    )
    .join("");

  emptyStateEl.classList.toggle("hidden", orders.length > 0);
}

let searchTimer;
async function loadOrders() {
  const { rows } = await api.get(`/orders?search=${encodeURIComponent(searchEl.value)}`);
  renderRows(rows);
}

searchEl.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadOrders, 250);
});

loadOrders();
