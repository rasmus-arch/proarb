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

const importDialog = document.getElementById("import-dialog");
const importFileInput = document.getElementById("import-file");
const importStatus = document.getElementById("import-status");

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
  categoryOptions.innerHTML = categories.rows.map((c) => `<option value="${escapeHtml(c.name)}">`).join("");
  brandOptions.innerHTML = brands.rows.map((b) => `<option value="${escapeHtml(b.name)}">`).join("");
  supplierOptions.innerHTML = suppliers.rows.map((s) => `<option value="${escapeHtml(s.name)}">`).join("");
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
    printable: form.printable === "on",
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

loadProducts();
