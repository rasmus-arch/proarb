import { Router } from "express";

// TODO (Fas 3): order-CRUD, statusflöde, utlämning mot behörig kontakt,
// Fortnox-export vid fakturering. Se PLAN.md.
const router = Router();

router.get("/", (req, res) => {
  res.json({ rows: [], total: 0, note: "Ordermodulen är inte implementerad ännu (Fas 3)." });
});

export default router;
