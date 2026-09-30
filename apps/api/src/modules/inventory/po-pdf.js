import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { uploadsRoot } from "../../lib/uploads.js";

const INK = "#1c1b19";
const MUTED = "#5c5851";
const LINE = "#e4e1da";
const RIGHT = 555;

// Kolumner: leverantörens artikelnr först (det de plockar på), sedan vår
// benämning, variant, antal och inpris.
const COLS = {
  article: { x: 40, width: 95 },
  product: { x: 140, width: 175 },
  variant: { x: 320, width: 80 },
  qty: { x: 405, width: 40 },
  price: { x: 450, width: 50 },
  total: { x: 505, width: 50 },
};

function money(n) {
  return Number(n).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function header(doc, y, brandColor) {
  doc.rect(40, y - 4, RIGHT - 40, 18).fill("#f7f6f3");
  doc.font("Helvetica-Bold").fontSize(8).fillColor(brandColor);
  doc.text("Lev. artikelnr", COLS.article.x + 2, y, { width: COLS.article.width });
  doc.text("Benämning", COLS.product.x, y, { width: COLS.product.width });
  doc.text("Färg/Storlek", COLS.variant.x, y, { width: COLS.variant.width });
  doc.text("Antal", COLS.qty.x, y, { width: COLS.qty.width, align: "right" });
  doc.text("À-pris", COLS.price.x, y, { width: COLS.price.width, align: "right" });
  doc.text("Summa", COLS.total.x, y, { width: COLS.total.width, align: "right" });
  doc.font("Helvetica").fillColor(INK);
}

export async function generatePurchaseOrderPdf(po, { settings } = {}) {
  const sellerName = settings?.seller_name || "Mitt företag";
  const brandColor = settings?.brand_color || INK;

  let logoBuffer = null;
  if (settings?.seller_logo_path) {
    try {
      logoBuffer = fs.readFileSync(path.join(uploadsRoot, settings.seller_logo_path));
    } catch {
      // Saknad logga stoppar aldrig PDF:en — namnet visas som text istället.
    }
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    let drewLogo = false;
    if (logoBuffer) {
      try {
        doc.image(logoBuffer, 40, 36, { fit: [180, 54], align: "left", valign: "top" });
        drewLogo = true;
      } catch {
        // fall through to text
      }
    }
    if (!drewLogo) doc.font("Helvetica-Bold").fontSize(18).fillColor(brandColor).text(sellerName, 40, 50);

    const address = [settings?.seller_address, [settings?.seller_postal_code, settings?.seller_city].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", ");
    const contact = [settings?.seller_phone, settings?.seller_email].filter(Boolean).join(" · ");
    doc.font("Helvetica").fontSize(8).fillColor(MUTED);
    let cy = drewLogo ? 94 : 76;
    for (const line of [settings?.seller_org_number ? `Org.nr ${settings.seller_org_number}` : null, address, contact].filter(Boolean)) {
      doc.text(line, 40, cy, { width: 260 });
      cy += 11;
    }

    doc.font("Helvetica-Bold").fontSize(18).fillColor(brandColor).text("INKÖPSORDER", 320, 40, { width: RIGHT - 320, align: "right" });
    doc.font("Helvetica").fontSize(10).fillColor(INK);
    const meta = [
      `Nr: ${po.po_number}`,
      `Datum: ${new Date(po.created_at).toLocaleDateString("sv-SE")}`,
      po.supplier_customer_number ? `Vårt kundnr: ${po.supplier_customer_number}` : null,
      po.expected_date ? `Önskad leverans: ${new Date(po.expected_date).toLocaleDateString("sv-SE")}` : null,
    ].filter(Boolean);
    meta.forEach((line, i) => doc.text(line, 320, 64 + i * 14, { width: RIGHT - 320, align: "right" }));

    let y = Math.max(cy, 64 + meta.length * 14) + 18;
    doc.moveTo(40, y).lineTo(RIGHT, y).strokeColor(LINE).stroke();
    y += 12;

    doc.font("Helvetica-Bold").fontSize(9).fillColor(brandColor).text("Leverantör", 40, y);
    doc.text("Leveransadress", 320, y);
    doc.font("Helvetica").fontSize(10).fillColor(INK);
    const supplierLines = [po.supplier_name, po.supplier_contact_name ? `Att: ${po.supplier_contact_name}` : null, po.supplier_email, po.supplier_phone].filter(Boolean);
    supplierLines.forEach((line, i) => doc.text(line, 40, y + 14 + i * 13, { width: 260 }));
    const deliveryLines = [sellerName, settings?.seller_address, [settings?.seller_postal_code, settings?.seller_city].filter(Boolean).join(" ")].filter(Boolean);
    deliveryLines.forEach((line, i) => doc.text(line, 320, y + 14 + i * 13, { width: RIGHT - 320 }));
    y += 14 + Math.max(supplierLines.length, deliveryLines.length) * 13 + 20;

    header(doc, y, brandColor);
    y += 22;

    let total = 0;
    doc.fontSize(9);
    for (const line of po.lines) {
      const qty = Number(line.quantity);
      const price = Number(line.cost_price);
      const sum = qty * price;
      total += sum;
      const article = line.supplier_sku || line.sku || line.article_number || "";
      const variant = [line.color, line.size].filter(Boolean).join(" / ");
      const rowHeight = Math.max(
        doc.heightOfString(line.product_name, { width: COLS.product.width }),
        doc.heightOfString(article, { width: COLS.article.width - 2 }),
        12
      );
      if (y + rowHeight > 760) {
        doc.addPage();
        y = 50;
        header(doc, y, brandColor);
        y += 22;
        doc.fontSize(9);
      }
      doc.fillColor(INK).text(article, COLS.article.x + 2, y, { width: COLS.article.width - 2 });
      doc.text(line.product_name, COLS.product.x, y, { width: COLS.product.width });
      doc.fillColor(MUTED).text(variant || "–", COLS.variant.x, y, { width: COLS.variant.width });
      doc.fillColor(INK).text(String(qty), COLS.qty.x, y, { width: COLS.qty.width, align: "right" });
      doc.text(price ? money(price) : "–", COLS.price.x, y, { width: COLS.price.width, align: "right" });
      doc.text(price ? money(sum) : "–", COLS.total.x, y, { width: COLS.total.width, align: "right" });
      y += rowHeight + 6;
      doc.moveTo(40, y - 3).lineTo(RIGHT, y - 3).strokeColor(LINE).lineWidth(0.5).stroke();
    }

    y += 6;
    doc.font("Helvetica-Bold").fontSize(10).fillColor(INK);
    doc.text("Totalt ex moms", 380, y, { width: 110 });
    doc.text(`${money(total)} kr`, 460, y, { width: RIGHT - 460, align: "right" });

    if (settings?.purchase_order_email_note) {
      y += 34;
      doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(settings.purchase_order_email_note, 40, y, { width: RIGHT - 40 });
    }

    doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(
      `Vänligen ange ${po.po_number} på följesedel och faktura.`,
      40,
      780,
      { width: RIGHT - 40, align: "center" }
    );
    doc.end();
  });
}
