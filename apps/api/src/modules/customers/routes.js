import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import * as customers from "./service.js";
import { createLogoUpload, uploadsRoot } from "../../lib/uploads.js";

const DEFAULT_USER_ID = 1; // TODO (Fas 8): real auth

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

router.delete("/:id", async (req, res, next) => {
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
      uploadedBy: DEFAULT_USER_ID,
    });
    res.status(201).json(logo);
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

export default router;
