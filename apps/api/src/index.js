import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";

import authRouter from "./modules/auth/routes.js";
import usersRouter from "./modules/users/routes.js";
import customersRouter from "./modules/customers/routes.js";
import { renderPortalPage } from "./modules/customers/portal.js";
import portalPublicRouter from "./modules/customers/portal-public.js";
import sortilogRouter from "./modules/customers/sortilog.js";
import portalRequestsRouter from "./modules/customers/portal-requests.routes.js";
import quotesRouter from "./modules/quotes/routes.js";
import quotesPublicRouter, { renderPublicQuotePage, renderPublicQuotePdf } from "./modules/quotes/public.js";
import ordersRouter from "./modules/orders/routes.js";
import orderTemplatesRouter from "./modules/orders/templates.routes.js";
import { handleQrScan, handleQrMarkReady, handleQrMarkDelivered } from "./modules/orders/qr-public.js";
import productsRouter from "./modules/products/routes.js";
import categoriesRouter from "./modules/catalog/categories.routes.js";
import brandsRouter from "./modules/catalog/brands.routes.js";
import suppliersRouter from "./modules/catalog/suppliers.routes.js";
import printMethodsRouter from "./modules/catalog/print-methods.routes.js";
import kitsRouter from "./modules/catalog/kits.routes.js";
import inventoryRouter from "./modules/inventory/routes.js";
import settingsRouter from "./modules/settings/routes.js";
import statsRouter from "./modules/stats/routes.js";
import bugReportsRouter from "./modules/bug-reports/routes.js";
import backupsRouter from "./modules/backups/routes.js";
import searchRouter from "./modules/search/routes.js";
import { uploadsRoot } from "./lib/uploads.js";
import { requireAuth, requireRole } from "./lib/auth-middleware.js";
import { publicFormLimiter, securityHeaders, uploadHeaders } from "./lib/security.js";
import { run as runMigrations } from "../db/migrate.js";
import { convertLegacySellerLogo } from "./modules/settings/service.js";
import { flagDefaultPasswords } from "./modules/auth/service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webPublicDir = path.join(__dirname, "..", "..", "web", "public");

const app = express();
// Needed so req.protocol reflects the original https:// when the app runs
// behind a TLS-terminating reverse proxy (e.g. cPanel/Apache) — the
// Fortnox OAuth redirect_uri (settings/routes.js) must exactly match what
// the browser was actually redirected from, not the plain-http backend.
// Lita bara på proxyservrar på lokala/privata adresser (Apache/Passenger
// på samma server) — med "true" kunde vem som helst ange sin egen IP i
// X-Forwarded-For och komma runt spärren mot lösenordsgissning.
app.set("trust proxy", "loopback, linklocal, uniquelocal");
app.disable("x-powered-by");
// Ingen CORS: frontend och API ligger på samma adress.
app.use(securityHeaders);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

// Login/logout/me are the only /api routes reachable without a session.
app.use("/api/auth", authRouter);
// Public, no-login quote responses (accept/decline) — reached only via the
// unguessable public_token, not by a logged-in session.
app.use("/api/public/quotes", quotesPublicRouter);
// Public, no-login order requests from "Mina sidor" — same trust model,
// reached only via the unguessable portal_token.
app.use("/api/public/portal", portalPublicRouter);

// Fas 8: every other /api route requires a logged-in session.
// TODO (Fas 8+): once this app has more than a handful of staff accounts,
// consider trimming session TTL / adding an idle-timeout on top of this.
app.use("/api", requireAuth);
// Konton med tillfälligt lösenord (standardlösenordet eller ett som en
// administratör satt) får bara byta lösenord (/api/auth/*, ovan) tills det är gjort.
app.use("/api", (req, res, next) => {
  if (req.user?.must_change_password && !req.path.startsWith("/settings/branding")) {
    return res.status(403).json({ error: "Byt lösenord först.", code: "PASSWORD_CHANGE_REQUIRED" });
  }
  next();
});

app.use("/api/users", requireRole("ADMIN"), usersRouter);
app.use("/api/customers", customersRouter);
app.use("/api/portal-requests", portalRequestsRouter);
app.use("/api/quotes", quotesRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/order-templates", orderTemplatesRouter);
app.use("/api/products", productsRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/brands", brandsRouter);
app.use("/api/suppliers", suppliersRouter);
app.use("/api/print-methods", printMethodsRouter);
app.use("/api/kits", kitsRouter);
app.use("/api/inventory", inventoryRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/stats", statsRouter);
app.use("/api/bug-reports", bugReportsRouter);
app.use("/api/backups", requireRole("ADMIN"), backupsRouter);
app.use("/api/search", searchRouter);

// Public, no-login quote link shared with customers (see PLAN.md §3).
app.get("/q/:token", renderPublicQuotePage);
app.get("/q/:token/pdf", renderPublicQuotePdf);

// Kundportal (Fas 7): no-login, read-only link listing a customer's own
// offerter/ordrar (see PLAN.md §7).
app.get("/portal/:token", renderPortalPage);

// Sortilog med inloggning (e-post + lösenord per person hos kunden).
app.use("/sortilog", sortilogRouter);

// QR-koden på ordersedelns PDF (Fas: ordersedel/plocklista). No-login: en
// enkel sida med bara statusknappar (NEW -> READY_FOR_PICKUP -> DELIVERED).
// Slutar fungera (redirect till proarb.se) så fort ordern är utlämnad — se
// qr-public.js.
app.get("/qr/:token", handleQrScan);
app.post("/qr/:token/ready", publicFormLimiter, handleQrMarkReady);
app.post("/qr/:token/delivered", publicFormLimiter, handleQrMarkDelivered);

// Uploaded logo/print-artwork files (customer logos, seller logo).
app.use("/uploads", uploadHeaders, express.static(uploadsRoot, { dotfiles: "deny", index: false }));

// Serve the vanilla JS + Tailwind frontend.
app.use(express.static(webPublicDir));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status ?? err.statusCode ?? 500;
  // Databas- och systemfel visas aldrig i detalj för användaren — de kan
  // avslöja tabellnamn, frågor och sökvägar. Hela felet loggas på servern.
  // Egna felmeddelanden (t.ex. från Fortnox-kopplingen) visas som vanligt.
  const isSystemError = Boolean(err.sqlMessage || err.sql || err.errno || err.syscall || /^E[A-Z_]+$/.test(err.code ?? ""));
  if (status >= 500) console.error(err);
  if (isSystemError || !(err instanceof Error)) {
    return res.status(status >= 500 ? 500 : status).json({
      error: "Något gick fel på servern. Försök igen eller rapportera problemet.",
    });
  }
  res.status(status).json({ error: err.message || "Något gick fel" });
});

// Brings the database schema up to date on every start, so deploying new
// code + restarting is enough — otherwise a deploy that skips "Run NPM
// Install" (the postinstall migration) leaves new columns missing and
// queries fail with "Unknown column". Idempotent; non-fatal like postinstall.
// No top-level await: cPanel/Passenger loads this file with require(), which
// throws ERR_REQUIRE_ASYNC_MODULE (-> 503) on an ESM graph with top-level await.
runMigrations()
  .catch((err) => {
    console.warn(`Kunde inte köra databasmigrering vid start: ${err.message}`);
  })
  .then(() => flagDefaultPasswords())
  .catch((err) => {
    console.warn(`Kunde inte kontrollera standardlösenord: ${err.message}`);
  })
  .then(() => convertLegacySellerLogo())
  .catch((err) => {
    console.warn(`Kunde inte konvertera företagsloggan: ${err.message}`);
  });

const port = process.env.PORT ?? 3001;
app.listen(port, () => {
  console.log(`ProArb API listening on http://localhost:${port}`);
});
