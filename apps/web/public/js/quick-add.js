import { api } from "./api.js";

// Shared "+ Ny kund" / "+ Ny kontakt" dialogs used from offert-editor.html
// and order-editor.html — both pages include the same dialog markup (see
// quick-add-dialogs.html partial pasted into each) and import this module.

const customerDialog = document.getElementById("quick-new-customer-dialog");
const customerForm = document.getElementById("quick-new-customer-form");
const customerError = document.getElementById("quick-new-customer-error");

const contactDialog = document.getElementById("quick-new-contact-dialog");
const contactForm = document.getElementById("quick-new-contact-form");
const contactError = document.getElementById("quick-new-contact-error");

let onCustomerCreated = null;
let onContactCreated = null;
let contactCustomerId = null;

export function openNewCustomerDialog(callback) {
  onCustomerCreated = callback;
  customerForm.reset();
  customerError.classList.add("hidden");
  customerDialog.showModal();
}

customerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(customerForm).entries());
  if (data.paymentTermsDays) data.paymentTermsDays = Number(data.paymentTermsDays);
  else delete data.paymentTermsDays;
  try {
    const customer = await api.post("/customers", data);
    customerDialog.close();
    onCustomerCreated?.(customer);
  } catch (err) {
    customerError.textContent = err.message;
    customerError.classList.remove("hidden");
  }
});

document.getElementById("quick-new-customer-cancel").addEventListener("click", () => customerDialog.close());

export function openNewContactDialog(customerId, callback) {
  contactCustomerId = customerId;
  onContactCreated = callback;
  contactForm.reset();
  contactError.classList.add("hidden");
  contactDialog.showModal();
}

contactForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(contactForm);
  const data = {
    name: formData.get("name"),
    phone: formData.get("phone") || undefined,
    email: formData.get("email") || undefined,
    canPickup: formData.get("canPickup") === "on",
  };
  try {
    const contact = await api.post(`/customers/${contactCustomerId}/contacts`, data);
    contactDialog.close();
    onContactCreated?.(contact);
  } catch (err) {
    contactError.textContent = err.message;
    contactError.classList.remove("hidden");
  }
});

document.getElementById("quick-new-contact-cancel").addEventListener("click", () => contactDialog.close());
