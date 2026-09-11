import { api } from "../api.js";

const scanInput = document.getElementById("scan-input");
const scanErrorEl = document.getElementById("scan-error");
const cartRowsEl = document.getElementById("cart-rows");
const emptyCartEl = document.getElementById("empty-cart");
const cartTotalEl = document.getElementById("cart-total");

// key: variant_id -> { name, color, size, unitPrice, qty }
const cart = new Map();

function formatMoney(value) {
  return `${Number(value).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
}

function renderCart() {
  const items = [...cart.values()];
  emptyCartEl.classList.toggle("hidden", items.length > 0);

  cartRowsEl.innerHTML = items
    .map(
      (item) => `
      <tr>
        <td class="py-2 pr-4 font-medium text-slate-900">${item.name}</td>
        <td class="py-2 pr-4">${[item.color, item.size].filter(Boolean).join(" / ")}</td>
        <td class="py-2 pr-4 text-right">${item.qty}</td>
        <td class="py-2 pr-4 text-right">${formatMoney(item.unitPrice)}</td>
        <td class="py-2 pr-4 text-right">${formatMoney(item.unitPrice * item.qty)}</td>
      </tr>`
    )
    .join("");

  const total = items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
  cartTotalEl.textContent = formatMoney(total);
}

async function handleScan(barcode) {
  scanErrorEl.classList.add("hidden");
  try {
    const variant = await api.get(`/products/by-barcode/${encodeURIComponent(barcode)}`);
    const unitPrice = Number(variant.price_override ?? variant.base_price);
    const existing = cart.get(variant.variant_id);
    if (existing) {
      existing.qty += 1;
    } else {
      cart.set(variant.variant_id, {
        name: variant.name,
        color: variant.color,
        size: variant.size,
        unitPrice,
        qty: 1,
      });
    }
    renderCart();
  } catch (err) {
    scanErrorEl.textContent = err.message;
    scanErrorEl.classList.remove("hidden");
  }
}

scanInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const barcode = scanInput.value.trim();
  scanInput.value = "";
  if (barcode) handleScan(barcode);
});

renderCart();
