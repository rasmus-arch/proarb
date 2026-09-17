import { Router } from "express";
import * as orders from "./service.js";

// Fas 3: direktskapande av order, statusflöde och utlämning mot behörig
// kontakt. "Offert -> order" ligger i quotes/routes.js (convert-to-order).
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

router.get("/print-queue", async (req, res, next) => {
  try {
    res.json({ rows: await orders.getPrintQueue({ status: req.query.status ?? "" }) });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const order = await orders.createOrder(req.body ?? {}, req.user.id);
    res.status(201).json(order);
  } catch (err) {
    if (err.message === "INVALID_ORDER") {
      return res.status(400).json({ error: "customerId och minst en rad krävs" });
    }
    if (err.message === "INVALID_LINE") {
      return res.status(400).json({ error: "Varje rad behöver antingen en produkt eller en beskrivning (fritextrad), plus antal och pris" });
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

router.post("/:id/duplicate", async (req, res, next) => {
  try {
    const order = await orders.duplicateOrder(Number(req.params.id), req.user.id);
    res.status(201).json(order);
  } catch (err) {
    if (err.message === "ORDER_NOT_FOUND") return res.status(404).json({ error: "Not found" });
    next(err);
  }
});

router.patch("/:id/status", async (req, res, next) => {
  try {
    if (!req.body?.status) return res.status(400).json({ error: "status krävs" });
    const order = await orders.updateOrderStatus(Number(req.params.id), req.body.status, {
      sendEmail: Boolean(req.body.sendEmail),
    });
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
      verifiedByUserId: req.user.id,
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

router.patch("/lines/:lineId/print-status", async (req, res, next) => {
  try {
    if (!req.body?.status) return res.status(400).json({ error: "status krävs" });
    const order = await orders.updatePrintStatus(Number(req.params.lineId), req.body.status);
    res.json(order);
  } catch (err) {
    if (err.message === "LINE_NOT_FOUND") return res.status(404).json({ error: "Not found" });
    if (err.message === "LINE_NOT_PRINTED") {
      return res.status(400).json({ error: "Raden har ingen tryckmetod" });
    }
    if (err.message === "INVALID_TRANSITION") {
      return res.status(409).json({ error: "Ogiltig statusövergång" });
    }
    next(err);
  }
});

export default router;
