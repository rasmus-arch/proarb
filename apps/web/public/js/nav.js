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
    ? `<img src="/uploads/${branding.seller_logo_path}" alt="${escapeHtml(branding.seller_name)}" class="mr-4 h-8 w-auto" />`
    : `<span class="mr-4 text-sm font-semibold tracking-tight text-slate-900">${escapeHtml(branding?.seller_name || "ProArb")}</span>`;

  mount.innerHTML = `
    <header class="border-b border-slate-200 bg-white">
      <div class="mx-auto flex max-w-6xl flex-wrap items-center gap-1 px-4 py-3">
        ${brandMark}
        ${links
          .map(
            (link) => `
          <a href="${link.href}"
             class="rounded-md px-3 py-1.5 text-sm font-medium ${
               link.key === active
                 ? "bg-slate-900 text-white"
                 : "text-slate-600 hover:bg-slate-100"
             }">${link.label}</a>`
          )
          .join("")}
        <span class="ml-auto flex items-center gap-3 text-sm text-slate-600">
          <button type="button" id="nav-bugreport-btn" class="text-blue-700 underline">Rapportera problem</button>
          <span>${user.name} <span class="text-slate-400">(${user.role})</span></span>
          <button type="button" id="nav-logout-btn" class="text-blue-700 underline">Logga ut</button>
        </span>
      </div>
    </header>
  `;

  document.getElementById("nav-logout-btn").addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    location.href = "/login.html";
  });

  document.getElementById("nav-bugreport-btn").addEventListener("click", () => {
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
        <h2 class="text-lg font-medium text-slate-900">Rapportera problem</h2>
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
