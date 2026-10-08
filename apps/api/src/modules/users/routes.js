import { Router } from "express";
import * as users from "./service.js";
import { weakPasswordMessage } from "../../lib/security.js";

const ROLES = ["ADMIN", "SALES", "WAREHOUSE"];

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
    if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error: "Ogiltig roll" });
    const user = await users.createUser({ name, email, password, role });
    res.status(201).json(user);
  } catch (err) {
    if (err.message === "WEAK_PASSWORD") return res.status(400).json({ error: weakPasswordMessage(err) });
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "En användare med den e-postadressen finns redan" });
    }
    next(err);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const body = req.body ?? {};
    if (body.role !== undefined && !ROLES.includes(body.role)) return res.status(400).json({ error: "Ogiltig roll" });
    // Skydd mot att låsa ut sig själv.
    if (id === req.user.id && (body.active === false || (body.role !== undefined && body.role !== "ADMIN"))) {
      return res.status(400).json({ error: "Du kan inte stänga av eller ta bort administratörsrollen från ditt eget konto." });
    }
    const user = await users.updateUser(id, body);
    if (!user) return res.status(404).json({ error: "Not found" });
    res.json(user);
  } catch (err) {
    if (err.message === "WEAK_PASSWORD") return res.status(400).json({ error: weakPasswordMessage(err) });
    next(err);
  }
});

export default router;
