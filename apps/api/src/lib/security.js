import crypto from "node:crypto";

// Gemensamma säkerhetsfunktioner: begränsning av inloggningsförsök,
// säkerhetsrubriker, lösenordsregler och hashning av tokens.

export function sha256(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}

// --- Lösenord ----------------------------------------------------------------

export const MIN_PASSWORD_LENGTH = 8;
// bcrypt läser bara de första 72 byten; längre lösenord ger också onödigt
// arbete per försök.
export const MAX_PASSWORD_LENGTH = 72;

const COMMON_PASSWORDS = new Set([
  "12345678", "123456789", "1234567890", "password", "password1", "passw0rd", "qwertyui", "qwerty123",
  "abcd1234", "11111111", "00000000", "changeme", "lösenord", "losenord", "sommar2024", "sommar2025",
  "sommar2026", "vinter2025", "vinter2026", "welcome1", "admin123", "iloveyou",
]);

// Kastar WEAK_PASSWORD med en läsbar förklaring i err.detail.
export function assertPasswordStrength(password) {
  const fail = (detail) => {
    const err = new Error("WEAK_PASSWORD");
    err.detail = detail;
    throw err;
  };
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    fail(`Lösenordet måste vara minst ${MIN_PASSWORD_LENGTH} tecken.`);
  }
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_LENGTH) fail("Lösenordet är för långt (max 72 tecken).");
  if (COMMON_PASSWORDS.has(password.toLowerCase())) fail("Lösenordet är för vanligt — välj ett annat.");
}

export function weakPasswordMessage(err) {
  return err?.detail ?? `Lösenordet måste vara minst ${MIN_PASSWORD_LENGTH} tecken.`;
}

// --- Begränsning av försök (inloggning, glömt lösenord) ------------------
// I minnet: räcker för en server (cPanel/Passenger kör en process), och
// nollställs vid omstart — vilket är okej för det här syftet.

export function createRateLimiter({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.reset <= now) hits.delete(key);
  }, 60_000).unref();

  return {
    // true = tillåtet (och räknas), false = spärrat.
    hit(key) {
      const now = Date.now();
      const entry = hits.get(key);
      if (!entry || entry.reset <= now) {
        hits.set(key, { count: 1, reset: now + windowMs });
        return true;
      }
      entry.count += 1;
      return entry.count <= max;
    },
    blocked(key) {
      const entry = hits.get(key);
      return Boolean(entry && entry.reset > Date.now() && entry.count >= max);
    },
    reset(key) {
      hits.delete(key);
    },
    retryAfterSeconds(key) {
      const entry = hits.get(key);
      return entry ? Math.max(1, Math.ceil((entry.reset - Date.now()) / 1000)) : 0;
    },
  };
}

// Två lager mot lösenordsgissning:
//  - per IP: max 30 inloggningsförsök per 15 min (oavsett konto).
//  - per konto (e-post): max 8 misslyckade försök per 15 min, sedan spärr
//    — skyddar ett konto även när angriparen byter IP.
const loginByIp = createRateLimiter({ windowMs: 15 * 60_000, max: 30 });
const failuresByAccount = createRateLimiter({ windowMs: 15 * 60_000, max: 8 });

const accountKey = (scope, email) => `${scope}:${String(email ?? "").trim().toLowerCase()}`;

export const LOCKED_MESSAGE = "För många inloggningsförsök. Vänta 15 minuter och försök igen.";

// Anropas före lösenordskontrollen. Returnerar null om försöket får göras.
export function checkLoginAllowed(req, scope, email) {
  if (!loginByIp.hit(`${scope}:${req.ip}`)) return LOCKED_MESSAGE;
  if (failuresByAccount.blocked(accountKey(scope, email))) return LOCKED_MESSAGE;
  return null;
}

export function recordLoginFailure(scope, email) {
  failuresByAccount.hit(accountKey(scope, email));
}

export function recordLoginSuccess(scope, email) {
  failuresByAccount.reset(accountKey(scope, email));
}

// Glömt lösenord / välj lösenord: max 10 per IP och 15 min.
const passwordFlowByIp = createRateLimiter({ windowMs: 15 * 60_000, max: 10 });
export function passwordFlowAllowed(req, scope) {
  return passwordFlowByIp.hit(`${scope}:${req.ip}`);
}

// Sortilog-beställningar och andra publika formulär: max 30 per IP och 15 min.
const publicFormByIp = createRateLimiter({ windowMs: 15 * 60_000, max: 30 });
export function publicFormLimiter(req, res, next) {
  if (publicFormByIp.hit(`public:${req.ip}`)) return next();
  res.status(429).json({ error: "För många förfrågningar — försök igen om en stund." });
}

// --- Säkerhetsrubriker -----------------------------------------------------

export function securityHeaders(req, res, next) {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.set("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  res.set("Cross-Origin-Opener-Policy", "same-origin");
  // Sidorna har inline-skript, så script-src kan inte låsas helt; resten
  // stängs: inga plugins, ingen inbäddning i andra sajter, formulär och
  // base-URL bara mot den egna sajten.
  res.set(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; " +
      "font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
  );
  if (req.secure) res.set("Strict-Transport-Security", "max-age=31536000");
  next();
}

// Uppladdade filer (loggor, produktbilder) visas som bilder men får aldrig
// köras som sidor — en SVG med skript skulle annars kunna köra kod i
// systemets namn. sandbox stänger av skript även om filen öppnas direkt.
export function uploadHeaders(req, res, next) {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
  next();
}
