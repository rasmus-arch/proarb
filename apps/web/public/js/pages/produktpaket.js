import { api } from "../api.js";

const el = {
  newKitBtn: document.getElementById("new-kit-btn"),
  kitRows: document.getElementById("kit-rows"),
  kitsEmpty: document.getElementById("kits-empty"),
  kitDialog: document.getElementById("kit-dialog"),
  kitDialogTitle: document.getElementById("kit-dialog-title"),
  kitName: document.getElementById("kit-name"),
  kitLineSearch: document.getElementById("kit-line-search"),
  kitLineResults: document.getElementById("kit-line-results"),
  kitLineRows: document.getElementById("kit-line-rows"),
  kitLinesEmpty: document.getElementById("kit-lines-empty"),
  kitError: document.getElementById("kit-error"),
  cancelKitBtn: document.getElementById("cancel-kit-btn"),
  saveKitBtn: document.getElementById("save-kit-btn"),
};

let editingKitId = null;
let kitLines = []; // { productVariantId, name, colorSize, quantity }

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function money(value) {
  return `${Number(value).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
}

async function loadKits() {
  const { rows } = await api.get("/kits");
  el.kitsEmpty.classList.toggle("hidden", rows.length > 0);
  el.kitRows.innerHTML = rows
    .map(
      (k) => `
      <li class="flex items-center justify-between py-2 text-sm">
        <div>
          <span class="font-medium text-slate-900">${escapeHtml(k.name)}</span>
          <span class="ml-2 text-xs text-slate-500">${k.line_count} produkt${k.line_count === 1 ? "" : "er"}</span>
        </div>
        <span class="flex gap-2">
          <button type="button" class="text-blue-700 underline text-xs" data-edit-kit="${k.id}">Redigera</button>
          <button type="button" class="text-red-600 underline text-xs" data-delete-kit="${k.id}">Ta bort</button>
        </span>
      </li>`
    )
    .join("");
}

el.kitRows.addEventListener("click", async (event) => {
  const editId = event.target.dataset.editKit;
  const deleteId = event.target.dataset.deleteKit;
  if (editId !== undefined) {
    await openEditKitDialog(Number(editId));
    return;
  }
  if (deleteId !== undefined) {
    if (!confirm("Ta bort paketet? Detta går inte att ångra.")) return;
    await api.delete(`/kits/${deleteId}`);
    loadKits();
  }
});

function renderKitLines() {
  el.kitLinesEmpty.classList.toggle("hidden", kitLines.length > 0);
  el.kitLineRows.innerHTML = kitLines
    .map(
      (l, index) => `
      <tr>
        <td class="py-1 pr-3">${escapeHtml(l.name)}<div class="text-xs text-slate-500">${escapeHtml(l.colorSize)}</div></td>
        <td class="py-1 pr-3"><input type="number" min="0.01" step="1" class="input" data-qty-index="${index}" value="${l.quantity}" /></td>
        <td><button type="button" class="text-slate-400 hover:text-red-600" data-remove-line="${index}">✕</button></td>
      </tr>`
    )
    .join("");
}

el.kitLineRows.addEventListener("input", (event) => {
  const index = event.target.dataset.qtyIndex;
  if (index === undefined) return;
  kitLines[Number(index)].quantity = Number(event.target.value) || 1;
});

el.kitLineRows.addEventListener("click", (event) => {
  const index = event.target.dataset.removeLine;
  if (index === undefined) return;
  kitLines.splice(Number(index), 1);
  renderKitLines();
});

let kitLineSearchTimer;
el.kitLineSearch.addEventListener("input", () => {
  clearTimeout(kitLineSearchTimer);
  const q = el.kitLineSearch.value.trim();
  if (!q) {
    el.kitLineResults.innerHTML = "";
    return;
  }
  kitLineSearchTimer = setTimeout(async () => {
    const { rows } = await api.get(`/products/search?q=${encodeURIComponent(q)}`);
    el.kitLineResults.innerHTML = rows
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

el.kitLineResults.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-variant]");
  if (!button) return;
  const v = JSON.parse(button.dataset.variant);
  kitLines.push({
    productVariantId: v.variant_id,
    name: v.name,
    colorSize: [v.color, v.size, v.sku].filter(Boolean).join(" · "),
    quantity: 1,
  });
  el.kitLineSearch.value = "";
  el.kitLineResults.innerHTML = "";
  renderKitLines();
});

el.newKitBtn.addEventListener("click", () => {
  editingKitId = null;
  kitLines = [];
  el.kitDialogTitle.textContent = "Nytt paket";
  el.kitName.value = "";
  el.kitError.classList.add("hidden");
  el.kitLineSearch.value = "";
  el.kitLineResults.innerHTML = "";
  renderKitLines();
  el.kitDialog.showModal();
});

async function openEditKitDialog(kitId) {
  const kit = await api.get(`/kits/${kitId}`);
  editingKitId = kitId;
  kitLines = kit.lines.map((l) => ({
    productVariantId: l.variant_id,
    name: l.name,
    colorSize: [l.color, l.size, l.sku].filter(Boolean).join(" · "),
    quantity: Number(l.kit_quantity),
  }));
  el.kitDialogTitle.textContent = "Redigera paket";
  el.kitName.value = kit.name;
  el.kitError.classList.add("hidden");
  el.kitLineSearch.value = "";
  el.kitLineResults.innerHTML = "";
  renderKitLines();
  el.kitDialog.showModal();
}

el.cancelKitBtn.addEventListener("click", () => el.kitDialog.close());

el.saveKitBtn.addEventListener("click", async () => {
  el.kitError.classList.add("hidden");
  if (!el.kitName.value.trim()) {
    el.kitError.textContent = "Namn krävs.";
    el.kitError.classList.remove("hidden");
    return;
  }
  if (kitLines.length === 0) {
    el.kitError.textContent = "Lägg till minst en produkt.";
    el.kitError.classList.remove("hidden");
    return;
  }

  const payload = {
    name: el.kitName.value.trim(),
    lines: kitLines.map((l) => ({ productVariantId: l.productVariantId, quantity: l.quantity })),
  };

  try {
    if (editingKitId) {
      await api.patch(`/kits/${editingKitId}`, payload);
    } else {
      await api.post("/kits", payload);
    }
    el.kitDialog.close();
    loadKits();
  } catch (err) {
    el.kitError.textContent = err.message;
    el.kitError.classList.remove("hidden");
  }
});

loadKits();
