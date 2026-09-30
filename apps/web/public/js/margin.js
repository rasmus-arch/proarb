// Marginalvarning för offert-/orderrader. Gränserna sätts i Inställningar
// (margin_warning_percent / margin_critical_percent) och exponeras via
// /settings/branding så att alla roller kan läsa dem.
import { api } from "./api.js";

let thresholds = { warning: 25, critical: 10 };
let loaded = null;

export function loadMarginThresholds() {
  loaded ??= api
    .get("/settings/branding")
    .then((b) => {
      thresholds = {
        warning: Number(b.margin_warning_percent ?? 25),
        critical: Number(b.margin_critical_percent ?? 10),
      };
    })
    .catch(() => {});
  return loaded;
}

// "critical" also covers selling below cost (negative margin), whatever
// the configured threshold is.
export function marginLevel(margin, total) {
  if (margin === null || margin === undefined) return "unknown";
  if (margin < 0) return "critical";
  if (!(total > 0)) return "ok";
  const percent = (margin / total) * 100;
  if (percent < thresholds.critical) return "critical";
  if (percent < thresholds.warning) return "warning";
  return "ok";
}

const LEVEL_CLASS = {
  unknown: "text-slate-400",
  ok: "text-slate-500",
  warning: "text-amber-700",
  critical: "text-red-600 font-medium",
};

export function renderMarginCell(cell, margin, total, money) {
  const level = marginLevel(margin, total);
  cell.className = `py-2 pr-3 text-right ${LEVEL_CLASS[level]}`;
  if (level === "unknown") {
    cell.innerHTML = `<span title="Inköpspris saknas">–</span>`;
    return level;
  }
  const percent = total > 0 ? ((margin / total) * 100).toFixed(0) : "0";
  const title =
    level === "critical"
      ? margin < 0
        ? "Under inköpspris"
        : `Under ${thresholds.critical} % marginal`
      : level === "warning"
        ? `Under ${thresholds.warning} % marginal`
        : "";
  cell.innerHTML = `<span title="${title}">${money(margin)}</span><div class="text-xs">${percent} %</div>`;
  return level;
}

export function marginCellHtml(margin, total, money) {
  const td = document.createElement("td");
  td.dataset.cell = "margin";
  renderMarginCell(td, margin, total, money);
  return td.outerHTML;
}

// Sammanfattning under totalsumman: hur många rader som ligger under gränsen.
export function marginSummaryText(levels) {
  const critical = levels.filter((l) => l === "critical").length;
  const warning = levels.filter((l) => l === "warning").length;
  if (critical)
    return {
      text: `${critical} ${critical === 1 ? "rad" : "rader"} under ${thresholds.critical} % marginal eller under inköpspris`,
      level: "critical",
    };
  if (warning)
    return { text: `${warning} ${warning === 1 ? "rad" : "rader"} under ${thresholds.warning} % marginal`, level: "warning" };
  return null;
}

export function getMarginThresholds() {
  return thresholds;
}
