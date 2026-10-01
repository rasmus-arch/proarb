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
