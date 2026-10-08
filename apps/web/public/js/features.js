// Funktioner som kan slås av/på under Inställningar → Funktioner
// (hyllplats, kreditgräns, betalstatus från Fortnox). Läses från
// /settings/branding så att alla roller kan läsa dem.
import { api } from "./api.js";

let loaded = null;

export function loadFeatures() {
  loaded ??= api
    .get("/settings/branding")
    .then((b) => ({
      shelfLocations: Boolean(b?.shelf_locations_enabled),
      creditLimits: Boolean(b?.credit_limits_enabled),
      paymentStatus: Boolean(b?.fortnox_payment_status_enabled),
    }))
    .catch(() => ({ shelfLocations: false, creditLimits: false, paymentStatus: false }));
  return loaded;
}
