import PDFDocument from "pdfkit";

// TODO: move to a configurable "company profile" once Fas 8 (hardening/
// settings) exists. Hardcoded for now since there's only one seller.
const SELLER_NAME = "Profil & Arbetskläder i Eskilstuna AB";

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

function drawTableHeader(doc, y) {
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#334155");
  for (const col of COLS) {
    doc.text(col.label, col.x, y, { width: col.width, align: col.align ?? "left" });
  }
  doc
    .moveTo(40, y + 14)
    .lineTo(535, y + 14)
    .strokeColor("#cbd5e1")
    .stroke();
  doc.font("Helvetica").fillColor("#0f172a");
}

// Renders a quote as a PDF and returns it as a Buffer. `publicUrl` (the
// customer-facing accept/decline link) is printed on the document when
// given — the PDF itself is static, so it can't have a clickable button,
// but the link text lets a customer act on a printed/emailed copy too.
export function generateQuotePdf(quote, { publicUrl } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font("Helvetica-Bold").fontSize(18).text("OFFERT", 40, 40);
    doc.font("Helvetica").fontSize(10).fillColor("#475569");
    doc.text(SELLER_NAME, 40, 65);

    doc.fontSize(10).fillColor("#0f172a");
    doc.text(`Offertnr: ${quote.quote_number}`, 400, 40, { width: 135, align: "right" });
    doc.text(`Datum: ${new Date(quote.created_at).toLocaleDateString("sv-SE")}`, 400, 55, {
      width: 135,
      align: "right",
    });
    if (quote.valid_until) {
      doc.text(`Giltig till: ${new Date(quote.valid_until).toLocaleDateString("sv-SE")}`, 400, 70, {
        width: 135,
        align: "right",
      });
    }

    let y = 110;
    doc.font("Helvetica-Bold").fontSize(11).text("Kund", 40, y);
    y += 16;
    doc.font("Helvetica").fontSize(10);
    doc.text(quote.customer_name, 40, y);
    y += 13;
    if (quote.customer_org_number) {
      doc.text(`Org.nr: ${quote.customer_org_number}`, 40, y);
      y += 13;
    }
    if (quote.customer_address) {
      doc.text(quote.customer_address, 40, y);
      y += 13;
    }
    if (quote.customer_postal_code || quote.customer_city) {
      doc.text(`${quote.customer_postal_code ?? ""} ${quote.customer_city ?? ""}`.trim(), 40, y);
      y += 13;
    }
    if (quote.reference_name) {
      doc.text(`Referens: ${quote.reference_name}`, 40, y);
      y += 13;
    }

    y += 15;
    drawTableHeader(doc, y);
    y += 22;

    doc.fontSize(9);
    for (const line of quote.lines) {
      const description = [
        line.product_name,
        [line.color, line.size].filter(Boolean).join(" / "),
        line.description,
        line.print_method_name ? `Tryck: ${line.print_method_name}${line.print_description ? " – " + line.print_description : ""}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      const rowHeight = Math.max(14, doc.heightOfString(description, { width: COLS[0].width }) + 4);

      doc.text(description, COLS[0].x, y, { width: COLS[0].width });
      doc.text(String(line.quantity), COLS[1].x, y, { width: COLS[1].width, align: "right" });
      doc.text(money(line.unit_price), COLS[2].x, y, { width: COLS[2].width, align: "right" });
      doc.text(`${Number(line.discount_percent)} %`, COLS[3].x, y, { width: COLS[3].width, align: "right" });
      doc.text(money(line.line_total), COLS[4].x, y, { width: COLS[4].width, align: "right" });

      y += rowHeight;
      if (y > 720) {
        doc.addPage();
        y = 40;
      }
    }

    y += 10;
    doc.moveTo(320, y).lineTo(535, y).strokeColor("#cbd5e1").stroke();
    y += 8;

    doc.font("Helvetica").fontSize(10);
    doc.text("Delsumma ex moms", 320, y, { width: 135 });
    doc.text(money(quote.totals.subtotal_ex_vat), 440, y, { width: 95, align: "right" });
    y += 15;
    doc.text("Moms", 320, y, { width: 135 });
    doc.text(money(quote.totals.vat_amount), 440, y, { width: 95, align: "right" });
    y += 15;
    doc.font("Helvetica-Bold");
    doc.text("Totalt", 320, y, { width: 135 });
    doc.text(money(quote.totals.total_inc_vat), 440, y, { width: 95, align: "right" });
    doc.font("Helvetica");

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
    }

    doc.end();
  });
}
