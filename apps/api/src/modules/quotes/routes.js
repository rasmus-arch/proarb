import { Router } from "express";
import * as quotes from "./service.js";
import { generateQuotePdf } from "./pdf.js";
import { convertQuoteToOrder } from "../orders/service.js";
import { getSettings } from "../settings/service.js";

// Fas 2: offert-CRUD, PDF-generering, skicka, konvertera till order.
// Publik länk (/q/:token) och accept/avböj ligger i public.js.
// TODO (Fas 8): riktig inloggning — "createdBy" är hårdkodad till
// seed-admin (id 1) tills auth finns.
const DEFAULT_USER_ID = 1;

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const { search = "", status = "", page = "1", pageSize = "25" } = req.query;
    const result = await quotes.listQuotes({
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
    if (!req.body?.customerId || !Array.isArray(req.body?.lines) || req.body.lines.length === 0) {
      return res.status(400).json({ error: "customerId och minst en rad krävs" });
    }
    const quote = await quotes.createQuote(req.body, DEFAULT_USER_ID);
    res.status(201).json(quote);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const quote = await quotes.getQuote(Number(req.params.id));
    if (!quote) return res.status(404).json({ error: "Not found" });
    res.json(quote);
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const existing = await quotes.getQuote(Number(req.params.id));
    if (!existing) return res.status(404).json({ error: "Not found" });
    if (existing.status !== "DRAFT") {
      return res.status(409).json({ error: "Endast utkast kan redigeras" });
    }
    const quote = await quotes.updateQuote(Number(req.params.id), req.body ?? {});
    res.json(quote);
  } catch (err) {
    next(err);
  }
});

router.post("/:id/send", async (req, res, next) => {
  try {
    const quote = await quotes.sendQuote(Number(req.params.id));
    if (!quote) return res.status(404).json({ error: "Not found" });
    res.json(quote);
  } catch (err) {
    next(err);
  }
});

router.post("/:id/convert-to-order", async (req, res, next) => {
  try {
    const order = await convertQuoteToOrder(Number(req.params.id), DEFAULT_USER_ID);
    res.status(201).json(order);
  } catch (err) {
    if (err.message === "QUOTE_NOT_FOUND") return res.status(404).json({ error: "Offert saknas" });
    if (err.message === "QUOTE_ALREADY_CONVERTED") {
      return res.status(409).json({ error: "Offerten är redan omvandlad till en order" });
    }
    if (err.message === "QUOTE_NOT_ACCEPTED") {
      return res.status(409).json({ error: "Endast accepterade offerter kan bli order" });
    }
    next(err);
  }
});

router.get("/:id/pdf", async (req, res, next) => {
  try {
    const quote = await quotes.getQuote(Number(req.params.id));
    if (!quote) return res.status(404).json({ error: "Not found" });
    const publicUrl = `${req.protocol}://${req.get("host")}/q/${quote.public_token}`;
    const settings = await getSettings();
    const pdf = await generateQuotePdf(quote, { publicUrl, settings });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${quote.quote_number}.pdf"`);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

export default router;
