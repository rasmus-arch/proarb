import { Router } from "express";

// TODO (Fas 5): lagersaldo per plats, inleverans-/inventeringsskanning,
// lagerrörelser, lågt-lager-varningar. Se PLAN.md.
const router = Router();

router.get("/", (req, res) => {
  res.json({ rows: [], total: 0, note: "Lagermodulen är inte implementerad ännu (Fas 5)." });
});

export default router;
