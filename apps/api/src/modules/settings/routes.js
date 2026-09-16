import { Router } from "express";
import * as settings from "./service.js";
import { createLogoUpload } from "../../lib/uploads.js";
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
    res.json(await settings.getSettings());
  } catch (err) {
    next(err);
  }
});

router.patch("/", requireRole("ADMIN"), async (req, res, next) => {
  try {
    res.json(await settings.updateSettings(req.body ?? {}));
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
      const result = await settings.updateSellerLogo(`settings/${req.file.filename}`);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
