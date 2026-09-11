import { Router } from "express";

// TODO (Fas 4): kassasessioner, försäljning med rader/betalningar,
// kvittogenerering, avstämning. Se PLAN.md.
const router = Router();

router.get("/", (req, res) => {
  res.json({ rows: [], total: 0, note: "Kassamodulen är inte implementerad ännu (Fas 4)." });
});

export default router;
