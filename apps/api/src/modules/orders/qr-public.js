import { pool } from "../../lib/db.js";

const PROARB_HOME = "https://proarb.se";

// No login required for the scan itself — reached only via the unguessable
// pickup_qr_token printed on the ordersedel PDF (see orders/pdf.js). It
// never changes anything on its own; it just looks up which order the
// token belongs to and hands off to the ordinary staff-authenticated
// order page, where whoever scanned it decides what to do next (adjust
// quantities if something is restnoterat, then pick the right status via
// the existing action buttons). nav.js's auth guard takes over from here —
// an unguessened session lands on login first and returns to this exact
// order afterwards.
export async function handleQrScan(req, res, next) {
  try {
    const [[order]] = await pool.query(`SELECT id FROM orders WHERE pickup_qr_token = ?`, [req.params.token]);
    if (!order) return res.redirect(302, PROARB_HOME);
    res.redirect(302, `/order-editor.html?id=${order.id}`);
  } catch (err) {
    next(err);
  }
}
