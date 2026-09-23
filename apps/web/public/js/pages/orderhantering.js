import { api } from "../api.js";
import { ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from "../order-status.js";

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

function renderOrder(order) {
  currentOrder = order;
  el.scanError.classList.add("hidden");
  el.orderMessage.classList.add("hidden");
  el.pickupForm.classList.add("hidden");
  el.orderSection.classList.remove("hidden");

  el.orderNumber.textContent = order.order_number;
  el.orderCustomer.textContent = order.customer_name;
  el.orderStatus.textContent = ORDER_STATUS_LABELS[order.status] ?? order.status;
  el.orderStatus.className = `rounded-full px-2 py-0.5 text-xs font-medium ${ORDER_STATUS_COLORS[order.status] ?? ""}`;

  const buttons = [];
  if (order.status === "NEW") {
    buttons.push(`<button type="button" class="btn-secondary" data-action="ready">Redo för utlämning</button>`);
  }
  if (order.can_pickup) {
    buttons.push(`<button type="button" class="btn" data-action="show-pickup">Registrera utlämning</button>`);
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

async function scan(orderNumber) {
  el.scanError.classList.add("hidden");
  try {
    const order = await api.get(`/orders/by-number/${encodeURIComponent(orderNumber)}`);
    renderOrder(order);
  } catch (err) {
    el.orderSection.classList.add("hidden");
    el.scanError.textContent = err.message;
    el.scanError.classList.remove("hidden");
  }
}

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

  if (action === "show-pickup") {
    await loadPickupContacts(currentOrder.customer_id);
    el.pickupForm.classList.remove("hidden");
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
