// Kundens rabatt på en produkt (alias p i frågan), som två kolumner:
// rabatt i procent och rabatt i kronor per styck. Ordning:
//  1. Rabatten i kundens sortiment (customer_assortment) — % eller kr/st.
//  2. Stående produktrabatt (customer_discounts.product_id), %.
//  3. Stående leverantörsrabatt (customer_discounts.supplier_id), %.
// Kund-id:t bakas in som heltal (Number()) istället för som parameter, så
// att anropande frågor slipper hålla reda på hur många platshållare
// fragmentet innehåller.
export function customerDiscountSelect(customerId, { percentAs = "discount_percent", amountAs = "discount_amount" } = {}) {
  const id = Number(customerId) || 0;
  return `
  COALESCE(
    (SELECT IF(COALESCE(ca_d.discount_amount, 0) > 0, 0, ca_d.discount_percent) FROM customer_assortment ca_d
       WHERE ca_d.customer_id = ${id} AND ca_d.product_id = p.id
         AND (ca_d.discount_percent IS NOT NULL OR ca_d.discount_amount > 0) LIMIT 1),
    (SELECT discount_percent FROM customer_discounts WHERE customer_id = ${id} AND product_id = p.id LIMIT 1),
    (SELECT discount_percent FROM customer_discounts WHERE customer_id = ${id} AND supplier_id = p.supplier_id LIMIT 1),
    0
  ) AS ${percentAs},
  COALESCE(
    (SELECT ca_a.discount_amount FROM customer_assortment ca_a
       WHERE ca_a.customer_id = ${id} AND ca_a.product_id = p.id AND ca_a.discount_amount > 0 LIMIT 1),
    0
  ) AS ${amountAs}`;
}
