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
const todayDate = document.getElementById("today-date");
const kpiRevenue = document.getElementById("kpi-revenue");
const kpiQuotes = document.getElementById("kpi-quotes");
const kpiQuotesValue = document.getElementById("kpi-quotes-value");
const kpiReadyPickup = document.getElementById("kpi-ready-pickup");

function money(value) {
  return `${Number(value).toLocaleString("sv-SE", { maximumFractionDigits: 0 })} kr`;
}

function loadGreeting() {
  todayDate.textContent = new Date().toLocaleDateString("sv-SE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

// --- Försäljning senaste 90 dagarna (linjediagram) -------------------------
// Enskild serie -> en kulör (märkesfärgen), ingen legend (kortets titel
// säger vad som visas). Fyllda dagar utan försäljning (0 kr) från
// backend gör linjen sammanhängande. Se dataviz-principerna: 2px linje,
// ~10% opacitet på ytan, hårfina rutnätslinjer, hover-crosshair som
// snappar till närmaste punkt istället för att kräva pixelträff.
const salesChartSvg = document.getElementById("sales-chart");
const salesChartTooltip = document.getElementById("sales-chart-tooltip");
const CHART_W = 800;
const CHART_H = 220;
const CHART_PAD = { top: 16, right: 12, bottom: 24, left: 56 };

function niceCeil(value) {
  if (value <= 0) return 100;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function svgEl(tag, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

async function loadSalesChart() {
  const [{ points }, settings] = await Promise.all([
    api.get("/stats/daily-trend?days=90"),
    api.get("/settings/branding").catch(() => null),
  ]);
  renderSalesChart(points, settings?.brand_color || "#0f172a");
}

function renderSalesChart(points, accentColor) {
  salesChartSvg.innerHTML = "";
  if (points.length === 0) return;

  const plotW = CHART_W - CHART_PAD.left - CHART_PAD.right;
  const plotH = CHART_H - CHART_PAD.top - CHART_PAD.bottom;
  const values = points.map((p) => p.revenue_ex_vat);
  const maxV = niceCeil(Math.max(...values));

  const x = (i) => CHART_PAD.left + (points.length === 1 ? 0 : (i / (points.length - 1)) * plotW);
  const y = (v) => CHART_PAD.top + plotH - (v / maxV) * plotH;

  // Rutnätslinjer (hårfina, återhållsamma) + y-axeletiketter vid 0/halva/max.
  for (const frac of [0, 0.5, 1]) {
    const gy = CHART_PAD.top + plotH - frac * plotH;
    salesChartSvg.appendChild(
      svgEl("line", { x1: CHART_PAD.left, x2: CHART_W - CHART_PAD.right, y1: gy, y2: gy, stroke: "#e2e8f0", "stroke-width": 1 })
    );
    const label = svgEl("text", { x: CHART_PAD.left - 8, y: gy + 3, "text-anchor": "end", "font-size": 10, fill: "#94a3b8" });
    label.textContent = money(Math.round((maxV * frac) / 100) * 100);
    salesChartSvg.appendChild(label);
  }

  // X-axeletiketter: start, mitten, slut — inte en per dag (90 punkter).
  const labelIdxs = [0, Math.floor((points.length - 1) / 2), points.length - 1];
  for (const i of labelIdxs) {
    const label = svgEl("text", {
      x: x(i),
      y: CHART_H - 6,
      "text-anchor": i === 0 ? "start" : i === points.length - 1 ? "end" : "middle",
      "font-size": 10,
      fill: "#94a3b8",
    });
    label.textContent = new Date(points[i].date).toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
    salesChartSvg.appendChild(label);
  }

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.revenue_ex_vat).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${x(points.length - 1).toFixed(1)} ${CHART_PAD.top + plotH} L ${x(0).toFixed(1)} ${CHART_PAD.top + plotH} Z`;

  salesChartSvg.appendChild(svgEl("path", { d: areaPath, fill: accentColor, "fill-opacity": 0.1, stroke: "none" }));
  salesChartSvg.appendChild(svgEl("path", { d: linePath, fill: "none", stroke: accentColor, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));

  // Slutpunkten (idag) direkt-etiketteras, som en linjes värde-vid-änden.
  const lastIdx = points.length - 1;
  salesChartSvg.appendChild(
    svgEl("circle", { cx: x(lastIdx), cy: y(values[lastIdx]), r: 4, fill: accentColor, stroke: "#fff", "stroke-width": 2 })
  );

  // Crosshair (dold tills hover) + osynligt overlay som fångar hela
  // rityttan så pekaren bara behöver vara nära X-positionen, inte träffa
  // linjen pixelexakt.
  const crosshair = svgEl("line", {
    x1: 0, x2: 0, y1: CHART_PAD.top, y2: CHART_PAD.top + plotH,
    stroke: "#94a3b8", "stroke-width": 1, "stroke-dasharray": "3,3", visibility: "hidden",
  });
  const hoverDot = svgEl("circle", { r: 4, fill: accentColor, stroke: "#fff", "stroke-width": 2, visibility: "hidden" });
  salesChartSvg.appendChild(crosshair);
  salesChartSvg.appendChild(hoverDot);

  const overlay = svgEl("rect", {
    x: CHART_PAD.left, y: CHART_PAD.top, width: plotW, height: plotH, fill: "transparent",
  });
  salesChartSvg.appendChild(overlay);

  function showTooltip(clientX, clientY, index) {
    const p = points[index];
    crosshair.setAttribute("x1", x(index));
    crosshair.setAttribute("x2", x(index));
    crosshair.setAttribute("visibility", "visible");
    hoverDot.setAttribute("cx", x(index));
    hoverDot.setAttribute("cy", y(p.revenue_ex_vat));
    hoverDot.setAttribute("visibility", "visible");

    const dateLabel = new Date(p.date).toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short" });
    salesChartTooltip.innerHTML = "";
    const valueEl = document.createElement("div");
    valueEl.className = "font-semibold";
    valueEl.textContent = money(p.revenue_ex_vat);
    const dateEl = document.createElement("div");
    dateEl.className = "text-slate-300";
    dateEl.textContent = dateLabel;
    salesChartTooltip.append(valueEl, dateEl);

    const wrapRect = salesChartSvg.parentElement.getBoundingClientRect();
    const svgRect = salesChartSvg.getBoundingClientRect();
    const scaleX = svgRect.width / CHART_W;
    salesChartTooltip.style.left = `${(x(index) * scaleX) - (svgRect.left - wrapRect.left)}px`;
    salesChartTooltip.style.top = `${y(p.revenue_ex_vat) * (svgRect.height / CHART_H)}px`;
    salesChartTooltip.classList.remove("hidden");
  }

  function hideTooltip() {
    crosshair.setAttribute("visibility", "hidden");
    hoverDot.setAttribute("visibility", "hidden");
    salesChartTooltip.classList.add("hidden");
  }

  overlay.addEventListener("pointermove", (event) => {
    const rect = salesChartSvg.getBoundingClientRect();
    const scaleX = CHART_W / rect.width;
    const svgX = (event.clientX - rect.left) * scaleX;
    const index = Math.round(((svgX - CHART_PAD.left) / plotW) * (points.length - 1));
    const clamped = Math.max(0, Math.min(points.length - 1, index));
    showTooltip(event.clientX, event.clientY, clamped);
  });
  overlay.addEventListener("pointerleave", hideTooltip);
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
loadSalesChart();
loadKpis();
loadReminders();
loadPortalRequests();
loadInactiveCustomers();
loadLowStock();
