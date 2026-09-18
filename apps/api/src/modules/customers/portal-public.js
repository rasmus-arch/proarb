import { Router } from "express";
import { createPortalOrderRequest } from "./portal-requests.js";

// The customer-facing side of "beställ från Mina sidor": no login, reached
// only by knowing the unguessable portal_token — same trust model as the
// public quote link. Mounted at /api/public/portal in index.js; the
// actual HTML page lives at GET /portal/:token (customers/portal.js).
const router = Router();

router.post("/:token/request", async (req, res, next) => {
  try {
    const result = await createPortalOrderRequest(req.params.token, {
      requestedByName: req.body?.requestedByName,
      lines: Array.isArray(req.body?.lines) ? req.body.lines : [],
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

export default router;
