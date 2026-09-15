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
