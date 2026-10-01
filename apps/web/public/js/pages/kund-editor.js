import { api } from "../api.js";

const params = new URLSearchParams(location.search);
const customerId = params.get("id");

if (!customerId) {
  location.href = "/kunder.html";
}

const el = {
  title: document.getElementById("page-title"),
  statsSection: document.getElementById("stats-section"),
  statYear: document.getElementById("stat-year"),
  statAllTime: document.getElementById("stat-all-time"),
  statLastOrder: document.getElementById("stat-last-order"),
  statPendingQuotes: document.getElementById("stat-pending-quotes"),
  historySection: document.getElementById("history-section"),
  quotesList: document.getElementById("quotes-list"),
  quotesEmpty: document.getElementById("quotes-empty"),
  ordersList: document.getElementById("orders-list"),
  ordersEmpty: document.getElementById("orders-empty"),
  templateRows: document.getElementById("template-rows"),
  templatesEmpty: document.getElementById("templates-empty"),
  name: document.getElementById("f-name"),
  org: document.getElementById("f-org"),
  email: document.getElementById("f-email"),
  invoiceEmail: document.getElementById("f-invoice-email"),
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

function money(value) {
  return `${Number(value).toLocaleString("sv-SE", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} kr`;
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
      <li class="flex items-center justify-between gap-3 py-2 text-sm">
        <div class="flex min-w-0 items-center gap-3">
          <a href="/uploads/${l.file_path}" target="_blank" class="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded border border-slate-200 bg-white p-1">
            <img src="/api/customers/${customerId}/logos/${l.id}/preview" alt="" loading="lazy" class="max-h-full max-w-full object-contain" data-logo-thumb data-ext="${escapeHtml(fileExtension(l.original_filename))}" />
          </a>
          <div class="min-w-0">
            <div class="font-medium text-slate-900">${escapeHtml(l.name)}</div>
            <div class="truncate text-slate-500">${escapeHtml(l.original_filename)} · ${formatBytes(l.file_size)}</div>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <a href="/uploads/${l.file_path}" target="_blank" class="link">Öppna</a>
          <button type="button" class="text-slate-400 hover:text-red-600" data-remove-logo="${l.id}">✕</button>
        </div>
      </li>`
    )
    .join("");
  // Filer som inte går att rendera (t.ex. en trasig EPS) visar filtypen
  // istället för en bruten bild.
  for (const img of el.logoList.querySelectorAll("[data-logo-thumb]")) {
    img.addEventListener("error", () => {
      img.replaceWith(Object.assign(document.createElement("span"), {
        className: "text-xs font-semibold uppercase text-slate-400",
        textContent: img.dataset.ext || "fil",
      }));
    }, { once: true });
  }
}

function fileExtension(name) {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1) : "";
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
  el.invoiceEmail.value = customer.invoice_email ?? "";
  el.phone.value = customer.phone ?? "";
  el.address.value = customer.address ?? "";
  el.postal.value = customer.postal_code ?? "";
  el.city.value = customer.city ?? "";
  el.terms.value = customer.payment_terms_days ?? 30;
  el.notes.value = customer.notes ?? "";
  renderContacts(customer.contacts);
  renderLogos(customer.logos);

  el.statsSection.classList.remove("hidden");
  el.statYear.textContent = money(customer.stats.total_purchased_this_year);
  el.statAllTime.textContent = money(customer.stats.total_purchased_all_time);
  el.statLastOrder.textContent = customer.stats.last_order_at
    ? new Date(customer.stats.last_order_at).toLocaleDateString("sv-SE")
    : "–";
  el.statPendingQuotes.textContent = String(customer.stats.pending_quotes);

  const { rows: suppliers } = await api.get("/suppliers");
  el.discountSupplierOptions.innerHTML = suppliers.map((s) => `<option value="${escapeHtml(s.name)}">`).join("");

  const { rows: discounts } = await api.get(`/customers/${customerId}/discounts`);
  renderDiscounts(discounts);

  const { rows: assortment } = await api.get(`/customers/${customerId}/assortment`);
  renderAssortment(assortment);

  await loadTemplates();
  await loadHistory();
}

const QUOTE_STATUS_LABELS = {
  DRAFT: "Utkast",
  SENT: "Skickad",
  VIEWED: "Visad",
  ACCEPTED: "Accepterad",
  DECLINED: "Avböjd",
  EXPIRED: "Utgången",
  CONVERTED: "Omvandlad till order",
};

const ORDER_STATUS_LABELS = {
  NEW: "Order",
  READY_FOR_PICKUP: "Redo för utlämning",
  DELIVERED: "Utlämnad",
  INVOICED: "Fakturerad",
  CANCELLED: "Avbruten",
};

async function loadHistory() {
  const [{ rows: quoteRows }, { rows: orderRows }] = await Promise.all([
    api.get(`/quotes?customerId=${customerId}&pageSize=10`),
    api.get(`/orders?customerId=${customerId}&pageSize=10`),
  ]);

  el.historySection.classList.remove("hidden");
  document.getElementById("quotes-all-link").href = `/offerter.html?customerId=${customerId}`;
  document.getElementById("orders-all-link").href = `/ordrar.html?customerId=${customerId}`;

  el.quotesEmpty.classList.toggle("hidden", quoteRows.length > 0);
  el.quotesList.innerHTML = quoteRows
    .map(
      (q) => `
      <li>
        <a href="/offert-editor.html?id=${q.id}" class="flex items-center justify-between py-2 text-sm hover:bg-slate-50 -mx-2 px-2 rounded">
          <span>
            <span class="font-medium text-slate-900">${escapeHtml(q.quote_number)}</span>
            <span class="ml-2 text-xs text-slate-500">${new Date(q.created_at).toLocaleDateString("sv-SE")}</span>
          </span>
          <span class="text-xs text-slate-500">${QUOTE_STATUS_LABELS[q.status] ?? q.status}</span>
        </a>
      </li>`
    )
    .join("");

  el.ordersEmpty.classList.toggle("hidden", orderRows.length > 0);
  el.ordersList.innerHTML = orderRows
    .map(
      (o) => `
      <li>
        <a href="/order-editor.html?id=${o.id}" class="flex items-center justify-between py-2 text-sm hover:bg-slate-50 -mx-2 px-2 rounded">
          <span>
            <span class="font-medium text-slate-900">${escapeHtml(o.order_number)}</span>
            <span class="ml-2 text-xs text-slate-500">${new Date(o.created_at).toLocaleDateString("sv-SE")}</span>
          </span>
          <span class="text-xs text-slate-500">${ORDER_STATUS_LABELS[o.status] ?? o.status}</span>
        </a>
      </li>`
    )
    .join("");
}

async function loadTemplates() {
  const { rows } = await api.get(`/order-templates?customerId=${customerId}`);
  el.templatesEmpty.classList.toggle("hidden", rows.length > 0);
  el.templateRows.innerHTML = rows
    .map(
      (t) => `
      <li class="flex items-center justify-between py-2 text-sm" data-template-id="${t.id}">
        <div>
          <span class="font-medium text-slate-900">${escapeHtml(t.name)}</span>
          <span class="ml-2 text-xs text-slate-500">${t.line_count} rad${t.line_count === 1 ? "" : "er"}</span>
        </div>
        <span class="flex gap-2">
          <button type="button" class="text-red-600 underline text-xs" data-delete-template="${t.id}">Ta bort</button>
          <button type="button" class="btn-secondary" data-use-template="${t.id}">Skapa order</button>
        </span>
      </li>`
    )
    .join("");
}

el.templateRows.addEventListener("click", async (event) => {
  const useId = event.target.dataset.useTemplate;
  const deleteId = event.target.dataset.deleteTemplate;
  if (useId !== undefined) {
    const order = await api.post(`/order-templates/${useId}/create-order`, {});
    location.href = `/order-editor.html?id=${order.id}`;
    return;
  }
  if (deleteId !== undefined) {
    if (!confirm("Ta bort mallen? Detta går inte att ångra.")) return;
    await api.delete(`/order-templates/${deleteId}`);
    loadTemplates();
  }
});

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
      <li class="py-2 text-sm" data-assortment-product="${p.product_id}">
        <div class="flex items-center justify-between">
          <div>
            <span class="font-medium text-slate-900">${escapeHtml(p.name)}</span>
            <span class="ml-2 text-slate-500">${escapeHtml(p.article_number)}</span>
            ${variantBadge}${discountBadge}
          </div>
          <button type="button" class="text-slate-400 hover:text-red-600" data-remove-assortment="${p.product_id}">✕</button>
        </div>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="text"
            class="input flex-1 min-w-[180px]"
            placeholder="Förifyllt tryck (valfritt)"
            data-print-description="${p.product_id}"
            value="${escapeHtml(p.print_description ?? "")}"
          />
          <input
            type="number"
            min="0"
            step="0.01"
            class="input w-28"
            placeholder="Tryckpris"
            data-print-price="${p.product_id}"
            value="${p.print_price ?? ""}"
          />
          <button type="button" class="btn-secondary text-xs" data-save-print="${p.product_id}">Spara tryck</button>
        </div>
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
      invoiceEmail: el.invoiceEmail.value || null,
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
  const removeId = event.target.dataset.removeAssortment;
  if (removeId !== undefined) {
    await api.delete(`/customers/${customerId}/assortment/${removeId}`);
    loadCustomer();
    return;
  }

  const saveId = event.target.dataset.savePrint;
  if (saveId !== undefined) {
    const item = el.assortmentList.querySelector(`[data-assortment-product="${saveId}"]`);
    const description = item.querySelector(`[data-print-description="${saveId}"]`).value;
    const price = item.querySelector(`[data-print-price="${saveId}"]`).value;
    await api.patch(`/customers/${customerId}/assortment/${saveId}`, {
      printDescription: description || null,
      printPrice: price === "" ? null : Number(price),
    });
    const originalLabel = event.target.textContent;
    event.target.textContent = "Sparat!";
    setTimeout(() => (event.target.textContent = originalLabel), 1500);
  }
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
