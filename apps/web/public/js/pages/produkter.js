import { api } from "../api.js";

const rowsEl = document.getElementById("product-rows");
const emptyStateEl = document.getElementById("empty-state");
const searchEl = document.getElementById("search");

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function formatPrice(price) {
  if (price === null || price === undefined) return "";
  return Number(price).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderRows(products) {
  rowsEl.innerHTML = products
    .map(
      (p) => `
      <tr>
        <td class="py-2 pr-4 text-slate-500">${escapeHtml(p.article_number)}</td>
        <td class="py-2 pr-4 font-medium text-slate-900">${escapeHtml(p.name)}</td>
        <td class="py-2 pr-4">${escapeHtml(p.color)}</td>
        <td class="py-2 pr-4">${escapeHtml(p.size)}</td>
        <td class="py-2 pr-4">${escapeHtml(p.sku)}</td>
        <td class="py-2 pr-4">${escapeHtml(p.barcode)}</td>
        <td class="py-2 pr-4 text-right">${formatPrice(p.base_price)} kr</td>
      </tr>`
    )
    .join("");

  emptyStateEl.classList.toggle("hidden", products.length > 0);
}

let searchTimer;
async function loadProducts() {
  const { rows } = await api.get(`/products?search=${encodeURIComponent(searchEl.value)}`);
  renderRows(rows);
}

searchEl.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadProducts, 250);
});

loadProducts();
