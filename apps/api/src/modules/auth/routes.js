import { Router } from "express";
import * as auth from "./service.js";
import { SESSION_COOKIE, requireAuth } from "../../lib/auth-middleware.js";

const router = Router();

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      return res.status(400).json({ error: "E-post och lösenord krävs" });
    }
    const result = await auth.login(email, password);
    if (!result) return res.status(401).json({ error: "Fel e-post eller lösenord" });

    res.cookie(SESSION_COOKIE, result.token, COOKIE_OPTIONS);
    res.json({ user: result.user });
  } catch (err) {
    next(err);
  }
});

router.post("/logout", async (req, res, next) => {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await auth.logout(token);
    res.clearCookie(SESSION_COOKIE);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
