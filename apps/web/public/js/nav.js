// Injects the shared top navigation into any page that includes a
// `<div id="nav"></div>` and sets `data-active` on <body> to highlight
// the current section. Plain DOM, no templating engine.

const LINKS = [
  { href: "/index.html", label: "Översikt", key: "dashboard" },
  { href: "/kunder.html", label: "Kunder", key: "kunder" },
  { href: "/offerter.html", label: "Offerter", key: "offerter" },
  { href: "/ordrar.html", label: "Ordrar", key: "ordrar" },
  { href: "/kassa.html", label: "Kassa", key: "kassa" },
  { href: "/lager.html", label: "Lager", key: "lager" },
  { href: "/produkter.html", label: "Produkter", key: "produkter" },
];

function renderNav() {
  const mount = document.getElementById("nav");
  if (!mount) return;

  const active = document.body.dataset.active;

  mount.innerHTML = `
    <header class="border-b border-slate-200 bg-white">
      <div class="mx-auto flex max-w-6xl flex-wrap items-center gap-1 px-4 py-3">
        <span class="mr-4 text-sm font-semibold tracking-tight text-slate-900">ProArb</span>
        ${LINKS.map(
          (link) => `
          <a href="${link.href}"
             class="rounded-md px-3 py-1.5 text-sm font-medium ${
               link.key === active
                 ? "bg-slate-900 text-white"
                 : "text-slate-600 hover:bg-slate-100"
             }">${link.label}</a>`
        ).join("")}
      </div>
    </header>
  `;
}

document.addEventListener("DOMContentLoaded", renderNav);
