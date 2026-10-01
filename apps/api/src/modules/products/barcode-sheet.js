import PDFDocument from "pdfkit";
import bwipjs from "bwip-js";
import { pool } from "../../lib/db.js";
import { getSettings } from "../settings/service.js";

// Streckkodsark för kassadisken: en A4 med etiketter (namn, variant, pris
// och en Code 128-streckkod) för de vanligaste produkterna, så att de kan
// skannas utan att ha varan i handen. Koden är variantens streckkod, eller
// SKU när streckkod saknas — båda hittas av skanningen i order-editorn och
// sökfältet (products/service.js findVariantByBarcode, search/routes.js).

const COLUMNS = 3;
const ROWS = 8;
const MARGIN_X = 28;
const MARGIN_Y = 30;
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const CELL_W = (PAGE_WIDTH - MARGIN_X * 2) / COLUMNS;
const CELL_H = (PAGE_HEIGHT - MARGIN_Y * 2) / ROWS;

function money(n) {
  return `${Number(n).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
}

const VARIANT_SELECT = `
  SELECT v.id AS variant_id, v.sku, v.barcode, v.color, v.size, v.price_override,
         p.name, p.article_number, p.base_price, p.tax_rate_percent`;

// Förslag: mest sålda varianterna (antal) senaste `days` dagarna.
export async function suggestVariants({ days = 90, limit = 30 } = {}) {
  const [rows] = await pool.query(
    `${VARIANT_SELECT}, SUM(ol.quantity) AS sold_qty
     FROM order_lines ol
     JOIN orders o ON o.id = ol.order_id
     JOIN product_variants v ON v.id = ol.product_variant_id
     JOIN products p ON p.id = v.product_id
     WHERE o.status <> 'CANCELLED' AND o.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       AND v.active = 1 AND p.active = 1
     GROUP BY v.id
     ORDER BY sold_qty DESC
     LIMIT ?`,
    [days, limit]
  );
  return rows.map((r) => ({ ...r, sold_qty: Number(r.sold_qty) }));
}

export async function generateBarcodeSheetPdf(variantIds) {
  const ids = [...new Set(variantIds.map(Number).filter((id) => id > 0))];
  if (ids.length === 0) throw new Error("NO_VARIANTS");

  const [found] = await pool.query(
    `${VARIANT_SELECT}
     FROM product_variants v JOIN products p ON p.id = v.product_id
     WHERE v.id IN (?)`,
    [ids]
  );
  // Behåll ordningen som valdes i dialogen.
  const byId = new Map(found.map((r) => [r.variant_id, r]));
  const variants = ids.map((id) => byId.get(id)).filter(Boolean);

  const barcodes = await Promise.all(
    variants.map((v) =>
      bwipjs.toBuffer({
        bcid: "code128",
        text: v.barcode || v.sku,
        scale: 2,
        height: 9,
        includetext: true,
        textxalign: "center",
        textsize: 8,
      })
    )
  );
  const settings = await getSettings();

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: "Streckkodsark" } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    variants.forEach((v, i) => {
      const slot = i % (COLUMNS * ROWS);
      if (i > 0 && slot === 0) doc.addPage();
      const x = MARGIN_X + (slot % COLUMNS) * CELL_W;
      const y = MARGIN_Y + Math.floor(slot / COLUMNS) * CELL_H;
      const pad = 8;
      const inner = CELL_W - pad * 2;

      doc.roundedRect(x + 3, y + 3, CELL_W - 6, CELL_H - 6, 4).lineWidth(0.5).strokeColor("#d6d3cc").stroke();
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#1c1b19");
      doc.text(v.name, x + pad, y + pad, { width: inner, height: 22, ellipsis: true });
      const variantText = [v.color, v.size].filter(Boolean).join(" / ");
      const price = Number(v.price_override ?? v.base_price);
      const incVat = price * (1 + Number(v.tax_rate_percent ?? 25) / 100);
      doc.font("Helvetica").fontSize(8).fillColor("#5c5851");
      doc.text([variantText, `${money(incVat)} inkl moms`].filter(Boolean).join(" · "), x + pad, y + pad + 23, {
        width: inner,
        height: 10,
        ellipsis: true,
      });
      doc.image(barcodes[i], x + pad, y + pad + 37, { fit: [inner, CELL_H - pad * 2 - 40], align: "center" });
    });

    if (settings?.seller_name) {
      doc.font("Helvetica").fontSize(6).fillColor("#a8a39a");
      doc.text(`${settings.seller_name} · streckkodsark`, MARGIN_X, PAGE_HEIGHT - 18, {
        width: PAGE_WIDTH - MARGIN_X * 2,
        align: "right",
      });
    }
    doc.end();
  });
}
