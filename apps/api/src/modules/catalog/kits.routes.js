import { Router } from "express";
import * as kits from "./kits.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    res.json({ rows: await kits.listKits() });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const customerId = req.query.customerId ? Number(req.query.customerId) : null;
    const kit = await kits.getKit(Number(req.params.id), customerId);
    if (!kit) return res.status(404).json({ error: "Not found" });
    res.json(kit);
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const kit = await kits.createKit(req.body ?? {});
    res.status(201).json(kit);
  } catch (err) {
    if (err.message === "NAME_REQUIRED") return res.status(400).json({ error: "Namn krävs" });
    if (err.message === "LINES_REQUIRED") return res.status(400).json({ error: "Minst en rad krävs" });
    next(err);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const kit = await kits.updateKit(Number(req.params.id), req.body ?? {});
    res.json(kit);
  } catch (err) {
    if (err.message === "KIT_NOT_FOUND") return res.status(404).json({ error: "Not found" });
    if (err.message === "NAME_REQUIRED") return res.status(400).json({ error: "Namn krävs" });
    if (err.message === "LINES_REQUIRED") return res.status(400).json({ error: "Minst en rad krävs" });
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await kits.deleteKit(Number(req.params.id));
    res.status(204).end();
  } catch (err) {
    if (err.message === "KIT_NOT_FOUND") return res.status(404).json({ error: "Not found" });
    next(err);
  }
});

export default router;
