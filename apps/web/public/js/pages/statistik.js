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

async function loadAll() {
  await Promise.all([loadSummary(), loadTopProducts(), loadTopCategories(), loadTopCustomers(), loadPipeline()]);
}

el.from.addEventListener("change", loadAll);
el.to.addEventListener("change", loadAll);

loadAll();
