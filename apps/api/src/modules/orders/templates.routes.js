import { Router } from "express";
import * as templates from "./templates.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    if (!req.query.customerId) return res.status(400).json({ error: "customerId krävs" });
    res.json({ rows: await templates.listOrderTemplates(Number(req.query.customerId)) });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/create-order", async (req, res, next) => {
  try {
    const order = await templates.createOrderFromTemplate(Number(req.params.id), req.user.id);
    res.status(201).json(order);
  } catch (err) {
    if (err.message === "TEMPLATE_NOT_FOUND") return res.status(404).json({ error: "Not found" });
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await templates.deleteOrderTemplate(Number(req.params.id));
    res.status(204).end();
  } catch (err) {
    if (err.message === "TEMPLATE_NOT_FOUND") return res.status(404).json({ error: "Not found" });
    next(err);
  }
});

export default router;
