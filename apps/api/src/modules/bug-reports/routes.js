import { Router } from "express";
import * as bugReports from "./service.js";
import { requireRole } from "../../lib/auth-middleware.js";

// Fas 9: alla inloggade roller får rapportera problem (se nav.js för
// dialogen) — det är trots allt kundens egen personal som stöter på
// buggarna. Listan (för att se synk-status mot GitHub) är ADMIN-only,
// se index.js.
const router = Router();

router.post("/", async (req, res, next) => {
  try {
    const report = await bugReports.createBugReport(req.body ?? {}, req.user);
    res.status(201).json(report);
  } catch (err) {
    if (err.message === "INVALID_BUG_REPORT") {
      return res.status(400).json({ error: "Titel och beskrivning krävs" });
    }
    next(err);
  }
});

router.get("/", requireRole("ADMIN"), async (req, res, next) => {
  try {
    res.json({ rows: await bugReports.listBugReports() });
  } catch (err) {
    next(err);
  }
});

export default router;
