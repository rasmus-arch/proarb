import { Router } from "express";
import * as settings from "./service.js";
import * as fortnox from "../integrations/fortnox.js";
import fs from "node:fs";
import path from "node:path";
import { createLogoUpload, uploadsRoot } from "../../lib/uploads.js";
import { createPreviewFile, isPreviewable } from "../../lib/preview.js";
import { requireRole } from "../../lib/auth-middleware.js";

// Fas: Inställningar — säljarinfo/färger för offert-PDF och publik
// offertsida, samt på/av + intervall för e-postpåminnelser (utskicket
// självt kräver en SMTP-leverantör som inte är kopplad ännu, se PLAN.md).
// ADMIN-behörighet gäller numera per rutt (inte hela routern, som tidigare)
// eftersom /branding nedan behöver vara läsbar för alla inloggade roller —
// den driver logga/namn i menyraden (nav.js), se index.js.
const router = Router();
const logoUpload = createLogoUpload("settings");

router.get("/branding", async (req, res, next) => {
  try {
    res.json(await settings.getBranding());
  } catch (err) {
    next(err);
  }
});

router.get("/", requireRole("ADMIN"), async (req, res, next) => {
  try {
    res.json(settings.maskSecrets(await settings.getSettings()));
  } catch (err) {
    next(err);
  }
});

router.patch("/", requireRole("ADMIN"), async (req, res, next) => {
  try {
    res.json(settings.maskSecrets(await settings.updateSettings(req.body ?? {})));
  } catch (err) {
    next(err);
  }
});

router.post(
  "/logo",
  requireRole("ADMIN"),
  (req, res, next) => {
    logoUpload.single("file")(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  },
  async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: "Ingen fil bifogad (fältnamn: file)" });
      // Loggan visas i menyraden och ritas in i PDF:er (pdfkit), som bara
      // klarar PNG/JPG — en EPS/PDF-logga ersätts därför av en PNG-rendering.
      let filePath = `settings/${req.file.filename}`;
      if (isPreviewable(filePath)) {
        try {
          filePath = await createPreviewFile(filePath);
        } catch (err) {
          fs.unlink(path.join(uploadsRoot, filePath), () => {});
          return res.status(400).json({ error: `Kunde inte läsa filen: ${err.message}` });
        }
      }
      res.json(settings.maskSecrets(await settings.updateSellerLogo(filePath)));
    } catch (err) {
      next(err);
    }
  }
);

// Fortnox OAuth2 — "Anslut till Fortnox" i installningar.js navigerar hit
// direkt (inte via fetch), så sessionscookien följer med som vid all
// vanlig sidnavigering och Fortnox kan skicka tillbaka webbläsaren till
// callbacken nedan med en engångskod.
function fortnoxRedirectUri(req) {
  return `${req.protocol}://${req.get("host")}/api/settings/fortnox/callback`;
}

router.get("/fortnox/connect", requireRole("ADMIN"), async (req, res) => {
  try {
    const current = await settings.getSettings();
    const url = await fortnox.getConnectUrl(current, fortnoxRedirectUri(req));
    res.redirect(url);
  } catch (err) {
    res.redirect(`/installningar.html?fortnox=error&message=${encodeURIComponent(err.message)}`);
  }
});

router.get("/fortnox/callback", requireRole("ADMIN"), async (req, res) => {
  try {
    const { code, state, error, error_description: errorDescription } = req.query;
    if (error) throw new Error(errorDescription || error);
    const current = await settings.getSettings();
    await fortnox.handleOAuthCallback({ settings: current, code, state, redirectUri: fortnoxRedirectUri(req) });
    res.redirect("/installningar.html?fortnox=connected");
  } catch (err) {
    res.redirect(`/installningar.html?fortnox=error&message=${encodeURIComponent(err.message)}`);
  }
});

router.post("/fortnox/disconnect", requireRole("ADMIN"), async (req, res, next) => {
  try {
    await fortnox.disconnectFortnox();
    res.json(settings.maskSecrets(await settings.getSettings()));
  } catch (err) {
    next(err);
  }
});

export default router;
