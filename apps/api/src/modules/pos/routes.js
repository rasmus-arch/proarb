import { Router } from "express";
import * as pos from "./service.js";
import { generateReceiptPdf } from "./pdf.js";

// Fas 4: kassasessioner, försäljning (rader + delad betalning) och kvitto.
// TODO (Fas 8): riktig inloggning — cashierId/openedBy hårdkodas till
// seed-admin (id 1) tills auth finns.
const DEFAULT_USER_ID = 1;

const router = Router();

router.get("/session", async (req, res, next) => {
  try {
    res.json(await pos.getOpenSession());
  } catch (err) {
    next(err);
  }
});

router.post("/session/open", async (req, res, next) => {
  try {
    const session = await pos.openSession(req.body ?? {}, DEFAULT_USER_ID);
    res.status(201).json(session);
  } catch (err) {
    next(err);
  }
});

router.post("/session/:id/close", async (req, res, next) => {
  try {
    if (req.body?.closingFloat === undefined) {
      return res.status(400).json({ error: "closingFloat krävs" });
    }
    const result = await pos.closeSession(Number(req.params.id), req.body);
    res.json(result);
  } catch (err) {
    if (err.message === "SESSION_NOT_FOUND") return res.status(404).json({ error: "Not found" });
    if (err.message === "SESSION_ALREADY_CLOSED") {
      return res.status(409).json({ error: "Kassan är redan stängd" });
    }
    next(err);
  }
});

router.get("/sales", async (req, res, next) => {
  try {
    const { sessionId, page = "1", pageSize = "25" } = req.query;
    const result = await pos.listSales({
      sessionId: sessionId ? Number(sessionId) : undefined,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 25,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/sales", async (req, res, next) => {
  try {
    const sale = await pos.createSale(req.body ?? {}, DEFAULT_USER_ID);
    res.status(201).json(sale);
  } catch (err) {
    if (err.message === "INVALID_SALE") {
      return res.status(400).json({ error: "sessionId och minst en rad krävs" });
    }
    if (err.message === "PAYMENT_REQUIRED") {
      return res.status(400).json({ error: "Minst en betalning krävs" });
    }
    if (err.message === "INVOICE_REQUIRES_CUSTOMER") {
      return res.status(400).json({ error: "Fakturaköp kräver att en kund väljs" });
    }
    if (err.message === "AMOUNT_MISMATCH") {
      return res.status(409).json({
        error: `Betalt belopp (${err.received} kr) matchar inte totalsumman (${err.expected} kr)`,
      });
    }
    next(err);
  }
});

router.get("/sales/:id", async (req, res, next) => {
  try {
    const sale = await pos.getSale(Number(req.params.id));
    if (!sale) return res.status(404).json({ error: "Not found" });
    res.json(sale);
  } catch (err) {
    next(err);
  }
});

router.get("/sales/:id/receipt", async (req, res, next) => {
  try {
    const sale = await pos.getSale(Number(req.params.id));
    if (!sale) return res.status(404).json({ error: "Not found" });
    const pdf = await generateReceiptPdf(sale);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${sale.sale_number}.pdf"`);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

export default router;
