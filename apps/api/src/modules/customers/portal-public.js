import { Router } from "express";
import { createPortalOrderRequest, addPortalContact, reorderFromOrder } from "./portal-requests.js";
import { getSettings } from "../settings/service.js";
import { getSessionAccount, PORTAL_SESSION_COOKIE } from "./portal-accounts.js";
import { publicFormLimiter } from "../../lib/security.js";

// The customer-facing side of "beställ från Mina sidor": no login, reached
// only by knowing the unguessable portal_token — same trust model as the
// public quote link. Mounted at /api/public/portal in index.js; the
// actual HTML page lives at GET /portal/:token (customers/portal.js).
const router = Router();

// E-posten för bekräftelsemejl: den inloggade Sortilog-användaren om
// sessionen hör till samma kund.
async function requesterEmail(req) {
  const account = await getSessionAccount(req.cookies?.[PORTAL_SESSION_COOKIE]);
  return account && account.portal_token === req.params.token ? account.email : null;
}

// När Sortilog kräver inloggning räcker det inte att känna till token —
// anropet måste komma från en inloggad session för just den kunden.
router.use("/:token", async (req, res, next) => {
  try {
    const settings = await getSettings();
    if (!settings?.portal_require_login) return next();
    const account = await getSessionAccount(req.cookies?.[PORTAL_SESSION_COOKIE]);
    if (!account || account.portal_token !== req.params.token) {
      return res.status(401).json({ error: "Logga in på Sortilog igen" });
    }
    next();
  } catch (err) {
    next(err);
  }
});

router.post("/:token/request", publicFormLimiter, async (req, res, next) => {
  try {
    const result = await createPortalOrderRequest(req.params.token, {
      requestedByName: req.body?.requestedByName,
      referenceContactId: req.body?.referenceContactId ? Number(req.body.referenceContactId) : null,
      lines: Array.isArray(req.body?.lines) ? req.body.lines : [],
      requesterEmail: await requesterEmail(req),
    });
    res.status(201).json(result);
  } catch (err) {
    if (err.message === "CUSTOMER_NOT_FOUND") return res.status(404).json({ error: "Not found" });
    if (err.message === "INVALID_REQUEST") {
      return res.status(400).json({ error: "Ange minst ett antal för en produkt i sortimentet" });
    }
    next(err);
  }
});

router.post("/:token/contacts", publicFormLimiter, async (req, res, next) => {
  try {
    const contact = await addPortalContact(req.params.token, { name: req.body?.name });
    res.status(201).json(contact);
  } catch (err) {
    if (err.message === "CUSTOMER_NOT_FOUND") return res.status(404).json({ error: "Not found" });
    if (err.message === "NAME_REQUIRED") return res.status(400).json({ error: "Namn krävs" });
    next(err);
  }
});

router.post("/:token/orders/:orderId/reorder", publicFormLimiter, async (req, res, next) => {
  try {
    const result = await reorderFromOrder(req.params.token, Number(req.params.orderId), {
      requesterEmail: await requesterEmail(req),
    });
    res.status(201).json(result);
  } catch (err) {
    if (err.message === "CUSTOMER_NOT_FOUND" || err.message === "ORDER_NOT_FOUND") {
      return res.status(404).json({ error: "Not found" });
    }
    if (err.message === "NO_REORDERABLE_LINES") {
      return res.status(400).json({ error: "Inget i den ordern går att återbeställa längre" });
    }
    next(err);
  }
});

export default router;
