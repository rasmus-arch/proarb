import { api } from "../api.js";

const el = {
  name: document.getElementById("s-name"),
  org: document.getElementById("s-org"),
  email: document.getElementById("s-email"),
  phone: document.getElementById("s-phone"),
  address: document.getElementById("s-address"),
  postal: document.getElementById("s-postal"),
  city: document.getElementById("s-city"),
  color: document.getElementById("s-color"),
  footer: document.getElementById("s-footer"),
  reminderEnabled: document.getElementById("s-reminder-enabled"),
  reminderDays: document.getElementById("s-reminder-days"),
  portalShowStock: document.getElementById("s-portal-show-stock"),
  portalRequireLogin: document.getElementById("s-portal-require-login"),
  inactiveMonths: document.getElementById("s-inactive-months"),
  autoPrint: document.getElementById("s-auto-print"),
  nextQuoteNumber: document.getElementById("s-next-quote-number"),
  nextOrderNumber: document.getElementById("s-next-order-number"),
  smtpHost: document.getElementById("s-smtp-host"),
  smtpPort: document.getElementById("s-smtp-port"),
  smtpUsername: document.getElementById("s-smtp-username"),
  smtpPassword: document.getElementById("s-smtp-password"),
  smtpFrom: document.getElementById("s-smtp-from"),
  smtpTls: document.getElementById("s-smtp-tls"),
  fortnoxClientId: document.getElementById("s-fortnox-client-id"),
  fortnoxClientSecret: document.getElementById("s-fortnox-client-secret"),
  fortnoxCashPaymentWay: document.getElementById("s-fortnox-cash-payment-way"),
  fortnoxRedirectUri: document.getElementById("fortnox-redirect-uri"),
  fortnoxStatus: document.getElementById("fortnox-status"),
  fortnoxConnectBtn: document.getElementById("fortnox-connect-btn"),
  fortnoxDisconnectBtn: document.getElementById("fortnox-disconnect-btn"),
  fortnoxMessage: document.getElementById("fortnox-message"),
  githubRepo: document.getElementById("s-github-repo"),
  githubToken: document.getElementById("s-github-token"),
  logoPreview: document.getElementById("s-logo-preview"),
  logoForm: document.getElementById("logo-form"),
  logoFile: document.getElementById("s-logo-file"),
  logoError: document.getElementById("logo-error"),
  saveBtn: document.getElementById("save-btn"),
  saveError: document.getElementById("save-error"),
  saveSuccess: document.getElementById("save-success"),
  userRows: document.getElementById("user-rows"),
  newUserForm: document.getElementById("new-user-form"),
  nuName: document.getElementById("nu-name"),
  nuEmail: document.getElementById("nu-email"),
  nuPassword: document.getElementById("nu-password"),
  nuRole: document.getElementById("nu-role"),
  userError: document.getElementById("user-error"),
  quoteValidDays: document.getElementById("s-quote-valid-days"),
  quoteWarningDays: document.getElementById("s-quote-warning-days"),
  marginWarning: document.getElementById("s-margin-warning"),
  marginCritical: document.getElementById("s-margin-critical"),
  quotePrefix: document.getElementById("s-quote-prefix"),
  orderPrefix: document.getElementById("s-order-prefix"),
  defaultTerms: document.getElementById("s-default-terms"),
  defaultVat: document.getElementById("s-default-vat"),
  pickupReminderDays: document.getElementById("s-pickup-reminder-days"),
  orderReadyNote: document.getElementById("s-order-ready-note"),
  poNote: document.getElementById("s-po-note"),
  backupKeepDays: document.getElementById("s-backup-keep-days"),
  saveBar: document.getElementById("save-bar"),
  notifyReceived: document.getElementById("s-notify-received"),
  notifyConfirmed: document.getElementById("s-notify-confirmed"),
  notifyDelivered: document.getElementById("s-notify-delivered"),
  fortnoxPaymentStatus: document.getElementById("s-fortnox-payment-status"),
  creditLimits: document.getElementById("s-credit-limits"),
  shelfLocations: document.getElementById("s-shelf-locations"),
  obsoleteMonths: document.getElementById("s-obsolete-months"),
};

// --- Flikar -----------------------------------------------------------------

const tabButtons = [...document.querySelectorAll("[data-settings-tab]")];
const panels = [...document.querySelectorAll("[data-settings-panel]")];

function activateTab(key) {
  if (!panels.some((p) => p.dataset.settingsPanel === key)) key = "foretag";
  tabButtons.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.settingsTab === key)));
  panels.forEach((p) => p.classList.toggle("hidden", p.dataset.settingsPanel !== key));
  // Användare sparas direkt per rad — ingen gemensam Spara-knapp där.
  el.saveBar.classList.toggle("hidden", key === "anvandare");
  if (key === "sakerhetskopior") loadBackups();
  history.replaceState(null, "", `${location.pathname}${location.search}#${key}`);
}

tabButtons.forEach((b) => b.addEventListener("click", () => activateTab(b.dataset.settingsTab)));

function applySettings(settings) {
  el.name.value = settings.seller_name ?? "";
  el.org.value = settings.seller_org_number ?? "";
  el.email.value = settings.seller_email ?? "";
  el.phone.value = settings.seller_phone ?? "";
  el.address.value = settings.seller_address ?? "";
  el.postal.value = settings.seller_postal_code ?? "";
  el.city.value = settings.seller_city ?? "";
  el.color.value = settings.brand_color ?? "#1c1b19";
  el.footer.value = settings.quote_footer_note ?? "";
  el.reminderEnabled.checked = Boolean(settings.reminder_enabled);
  el.reminderDays.value = settings.reminder_days_after ?? 5;
  el.portalShowStock.checked = Boolean(settings.portal_show_stock);
  el.portalRequireLogin.checked = Boolean(settings.portal_require_login);
  el.inactiveMonths.value = settings.inactive_customer_months ?? 6;
  el.autoPrint.checked = Boolean(settings.auto_print_order_slip);
  el.nextQuoteNumber.value = settings.next_quote_number ?? 1;
  el.nextOrderNumber.value = settings.next_order_number ?? 1;
  el.smtpHost.value = settings.smtp_host ?? "";
  el.smtpPort.value = settings.smtp_port ?? "";
  el.smtpUsername.value = settings.smtp_username ?? "";
  setSecretField(el.smtpPassword, settings.smtp_password_set);
  el.smtpFrom.value = settings.smtp_from_email ?? "";
  el.smtpTls.checked = settings.smtp_use_tls === undefined ? true : Boolean(settings.smtp_use_tls);
  el.fortnoxClientId.value = settings.fortnox_client_id ?? "";
  setSecretField(el.fortnoxClientSecret, settings.fortnox_client_secret_set);
  el.fortnoxCashPaymentWay.value = settings.fortnox_cash_payment_way ?? "";
  applyFortnoxStatus(settings);
  el.githubRepo.value = settings.github_issues_repo ?? "";
  setSecretField(el.githubToken, settings.github_issues_token_set);
  el.quoteValidDays.value = settings.quote_valid_days ?? 10;
  el.quoteWarningDays.value = settings.quote_expiry_warning_days ?? 3;
  el.marginWarning.value = settings.margin_warning_percent ?? 25;
  el.marginCritical.value = settings.margin_critical_percent ?? 10;
  el.quotePrefix.value = settings.quote_number_prefix ?? "OFF";
  el.orderPrefix.value = settings.order_number_prefix ?? "ORD";
  el.defaultTerms.value = settings.default_payment_terms_days ?? 30;
  el.defaultVat.value = settings.default_tax_rate_percent ?? 25;
  el.pickupReminderDays.value = settings.pickup_reminder_days ?? 7;
  el.orderReadyNote.value = settings.order_ready_email_note ?? "";
  el.poNote.value = settings.purchase_order_email_note ?? "";
  el.backupKeepDays.value = settings.backup_keep_days ?? 14;
  el.notifyReceived.checked = Boolean(settings.notify_request_received);
  el.notifyConfirmed.checked = Boolean(settings.notify_order_confirmed);
  el.notifyDelivered.checked = Boolean(settings.notify_order_delivered);
  el.fortnoxPaymentStatus.checked = Boolean(settings.fortnox_payment_status_enabled);
  el.creditLimits.checked = Boolean(settings.credit_limits_enabled);
  el.shelfLocations.checked = Boolean(settings.shelf_locations_enabled);
  el.obsoleteMonths.value = settings.obsolete_stock_months ?? 12;

  if (settings.seller_logo_path) {
    el.logoPreview.src = `/uploads/${settings.seller_logo_path}`;
    el.logoPreview.classList.remove("hidden");
  } else {
    el.logoPreview.classList.add("hidden");
  }
}

async function loadSettings() {
  applySettings(await api.get("/settings"));
}

el.saveBtn.addEventListener("click", async () => {
  el.saveError.classList.add("hidden");
  el.saveSuccess.classList.add("hidden");
  try {
    await api.patch("/settings", {
      sellerName: el.name.value,
      sellerOrgNumber: el.org.value || null,
      sellerEmail: el.email.value || null,
      sellerPhone: el.phone.value || null,
      sellerAddress: el.address.value || null,
      sellerPostalCode: el.postal.value || null,
      sellerCity: el.city.value || null,
      brandColor: el.color.value,
      quoteFooterNote: el.footer.value || null,
      reminderEnabled: el.reminderEnabled.checked,
      reminderDaysAfter: Number(el.reminderDays.value) || 5,
      portalShowStock: el.portalShowStock.checked,
      portalRequireLogin: el.portalRequireLogin.checked,
      inactiveCustomerMonths: Number(el.inactiveMonths.value) || 6,
      autoPrintOrderSlip: el.autoPrint.checked,
      nextQuoteNumber: Number(el.nextQuoteNumber.value) || 1,
      nextOrderNumber: Number(el.nextOrderNumber.value) || 1,
      smtpHost: el.smtpHost.value || null,
      smtpPort: el.smtpPort.value ? Number(el.smtpPort.value) : null,
      smtpUsername: el.smtpUsername.value || null,
      smtpPassword: el.smtpPassword.value || null,
      smtpFromEmail: el.smtpFrom.value || null,
      smtpUseTls: el.smtpTls.checked,
      fortnoxClientId: el.fortnoxClientId.value || null,
      fortnoxClientSecret: el.fortnoxClientSecret.value || null,
      fortnoxCashPaymentWay: el.fortnoxCashPaymentWay.value,
      githubIssuesRepo: el.githubRepo.value || null,
      githubIssuesToken: el.githubToken.value || null,
      quoteValidDays: Number(el.quoteValidDays.value) || 10,
      quoteExpiryWarningDays: Number(el.quoteWarningDays.value) || 0,
      marginWarningPercent: Number(el.marginWarning.value) || 0,
      marginCriticalPercent: Number(el.marginCritical.value) || 0,
      quoteNumberPrefix: el.quotePrefix.value,
      orderNumberPrefix: el.orderPrefix.value,
      defaultPaymentTermsDays: Number(el.defaultTerms.value) || 0,
      defaultTaxRatePercent: el.defaultVat.value === "" ? 25 : Number(el.defaultVat.value),
      pickupReminderDays: Number(el.pickupReminderDays.value) || 7,
      orderReadyEmailNote: el.orderReadyNote.value || null,
      purchaseOrderEmailNote: el.poNote.value || null,
      backupKeepDays: Number(el.backupKeepDays.value) || 14,
      notifyRequestReceived: el.notifyReceived.checked,
      notifyOrderConfirmed: el.notifyConfirmed.checked,
      notifyOrderDelivered: el.notifyDelivered.checked,
      fortnoxPaymentStatusEnabled: el.fortnoxPaymentStatus.checked,
      creditLimitsEnabled: el.creditLimits.checked,
      shelfLocationsEnabled: el.shelfLocations.checked,
      obsoleteStockMonths: Number(el.obsoleteMonths.value) || 12,
    });
    el.saveSuccess.textContent = "Sparat.";
    setTimeout(() => el.saveSuccess.classList.add("hidden"), 2500);
    el.saveSuccess.classList.remove("hidden");
  } catch (err) {
    el.saveError.textContent = err.message;
    el.saveError.classList.remove("hidden");
  }
});

el.logoForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  el.logoError.classList.add("hidden");

  const file = el.logoFile.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append("file", file);

  try {
    const res = await fetch("/api/settings/logo", { method: "POST", body: formData });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Uppladdning misslyckades");
    applySettings(body);
    el.logoForm.reset();
  } catch (err) {
    el.logoError.textContent = err.message;
    el.logoError.classList.remove("hidden");
  }
});

// Hemliga fält (lösenord/nycklar) visas aldrig — servern skickar bara om de
// är ifyllda. Tomt fält vid Spara = behåll det sparade värdet.
function setSecretField(input, isSet) {
  input.value = "";
  input.placeholder = isSet ? "Sparat — lämna tomt för att behålla" : "";
}

// --- Fortnox ---------------------------------------------------------------

el.fortnoxRedirectUri.textContent = `${location.origin}/api/settings/fortnox/callback`;

function applyFortnoxStatus(settings) {
  const connected = Boolean(settings.fortnox_connected);
  el.fortnoxStatus.textContent = connected ? "Ansluten" : "Inte ansluten";
  el.fortnoxStatus.className = `text-sm font-medium ${connected ? "text-green-700" : "text-slate-500"}`;
  el.fortnoxConnectBtn.textContent = connected ? "Anslut igen" : "Anslut till Fortnox";
  el.fortnoxDisconnectBtn.classList.toggle("hidden", !connected);
  document.getElementById("fortnox-customers-box").classList.toggle("hidden", !connected);
}

el.fortnoxDisconnectBtn.addEventListener("click", async () => {
  if (!confirm("Koppla från Fortnox? Nya fakturor skapas då inte förrän ni ansluter igen.")) return;
  const settings = await api.post("/settings/fortnox/disconnect", {});
  applyFortnoxStatus(settings);
});

// Fortnox skickar tillbaka hit efter anslutningsförsöket (se
// settings/routes.js /fortnox/callback) via ?fortnox=connected|error.
{
  const params = new URLSearchParams(location.search);
  const fortnoxResult = params.get("fortnox");
  if (fortnoxResult === "connected") {
    el.fortnoxMessage.textContent = "Ansluten till Fortnox.";
    el.fortnoxMessage.className = "mt-2 text-sm text-green-700";
    el.fortnoxMessage.classList.remove("hidden");
  } else if (fortnoxResult === "error") {
    el.fortnoxMessage.textContent = params.get("message") || "Kunde inte ansluta till Fortnox.";
    el.fortnoxMessage.className = "mt-2 text-sm text-red-600";
    el.fortnoxMessage.classList.remove("hidden");
  }
  if (fortnoxResult) {
    params.delete("fortnox");
    params.delete("message");
    const query = params.toString();
    history.replaceState(null, "", location.pathname + (query ? `?${query}` : ""));
  }
}

// --- Users (Fas 8) --------------------------------------------------------

const ROLES = ["ADMIN", "SALES", "WAREHOUSE"];

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function renderUsers(users) {
  el.userRows.innerHTML = users
    .map(
      (u) => `
      <tr>
        <td class="py-2 pr-3 font-medium text-slate-900">${escapeHtml(u.name)}</td>
        <td class="py-2 pr-3 text-slate-500">${escapeHtml(u.email)}</td>
        <td class="py-2 pr-3">
          <select class="input" data-role-for="${u.id}">
            ${ROLES.map((r) => `<option value="${r}" ${r === u.role ? "selected" : ""}>${r}</option>`).join("")}
          </select>
        </td>
        <td class="py-2 pr-3">
          <input type="checkbox" class="rounded border-slate-300" data-active-for="${u.id}" ${u.active ? "checked" : ""} />
        </td>
        <td class="py-2 pr-2">
          <button type="button" class="link text-sm" data-reset-for="${u.id}">Byt lösenord</button>
        </td>
      </tr>`
    )
    .join("");
}

async function loadUsers() {
  const { rows } = await api.get("/users");
  renderUsers(rows);
}

el.userRows.addEventListener("change", async (event) => {
  const roleId = event.target.dataset.roleFor;
  const activeId = event.target.dataset.activeFor;
  if (roleId !== undefined) {
    await api.patch(`/users/${roleId}`, { role: event.target.value });
  } else if (activeId !== undefined) {
    await api.patch(`/users/${activeId}`, { active: event.target.checked });
  }
});

el.userRows.addEventListener("click", async (event) => {
  const id = event.target.dataset.resetFor;
  if (id === undefined) return;
  const password = prompt("Nytt lösenord:");
  if (!password) return;
  await api.patch(`/users/${id}`, { password });
});

el.newUserForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  el.userError.classList.add("hidden");
  try {
    await api.post("/users", {
      name: el.nuName.value,
      email: el.nuEmail.value,
      password: el.nuPassword.value,
      role: el.nuRole.value,
    });
    el.newUserForm.reset();
    loadUsers();
  } catch (err) {
    el.userError.textContent = err.message;
    el.userError.classList.remove("hidden");
  }
});

// --- Säkerhetskopior ----------------------------------------------------------

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function loadBackups() {
  const list = document.getElementById("backup-list");
  const status = document.getElementById("backup-status");
  try {
    const { rows, directory } = await api.get("/backups");
    status.textContent = rows.length
      ? `Senaste: ${new Date(rows[0].created_at).toLocaleString("sv-SE")}`
      : "Inga säkerhetskopior ännu.";
    list.innerHTML = rows
      .map(
        (b) => `
        <li class="flex items-center justify-between py-2">
          <span>${new Date(b.created_at).toLocaleString("sv-SE")} <span class="ml-2 text-slate-500">${formatBytes(b.size)}</span></span>
          <a class="link text-sm" href="/api/backups/${encodeURIComponent(b.name)}" download>Ladda ner</a>
        </li>`
      )
      .join("");
    list.title = directory ?? "";
  } catch (err) {
    status.textContent = err.message;
  }
}

document.getElementById("backup-now-btn").addEventListener("click", async (event) => {
  const status = document.getElementById("backup-status");
  event.target.disabled = true;
  status.textContent = "Skapar säkerhetskopia…";
  try {
    await api.post("/backups", {});
    await loadBackups();
  } catch (err) {
    status.textContent = err.message;
  } finally {
    event.target.disabled = false;
  }
});

activateTab(location.hash.slice(1) || "foretag");

try {
  await Promise.all([loadSettings(), loadUsers()]);
} catch (err) {
  const message = document.createElement("p");
  message.className = "mt-6 text-sm text-red-600";
  message.textContent = err.message;
  document.querySelector("main").replaceChildren(message);
}

// --- Hämta kunder från Fortnox ----------------------------------------------

document.getElementById("fortnox-import-customers-btn").addEventListener("click", async (event) => {
  const btn = event.currentTarget;
  const result = document.getElementById("fortnox-import-result");
  btn.disabled = true;
  btn.textContent = "Hämtar…";
  result.className = "mt-2 text-sm text-slate-600";
  result.textContent = "Det kan ta en stund om det är många kunder.";
  try {
    const r = await api.post("/customers/import-fortnox", {});
    result.className = "mt-2 text-sm text-green-700";
    result.textContent =
      `Klart: ${r.total} kunder i Fortnox — ${r.created} nya, ${r.linked} kopplade till befintliga, ` +
      `${r.updated} uppdaterade${r.skipped ? `, ${r.skipped} inaktiva hoppades över` : ""}.`;
  } catch (err) {
    result.className = "mt-2 text-sm text-red-600";
    result.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Hämta kunder från Fortnox";
  }
});
