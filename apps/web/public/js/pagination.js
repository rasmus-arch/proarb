// Shared pager for list pages backed by { rows, total, page, pageSize }
// endpoints. Renders "Visar X–Y av Z" + prev/next into `container` and
// calls onChange(newPage) when the user clicks a button.
export function renderPager(container, { page, pageSize, total, onChange }) {
  if (!total) {
    container.innerHTML = "";
    return;
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  container.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-3 py-3 text-sm text-slate-600">
      <span>Visar ${from}–${to} av ${total}</span>
      <div class="flex items-center gap-2">
        <button type="button" class="btn-secondary" data-page-prev ${page <= 1 ? "disabled" : ""}>Föregående</button>
        <span>Sida ${page} av ${totalPages}</span>
        <button type="button" class="btn-secondary" data-page-next ${page >= totalPages ? "disabled" : ""}>Nästa</button>
      </div>
    </div>`;

  container.querySelector("[data-page-prev]").addEventListener("click", () => onChange(page - 1));
  container.querySelector("[data-page-next]").addEventListener("click", () => onChange(page + 1));
}
