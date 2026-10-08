// Lagerhistorik för en artikel (Lager → Saldo → Historik): saldot över tid
// som en stegkurva, sålt antal per månad som staplar och en tabell med de
// senaste rörelserna. En serie per diagram → en färg (märkesfärgen), ingen
// legend; samma hårfina rutnät och hover-tooltip som försäljningsgrafen på
// Översikt. Två mått med olika skala = två diagram, aldrig två y-axlar.
import { api } from "./api.js";

const W = 640;
const H = 180;
const PAD = { top: 14, right: 12, bottom: 24, left: 40 };
const GRID = "#e4e1da";
const AXIS_TEXT = "#a5a095";

const MOVEMENT_LABELS = {
  PURCHASE_IN: "Inleverans",
  SALE_OUT: "Försäljning",
  ADJUSTMENT: "Justering/inventering",
  TRANSFER: "Flytt",
  RETURN: "Retur",
  RESERVATION: "Reservation",
};

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function svgEl(tag, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function niceCeil(value) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

let dialog = null;
let accent = null;

function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.className = "w-full max-w-3xl rounded-lg p-0 backdrop:bg-slate-900/40";
  dialog.innerHTML = `
    <div class="card m-0">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h2 id="sh-title" class="text-lg font-semibold tracking-tight text-slate-900"></h2>
          <p id="sh-sub" class="mt-0.5 text-sm text-slate-500"></p>
        </div>
        <button type="button" data-close class="text-slate-400 hover:text-slate-900" aria-label="Stäng">✕</button>
      </div>
      <h3 class="mt-4 text-sm font-medium text-slate-900">Saldo senaste 12 månaderna</h3>
      <div class="relative mt-1">
        <svg id="sh-level" viewBox="0 0 ${W} ${H}" class="w-full" style="height:${H}px" preserveAspectRatio="none" role="img"></svg>
        <div id="sh-level-tip" class="pointer-events-none absolute hidden rounded-md bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-md" style="transform: translate(-50%, calc(-100% - 8px));"></div>
      </div>
      <h3 class="mt-4 text-sm font-medium text-slate-900">Sålt per månad (st)</h3>
      <div class="relative mt-1">
        <svg id="sh-sales" viewBox="0 0 ${W} ${H}" class="w-full" style="height:${H}px" preserveAspectRatio="none" role="img"></svg>
        <div id="sh-sales-tip" class="pointer-events-none absolute hidden rounded-md bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-md" style="transform: translate(-50%, calc(-100% - 8px));"></div>
      </div>
      <h3 class="mt-4 text-sm font-medium text-slate-900">Rörelser</h3>
      <div class="mt-1 max-h-64 overflow-y-auto">
        <table class="min-w-full text-sm">
          <thead><tr class="text-left text-xs text-slate-500">
            <th class="py-1 pr-3 font-medium">Datum</th><th class="py-1 pr-3 font-medium">Typ</th>
            <th class="py-1 pr-3 text-right font-medium">Antal</th><th class="py-1 pr-3 font-medium">Avser</th>
            <th class="py-1 pr-3 font-medium">Av</th></tr></thead>
          <tbody id="sh-moves" class="divide-y divide-slate-100"></tbody>
        </table>
        <p id="sh-empty" class="hidden py-4 text-center text-sm text-slate-500">Inga lagerrörelser ännu.</p>
      </div>
    </div>`;
  document.body.appendChild(dialog);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog || event.target.closest("[data-close]")) dialog.close();
  });
  return dialog;
}

function placeTip(svg, tip, svgX, svgY, html) {
  tip.innerHTML = html;
  const rect = svg.getBoundingClientRect();
  tip.style.left = `${svgX * (rect.width / W)}px`;
  tip.style.top = `${svgY * (rect.height / H)}px`;
  tip.classList.remove("hidden");
}

function drawGrid(svg, maxV, formatLabel) {
  const plotH = H - PAD.top - PAD.bottom;
  for (const frac of [0, 0.5, 1]) {
    const gy = PAD.top + plotH - frac * plotH;
    svg.appendChild(svgEl("line", { x1: PAD.left, x2: W - PAD.right, y1: gy, y2: gy, stroke: GRID, "stroke-width": 1 }));
    const label = svgEl("text", { x: PAD.left - 8, y: gy + 3, "text-anchor": "end", "font-size": 10, fill: AXIS_TEXT });
    label.textContent = formatLabel(maxV * frac);
    svg.appendChild(label);
  }
}

function xLabel(svg, x, text, anchor) {
  const label = svgEl("text", { x, y: H - 6, "text-anchor": anchor, "font-size": 10, fill: AXIS_TEXT });
  label.textContent = text;
  svg.appendChild(label);
}

function drawLevel(points) {
  const svg = dialog.querySelector("#sh-level");
  const tip = dialog.querySelector("#sh-level-tip");
  svg.innerHTML = "";
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const values = points.map((p) => p.quantity);
  const minV = Math.min(0, ...values);
  const maxV = niceCeil(Math.max(...values, 1));
  const x = (i) => PAD.left + (points.length === 1 ? 0 : (i / (points.length - 1)) * plotW);
  const y = (v) => PAD.top + plotH - ((v - minV) / (maxV - minV)) * plotH;

  drawGrid(svg, maxV, (v) => v.toLocaleString("sv-SE", { maximumFractionDigits: 1 }));
  const fmt = (d) => new Date(d).toLocaleDateString("sv-SE", { month: "short", year: "2-digit" });
  xLabel(svg, x(0), fmt(points[0].date), "start");
  xLabel(svg, x(points.length - 1), "idag", "end");

  // Stegkurva: saldot ändras i hopp, inte gradvis.
  let d = `M ${x(0).toFixed(1)} ${y(values[0]).toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` H ${x(i).toFixed(1)} V ${y(values[i]).toFixed(1)}`;
  }
  svg.appendChild(svgEl("path", { d, fill: "none", stroke: accent, "stroke-width": 2, "stroke-linejoin": "round" }));
  const last = points.length - 1;
  svg.appendChild(svgEl("circle", { cx: x(last), cy: y(values[last]), r: 4, fill: accent, stroke: "#fff", "stroke-width": 2 }));

  const cross = svgEl("line", { x1: 0, x2: 0, y1: PAD.top, y2: PAD.top + plotH, stroke: AXIS_TEXT, "stroke-width": 1, "stroke-dasharray": "3,3", visibility: "hidden" });
  const dot = svgEl("circle", { r: 4, fill: accent, stroke: "#fff", "stroke-width": 2, visibility: "hidden" });
  const overlay = svgEl("rect", { x: PAD.left, y: PAD.top, width: plotW, height: plotH, fill: "transparent" });
  svg.append(cross, dot, overlay);
  overlay.addEventListener("pointermove", (event) => {
    const rect = svg.getBoundingClientRect();
    const svgX = (event.clientX - rect.left) * (W / rect.width);
    const i = Math.max(0, Math.min(last, Math.round(((svgX - PAD.left) / plotW) * last)));
    cross.setAttribute("x1", x(i));
    cross.setAttribute("x2", x(i));
    cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", x(i));
    dot.setAttribute("cy", y(values[i]));
    dot.setAttribute("visibility", "visible");
    placeTip(svg, tip, x(i), y(values[i]), `<div class="font-semibold">${values[i]} st</div><div class="text-slate-300">${new Date(points[i].date).toLocaleDateString("sv-SE", { day: "numeric", month: "short", year: "numeric" })}</div>`);
  });
  overlay.addEventListener("pointerleave", () => {
    cross.setAttribute("visibility", "hidden");
    dot.setAttribute("visibility", "hidden");
    tip.classList.add("hidden");
  });
}

function drawSales(sales) {
  const svg = dialog.querySelector("#sh-sales");
  const tip = dialog.querySelector("#sh-sales-tip");
  svg.innerHTML = "";
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const maxV = niceCeil(Math.max(...sales.map((s) => s.sold), 1));
  drawGrid(svg, maxV, (v) => v.toLocaleString("sv-SE", { maximumFractionDigits: 1 }));

  const slot = plotW / sales.length;
  const barW = Math.max(4, slot - 2 * Math.max(2, slot * 0.2));
  const baseY = PAD.top + plotH;
  sales.forEach((s, i) => {
    const cx = PAD.left + slot * i + slot / 2;
    const h = (s.sold / maxV) * plotH;
    if (h > 0) {
      // Rundade 4px på dataänden, rak mot nollinjen.
      const r = Math.min(4, h, barW / 2);
      const x0 = cx - barW / 2;
      const top = baseY - h;
      svg.appendChild(
        svgEl("path", {
          d: `M ${x0} ${baseY} V ${top + r} Q ${x0} ${top} ${x0 + r} ${top} H ${x0 + barW - r} Q ${x0 + barW} ${top} ${x0 + barW} ${top + r} V ${baseY} Z`,
          fill: accent,
        })
      );
    }
    if (i % 2 === sales.length % 2 || sales.length <= 6) {
      xLabel(svg, cx, new Date(`${s.month}-01`).toLocaleDateString("sv-SE", { month: "short" }), "middle");
    }
    // Träffytan är hela kolumnen, inte bara stapeln.
    const hit = svgEl("rect", { x: PAD.left + slot * i, y: PAD.top, width: slot, height: plotH, fill: "transparent" });
    hit.addEventListener("pointerenter", () =>
      placeTip(svg, tip, cx, baseY - h, `<div class="font-semibold">${s.sold} st</div><div class="text-slate-300">${new Date(`${s.month}-01`).toLocaleDateString("sv-SE", { month: "long", year: "numeric" })}</div>`)
    );
    hit.addEventListener("pointerleave", () => tip.classList.add("hidden"));
    svg.appendChild(hit);
  });
}

function renderMoves(movements) {
  dialog.querySelector("#sh-empty").classList.toggle("hidden", movements.length > 0);
  dialog.querySelector("#sh-moves").innerHTML = movements
    .map((m) => {
      const ref = m.order_number ? `Order ${m.order_number}` : m.note || (m.reference_type ? `${m.reference_type} ${m.reference_id ?? ""}` : "");
      return `<tr>
        <td class="py-1.5 pr-3 whitespace-nowrap text-slate-600">${new Date(m.created_at).toLocaleDateString("sv-SE")}</td>
        <td class="py-1.5 pr-3">${MOVEMENT_LABELS[m.type] ?? m.type}</td>
        <td class="py-1.5 pr-3 text-right font-medium ${m.quantity < 0 ? "text-slate-900" : "text-green-700"}">${m.quantity > 0 ? "+" : ""}${m.quantity}</td>
        <td class="py-1.5 pr-3 text-slate-600">${escapeHtml(ref)}</td>
        <td class="py-1.5 pr-3 text-slate-500">${escapeHtml(m.user_name ?? "")}</td>
      </tr>`;
    })
    .join("");
}

export async function openStockHistory(variantId) {
  ensureDialog();
  accent ??= await api
    .get("/settings/branding")
    .then((b) => b?.brand_color || "#1c1b19")
    .catch(() => "#1c1b19");
  const data = await api.get(`/inventory/variants/${variantId}/history`);
  const v = data.variant;
  dialog.querySelector("#sh-title").textContent = v.product_name;
  dialog.querySelector("#sh-sub").textContent = [
    [v.color, v.size, v.sku].filter(Boolean).join(" · "),
    `Saldo ${v.quantity_on_hand}`,
    v.reserved_qty ? `reserverat ${v.reserved_qty}` : null,
    `tillgängligt ${v.quantity_on_hand - v.reserved_qty}`,
  ]
    .filter(Boolean)
    .join(" · ");
  dialog.querySelector("#sh-level").setAttribute("aria-label", `Saldo över tid, idag ${v.quantity_on_hand} st`);
  dialog.querySelector("#sh-sales").setAttribute("aria-label", "Sålt antal per månad");
  if (!dialog.open) dialog.showModal();
  drawLevel(data.points);
  drawSales(data.sales);
  renderMoves(data.movements);
}
