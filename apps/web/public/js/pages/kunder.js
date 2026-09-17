import { api } from "../api.js";
import { renderPager } from "../pagination.js";

const rowsEl = document.getElementById("customer-rows");
const emptyStateEl = document.getElementById("empty-state");
const searchEl = document.getElementById("search");
const pagerEl = document.getElementById("pager");
const dialogEl = document.getElementById("new-customer-dialog");
const formEl = document.getElementById("new-customer-form");
const formErrorEl = document.getElementById("form-error");

function renderRows(customers) {
  rowsEl.innerHTML = customers
    .map(
      (c) => `
      <tr class="cursor-pointer hover:bg-slate-50" onclick="location.href='/kund-editor.html?id=${c.id}'">
        <td class="py-2 pr-4 text-slate-500">${c.customer_number}</td>
        <td class="py-2 pr-4 font-medium text-slate-900">${escapeHtml(c.name)}</td>
        <td class="py-2 pr-4">${c.org_number ?? ""}</td>
        <td class="py-2 pr-4">${c.city ?? ""}</td>
        <td class="py-2 pr-4">${c.phone ?? ""}</td>
      </tr>`
    )
    .join("");

  emptyStateEl.classList.toggle("hidden", customers.length > 0);
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

const PAGE_SIZE = 50;
let currentPage = 1;

let searchTimer;
async function loadCustomers(page = currentPage) {
  currentPage = page;
  const params = new URLSearchParams({ search: searchEl.value, page: currentPage, pageSize: PAGE_SIZE });
  const { rows, total } = await api.get(`/customers?${params}`);
  renderRows(rows);
  renderPager(pagerEl, { page: currentPage, pageSize: PAGE_SIZE, total, onChange: loadCustomers });
}

searchEl.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadCustomers(1), 250);
});

document.getElementById("new-customer-btn").addEventListener("click", () => {
  formEl.reset();
  formErrorEl.classList.add("hidden");
  dialogEl.showModal();
});

document.getElementById("cancel-btn").addEventListener("click", () => dialogEl.close());

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(formEl).entries());

  try {
    await api.post("/customers", data);
    dialogEl.close();
    await loadCustomers();
  } catch (err) {
    formErrorEl.textContent = err.message;
    formErrorEl.classList.remove("hidden");
  }
});

loadCustomers();
