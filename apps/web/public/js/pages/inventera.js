import { api } from "../api.js";
import { cameraSupported, openCameraScanner } from "../camera-scanner.js";

// Mobilinventering hylla för hylla (se inventory/stock-counts.js). Räknar
// in i samma inventering som Lager → Inventering på datorn, där avvikelser
// sedan bokas eller behålls. Förväntat antal visas inte medan man räknar
// (blindräkning) — bara det man själv räknat.
// Skanningar som inte når servern (dålig täckning i lagret) sparas i
// telefonen och skickas när nätet är tillbaka.

const params = new URLSearchParams(location.search);
const countId = params.get("count") ? Number(params.get("count")) : null;
let currentShelf = null;
let shelfItems = [];

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

const shelfName = (shelf) => (shelf === "" ? "Utan hyllplats" : `Hylla ${shelf}`);
const show = (id) =>
  ["pick-count-view", "shelves-view", "shelf-view"].forEach((v) => document.getElementById(v).classList.toggle("hidden", v !== id));

// --- Kö för skanningar utan nät ------------------------------------------------

const QUEUE_KEY = `inventera-queue-${countId}`;
function readQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function writeQueue(queue) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    /* privat läge — kön lever bara i minnet */
  }
  const el = document.getElementById("queue-msg");
  el.classList.toggle("hidden", queue.length === 0);
  el.textContent = `${queue.length} skanningar väntar på nät — skickas automatiskt.`;
}

let flushing = false;
async function flushQueue() {
  if (flushing) return;
  flushing = true;
  let queue = readQueue();
  try {
    while (queue.length) {
      await api.post(`/inventory/stock-counts/${countId}/scan`, { barcode: queue[0], quantity: 1 });
      queue = queue.slice(1);
      writeQueue(queue);
    }
  } catch {
    /* fortfarande inget nät — försöker igen senare */
  } finally {
    flushing = false;
  }
  if (currentShelf !== null && readQueue().length === 0) loadShelf(currentShelf, { quiet: true });
}
window.addEventListener("online", flushQueue);
setInterval(() => readQueue().length && flushQueue(), 15000);

// --- Välj inventering ----------------------------------------------------------

async function loadCountPicker() {
  show("pick-count-view");
  const { rows } = await api.get("/inventory/stock-counts");
  const open = rows.filter((c) => c.status === "IN_PROGRESS");
  document.getElementById("count-list-empty").classList.toggle("hidden", open.length > 0);
  document.getElementById("count-list").innerHTML = open
    .map(
      (c) => `<li><a href="/inventera.html?count=${c.id}" class="card block py-4">
        <div class="font-medium text-slate-900">Inventering #${c.id}${c.scope_label ? ` · ${escapeHtml(c.scope_label)}` : ""}</div>
        <div class="text-sm text-slate-500">${escapeHtml(c.warehouse_name)} · startad ${new Date(c.started_at).toLocaleDateString("sv-SE")}${
          c.started_by_name ? ` av ${escapeHtml(c.started_by_name)}` : ""
        }</div>
      </a></li>`
    )
    .join("");
}

// --- Hyllor ----------------------------------------------------------------------

async function loadShelves() {
  currentShelf = null;
  show("shelves-view");
  const { count, shelves } = await api.get(`/inventory/stock-counts/${countId}/shelves`);
  document.getElementById("shelves-title").textContent = `Inventering #${count.id}${count.scope_label ? ` · ${count.scope_label}` : ""}`;
  const done = shelves.filter((s) => s.done).length;
  document.getElementById("shelves-sub").textContent =
    count.status === "IN_PROGRESS" ? `${done} av ${shelves.length} hyllor klara` : "Inventeringen är avslutad.";
  document.querySelector("#shelves-progress > div").style.width = `${shelves.length ? Math.round((done / shelves.length) * 100) : 0}%`;
  document.getElementById("shelf-list").innerHTML = shelves
    .map(
      (s) => `<li><button type="button" class="card flex w-full items-center justify-between gap-3 py-4 text-left" data-shelf="${escapeHtml(s.shelf_location)}">
        <span>
          <span class="block text-base font-semibold text-slate-900">${escapeHtml(shelfName(s.shelf_location))}</span>
          <span class="block text-sm text-slate-500">${s.counted_count} av ${s.item_count} artiklar räknade${
            s.done && s.completed_by_name ? ` · klar (${escapeHtml(s.completed_by_name)})` : ""
          }</span>
        </span>
        ${s.done ? `<span class="rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">Klar</span>` : `<span class="text-slate-400">›</span>`}
      </button></li>`
    )
    .join("");
}

document.getElementById("shelf-list").addEventListener("click", (event) => {
  const btn = event.target.closest("[data-shelf]");
  if (btn) loadShelf(btn.dataset.shelf);
});

// --- En hylla --------------------------------------------------------------------

function message(text, ok = true) {
  const el = document.getElementById("shelf-msg");
  el.textContent = text;
  el.className = `mt-2 text-sm ${ok ? "text-green-700" : "text-red-600"}`;
}

function renderShelfItems() {
  document.getElementById("shelf-empty").classList.toggle("hidden", shelfItems.length > 0);
  document.getElementById("shelf-items").innerHTML = shelfItems
    .map((i) => {
      const counted = i.counted_qty;
      return `<li class="flex items-center gap-3 px-3 py-3">
        <div class="min-w-0 flex-1">
          <div class="font-medium text-slate-900">${escapeHtml(i.product_name)}</div>
          <div class="text-xs text-slate-500">${escapeHtml([i.color, i.size, i.sku].filter(Boolean).join(" · "))}</div>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <button type="button" class="h-10 w-10 rounded-md border border-slate-200 text-lg" data-step="-1" data-variant="${i.variant_id}" aria-label="Minska">−</button>
          <button type="button" class="h-10 min-w-[3rem] rounded-md px-2 text-lg font-semibold ${counted === null ? "text-slate-300" : "text-slate-900"}" data-set="${i.variant_id}" aria-label="Ange antal">${counted ?? "–"}</button>
          <button type="button" class="h-10 w-10 rounded-md border border-slate-200 text-lg" data-step="1" data-variant="${i.variant_id}" aria-label="Öka">+</button>
        </div>
      </li>`;
    })
    .join("");
}

async function loadShelf(shelf, { quiet = false } = {}) {
  currentShelf = shelf;
  const data = await api.get(`/inventory/stock-counts/${countId}/shelf?shelf=${encodeURIComponent(shelf)}`);
  shelfItems = data.items;
  show("shelf-view");
  document.getElementById("shelf-title").textContent = shelfName(shelf);
  document.getElementById("shelf-sub").textContent = `${data.items.filter((i) => i.counted_qty !== null).length} av ${data.items.length} räknade`;
  document.getElementById("shelf-done-badge").classList.toggle("hidden", !data.done);
  document.getElementById("shelf-done-btn").classList.toggle("hidden", data.done || data.count.status !== "IN_PROGRESS");
  document.getElementById("shelf-reopen-btn").classList.toggle("hidden", !data.done || data.count.status !== "IN_PROGRESS");
  if (!quiet) document.getElementById("shelf-msg").classList.add("hidden");
  renderShelfItems();
}

async function scan(code) {
  const barcode = String(code).trim();
  if (!barcode) return null;
  try {
    await api.post(`/inventory/stock-counts/${countId}/scan`, { barcode, quantity: 1 });
  } catch (err) {
    if (err instanceof TypeError || !navigator.onLine) {
      writeQueue([...readQueue(), barcode]);
      return "Sparad — skickas när nätet är tillbaka";
    }
    throw err;
  }
  await loadShelf(currentShelf, { quiet: true });
  // Skannad vara som inte hör till hyllan räknas ändå (räkningen gäller
  // hela lagret) men syns under sin egen hylla.
  const hit = shelfItems.find((i) => i.barcode === barcode || i.sku === barcode);
  const text = hit ? `+1 ${hit.product_name} (${hit.counted_qty} st)` : "+1 räknad — varan hör till en annan hylla";
  message(text, true);
  return text;
}

document.getElementById("shelf-scan-input").addEventListener("keydown", async (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  const input = event.currentTarget;
  const value = input.value;
  input.value = "";
  try {
    await scan(value);
  } catch (err) {
    message(err.message, false);
  }
});

const cameraBtn = document.getElementById("shelf-camera-btn");
if (cameraSupported()) {
  cameraBtn.classList.remove("hidden");
  cameraBtn.addEventListener("click", () =>
    openCameraScanner({ title: shelfName(currentShelf), continuous: true, onResult: (text) => scan(text) })
  );
}

document.getElementById("shelf-items").addEventListener("click", async (event) => {
  const step = event.target.closest("[data-step]");
  const set = event.target.closest("[data-set]");
  const variantId = Number(step?.dataset.variant ?? set?.dataset.set);
  if (!variantId) return;
  const item = shelfItems.find((i) => i.variant_id === variantId);
  let qty;
  if (step) {
    qty = Math.max(0, (item.counted_qty ?? 0) + Number(step.dataset.step));
  } else {
    const answer = prompt(`Antal ${item.product_name} ${[item.color, item.size].filter(Boolean).join(" ")}`, item.counted_qty ?? "");
    if (answer === null || answer.trim() === "" || !(Number(answer) >= 0)) return;
    qty = Number(answer);
  }
  try {
    await api.put(`/inventory/stock-counts/${countId}/variants/${variantId}`, { countedQty: qty });
    item.counted_qty = qty;
    renderShelfItems();
  } catch (err) {
    message(err.message, false);
  }
});

async function markShelf(done) {
  try {
    await api.post(`/inventory/stock-counts/${countId}/shelf-done`, { shelf: currentShelf, done });
    if (done) await loadShelves();
    else await loadShelf(currentShelf);
  } catch (err) {
    message(err.message, false);
  }
}

document.getElementById("shelf-done-btn").addEventListener("click", () => {
  const uncounted = shelfItems.filter((i) => i.counted_qty === null).length;
  if (uncounted && !confirm(`${uncounted} artiklar är inte räknade. Räknas de som saknade (0) när inventeringen avslutas. Markera hyllan klar ändå?`)) return;
  markShelf(true);
});
document.getElementById("shelf-reopen-btn").addEventListener("click", () => markShelf(false));
document.getElementById("back-to-shelves").addEventListener("click", loadShelves);

if (countId) {
  writeQueue(readQueue());
  flushQueue();
  loadShelves().catch((err) => {
    show("shelves-view");
    document.getElementById("shelves-sub").textContent = err.message;
  });
} else {
  loadCountPicker();
}
