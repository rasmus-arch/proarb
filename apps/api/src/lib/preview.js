import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { uploadsRoot } from "./uploads.js";

// Förhandsbild (PNG) av EPS- och PDF-filer, som webbläsare och pdfkit
// inte kan visa. Renderas i en arbetstråd, en fil i taget (varje rendering
// tar ~100 MB minne), med tidsgräns.
const PREVIEWABLE = new Set([".eps", ".pdf"]);
const TIMEOUT_MS = 30_000;
const TARGET_PX = 1200;

export function isPreviewable(filePath) {
  return PREVIEWABLE.has(path.extname(filePath).toLowerCase());
}

export function previewPathFor(relPath) {
  return `${relPath}.preview.png`;
}

let worker = null;
let seq = 0;
const pending = new Map();

function failAll(message) {
  for (const { reject, timer } of pending.values()) {
    clearTimeout(timer);
    reject(new Error(message));
  }
  pending.clear();
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./preview-worker.js", import.meta.url));
  worker.on("message", ({ id, png, error }) => {
    const job = pending.get(id);
    if (!job) return;
    pending.delete(id);
    clearTimeout(job.timer);
    if (error) job.reject(new Error(error));
    else job.resolve(Buffer.from(png));
  });
  worker.on("error", (err) => failAll(err.message));
  worker.on("exit", () => {
    worker = null;
    failAll("Förhandsvisningen avbröts");
  });
  // Efter lyssnarna — att lägga till en "message"-lyssnare ref:ar porten
  // igen, och då skulle en vilande arbetstråd hålla processen vid liv
  // (t.ex. scripts/backup.js eller tester som annars avslutas).
  worker.unref();
  return worker;
}

function runInWorker(input, args) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Förhandsvisningen tog för lång tid"));
      worker?.terminate();
    }, TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    getWorker().postMessage({ id, input, args });
  });
}

// Upplösning så att bilden blir ca TARGET_PX på längsta sidan, oavsett
// hur stor EPS:ens BoundingBox är (en logga kan vara 50 pt eller 2000 pt).
function epsDpi(buffer) {
  const head = buffer.subarray(0, 65536).toString("latin1");
  const match =
    head.match(/%%HiResBoundingBox:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/) ??
    head.match(/%%BoundingBox:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/);
  if (!match) return 150;
  const [x1, y1, x2, y2] = match.slice(1).map(Number);
  const largest = Math.max(x2 - x1, y2 - y1);
  if (!(largest > 0)) return 150;
  return Math.round(Math.min(600, Math.max(36, (72 * TARGET_PX) / largest)));
}

let queue = Promise.resolve();

// Returnerar PNG-bufferten. Kastar fel om filen inte går att tolka.
export function renderPreview(buffer, ext) {
  const common = ["-dSAFER", "-dBATCH", "-dNOPAUSE", "-dQUIET", "-sDEVICE=pngalpha", "-dTextAlphaBits=4", "-dGraphicsAlphaBits=4"];
  const args =
    ext === ".pdf"
      ? [...common, "-r110", "-dFirstPage=1", "-dLastPage=1", "-dUseCropBox"]
      : [...common, "-dEPSCrop", `-r${epsDpi(buffer)}`];
  const job = queue.then(() => runInWorker(buffer, args));
  queue = job.catch(() => {});
  return job;
}

// Skapar förhandsbilden bredvid originalet i uploads/ och returnerar dess
// relativa sökväg (eller null om filtypen inte behöver någon).
export async function createPreviewFile(relPath) {
  if (!isPreviewable(relPath)) return null;
  const source = path.join(uploadsRoot, relPath);
  const png = await renderPreview(fs.readFileSync(source), path.extname(relPath).toLowerCase());
  const target = previewPathFor(relPath);
  fs.writeFileSync(path.join(uploadsRoot, target), png);
  return target;
}

// Som createPreviewFile, men återanvänder en redan skapad förhandsbild —
// för filer som laddades upp innan förhandsvisningen fanns.
// Pågående renderingar per fil, så att uppladdningens bakgrundsrendering och
// listans första miniatyranrop inte renderar samma fil två gånger.
const inFlight = new Map();

export async function ensurePreviewFile(relPath) {
  if (!isPreviewable(relPath)) return null;
  const target = previewPathFor(relPath);
  if (fs.existsSync(path.join(uploadsRoot, target))) return target;
  if (!inFlight.has(relPath)) {
    inFlight.set(relPath, createPreviewFile(relPath).finally(() => inFlight.delete(relPath)));
  }
  return inFlight.get(relPath);
}

export function removePreviewFile(relPath) {
  if (!isPreviewable(relPath)) return;
  fs.unlink(path.join(uploadsRoot, previewPathFor(relPath)), () => {});
}
