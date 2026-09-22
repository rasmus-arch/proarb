import { api } from "../api.js";

const el = {
  from: document.getElementById("range-from"),
  to: document.getElementById("range-to"),
  summaryRevenue: document.getElementById("summary-revenue"),
  summaryMargin: document.getElementById("summary-margin"),
  summaryMarginPercent: document.getElementById("summary-margin-percent"),
  summaryIncompleteNote: document.getElementById("summary-incomplete-note"),
  topProductsRows: document.getElementById("top-products-rows"),
  topCategoriesRows: document.getElementById("top-categories-rows"),
  topCustomersRows: document.getElementById("top-customers-rows"),
  pipelineCount: document.getElementById("pipeline-count"),
  pipelineValue: document.getElementById("pipeline-value"),
  pipelineOldest: document.getElementById("pipeline-oldest"),
  pipelineRows: document.getElementById("pipeline-rows"),
  pipelineEmpty: document.getElementById("pipeline-empty"),
  trendHeaderRow: document.getElementById("trend-header-row"),
  trendRows: document.getElementById("trend-rows"),
  trendEmpty: document.getElementById("trend-empty"),
};

const QUOTE_STATUS_LABELS = { SENT: "Skickad", VIEWED: "Visad" };

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function money(value) {
  return `${Number(value).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
}

function marginLabel(value) {
  return value === null ? "–" : money(value);
}

function rangeParams() {
  const params = new URLSearchParams();
  if (el.from.value) params.set("from", el.from.value);
  if (el.to.value) params.set("to", el.to.value);
  return params.toString();
}

async function loadSummary() {
  const summary = await api.get(`/stats/summary?${rangeParams()}`);
  el.from.value = summary.range.from;
  el.to.value = summary.range.to;
  el.summaryRevenue.textContent = money(summary.revenue_ex_vat);
  el.summaryMargin.textContent = money(summary.margin_amount);
  el.summaryMarginPercent.textContent = `${summary.margin_percent.toFixed(1)} %`;
  el.summaryIncompleteNote.classList.toggle("hidden", !summary.margin_incomplete);
}

async function loadTopProducts() {
  const rows = await api.get(`/stats/top-products?${rangeParams()}`);
  el.topProductsRows.innerHTML =
    rows
      .map(
        (r) => `
      <tr>
        <td class="py-1.5 pr-2 text-slate-900">${escapeHtml(r.name)}</td>
        <td class="py-1.5 pr-2 text-right">${r.total_qty}</td>
        <td class="py-1.5 pr-2 text-right">${money(r.revenue_ex_vat)}</td>
        <td class="py-1.5 text-right text-slate-500">${marginLabel(r.margin_amount)}</td>
      </tr>`
      )
      .join("") || `<tr><td colspan="4" class="py-3 text-center text-slate-500">Ingen försäljning i perioden.</td></tr>`;
}

async function loadTopCategories() {
  const rows = await api.get(`/stats/top-categories?${rangeParams()}`);
  el.topCategoriesRows.innerHTML =
    rows
      .map(
        (r) => `
      <tr>
        <td class="py-1.5 pr-2 text-slate-900">${escapeHtml(r.name)}</td>
        <td class="py-1.5 pr-2 text-right">${r.total_qty}</td>
        <td class="py-1.5 pr-2 text-right">${money(r.revenue_ex_vat)}</td>
        <td class="py-1.5 text-right text-slate-500">${marginLabel(r.margin_amount)}</td>
      </tr>`
      )
      .join("") || `<tr><td colspan="4" class="py-3 text-center text-slate-500">Ingen försäljning i perioden.</td></tr>`;
}

async function loadTopCustomers() {
  const rows = await api.get(`/stats/top-customers?${rangeParams()}`);
  el.topCustomersRows.innerHTML =
    rows
      .map(
        (r) => `
      <tr>
        <td class="py-1.5 pr-2 text-slate-900">${escapeHtml(r.name)}</td>
        <td class="py-1.5 pr-2 text-right">${money(r.revenue_ex_vat)}</td>
        <td class="py-1.5 text-right text-slate-500">${marginLabel(r.margin_amount)}</td>
      </tr>`
      )
      .join("") || `<tr><td colspan="3" class="py-3 text-center text-slate-500">Ingen försäljning i perioden.</td></tr>`;
}

async function loadPipeline() {
  const pipeline = await api.get("/stats/open-quote-pipeline");
  el.pipelineCount.textContent = String(pipeline.quote_count);
  el.pipelineValue.textContent = money(pipeline.total_value);
  el.pipelineOldest.textContent = pipeline.quote_count > 0 ? `${pipeline.oldest_days_open} dagar` : "–";

  el.pipelineEmpty.classList.toggle("hidden", pipeline.quotes.length > 0);
  el.pipelineRows.innerHTML = pipeline.quotes
    .map(
      (q) => `
      <tr>
        <td class="py-1.5 pr-3"><a href="/offert-editor.html?id=${q.id}" class="text-blue-700 underline">${escapeHtml(q.quote_number)}</a></td>
        <td class="py-1.5 pr-3 text-slate-900">${escapeHtml(q.customer_name)}</td>
        <td class="py-1.5 pr-3 text-slate-600">${QUOTE_STATUS_LABELS[q.status] ?? q.status}</td>
        <td class="py-1.5 pr-3 text-right">${money(q.total_value)}</td>
        <td class="py-1.5 text-right text-slate-500">${q.days_open}</td>
      </tr>`
    )
    .join("");
}

const TREND_TOP_CATEGORIES = 5;
const MONTH_LABEL = new Intl.DateTimeFormat("sv-SE", { month: "short", year: "2-digit" });

// Pivoterar de platta (månad, kategori, omsättning)-raderna till en
// tabell: en rad per månad, en kolumn per topp-kategori (resten slås ihop
// till "Övrigt") — enklast möjliga v1 av säsongstrenden, se
// stats/service.js getMonthlyCategoryTrend för det skriftliga förslaget
// om vidareutveckling (årsjämförelse, säsongsindex m.m.).
async function loadTrend() {
  const { rows } = await api.get("/stats/monthly-trend?months=12");
  el.trendEmpty.classList.toggle("hidden", rows.length > 0);
  if (rows.length === 0) {
    el.trendHeaderRow.innerHTML = "";
    el.trendRows.innerHTML = "";
    return;
  }

  const revenueByCategory = new Map();
  for (const r of rows) {
    revenueByCategory.set(r.category_name, (revenueByCategory.get(r.category_name) ?? 0) + r.revenue_ex_vat);
  }
  const topCategories = [...revenueByCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TREND_TOP_CATEGORIES)
    .map(([name]) => name);
  const hasOther = revenueByCategory.size > topCategories.length;

  const months = [...new Set(rows.map((r) => r.month))].sort();
  const cell = new Map(); // "month|column" -> revenue
  for (const r of rows) {
    const column = topCategories.includes(r.category_name) ? r.category_name : "Övrigt";
    const key = `${r.month}|${column}`;
    cell.set(key, (cell.get(key) ?? 0) + r.revenue_ex_vat);
  }

  const columns = hasOther ? [...topCategories, "Övrigt"] : topCategories;

  el.trendHeaderRow.innerHTML =
    `<th class="py-1.5 pr-2 font-medium">Månad</th>` +
    columns.map((c) => `<th class="py-1.5 pr-2 font-medium text-right">${escapeHtml(c)}</th>`).join("") +
    `<th class="py-1.5 font-medium text-right">Totalt</th>`;

  el.trendRows.innerHTML = months
    .map((month) => {
      const [y, m] = month.split("-");
      const label = MONTH_LABEL.format(new Date(Number(y), Number(m) - 1, 1));
      const values = columns.map((c) => cell.get(`${month}|${c}`) ?? 0);
      const total = values.reduce((sum, v) => sum + v, 0);
      return `<tr>
        <td class="py-1.5 pr-2 text-slate-900">${label}</td>
        ${values.map((v) => `<td class="py-1.5 pr-2 text-right text-slate-600">${v > 0 ? money(v) : "–"}</td>`).join("")}
        <td class="py-1.5 text-right font-medium text-slate-900">${money(total)}</td>
      </tr>`;
    })
    .join("");
}

async function loadAll() {
  await Promise.all([loadSummary(), loadTopProducts(), loadTopCategories(), loadTopCustomers(), loadPipeline()]);
}

loadTrend();

el.from.addEventListener("change", loadAll);
el.to.addEventListener("change", loadAll);

loadAll();
