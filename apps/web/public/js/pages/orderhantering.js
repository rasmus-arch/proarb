import { api } from "../api.js";
import { ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from "../order-status.js";
import { cameraSupported, openCameraScanner } from "../camera-scanner.js";
import { loadFeatures } from "../features.js";

const el = {
  scanInput: document.getElementById("scan-input"),
  scanError: document.getElementById("scan-error"),
  orderSection: document.getElementById("order-section"),
  orderNumber: document.getElementById("order-number"),
  orderCustomer: document.getElementById("order-customer"),
  orderStatus: document.getElementById("order-status"),
  orderActions: document.getElementById("order-actions"),
  pickupForm: document.getElementById("pickup-form"),
  pickupContactSelect: document.getElementById("pickup-contact-select"),
  pickupNameInput: document.getElementById("pickup-name-input"),
  pickupBtn: document.getElementById("pickup-btn"),
  orderMessage: document.getElementById("order-message"),
};

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

let currentOrder = null;

function resetToScan() {
  currentOrder = null;
  el.orderSection.classList.add("hidden");
  el.pickupForm.classList.add("hidden");
  el.orderMessage.classList.add("hidden");
  el.scanInput.value = "";
  el.scanInput.focus();
}

// --- Plocklista ---------------------------------------------------------------
// Med hyllplatser påslaget sorteras raderna i plockordning (som ordersedeln).

let features = { shelfLocations: false };
loadFeatures().then((f) => (features = f));
const picked = new Set();

function pickOrder(lines) {
  if (!features.shelfLocations) return lines;
  const collator = new Intl.Collator("sv", { numeric: true, sensitivity: "base" });
  return [...lines].sort((a, b) => {
    if (!a.shelf_location !== !b.shelf_location) return a.shelf_location ? -1 : 1;
    return a.shelf_location ? collator.compare(a.shelf_location, b.shelf_location) : 0;
  });
}

function renderPickList(order) {
  const wrap = document.getElementById("pick-list-wrap");
  const pickable = ["NEW", "READY_FOR_PICKUP"].includes(order.status);
  wrap.classList.toggle("hidden", !pickable || order.lines.length === 0);
  if (!pickable) return;
  const lines = pickOrder(order.lines);
  document.getElementById("pick-list").innerHTML = lines
    .map((l) => {
      const done = picked.has(l.id);
      const variant = [l.color, l.size].filter(Boolean).join(" / ");
      return `<li>
        <label class="flex cursor-pointer items-start gap-3 py-3">
          <input type="checkbox" class="mt-1 h-5 w-5 shrink-0" data-pick="${l.id}" ${done ? "checked" : ""} />
          <span class="min-w-0 flex-1 ${done ? "text-slate-400 line-through" : ""}">
            <span class="block font-medium ${done ? "" : "text-slate-900"}">${escapeHtml(l.product_name)}</span>
            <span class="block text-xs text-slate-500">${escapeHtml([variant, l.sku].filter(Boolean).join(" · "))}${
              l.print_description ? ` · Tryck: ${escapeHtml(l.print_description)}` : ""
            }</span>
          </span>
          <span class="shrink-0 text-right">
            <span class="block text-lg font-semibold ${done ? "" : "text-slate-900"}">${Number(l.quantity)}</span>
            ${features.shelfLocations && l.shelf_location ? `<span class="block text-xs font-medium text-accent-700">Hylla ${escapeHtml(l.shelf_location)}</span>` : ""}
          </span>
        </label>
      </li>`;
    })
    .join("");
  const total = order.lines.length;
  document.getElementById("pick-progress").textContent = `${[...picked].filter((id) => order.lines.some((l) => l.id === id)).length} av ${total} plockade`;
}

document.getElementById("pick-list").addEventListener("change", (event) => {
  const box = event.target.closest("[data-pick]");
  if (!box || !currentOrder) return;
  const id = Number(box.dataset.pick);
  if (box.checked) picked.add(id);
  else picked.delete(id);
  renderPickList(currentOrder);
});

function renderOrder(order) {
  if (currentOrder?.id !== order.id) picked.clear();
  currentOrder = order;
  el.scanError.classList.add("hidden");
  el.orderMessage.classList.add("hidden");
  el.pickupForm.classList.add("hidden");
  el.orderSection.classList.remove("hidden");

  el.orderNumber.textContent = order.order_number;
  el.orderCustomer.textContent = order.customer_name;
  el.orderStatus.textContent = ORDER_STATUS_LABELS[order.status] ?? order.status;
  el.orderStatus.className = `rounded-full px-2 py-0.5 text-xs font-medium ${ORDER_STATUS_COLORS[order.status] ?? ""}`;
  document.getElementById("order-meta").textContent = [
    order.reference_name ? `Hämtas av ${order.reference_name}` : null,
    order.customer_reference ? `Er ref: ${order.customer_reference}` : null,
    order.notes,
  ]
    .filter(Boolean)
    .join(" · ");
  renderPickList(order);

  const buttons = [];
  if (order.status === "NEW") {
    buttons.push(`<button type="button" class="btn-secondary justify-center py-3 text-base sm:py-2 sm:text-sm" data-action="ready">Redo för utlämning</button>`);
  }
  if (order.can_pickup && order.is_cash_customer) {
    buttons.push(`<button type="button" class="btn justify-center py-3 text-base sm:py-2 sm:text-sm" data-action="cash-complete">Betald – slutför köp</button>`);
  } else if (order.can_pickup) {
    buttons.push(`<button type="button" class="btn justify-center py-3 text-base sm:py-2 sm:text-sm" data-action="show-pickup">Registrera utlämning</button>`);
  }
  el.orderActions.innerHTML = buttons.length
    ? buttons.join("")
    : `<p class="text-sm text-slate-500">Inget mer att göra med den här ordern.</p>`;
}

async function loadPickupContacts(customerId) {
  const customer = await api.get(`/customers/${customerId}`);
  el.pickupContactSelect.innerHTML =
    `<option value="">— Välj —</option>` +
    customer.contacts
      .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}${c.can_pickup ? " (hämtbehörig)" : ""}</option>`)
      .join("");
}

// Streckkoden på ordersedeln är ordernumret; QR-koden är en länk som
// slutar på /qr/<token>.
function fetchScanned(text) {
  const qr = String(text).match(/\/qr\/([A-Za-z0-9]+)\/?$/);
  return qr
    ? api.get(`/orders/by-qr/${encodeURIComponent(qr[1])}`)
    : api.get(`/orders/by-number/${encodeURIComponent(String(text).trim())}`);
}

async function scan(orderNumber) {
  el.scanError.classList.add("hidden");
  try {
    renderOrder(await fetchScanned(orderNumber));
    el.orderSection.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    el.orderSection.classList.add("hidden");
    el.scanError.textContent = err.message;
    el.scanError.classList.remove("hidden");
  }
}

const cameraBtn = document.getElementById("camera-btn");
if (cameraSupported()) {
  cameraBtn.classList.remove("hidden");
  cameraBtn.addEventListener("click", () =>
    openCameraScanner({
      title: "Skanna ordersedeln",
      onResult: async (text) => {
        // Kastar vid okänd kod — då stannar kameran kvar och visar felet.
        renderOrder(await fetchScanned(text));
        el.scanInput.value = currentOrder.order_number;
      },
    })
  );
}

document.getElementById("next-order-btn").addEventListener("click", () => {
  resetToScan();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

el.scanInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  const value = el.scanInput.value.trim();
  if (value) scan(value);
});

el.orderActions.addEventListener("click", async (event) => {
  const action = event.target.dataset.action;
  if (!action || !currentOrder) return;

  if (action === "ready") {
    try {
      await api.patch(`/orders/${currentOrder.id}/status`, { status: "READY_FOR_PICKUP" });
      el.orderMessage.textContent = "Markerad som redo för utlämning.";
      el.orderMessage.classList.remove("hidden");
      setTimeout(resetToScan, 1500);
    } catch (err) {
      el.scanError.textContent = err.message;
      el.scanError.classList.remove("hidden");
    }
    return;
  }

  // Kontantkund (Swish-kunden): ingen legitimering — utlämningen skapar en
  // kontantfaktura i Fortnox och ordern blir fakturerad direkt.
  if (action === "cash-complete") {
    try {
      await api.post(`/orders/${currentOrder.id}/pickup`, {});
      el.orderMessage.textContent = "Köpet är slutfört — kontantfaktura skapas i Fortnox.";
      el.orderMessage.classList.remove("hidden");
      el.orderActions.innerHTML = "";
      setTimeout(resetToScan, 2000);
    } catch (err) {
      el.scanError.textContent = err.message;
      el.scanError.classList.remove("hidden");
    }
    return;
  }

  if (action === "show-pickup") {
    await loadPickupContacts(currentOrder.customer_id);
    el.pickupForm.classList.remove("hidden");
    el.pickupForm.scrollIntoView({ behavior: "smooth", block: "start" });
  }
});

el.pickupBtn.addEventListener("click", async () => {
  if (!currentOrder) return;
  try {
    await api.post(`/orders/${currentOrder.id}/pickup`, {
      pickedUpByContactId: el.pickupContactSelect.value || null,
      pickedUpByName: el.pickupNameInput.value || null,
    });
    el.orderMessage.textContent = "Utlämning registrerad.";
    el.orderMessage.classList.remove("hidden");
    setTimeout(resetToScan, 1500);
  } catch (err) {
    el.scanError.textContent = err.message;
    el.scanError.classList.remove("hidden");
    el.scanError.scrollIntoView({ behavior: "smooth", block: "center" });
  }
});

el.scanInput.focus();

// Sökfältet i menyn skickar hit en skannad ordersedel via ?order=.
{
  const initialOrder = new URLSearchParams(location.search).get("order");
  if (initialOrder) scan(initialOrder);
}
