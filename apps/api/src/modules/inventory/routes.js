import { Router } from "express";
import * as inventory from "./service.js";
import * as purchaseOrders from "./purchase-orders.js";
import * as stockCounts from "./stock-counts.js";
import { getPurchaseSuggestions } from "./purchase-suggestions.js";
import { requireRole } from "../../lib/auth-middleware.js";

// Fas 5: lagersaldo, inleverans (PO + streckkod), inventering (juridiskt
// spårbar), lågt-lager-varningar, inköpsförslag. Se PLAN.md.
// Fas 8: alla som ändrar lagersaldo kräver rollen WAREHOUSE eller ADMIN —
// att läsa saldo/inköpsförslag är fortfarande öppet för alla inloggade.
const canAdjustStock = requireRole("ADMIN", "WAREHOUSE");

const router = Router();

// --- Warehouses / stock levels ---------------------------------------

router.get("/warehouses", async (req, res, next) => {
  try {
    res.json({ rows: await inventory.listWarehouses() });
  } catch (err) {
    next(err);
  }
});

router.get("/stock-levels", async (req, res, next) => {
  try {
    const { search = "", warehouseId, lowStockOnly, page = "1", pageSize = "50" } = req.query;
    const result = await inventory.listStockLevels({
      search: String(search),
      warehouseId: warehouseId ? Number(warehouseId) : undefined,
      lowStockOnly: lowStockOnly === "true",
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 50,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.patch("/stock-levels/:variantId/:warehouseId/reorder", canAdjustStock, async (req, res, next) => {
  try {
    await inventory.setReorderSettings(Number(req.params.variantId), Number(req.params.warehouseId), req.body ?? {});
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.post("/stock-levels/:variantId/:warehouseId/adjust", canAdjustStock, async (req, res, next) => {
  try {
    if (req.body?.newQuantity === undefined) return res.status(400).json({ error: "newQuantity krävs" });
    await inventory.adjustStockManually({
      variantId: Number(req.params.variantId),
      warehouseId: Number(req.params.warehouseId),
      newQuantity: req.body.newQuantity,
      note: req.body.note ?? null,
      userId: req.user.id,
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// --- Purchase orders / inleverans --------------------------------------

router.get("/purchase-orders", async (req, res, next) => {
  try {
    res.json({ rows: await purchaseOrders.listPurchaseOrders({ status: req.query.status ?? "" }) });
  } catch (err) {
    next(err);
  }
});

router.post("/purchase-orders", canAdjustStock, async (req, res, next) => {
  try {
    const po = await purchaseOrders.createPurchaseOrder(req.body ?? {});
    res.status(201).json(po);
  } catch (err) {
    if (err.message === "INVALID_PURCHASE_ORDER") {
      return res.status(400).json({ error: "supplierId och minst en rad krävs" });
    }
    next(err);
  }
});

router.get("/purchase-orders/:id", async (req, res, next) => {
  try {
    const po = await purchaseOrders.getPurchaseOrder(Number(req.params.id));
    if (!po) return res.status(404).json({ error: "Not found" });
    res.json(po);
  } catch (err) {
    next(err);
  }
});

router.post("/purchase-orders/:id/receive", canAdjustStock, async (req, res, next) => {
  try {
    if (!req.body?.barcode) return res.status(400).json({ error: "barcode krävs" });
    const po = await purchaseOrders.receiveByBarcode(Number(req.params.id), {
      barcode: req.body.barcode,
      quantity: req.body.quantity ?? 1,
      warehouseId: req.body.warehouseId ?? inventory.DEFAULT_WAREHOUSE_ID,
      userId: req.user.id,
    });
    res.json(po);
  } catch (err) {
    if (err.message === "PO_NOT_FOUND") return res.status(404).json({ error: "Not found" });
    if (err.message === "PO_ALREADY_RECEIVED") return res.status(409).json({ error: "Ordern är redan mottagen" });
    if (err.message === "BARCODE_NOT_ON_ORDER") {
      return res.status(404).json({ error: "Streckkoden finns inte på den här inköpsordern" });
    }
    next(err);
  }
});

// --- Stock counts / inventering ------------------------------------------

router.get("/stock-counts", async (req, res, next) => {
  try {
    const { warehouseId } = req.query;
    res.json({ rows: await stockCounts.listStockCounts({ warehouseId: warehouseId ? Number(warehouseId) : undefined }) });
  } catch (err) {
    next(err);
  }
});

router.post("/stock-counts", canAdjustStock, async (req, res, next) => {
  try {
    if (!req.body?.warehouseId) return res.status(400).json({ error: "warehouseId krävs" });
    const count = await stockCounts.startStockCount({ warehouseId: req.body.warehouseId, userId: req.user.id });
    res.status(201).json(count);
  } catch (err) {
    next(err);
  }
});

router.get("/stock-counts/:id", async (req, res, next) => {
  try {
    const count = await stockCounts.getStockCount(Number(req.params.id));
    if (!count) return res.status(404).json({ error: "Not found" });
    res.json(count);
  } catch (err) {
    next(err);
  }
});

router.post("/stock-counts/:id/scan", canAdjustStock, async (req, res, next) => {
  try {
    if (!req.body?.barcode) return res.status(400).json({ error: "barcode krävs" });
    const count = await stockCounts.scanCountLine(Number(req.params.id), req.body);
    res.json(count);
  } catch (err) {
    if (err.message === "COUNT_NOT_FOUND") return res.status(404).json({ error: "Not found" });
    if (err.message === "COUNT_NOT_IN_PROGRESS") return res.status(409).json({ error: "Inventeringen är avslutad" });
    if (err.message === "BARCODE_NOT_FOUND") return res.status(404).json({ error: "Okänd streckkod" });
    next(err);
  }
});

router.post("/stock-counts/:id/lines", canAdjustStock, async (req, res, next) => {
  try {
    if (!req.body?.productVariantId) return res.status(400).json({ error: "productVariantId krävs" });
    const count = await stockCounts.addCountLineManual(Number(req.params.id), req.body);
    res.json(count);
  } catch (err) {
    if (err.message === "COUNT_NOT_FOUND") return res.status(404).json({ error: "Not found" });
    if (err.message === "COUNT_NOT_IN_PROGRESS") return res.status(409).json({ error: "Inventeringen är avslutad" });
    next(err);
  }
});

router.post("/stock-counts/:id/lines/:lineId/decide", canAdjustStock, async (req, res, next) => {
  try {
    if (!["ADJUST", "KEEP"].includes(req.body?.decision)) {
      return res.status(400).json({ error: "decision måste vara ADJUST eller KEEP" });
    }
    const count = await stockCounts.decideLine(Number(req.params.id), Number(req.params.lineId), {
      decision: req.body.decision,
      userId: req.user.id,
    });
    res.json(count);
  } catch (err) {
    if (err.message === "COUNT_NOT_FOUND" || err.message === "LINE_NOT_FOUND") {
      return res.status(404).json({ error: "Not found" });
    }
    next(err);
  }
});

router.post("/stock-counts/:id/missing/:variantId/decide", canAdjustStock, async (req, res, next) => {
  try {
    if (!["ADJUST", "KEEP"].includes(req.body?.decision)) {
      return res.status(400).json({ error: "decision måste vara ADJUST eller KEEP" });
    }
    const count = await stockCounts.decideMissing(Number(req.params.id), {
      productVariantId: Number(req.params.variantId),
      decision: req.body.decision,
      userId: req.user.id,
    });
    res.json(count);
  } catch (err) {
    if (err.message === "COUNT_NOT_FOUND" || err.message === "NOT_MISSING") {
      return res.status(404).json({ error: "Not found" });
    }
    next(err);
  }
});

router.post("/stock-counts/:id/decide-all", canAdjustStock, async (req, res, next) => {
  try {
    if (!["ADJUST", "KEEP"].includes(req.body?.decision)) {
      return res.status(400).json({ error: "decision måste vara ADJUST eller KEEP" });
    }
    const count = await stockCounts.decideAll(Number(req.params.id), {
      decision: req.body.decision,
      userId: req.user.id,
    });
    res.json(count);
  } catch (err) {
    if (err.message === "COUNT_NOT_FOUND") return res.status(404).json({ error: "Not found" });
    next(err);
  }
});

router.post("/stock-counts/:id/complete", canAdjustStock, async (req, res, next) => {
  try {
    const count = await stockCounts.completeStockCount(Number(req.params.id));
    res.json(count);
  } catch (err) {
    if (err.message === "COUNT_NOT_FOUND") return res.status(404).json({ error: "Not found" });
    if (err.message === "COUNT_NOT_IN_PROGRESS") return res.status(409).json({ error: "Inventeringen är redan avslutad" });
    if (err.message === "UNRESOLVED_DISCREPANCIES") {
      return res.status(409).json({ error: "Alla avvikelser måste beslutas (justera/behåll) innan avslut" });
    }
    next(err);
  }
});

// --- Purchase suggestions (inköpsförslag) -------------------------------

router.get("/purchase-suggestions", async (req, res, next) => {
  try {
    res.json({ bySupplier: await getPurchaseSuggestions() });
  } catch (err) {
    next(err);
  }
});

export default router;
