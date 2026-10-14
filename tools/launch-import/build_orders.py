"""Bygger launch-import/ordrar-import.sql från en WooCommerce-dump (HPOS-tabeller)
och Fortnox-kundexporten. Dumpen läses från en lokal databas `wp`:

    mysql -e "create database wp character set utf8mb4"
    mysql --default-character-set=utf8mb4 wp < dump.sql
    python3 -I tools/launch-import/build_orders.py kundregister.csv

Gamla ordrar läggs in som Fakturerad, undantagna lagerhantering, utan
fakturarader och utan lagerrörelser — enbart för statistiken. Utfil och
rapport innehåller kunduppgifter och checkas inte in (launch-import/).
"""
import csv, re, subprocess, collections, sys, os
from zoneinfo import ZoneInfo
from datetime import datetime, timezone

cust = list(csv.reader(open(sys.argv[1], encoding="utf-8-sig")))[1:]


def norm(t):
    return re.sub(r"[^a-z0-9åäö]", "", (t or "").lower().replace("&", "och"))


by_email, by_name = collections.defaultdict(list), collections.defaultdict(list)
for r in cust:
    for e in (r[20], r[14]):
        if e.strip():
            by_email[e.strip().lower()].append(r)
    by_name[norm(r[0])].append(r)


def mysql(sql):
    out = subprocess.run(["mysql", "--default-character-set=utf8mb4", "-N", "-B", "-r", "wp", "-e", sql],
                         capture_output=True, text=True, check=True).stdout
    return [[None if v == "NULL" else v for v in l.split("\t")] for l in out.splitlines()]


def q(v):
    if v is None or v == "":
        return "NULL"
    return "'" + str(v).replace("\\", "").replace(";", ",").replace("'", "''") + "'"


orders = mysql("""select o.id, o.status, o.total_amount, o.date_created_gmt, o.payment_method_title,
  a.first_name, a.company, a.email,
  (select meta_value from 7w9zlUE_wc_orders_meta m where m.order_id=o.id and m.meta_key='fortnox_invoice_number' limit 1)
  from 7w9zlUE_wc_orders o join 7w9zlUE_wc_order_addresses a on a.order_id=o.id and a.address_type='billing'
  where o.type='shop_order' order by o.id""")
items = mysql("""select i.order_id, i.order_item_id, i.order_item_name,
  max(case when m.meta_key='_qty' then m.meta_value end), max(case when m.meta_key='_line_subtotal' then m.meta_value end),
  max(case when m.meta_key='_line_total' then m.meta_value end), max(case when m.meta_key='_line_tax' then m.meta_value end),
  max(case when m.meta_key='_sku' then m.meta_value end)
  from 7w9zlUE_woocommerce_order_items i join 7w9zlUE_woocommerce_order_itemmeta m using(order_item_id)
  where i.order_item_type='line_item' group by i.order_id, i.order_item_id, i.order_item_name order by i.order_item_id""")
lines_by = collections.defaultdict(list)
for it in items:
    lines_by[it[0]].append(it)

tz = ZoneInfo("Europe/Stockholm")
report, o_rows, l_rows = [], [], []
tot_src = tot_out = 0.0
for oid, status, total, created, pay, fn, co, em, finv in orders:
    em = (em or "").strip().lower()
    names = [norm(x) for x in (fn, co) if x]
    if (em == "poc@x.tld") or "x" in names:
        report.append(("Överhoppad (testorder)", oid, fn, co, em, total))
        continue
    cands = by_email.get(em) or next((by_name[n] for n in names if n in by_name), [])
    how = "e-post" if by_email.get(em) else "namn"
    if not cands:
        report.append(("Överhoppad (ingen kund hittades)", oid, fn, co, em, total))
        continue
    if len({c[1] for c in cands}) > 1:
        narrowed = [c for c in cands if norm(c[0]) in names]
        report.append(("Flera kunder med samma " + how, oid, fn, co, em, ", ".join(sorted({c[1] for c in cands}))))
        cands = narrowed or cands
    cust_no = cands[0][1]
    dt = datetime.strptime(created, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc).astimezone(tz)
    notes = f"WooCommerce #{oid}" + (f" · Fortnox-faktura {finv}" if finv else " · ej fakturerad i Fortnox") + (f" · {pay}" if pay else "")
    o_rows.append(f"({q('WC-' + oid)},{q(cust_no)},{q(dt.strftime('%Y-%m-%d %H:%M:%S'))},{q(notes)})")
    n = 0
    for _, _, name, qty, sub, tot, tax, sku in lines_by[oid]:
        qty, sub, tot, tax = float(qty), float(sub), float(tot), float(tax)
        if sub < tot:  # saknar ordinarie pris — använd det betalda som à-pris
            sub = tot
        unit = round(sub / qty, 2) if qty else 0
        disc = round((1 - tot / sub) * 100, 2) if sub else 0
        rate = min((0, 6, 12, 25), key=lambda r: abs(r - (tax / tot * 100 if tot else 25)))
        tot_src += tot
        tot_out += qty * unit * (1 - disc / 100)
        n += 1
        l_rows.append(f"({q('WC-' + oid)},{n},{q((name or 'Artikel')[:255])},{q((sku or '').strip())},{qty:g},{unit:.2f},{disc:.2f},{rate})")
    if status != "wc-completed":
        report.append(("Ej slutförd i WooCommerce (importerad som Fakturerad)", oid, fn, co, em, f"{status} {total}"))

out = ["-- Gamla WooCommerce-ordrar för statistiken. Går att köra flera gånger.",
       "-- Kör EFTER produkt- och kundfilerna. Ordrarna läggs in som Fakturerad, utan lagerrörelser och utan faktura.",
       "SET NAMES utf8mb4;", "",
       "DROP TABLE IF EXISTS tmp_wc_orders;", "DROP TABLE IF EXISTS tmp_wc_lines;",
       "CREATE TABLE tmp_wc_orders (order_number VARCHAR(50) PRIMARY KEY, customer_number VARCHAR(50) NOT NULL, created_at DATETIME NOT NULL, notes VARCHAR(500)) DEFAULT CHARSET=utf8mb4;",
       "CREATE TABLE tmp_wc_lines (order_number VARCHAR(50) NOT NULL, n INT NOT NULL, description VARCHAR(255), sku VARCHAR(100), qty DECIMAL(10,2), unit_price DECIMAL(10,2), disc DECIMAL(5,2), tax DECIMAL(5,2), PRIMARY KEY (order_number, n)) DEFAULT CHARSET=utf8mb4;", ""]
for i in range(0, len(o_rows), 100):
    out.append("INSERT INTO tmp_wc_orders VALUES\n" + ",\n".join(o_rows[i:i + 100]) + ";\n")
for i in range(0, len(l_rows), 100):
    out.append("INSERT INTO tmp_wc_lines VALUES\n" + ",\n".join(l_rows[i:i + 100]) + ";\n")
out.append("""INSERT INTO orders (order_number, customer_id, status, delivery_method, created_by, notes, skip_inventory, created_at)
SELECT t.order_number, c.id, 'INVOICED', 'PICKUP', (SELECT MIN(id) FROM users WHERE role = 'ADMIN'), t.notes, 1, t.created_at
FROM tmp_wc_orders t
JOIN customers c ON c.customer_number = t.customer_number
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.order_number = t.order_number);

INSERT INTO order_lines (order_id, product_variant_id, description, quantity, delivered_qty, unit_price, discount_percent, tax_rate_percent, sort_order)
SELECT o.id, v.id, l.description, l.qty, l.qty, l.unit_price, l.disc, l.tax, l.n
FROM tmp_wc_lines l
JOIN orders o ON o.order_number = l.order_number
LEFT JOIN (SELECT sku, MIN(id) AS id FROM product_variants GROUP BY sku) v ON l.sku <> '' AND v.sku = l.sku
WHERE NOT EXISTS (SELECT 1 FROM order_lines x WHERE x.order_id = o.id);

DROP TABLE tmp_wc_orders;
DROP TABLE tmp_wc_lines;

SELECT COUNT(*) AS importerade_ordrar FROM orders WHERE order_number LIKE 'WC-%';""")
os.makedirs("launch-import", exist_ok=True)
open("launch-import/ordrar-import.sql", "w", encoding="utf-8").write("\n".join(out))
with open("launch-import/ordrar-rapport.csv", "w", encoding="utf-8-sig", newline="") as f:
    w = csv.writer(f, delimiter=";")
    w.writerow(["Typ", "WooCommerce-order", "Namn", "Företag", "E-post", "Detalj"])
    w.writerows(report)
print(len(o_rows), "ordrar,", len(l_rows), "rader; summa ex moms källa/ut:", round(tot_src, 2), round(tot_out, 2))
print(collections.Counter(r[0] for r in report))
