import { api } from "../api.js";
import { openNewCustomerDialog, openNewContactDialog } from "../quick-add.js";

const params = new URLSearchParams(location.search);
const quoteId = params.get("id");

const state = {
  status: "DRAFT",
  customerId: null,
  customerName: "",
  publicToken: null,
  lines: [],
};

const el = {
  title: document.getElementById("page-title"),
  statusBadge: document.getElementById("status-badge"),
  actionButtons: document.getElementById("action-buttons"),
  emailNotification: document.getElementById("email-notification"),
  customerPicker: document.getElementById("customer-picker"),
  customerSearch: document.getElementById("customer-search"),
  customerResults: document.getElementById("customer-results"),
  customerSelected: document.getElementById("customer-selected"),
  customerSelectedName: document.getElementById("customer-selected-name"),
  customerChangeBtn: document.getElementById("customer-change-btn"),
  referenceSelect: document.getElementById("reference-select"),
  newCustomerQuickBtn: document.getElementById("new-customer-quick-btn"),
  newContactQuickBtn: document.getElementById("new-contact-quick-btn"),
  lineSearchWrap: document.getElementById("line-search-wrap"),
  lineSearch: document.getElementById("line-search"),
  lineResults: document.getElementById("line-results"),
  lineRows: document.getElementById("line-rows"),
  addFritextBtn: document.getElementById("add-fritext-btn"),
  fritextDialog: document.getElementById("fritext-dialog"),
  fritextForm: document.getElementById("fritext-form"),
  cancelFritextBtn: document.getElementById("cancel-fritext-btn"),
  addProductBtn: document.getElementById("add-product-btn"),
  newProductDialog: document.getElementById("new-product-dialog"),
  newProductForm: document.getElementById("new-product-form"),
  cancelNewProductBtn: document.getElementById("cancel-new-product-btn"),
  newProductError: document.getElementById("new-product-error"),
  newProductSupplierOptions: document.getElementById("new-product-supplier-options"),
  linesEmpty: document.getElementById("lines-empty"),
  totalsSubtotal: document.getElementById("totals-subtotal"),
  totalsVat: document.getElementById("totals-vat"),
  totalsTotal: document.getElementById("totals-total"),
  totalsMargin: document.getElementById("totals-margin"),
  validUntil: document.getElementById("valid-until"),
  notes: document.getElementById("notes"),
  formError: document.getElementById("form-error"),
  saveBtn: document.getElementById("save-btn"),
  historySection: document.getElementById("history-section"),
  historyList: document.getElementById("history-list"),
};

const STATUS_LABELS = {
  DRAFT: "Utkast",
  SENT: "Skickad",
  VIEWED: "Visad",
  ACCEPTED: "Accepterad",
  DECLINED: "Avböjd",
  EXPIRED: "Utgången",
  CONVERTED: "Omvandlad till order",
};
const STATUS_COLORS = {
  DRAFT: "bg-slate-100 text-slate-700",
  SENT: "bg-blue-100 text-blue-700",
  VIEWED: "bg-indigo-100 text-indigo-700",
  ACCEPTED: "bg-green-100 text-green-700",
  DECLINED: "bg-red-100 text-red-700",
  EXPIRED: "bg-amber-100 text-amber-700",
  CONVERTED: "bg-slate-900 text-white",
};

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function money(value) {
  return `${Number(value).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
}

function lineTotal(line) {
  const productTotal = Number(line.quantity) * Number(line.unitPrice) * (1 - Number(line.discountPercent) / 100);
  const printTotal = line.printPrice
    ? Number(line.quantity) * Number(line.printPrice) * (1 - Number(line.printDiscountPercent || 0) / 100)
    : 0;
  return productTotal + printTotal;
}

// null when the product has no cost price on file — margin is unknown,
// not zero.
function lineMargin(line) {
  if (line.costPrice === null || line.costPrice === undefined) return null;
  return lineTotal(line) - Number(line.quantity) * Number(line.costPrice);
}

function marginLabel(margin) {
  return margin === null ? "–" : money(margin);
}

function renderTotals() {
  const subtotal = state.lines.reduce((sum, l) => sum + lineTotal(l), 0);
  const vat = state.lines.reduce((sum, l) => sum + lineTotal(l) * (Number(l.taxRatePercent) / 100), 0);
  const margins = state.lines.map(lineMargin).filter((m) => m !== null);
  const marginAmount = margins.reduce((sum, m) => sum + m, 0);

  el.totalsSubtotal.textContent = money(subtotal);
  el.totalsVat.textContent = money(vat);
  el.totalsTotal.textContent = money(subtotal + vat);

  const percent = subtotal > 0 ? (marginAmount / subtotal) * 100 : 0;
  const incomplete = margins.length < state.lines.length && state.lines.length > 0;
  el.totalsMargin.textContent = `${money(marginAmount)} (${percent.toFixed(1)} %)${incomplete ? " *" : ""}`;
}

const isEditable = () => state.status === "DRAFT";

function renderLines() {
  el.linesEmpty.classList.toggle("hidden", state.lines.length > 0);

  el.lineRows.innerHTML = state.lines
    .map((line, index) => {
      const productCell = `<div class="font-medium text-slate-900">${escapeHtml(line.name)}</div><div class="text-xs text-slate-500">${escapeHtml(line.colorSize)}</div>`;

      if (!isEditable()) {
        const printSummary = line.printDescription
          ? `<div>${escapeHtml(line.printDescription)}</div><div class="text-xs text-slate-500">${money(line.printPrice || 0)}${Number(line.printDiscountPercent) > 0 ? ` (-${line.printDiscountPercent} %)` : ""}</div>`
          : "";
        return `
          <tr>
            <td class="py-2 pr-3">${productCell}</td>
            <td class="py-2 pr-3">${line.quantity}</td>
            <td class="py-2 pr-3">${money(line.unitPrice)}</td>
            <td class="py-2 pr-3">${line.discountPercent} %</td>
            <td class="py-2 pr-3">${printSummary}</td>
            <td class="py-2 pr-3 text-right">${money(lineTotal(line))}</td>
            <td class="py-2 pr-3 text-right text-slate-500">${marginLabel(lineMargin(line))}</td>
            <td></td>
          </tr>`;
      }

      return `
        <tr>
          <td class="py-2 pr-3">${productCell}</td>
          <td class="py-2 pr-3"><input type="number" min="0.01" step="1" class="input" data-field="quantity" data-index="${index}" value="${line.quantity}" /></td>
          <td class="py-2 pr-3"><input type="number" min="0" step="0.01" class="input" data-field="unitPrice" data-index="${index}" value="${line.unitPrice}" /></td>
          <td class="py-2 pr-3"><input type="number" min="0" max="100" step="1" class="input" data-field="discountPercent" data-index="${index}" value="${line.discountPercent}" /></td>
          <td class="py-2 pr-3">
            <input type="text" class="input" placeholder="Tryckbeskrivning (valfritt)" data-field="printDescription" data-index="${index}" value="${escapeHtml(line.printDescription ?? "")}" />
            <div class="mt-1 flex gap-1">
              <input type="number" min="0" step="0.01" class="input" placeholder="Tryckpris" data-field="printPrice" data-index="${index}" value="${line.printPrice ?? ""}" />
              <input type="number" min="0" max="100" step="1" class="input" placeholder="Rabatt %" data-field="printDiscountPercent" data-index="${index}" value="${line.printDiscountPercent || 0}" />
            </div>
          </td>
          <td class="py-2 pr-3 text-right">${money(lineTotal(line))}</td>
          <td class="py-2 pr-3 text-right text-slate-500">${marginLabel(lineMargin(line))}</td>
          <td><button type="button" class="text-slate-400 hover:text-red-600" data-remove="${index}">✕</button></td>
        </tr>`;
    })
    .join("");

  renderTotals();
}

el.lineRows.addEventListener("input", (event) => {
  const { field, index } = event.target.dataset;
  if (field === undefined) return;
  const line = state.lines[Number(index)];
  if (field === "printDescription") {
    line.printDescription = event.target.value;
  } else if (field === "printPrice") {
    line.printPrice = event.target.value === "" ? null : Number(event.target.value);
  } else {
    line[field] = Number(event.target.value);
  }
  renderTotals();
  // Only the total/margin cells need refreshing on numeric edits — patch
  // them in place rather than a full re-render so the input being typed
  // into doesn't lose focus.
  if (["quantity", "unitPrice", "discountPercent", "printPrice", "printDiscountPercent"].includes(field)) {
    const row = event.target.closest("tr");
    row.querySelector("td:nth-last-child(3)").textContent = money(lineTotal(line));
    row.querySelector("td:nth-last-child(2)").textContent = marginLabel(lineMargin(line));
  }
});

el.lineRows.addEventListener("click", (event) => {
  const index = event.target.dataset.remove;
  if (index === undefined) return;
  state.lines.splice(Number(index), 1);
  renderLines();
});

// --- Product search for adding lines --------------------------------

let lineSearchTimer;
el.lineSearch.addEventListener("input", () => {
  clearTimeout(lineSearchTimer);
  const q = el.lineSearch.value.trim();
  if (!q) {
    el.lineResults.innerHTML = "";
    return;
  }
  lineSearchTimer = setTimeout(async () => {
    const customerParam = state.customerId ? `&customerId=${state.customerId}` : "";
    const { rows } = await api.get(`/products/search?q=${encodeURIComponent(q)}${customerParam}`);
    el.lineResults.innerHTML = rows
      .map(
        (v) => `
        <button type="button" class="block w-full px-3 py-2 text-left hover:bg-slate-50" data-variant='${JSON.stringify(v).replace(/'/g, "&#39;")}'>
          <div class="font-medium text-slate-900">${escapeHtml(v.name)}</div>
          <div class="text-xs text-slate-500">${escapeHtml([v.color, v.size, v.sku].filter(Boolean).join(" · "))} — ${money(v.price_override ?? v.base_price)}</div>
        </button>`
      )
      .join("");
  }, 200);
});

el.lineResults.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-variant]");
  if (!button) return;
  const v = JSON.parse(button.dataset.variant);
  state.lines.push({
    productVariantId: v.variant_id,
    name: v.name,
    colorSize: [v.color, v.size, v.sku].filter(Boolean).join(" · "),
    quantity: 1,
    unitPrice: Number(v.price_override ?? v.base_price),
    discountPercent: Number(v.suggested_discount_percent ?? 0),
    printDescription: "",
    printPrice: null,
    printDiscountPercent: 0,
    taxRatePercent: Number(v.tax_rate_percent),
    costPrice: v.cost_price === null || v.cost_price === undefined ? null : Number(v.cost_price),
  });
  el.lineSearch.value = "";
  el.lineResults.innerHTML = "";
  renderLines();
});

// --- Fritextrad (free-text line) ----------------------------------------

el.addFritextBtn.addEventListener("click", () => {
  el.fritextForm.reset();
  el.fritextDialog.showModal();
});
el.cancelFritextBtn.addEventListener("click", () => el.fritextDialog.close());

el.fritextForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(el.fritextForm).entries());
  const description = form.description.trim();
  const quantity = Number(form.quantity);
  const unitPrice = Number(form.unitPrice);
  if (!description || !(quantity > 0) || Number.isNaN(unitPrice)) return;

  state.lines.push({
    productVariantId: null,
    description,
    name: description,
    colorSize: "Fritextrad",
    quantity,
    unitPrice,
    discountPercent: 0,
    printDescription: form.printDescription || "",
    printPrice: form.printPrice ? Number(form.printPrice) : null,
    printDiscountPercent: Number(form.printDiscountPercent) || 0,
    taxRatePercent: Number(form.taxRatePercent) || 25,
    costPrice: null,
  });
  el.fritextDialog.close();
  renderLines();
});

// --- Quick-create a new product while building the line list -----------

el.addProductBtn.addEventListener("click", () => {
  el.newProductForm.reset();
  el.newProductError.classList.add("hidden");
  el.newProductDialog.showModal();
});
el.cancelNewProductBtn.addEventListener("click", () => el.newProductDialog.close());

el.newProductForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  el.newProductError.classList.add("hidden");
  const form = Object.fromEntries(new FormData(el.newProductForm).entries());
  const basePrice = Number(form.basePrice);
  if (!form.name.trim() || Number.isNaN(basePrice)) return;

  const hasVariantInfo = Boolean(form.color || form.size);

  try {
    const product = await api.post("/products", {
      name: form.name.trim(),
      articleNumber: form.articleNumber.trim() || undefined,
      supplier: form.supplier,
      basePrice,
      costPrice: form.costPrice ? Number(form.costPrice) : undefined,
      variants: hasVariantInfo ? [{ color: form.color || null, size: form.size || null }] : undefined,
    });
    const v = product.variants[0];
    state.lines.push({
      productVariantId: v.id,
      description: null,
      name: product.name,
      colorSize: [v.color, v.size, v.sku].filter(Boolean).join(" · "),
      quantity: 1,
      unitPrice: Number(product.base_price),
      discountPercent: 0,
      printDescription: "",
      printPrice: null,
      printDiscountPercent: 0,
      taxRatePercent: Number(product.tax_rate_percent),
      costPrice: product.cost_price === null || product.cost_price === undefined ? null : Number(product.cost_price),
    });
    el.newProductDialog.close();
    renderLines();
  } catch (err) {
    el.newProductError.textContent = err.message;
    el.newProductError.classList.remove("hidden");
  }
});

// --- Customer picker ---------------------------------------------------

function selectCustomer(id, name) {
  state.customerId = id;
  state.customerName = name;
  el.customerPicker.classList.add("hidden");
  el.customerSelected.classList.remove("hidden");
  el.customerSelected.classList.add("flex");
  el.customerSelectedName.textContent = name;
  el.newContactQuickBtn.disabled = false;
  loadContacts(id);
}

el.newCustomerQuickBtn.addEventListener("click", () => {
  openNewCustomerDialog((customer) => {
    selectCustomer(customer.id, customer.name);
    el.customerSearch.value = "";
    el.customerResults.innerHTML = "";
  });
});

el.newContactQuickBtn.addEventListener("click", () => {
  if (!state.customerId) return;
  openNewContactDialog(state.customerId, (contact) => loadContacts(state.customerId, contact.id));
});

async function loadContacts(customerId, selectedId) {
  const customer = await api.get(`/customers/${customerId}`);
  el.referenceSelect.innerHTML =
    `<option value="">Ingen referens</option>` +
    customer.contacts
      .map((c) => `<option value="${c.id}" ${String(selectedId) === String(c.id) ? "selected" : ""}>${escapeHtml(c.name)}${c.can_pickup ? " (hämtbehörig)" : ""}</option>`)
      .join("");
}

let customerSearchTimer;
el.customerSearch.addEventListener("input", () => {
  clearTimeout(customerSearchTimer);
  const q = el.customerSearch.value.trim();
  if (!q) {
    el.customerResults.innerHTML = "";
    return;
  }
  customerSearchTimer = setTimeout(async () => {
    const { rows } = await api.get(`/customers?search=${encodeURIComponent(q)}`);
    el.customerResults.innerHTML = rows
      .map(
        (c) => `<button type="button" class="block w-full px-3 py-2 text-left hover:bg-slate-50" data-id="${c.id}" data-name="${escapeHtml(c.name)}">${escapeHtml(c.name)}</button>`
      )
      .join("");
  }, 200);
});

el.customerResults.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-id]");
  if (!button) return;
  selectCustomer(Number(button.dataset.id), button.dataset.name);
  el.customerSearch.value = "";
  el.customerResults.innerHTML = "";
});

el.customerChangeBtn.addEventListener("click", () => {
  el.customerSelected.classList.add("hidden");
  el.customerSelected.classList.remove("flex");
  el.customerPicker.classList.remove("hidden");
});

// --- Save / actions ------------------------------------------------------

el.saveBtn.addEventListener("click", async () => {
  el.formError.classList.add("hidden");
  if (!state.customerId) {
    el.formError.textContent = "Välj en kund först.";
    el.formError.classList.remove("hidden");
    return;
  }
  if (state.lines.length === 0) {
    el.formError.textContent = "Lägg till minst en rad.";
    el.formError.classList.remove("hidden");
    return;
  }

  const payload = {
    customerId: state.customerId,
    referenceContactId: el.referenceSelect.value || null,
    validUntil: el.validUntil.value || null,
    notes: el.notes.value || null,
    lines: state.lines.map((l) => ({
      productVariantId: l.productVariantId,
      description: l.productVariantId ? null : l.description ?? l.name,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPercent: l.discountPercent,
      taxRatePercent: l.taxRatePercent,
      printDescription: l.printDescription || null,
      printPrice: l.printPrice ?? null,
      printDiscountPercent: l.printDiscountPercent || 0,
    })),
  };

  try {
    if (quoteId) {
      await api.patch(`/quotes/${quoteId}`, payload);
      location.reload();
    } else {
      const created = await api.post("/quotes", payload);
      location.href = `/offert-editor.html?id=${created.id}`;
    }
  } catch (err) {
    el.formError.textContent = err.message;
    el.formError.classList.remove("hidden");
  }
});

function renderActionButtons(quote) {
  const buttons = [];
  const hasEmail = Boolean(quote.customer_email);
  if (quote.status === "DRAFT") {
    buttons.push(`<button type="button" id="send-btn" class="btn-secondary">Skicka offert</button>`);
  }
  buttons.push(
    `<button type="button" id="email-btn" class="btn" ${hasEmail ? "" : "disabled"} title="${hasEmail ? "" : "Kunden saknar e-postadress"}">Maila offert till kund</button>`
  );
  if (["SENT", "VIEWED", "ACCEPTED", "DECLINED", "EXPIRED", "CONVERTED"].includes(quote.status)) {
    buttons.push(`<a href="/api/quotes/${quote.id}/pdf" target="_blank" class="btn-secondary">Visa PDF</a>`);
    buttons.push(`<a href="/q/${quote.public_token}" target="_blank" class="btn-secondary">Öppna offentlig länk</a>`);
  }
  if (quote.status === "ACCEPTED") {
    buttons.push(`<button type="button" id="convert-btn" class="btn">Konvertera till order</button>`);
  }
  buttons.push(`<button type="button" id="duplicate-btn" class="btn-secondary">Duplicera</button>`);
  el.actionButtons.innerHTML = buttons.join("");

  document.getElementById("send-btn")?.addEventListener("click", async () => {
    await api.post(`/quotes/${quote.id}/send`, {});
    location.reload();
  });
  document.getElementById("email-btn")?.addEventListener("click", async () => {
    try {
      const result = await api.post(`/quotes/${quote.id}/email`, {});
      if (result.notification) {
        sessionStorage.setItem("quote-email-notification", JSON.stringify(result.notification));
      }
      location.reload();
    } catch (err) {
      alert(err.message);
    }
  });
  document.getElementById("convert-btn")?.addEventListener("click", async () => {
    try {
      const order = await api.post(`/quotes/${quote.id}/convert-to-order`, {});
      location.href = `/order-editor.html?id=${order.id}`;
    } catch (err) {
      alert(err.message);
    }
  });
  document.getElementById("duplicate-btn")?.addEventListener("click", async () => {
    try {
      const duplicate = await api.post(`/quotes/${quote.id}/duplicate`, {});
      location.href = `/offert-editor.html?id=${duplicate.id}`;
    } catch (err) {
      alert(err.message);
    }
  });

  const pending = sessionStorage.getItem("quote-email-notification");
  if (pending) {
    sessionStorage.removeItem("quote-email-notification");
    const notification = JSON.parse(pending);
    el.emailNotification.textContent = notification.sent
      ? "E-post skickad till kunden."
      : `E-post skickades inte: ${notification.reason ?? "okänt fel"}`;
    el.emailNotification.classList.remove("hidden");
  }
}

function applyEditableState() {
  const editable = isEditable();
  el.lineSearchWrap.classList.toggle("hidden", !editable);
  el.saveBtn.classList.toggle("hidden", !editable);
  el.customerChangeBtn.classList.toggle("hidden", !editable);
  el.referenceSelect.disabled = !editable;
  el.validUntil.disabled = !editable;
  el.notes.disabled = !editable;
}

async function init() {
  const suppliers = (await api.get("/suppliers")).rows;
  el.newProductSupplierOptions.innerHTML = suppliers.map((s) => `<option value="${escapeHtml(s.name)}">`).join("");

  if (quoteId) {
    const quote = await api.get(`/quotes/${quoteId}`);
    state.status = quote.status;
    state.publicToken = quote.public_token;
    state.lines = quote.lines.map((l) => ({
      productVariantId: l.product_variant_id,
      description: l.product_variant_id ? null : l.description,
      name: l.product_name,
      colorSize: l.product_variant_id ? [l.color, l.size, l.sku].filter(Boolean).join(" · ") : "Fritextrad",
      quantity: Number(l.quantity),
      unitPrice: Number(l.unit_price),
      discountPercent: Number(l.discount_percent),
      printDescription: l.print_description ?? "",
      printPrice: l.print_price === null || l.print_price === undefined ? null : Number(l.print_price),
      printDiscountPercent: Number(l.print_discount_percent ?? 0),
      taxRatePercent: Number(l.tax_rate_percent),
      costPrice: l.cost_price === null || l.cost_price === undefined ? null : Number(l.cost_price),
    }));

    el.title.textContent = `Offert ${quote.quote_number}`;
    el.statusBadge.textContent = STATUS_LABELS[quote.status] ?? quote.status;
    el.statusBadge.className = `mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[quote.status] ?? ""}`;
    el.validUntil.value = quote.valid_until ? quote.valid_until.slice(0, 10) : "";
    el.notes.value = quote.notes ?? "";

    selectCustomer(quote.customer_id, quote.customer_name);
    await loadContacts(quote.customer_id, quote.reference_contact_id);

    if (quote.events?.length > 0) {
      el.historySection.classList.remove("hidden");
      el.historyList.innerHTML = quote.events
        .map((e) => `<li>${new Date(e.created_at).toLocaleString("sv-SE")} – ${escapeHtml(e.type)}</li>`)
        .join("");
    }

    renderActionButtons(quote);
    applyEditableState();
  } else {
    applyEditableState();
  }

  renderLines();
}

init();
