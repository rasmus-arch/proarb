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
};

function applySettings(settings) {
  el.name.value = settings.seller_name ?? "";
  el.org.value = settings.seller_org_number ?? "";
  el.email.value = settings.seller_email ?? "";
  el.phone.value = settings.seller_phone ?? "";
  el.address.value = settings.seller_address ?? "";
  el.postal.value = settings.seller_postal_code ?? "";
  el.city.value = settings.seller_city ?? "";
  el.color.value = settings.brand_color ?? "#0f172a";
  el.footer.value = settings.quote_footer_note ?? "";
  el.reminderEnabled.checked = Boolean(settings.reminder_enabled);
  el.reminderDays.value = settings.reminder_days_after ?? 5;

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
    });
    el.saveSuccess.textContent = "Sparat.";
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

// --- Users (Fas 8) --------------------------------------------------------

const ROLES = ["ADMIN", "SALES", "WAREHOUSE", "POS"];

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
          <button type="button" class="text-sm text-blue-700 underline" data-reset-for="${u.id}">Byt lösenord</button>
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

try {
  await Promise.all([loadSettings(), loadUsers()]);
} catch (err) {
  document.querySelector("main").innerHTML = `<p class="mt-6 text-sm text-red-600">${err.message}</p>`;
}
