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

loadReminders();
