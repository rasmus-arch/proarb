import { Router } from "express";
import * as settings from "./service.js";
import { createLogoUpload } from "../../lib/uploads.js";

// Fas: Inställningar — säljarinfo/färger för offert-PDF och publik
// offertsida, samt på/av + intervall för e-postpåminnelser (utskicket
// självt kräver en SMTP-leverantör som inte är kopplad ännu, se PLAN.md).
const router = Router();
const logoUpload = createLogoUpload("settings");

router.get("/", async (req, res, next) => {
  try {
    res.json(await settings.getSettings());
  } catch (err) {
    next(err);
  }
});

router.patch("/", async (req, res, next) => {
  try {
    res.json(await settings.updateSettings(req.body ?? {}));
  } catch (err) {
    next(err);
  }
});

router.post(
  "/logo",
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
