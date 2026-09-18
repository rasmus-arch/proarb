import { api } from "../api.js";

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function daysSince(dateString) {
  return Math.floor((Date.now() - new Date(dateString).getTime()) / (1000 * 60 * 60 * 24));
}

const section = document.getElementById("reminders-section");
const list = document.getElementById("reminders-list");
const requestsSection = document.getElementById("portal-requests-section");
const requestsList = document.getElementById("portal-requests-list");

async function loadReminders() {
  const { rows } = await api.get("/quotes/reminders");
  section.classList.toggle("hidden", rows.length === 0);
  list.innerHTML = rows
    .map(
      (q) => `
      <li class="flex items-center justify-between py-2 text-sm" data-quote-id="${q.id}">
        <div>
          <a href="/offert-editor.html?id=${q.id}" class="font-medium text-blue-700 underline">${escapeHtml(q.quote_number)}</a>
          <span class="ml-2 text-slate-600">${escapeHtml(q.customer_name)}</span>
          <span class="ml-2 text-xs text-slate-500">${daysSince(q.sent_at)} dagar sedan skickad</span>
        </div>
        <button type="button" class="btn-secondary" data-mark-sent="${q.id}">Markera skickad</button>
      </li>`
    )
    .join("");
}

list.addEventListener("click", async (event) => {
  const id = event.target.dataset.markSent;
  if (id === undefined) return;
  await api.post(`/quotes/${id}/reminder-sent`);
  loadReminders();
});

async function loadPortalRequests() {
  const { rows } = await api.get("/portal-requests?status=NEW");
  requestsSection.classList.toggle("hidden", rows.length === 0);
  requestsList.innerHTML = rows
    .map(
      (r) => `
      <li class="flex items-center justify-between py-2 text-sm" data-request-id="${r.id}">
        <div>
          <span class="font-medium text-slate-900">${escapeHtml(r.customer_name)}</span>
          ${r.requested_by_name ? `<span class="ml-2 text-slate-600">(${escapeHtml(r.requested_by_name)})</span>` : ""}
          <span class="ml-2 text-xs text-slate-500">${r.line_count} rad${r.line_count === 1 ? "" : "er"} · ${daysSince(r.created_at) === 0 ? "idag" : `${daysSince(r.created_at)} dagar sedan`}</span>
        </div>
        <span class="flex gap-2">
          <button type="button" class="btn-secondary" data-dismiss-request="${r.id}">Avfärda</button>
          <button type="button" class="btn" data-convert-request="${r.id}">Skapa order</button>
        </span>
      </li>`
    )
    .join("");
}

requestsList.addEventListener("click", async (event) => {
  const convertId = event.target.dataset.convertRequest;
  const dismissId = event.target.dataset.dismissRequest;
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

loadReminders();
loadPortalRequests();
