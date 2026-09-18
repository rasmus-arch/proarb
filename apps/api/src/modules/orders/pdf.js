import PDFDocument from "pdfkit";
import QRCode from "qrcode";

const FALLBACK_SELLER_NAME = "Mitt företag";
const FALLBACK_BRAND_COLOR = "#0f172a";

const CHECK_COLS = [
  { label: "Plockad", x: 330 },
  { label: "Tryckt", x: 400 },
  { label: "Redo", x: 465 },
];
const CHECKBOX_SIZE = 9;

function drawCheckbox(doc, x, y) {
  doc.rect(x, y, CHECKBOX_SIZE, CHECKBOX_SIZE).strokeColor("#94a3b8").lineWidth(1).stroke();
}

// Ordersedel/plocklista: en PDF med en rad per orderrad, tre kryssrutor
// per rad (Plockad/Tryckt/Redo) som personalen bockar av för hand under
// plockningen — ingen digital avläsning av dem, papperet är bara ett
// fysiskt hjälpmedel. QR-koden längst ner är det enda som pratar tillbaka
// till systemet: att scanna den flyttar hela ordern NEW -> READY_FOR_PICKUP
// (se qr-public.js) — inget annat, och den slutar fungera så fort ordern
// lämnat NEW.
export async function generateOrderSlipPdf(order, { qrUrl, settings } = {}) {
  const sellerName = settings?.seller_name || FALLBACK_SELLER_NAME;
  const brandColor = settings?.brand_color || FALLBACK_BRAND_COLOR;
  const qrPng = await QRCode.toBuffer(qrUrl, { width: 140, margin: 1 });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font("Helvetica-Bold").fontSize(18).fillColor(brandColor).text("ORDERSEDEL", 40, 40);
    doc.font("Helvetica").fontSize(10).fillColor("#475569");
    doc.text(sellerName, 40, 65);

    doc.fontSize(10).fillColor("#0f172a");
    doc.text(`Ordernr: ${order.order_number}`, 400, 40, { width: 135, align: "right" });
    doc.text(`Datum: ${new Date(order.created_at).toLocaleDateString("sv-SE")}`, 400, 55, {
      width: 135,
      align: "right",
    });
    doc.text(order.delivery_method === "SHIPPING" ? "Frakt" : "Avhämtning i butik", 400, 70, {
      width: 135,
      align: "right",
    });

    let y = 110;
    doc.font("Helvetica-Bold").fontSize(11).fillColor(brandColor).text("Kund", 40, y);
    doc.fillColor("#0f172a");
    y += 16;
    doc.font("Helvetica").fontSize(10);
    doc.text(order.customer_name, 40, y);
    y += 13;
    if (order.reference_name) {
      doc.text(`Referens: ${order.reference_name}`, 40, y);
      y += 13;
    }

    y += 15;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(brandColor);
    doc.text("Produkt", 40, y, { width: 280 });
    doc.text("Antal", 280, y, { width: 40, align: "right" });
    for (const col of CHECK_COLS) doc.text(col.label, col.x, y, { width: 60 });
    doc.moveTo(40, y + 14).lineTo(535, y + 14).strokeColor("#cbd5e1").stroke();
    y += 24;

    doc.font("Helvetica").fontSize(9).fillColor("#0f172a");
    for (const line of order.lines) {
      const description = [
        line.product_name,
        [line.color, line.size].filter(Boolean).join(" / "),
        line.print_description ? `Tryck: ${line.print_description}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      const rowHeight = Math.max(24, doc.heightOfString(description, { width: 230 }) + 10);

      doc.text(description, 40, y, { width: 230 });
      doc.text(String(line.quantity), 280, y, { width: 40, align: "right" });
      for (const col of CHECK_COLS) drawCheckbox(doc, col.x, y);

      y += rowHeight;
      if (y > 680) {
        doc.addPage();
        y = 40;
      }
    }

    y = Math.max(y + 20, 640);
    if (y > 680) {
      doc.addPage();
      y = 40;
    }
    doc.image(qrPng, 40, y, { width: 90 });
    doc.font("Helvetica").fontSize(8).fillColor("#475569");
    doc.text(
      "Scanna för att markera ordern “redo för uthämtning” (kunden meddelas per e-post).\n" +
        "Fungerar bara en gång — slutar fungera så fort ordern är redo.",
      140,
      y + 10,
      { width: 280 }
    );

    doc.end();
  });
}
