import { Router } from "express";
import * as auth from "./service.js";
import { SESSION_COOKIE, requireAuth } from "../../lib/auth-middleware.js";
import {
  checkLoginAllowed,
  passwordFlowAllowed,
  recordLoginFailure,
  recordLoginSuccess,
  weakPasswordMessage,
} from "../../lib/security.js";

const router = Router();

// httpOnly: kan inte läsas av skript. secure: skickas bara över https
// (när appen nås via https). sameSite lax: följer inte med anrop från
// andra sajter (skydd mot CSRF).
function cookieOptions(req) {
  return { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: 30 * 24 * 60 * 60 * 1000 };
}

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
      return res.status(400).json({ error: "E-post och lösenord krävs" });
    }
    const blocked = checkLoginAllowed(req, "staff", email);
    if (blocked) return res.status(429).json({ error: blocked });
    const result = await auth.login(email.trim(), password);
    if (!result) {
      recordLoginFailure("staff", email);
      return res.status(401).json({ error: "Fel e-post eller lösenord" });
    }
    recordLoginSuccess("staff", email);

    res.cookie(SESSION_COOKIE, result.token, cookieOptions(req));
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
  WEAK_PASSWORD: [400, null],
  INVALID_TOKEN: [400, "Länken är ogiltig eller har gått ut — begär en ny"],
};

function passwordError(res, err, next) {
  const known = PASSWORD_ERRORS[err.message];
  if (known) return res.status(known[0]).json({ error: known[1] ?? weakPasswordMessage(err) });
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
    if (!passwordFlowAllowed(req, "staff-forgot")) {
      return res.status(429).json({ error: "För många försök — vänta en stund och försök igen." });
    }
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
    if (!passwordFlowAllowed(req, "staff-reset")) {
      return res.status(429).json({ error: "För många försök — vänta en stund och försök igen." });
    }
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
