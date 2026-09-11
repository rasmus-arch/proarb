import { getUserBySessionToken } from "../modules/auth/service.js";

export const SESSION_COOKIE = "proarb_session";

// Attaches req.user when a valid session cookie is present; otherwise 401.
// Mounted on every /api route except /api/auth/* (see index.js) — those
// public, token-based links (/q/:token, /portal/:token) live outside /api
// entirely and are unaffected.
export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    const user = await getUserBySessionToken(token);
    if (!user) return res.status(401).json({ error: "Inte inloggad" });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

// requireAuth must run first so req.user is set.
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ error: "Du saknar behörighet för detta" });
    }
    next();
  };
}
