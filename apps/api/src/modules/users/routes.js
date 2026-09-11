import { Router } from "express";
import * as users from "./service.js";

// ADMIN-only (see index.js: requireRole("ADMIN") on this router) — user
// accounts and roles are sensitive, per Fas 8.
const router = Router();

router.get("/", async (req, res, next) => {
  try {
    res.json({ rows: await users.listUsers() });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body ?? {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: "Namn, e-post och lösenord krävs" });
    }
    const user = await users.createUser({ name, email, password, role });
    res.status(201).json(user);
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "En användare med den e-postadressen finns redan" });
    }
    next(err);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const user = await users.updateUser(Number(req.params.id), req.body ?? {});
    if (!user) return res.status(404).json({ error: "Not found" });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

export default router;
