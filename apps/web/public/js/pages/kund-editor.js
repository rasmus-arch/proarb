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
  cash: document.getElementById("f-cash"),
  saveBtn: document.getElementById("save-btn"),
  deleteBtn: document.getElementById("delete-customer-btn"),
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
  el.cash.checked = Boolean(customer.is_cash_customer);
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

el.assortmentList?.addEventListener("change", (event) => {
  const id = event.target.dataset.discountType;
  if (id === undefined) return;
  const input = el.assortmentList.querySelector(`[data-discount-value="${id}"]`);
  input.disabled = event.target.value === "";
  if (input.disabled) input.value = "";
  else input.focus();
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
        Number(p.discount_amount) > 0
          ? `<span class="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">-${Number(p.discount_amount)} kr/st</span>`
          : Number(p.discount_percent) > 0
            ? `<span class="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">-${Number(p.discount_percent)}% rabatt</span>`
            : "";
      // Egen rabatt i sortimentet (% eller kr/st) — annars gäller kundens
      // stående rabatt (leverantör/produkt), som visas i badgen ovan.
      const ownType =
        Number(p.assortment_discount_amount) > 0 ? "amount" : p.assortment_discount_percent !== null ? "percent" : "";
      const ownValue =
        ownType === "amount" ? Number(p.assortment_discount_amount) : ownType === "percent" ? Number(p.assortment_discount_percent) : "";
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
          <span class="w-14 text-xs text-slate-500">Rabatt</span>
          <select class="input w-auto" data-discount-type="${p.product_id}">
            <option value="" ${ownType === "" ? "selected" : ""}>Kundens stående rabatt</option>
            <option value="percent" ${ownType === "percent" ? "selected" : ""}>Rabatt i %</option>
            <option value="amount" ${ownType === "amount" ? "selected" : ""}>Rabatt i kr/st</option>
          </select>
          <input type="number" min="0" step="0.01" class="input w-24" placeholder="0" data-discount-value="${p.product_id}"
            value="${ownValue}" ${ownType === "" ? "disabled" : ""} />
        </div>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <span class="w-14 text-xs text-slate-500">Tryck</span>
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
          <input type="number" min="0" max="100" step="0.01" class="input w-24" placeholder="Rabatt %" title="Rabatt på trycket i %"
            data-print-discount="${p.product_id}" value="${Number(p.print_discount_percent) > 0 ? Number(p.print_discount_percent) : ""}" />
          <button type="button" class="btn-secondary text-xs" data-save-print="${p.product_id}">Spara</button>
        </div>
      </li>`;
    })
    .join("");
}

// Kunden döljs (raderas inte) — ordrar, offerter och fakturor finns kvar.
// Bara för administratörer, samma behörighet som API:t kräver.
api
  .get("/auth/me")
  .then(({ user }) => el.deleteBtn.classList.toggle("hidden", user?.role !== "ADMIN"))
  .catch(() => {});

el.deleteBtn.addEventListener("click", async () => {
  const ok = confirm(
    `Ta bort ${el.name.value || "kunden"}?\n\nKunden försvinner från kundlistan, sökningen och påminnelserna, och portallänken slutar fungera. Kundens ordrar, offerter och fakturor finns kvar.`
  );
  if (!ok) return;
  try {
    await api.delete(`/customers/${customerId}`);
    location.href = "/kunder.html";
  } catch (err) {
    el.saveError.textContent = err.message;
    el.saveError.classList.remove("hidden");
  }
});

el.saveBtn.addEventListener("click", async () => {
  el.saveError.classList.add("hidden");
  try {
    const saved = await api.patch(`/customers/${customerId}`, {
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
      isCashCustomer: el.cash.checked,
    });
    el.title.textContent = el.name.value;
    // Fortnox-synk (bara när Fortnox är anslutet).
    const status = document.getElementById("save-status");
    const sync = saved.fortnox_sync;
    status.className = `ml-auto text-sm ${sync && !sync.synced ? "text-amber-700" : "text-green-700"}`;
    status.textContent = !sync
      ? "Sparat."
      : sync.synced
        ? `Sparat och uppdaterat i Fortnox (kundnr ${sync.customerNumber}).`
        : `Sparat här, men inte i Fortnox: ${sync.reason}`;
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
    const printDiscount = item.querySelector(`[data-print-discount="${saveId}"]`).value;
    const discountType = item.querySelector(`[data-discount-type="${saveId}"]`).value;
    const discountValue = item.querySelector(`[data-discount-value="${saveId}"]`).value;
    const { rows } = await api.patch(`/customers/${customerId}/assortment/${saveId}`, {
      printDescription: description || null,
      printPrice: price === "" ? null : Number(price),
      printDiscountPercent: Number(printDiscount) || 0,
      discountPercent: discountType === "percent" ? Number(discountValue) || 0 : null,
      discountAmount: discountType === "amount" ? Number(discountValue) || 0 : null,
    });
    renderAssortment(rows);
    const savedBtn = el.assortmentList.querySelector(`[data-save-print="${saveId}"]`);
    if (savedBtn) {
      savedBtn.textContent = "Sparat!";
      setTimeout(() => (savedBtn.textContent = "Spara"), 1500);
    }
  }
});

// --- Kundportal ----------------------------------------------------------

// --- Sortilog-inloggningar -------------------------------------------------

const accountEl = {
  list: document.getElementById("portal-account-list"),
  empty: document.getElementById("portal-accounts-empty"),
  form: document.getElementById("portal-account-form"),
  message: document.getElementById("portal-account-message"),
  loginUrl: document.getElementById("sortilog-login-url"),
};

function showAccountMessage(text, kind = "ok") {
  accountEl.message.className = `mt-2 text-sm ${kind === "error" ? "text-red-600" : kind === "warn" ? "text-amber-700" : "text-green-700"}`;
  accountEl.message.innerHTML = text;
}

// Gick inbjudan inte att mejla (t.ex. ingen SMTP) visas länken så att den
// kan skickas på annat sätt.
function inviteMessage(email, invite) {
  if (invite.sent) return showAccountMessage(`Inbjudan skickad till ${escapeHtml(email)}.`);
  showAccountMessage(
    `Mejlet kunde inte skickas (${escapeHtml(invite.reason ?? "okänt fel")}). Skicka den här länken till ${escapeHtml(email)} själv — den gäller i 7 dagar:<br /><input readonly class="input mt-1 w-full text-xs" value="${escapeHtml(invite.inviteUrl ?? "")}" onclick="this.select()" />`,
    "warn"
  );
}

async function loadPortalAccounts() {
  const { rows, loginUrl } = await api.get(`/customers/${customerId}/portal-accounts`);
  accountEl.loginUrl.href = loginUrl;
  accountEl.loginUrl.textContent = loginUrl.replace(/^https?:\/\//, "");
  accountEl.empty.classList.toggle("hidden", rows.length > 0);
  accountEl.list.innerHTML = rows
    .map(
      (a) => `
      <li class="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
        <div>
          <span class="font-medium text-slate-900">${escapeHtml(a.name || a.email)}</span>
          ${a.name ? `<span class="ml-1 text-slate-500">${escapeHtml(a.email)}</span>` : ""}
          <span class="chip ml-1">${
            a.has_password
              ? a.last_login_at
                ? `Senast inloggad ${new Date(a.last_login_at).toLocaleDateString("sv-SE")}`
                : "Aktiv"
              : "Inbjuden"
          }</span>
        </div>
        <div class="flex items-center gap-3">
          <button type="button" class="link text-xs" data-edit-account="${a.id}">Ändra</button>
          <button type="button" class="link text-xs" data-invite-account="${a.id}" data-email="${escapeHtml(a.email)}">${a.has_password ? "Mejla länk för nytt lösenord" : "Skicka inbjudan igen"}</button>
          <button type="button" class="text-slate-400 hover:text-red-600" data-remove-account="${a.id}" title="Ta bort inloggningen">✕</button>
        </div>
        <form class="hidden w-full flex-wrap items-end gap-2 rounded-md bg-slate-50 p-2" data-edit-form="${a.id}">
          <label class="block text-xs"><span class="text-slate-600">Namn</span>
            <input name="name" class="input mt-1 w-44" value="${escapeHtml(a.name ?? "")}" /></label>
          <label class="block text-xs"><span class="text-slate-600">E-post</span>
            <input name="email" type="email" required class="input mt-1 w-56" value="${escapeHtml(a.email)}" /></label>
          <label class="block text-xs"><span class="text-slate-600">Nytt lösenord</span>
            <input name="password" type="password" autocomplete="new-password" class="input mt-1 w-44" placeholder="Tomt = oförändrat" /></label>
          <button type="submit" class="btn text-xs">Spara</button>
          <button type="button" class="btn-secondary text-xs" data-edit-cancel="${a.id}">Avbryt</button>
        </form>
      </li>`
    )
    .join("");
}

accountEl.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(accountEl.form).entries());
  try {
    const { invite } = await api.post(`/customers/${customerId}/portal-accounts`, form);
    accountEl.form.reset();
    if (invite) inviteMessage(form.email, invite);
    else showAccountMessage(`Inloggningen för ${escapeHtml(form.email)} är skapad med lösenordet du angav.`);
    await loadPortalAccounts();
  } catch (err) {
    showAccountMessage(escapeHtml(err.message), "error");
  }
});

accountEl.list.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-edit-form]");
  if (!form) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    await api.patch(`/customers/${customerId}/portal-accounts/${form.dataset.editForm}`, {
      name: data.name,
      email: data.email,
      password: data.password || undefined,
    });
    showAccountMessage(
      data.password ? "Sparat. Lösenordet är bytt och personen har loggats ut överallt." : "Sparat."
    );
    await loadPortalAccounts();
  } catch (err) {
    showAccountMessage(escapeHtml(err.message), "error");
  }
});

accountEl.list.addEventListener("click", async (event) => {
  const editBtn = event.target.closest("[data-edit-account], [data-edit-cancel]");
  if (editBtn) {
    const id = editBtn.dataset.editAccount ?? editBtn.dataset.editCancel;
    const form = accountEl.list.querySelector(`[data-edit-form="${id}"]`);
    form.classList.toggle("hidden");
    form.classList.toggle("flex", !form.classList.contains("hidden"));
    return;
  }
  const inviteBtn = event.target.closest("[data-invite-account]");
  if (inviteBtn) {
    try {
      const invite = await api.post(`/customers/${customerId}/portal-accounts/${inviteBtn.dataset.inviteAccount}/invite`, {});
      inviteMessage(inviteBtn.dataset.email, invite);
    } catch (err) {
      showAccountMessage(escapeHtml(err.message), "error");
    }
    return;
  }
  const removeBtn = event.target.closest("[data-remove-account]");
  if (removeBtn) {
    if (!confirm("Ta bort inloggningen? Personen loggas ut direkt och kan inte logga in igen.")) return;
    await api.delete(`/customers/${customerId}/portal-accounts/${removeBtn.dataset.removeAccount}`);
    accountEl.message.className = "hidden";
    await loadPortalAccounts();
  }
});

loadPortalAccounts().catch(() => {});

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
