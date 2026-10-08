// Kameraskanner för mobilen (Orderhantering, inventering). Använder
// webbläsarens inbyggda BarcodeDetector där den finns (Chrome/Android) och
// annars ZXing (iPhone/Safari), som ligger på den egna servern
// (js/vendor) — säkerhetsrubrikerna tillåter bara egna skript.
// Kameran kräver HTTPS (eller localhost).
//
// openCameraScanner({ title, continuous, onResult }) öppnar en helskärmsvy.
// onResult(text) anropas för varje träff; returnerar den ett meddelande
// (sträng) visas det kort i vyn. continuous = false stänger vyn efter
// första träffen, true fortsätter (samma kod ignoreras i 2 s).

const ZXING_SRC = "/js/vendor/zxing-0.21.3.min.js";
const NATIVE_FORMATS = ["code_128", "ean_13", "ean_8", "code_39", "upc_a", "upc_e", "qr_code", "itf"];

let zxingLoading = null;
function loadZxing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  zxingLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = ZXING_SRC;
    script.onload = () => resolve(window.ZXing);
    script.onerror = () => reject(new Error("Kunde inte ladda skannern"));
    document.head.appendChild(script);
  });
  return zxingLoading;
}

async function nativeDetector() {
  if (!("BarcodeDetector" in window)) return null;
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats();
    const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
    return formats.length ? new window.BarcodeDetector({ formats }) : null;
  } catch {
    return null;
  }
}

let audioCtx = null;
function beep(ok = true) {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = ok ? 1200 : 300;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + (ok ? 0.08 : 0.25));
  } catch {
    // inget ljud — inget problem
  }
  if (navigator.vibrate) navigator.vibrate(ok ? 60 : [80, 60, 80]);
}

export function cameraSupported() {
  return Boolean(navigator.mediaDevices?.getUserMedia) && window.isSecureContext;
}

export function openCameraScanner({ title = "Skanna", continuous = false, onResult }) {
  const overlay = document.createElement("div");
  overlay.className = "fixed inset-0 z-50 flex flex-col bg-black text-white";
  overlay.innerHTML = `
    <div class="flex items-center justify-between gap-3 px-4 py-3">
      <div class="text-base font-semibold"></div>
      <button type="button" data-close class="rounded-md bg-white/15 px-4 py-2 text-sm font-medium">Klar</button>
    </div>
    <div class="relative flex-1 overflow-hidden">
      <video playsinline muted class="h-full w-full object-cover"></video>
      <div class="pointer-events-none absolute inset-x-8 top-1/2 h-40 -translate-y-1/2 rounded-xl border-2 border-white/80"></div>
    </div>
    <div data-msg class="min-h-[3.5rem] px-4 py-3 text-center text-base"></div>`;
  overlay.querySelector(".text-base.font-semibold").textContent = title;
  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";

  const video = overlay.querySelector("video");
  const msg = overlay.querySelector("[data-msg]");
  let stream = null;
  let stopped = false;
  let zxingControls = null;
  let lastText = "";
  let lastAt = 0;
  let busy = false;

  function show(text, ok = true) {
    msg.textContent = text;
    msg.className = `min-h-[3.5rem] px-4 py-3 text-center text-base ${ok ? "text-green-300" : "text-red-300"}`;
  }

  function close() {
    stopped = true;
    try {
      zxingControls?.reset?.();
    } catch {
      /* redan stoppad */
    }
    stream?.getTracks().forEach((t) => t.stop());
    overlay.remove();
    document.body.style.overflow = "";
  }
  overlay.querySelector("[data-close]").addEventListener("click", close);

  async function handle(text) {
    const now = Date.now();
    if (busy || !text || (text === lastText && now - lastAt < 2000)) return;
    lastText = text;
    lastAt = now;
    busy = true;
    try {
      const result = await onResult(text);
      beep(true);
      if (!continuous) return close();
      show(typeof result === "string" ? result : `✓ ${text}`);
    } catch (err) {
      beep(false);
      show(err.message || "Något gick fel", false);
    } finally {
      busy = false;
    }
  }

  (async () => {
    if (!cameraSupported()) {
      show("Kameran fungerar bara över https.", false);
      return;
    }
    try {
      const detector = await nativeDetector();
      if (detector) {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        video.srcObject = stream;
        await video.play();
        const tick = async () => {
          if (stopped) return;
          try {
            if (video.readyState >= 2) {
              const codes = await detector.detect(video);
              if (codes[0]) await handle(codes[0].rawValue);
            }
          } catch {
            /* enstaka bildruta som inte gick att läsa */
          }
          setTimeout(tick, 120);
        };
        tick();
        return;
      }
      const ZXing = await loadZxing();
      if (stopped) return;
      const reader = new ZXing.BrowserMultiFormatReader();
      zxingControls = reader;
      await reader.decodeFromConstraints({ video: { facingMode: "environment" }, audio: false }, video, (result) => {
        if (result && !stopped) handle(result.getText());
      });
      stream = video.srcObject;
    } catch (err) {
      show(err.name === "NotAllowedError" ? "Ge webbläsaren tillgång till kameran och försök igen." : `Kameran kunde inte startas: ${err.message}`, false);
    }
  })();

  return { close };
}
