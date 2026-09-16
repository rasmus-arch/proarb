import { api } from "../api.js";

const rowsEl = document.getElementById("product-rows");
const emptyStateEl = document.getElementById("empty-state");
const searchEl = document.getElementById("search");

const newProductDialog = document.getElementById("new-product-dialog");
const newProductForm = document.getElementById("new-product-form");
const productFormError = document.getElementById("product-form-error");
const categoryOptions = document.getElementById("category-options");
const brandOptions = document.getElementById("brand-options");
const supplierOptions = document.getElementById("supplier-options");

const editProductDialog = document.getElementById("edit-product-dialog");
const editProductForm = document.getElementById("edit-product-form");
const editProductError = document.getElementById("edit-product-error");
const editCategoryOptions = document.getElementById("edit-category-options");
const editBrandOptions = document.getElementById("edit-brand-options");
const editSupplierOptions = document.getElementById("edit-supplier-options");
const editVariantList = document.getElementById("edit-variant-list");
const editVariantEmpty = document.getElementById("edit-variant-empty");
const editVariantColor = document.getElementById("edit-variant-color");
const editVariantSize = document.getElementById("edit-variant-size");
const editVariantSku = document.getElementById("edit-variant-sku");
const editVariantBarcode = document.getElementById("edit-variant-barcode");
const editVariantError = document.getElementById("edit-variant-error");
const addVariantBtn = document.getElementById("add-variant-btn");

const importDialog = document.getElementById("import-dialog");
const importFileInput = document.getElementById("import-file");
const importStatus = document.getElementById("import-status");

// Cached so "Redigera" can prefill the free-text category/brand/supplier
// inputs by name — GET /api/products/:id only returns the ids.
let categoriesCache = [];
let brandsCache = [];
let suppliersCache = [];

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function formatPrice(price) {
  if (price === null || price === undefined) return "";
  return Number(price).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderRows(products) {
  rowsEl.innerHTML = products
    .map(
      (p) => `
      <tr>
        <td class="py-2 pr-4 text-slate-500">${escapeHtml(p.article_number)}</td>
        <td class="py-2 pr-4 font-medium text-slate-900">${escapeHtml(p.name)}</td>
        <td class="py-2 pr-4">${escapeHtml(p.color)}</td>
        <td class="py-2 pr-4">${escapeHtml(p.size)}</td>
        <td class="py-2 pr-4">${escapeHtml(p.sku)}</td>
        <td class="py-2 pr-4">${escapeHtml(p.barcode)}</td>
        <td class="py-2 pr-4 text-right">${formatPrice(p.base_price)} kr</td>
        <td class="py-2 pr-4 text-right whitespace-nowrap">
          <button type="button" class="text-blue-700 underline" data-edit="${p.id}">Redigera</button>
          <button type="button" class="ml-2 text-red-600 underline" data-delete="${p.id}">Ta bort</button>
        </td>
      </tr>`
    )
    .join("");

  emptyStateEl.classList.toggle("hidden", products.length > 0);
}

let searchTimer;
async function loadProducts() {
  const { rows } = await api.get(`/products?search=${encodeURIComponent(searchEl.value)}`);
  renderRows(rows);
}

searchEl.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadProducts, 250);
});

// --- New product dialog -----------------------------------------------

async function populateDatalists() {
  const [categories, brands, suppliers] = await Promise.all([
    api.get("/categories"),
    api.get("/brands"),
    api.get("/suppliers"),
  ]);
  categoriesCache = categories.rows;
  brandsCache = brands.rows;
  suppliersCache = suppliers.rows;

  categoryOptions.innerHTML = categoriesCache.map((c) => `<option value="${escapeHtml(c.name)}">`).join("");
  brandOptions.innerHTML = brandsCache.map((b) => `<option value="${escapeHtml(b.name)}">`).join("");
  supplierOptions.innerHTML = suppliersCache.map((s) => `<option value="${escapeHtml(s.name)}">`).join("");
  editCategoryOptions.innerHTML = categoryOptions.innerHTML;
  editBrandOptions.innerHTML = brandOptions.innerHTML;
  editSupplierOptions.innerHTML = supplierOptions.innerHTML;
}

document.getElementById("new-product-btn").addEventListener("click", async () => {
  newProductForm.reset();
  productFormError.classList.add("hidden");
  await populateDatalists();
  newProductDialog.showModal();
});

document.getElementById("cancel-product-btn").addEventListener("click", () => newProductDialog.close());

newProductForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(newProductForm).entries());

  const payload = {
    articleNumber: form.articleNumber,
    name: form.name,
    category: form.category || undefined,
    brand: form.brand || undefined,
    supplier: form.supplier,
    basePrice: Number(form.basePrice),
    costPrice: form.costPrice ? Number(form.costPrice) : undefined,
    variants: [
      {
        color: form.variantColor || undefined,
        size: form.variantSize || undefined,
        sku: form.variantSku || undefined,
        barcode: form.variantBarcode || undefined,
      },
    ],
  };

  try {
    await api.post("/products", payload);
    newProductDialog.close();
    await loadProducts();
  } catch (err) {
    productFormError.textContent = err.message;
    productFormError.classList.remove("hidden");
  }
});

// --- Edit / delete product ------------------------------------------------

function renderEditVariants(variants) {
  editVariantEmpty.classList.toggle("hidden", variants.length > 0);
  editVariantList.innerHTML = variants
    .map(
      (v) => `
      <li class="flex items-center justify-between py-1.5">
        <span>
          <span class="font-medium text-slate-900">${escapeHtml([v.color, v.size].filter(Boolean).join(" / ") || "–")}</span>
          <span class="ml-2 text-slate-500">${escapeHtml(v.sku)}${v.barcode ? " · " + escapeHtml(v.barcode) : ""}</span>
        </span>
        <button type="button" class="text-slate-400 hover:text-red-600" data-remove-variant="${v.id}">✕</button>
      </li>`
    )
    .join("");
}

async function openEditDialog(productId) {
  const product = await api.get(`/products/${productId}`);
  editProductError.classList.add("hidden");
  editVariantError.classList.add("hidden");
  editProductForm.reset();
  editProductForm.elements.name.value = product.name ?? "";
  editProductForm.elements.category.value = categoriesCache.find((c) => c.id === product.category_id)?.name ?? "";
  editProductForm.elements.brand.value = brandsCache.find((b) => b.id === product.brand_id)?.name ?? "";
  editProductForm.elements.supplier.value = suppliersCache.find((s) => s.id === product.supplier_id)?.name ?? "";
  editProductForm.elements.basePrice.value = product.base_price ?? "";
  editProductForm.elements.costPrice.value = product.cost_price ?? "";
  editProductForm.dataset.productId = productId;
  renderEditVariants(product.variants.filter((v) => v.active));
  editProductDialog.showModal();
}

rowsEl.addEventListener("click", async (event) => {
  const editBtn = event.target.closest("button[data-edit]");
  const deleteBtn = event.target.closest("button[data-delete]");

  if (editBtn) {
    await openEditDialog(editBtn.dataset.edit);
    return;
  }

  if (deleteBtn) {
    if (!confirm("Ta bort produkten? Den slutar synas i sök och listor, men historik (offerter/ordrar) påverkas inte.")) return;
    await api.delete(`/products/${deleteBtn.dataset.delete}`);
    await loadProducts();
  }
});

document.getElementById("cancel-edit-product-btn").addEventListener("click", () => editProductDialog.close());

addVariantBtn.addEventListener("click", async () => {
  editVariantError.classList.add("hidden");
  try {
    await api.post(`/products/${editProductForm.dataset.productId}/variants`, {
      color: editVariantColor.value || undefined,
      size: editVariantSize.value || undefined,
      sku: editVariantSku.value || undefined,
      barcode: editVariantBarcode.value || undefined,
    });
    editVariantColor.value = "";
    editVariantSize.value = "";
    editVariantSku.value = "";
    editVariantBarcode.value = "";
    const product = await api.get(`/products/${editProductForm.dataset.productId}`);
    renderEditVariants(product.variants.filter((v) => v.active));
    await loadProducts();
  } catch (err) {
    editVariantError.textContent = err.message;
    editVariantError.classList.remove("hidden");
  }
});

editVariantList.addEventListener("click", async (event) => {
  const variantId = event.target.dataset.removeVariant;
  if (variantId === undefined) return;
  await api.delete(`/products/${editProductForm.dataset.productId}/variants/${variantId}`);
  const product = await api.get(`/products/${editProductForm.dataset.productId}`);
  renderEditVariants(product.variants.filter((v) => v.active));
  await loadProducts();
});

editProductForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  editProductError.classList.add("hidden");
  const form = Object.fromEntries(new FormData(editProductForm).entries());

  const payload = {
    name: form.name,
    category: form.category || "",
    brand: form.brand || "",
    supplier: form.supplier,
    basePrice: Number(form.basePrice),
    costPrice: form.costPrice ? Number(form.costPrice) : null,
  };

  try {
    await api.patch(`/products/${editProductForm.dataset.productId}`, payload);
    editProductDialog.close();
    await loadProducts();
  } catch (err) {
    editProductError.textContent = err.message;
    editProductError.classList.remove("hidden");
  }
});

// --- CSV import dialog ---------------------------------------------------

document.getElementById("import-btn").addEventListener("click", () => {
  importFileInput.value = "";
  importStatus.classList.add("hidden");
  importDialog.showModal();
});

document.getElementById("cancel-import-btn").addEventListener("click", () => importDialog.close());

document.getElementById("run-import-btn").addEventListener("click", async () => {
  const file = importFileInput.files[0];
  if (!file) {
    importStatus.textContent = "Välj en CSV-fil först.";
    importStatus.className = "mt-3 text-sm text-red-600";
    return;
  }

  importStatus.textContent = "Importerar…";
  importStatus.className = "mt-3 text-sm text-slate-600";

  try {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/products/import", { method: "POST", body: formData });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Import misslyckades");

    const errorSummary = body.errors.length > 0 ? ` (${body.errors.length} rader hoppades över)` : "";
    importStatus.textContent = `Klart: ${body.productsWritten} produkter, ${body.variantsWritten} varianter från ${body.rowsRead} rader${errorSummary}.`;
    importStatus.className = "mt-3 text-sm text-green-700";
    await loadProducts();
  } catch (err) {
    importStatus.textContent = err.message;
    importStatus.className = "mt-3 text-sm text-red-600";
  }
});

populateDatalists();
loadProducts();
