// Injects the shared top navigation into any page that includes a
// `<div id="nav"></div>` and sets `data-active` on <body> to highlight
// the current section. Plain DOM, no templating engine.
//
// Fas 8: also the auth guard for every "app" page (login.html and the
// public /q/:token, /portal/:token pages don't include this script) —
// redirects to /login.html when there's no valid session, and hides nav
// items the current role can't use.

const LINKS = [
  { href: "/index.html", label: "Översikt", key: "dashboard" },
  { href: "/kunder.html", label: "Kunder", key: "kunder" },
  { href: "/offerter.html", label: "Offerter", key: "offerter" },
  { href: "/ordrar.html", label: "Ordrar", key: "ordrar" },
  { href: "/lager.html", label: "Lager", key: "lager" },
  { href: "/orderhantering.html", label: "Orderhantering", key: "orderhantering" },
  { href: "/produkter.html", label: "Produkter", key: "produkter" },
  { href: "/statistik.html", label: "Statistik", key: "statistik" },
  { href: "/installningar.html", label: "Inställningar", key: "installningar", roles: ["ADMIN"] },
];

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function renderNav(user, branding) {
  const mount = document.getElementById("nav");
  if (!mount) return;

  const active = document.body.dataset.active;
  const links = LINKS.filter((link) => !link.roles || link.roles.includes(user.role));

  // Shows the seller's own logo (uploaded under Inställningar) once one
  // exists, instead of a plain company-name label — falls back to the
  // name alone (never the "ProArb" product name) so a fresh install
  // without a logo yet still shows something meaningful.
  const brandMark = branding?.seller_logo_path
    ? `<img src="/uploads/${branding.seller_logo_path}" alt="${escapeHtml(branding.seller_name)}" class="h-8 w-auto" />`
    : `<span class="text-sm font-semibold tracking-tight text-slate-900">${escapeHtml(branding?.seller_name || "ProArb")}</span>`;

  const initials = String(user.name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");

  mount.innerHTML = `
    <header class="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div class="mx-auto flex h-14 max-w-7xl items-stretch gap-5 px-4">
        <a href="/index.html" class="flex shrink-0 items-center">${brandMark}</a>
        <nav class="-mx-3 flex items-stretch overflow-x-auto">
          ${links
            .map(
              (link) =>
                `<a href="${link.href}" class="nav-link whitespace-nowrap"${link.key === active ? ' aria-current="page"' : ""}>${link.label}</a>`
            )
            .join("")}
        </nav>
        <div class="relative ml-auto flex shrink-0 items-center">
          <label class="relative">
            <span class="sr-only">Sök eller skanna</span>
            <svg class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="9" r="5.5"/><path stroke-linecap="round" d="m13.5 13.5 3 3"/></svg>
            <input id="nav-search" type="search" autocomplete="off" spellcheck="false" placeholder="Sök eller skanna…"
              class="h-9 w-44 rounded-md border border-slate-200 bg-slate-50 pl-8 pr-2 text-sm text-slate-900 transition-colors placeholder:text-slate-400 hover:border-slate-300 focus:border-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent-300/70 xl:w-56" />
          </label>
          <div id="nav-search-results" class="absolute right-0 top-full z-40 mt-1 hidden w-96 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-slate-200 bg-white text-sm shadow-lg"></div>
        </div>
        <div class="relative flex shrink-0 items-center">
          <button type="button" id="nav-user-btn" class="flex items-center rounded-full p-0.5 text-sm text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900" aria-haspopup="menu" aria-expanded="false" title="${escapeHtml(user.name)}">
            <span class="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">${escapeHtml(initials)}</span>
          </button>
          <div id="nav-user-menu" role="menu" class="absolute right-0 top-full mt-1 hidden w-56 rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-lg">
            <div class="px-3 py-2">
              <div class="font-medium text-slate-900">${escapeHtml(user.name)}</div>
              <div class="text-xs text-slate-500">${escapeHtml(user.email ?? "")} · ${escapeHtml(user.role)}</div>
            </div>
            <div class="my-1 border-t border-slate-100"></div>
            <button type="button" id="nav-password-btn" role="menuitem" class="block w-full rounded-md px-3 py-2 text-left text-slate-700 hover:bg-slate-50">Byt lösenord</button>
            <button type="button" id="nav-bugreport-btn" role="menuitem" class="block w-full rounded-md px-3 py-2 text-left text-slate-700 hover:bg-slate-50">Rapportera problem</button>
            <button type="button" id="nav-logout-btn" role="menuitem" class="block w-full rounded-md px-3 py-2 text-left text-slate-700 hover:bg-slate-50">Logga ut</button>
          </div>
        </div>
      </div>
    </header>
  `;

  setupSearch();

  const userBtn = document.getElementById("nav-user-btn");
  const userMenu = document.getElementById("nav-user-menu");
  const setMenu = (open) => {
    userMenu.classList.toggle("hidden", !open);
    userBtn.setAttribute("aria-expanded", String(open));
  };
  userBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    setMenu(userMenu.classList.contains("hidden"));
  });
  document.addEventListener("click", (event) => {
    if (!userMenu.contains(event.target)) setMenu(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setMenu(false);
  });

  document.getElementById("nav-logout-btn").addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    location.href = "/login.html";
  });

  document.getElementById("nav-password-btn").addEventListener("click", () => {
    setMenu(false);
    const dialog = ensurePasswordDialog();
    dialog.querySelector("form").reset();
    dialog.querySelector("[data-error]").classList.add("hidden");
    dialog.querySelector("[data-done]").classList.add("hidden");
    dialog.querySelector("form").classList.remove("hidden");
    dialog.showModal();
  });

  document.getElementById("nav-bugreport-btn").addEventListener("click", () => {
    setMenu(false);
    const dialog = ensureBugReportDialog();
    dialog.querySelector("#bugreport-form").reset();
    dialog.querySelector("#bugreport-form").classList.remove("hidden");
    dialog.querySelector("#bugreport-result").classList.add("hidden");
    dialog.querySelector("#bugreport-error").classList.add("hidden");
    dialog.showModal();
  });
}

// --- Sök / skanna ------------------------------------------------------------
// En skannad ordersedel öppnar ordern i Orderhantering, en skannad
// produkt (EAN/SKU) öppnar produkten. Fritext visar grupperade träffar.

const SEARCH_GROUPS = [
  ["orders", "Ordrar", (r) => ({ href: `/order-editor.html?id=${r.id}`, title: r.order_number, sub: r.customer_name })],
  ["quotes", "Offerter", (r) => ({ href: `/offert-editor.html?id=${r.id}`, title: r.quote_number, sub: r.customer_name })],
  ["customers", "Kunder", (r) => ({ href: `/kund-editor.html?id=${r.id}`, title: r.name, sub: [r.customer_number, r.city].filter(Boolean).join(" · ") })],
  ["products", "Produkter", (r) => ({ href: `/produkter.html?edit=${r.id}`, title: r.name, sub: r.article_number })],
];

function exactHref(exact) {
  if (exact.type === "order") return `/orderhantering.html?order=${encodeURIComponent(exact.label)}`;
  if (exact.type === "quote") return `/offert-editor.html?id=${exact.id}`;
  if (exact.type === "customer") return `/kund-editor.html?id=${exact.id}`;
  return `/produkter.html?edit=${exact.id}${exact.variantId ? `&variant=${exact.variantId}` : ""}`;
}

async function searchApi(q) {
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error("Sökningen misslyckades");
  return res.json();
}

function setupSearch() {
  const input = document.getElementById("nav-search");
  const panel = document.getElementById("nav-search-results");
  let items = [];
  let active = -1;
  let timer;
  let lastQuery = "";

  const close = () => {
    panel.classList.add("hidden");
    active = -1;
  };

  function render(result, q) {
    items = [];
    let html = "";
    if (result.exact) {
      const href = exactHref(result.exact);
      items.push(href);
      html += `<a href="${href}" data-idx="0" class="block border-b border-slate-100 bg-accent-50 px-3 py-2">
        <div class="text-[11px] font-semibold uppercase tracking-wide text-accent-700">Exakt träff</div>
        <div class="font-medium text-slate-900">${escapeHtml(result.exact.label)}</div></a>`;
    }
    for (const [key, label, map] of SEARCH_GROUPS) {
      const rows = result[key] ?? [];
      if (rows.length === 0) continue;
      html += `<div class="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">${label}</div>`;
      for (const row of rows) {
        const { href, title, sub } = map(row);
        html += `<a href="${href}" data-idx="${items.length}" class="block px-3 py-1.5 hover:bg-slate-50">
          <span class="font-medium text-slate-900">${escapeHtml(title)}</span>
          ${sub ? `<span class="ml-2 text-xs text-slate-500">${escapeHtml(sub)}</span>` : ""}</a>`;
        items.push(href);
      }
    }
    panel.innerHTML = html || `<p class="px-3 py-3 text-slate-500">Inga träffar för "${escapeHtml(q)}".</p>`;
    panel.classList.remove("hidden");
    highlight(result.exact ? 0 : -1);
  }

  function highlight(index) {
    active = index;
    panel.querySelectorAll("[data-idx]").forEach((a) => {
      a.classList.toggle("ring-2", Number(a.dataset.idx) === index);
      a.classList.toggle("ring-inset", Number(a.dataset.idx) === index);
      a.classList.toggle("ring-accent-300", Number(a.dataset.idx) === index);
    });
  }

  async function run(q) {
    lastQuery = q;
    try {
      const result = await searchApi(q);
      if (q === lastQuery) render(result, q);
      return result;
    } catch (err) {
      panel.innerHTML = `<p class="px-3 py-3 text-red-600">${escapeHtml(err.message)}</p>`;
      panel.classList.remove("hidden");
      return null;
    }
  }

  // Enter: en exakt träff (typiskt en skannad streckkod) går direkt dit,
  // annars den markerade eller första träffen.
  async function go(q) {
    if (!q) return;
    clearTimeout(timer);
    const result = await run(q);
    if (!result) return;
    if (result.exact) return (location.href = exactHref(result.exact));
    const target = items[active >= 0 ? active : 0];
    if (target) location.href = target;
  }

  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return close();
    timer = setTimeout(() => run(q), 180);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      go(input.value.trim());
    } else if (event.key === "ArrowDown" && items.length) {
      event.preventDefault();
      highlight(Math.min(items.length - 1, active + 1));
    } else if (event.key === "ArrowUp" && items.length) {
      event.preventDefault();
      highlight(Math.max(0, active - 1));
    } else if (event.key === "Escape") {
      close();
      input.blur();
    }
  });
  input.addEventListener("focus", () => {
    if (input.value.trim().length >= 2 && panel.innerHTML) panel.classList.remove("hidden");
  });
  document.addEventListener("click", (event) => {
    if (!panel.contains(event.target) && event.target !== input) close();
  });

  // "/" eller Ctrl/Cmd+K fokuserar sökfältet. En streckkodsläsare som
  // "skriver" medan inget fält har fokus (tecken tätt inpå varandra +
  // Enter) fångas också upp och söks direkt.
  let scanBuffer = "";
  let lastKeyAt = 0;
  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const typing = target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
    if ((event.key === "k" && (event.ctrlKey || event.metaKey)) || (event.key === "/" && !typing)) {
      event.preventDefault();
      input.focus();
      input.select();
      return;
    }
    if (typing || event.ctrlKey || event.metaKey || event.altKey || document.querySelector("dialog[open]")) return;
    const now = Date.now();
    if (now - lastKeyAt > 80) scanBuffer = "";
    lastKeyAt = now;
    if (event.key === "Enter") {
      if (scanBuffer.length >= 4) {
        event.preventDefault();
        input.value = scanBuffer;
        go(scanBuffer);
      }
      scanBuffer = "";
    } else if (event.key.length === 1) {
      scanBuffer += event.key;
    }
  });
}

function ensurePasswordDialog() {
  const existing = document.getElementById("password-dialog");
  if (existing) return existing;
  document.body.insertAdjacentHTML(
    "beforeend",
    `<dialog id="password-dialog" class="w-full max-w-sm rounded-lg p-0">
      <div class="card m-0">
        <h2 class="text-lg font-semibold tracking-tight text-slate-900">Byt lösenord</h2>
        <form class="mt-3 grid gap-3">
          <label class="block text-sm">
            <span class="text-slate-700">Nuvarande lösenord</span>
            <input name="current" type="password" required autocomplete="current-password" class="input mt-1" />
          </label>
          <label class="block text-sm">
            <span class="text-slate-700">Nytt lösenord (minst 8 tecken)</span>
            <input name="next" type="password" required minlength="8" autocomplete="new-password" class="input mt-1" />
          </label>
          <label class="block text-sm">
            <span class="text-slate-700">Upprepa nytt lösenord</span>
            <input name="repeat" type="password" required minlength="8" autocomplete="new-password" class="input mt-1" />
          </label>
          <p data-error class="hidden text-sm text-red-600"></p>
          <div class="mt-2 flex justify-end gap-2">
            <button type="button" data-cancel class="btn-secondary">Avbryt</button>
            <button type="submit" class="btn">Spara</button>
          </div>
        </form>
        <div data-done class="hidden">
          <p class="mt-3 text-sm text-slate-700">Lösenordet är bytt. Andra inloggade enheter har loggats ut.</p>
          <div class="mt-5 flex justify-end"><button type="button" data-cancel class="btn">Stäng</button></div>
        </div>
      </div>
    </dialog>`
  );
  const dialog = document.getElementById("password-dialog");
  const form = dialog.querySelector("form");
  const error = dialog.querySelector("[data-error]");
  dialog.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", () => dialog.close()));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.classList.add("hidden");
    const data = Object.fromEntries(new FormData(form).entries());
    if (data.next !== data.repeat) {
      error.textContent = "De nya lösenorden matchar inte.";
      error.classList.remove("hidden");
      return;
    }
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: data.current, newPassword: data.next }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      error.textContent = body.error ?? "Kunde inte byta lösenord.";
      error.classList.remove("hidden");
      return;
    }
    form.classList.add("hidden");
    dialog.querySelector("[data-done]").classList.remove("hidden");
  });
  return dialog;
}

// Injected once into the page body (not the nav header itself) so every
// page gets it "for free" via this shared script — no need to touch each
// page's HTML. See PLAN.md Fas 9: any logged-in staff member can report a
// problem; the backend (bug-reports module) stores it and best-effort
// syncs it to a GitHub issue in the developer's repo.
function ensureBugReportDialog() {
  const existing = document.getElementById("bugreport-dialog");
  if (existing) return existing;

  document.body.insertAdjacentHTML(
    "beforeend",
    `<dialog id="bugreport-dialog" class="w-full max-w-md rounded-lg p-0 backdrop:bg-slate-900/40">
      <div class="card m-0">
        <h2 class="text-lg font-semibold tracking-tight text-slate-900">Rapportera problem</h2>
        <form id="bugreport-form">
          <div class="mt-3 grid grid-cols-1 gap-3">
            <label class="block text-sm">
              <span class="text-slate-700">Vad handlar det om? *</span>
              <input name="title" required class="input mt-1" placeholder="Kort sammanfattning" />
            </label>
            <label class="block text-sm">
              <span class="text-slate-700">Beskriv vad som hände *</span>
              <textarea name="description" required rows="4" class="input mt-1" placeholder="Vad gjorde du, vad hände, vad förväntade du dig?"></textarea>
            </label>
            <label class="block text-sm">
              <span class="text-slate-700">Allvarlighetsgrad</span>
              <select name="severity" class="input mt-1">
                <option value="LOW">Litet problem</option>
                <option value="MEDIUM" selected>Stör arbetet</option>
                <option value="HIGH">Kritiskt – går inte att jobba</option>
              </select>
            </label>
          </div>
          <p id="bugreport-error" class="mt-2 hidden text-sm text-red-600"></p>
          <div class="mt-5 flex justify-end gap-2">
            <button type="button" id="bugreport-cancel-btn" class="btn-secondary">Avbryt</button>
            <button type="submit" class="btn">Skicka</button>
          </div>
        </form>
        <div id="bugreport-result" class="hidden">
          <p class="mt-3 text-sm text-slate-700">Tack! Din rapport har tagits emot.</p>
          <div class="mt-5 flex justify-end">
            <button type="button" id="bugreport-done-btn" class="btn">Stäng</button>
          </div>
        </div>
      </div>
    </dialog>`
  );

  const dialog = document.getElementById("bugreport-dialog");
  const form = dialog.querySelector("#bugreport-form");
  const result = dialog.querySelector("#bugreport-result");
  const error = dialog.querySelector("#bugreport-error");

  dialog.querySelector("#bugreport-cancel-btn").addEventListener("click", () => dialog.close());
  dialog.querySelector("#bugreport-done-btn").addEventListener("click", () => dialog.close());

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.classList.add("hidden");
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      const res = await fetch("/api/bug-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: data.title,
          description: data.description,
          severity: data.severity,
          pageUrl: location.href,
          userAgent: navigator.userAgent,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Kunde inte skicka rapporten");
      }
      form.classList.add("hidden");
      result.classList.remove("hidden");
    } catch (err) {
      error.textContent = err.message;
      error.classList.remove("hidden");
    }
  });

  return dialog;
}

async function init() {
  const res = await fetch("/api/auth/me");
  if (!res.ok) {
    location.replace(`/login.html?redirect=${encodeURIComponent(location.pathname + location.search)}`);
    return;
  }
  const { user } = await res.json();
  const branding = await fetch("/api/settings/branding")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  renderNav(user, branding);
  if (user.must_change_password) forcePasswordChange();
}

// Standardlösenord eller lösenord satt av en administratör: inget annat i
// systemet fungerar (servern svarar 403) förrän ett eget lösenord valts.
function forcePasswordChange() {
  const dialog = ensurePasswordDialog();
  dialog.querySelector("h2").textContent = "Välj ett eget lösenord";
  dialog.querySelector("form [data-cancel]").classList.add("hidden");
  dialog.querySelector("[data-done] [data-cancel]").addEventListener("click", () => location.reload());
  dialog.querySelector("form").insertAdjacentHTML(
    "afterbegin",
    `<p class="text-sm text-slate-600">Ditt konto har ett tillfälligt lösenord. Välj ett eget innan du fortsätter.</p>`
  );
  dialog.addEventListener("cancel", (event) => event.preventDefault());
  dialog.showModal();
}

document.addEventListener("DOMContentLoaded", init);
