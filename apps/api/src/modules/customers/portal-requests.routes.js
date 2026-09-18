import { Router } from "express";
import * as portalRequests from "./portal-requests.js";

// Staff-facing side of self-service beställningar från "Mina sidor" — see
// portal-requests.js for why a submission doesn't become a real order
// until a logged-in säljare explicitly converts it here.
const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const { status = "NEW" } = req.query;
    res.json({ rows: await portalRequests.listPortalOrderRequests({ status: String(status) }) });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/convert", async (req, res, next) => {
  try {
    const order = await portalRequests.convertPortalOrderRequest(Number(req.params.id), req.user.id);
    res.status(201).json(order);
  } catch (err) {
    if (err.message === "REQUEST_NOT_FOUND") return res.status(404).json({ error: "Not found" });
    if (err.message === "REQUEST_ALREADY_HANDLED") {
      return res.status(409).json({ error: "Förfrågan är redan hanterad" });
    }
    next(err);
  }
});

router.post("/:id/dismiss", async (req, res, next) => {
  try {
    await portalRequests.dismissPortalOrderRequest(Number(req.params.id), req.user.id);
    res.status(204).end();
  } catch (err) {
    if (err.message === "REQUEST_NOT_FOUND") return res.status(404).json({ error: "Not found" });
    next(err);
  }
});

export default router;
