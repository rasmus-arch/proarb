import { api } from "../api.js";

const params = new URLSearchParams(location.search);
const redirectTo = params.get("redirect") || "/index.html";

const form = document.getElementById("login-form");
const errorEl = document.getElementById("login-error");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.classList.add("hidden");
  try {
    await api.post("/auth/login", {
      email: document.getElementById("email").value,
      password: document.getElementById("password").value,
    });
    location.href = redirectTo;
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove("hidden");
  }
});

const forgotForm = document.getElementById("forgot-form");
const forgotMessage = document.getElementById("forgot-message");

function showForgot(show) {
  form.classList.toggle("hidden", show);
  forgotForm.classList.toggle("hidden", !show);
  forgotMessage.classList.add("hidden");
  if (show) document.getElementById("forgot-email").value = document.getElementById("email").value;
}

document.getElementById("forgot-link").addEventListener("click", () => showForgot(true));
document.getElementById("back-to-login").addEventListener("click", () => showForgot(false));

forgotForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = forgotForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api.post("/auth/forgot-password", { email: document.getElementById("forgot-email").value });
    forgotMessage.textContent = "Om adressen finns hos oss har en länk skickats. Kolla din inkorg (och skräpposten).";
  } catch (err) {
    forgotMessage.textContent = err.message;
  }
  forgotMessage.classList.remove("hidden");
  button.disabled = false;
});

if (params.get("reset") === "ok") {
  errorEl.textContent = "Lösenordet är bytt. Logga in med ditt nya lösenord.";
  errorEl.className = "mt-3 text-sm text-green-700";
}
