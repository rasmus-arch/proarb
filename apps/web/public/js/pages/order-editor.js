import { api } from "../api.js";
import { loadMarginThresholds, marginCellHtml, renderMarginCell, marginLevel, marginSummaryText } from "../margin.js";
import { ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from "../order-status.js";
import { openNewCustomerDialog, openNewContactDialog } from "../quick-add.js";

const params = new URLSearchParams(location.search);
const orderId = params.get("id");

const state = {
  customerId: null,
  customerName: "",
  status: "NEW",
  lines: [],
  contacts: [],
};

const el = {
  title: document.getElementById("page-title"),
  statusBadge: document.getElementById("status-badge"),
  actionButtons: document.getElementById("action-buttons"),
  statusNotification: document.getElementById("status-notification"),
  customerPicker: document.getElementById("customer-picker"),
  customerSearch: document.getElementById("customer-search"),
  customerResults: document.getElementById("customer-results"),
  customerSelected: document.getElementById("customer-selected"),
  customerSelectedName: document.getElementById("customer-selected-name"),
  customerChangeBtn: document.getElementById("customer-change-btn"),
  customerNotesBanner: document.getElementById("customer-notes-banner"),
  customerNotesText: document.getElementById("customer-notes-text"),
  referenceSelect: document.getElementById("reference-select"),
  deliveryMethod: document.getElementById("delivery-method"),
  skipInventory: document.getElementById("skip-inventory"),
  newCustomerQuickBtn: document.getElementById("new-customer-quick-btn"),
  newContactQuickBtn: document.getElementById("new-contact-quick-btn"),
  newPickupContactQuickBtn: document.getElementById("new-pickup-contact-quick-btn"),
  lineSearchWrap: document.getElementById("line-search-wrap"),
  scanInput: document.getElementById("scan-input"),
  scanError: document.getElementById("scan-error"),
  lineSearch: document.getElementById("line-search"),
  lineResults: document.getElementById("line-results"),
  lineRows: document.getElementById("line-rows"),
  addFritextBtn: document.getElementById("add-fritext-btn"),
  fritextDialog: document.getElementById("fritext-dialog"),
  fritextForm: document.getElementById("fritext-form"),
  cancelFritextBtn: document.getElementById("cancel-fritext-btn"),
  addProductBtn: document.getElementById("add-product-btn"),
  addKitBtnOpen: document.getElementById("add-kit-btn-open"),
  kitDialog: document.getElementById("kit-dialog"),
  kitSelect: document.getElementById("kit-select"),
  kitPreviewWrap: document.getElementById("kit-preview-wrap"),
  kitPreviewRows: document.getElementById("kit-preview-rows"),
  kitError: document.getElementById("kit-error"),
  cancelKitBtn: document.getElementById("cancel-kit-btn"),
  addKitBtn: document.getElementById("add-kit-btn"),
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
  formError: document.getElementById("form-error"),
  saveRow: document.getElementById("save-row"),
  saveBtn: document.getElementById("save-btn"),
  cashCompleteBtn: document.getElementById("cash-complete-btn"),
  pickupTitle: document.getElementById("pickup-title"),
  pickupIntro: document.getElementById("pickup-intro"),
  pickupFields: document.getElementById("pickup-fields"),
  saveLinesRow: document.getElementById("save-lines-row"),
  saveLinesBtn: document.getElementById("save-lines-btn"),
  pickupSection: document.getElementById("pickup-section"),
  pickupContactSelect: document.getElementById("pickup-contact-select"),
  pickupNameInput: document.getElementById("pickup-name-input"),
  pickupError: document.getElementById("pickup-error"),
  pickupBtn: document.getElementById("pickup-btn"),
  historySection: document.getElementById("history-section"),
  historyList: document.getElementById("history-list"),
  returnsSection: document.getElementById("returns-section"),
  returnsList: document.getElementById("returns-list"),
  newReturnBtn: document.getElementById("new-return-btn"),
  returnDialog: document.getElementById("return-dialog"),
  returnRows: document.getElementById("return-rows"),
  returnReason: document.getElementById("return-reason"),
  returnError: document.getElementById("return-error"),
  cancelReturnBtn: document.getElementById("cancel-return-btn"),
  submitReturnBtn: document.getElementById("submit-return-btn"),
};

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function money(value) {
  return `${Number(value).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
}

// Opens the ordersedel PDF in its own tab and triggers that tab's print
// dialog once it's loaded — a new tab (not a hidden iframe) so it isn't
// killed by this page's own navigation right afterward. Popup-blocked or
// blocked by a slow load just leaves the PDF tab open for a manual print.
function printOrderSlip(orderId) {
  const win = window.open(`/api/orders/${orderId}/pdf`, "_blank");
  if (!win) return;
  win.addEventListener("load", () => {
    try {
      win.print();
    } catch {
      // Printing straight from the PDF viewer isn't always allowed —
      // the tab stays open either way so staff can print manually.
    }
  });
}

function lineTotal(line) {
  // Rabatt i % eller kr/st (discountAmount = avdrag på à-priset), se api lib/lines.js.
  const productTotal =
    Number(line.quantity) *
    (Number(line.unitPrice) * (1 - Number(line.discountPercent || 0) / 100) - Number(line.discountAmount || 0));
  const printTotal = line.printPrice
    ? Number(line.quantity) * Number(line.printPrice) * (1 - Number(line.printDiscountPercent || 0) / 100)
    : 0;
  return productTotal + printTotal;
}

// null when the product has no cost price on file — margin is unknown,
// not zero.
function discountLabel(line) {
  return Number(line.discountAmount) > 0 ? `${money(line.discountAmount)}/st` : `${line.discountPercent || 0} %`;
}

function lineMargin(line) {
  if (line.costPrice === null || line.costPrice === undefined) return null;
  return lineTotal(line) - Number(line.quantity) * Number(line.costPrice);
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
  // En fritextrad utan inköpspris gör marginalen okänd för hela
  // ordern/offerten — den räknas då inte heller med i statistiken.
  const excluded = state.lines.some((l) => !l.productVariantId && (l.costPrice === null || l.costPrice === undefined));
  el.totalsMargin.textContent = excluded
    ? "Räknas inte"
    : `${money(marginAmount)} (${percent.toFixed(1)} %)${incomplete ? " *" : ""}`;
  el.totalsMargin.title = excluded
    ? "En fritextrad saknar inköpspris — fyll i det för att räkna marginalen. Utan det räknas den här ordern inte med i marginalstatistiken."
    : incomplete
      ? "* En eller flera produkter saknar inköpspris"
      : "";

  const warningEl = document.getElementById("margin-warning");
  const summary = marginSummaryText(state.lines.map((l) => marginLevel(lineMargin(l), lineTotal(l))));
  warningEl.classList.toggle("hidden", !summary);
  if (summary) {
    warningEl.textContent = summary.text;
    warningEl.className = `mt-2 text-right text-xs ${summary.level === "critical" ? "text-red-600" : "text-amber-700"}`;
  }
}

const isNewOrder = () => !orderId;

// Rader går att redigera (antal/pris/tryck) inte bara på en helt ny,
// osparad order, utan också på en redan sparad order så länge inget
// fysiskt lämnat butiken än (NEW/READY_FOR_PICKUP) — t.ex. för att dra ner
// antalet på en rad som visar sig vara restnoterad vid plockning, innan
// ordern markeras redo. Låst så fort ordern är DELIVERED/INVOICED/
// CANCELLED, eftersom lagerrörelser och ev. faktura redan bygger på de
// ursprungliga raderna vid det laget.
const LINE_EDITABLE_STATUSES = ["NEW", "READY_FOR_PICKUP"];
const canEditLines = () => isNewOrder() || LINE_EDITABLE_STATUSES.includes(state.status);

function renderLines() {
  el.linesEmpty.classList.toggle("hidden", state.lines.length > 0);

  el.lineRows.innerHTML = state.lines
    .map((line, index) => {
      const costInput =
        !line.productVariantId && canEditLines()
          ? `<label class="mt-1 flex items-center gap-1.5 text-xs text-slate-500">Inköpspris <input type="number" min="0" step="0.01" class="input w-24 py-1 text-xs" placeholder="saknas" data-field="costPrice" data-index="${index}" value="${line.costPrice ?? ""}" /></label>`
          : "";
      const productCell = `<div class="font-medium text-slate-900">${escapeHtml(line.name)}</div><div class="text-xs text-slate-500">${escapeHtml(line.colorSize)}</div>${costInput}`;

      if (!canEditLines()) {
        const printSummary = line.printDescription
          ? `<div>${escapeHtml(line.printDescription)}</div><div class="text-xs text-slate-500">${money(line.printPrice || 0)}${Number(line.printDiscountPercent) > 0 ? ` (-${line.printDiscountPercent} %)` : ""}</div>`
          : "";
        return `
          <tr>
            <td class="py-2 pr-3">${productCell}</td>
            <td class="py-2 pr-3">${line.quantity}</td>
            <td class="py-2 pr-3">${money(line.unitPrice)}</td>
            <td class="py-2 pr-3">${discountLabel(line)}</td>
            <td class="py-2 pr-3 text-right" data-cell="total">${money(lineTotal(line))}</td>
            ${marginCellHtml(lineMargin(line), lineTotal(line), money)}
            <td class="py-2 pr-3">${printSummary}</td>
            <td></td>
          </tr>`;
      }

      return `
        <tr>
          <td class="py-2 pr-3">${productCell}</td>
          <td class="py-2 pr-3"><input type="number" min="0.01" step="1" class="input" data-field="quantity" data-index="${index}" value="${line.quantity}" /></td>
          <td class="py-2 pr-3"><input type="number" min="0" step="0.01" class="input" data-field="unitPrice" data-index="${index}" value="${line.unitPrice}" /></td>
          <td class="py-2 pr-3">
            <div class="flex">
              <input type="number" min="0" step="0.01" class="input w-20 min-w-[4.5rem] rounded-r-none px-2" data-field="discountValue" data-index="${index}" value="${Number(line.discountAmount) > 0 ? line.discountAmount : line.discountPercent || 0}" />
              <select class="input w-[4.5rem] shrink-0 rounded-l-none border-l-0 px-1.5" data-field="discountType" data-index="${index}" title="Rabatt i procent eller kronor per styck">
                <option value="percent" ${Number(line.discountAmount) > 0 ? "" : "selected"}>%</option>
                <option value="amount" ${Number(line.discountAmount) > 0 ? "selected" : ""}>kr/st</option>
              </select>
            </div>
          </td>
          <td class="py-2 pr-3 text-right" data-cell="total">${money(lineTotal(line))}</td>
          ${marginCellHtml(lineMargin(line), lineTotal(line), money)}
          <td class="py-2 pr-3">
            <input type="text" class="input" placeholder="Tryckbeskrivning (valfritt)" data-field="printDescription" data-index="${index}" value="${escapeHtml(line.printDescription ?? "")}" />
            <div class="mt-1 flex gap-1">
              <input type="number" min="0" step="0.01" class="input" placeholder="Tryckpris" data-field="printPrice" data-index="${index}" value="${line.printPrice ?? ""}" />
              <input type="number" min="0" max="100" step="1" class="input" placeholder="Rabatt %" data-field="printDiscountPercent" data-index="${index}" value="${line.printDiscountPercent || 0}" />
            </div>
          </td>
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
    return;
  } else if (field === "discountValue") {
    const value = Number(event.target.value) || 0;
    if (Number(line.discountAmount) > 0 || event.target.nextElementSibling?.value === "amount") {
      line.discountAmount = value;
      line.discountPercent = 0;
    } else {
      line.discountPercent = value;
      line.discountAmount = 0;
    }
  } else if (field === "discountType") {
    // Byt form och räkna om så att rabatten i kronor blir ungefär densamma.
    const price = Number(line.unitPrice) || 0;
    if (event.target.value === "amount") {
      line.discountAmount = Math.round(price * (Number(line.discountPercent) || 0)) / 100;
      line.discountPercent = 0;
    } else {
      line.discountPercent = price > 0 ? Math.round(((Number(line.discountAmount) || 0) / price) * 10000) / 100 : 0;
      line.discountAmount = 0;
    }
    const input = event.target.previousElementSibling;
    input.value = event.target.value === "amount" ? line.discountAmount : line.discountPercent;
  } else if (field === "costPrice") {
    line.costPrice = event.target.value === "" ? null : Number(event.target.value);
  } else if (field === "printPrice") {
    line.printPrice = event.target.value === "" ? null : Number(event.target.value);
  } else {
    line[field] = Number(event.target.value);
  }

  renderTotals();
  if (["quantity", "unitPrice", "discountValue", "discountType", "printPrice", "printDiscountPercent", "costPrice"].includes(field)) {
    const row = event.target.closest("tr");
    row.querySelector('[data-cell="total"]').textContent = money(lineTotal(line));
    renderMarginCell(row.querySelector('[data-cell="margin"]'), lineMargin(line), lineTotal(line), money);
  }
});

el.lineRows.addEventListener("click", (event) => {
  const index = event.target.dataset.remove;
  if (index === undefined) return;
  state.lines.splice(Number(index), 1);
  renderLines();
});

// Shared by barcode scan and product search — both resolve to a variant
// shaped the same way.
function variantToLine(v) {
  return {
    productVariantId: v.variant_id,
    name: v.name,
    colorSize: [v.color, v.size, v.sku].filter(Boolean).join(" · "),
    quantity: 1,
    unitPrice: Number(v.price_override ?? v.base_price),
    discountPercent: Number(v.suggested_discount_percent ?? 0),
    discountAmount: Number(v.suggested_discount_amount ?? 0),
    printDescription: v.assortment_print_description ?? "",
    printPrice: v.assortment_print_price === null || v.assortment_print_price === undefined ? null : Number(v.assortment_print_price),
    printDiscountPercent: Number(v.assortment_print_discount_percent ?? 0),
    taxRatePercent: Number(v.tax_rate_percent),
    costPrice: v.cost_price === null || v.cost_price === undefined ? null : Number(v.cost_price),
  };
}

// --- Barcode scanning (replaces the old kassa/POS flow — same lookup,
// scanners act as keyboard wedges typing the code + Enter) ----------------

async function handleScan(barcode) {
  el.scanError.classList.add("hidden");
  try {
    const customerParam = state.customerId ? `?customerId=${state.customerId}` : "";
    const v = await api.get(`/products/by-barcode/${encodeURIComponent(barcode)}${customerParam}`);
    // Rescanning the same item just bumps its quantity instead of adding a
    // duplicate row — the point of a barcode workflow is scan-scan-scan.
    const existing = state.lines.find((l) => l.productVariantId === v.variant_id);
    if (existing) {
      existing.quantity = Number(existing.quantity) + 1;
    } else {
      state.lines.push(variantToLine(v));
    }
    renderLines();
  } catch (err) {
    el.scanError.textContent = err.message;
    el.scanError.classList.remove("hidden");
  }
}

el.scanInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const barcode = el.scanInput.value.trim();
  el.scanInput.value = "";
  if (barcode) handleScan(barcode);
});

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
          <div class="font-medium text-slate-900">${escapeHtml(v.name)}${v.discontinued ? `<span class="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Utgått · ${Number(v.quantity_on_hand) || 0} i lager</span>` : ""}</div>
          <div class="text-xs text-slate-500">${escapeHtml([v.color, v.size, v.sku].filter(Boolean).join(" · "))} — ${money(v.price_override ?? v.base_price)}</div>
        </button>`
      )
      .join("");
  }, 200);
});

el.lineResults.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-variant]");
  if (!button) return;
  state.lines.push(variantToLine(JSON.parse(button.dataset.variant)));
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
    costPrice: form.costPrice === "" || form.costPrice === undefined ? null : Number(form.costPrice),
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

// --- Produktpaket: välj ett färdigt paket, lägg till alla rader på en
// gång istället för en sökning per produkt -------------------------------

let kitCache = null;
let selectedKit = null;

el.addKitBtnOpen.addEventListener("click", async () => {
  el.kitError.classList.add("hidden");
  el.kitPreviewWrap.classList.add("hidden");
  el.addKitBtn.disabled = true;
  selectedKit = null;
  if (!kitCache) {
    kitCache = (await api.get("/kits")).rows;
  }
  el.kitSelect.innerHTML =
    `<option value="">— Välj paket —</option>` +
    kitCache.map((k) => `<option value="${k.id}">${escapeHtml(k.name)} (${k.line_count} produkter)</option>`).join("");
  el.kitSelect.value = "";
  el.kitDialog.showModal();
});

el.cancelKitBtn.addEventListener("click", () => el.kitDialog.close());

el.kitSelect.addEventListener("change", async () => {
  const id = el.kitSelect.value;
  if (!id) {
    el.kitPreviewWrap.classList.add("hidden");
    el.addKitBtn.disabled = true;
    return;
  }
  const customerParam = state.customerId ? `?customerId=${state.customerId}` : "";
  selectedKit = await api.get(`/kits/${id}${customerParam}`);
  el.kitPreviewRows.innerHTML = selectedKit.lines
    .map(
      (l) => `
      <tr>
        <td class="py-1 pr-3">${escapeHtml(l.name)}<div class="text-xs text-slate-500">${escapeHtml([l.color, l.size].filter(Boolean).join(" / "))}</div></td>
        <td class="py-1 pr-3 text-right">${l.kit_quantity}</td>
        <td class="py-1 pr-3 text-right">${money(l.price_override ?? l.base_price)}</td>
      </tr>`
    )
    .join("");
  el.kitPreviewWrap.classList.remove("hidden");
  el.addKitBtn.disabled = false;
});

el.addKitBtn.addEventListener("click", () => {
  if (!selectedKit) return;
  for (const l of selectedKit.lines) {
    const line = variantToLine(l);
    line.quantity = Number(l.kit_quantity) || 1;
    state.lines.push(line);
  }
  el.kitDialog.close();
  renderLines();
});

// --- Customer picker (shared pattern with offert-editor) -----------------

function selectCustomer(id, name) {
  state.customerId = id;
  state.customerName = name;
  el.customerPicker.classList.add("hidden");
  el.customerSelected.classList.remove("hidden");
  el.customerSelected.classList.add("flex");
  el.customerSelectedName.textContent = name;
  el.newContactQuickBtn.disabled = false;
  el.newPickupContactQuickBtn.disabled = false;
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

el.newPickupContactQuickBtn.addEventListener("click", () => {
  if (!state.customerId) return;
  openNewContactDialog(state.customerId, async (contact) => {
    await loadContacts(state.customerId, el.referenceSelect.value);
    el.pickupContactSelect.value = String(contact.id);
  });
});

async function loadContacts(customerId, selectedId) {
  const customer = await api.get(`/customers/${customerId}`);
  state.contacts = customer.contacts;
  applyCashMode(Boolean(customer.is_cash_customer));

  // Only relevant while creating a NEW order — staff should see anything
  // noted about the customer before adding lines/leveranssätt etc. An
  // already-saved order doesn't re-show this (nothing left to act on).
  const hasNote = isNewOrder() && Boolean(customer.notes?.trim());
  el.customerNotesBanner.classList.toggle("hidden", !hasNote);
  if (hasNote) el.customerNotesText.textContent = customer.notes;
  el.referenceSelect.innerHTML =
    `<option value="">Ingen referens</option>` +
    customer.contacts
      .map((c) => `<option value="${c.id}" ${String(selectedId) === String(c.id) ? "selected" : ""}>${escapeHtml(c.name)}${c.can_pickup ? " (hämtbehörig)" : ""}</option>`)
      .join("");

  el.pickupContactSelect.innerHTML =
    `<option value="">— Välj —</option>` +
    customer.contacts
      .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}${c.can_pickup ? " (hämtbehörig)" : ""}</option>`)
      .join("");
}

// Kontantkund (t.ex. Swish-kunden): köpet är betalt på plats. En ny order
// kan skapas och slutföras i ett steg, och utlämningen kräver ingen
// legitimering — den skapar en kontantfaktura i Fortnox som inte skickas.
function applyCashMode(isCash) {
  state.isCash = isCash;
  el.cashCompleteBtn.classList.toggle("hidden", !(isCash && isNewOrder()));
  el.saveBtn.className = isCash && isNewOrder() ? "btn-secondary" : "btn";
  el.pickupTitle.textContent = isCash ? "Slutför köp" : "Registrera utlämning";
  el.pickupIntro.textContent = isCash
    ? "Kontantkund — när köpet är betalt skapas en kontantfaktura i Fortnox (skickas inte till någon) och ordern blir fakturerad direkt."
    : "Välj en hämtberättigad kontakt hos kunden, eller ange namn manuellt.";
  el.pickupFields.classList.toggle("hidden", isCash);
  el.pickupBtn.textContent = isCash ? "Betald – slutför köp" : "Registrera utlämning";
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

// --- Save (new orders only) ----------------------------------------------

el.saveBtn.addEventListener("click", () => createOrder({ completeCash: false }));
el.cashCompleteBtn.addEventListener("click", () => createOrder({ completeCash: true }));

async function createOrder({ completeCash }) {
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
    deliveryMethod: el.deliveryMethod.value,
    skipInventory: el.skipInventory.checked,
    lines: state.lines.map((l) => ({
      productVariantId: l.productVariantId,
      description: l.productVariantId ? null : l.description ?? l.name,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPercent: l.discountPercent,
      discountAmount: Number(l.discountAmount) || 0,
      taxRatePercent: l.taxRatePercent,
      printDescription: l.printDescription || null,
      printPrice: l.printPrice ?? null,
      printDiscountPercent: l.printDiscountPercent || 0,
      costPrice: l.productVariantId ? null : l.costPrice ?? null,
    })),
  };

  el.saveBtn.disabled = el.cashCompleteBtn.disabled = true;
  try {
    const created = await api.post("/orders", payload);
    if (completeCash) {
      // Ett betalt småköp har inget att plocka eller hämta — ingen ordersedel.
      try {
        await api.post(`/orders/${created.id}/pickup`, {});
      } catch (err) {
        sessionStorage.setItem("order-status-notification", JSON.stringify({ status: "CASH", sent: false, reason: err.message }));
      }
      location.href = `/order-editor.html?id=${created.id}`;
      return;
    }
    try {
      const { auto_print_order_slip } = await api.get("/settings/branding");
      if (auto_print_order_slip) printOrderSlip(created.id);
    } catch {
      // Best-effort only — never block getting to the new order over this.
    }
    location.href = `/order-editor.html?id=${created.id}`;
  } catch (err) {
    el.saveBtn.disabled = el.cashCompleteBtn.disabled = false;
    el.formError.textContent = err.message;
    el.formError.classList.remove("hidden");
  }
}

const INVOICE_TYPE_LABELS = { CUSTOMER_INVOICE: "Faktura", CASH_INVOICE: "Kontantfaktura", CREDIT_INVOICE: "Kreditfaktura" };

function invoiceHistoryItem(inv) {
  const label = INVOICE_TYPE_LABELS[inv.type] ?? "Faktura";
  const number = inv.invoice_number ? ` ${escapeHtml(inv.invoice_number)}` : "";
  let state;
  if (inv.status === "SYNCED") state = `skapad i Fortnox${inv.status_note ? ` — ${escapeHtml(inv.status_note)}` : ""}`;
  else if (inv.status === "FAILED") state = `<span class="text-red-600">misslyckades i Fortnox: ${escapeHtml(inv.status_note ?? "okänt fel")}</span>`;
  else state = `inte skickad till Fortnox${inv.status_note ? ` (${escapeHtml(inv.status_note)})` : ""}`;
  if (inv.status === "SYNCED" && inv.sent_at) state += " · skickad till kunden";
  // Allt som inte kom fram (inte skapad, eller skapad men inte utskickad)
  // kan försökas igen — t.ex. efter att Fortnox anslutits på nytt.
  // Kontantköp med anteckning = skapat men inte bokfört/betalt (äldre
  // ordrar kan ha status SYNCED med en sådan anteckning).
  const unfinishedCash = inv.type === "CASH_INVOICE" && inv.invoice_number && inv.status_note;
  const retry =
    inv.type !== "CREDIT_INVOICE" && (inv.status !== "SYNCED" || unfinishedCash)
      ? ` <button type="button" class="link ml-1 text-xs" data-retry-invoice>Skicka till Fortnox igen</button>`
      : "";
  return `<li>${new Date(inv.created_at).toLocaleString("sv-SE")} – ${label}${number}: ${state}${retry}</li>`;
}

el.historyList.addEventListener("click", async (event) => {
  const btn = event.target.closest("[data-retry-invoice]");
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = "Skickar…";
  el.formError.classList.add("hidden");
  try {
    await api.post(`/orders/${orderId}/invoice/retry`, {});
    location.reload();
  } catch (err) {
    el.formError.textContent = err.message;
    el.formError.classList.remove("hidden");
    btn.disabled = false;
    btn.textContent = "Skicka till Fortnox igen";
  }
});

// --- Status actions + pickup ----------------------------------------------

async function changeStatus(orderId, status, sendEmail) {
  const order = await api.patch(`/orders/${orderId}/status`, { status, sendEmail });
  if (order.notification) {
    sessionStorage.setItem("order-status-notification", JSON.stringify({ status, ...order.notification }));
  }
  location.reload();
}

function notificationText({ status, sent, reason }) {
  if (status === "CASH") return `Ordern skapades men kunde inte slutföras: ${reason ?? "okänt fel"}`;
  const subject = status === "INVOICED" ? "Fakturan" : "E-post till kund";
  return sent ? `${subject} skickades.` : `${subject} skickades inte: ${reason ?? "okänt fel"}`;
}

function renderActionButtons(order) {
  const emailCheckbox = order.allowed_next_statuses.includes("READY_FOR_PICKUP")
    ? `<label class="flex items-center gap-1.5 text-xs text-slate-600">
        <input type="checkbox" id="send-ready-email" checked class="rounded border-slate-300" />
        Skicka mail till kund
      </label>`
    : "";

  el.actionButtons.innerHTML =
    emailCheckbox +
    order.allowed_next_statuses
      .map((s) => `<button type="button" class="btn-secondary" data-status="${s}">${ORDER_STATUS_LABELS[s]}</button>`)
      .join("") +
    `<button type="button" id="duplicate-btn" class="btn-secondary">Duplicera</button>` +
    `<button type="button" id="save-template-btn" class="btn-secondary">Spara som mall</button>` +
    `<button type="button" id="print-slip-btn" class="btn-secondary">Skriv ut ordersedel</button>` +
    (order.status === "CANCELLED"
      ? `<button type="button" id="delete-order-btn" class="btn-secondary text-red-600">Ta bort order</button>`
      : "");

  // Bara avbrutna ordrar kan tas bort (kontrolleras även i API:t).
  document.getElementById("delete-order-btn")?.addEventListener("click", async () => {
    if (!confirm(`Ta bort order ${order.order_number}? Det går inte att ångra.`)) return;
    try {
      await api.delete(`/orders/${order.id}`);
      location.href = "/ordrar.html?status=CANCELLED";
    } catch (err) {
      el.formError.textContent = err.message;
      el.formError.classList.remove("hidden");
    }
  });

  // Sparaknappen för radändringar står under marginalen istället för i
  // åtgärdsraden högst upp — den hör ihop med raderna/summeringen den
  // sparar, inte med statusövergångarna bredvid den.
  el.saveLinesRow.classList.toggle("hidden", !canEditLines());

  el.saveLinesBtn.addEventListener("click", async () => {
    el.formError.classList.add("hidden");
    if (state.lines.length === 0) {
      el.formError.textContent = "Lägg till minst en rad.";
      el.formError.classList.remove("hidden");
      return;
    }
    try {
      await api.patch(`/orders/${order.id}/lines`, {
        referenceContactId: el.referenceSelect.value || null,
        deliveryMethod: el.deliveryMethod.value,
        skipInventory: el.skipInventory.checked,
        lines: state.lines.map((l) => ({
          productVariantId: l.productVariantId,
          description: l.productVariantId ? null : l.description ?? l.name,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discountPercent: l.discountPercent,
          discountAmount: Number(l.discountAmount) || 0,
      discountAmount: Number(l.discountAmount) || 0,
          taxRatePercent: l.taxRatePercent,
          printDescription: l.printDescription || null,
          printPrice: l.printPrice ?? null,
          printDiscountPercent: l.printDiscountPercent || 0,
      costPrice: l.productVariantId ? null : l.costPrice ?? null,
        })),
      });
      location.reload();
    } catch (err) {
      el.formError.textContent = err.message;
      el.formError.classList.remove("hidden");
    }
  });

  el.actionButtons.querySelectorAll("button[data-status]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sendEmail = btn.dataset.status === "READY_FOR_PICKUP" && document.getElementById("send-ready-email")?.checked;
      changeStatus(order.id, btn.dataset.status, Boolean(sendEmail));
    });
  });

  document.getElementById("duplicate-btn").addEventListener("click", async () => {
    try {
      const duplicate = await api.post(`/orders/${order.id}/duplicate`, {});
      location.href = `/order-editor.html?id=${duplicate.id}`;
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById("print-slip-btn").addEventListener("click", () => printOrderSlip(order.id));

  document.getElementById("save-template-btn").addEventListener("click", async () => {
    const name = prompt('Namn på mallen (t.ex. "Vinteruniform 2026"):');
    if (!name?.trim()) return;
    try {
      await api.post(`/orders/${order.id}/save-as-template`, { name: name.trim() });
      alert("Mallen sparades — hittas under kundens sida.");
    } catch (err) {
      alert(err.message);
    }
  });

  const pending = sessionStorage.getItem("order-status-notification");
  if (pending) {
    sessionStorage.removeItem("order-status-notification");
    const notification = JSON.parse(pending);
    el.statusNotification.textContent = notificationText(notification);
    el.statusNotification.classList.remove("hidden");
  }
}

el.pickupBtn.addEventListener("click", async () => {
  el.pickupError.classList.add("hidden");
  try {
    await api.post(`/orders/${orderId}/pickup`, {
      pickedUpByContactId: el.pickupContactSelect.value || null,
      pickedUpByName: el.pickupNameInput.value || null,
    });
    location.reload();
  } catch (err) {
    el.pickupError.textContent = err.message;
    el.pickupError.classList.remove("hidden");
  }
});

// --- Returer ---------------------------------------------------------------

const RETURNABLE_ORDER_STATUSES = ["DELIVERED", "INVOICED"];

async function loadReturns() {
  const { rows: returns } = await api.get(`/orders/${orderId}/returns`);
  if (returns.length === 0) {
    el.returnsList.innerHTML = `<li class="text-slate-500">Inga returer registrerade.</li>`;
    return;
  }
  el.returnsList.innerHTML = returns
    .map((r) => {
      const lines = r.lines
        .map((l) => `<div>${l.quantity} × ${escapeHtml(l.product_name)}${l.color || l.size ? ` (${escapeHtml([l.color, l.size].filter(Boolean).join(" / "))})` : ""}</div>`)
        .join("");
      return `
        <li class="rounded-md border border-slate-200 p-2">
          <div class="flex items-center justify-between">
            <span class="font-medium text-slate-900">${new Date(r.created_at).toLocaleString("sv-SE")}</span>
            <span class="text-slate-500">Krediterat: ${money(r.total_credited)}</span>
          </div>
          ${r.reason ? `<div class="mt-1 text-slate-600">${escapeHtml(r.reason)}</div>` : ""}
          <div class="mt-1 text-slate-600">${lines}</div>
        </li>`;
    })
    .join("");
}

el.newReturnBtn.addEventListener("click", async () => {
  el.returnError.classList.add("hidden");
  el.returnReason.value = "";
  const { rows: lines } = await api.get(`/orders/${orderId}/returnable-lines`);
  const returnable = lines.filter((l) => l.returnable_qty > 0);
  if (returnable.length === 0) {
    el.returnRows.innerHTML = "";
    el.returnError.textContent = "Inget kvar att returnera på den här ordern.";
    el.returnError.classList.remove("hidden");
    el.returnDialog.showModal();
    return;
  }
  el.returnRows.innerHTML = returnable
    .map(
      (l) => `
      <tr data-order-line-id="${l.order_line_id}">
        <td class="py-1 pr-3">${escapeHtml(l.product_name)}${l.color || l.size ? `<div class="text-xs text-slate-500">${escapeHtml([l.color, l.size].filter(Boolean).join(" / "))}</div>` : ""}</td>
        <td class="py-1 pr-3 text-right">${l.returnable_qty}</td>
        <td class="py-1 pr-3"><input type="number" min="0" max="${l.returnable_qty}" step="1" class="input" value="0" /></td>
      </tr>`
    )
    .join("");
  el.returnDialog.showModal();
});

el.cancelReturnBtn.addEventListener("click", () => el.returnDialog.close());

el.submitReturnBtn.addEventListener("click", async () => {
  el.returnError.classList.add("hidden");
  const returnLines = [...el.returnRows.querySelectorAll("tr[data-order-line-id]")]
    .map((row) => ({
      orderLineId: Number(row.dataset.orderLineId),
      quantity: Number(row.querySelector("input").value),
    }))
    .filter((l) => l.quantity > 0);

  if (returnLines.length === 0) {
    el.returnError.textContent = "Ange antal för minst en rad.";
    el.returnError.classList.remove("hidden");
    return;
  }

  try {
    await api.post(`/orders/${orderId}/returns`, { reason: el.returnReason.value || null, lines: returnLines });
    el.returnDialog.close();
    location.reload();
  } catch (err) {
    el.returnError.textContent = err.message;
    el.returnError.classList.remove("hidden");
  }
});

function applyReadOnlyState() {
  const linesEditable = canEditLines();
  el.lineSearchWrap.classList.toggle("hidden", !linesEditable);
  el.referenceSelect.disabled = !linesEditable;
  el.deliveryMethod.disabled = !linesEditable;
  el.skipInventory.disabled = !linesEditable;

  // "Spara" (skapa ny order) är bara för en helt osparad order — en
  // befintlig sparas via "Spara ändringar" i åtgärdsknapparna istället
  // (se renderActionButtons), som PATCHar raderna istället för att POSTa
  // en ny order.
  const isNew = isNewOrder();
  el.saveRow.classList.toggle("hidden", !isNew);
  el.customerChangeBtn.classList.toggle("hidden", !isNew);
}

async function init() {
  await loadMarginThresholds();
  const suppliers = (await api.get("/suppliers")).rows;
  el.newProductSupplierOptions.innerHTML = suppliers.map((s) => `<option value="${escapeHtml(s.name)}">`).join("");

  if (orderId) {
    const order = await api.get(`/orders/${orderId}`);
    state.status = order.status;
    state.lines = order.lines.map((l) => ({
      productVariantId: l.product_variant_id,
      description: l.product_variant_id ? null : l.description,
      name: l.product_name,
      colorSize: l.product_variant_id ? [l.color, l.size, l.sku].filter(Boolean).join(" · ") : "Fritextrad",
      quantity: Number(l.quantity),
      unitPrice: Number(l.unit_price),
      discountPercent: Number(l.discount_percent),
      discountAmount: Number(l.discount_amount ?? 0),
      taxRatePercent: Number(l.tax_rate_percent),
      costPrice: l.cost_price === null || l.cost_price === undefined ? null : Number(l.cost_price),
      printDescription: l.print_description ?? "",
      printPrice: l.print_price === null || l.print_price === undefined ? null : Number(l.print_price),
      printDiscountPercent: Number(l.print_discount_percent ?? 0),
    }));

    el.title.textContent = `Order ${order.order_number}`;
    el.statusBadge.textContent = ORDER_STATUS_LABELS[order.status] ?? order.status;
    el.statusBadge.className = `mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${ORDER_STATUS_COLORS[order.status] ?? ""}`;
    el.deliveryMethod.value = order.delivery_method;
    el.skipInventory.checked = Boolean(order.skip_inventory);

    selectCustomer(order.customer_id, order.customer_name);
    await loadContacts(order.customer_id, order.reference_contact_id);

    renderActionButtons(order);
    el.pickupSection.classList.toggle("hidden", !order.can_pickup);

    if (order.pickups?.length > 0 || order.invoices?.length > 0) {
      el.historySection.classList.remove("hidden");
      el.historyList.innerHTML =
        (order.pickups ?? [])
          .map(
            (p) =>
              `<li>${new Date(p.picked_up_at).toLocaleString("sv-SE")} – ${order.is_cash_customer ? "slutfört (betalt på plats)" : `hämtat av ${escapeHtml(p.picked_up_by_contact_name ?? p.picked_up_by_name ?? "okänd")}`}</li>`
          )
          .join("") + (order.invoices ?? []).map(invoiceHistoryItem).join("");
    }

    if (RETURNABLE_ORDER_STATUSES.includes(order.status) || order.has_returns) {
      el.returnsSection.classList.remove("hidden");
      el.newReturnBtn.classList.toggle("hidden", !RETURNABLE_ORDER_STATUSES.includes(order.status));
      await loadReturns();
    }
  }

  applyReadOnlyState();
  renderLines();
}

init();
