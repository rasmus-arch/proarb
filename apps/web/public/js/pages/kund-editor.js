import { api } from "../api.js";

const params = new URLSearchParams(location.search);
const customerId = params.get("id");

if (!customerId) {
  location.href = "/kunder.html";
}

const el = {
  title: document.getElementById("page-title"),
  name: document.getElementById("f-name"),
  org: document.getElementById("f-org"),
  email: document.getElementById("f-email"),
  phone: document.getElementById("f-phone"),
  address: document.getElementById("f-address"),
  postal: document.getElementById("f-postal"),
  city: document.getElementById("f-city"),
  terms: document.getElementById("f-terms"),
  notes: document.getElementById("f-notes"),
  saveBtn: document.getElementById("save-btn"),
  saveError: document.getElementById("save-error"),
  contactRows: document.getElementById("contact-rows"),
  contactsEmpty: document.getElementById("contacts-empty"),
  newContactBtn: document.getElementById("new-contact-btn"),
  newContactDialog: document.getElementById("new-contact-dialog"),
  newContactForm: document.getElementById("new-contact-form"),
  cancelContactBtn: document.getElementById("cancel-contact-btn"),
  logoForm: document.getElementById("logo-form"),
  logoName: document.getElementById("logo-name"),
  logoFile: document.getElementById("logo-file"),
  logoError: document.getElementById("logo-error"),
  logoList: document.getElementById("logo-list"),
  logosEmpty: document.getElementById("logos-empty"),
};

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderContacts(contacts) {
  el.contactsEmpty.classList.toggle("hidden", contacts.length > 0);
  el.contactRows.innerHTML = contacts
    .map(
      (c) => `
      <tr>
        <td class="py-2 pr-3 font-medium text-slate-900">${escapeHtml(c.name)}</td>
        <td class="py-2 pr-3">${escapeHtml(c.role)}</td>
        <td class="py-2 pr-3 text-slate-500">${escapeHtml([c.email, c.phone].filter(Boolean).join(" · "))}</td>
        <td class="py-2 pr-3">${c.can_pickup ? '<span class="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Ja</span>' : ""}</td>
        <td class="py-2 pr-2"><button type="button" class="text-slate-400 hover:text-red-600" data-remove-contact="${c.id}">✕</button></td>
      </tr>`
    )
    .join("");
}

function renderLogos(logos) {
  el.logosEmpty.classList.toggle("hidden", logos.length > 0);
  el.logoList.innerHTML = logos
    .map(
      (l) => `
      <li class="flex items-center justify-between py-2 text-sm">
        <div>
          <span class="font-medium text-slate-900">${escapeHtml(l.name)}</span>
          <span class="ml-2 text-slate-500">${escapeHtml(l.original_filename)} · ${formatBytes(l.file_size)}</span>
        </div>
        <div class="flex items-center gap-3">
          <a href="/uploads/${l.file_path}" target="_blank" class="text-blue-700 underline">Öppna</a>
          <button type="button" class="text-slate-400 hover:text-red-600" data-remove-logo="${l.id}">✕</button>
        </div>
      </li>`
    )
    .join("");
}

async function loadCustomer() {
  const customer = await api.get(`/customers/${customerId}`);
  el.title.textContent = customer.name;
  el.name.value = customer.name ?? "";
  el.org.value = customer.org_number ?? "";
  el.email.value = customer.email ?? "";
  el.phone.value = customer.phone ?? "";
  el.address.value = customer.address ?? "";
  el.postal.value = customer.postal_code ?? "";
  el.city.value = customer.city ?? "";
  el.terms.value = customer.payment_terms_days ?? 30;
  el.notes.value = customer.notes ?? "";
  renderContacts(customer.contacts);
  renderLogos(customer.logos);
}

el.saveBtn.addEventListener("click", async () => {
  el.saveError.classList.add("hidden");
  try {
    await api.patch(`/customers/${customerId}`, {
      name: el.name.value,
      orgNumber: el.org.value || null,
      email: el.email.value || null,
      phone: el.phone.value || null,
      address: el.address.value || null,
      postalCode: el.postal.value || null,
      city: el.city.value || null,
      paymentTermsDays: Number(el.terms.value) || 0,
      notes: el.notes.value || null,
    });
    el.title.textContent = el.name.value;
  } catch (err) {
    el.saveError.textContent = err.message;
    el.saveError.classList.remove("hidden");
  }
});

// --- Contacts --------------------------------------------------------

el.newContactBtn.addEventListener("click", () => {
  el.newContactForm.reset();
  el.newContactDialog.showModal();
});
el.cancelContactBtn.addEventListener("click", () => el.newContactDialog.close());

el.newContactForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(el.newContactForm).entries());
  await api.post(`/customers/${customerId}/contacts`, {
    name: form.name,
    role: form.role || null,
    email: form.email || null,
    phone: form.phone || null,
    canPickup: form.canPickup === "on",
  });
  el.newContactDialog.close();
  loadCustomer();
});

el.contactRows.addEventListener("click", async (event) => {
  const id = event.target.dataset.removeContact;
  if (id === undefined) return;
  await api.delete(`/customers/${customerId}/contacts/${id}`);
  loadCustomer();
});

// --- Logos -------------------------------------------------------------

el.logoForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  el.logoError.classList.add("hidden");

  const file = el.logoFile.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append("name", el.logoName.value);
  formData.append("file", file);

  try {
    const res = await fetch(`/api/customers/${customerId}/logos`, { method: "POST", body: formData });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Uppladdning misslyckades");
    el.logoForm.reset();
    loadCustomer();
  } catch (err) {
    el.logoError.textContent = err.message;
    el.logoError.classList.remove("hidden");
  }
});

el.logoList.addEventListener("click", async (event) => {
  const id = event.target.dataset.removeLogo;
  if (id === undefined) return;
  await api.delete(`/customers/${customerId}/logos/${id}`);
  loadCustomer();
});

loadCustomer();
