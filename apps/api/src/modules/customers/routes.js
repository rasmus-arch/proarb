import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import * as customers from "./service.js";
import { createLogoUpload, uploadsRoot } from "../../lib/uploads.js";
import { requireRole } from "../../lib/auth-middleware.js";

const router = Router();
const logoUpload = createLogoUpload("customer-logos");

router.get("/", async (req, res, next) => {
  try {
    const { search = "", page = "1", pageSize = "25" } = req.query;
    const result = await customers.listCustomers({
      search: String(search),
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
    if (!req.body?.name) {
      return res.status(400).json({ error: "name is required" });
    }
    const customer = await customers.createCustomer(req.body);
    res.status(201).json(customer);
  } catch (err) {
    next(err);
  }
});

// Before /:id so "inactive" isn't swallowed as an :id value.
router.get("/inactive", async (req, res, next) => {
  try {
    const months = Number(req.query.months) || 6;
    res.json({ rows: await customers.listInactiveCustomers(months) });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const customer = await customers.getCustomer(Number(req.params.id));
    if (!customer) return res.status(404).json({ error: "Not found" });
    res.json(customer);
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const customer = await customers.updateCustomer(Number(req.params.id), req.body ?? {});
    if (!customer) return res.status(404).json({ error: "Not found" });
    res.json(customer);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", requireRole("ADMIN"), async (req, res, next) => {
  try {
    await customers.deactivateCustomer(Number(req.params.id));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.post("/:id/contacts", async (req, res, next) => {
  try {
    if (!req.body?.name) {
      return res.status(400).json({ error: "name is required" });
    }
    const contact = await customers.addContact(Number(req.params.id), req.body);
    res.status(201).json(contact);
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/contacts/:contactId", async (req, res, next) => {
  try {
    const contact = await customers.updateContact(
      Number(req.params.id),
      Number(req.params.contactId),
      req.body ?? {}
    );
    if (!contact) return res.status(404).json({ error: "Not found" });
    res.json(contact);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id/contacts/:contactId", async (req, res, next) => {
  try {
    await customers.deactivateContact(Number(req.params.id), Number(req.params.contactId));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Named logo/print-artwork variants. Allowed formats enforced by
// createLogoUpload: eps, jpg, png, svg, pdf.
router.post("/:id/logos", (req, res, next) => {
  logoUpload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Ingen fil bifogad (fältnamn: file)" });
    if (!req.body?.name) return res.status(400).json({ error: "Namn krävs för varianten" });

    const logo = await customers.addLogo(Number(req.params.id), {
      name: req.body.name,
      filePath: `customer-logos/${req.file.filename}`,
      originalFilename: req.file.originalname,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      uploadedBy: req.user.id,
    });
    res.status(201).json(logo);
  } catch (err) {
    next(err);
  }
});

// Kundportal (Fas 7): create the share-link token on demand (idempotent —
// returns the existing token if one was already generated).
router.post("/:id/portal-token", async (req, res, next) => {
  try {
    const token = await customers.getOrCreatePortalToken(Number(req.params.id));
    if (!token) return res.status(404).json({ error: "Not found" });
    res.json({ token, url: `${req.protocol}://${req.get("host")}/portal/${token}` });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id/logos/:logoId", async (req, res, next) => {
  try {
    const logo = await customers.getLogo(Number(req.params.id), Number(req.params.logoId));
    if (!logo) return res.status(404).json({ error: "Not found" });

    await customers.deleteLogo(Number(req.params.id), Number(req.params.logoId));
    fs.unlink(path.join(uploadsRoot, logo.file_path), () => {});
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get("/:id/discounts", async (req, res, next) => {
  try {
    res.json({ rows: await customers.listDiscounts(Number(req.params.id)) });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/discounts", async (req, res, next) => {
  try {
    const discount = await customers.addDiscount(Number(req.params.id), req.body ?? {});
    res.status(201).json(discount);
  } catch (err) {
    if (err.message === "DISCOUNT_TARGET_REQUIRED") {
      return res.status(400).json({ error: "Välj antingen leverantör eller produkt" });
    }
    if (err.message === "DISCOUNT_TARGET_AMBIGUOUS") {
      return res.status(400).json({ error: "Välj antingen leverantör eller produkt, inte båda" });
    }
    if (err.message === "INVALID_DISCOUNT_PERCENT") {
      return res.status(400).json({ error: "Rabatten måste vara mellan 0 och 100 %" });
    }
    next(err);
  }
});

router.delete("/:id/discounts/:discountId", async (req, res, next) => {
  try {
    await customers.removeDiscount(Number(req.params.id), Number(req.params.discountId));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get("/:id/assortment", async (req, res, next) => {
  try {
    res.json({ rows: await customers.listAssortment(Number(req.params.id)) });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/assortment", async (req, res, next) => {
  try {
    if (!req.body?.productId) return res.status(400).json({ error: "productId krävs" });
    const rows = await customers.addToAssortment(Number(req.params.id), Number(req.body.productId));
    res.status(201).json({ rows });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id/assortment/:productId", async (req, res, next) => {
  try {
    await customers.removeFromAssortment(Number(req.params.id), Number(req.params.productId));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
