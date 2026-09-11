import { api } from "../api.js";

const PRINT_STATUS_LABELS = {
  WAITING: "Väntar",
  IN_PRODUCTION: "I produktion",
  READY: "Klar",
};

const PRINT_STATUS_COLORS = {
  WAITING: "bg-slate-100 text-slate-700",
  IN_PRODUCTION: "bg-amber-100 text-amber-800",
  READY: "bg-green-100 text-green-800",
};

// Mirrors PRINT_STATUS_TRANSITIONS in orders/service.js.
const NEXT_STATUS = {
  WAITING: "IN_PRODUCTION",
  IN_PRODUCTION: "READY",
  READY: null,
};

const NEXT_LABEL = {
  WAITING: "Starta produktion",
  IN_PRODUCTION: "Markera klar",
};

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

const rowsEl = document.getElementById("queue-rows");
const emptyEl = document.getElementById("queue-empty");
const tabButtons = [...document.querySelectorAll(".tab-btn")];

let currentStatus = "";

function renderRows(rows) {
  emptyEl.classList.toggle("hidden", rows.length > 0);
  rowsEl.innerHTML = rows
    .map((r) => {
      const next = NEXT_STATUS[r.print_status];
      const backLink =
        r.print_status === "READY"
          ? `<button type="button" class="text-xs text-blue-700 underline" data-order-line="${r.order_line_id}" data-status="IN_PRODUCTION">Backa</button>`
          : "";
      return `
        <tr>
          <td class="py-2 pr-3"><a class="text-blue-700 underline" href="/order-editor.html?id=${r.order_id}">${escapeHtml(r.order_number)}</a></td>
          <td class="py-2 pr-3">${escapeHtml(r.customer_name)}</td>
          <td class="py-2 pr-3">
            <div class="font-medium text-slate-900">${escapeHtml(r.product_name)}</div>
            <div class="text-xs text-slate-500">${escapeHtml([r.color, r.size, r.sku].filter(Boolean).join(" · "))}</div>
          </td>
          <td class="py-2 pr-3">
            <div>${escapeHtml(r.print_method_name)}</div>
            ${r.print_description ? `<div class="text-xs text-slate-500">${escapeHtml(r.print_description)}</div>` : ""}
          </td>
          <td class="py-2 pr-3 text-right">${r.quantity}</td>
          <td class="py-2 pr-3"><span class="rounded-full px-2 py-0.5 text-xs font-medium ${PRINT_STATUS_COLORS[r.print_status] ?? ""}">${PRINT_STATUS_LABELS[r.print_status] ?? r.print_status}</span></td>
          <td class="py-2 pr-3 text-right">
            ${next ? `<button type="button" class="btn-secondary" data-order-line="${r.order_line_id}" data-status="${next}">${NEXT_LABEL[r.print_status]}</button>` : ""}
            ${backLink}
          </td>
        </tr>`;
    })
    .join("");
}

async function load() {
  const query = currentStatus ? `?status=${encodeURIComponent(currentStatus)}` : "";
  const { rows } = await api.get(`/orders/print-queue${query}`);
  renderRows(rows);
}

function activateTab(status) {
  currentStatus = status;
  for (const btn of tabButtons) btn.setAttribute("aria-selected", String(btn.dataset.status === status));
  load();
}

tabButtons.forEach((btn) => btn.addEventListener("click", () => activateTab(btn.dataset.status)));

rowsEl.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-order-line]");
  if (!button) return;
  button.disabled = true;
  try {
    await api.patch(`/orders/lines/${button.dataset.orderLine}/print-status`, { status: button.dataset.status });
    await load();
  } catch (err) {
    alert(err.message);
    button.disabled = false;
  }
});

activateTab("");
