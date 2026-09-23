import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { uploadsRoot } from "../../lib/uploads.js";

const FALLBACK_SELLER_NAME = "Mitt företag";
const FALLBACK_BRAND_COLOR = "#0f172a";
const TABLE_RIGHT_EDGE = 535;

function money(n) {
  return `${Number(n).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
}

const COLS = [
  { key: "description", label: "Beskrivning", x: 40, width: 230 },
  { key: "quantity", label: "Antal", x: 270, width: 45, align: "right" },
  { key: "unitPrice", label: "à-pris ex moms", x: 315, width: 80, align: "right" },
  { key: "discount", label: "Rabatt", x: 395, width: 45, align: "right" },
  { key: "lineTotal", label: "Summa ex moms", x: 440, width: 95, align: "right" },
];

function drawTableHeader(doc, y, brandColor) {
  doc.rect(40, y - 4, TABLE_RIGHT_EDGE - 40, 18).fill("#f8fafc");
  doc.font("Helvetica-Bold").fontSize(9).fillColor(brandColor);
  for (const col of COLS) {
    doc.text(col.label, col.x, y, { width: col.width, align: col.align ?? "left" });
  }
  doc.moveTo(40, y + 14).lineTo(TABLE_RIGHT_EDGE, y + 14).strokeColor("#cbd5e1").stroke();
  doc.font("Helvetica").fillColor("#0f172a");
}

// Renders a quote as a PDF and returns it as a Buffer. Same visual language
// as ordersedeln (orders/pdf.js) — stor logga uppe till vänster, kontakt-
// uppgifter under den, titel/metadata högerställt, samma tabellhuvud-stil
// med radskiljare — så de två dokumenten känns som en och samma produkt.
// `publicUrl` (the customer-facing accept/decline link) is printed on the
// document when given — the PDF itself is static, so it can't have a
// clickable button, but the link text lets a customer act on a printed/
// emailed copy too. `settings` controls seller info/accent color/footer.
export function generateQuotePdf(quote, { publicUrl, settings } = {}) {
  const sellerName = settings?.seller_name || FALLBACK_SELLER_NAME;
  const brandColor = settings?.brand_color || FALLBACK_BRAND_COLOR;

  let logoBuffer = null;
  if (settings?.seller_logo_path) {
    try {
      logoBuffer = fs.readFileSync(path.join(uploadsRoot, settings.seller_logo_path));
    } catch {
      // Saknad/oläsbar fil ska aldrig stoppa PDF-genereringen.
    }
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    if (logoBuffer) {
      try {
        doc.image(logoBuffer, 40, 36, { fit: [180, 54], align: "left", valign: "top" });
      } catch {
        doc.font("Helvetica-Bold").fontSize(18).fillColor(brandColor).text(sellerName, 40, 50);
      }
    } else {
      doc.font("Helvetica-Bold").fontSize(18).fillColor(brandColor).text(sellerName, 40, 50);
    }

    const contactAddressLine = [
      settings?.seller_address,
      [settings?.seller_postal_code, settings?.seller_city].filter(Boolean).join(" "),
    ]
      .filter(Boolean)
      .join(", ");
    const contactDetailsLine = [settings?.seller_phone, settings?.seller_email].filter(Boolean).join(" · ");
    const orgLine = settings?.seller_org_number ? `Org.nr: ${settings.seller_org_number}` : null;
    if (contactAddressLine || contactDetailsLine || orgLine) {
      doc.font("Helvetica").fontSize(8).fillColor("#475569");
      let contactY = logoBuffer ? 94 : 76;
      if (contactAddressLine) {
        doc.text(contactAddressLine, 40, contactY, { width: 260 });
        contactY += 11;
      }
      if (orgLine) {
        doc.text(orgLine, 40, contactY, { width: 260 });
        contactY += 11;
      }
      if (contactDetailsLine) doc.text(contactDetailsLine, 40, contactY, { width: 260 });
    }

    doc.font("Helvetica-Bold").fontSize(18).fillColor(brandColor).text("OFFERT", 320, 40, {
      width: 215,
      align: "right",
    });
    doc.fontSize(10).fillColor("#0f172a");
    doc.text(`Offertnr: ${quote.quote_number}`, 320, 64, { width: 215, align: "right" });
    doc.text(`Datum: ${new Date(quote.created_at).toLocaleDateString("sv-SE")}`, 320, 78, {
      width: 215,
      align: "right",
    });
    if (quote.valid_until) {
      doc.text(`Giltig till: ${new Date(quote.valid_until).toLocaleDateString("sv-SE")}`, 320, 92, {
        width: 215,
        align: "right",
      });
    }

    let y = 128;
    doc.moveTo(40, y).lineTo(TABLE_RIGHT_EDGE, y).strokeColor("#e2e8f0").stroke();
    y += 12;

    doc.font("Helvetica-Bold").fontSize(9).fillColor(brandColor).text("Kund", 40, y);
    doc.font("Helvetica").fontSize(10).fillColor("#0f172a");
    y += 14;
    doc.text(quote.customer_name, 40, y);
    y += 13;
    if (quote.customer_org_number) {
      doc.text(`Org.nr: ${quote.customer_org_number}`, 40, y);
      y += 13;
    }
    const addressLine = [quote.customer_postal_code, quote.customer_city].filter(Boolean).join(" ");
    if (quote.customer_address || addressLine) {
      doc.text([quote.customer_address, addressLine].filter(Boolean).join(", "), 40, y, { width: 300 });
      y += 13;
    }

    if (quote.reference_name) {
      doc.font("Helvetica-Bold").fontSize(9).fillColor(brandColor).text("Referens", 320, 140);
      doc.font("Helvetica").fontSize(10).fillColor("#0f172a").text(quote.reference_name, 320, 154, { width: 175 });
    }

    y += 16;
    y = Math.max(y, 175);

    drawTableHeader(doc, y, brandColor);
    y += 24;

    doc.font("Helvetica").fontSize(9).fillColor("#0f172a");
    quote.lines.forEach((line, i) => {
      const description = [
        line.product_name,
        [line.color, line.size].filter(Boolean).join(" / "),
        line.description,
        line.print_description ? `Tryck: ${line.print_description}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      const rowHeight = Math.max(14, doc.heightOfString(description, { width: COLS[0].width }) + 10);

      doc.text(description, COLS[0].x, y, { width: COLS[0].width });
      doc.text(String(line.quantity), COLS[1].x, y, { width: COLS[1].width, align: "right" });
      doc.text(money(line.unit_price), COLS[2].x, y, { width: COLS[2].width, align: "right" });
      doc.text(`${Number(line.discount_percent)} %`, COLS[3].x, y, { width: COLS[3].width, align: "right" });
      doc.text(money(line.line_total), COLS[4].x, y, { width: COLS[4].width, align: "right" });

      y += rowHeight;
      if (i < quote.lines.length - 1) {
        doc.moveTo(40, y - 5).lineTo(TABLE_RIGHT_EDGE, y - 5).strokeColor("#e2e8f0").lineWidth(0.5).stroke();
      }
      if (y > 700) {
        doc.addPage();
        y = 40;
        drawTableHeader(doc, y, brandColor);
        y += 24;
      }
    });

    y += 10;
    doc.moveTo(320, y).lineTo(TABLE_RIGHT_EDGE, y).strokeColor("#cbd5e1").stroke();
    y += 8;

    doc.font("Helvetica").fontSize(10).fillColor("#0f172a");
    doc.text("Delsumma ex moms", 320, y, { width: 135 });
    doc.text(money(quote.totals.subtotal_ex_vat), 440, y, { width: 95, align: "right" });
    y += 15;
    doc.text("Moms", 320, y, { width: 135 });
    doc.text(money(quote.totals.vat_amount), 440, y, { width: 95, align: "right" });
    y += 15;
    doc.font("Helvetica-Bold").fillColor(brandColor);
    doc.text("Totalt", 320, y, { width: 135 });
    doc.text(money(quote.totals.total_inc_vat), 440, y, { width: 95, align: "right" });
    doc.font("Helvetica").fillColor("#0f172a");

    y += 30;
    if (quote.notes) {
      doc.fontSize(9).fillColor("#475569").text(quote.notes, 40, y, { width: 495 });
      y += doc.heightOfString(quote.notes, { width: 495 }) + 15;
    }

    if (publicUrl) {
      doc
        .fontSize(9)
        .fillColor("#1d4ed8")
        .text(`Godkänn eller avböj offerten online: ${publicUrl}`, 40, y, { width: 495 });
      y += 20;
    }

    if (settings?.quote_footer_note) {
      doc.fontSize(8).fillColor("#94a3b8").text(settings.quote_footer_note, 40, y, { width: 495 });
    }

    doc.end();
  });
}
