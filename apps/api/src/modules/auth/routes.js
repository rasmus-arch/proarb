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

const PASSWORD_ERRORS = {
  WRONG_PASSWORD: [400, "Nuvarande lösenord stämmer inte"],
  WEAK_PASSWORD: [400, "Lösenordet måste vara minst 8 tecken"],
  INVALID_TOKEN: [400, "Länken är ogiltig eller har gått ut — begär en ny"],
};

function passwordError(res, err, next) {
  const known = PASSWORD_ERRORS[err.message];
  if (known) return res.status(known[0]).json({ error: known[1] });
  next(err);
}

router.post("/change-password", requireAuth, async (req, res, next) => {
  try {
    await auth.changePassword(req.user.id, req.cookies?.[SESSION_COOKIE], req.body ?? {});
    res.status(204).end();
  } catch (err) {
    passwordError(res, err, next);
  }
});

router.post("/forgot-password", async (req, res, next) => {
  try {
    // APP_URL (om satt) går före Host-headern så att länken i mejlet inte
    // kan styras av en förfalskad Host.
    const origin = process.env.APP_URL?.replace(/\/+$/, "") || `${req.protocol}://${req.get("host")}`;
    await auth.requestPasswordReset(req.body?.email, origin);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post("/reset-password", async (req, res, next) => {
  try {
    await auth.resetPassword(req.body?.token, req.body?.password);
    res.status(204).end();
  } catch (err) {
    passwordError(res, err, next);
  }
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
