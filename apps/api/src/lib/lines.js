// Shared across quotes/orders/pos: a line is either a real product
// (productVariantId set) or a fritextrad (free-text line — no product,
// just a description + price). Throws INVALID_LINE, mapped to a 400 by
// each module's routes.js.
export function assertValidLines(lines) {
  for (const line of lines) {
    const productVariantId = line.productVariantId ?? line.product_variant_id;
    const description = (line.description ?? "").toString().trim();

    if (!productVariantId && !description) {
      throw new Error("INVALID_LINE");
    }
    if (!(Number(line.quantity) > 0)) {
      throw new Error("INVALID_LINE");
    }
    const unitPrice = line.unitPrice ?? line.unit_price;
    if (unitPrice === undefined || unitPrice === null || Number.isNaN(Number(unitPrice))) {
      throw new Error("INVALID_LINE");
    }
    const discountAmount = Number(line.discountAmount ?? line.discount_amount ?? 0);
    if (!(discountAmount >= 0)) throw new Error("INVALID_LINE");
  }
}

// Inköpspris som sparas på raden: bara för fritextrader (katalograder tar
// alltid produktens aktuella inköpspris). Tomt/ogiltigt -> NULL, vilket
// betyder "okänt" — och då räknas hela ordern/offerten inte med i
// marginalen (se summarizeTotals och stats/service.js).
export function lineCostPrice(line) {
  if (line.productVariantId ?? line.product_variant_id) return null;
  const value = line.costPrice ?? line.cost_price;
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// En fritextrad utan inköpspris gör att marginalen inte går att räkna ut
// för hela ordern/offerten.
export function hasUnpricedFreeTextLine(lines) {
  return lines.some((l) => !l.product_variant_id && (l.cost_price === null || l.cost_price === undefined));
}

// --- Radsumma ---------------------------------------------------------------
// Rabatt finns i två former på en rad: discount_percent (procent) och
// discount_amount (kronor per styck, avdrag på à-priset). Normalt används
// bara den ena; räknas de båda tas procenten först. Tryck (print_price)
// har sin egen procentrabatt. Alla belopp ex moms.

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Nettopris per styck för produkten efter rabatt.
export function lineNetUnitPrice(line) {
  const price = num(line.unitPrice ?? line.unit_price);
  const percent = num(line.discountPercent ?? line.discount_percent);
  const amount = num(line.discountAmount ?? line.discount_amount);
  return price * (1 - percent / 100) - amount;
}

export function lineProductTotal(line) {
  return num(line.quantity) * lineNetUnitPrice(line);
}

export function linePrintTotal(line) {
  const printPrice = line.printPrice ?? line.print_price;
  if (printPrice === null || printPrice === undefined || printPrice === "") return 0;
  const percent = num(line.printDiscountPercent ?? line.print_discount_percent);
  return num(line.quantity) * num(printPrice) * (1 - percent / 100);
}

export function lineTotal(line) {
  return lineProductTotal(line) + linePrintTotal(line);
}

// Samma uträkning i SQL, för listor/summor som räknas i databasen.
export function sqlLineTotal(alias) {
  const a = alias;
  return `(${a}.quantity * (${a}.unit_price * (1 - ${a}.discount_percent / 100) - ${a}.discount_amount)
    + IFNULL(${a}.quantity * ${a}.print_price * (1 - ${a}.print_discount_percent / 100), 0))`;
}

export function lineDiscountAmount(line) {
  const n = num(line.discountAmount ?? line.discount_amount);
  return n > 0 ? n : 0;
}
