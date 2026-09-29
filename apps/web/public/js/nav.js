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
      <div class="mx-auto flex h-14 max-w-6xl items-stretch gap-5 px-4">
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
          <button type="button" id="nav-user-btn" class="flex items-center rounded-full p-0.5 text-sm text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900" aria-haspopup="menu" aria-expanded="false" title="${escapeHtml(user.name)}">
            <span class="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">${escapeHtml(initials)}</span>
          </button>
          <div id="nav-user-menu" role="menu" class="absolute right-0 top-full mt-1 hidden w-56 rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-lg">
            <div class="px-3 py-2">
              <div class="font-medium text-slate-900">${escapeHtml(user.name)}</div>
              <div class="text-xs text-slate-500">${escapeHtml(user.email ?? "")} · ${escapeHtml(user.role)}</div>
            </div>
            <div class="my-1 border-t border-slate-100"></div>
            <button type="button" id="nav-bugreport-btn" role="menuitem" class="block w-full rounded-md px-3 py-2 text-left text-slate-700 hover:bg-slate-50">Rapportera problem</button>
            <button type="button" id="nav-logout-btn" role="menuitem" class="block w-full rounded-md px-3 py-2 text-left text-slate-700 hover:bg-slate-50">Logga ut</button>
          </div>
        </div>
      </div>
    </header>
  `;

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
}

document.addEventListener("DOMContentLoaded", init);
