import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const uploadsRoot = path.join(__dirname, "..", "..", "uploads");

// Logo / print-artwork files: name-your-variant uploads for a customer's
// print underlag, or the seller's own logo in Inställningar. Restricted
// per the user's spec to eps/jpg/png/svg/pdf.
const ALLOWED_EXTENSIONS = new Set([".eps", ".jpg", ".jpeg", ".png", ".svg", ".pdf"]);
const MIME_BY_EXTENSION = {
  ".eps": "application/postscript",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
};

export function createLogoUpload(subdir) {
  const destination = path.join(uploadsRoot, subdir);
  fs.mkdirSync(destination, { recursive: true });

  const storage = multer.diskStorage({
    destination,
    filename(req, file, cb) {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${crypto.randomBytes(16).toString("hex")}${ext}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter(req, file, cb) {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        cb(new Error(`Filtypen ${ext || "okänd"} stöds inte. Tillåtna format: eps, jpg, png, svg, pdf.`));
        return;
      }
      cb(null, true);
    },
  });
}

export function mimeTypeForExtension(ext) {
  return MIME_BY_EXTENSION[ext.toLowerCase()] ?? "application/octet-stream";
}
