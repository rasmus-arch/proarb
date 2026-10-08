import { Router } from "express";
import { getSettings } from "../settings/service.js";
import { renderPortal } from "./portal.js";
import * as accounts from "./portal-accounts.js";
import { getCustomerInvoicePdf } from "./portal-invoices.js";
import {
  checkLoginAllowed,
  passwordFlowAllowed,
  recordLoginFailure,
  recordLoginSuccess,
  weakPasswordMessage,
} from "../../lib/security.js";

const TOO_MANY = "För många försök — vänta en stund och försök igen.";

// Sortilog med inloggning: /sortilog (inloggning eller, när man är
// inloggad, kundens sida), /sortilog/glomt (glömt lösenord) och
// /sortilog/losenord?token=… (välj lösenord från inbjudan/återställning).
// Server-renderade sidor precis som /portal/:token — kunden ser aldrig
// något av själva systemet.
const router = Router();

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function origin(req) {
  return process.env.APP_URL?.replace(/\/+$/, "") || `${req.protocol}://${req.get("host")}`;
}

function cookieOptions(req) {
  return { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: accounts.PORTAL_SESSION_MAX_AGE_MS };
}

// Gemensamt skal för inloggningssidorna: säljarens logga och färg, ett
// litet kort i mitten och ett formulär som postar JSON med fetch.
async function authPage(res, { title, body, script = "" }) {
  const settings = await getSettings();
  const brandColor = settings?.brand_color || "#1c1b19";
  const sellerName = settings?.seller_name || "ProArb";
  const logo = settings?.seller_logo_path
    ? `<img src="/uploads/${escapeHtml(settings.seller_logo_path)}" alt="${escapeHtml(sellerName)}" style="height:48px;max-width:220px;object-fit:contain;display:block;margin:0 auto;" />`
    : `<div style="font-size:18px;font-weight:700;color:${brandColor};">${escapeHtml(sellerName)}</div>`;
  res.send(`<!doctype html>
<html lang="sv">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)} – Sortilog</title>
  <style>
    body { font-family: system-ui, sans-serif; background:#f8fafc; color:#0f172a; margin:0; padding:48px 16px; }
    .card { max-width:380px; margin:0 auto; background:#fff; border:1px solid #e2e8f0; border-top:4px solid ${brandColor}; border-radius:10px; padding:28px 24px; box-shadow:0 4px 16px rgba(15,23,42,0.05); }
    .eyebrow { text-align:center; color:#94a3b8; font-size:12px; letter-spacing:0.05em; text-transform:uppercase; font-weight:600; margin:12px 0 0; }
    h1 { text-align:center; font-size:20px; margin:4px 0 20px; }
    label { display:block; font-size:13px; color:#334155; margin:12px 0 4px; }
    input { width:100%; box-sizing:border-box; border:1px solid #cbd5e1; border-radius:6px; padding:9px 10px; font-size:15px; }
    input:focus { outline:2px solid ${brandColor}; outline-offset:1px; }
    button { width:100%; margin-top:18px; background:${brandColor}; color:#fff; border:none; border-radius:6px; padding:11px; font-size:15px; font-weight:600; cursor:pointer; }
    button:disabled { opacity:0.6; cursor:default; }
    .msg { font-size:13px; margin:12px 0 0; }
    .error { color:#dc2626; }
    .ok { color:#15803d; }
    .links { text-align:center; font-size:13px; margin-top:16px; }
    .links a { color:#475569; }
    p.help { color:#64748b; font-size:13px; margin:0 0 4px; }
  </style>
</head>
<body>
  <div class="card">
    ${logo}
    <p class="eyebrow">Sortilog</p>
    <h1>${escapeHtml(title)}</h1>
    ${body}
  </div>
  <script>
    function postJson(url, data) {
      return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })
        .then(function (res) {
          if (res.ok) return res.status === 204 ? {} : res.json();
          return res.json().catch(function () { return {}; }).then(function (b) { throw new Error(b.error || "Något gick fel"); });
        });
    }
    ${script}
  </script>
</body>
</html>`);
}

router.get("/", async (req, res, next) => {
  try {
    const account = await accounts.getSessionAccount(req.cookies?.[accounts.PORTAL_SESSION_COOKIE]);
    if (account) return renderPortal(req, res, account.portal_token, { account });

    await authPage(res, {
      title: "Logga in",
      body: `<form id="f">
          <label for="email">E-post</label>
          <input id="email" type="email" autocomplete="username" required autofocus />
          <label for="password">Lösenord</label>
          <input id="password" type="password" autocomplete="current-password" required />
          <p id="msg" class="msg error" hidden></p>
          <button type="submit">Logga in</button>
        </form>
        <div class="links"><a href="/sortilog/glomt">Glömt lösenord?</a></div>`,
      script: `
        document.getElementById("f").addEventListener("submit", function (e) {
          e.preventDefault();
          var btn = e.target.querySelector("button"); var msg = document.getElementById("msg");
          btn.disabled = true; msg.hidden = true;
          postJson("/sortilog/login", { email: document.getElementById("email").value, password: document.getElementById("password").value })
            .then(function () { location.href = "/sortilog"; })
            .catch(function (err) { msg.textContent = err.message; msg.hidden = false; btn.disabled = false; });
        });`,
    });
  } catch (err) {
    next(err);
  }
});

// Faktura som PDF (hämtas från Fortnox). Kräver inloggning, och fakturan
// måste höra till den inloggades företag.
router.get("/faktura/:id", async (req, res, next) => {
  try {
    const account = await accounts.getSessionAccount(req.cookies?.[accounts.PORTAL_SESSION_COOKIE]);
    if (!account) return res.redirect(303, "/sortilog");
    const result = await getCustomerInvoicePdf(account.customer_id, Number(req.params.id));
    if (!result) return res.status(404).send("Fakturan hittades inte");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${result.filename.replace(/[^\w.-]/g, "_")}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(result.pdf);
  } catch (err) {
    if (err.message === "NOT_CONFIGURED") return res.status(503).send("Fakturorna kan inte hämtas just nu.");
    console.warn(`Sortilog-faktura kunde inte hämtas: ${err.message}`);
    res.status(502).send("Fakturan kunde inte hämtas just nu — försök igen om en stund.");
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
      return res.status(400).json({ error: "E-post och lösenord krävs" });
    }
    const blocked = checkLoginAllowed(req, "portal", email);
    if (blocked) return res.status(429).json({ error: blocked });
    const result = await accounts.login(email, password);
    if (!result) {
      recordLoginFailure("portal", email);
      return res.status(401).json({ error: "Fel e-post eller lösenord" });
    }
    recordLoginSuccess("portal", email);
    res.cookie(accounts.PORTAL_SESSION_COOKIE, result.token, cookieOptions(req));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.post("/logout", async (req, res, next) => {
  try {
    await accounts.logout(req.cookies?.[accounts.PORTAL_SESSION_COOKIE]);
    res.clearCookie(accounts.PORTAL_SESSION_COOKIE);
    res.redirect(303, "/sortilog");
  } catch (err) {
    next(err);
  }
});

router.get("/glomt", async (req, res, next) => {
  try {
    await authPage(res, {
      title: "Glömt lösenord",
      body: `<form id="f">
          <p class="help">Ange din e-postadress så skickar vi en länk där du väljer ett nytt lösenord.</p>
          <label for="email">E-post</label>
          <input id="email" type="email" autocomplete="username" required autofocus />
          <p id="msg" class="msg" hidden></p>
          <button type="submit">Skicka länk</button>
        </form>
        <div class="links"><a href="/sortilog">Tillbaka till inloggningen</a></div>`,
      script: `
        document.getElementById("f").addEventListener("submit", function (e) {
          e.preventDefault();
          var btn = e.target.querySelector("button"); var msg = document.getElementById("msg");
          btn.disabled = true;
          postJson("/sortilog/glomt", { email: document.getElementById("email").value })
            .then(function () {
              msg.className = "msg ok";
              msg.textContent = "Om adressen har ett konto skickas en länk dit inom någon minut.";
              msg.hidden = false;
            })
            .catch(function (err) { msg.className = "msg error"; msg.textContent = err.message; msg.hidden = false; btn.disabled = false; });
        });`,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/glomt", async (req, res, next) => {
  try {
    if (!passwordFlowAllowed(req, "portal-forgot")) return res.status(429).json({ error: TOO_MANY });
    if (typeof req.body?.email !== "string") return res.status(400).json({ error: "Ange e-post" });
    await accounts.requestPasswordReset(req.body?.email, origin(req));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get("/losenord", async (req, res, next) => {
  try {
    const token = String(req.query.token ?? "");
    const info = token ? await accounts.getPasswordToken(token) : null;
    if (!info) {
      return authPage(res, {
        title: "Länken fungerar inte",
        body: `<p class="help">Länken är ogiltig, redan använd eller har gått ut.</p>
          <div class="links"><a href="/sortilog/glomt">Skicka en ny länk</a> · <a href="/sortilog">Logga in</a></div>`,
      });
    }
    await authPage(res, {
      title: info.purpose === "INVITE" ? "Välj lösenord" : "Nytt lösenord",
      body: `<form id="f">
          <p class="help">${info.purpose === "INVITE" ? "Välkommen! " : ""}Du loggar in med <strong>${escapeHtml(info.email)}</strong>.</p>
          <label for="password">Lösenord (minst 8 tecken)</label>
          <input id="password" type="password" autocomplete="new-password" minlength="8" required autofocus />
          <label for="password2">Upprepa lösenordet</label>
          <input id="password2" type="password" autocomplete="new-password" minlength="8" required />
          <p id="msg" class="msg error" hidden></p>
          <button type="submit">Spara och logga in</button>
        </form>`,
      script: `
        document.getElementById("f").addEventListener("submit", function (e) {
          e.preventDefault();
          var btn = e.target.querySelector("button"); var msg = document.getElementById("msg");
          var p1 = document.getElementById("password").value, p2 = document.getElementById("password2").value;
          if (p1 !== p2) { msg.textContent = "Lösenorden är inte lika."; msg.hidden = false; return; }
          btn.disabled = true; msg.hidden = true;
          postJson("/sortilog/losenord", { token: ${JSON.stringify(token)}, password: p1 })
            .then(function () { location.href = "/sortilog"; })
            .catch(function (err) { msg.textContent = err.message; msg.hidden = false; btn.disabled = false; });
        });`,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/losenord", async (req, res, next) => {
  try {
    if (!passwordFlowAllowed(req, "portal-set")) return res.status(429).json({ error: TOO_MANY });
    const result = await accounts.setPassword(req.body?.token, req.body?.password);
    if (!result) throw new Error("INVALID_TOKEN");
    res.cookie(accounts.PORTAL_SESSION_COOKIE, result.token, cookieOptions(req));
    res.status(204).end();
  } catch (err) {
    if (err.message === "WEAK_PASSWORD") return res.status(400).json({ error: weakPasswordMessage(err) });
    if (err.message === "INVALID_TOKEN") {
      return res.status(400).json({ error: "Länken är ogiltig eller har gått ut — begär en ny" });
    }
    next(err);
  }
});

export default router;
