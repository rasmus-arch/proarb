import { api } from "../api.js";

const rowsEl = document.getElementById("supplier-rows");
const emptyEl = document.getElementById("supplier-empty");
const dialog = document.getElementById("supplier-dialog");
const form = document.getElementById("supplier-form");
const errorEl = document.getElementById("supplier-error");
const deleteBtn = document.getElementById("delete-supplier-btn");
let suppliers = [];
let editingId = null;

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function render() {
  emptyEl.classList.toggle("hidden", suppliers.length > 0);
  rowsEl.innerHTML = suppliers
    .map(
      (s) => `
      <tr class="cursor-pointer hover:bg-slate-50" data-id="${s.id}">
        <td class="py-2 pr-4 font-medium text-slate-900">${escapeHtml(s.name)}</td>
        <td class="py-2 pr-4 text-slate-600">
          ${s.email ? escapeHtml(s.email) : '<span class="text-amber-700">E-post saknas</span>'}
          ${s.contact_name || s.phone ? `<div class="text-xs text-slate-500">${escapeHtml([s.contact_name, s.phone].filter(Boolean).join(" · "))}</div>` : ""}
        </td>
        <td class="py-2 pr-4 text-slate-600">${escapeHtml(s.customer_number ?? "–")}</td>
        <td class="py-2 pr-4 text-right text-slate-600">${s.lead_time_days != null ? `${s.lead_time_days} dagar` : "–"}</td>
        <td class="py-2 pr-4 text-right">${s.product_count}</td>
        <td class="py-2 pr-4 text-right">${s.open_po_count}</td>
        <td class="py-2 text-right"><span class="link text-sm">Redigera</span></td>
      </tr>`
    )
    .join("");
}

async function load() {
  suppliers = (await api.get("/suppliers")).rows;
  render();
}

function open(supplier) {
  editingId = supplier?.id ?? null;
  form.reset();
  errorEl.classList.add("hidden");
  document.getElementById("supplier-dialog-title").textContent = supplier ? supplier.name : "Ny leverantör";
  if (supplier) {
    form.elements.name.value = supplier.name ?? "";
    form.elements.email.value = supplier.email ?? "";
    form.elements.phone.value = supplier.phone ?? "";
    form.elements.contactName.value = supplier.contact_name ?? "";
    form.elements.customerNumber.value = supplier.customer_number ?? "";
    form.elements.leadTimeDays.value = supplier.lead_time_days ?? "";
    form.elements.notes.value = supplier.notes ?? "";
  }
  deleteBtn.classList.toggle("hidden", !supplier || supplier.product_count > 0 || supplier.open_po_count > 0);
  dialog.showModal();
}

rowsEl.addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-id]");
  if (row) open(suppliers.find((s) => s.id === Number(row.dataset.id)));
});
document.getElementById("new-supplier-btn").addEventListener("click", () => open(null));
document.getElementById("cancel-supplier-btn").addEventListener("click", () => dialog.close());

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.classList.add("hidden");
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    if (editingId) await api.patch(`/suppliers/${editingId}`, data);
    else await api.post("/suppliers", data);
    dialog.close();
    await load();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove("hidden");
  }
});

deleteBtn.addEventListener("click", async () => {
  if (!editingId || !confirm("Ta bort leverantören?")) return;
  try {
    await api.delete(`/suppliers/${editingId}`);
    dialog.close();
    await load();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove("hidden");
  }
});

load();
