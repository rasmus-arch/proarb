import { Router } from "express";
import * as orders from "./service.js";

// Fas 3 will add full order management (statusflöde, utlämning). For now
// this exposes read access so ordrar.html can show orders created via
// offert-konvertering (Fas 2). Se PLAN.md.
const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const { search = "", status = "", page = "1", pageSize = "25" } = req.query;
    const result = await orders.listOrders({
      search: String(search),
      status: String(status),
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 25,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const order = await orders.getOrder(Number(req.params.id));
    if (!order) return res.status(404).json({ error: "Not found" });
    res.json(order);
  } catch (err) {
    next(err);
  }
});

export default router;
