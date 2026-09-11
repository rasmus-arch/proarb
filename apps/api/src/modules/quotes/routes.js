import { Router } from "express";

// TODO (Fas 2): offert-CRUD, PDF-generering, publik länk (/q/:token),
// acceptera/avböj, konvertera till order. Se PLAN.md.
const router = Router();

router.get("/", (req, res) => {
  res.json({ rows: [], total: 0, note: "Offertmodulen är inte implementerad ännu (Fas 2)." });
});

export default router;
