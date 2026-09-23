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
const inactiveSection = document.getElementById("inactive-customers-section");
const inactiveList = document.getElementById("inactive-customers-list");
const lowStockSection = document.getElementById("low-stock-section");
const lowStockList = document.getElementById("low-stock-list");
const greetingEyebrow = document.getElementById("greeting-eyebrow");
const todayDate = document.getElementById("today-date");
const kpiRevenue = document.getElementById("kpi-revenue");
const kpiQuotes = document.getElementById("kpi-quotes");
const kpiQuotesValue = document.getElementById("kpi-quotes-value");
const kpiReadyPickup = document.getElementById("kpi-ready-pickup");

function money(value) {
  return `${Number(value).toLocaleString("sv-SE", { maximumFractionDigits: 0 })} kr`;
}

// Tidpunktsbaserad hälsning + dagens datum — små detaljer som gör
// startsidan mindre av ett rent formulär, samma tanke som märkesfärgen
// i kundportalen (portal.js) fast här mot en inloggad medarbetare istället
// för en kund.
async function loadGreeting() {
  const hour = new Date().getHours();
  const greeting = hour < 10 ? "God morgon" : hour < 17 ? "Hej" : "God kväll";
  greetingEyebrow.textContent = greeting;
  todayDate.textContent = new Date().toLocaleDateString("sv-SE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const settings = await api.get("/settings/branding").catch(() => null);
  if (settings?.brand_color) {
    greetingEyebrow.style.color = settings.brand_color;
  }
}

async function loadKpis() {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);

  const [summary, pipeline, readyOrders] = await Promise.all([
    api.get(`/stats/summary?from=${firstOfMonth}&to=${today}`),
    api.get("/stats/open-quote-pipeline"),
    api.get("/orders?status=READY_FOR_PICKUP&pageSize=1"),
  ]);

  kpiRevenue.textContent = money(summary.revenue_ex_vat);
  kpiQuotes.textContent = String(pipeline.quote_count);
  kpiQuotesValue.textContent = pipeline.quote_count > 0 ? `Värde ${money(pipeline.total_value)}` : "";
  kpiReadyPickup.textContent = String(readyOrders.total);
}

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
        <span class="flex items-center gap-2">
          <span class="hidden text-xs text-red-600" data-reminder-error></span>
          <button type="button" class="btn-secondary" data-send-reminder="${q.id}">Skicka påminnelse</button>
        </span>
      </li>`
    )
    .join("");
}

// Skickar ett riktigt uppföljningsmejl till kunden (samma e-postmotor som
// "Maila offert till kund") — inte bara en intern flagga som tidigare.
// Ett misslyckat försök (t.ex. e-post inte konfigurerat ännu) visas inline
// och raden ligger kvar så det går att försöka igen; en lyckad påminnelse
// gör att offerten försvinner ur listan av sig själv (se
// listQuotesNeedingReminder på servern).
list.addEventListener("click", async (event) => {
  const id = event.target.dataset.sendReminder;
  if (id === undefined) return;
  const li = event.target.closest("li");
  const errorEl = li.querySelector("[data-reminder-error]");
  event.target.disabled = true;
  errorEl.classList.add("hidden");
  try {
    const result = await api.post(`/quotes/${id}/send-reminder`, {});
    if (result.sent) {
      loadReminders();
    } else {
      errorEl.textContent = `Kunde inte skicka: ${result.reason ?? "okänt fel"}`;
      errorEl.classList.remove("hidden");
      event.target.disabled = false;
    }
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove("hidden");
    event.target.disabled = false;
  }
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
          ${r.reference_contact_name ? `<span class="ml-2 text-xs text-slate-500">Hämtas ut av: ${escapeHtml(r.reference_contact_name)}</span>` : ""}
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

let inactiveMonths = 6;

async function loadInactiveCustomers() {
  const settings = await api.get("/settings/branding");
  inactiveMonths = settings.inactive_customer_months ?? 6;
  const { rows } = await api.get(`/customers/inactive?months=${inactiveMonths}`);
  inactiveSection.classList.toggle("hidden", rows.length === 0);
  inactiveList.innerHTML = rows
    .map(
      (c) => `
      <li class="flex items-center justify-between py-2 text-sm" data-customer-id="${c.id}">
        <div>
          <a href="/kund-editor.html?id=${c.id}" class="font-medium text-blue-700 underline">${escapeHtml(c.name)}</a>
          <span class="ml-2 text-xs text-slate-500">Senaste beställning ${new Date(c.last_order_at).toLocaleDateString("sv-SE")}</span>
        </div>
        <span class="flex items-center gap-2">
          <span class="hidden text-xs text-red-600" data-inactive-reminder-error></span>
          <button type="button" class="btn-secondary" data-send-inactive-reminder="${c.id}">Skicka påminnelse</button>
        </span>
      </li>`
    )
    .join("");
}

// Gör den passiva listan proaktiv — en riktig "dags att fylla på?"-mejl
// till kunden istället för att bara flagga den internt, samma
// "raden ligger kvar om det misslyckas, försvinner inte av sig själv om
// det lyckas"-mönster som offert-påminnelserna ovan (skillnaden är att en
// inaktiv kund inte har något event-baserat "redan påmind"-tillstånd att
// försvinna ur, så knappen går att klicka igen om man vill).
inactiveList.addEventListener("click", async (event) => {
  const id = event.target.dataset.sendInactiveReminder;
  if (id === undefined) return;
  const li = event.target.closest("li");
  const errorEl = li.querySelector("[data-inactive-reminder-error]");
  event.target.disabled = true;
  errorEl.classList.add("hidden");
  try {
    const result = await api.post(`/customers/${id}/send-inactive-reminder?months=${inactiveMonths}`, {});
    if (result.sent) {
      event.target.textContent = "Skickad!";
    } else {
      errorEl.textContent = `Kunde inte skicka: ${result.reason ?? "okänt fel"}`;
      errorEl.classList.remove("hidden");
      event.target.disabled = false;
    }
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove("hidden");
    event.target.disabled = false;
  }
});

async function loadLowStock() {
  const { rows, total } = await api.get("/inventory/stock-levels?lowStockOnly=true&pageSize=8");
  lowStockSection.classList.toggle("hidden", rows.length === 0);
  lowStockList.innerHTML = rows
    .map(
      (r) => `
      <li class="flex items-center justify-between py-2 text-sm">
        <div>
          <span class="font-medium text-slate-900">${escapeHtml(r.product_name)}</span>
          <span class="ml-2 text-slate-500">${escapeHtml([r.color, r.size].filter(Boolean).join(" / "))}</span>
        </div>
        <span class="text-xs text-amber-600">Saldo ${r.quantity_on_hand} / min ${r.reorder_point}</span>
      </li>`
    )
    .join("");
  if (total > rows.length) {
    lowStockList.innerHTML += `<li class="py-2 text-xs text-slate-500">+ ${total - rows.length} till — se Lager → Inköpsförslag.</li>`;
  }
}

loadGreeting();
loadKpis();
loadReminders();
loadPortalRequests();
loadInactiveCustomers();
loadLowStock();
