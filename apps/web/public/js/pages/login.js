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
