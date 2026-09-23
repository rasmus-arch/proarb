import { Router } from "express";
import * as orders from "./service.js";
import { saveOrderAsTemplate } from "./templates.js";
import { getReturnableLines, listOrderReturns, createOrderReturn } from "./returns.js";
import { generateOrderSlipPdf } from "./pdf.js";
import { getSettings } from "../settings/service.js";
import { pool } from "../../lib/db.js";
import crypto from "node:crypto";

// Fas 3: direktskapande av order, statusflöde och utlämning mot behörig
// kontakt. "Offert -> order" ligger i quotes/routes.js (convert-to-order).
const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const { search = "", status = "", customerId = "", page = "1", pageSize = "25" } = req.query;
    const result = await orders.listOrders({
      search: String(search),
      status: String(status),
      customerId: String(customerId),
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

// Before /:id so a scanned order_number (e.g. "ORD-0001") isn't parsed as
// a numeric id — see Orderhantering (orderhantering.html/.js).
router.get("/by-number/:orderNumber", async (req, res, next) => {
  try {
    const order = await orders.getOrderByNumber(req.params.orderNumber);
    if (!order) return res.status(404).json({ error: "Ingen order med det numret" });
    res.json(order);
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

router.get("/:id/pdf", async (req, res, next) => {
  try {
    const order = await orders.getOrder(Number(req.params.id));
    if (!order) return res.status(404).json({ error: "Not found" });

    // Orders created before pickup_qr_token existed don't have one yet —
    // backfill lazily so every order can always print a working QR.
    if (!order.pickup_qr_token) {
      order.pickup_qr_token = crypto.randomBytes(24).toString("hex");
      await pool.query(`UPDATE orders SET pickup_qr_token = ? WHERE id = ?`, [order.pickup_qr_token, order.id]);
    }

    const qrUrl = `${req.protocol}://${req.get("host")}/qr/${order.pickup_qr_token}`;
    const settings = await getSettings();
    const pdf = await generateOrderSlipPdf(order, { qrUrl, settings });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${order.order_number}.pdf"`);
    res.send(pdf);
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

router.post("/:id/save-as-template", async (req, res, next) => {
  try {
    if (!req.body?.name) return res.status(400).json({ error: "name krävs" });
    const template = await saveOrderAsTemplate(Number(req.params.id), req.body.name, req.user.id);
    res.status(201).json(template);
  } catch (err) {
    if (err.message === "ORDER_NOT_FOUND") return res.status(404).json({ error: "Not found" });
    if (err.message === "NAME_REQUIRED") return res.status(400).json({ error: "name krävs" });
    next(err);
  }
});

router.patch("/:id/lines", async (req, res, next) => {
  try {
    if (!Array.isArray(req.body?.lines) || req.body.lines.length === 0) {
      return res.status(400).json({ error: "Minst en rad krävs" });
    }
    const order = await orders.updateOrderLines(Number(req.params.id), req.body.lines);
    res.json(order);
  } catch (err) {
    if (err.message === "ORDER_NOT_FOUND") return res.status(404).json({ error: "Not found" });
    if (err.message === "ORDER_LINES_LOCKED") {
      return res.status(409).json({ error: "Ordern kan inte längre redigeras (redan utlämnad/fakturerad/avbruten)" });
    }
    if (err.message === "INVALID_LINE") {
      return res.status(400).json({ error: "Varje rad behöver antingen en produkt eller en beskrivning, plus antal och pris" });
    }
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

router.get("/:id/returnable-lines", async (req, res, next) => {
  try {
    res.json({ rows: await getReturnableLines(Number(req.params.id)) });
  } catch (err) {
    if (err.message === "ORDER_NOT_FOUND") return res.status(404).json({ error: "Not found" });
    next(err);
  }
});

router.get("/:id/returns", async (req, res, next) => {
  try {
    res.json({ rows: await listOrderReturns(Number(req.params.id)) });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/returns", async (req, res, next) => {
  try {
    if (!Array.isArray(req.body?.lines) || req.body.lines.length === 0) {
      return res.status(400).json({ error: "lines krävs" });
    }
    const order = await createOrderReturn(
      Number(req.params.id),
      { reason: req.body.reason, lines: req.body.lines },
      req.user.id
    );
    res.status(201).json(order);
  } catch (err) {
    if (err.message === "ORDER_NOT_FOUND") return res.status(404).json({ error: "Not found" });
    if (err.message === "ORDER_NOT_RETURNABLE") {
      return res.status(409).json({ error: "Ordern måste vara utlämnad eller fakturerad för att kunna returneras" });
    }
    if (err.message === "INVALID_RETURN") return res.status(400).json({ error: "Ogiltig retur" });
    if (err.message === "QUANTITY_EXCEEDS_DELIVERED") {
      return res.status(400).json({ error: "Antalet överstiger vad som levererats/redan returnerats" });
    }
    next(err);
  }
});

export default router;
