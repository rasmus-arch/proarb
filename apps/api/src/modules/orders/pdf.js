import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { uploadsRoot } from "../../lib/uploads.js";

const FALLBACK_SELLER_NAME = "Mitt företag";
const FALLBACK_BRAND_COLOR = "#0f172a";

// x-positions for the product table — Produkt/Färg-storlek/Tryck/Antal are
// customer-relevant (this doubles as en följesedel att lämna med kunden),
// Plockad/Tryckt/Redo are staff-internal kryssrutor bockade för hand.
const COLS = {
  product: { x: 40, width: 130 },
  variant: { x: 175, width: 65 },
  print: { x: 245, width: 115 },
  qty: { x: 365, width: 30 },
};
const CHECK_COLS = [
  { label: "Plockad", x: 400 },
  { label: "Tryckt", x: 445 },
  { label: "Redo", x: 490 },
];
const CHECKBOX_SIZE = 9;
const TABLE_RIGHT_EDGE = 535;

function drawCheckbox(doc, x, y) {
  doc.rect(x, y, CHECKBOX_SIZE, CHECKBOX_SIZE).strokeColor("#94a3b8").lineWidth(1).stroke();
}

function drawTableHeader(doc, y, brandColor) {
  doc.rect(40, y - 4, TABLE_RIGHT_EDGE - 40, 18).fill("#f8fafc");
  doc.font("Helvetica-Bold").fontSize(8).fillColor(brandColor);
  doc.text("Produkt", COLS.product.x, y, { width: COLS.product.width });
  doc.text("Färg/Storlek", COLS.variant.x, y, { width: COLS.variant.width });
  doc.text("Tryck", COLS.print.x, y, { width: COLS.print.width });
  doc.text("Antal", COLS.qty.x, y, { width: COLS.qty.width, align: "right" });
  for (const col of CHECK_COLS) doc.text(col.label, col.x, y, { width: 40 });
  doc.moveTo(40, y + 14).lineTo(TABLE_RIGHT_EDGE, y + 14).strokeColor("#cbd5e1").stroke();
  doc.font("Helvetica").fillColor("#0f172a");
}

// Ordersedel/följesedel: dubbelt syfte — en plocklista för personalen
// (kryssrutorna Plockad/Tryckt/Redo, bockas för hand, ingen digital
// avläsning) och ett dokument snyggt nog att lämna med kunden vid
// utlämning. Kund, adress och vem som hämtar ut (reference_contact_id)
// står tydligt högst upp; tryckbeskrivning får en egen kolumn istället för
// att gömmas i produktbeskrivningen. QR-koden längst ner öppnar bara
// ordern i systemet (ingen inloggning krävs för själva scanningen, men
// sidan den leder till kräver det) — den ändrar aldrig något själv, se
// qr-public.js.
export async function generateOrderSlipPdf(order, { qrUrl, settings } = {}) {
  const sellerName = settings?.seller_name || FALLBACK_SELLER_NAME;
  const brandColor = settings?.brand_color || FALLBACK_BRAND_COLOR;
  const qrPng = await QRCode.toBuffer(qrUrl, { width: 120, margin: 1 });

  let logoBuffer = null;
  if (settings?.seller_logo_path) {
    try {
      logoBuffer = fs.readFileSync(path.join(uploadsRoot, settings.seller_logo_path));
    } catch {
      // Saknad/oläsbar fil ska aldrig stoppa PDF-genereringen — visa bara
      // säljarnamnet som text istället, som innan loggan fanns.
    }
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Loggan får en egen, rejäl box uppe till vänster (istället för att
    // som förr klämmas in på en enda textrad) — fit bevarar bildens
    // proportioner så en bred eller smal logga aldrig blir skev.
    if (logoBuffer) {
      try {
        doc.image(logoBuffer, 40, 36, { fit: [180, 54], align: "left", valign: "top" });
      } catch {
        doc.font("Helvetica-Bold").fontSize(18).fillColor(brandColor).text(sellerName, 40, 50);
      }
    } else {
      doc.font("Helvetica-Bold").fontSize(18).fillColor(brandColor).text(sellerName, 40, 50);
    }

    doc.font("Helvetica-Bold").fontSize(18).fillColor(brandColor).text("FÖLJESEDEL", 320, 40, {
      width: 215,
      align: "right",
    });
    doc.fontSize(10).fillColor("#0f172a");
    doc.text(`Ordernr: ${order.order_number}`, 320, 64, { width: 215, align: "right" });
    doc.text(`Datum: ${new Date(order.created_at).toLocaleDateString("sv-SE")}`, 320, 78, {
      width: 215,
      align: "right",
    });
    doc.text(order.delivery_method === "SHIPPING" ? "Frakt" : "Avhämtning i butik", 320, 92, {
      width: 215,
      align: "right",
    });

    let y = 110;
    doc.moveTo(40, y).lineTo(TABLE_RIGHT_EDGE, y).strokeColor("#e2e8f0").stroke();
    y += 12;

    doc.font("Helvetica-Bold").fontSize(9).fillColor(brandColor).text("Kund", 40, y);
    doc.font("Helvetica").fontSize(10).fillColor("#0f172a");
    y += 14;
    doc.text(order.customer_name, 40, y);
    y += 13;
    const addressLine = [order.customer_postal_code, order.customer_city].filter(Boolean).join(" ");
    if (order.customer_address || addressLine) {
      doc.text([order.customer_address, addressLine].filter(Boolean).join(", "), 40, y, { width: 300 });
      y += 13;
    }

    let y2 = 124 + 14;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(brandColor).text("Hämtas ut av", 320, y2 - 14);
    doc.font("Helvetica").fontSize(10).fillColor("#0f172a");
    doc.text(order.reference_name || "Ej angivet", 320, y2, { width: 175 });

    y = Math.max(y, y2 + 13) + 16;

    y = drawProductTable(doc, order, y, brandColor);

    y = Math.max(y + 20, 630);
    if (y > 680) {
      doc.addPage();
      y = 40;
    }
    doc.image(qrPng, 40, y, { width: 80 });
    doc.font("Helvetica").fontSize(8).fillColor("#475569");
    doc.text("Scanna för att öppna ordern i systemet.", 130, y + 8, { width: 300 });

    doc.end();
  });
}

function drawProductTable(doc, order, startY, brandColor) {
  let y = startY;
  drawTableHeader(doc, y, brandColor);
  y += 24;

  doc.font("Helvetica").fontSize(9).fillColor("#0f172a");
  for (const line of order.lines) {
    const variantText = [line.color, line.size].filter(Boolean).join(" / ") || "–";
    const printText = line.print_description || "–";
    const rowHeight =
      Math.max(
        doc.heightOfString(line.product_name, { width: COLS.product.width }),
        doc.heightOfString(variantText, { width: COLS.variant.width }),
        doc.heightOfString(printText, { width: COLS.print.width })
      ) + 10;

    doc.text(line.product_name, COLS.product.x, y, { width: COLS.product.width });
    doc.text(variantText, COLS.variant.x, y, { width: COLS.variant.width });
    doc.text(printText, COLS.print.x, y, { width: COLS.print.width });
    doc.text(String(line.quantity), COLS.qty.x, y, { width: COLS.qty.width, align: "right" });
    for (const col of CHECK_COLS) drawCheckbox(doc, col.x, y);

    y += rowHeight;
    if (y > 680) {
      doc.addPage();
      y = 40;
      drawTableHeader(doc, y, brandColor);
      y += 24;
    }
  }
  return y;
}
