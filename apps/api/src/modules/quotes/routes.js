import { Router } from "express";
import * as quotes from "./service.js";
import { generateQuotePdf } from "./pdf.js";
import { convertQuoteToOrder } from "../orders/service.js";
import { getSettings } from "../settings/service.js";

const REMINDER_DEFAULT_DAYS = 5;

// Fas 2: offert-CRUD, PDF-generering, skicka, konvertera till order.
// Publik länk (/q/:token) och accept/avböj ligger i public.js.
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

// Fas 7 påminnelser: staff-visible list of unanswered quotes, no SMTP
// involved (se quotes/service.js). Off entirely when reminder_enabled is
// false in Inställningar.
router.get("/reminders", async (req, res, next) => {
  try {
    const settings = await getSettings();
    if (!settings?.reminder_enabled) return res.json({ rows: [] });
    const rows = await quotes.listQuotesNeedingReminder(settings.reminder_days_after ?? REMINDER_DEFAULT_DAYS);
    res.json({ rows });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    if (!req.body?.customerId || !Array.isArray(req.body?.lines) || req.body.lines.length === 0) {
      return res.status(400).json({ error: "customerId och minst en rad krävs" });
    }
    const quote = await quotes.createQuote(req.body, req.user.id);
    res.status(201).json(quote);
  } catch (err) {
    if (err.message === "INVALID_LINE") {
      return res.status(400).json({ error: "Varje rad behöver antingen en produkt eller en beskrivning (fritextrad), plus antal och pris" });
    }
    next(err);
  }
});

router.post("/:id/duplicate", async (req, res, next) => {
  try {
    const quote = await quotes.duplicateQuote(Number(req.params.id), req.user.id);
    res.status(201).json(quote);
  } catch (err) {
    if (err.message === "QUOTE_NOT_FOUND") return res.status(404).json({ error: "Not found" });
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
    if (err.message === "INVALID_LINE") {
      return res.status(400).json({ error: "Varje rad behöver antingen en produkt eller en beskrivning (fritextrad), plus antal och pris" });
    }
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

router.post("/:id/email", async (req, res, next) => {
  try {
    const quote = await quotes.getQuote(Number(req.params.id));
    if (!quote) return res.status(404).json({ error: "Not found" });
    const publicUrl = `${req.protocol}://${req.get("host")}/q/${quote.public_token}`;
    const result = await quotes.emailQuoteToCustomer(Number(req.params.id), publicUrl);
    res.json(result);
  } catch (err) {
    if (err.message === "NO_CUSTOMER_EMAIL") {
      return res.status(400).json({ error: "Kunden saknar e-postadress" });
    }
    next(err);
  }
});

router.post("/:id/convert-to-order", async (req, res, next) => {
  try {
    const order = await convertQuoteToOrder(Number(req.params.id), req.user.id);
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

router.post("/:id/reminder-sent", async (req, res, next) => {
  try {
    await quotes.markReminderSent(Number(req.params.id));
    res.status(204).end();
  } catch (err) {
    if (err.message === "QUOTE_NOT_FOUND") return res.status(404).json({ error: "Not found" });
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
