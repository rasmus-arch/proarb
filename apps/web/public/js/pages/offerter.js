import { api } from "../api.js";

const rowsEl = document.getElementById("quote-rows");
const emptyStateEl = document.getElementById("empty-state");
const searchEl = document.getElementById("search");
const statusEl = document.getElementById("status-filter");

const STATUS_LABELS = {
  DRAFT: "Utkast",
  SENT: "Skickad",
  VIEWED: "Visad",
  ACCEPTED: "Accepterad",
  DECLINED: "Avböjd",
  EXPIRED: "Utgången",
  CONVERTED: "Omvandlad till order",
};

const STATUS_COLORS = {
  DRAFT: "bg-slate-100 text-slate-700",
  SENT: "bg-blue-100 text-blue-700",
  VIEWED: "bg-indigo-100 text-indigo-700",
  ACCEPTED: "bg-green-100 text-green-700",
  DECLINED: "bg-red-100 text-red-700",
  EXPIRED: "bg-amber-100 text-amber-700",
  CONVERTED: "bg-slate-900 text-white",
};

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function formatMoney(value) {
  return `${Number(value).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
}

function renderRows(quotes) {
  rowsEl.innerHTML = quotes
    .map(
      (q) => `
      <tr class="cursor-pointer hover:bg-slate-50" onclick="location.href='/offert-editor.html?id=${q.id}'">
        <td class="py-2 pr-4 font-medium text-slate-900">${escapeHtml(q.quote_number)}</td>
        <td class="py-2 pr-4">${escapeHtml(q.customer_name)}</td>
        <td class="py-2 pr-4">
          <span class="rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[q.status] ?? ""}">${STATUS_LABELS[q.status] ?? q.status}</span>
        </td>
        <td class="py-2 pr-4 text-slate-500">${new Date(q.created_at).toLocaleDateString("sv-SE")}</td>
        <td class="py-2 pr-4 text-right">${formatMoney(q.total_amount)}</td>
      </tr>`
    )
    .join("");

  emptyStateEl.classList.toggle("hidden", quotes.length > 0);
}

let searchTimer;
async function loadQuotes() {
  const params = new URLSearchParams({ search: searchEl.value, status: statusEl.value });
  const { rows } = await api.get(`/quotes?${params}`);
  renderRows(rows);
}

searchEl.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadQuotes, 250);
});
statusEl.addEventListener("change", loadQuotes);

loadQuotes();
