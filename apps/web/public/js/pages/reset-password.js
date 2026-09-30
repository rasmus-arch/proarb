import { api } from "../api.js";

const token = new URLSearchParams(location.search).get("token") ?? "";
const form = document.getElementById("reset-form");
const errorEl = document.getElementById("reset-error");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.classList.add("hidden");
  const password = document.getElementById("new-password").value;
  if (password !== document.getElementById("repeat-password").value) {
    errorEl.textContent = "Lösenorden matchar inte.";
    errorEl.classList.remove("hidden");
    return;
  }
  try {
    await api.post("/auth/reset-password", { token, password });
    location.href = "/login.html?reset=ok";
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove("hidden");
  }
});
