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
  portalGenerateBtn: document.getElementById("portal-generate-btn"),
  portalLink: document.getElementById("portal-link"),
  portalCopyBtn: document.getElementById("portal-copy-btn"),
  discountForm: document.getElementById("discount-form"),
  discountTargetType: document.getElementById("discount-target-type"),
  discountSupplierWrap: document.getElementById("discount-supplier-wrap"),
  discountSupplierInput: document.getElementById("discount-supplier-input"),
  discountSupplierOptions: document.getElementById("discount-supplier-options"),
  discountProductWrap: document.getElementById("discount-product-wrap"),
  discountProductInput: document.getElementById("discount-product-input"),
  discountProductResults: document.getElementById("discount-product-results"),
  discountPercentInput: document.getElementById("discount-percent-input"),
  discountError: document.getElementById("discount-error"),
  discountList: document.getElementById("discount-list"),
  discountsEmpty: document.getElementById("discounts-empty"),
  assortmentSearch: document.getElementById("assortment-search"),
  assortmentResults: document.getElementById("assortment-results"),
  assortmentList: document.getElementById("assortment-list"),
  assortmentEmpty: document.getElementById("assortment-empty"),
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

function renderDiscounts(discounts) {
  el.discountsEmpty.classList.toggle("hidden", discounts.length > 0);
  el.discountList.innerHTML = discounts
    .map((d) => {
      const label = d.supplier_id
        ? `Leverantör: <span class="font-medium text-slate-900">${escapeHtml(d.supplier_name)}</span>`
        : `Produkt: <span class="font-medium text-slate-900">${escapeHtml(d.product_name)}</span> <span class="text-slate-500">(${escapeHtml(d.article_number)})</span>`;
      return `
      <li class="flex items-center justify-between py-2 text-sm">
        <div>${label} — ${Number(d.discount_percent)} %</div>
        <button type="button" class="text-slate-400 hover:text-red-600" data-remove-discount="${d.id}">✕</button>
      </li>`;
    })
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

  const { rows: suppliers } = await api.get("/suppliers");
  el.discountSupplierOptions.innerHTML = suppliers.map((s) => `<option value="${escapeHtml(s.name)}">`).join("");

  const { rows: discounts } = await api.get(`/customers/${customerId}/discounts`);
  renderDiscounts(discounts);

  const { rows: assortment } = await api.get(`/customers/${customerId}/assortment`);
  renderAssortment(assortment);
}

function renderAssortment(rows) {
  el.assortmentEmpty.classList.toggle("hidden", rows.length > 0);
  el.assortmentList.innerHTML = rows
    .map((p) => {
      const variantBadge =
        p.variant_count > 1
          ? `<span class="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Variabel produkt · ${p.variant_count} varianter</span>`
          : "";
      const discountBadge =
        Number(p.discount_percent) > 0
          ? `<span class="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">-${p.discount_percent}% rabatt</span>`
          : "";
      return `
      <li class="flex items-center justify-between py-2 text-sm">
        <div>
          <span class="font-medium text-slate-900">${escapeHtml(p.name)}</span>
          <span class="ml-2 text-slate-500">${escapeHtml(p.article_number)}</span>
          ${variantBadge}${discountBadge}
        </div>
        <button type="button" class="text-slate-400 hover:text-red-600" data-remove-assortment="${p.product_id}">✕</button>
      </li>`;
    })
    .join("");
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

// --- Stående rabatt --------------------------------------------------------

let selectedDiscountProduct = null;

function updateDiscountTargetVisibility() {
  const isProduct = el.discountTargetType.value === "product";
  el.discountSupplierWrap.classList.toggle("hidden", isProduct);
  el.discountProductWrap.classList.toggle("hidden", !isProduct);
}
el.discountTargetType.addEventListener("change", updateDiscountTargetVisibility);
updateDiscountTargetVisibility();

let discountProductSearchTimer;
el.discountProductInput.addEventListener("input", () => {
  selectedDiscountProduct = null;
  clearTimeout(discountProductSearchTimer);
  const q = el.discountProductInput.value.trim();
  if (!q) {
    el.discountProductResults.innerHTML = "";
    return;
  }
  discountProductSearchTimer = setTimeout(async () => {
    const { rows } = await api.get(`/products/search?q=${encodeURIComponent(q)}`);
    el.discountProductResults.innerHTML = rows
      .map(
        (v) => `
        <button type="button" class="block w-full px-3 py-2 text-left hover:bg-slate-50" data-product-id="${v.product_id}" data-name="${escapeHtml(v.name)}">
          <div class="font-medium text-slate-900">${escapeHtml(v.name)}</div>
          <div class="text-xs text-slate-500">${escapeHtml([v.color, v.size, v.sku].filter(Boolean).join(" · "))}</div>
        </button>`
      )
      .join("");
  }, 200);
});

el.discountProductResults.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-product-id]");
  if (!button) return;
  selectedDiscountProduct = { id: Number(button.dataset.productId), name: button.dataset.name };
  el.discountProductInput.value = button.dataset.name;
  el.discountProductResults.innerHTML = "";
});

el.discountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  el.discountError.classList.add("hidden");

  const isProduct = el.discountTargetType.value === "product";
  const payload = { discountPercent: Number(el.discountPercentInput.value) };
  if (isProduct) {
    if (!selectedDiscountProduct) {
      el.discountError.textContent = "Välj en produkt ur sökresultaten";
      el.discountError.classList.remove("hidden");
      return;
    }
    payload.productId = selectedDiscountProduct.id;
  } else {
    if (!el.discountSupplierInput.value.trim()) {
      el.discountError.textContent = "Välj en leverantör";
      el.discountError.classList.remove("hidden");
      return;
    }
    const { rows: suppliers } = await api.get("/suppliers");
    const match = suppliers.find((s) => s.name === el.discountSupplierInput.value.trim());
    if (!match) {
      el.discountError.textContent = "Okänd leverantör — välj en från listan";
      el.discountError.classList.remove("hidden");
      return;
    }
    payload.supplierId = match.id;
  }

  try {
    await api.post(`/customers/${customerId}/discounts`, payload);
    el.discountForm.reset();
    selectedDiscountProduct = null;
    updateDiscountTargetVisibility();
    loadCustomer();
  } catch (err) {
    el.discountError.textContent = err.message;
    el.discountError.classList.remove("hidden");
  }
});

el.discountList.addEventListener("click", async (event) => {
  const id = event.target.dataset.removeDiscount;
  if (id === undefined) return;
  await api.delete(`/customers/${customerId}/discounts/${id}`);
  loadCustomer();
});

// --- Sortiment (Mina sidor) ------------------------------------------------

let assortmentSearchTimer;
el.assortmentSearch.addEventListener("input", () => {
  clearTimeout(assortmentSearchTimer);
  const q = el.assortmentSearch.value.trim();
  if (!q) {
    el.assortmentResults.innerHTML = "";
    return;
  }
  assortmentSearchTimer = setTimeout(async () => {
    const { rows } = await api.get(`/products/search?q=${encodeURIComponent(q)}&customerId=${customerId}&limit=50`);
    // /products/search returns one row per variant — group back to one
    // entry per product so a 20-color/size product isn't 20 near-identical
    // buttons in the dropdown; picking any one adds the whole product
    // (customer_assortment is product-level, so every variant follows).
    const byProduct = new Map();
    for (const v of rows) {
      if (!byProduct.has(v.product_id)) {
        byProduct.set(v.product_id, { ...v, variant_count: 0 });
      }
      byProduct.get(v.product_id).variant_count += 1;
    }
    el.assortmentResults.innerHTML = [...byProduct.values()]
      .map((p) => {
        const variantNote = p.variant_count > 1 ? `Variabel produkt · ${p.variant_count} varianter` : escapeHtml(p.sku ?? "");
        const discountNote =
          Number(p.suggested_discount_percent) > 0 ? ` · -${p.suggested_discount_percent}% rabatt för kunden` : "";
        return `
        <button type="button" class="block w-full px-3 py-2 text-left hover:bg-slate-50" data-product-id="${p.product_id}">
          <div class="font-medium text-slate-900">${escapeHtml(p.name)}</div>
          <div class="text-xs text-slate-500">${variantNote}${discountNote}</div>
        </button>`;
      })
      .join("");
  }, 200);
});

el.assortmentResults.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-product-id]");
  if (!button) return;
  await api.post(`/customers/${customerId}/assortment`, { productId: Number(button.dataset.productId) });
  el.assortmentSearch.value = "";
  el.assortmentResults.innerHTML = "";
  loadCustomer();
});

el.assortmentList.addEventListener("click", async (event) => {
  const productId = event.target.dataset.removeAssortment;
  if (productId === undefined) return;
  await api.delete(`/customers/${customerId}/assortment/${productId}`);
  loadCustomer();
});

// --- Kundportal ----------------------------------------------------------

el.portalGenerateBtn.addEventListener("click", async () => {
  const { url } = await api.post(`/customers/${customerId}/portal-token`);
  el.portalLink.value = url;
  el.portalLink.classList.remove("hidden");
  el.portalCopyBtn.classList.remove("hidden");
});

el.portalCopyBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(el.portalLink.value);
  el.portalCopyBtn.textContent = "Kopierad!";
  setTimeout(() => (el.portalCopyBtn.textContent = "Kopiera"), 1500);
});

loadCustomer();
