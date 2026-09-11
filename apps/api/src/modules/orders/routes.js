import { Router } from "express";
import * as orders from "./service.js";

// Fas 3: direktskapande av order, statusflöde och utlämning mot behörig
// kontakt. "Offert -> order" ligger i quotes/routes.js (convert-to-order).
// TODO (Fas 8): riktig inloggning — createdBy/verifiedBy hårdkodas till
// seed-admin (id 1) tills auth finns.
const DEFAULT_USER_ID = 1;

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

router.post("/", async (req, res, next) => {
  try {
    const order = await orders.createOrder(req.body ?? {}, DEFAULT_USER_ID);
    res.status(201).json(order);
  } catch (err) {
    if (err.message === "INVALID_ORDER") {
      return res.status(400).json({ error: "customerId och minst en rad krävs" });
    }
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

router.patch("/:id/status", async (req, res, next) => {
  try {
    if (!req.body?.status) return res.status(400).json({ error: "status krävs" });
    const order = await orders.updateOrderStatus(Number(req.params.id), req.body.status);
    res.json(order);
  } catch (err) {
    if (err.message === "ORDER_NOT_FOUND") return res.status(404).json({ error: "Not found" });
    if (err.message === "INVALID_TRANSITION") {
      return res.status(409).json({ error: "Ogiltig statusövergång" });
    }
    next(err);
  }
});

router.post("/:id/pickup", async (req, res, next) => {
  try {
    const order = await orders.recordPickup(Number(req.params.id), {
      pickedUpByContactId: req.body?.pickedUpByContactId || null,
      pickedUpByName: req.body?.pickedUpByName || null,
      verifiedByUserId: DEFAULT_USER_ID,
    });
    res.json(order);
  } catch (err) {
    if (err.message === "ORDER_NOT_FOUND") return res.status(404).json({ error: "Not found" });
    if (err.message === "ORDER_NOT_PICKUPABLE") {
      return res.status(409).json({ error: "Ordern kan inte hämtas ut i sitt nuvarande status" });
    }
    if (err.message === "PICKUP_IDENTITY_REQUIRED") {
      return res.status(400).json({ error: "Välj en hämtberättigad kontakt eller ange namn" });
    }
    next(err);
  }
});

export default router;
