import { api } from "../api.js";

const params = new URLSearchParams(location.search);
const quoteId = params.get("id");

const state = {
  status: "DRAFT",
  customerId: null,
  customerName: "",
  publicToken: null,
  lines: [],
};

let printMethods = [];

const el = {
  title: document.getElementById("page-title"),
  statusBadge: document.getElementById("status-badge"),
  actionButtons: document.getElementById("action-buttons"),
  customerPicker: document.getElementById("customer-picker"),
  customerSearch: document.getElementById("customer-search"),
  customerResults: document.getElementById("customer-results"),
  customerSelected: document.getElementById("customer-selected"),
  customerSelectedName: document.getElementById("customer-selected-name"),
  customerChangeBtn: document.getElementById("customer-change-btn"),
  referenceSelect: document.getElementById("reference-select"),
  lineSearchWrap: document.getElementById("line-search-wrap"),
  lineSearch: document.getElementById("line-search"),
  lineResults: document.getElementById("line-results"),
  lineRows: document.getElementById("line-rows"),
  linesEmpty: document.getElementById("lines-empty"),
  totalsSubtotal: document.getElementById("totals-subtotal"),
  totalsVat: document.getElementById("totals-vat"),
  totalsTotal: document.getElementById("totals-total"),
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
  return Number(line.quantity) * Number(line.unitPrice) * (1 - Number(line.discountPercent) / 100);
}

function renderTotals() {
  const subtotal = state.lines.reduce((sum, l) => sum + lineTotal(l), 0);
  const vat = state.lines.reduce((sum, l) => sum + lineTotal(l) * (Number(l.taxRatePercent) / 100), 0);
  el.totalsSubtotal.textContent = money(subtotal);
  el.totalsVat.textContent = money(vat);
  el.totalsTotal.textContent = money(subtotal + vat);
}

const isEditable = () => state.status === "DRAFT";

function renderLines() {
  el.linesEmpty.classList.toggle("hidden", state.lines.length > 0);

  el.lineRows.innerHTML = state.lines
    .map((line, index) => {
      const productCell = `<div class="font-medium text-slate-900">${escapeHtml(line.name)}</div><div class="text-xs text-slate-500">${escapeHtml(line.colorSize)}</div>`;

      if (!isEditable()) {
        return `
          <tr>
            <td class="py-2 pr-3">${productCell}</td>
            <td class="py-2 pr-3">${line.quantity}</td>
            <td class="py-2 pr-3">${money(line.unitPrice)}</td>
            <td class="py-2 pr-3">${line.discountPercent} %</td>
            <td class="py-2 pr-3">${escapeHtml(line.printMethodName ?? "")}${line.printDescription ? " – " + escapeHtml(line.printDescription) : ""}</td>
            <td class="py-2 pr-3 text-right">${money(lineTotal(line))}</td>
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
            <select class="input" data-field="printMethodId" data-index="${index}">
              <option value="">Inget tryck</option>
              ${printMethods.map((pm) => `<option value="${pm.id}" ${Number(line.printMethodId) === pm.id ? "selected" : ""}>${escapeHtml(pm.name)}</option>`).join("")}
            </select>
            <input type="text" class="input mt-1" placeholder="Beskrivning" data-field="printDescription" data-index="${index}" value="${escapeHtml(line.printDescription ?? "")}" />
          </td>
          <td class="py-2 pr-3 text-right">${money(lineTotal(line))}</td>
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
  if (field === "printMethodId") {
    line.printMethodId = event.target.value || null;
  } else if (field === "printDescription") {
    line.printDescription = event.target.value;
  } else {
    line[field] = Number(event.target.value);
  }
  renderTotals();
  // Only the total cell needs refreshing on numeric edits, but a full
  // re-render is simpler and cheap at this scale.
  if (field === "quantity" || field === "unitPrice" || field === "discountPercent") {
    const row = event.target.closest("tr");
    row.querySelector("td:nth-last-child(2)").textContent = money(lineTotal(line));
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
    const { rows } = await api.get(`/products/search?q=${encodeURIComponent(q)}`);
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
    discountPercent: 0,
    printMethodId: null,
    printDescription: "",
    taxRatePercent: Number(v.tax_rate_percent),
  });
  el.lineSearch.value = "";
  el.lineResults.innerHTML = "";
  renderLines();
});

// --- Customer picker ---------------------------------------------------

function selectCustomer(id, name) {
  state.customerId = id;
  state.customerName = name;
  el.customerPicker.classList.add("hidden");
  el.customerSelected.classList.remove("hidden");
  el.customerSelected.classList.add("flex");
  el.customerSelectedName.textContent = name;
  loadContacts(id);
}

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
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPercent: l.discountPercent,
      printMethodId: l.printMethodId || null,
      printDescription: l.printDescription || null,
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
  if (quote.status === "DRAFT") {
    buttons.push(`<button type="button" id="send-btn" class="btn">Skicka offert</button>`);
  }
  if (["SENT", "VIEWED", "ACCEPTED", "DECLINED", "EXPIRED", "CONVERTED"].includes(quote.status)) {
    buttons.push(`<a href="/api/quotes/${quote.id}/pdf" target="_blank" class="btn-secondary">Visa PDF</a>`);
    buttons.push(`<a href="/q/${quote.public_token}" target="_blank" class="btn-secondary">Öppna offentlig länk</a>`);
  }
  if (quote.status === "ACCEPTED") {
    buttons.push(`<button type="button" id="convert-btn" class="btn">Konvertera till order</button>`);
  }
  el.actionButtons.innerHTML = buttons.join("");

  document.getElementById("send-btn")?.addEventListener("click", async () => {
    await api.post(`/quotes/${quote.id}/send`, {});
    location.reload();
  });
  document.getElementById("convert-btn")?.addEventListener("click", async () => {
    try {
      await api.post(`/quotes/${quote.id}/convert-to-order`, {});
      alert("Order skapad! Se Ordrar-sidan.");
      location.reload();
    } catch (err) {
      alert(err.message);
    }
  });
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
  printMethods = (await api.get("/print-methods")).rows;

  if (quoteId) {
    const quote = await api.get(`/quotes/${quoteId}`);
    state.status = quote.status;
    state.publicToken = quote.public_token;
    state.lines = quote.lines.map((l) => ({
      productVariantId: l.product_variant_id,
      name: l.product_name,
      colorSize: [l.color, l.size, l.sku].filter(Boolean).join(" · "),
      quantity: Number(l.quantity),
      unitPrice: Number(l.unit_price),
      discountPercent: Number(l.discount_percent),
      printMethodId: l.print_method_id,
      printMethodName: l.print_method_name,
      printDescription: l.print_description ?? "",
      taxRatePercent: Number(l.tax_rate_percent),
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
