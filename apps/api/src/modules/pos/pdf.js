import PDFDocument from "pdfkit";

const SELLER_NAME = "Profil & Arbetskläder i Eskilstuna AB";

const PAYMENT_LABELS = { CASH: "Kontant", CARD: "Kort", SWISH: "Swish", INVOICE: "Faktura" };

function money(n) {
  return `${Number(n).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
}

// Compact A5-ish receipt, not a full A4 invoice layout like quotes.
export function generateReceiptPdf(sale) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [300, 620], margin: 24 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font("Helvetica-Bold").fontSize(13).text(SELLER_NAME, { align: "center" });
    doc.font("Helvetica").fontSize(9).fillColor("#475569");
    doc.text("Kvitto", { align: "center" });
    doc.moveDown(0.5);

    doc.fillColor("#0f172a").fontSize(9);
    doc.text(`Kvittonr: ${sale.sale_number}`);
    doc.text(`Datum: ${new Date(sale.created_at).toLocaleString("sv-SE")}`);
    doc.text(`Kassör: ${sale.cashier_name}`);
    if (sale.customer_name) doc.text(`Kund: ${sale.customer_name}`);

    doc.moveDown(0.5);
    doc.moveTo(24, doc.y).lineTo(276, doc.y).strokeColor("#cbd5e1").stroke();
    doc.moveDown(0.5);

    for (const line of sale.lines) {
      const desc = [line.product_name, [line.color, line.size].filter(Boolean).join(" / ")]
        .filter(Boolean)
        .join(" – ");
      const total = Number(line.quantity) * Number(line.unit_price) * (1 - Number(line.discount_percent) / 100);
      doc.font("Helvetica").fontSize(9).text(desc, 24, doc.y, { width: 252 });
      const qtyLineY = doc.y;
      doc.text(`${line.quantity} x ${money(line.unit_price)}`, 24, qtyLineY, { width: 170 });
      doc.text(money(total), 24, qtyLineY, { width: 252, align: "right" });
      doc.moveDown(0.3);
    }

    doc.moveDown(0.3);
    doc.moveTo(24, doc.y).lineTo(276, doc.y).strokeColor("#cbd5e1").stroke();
    doc.moveDown(0.4);

    doc.font("Helvetica").fontSize(9);
    doc.text(`Delsumma ex moms: ${money(sale.totals.subtotal_ex_vat)}`, { align: "right" });
    doc.text(`Moms: ${money(sale.totals.vat_amount)}`, { align: "right" });
    doc.font("Helvetica-Bold").fontSize(11);
    doc.text(`Totalt: ${money(sale.totals.total_inc_vat)}`, { align: "right" });

    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(9);
    for (const payment of sale.payments) {
      doc.text(`${PAYMENT_LABELS[payment.method] ?? payment.method}: ${money(payment.amount)}`, { align: "right" });
    }

    doc.moveDown(1);
    doc.font("Helvetica").fontSize(8).fillColor("#64748b").text("Tack för ditt köp!", { align: "center" });

    doc.end();
  });
}
