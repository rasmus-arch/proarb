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
  { href: "/kassa.html", label: "Kassa", key: "kassa" },
  { href: "/lager.html", label: "Lager", key: "lager" },
  { href: "/tryck.html", label: "Tryck", key: "tryck" },
  { href: "/produkter.html", label: "Produkter", key: "produkter" },
  { href: "/statistik.html", label: "Statistik", key: "statistik" },
  { href: "/installningar.html", label: "Inställningar", key: "installningar", roles: ["ADMIN"] },
];

function renderNav(user) {
  const mount = document.getElementById("nav");
  if (!mount) return;

  const active = document.body.dataset.active;
  const links = LINKS.filter((link) => !link.roles || link.roles.includes(user.role));

  mount.innerHTML = `
    <header class="border-b border-slate-200 bg-white">
      <div class="mx-auto flex max-w-6xl flex-wrap items-center gap-1 px-4 py-3">
        <span class="mr-4 text-sm font-semibold tracking-tight text-slate-900">ProArb</span>
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
}

async function init() {
  const res = await fetch("/api/auth/me");
  if (!res.ok) {
    location.replace(`/login.html?redirect=${encodeURIComponent(location.pathname)}`);
    return;
  }
  const { user } = await res.json();
  renderNav(user);
}

document.addEventListener("DOMContentLoaded", init);
