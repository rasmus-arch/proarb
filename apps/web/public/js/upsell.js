// "Köps ofta med" under radsökningen i order- och offert-editorn: produkter
// som ofta legat på samma ordrar som det som redan finns på raderna. Ett
// klick söker fram produkten i radsökningen så att rätt variant väljs.
import { api } from "./api.js";

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

export function createUpsell({ container, searchInput }) {
  let timer = null;
  let lastKey = "";

  container.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-upsell]");
    if (!btn) return;
    searchInput.value = btn.dataset.upsell;
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    searchInput.focus();
  });

  return {
    // variantIds = katalograderna som ligger på ordern/offerten just nu.
    update(variantIds, { editable = true } = {}) {
      const key = [...new Set(variantIds.filter(Boolean))].sort((a, b) => a - b).join(",");
      if (!editable || !key) {
        container.classList.add("hidden");
        lastKey = "";
        return;
      }
      if (key === lastKey) return;
      lastKey = key;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const { rows } = await api.get(`/products/bought-together?variantIds=${key}`);
          if (key !== lastKey) return;
          container.classList.toggle("hidden", rows.length === 0);
          container.innerHTML = `<span class="text-slate-500">Köps ofta med:</span> ${rows
            .map(
              (r) =>
                `<button type="button" class="ml-1 rounded-full border border-slate-200 px-2.5 py-0.5 text-xs text-slate-700 hover:border-slate-400" data-upsell="${escapeHtml(
                  r.name
                )}" title="På ${r.times} ordrar tillsammans">+ ${escapeHtml(r.name)}</button>`
            )
            .join("")}`;
        } catch {
          container.classList.add("hidden");
        }
      }, 300);
    },
  };
}
