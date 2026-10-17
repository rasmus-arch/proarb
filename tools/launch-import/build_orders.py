"""Bygger launch-import/ordrar-import.sql från en WooCommerce-dump (HPOS-tabeller)
och Fortnox-kundexporten. Dumpen läses från en lokal databas `wp`:

    mysql -e "create database wp character set utf8mb4"
    mysql --default-character-set=utf8mb4 wp < dump.sql
    python3 -I tools/launch-import/build_orders.py kundregister.csv

Produktmatchning sker mot de redan importerade produkterna i en lokal databas
`proarb` (kör produktfilerna dit först). Bara säkra träffar kopplas (artikelnummer
i namnet eller ett namn som exakt motsvarar produkten) — resten blir fritextrader.
Rader som heter "Påvärmning" blir tryck (print_price) så att de räknas som
"Tryck & brodyr" i statistiken.

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

# --- Produktmatchning --------------------------------------------------------
SIZE_RE = re.compile(r"^(xxs|xs|s|m|l|xl|xxl|xxxl|[2-6]xl)$")
STOP = {"och", "med", "i", "av", "för", "the", "st"}
SYN = {"hh": "helly hansen", "bk": "blåkläder", "tj": "tee jays"}


def toks(t):
    t = (t or "").lower()
    for ch in "&-/,.®":
        t = t.replace(ch, " ")
    out = []
    for w in t.split():
        out += SYN.get(w, w).split()
    return [re.sub(r"(ar|er|or|n|s)$", "", w) if len(w) > 5 else w for w in out if w not in STOP]


def prodrows(sql):
    out = subprocess.run(["mysql", "--default-character-set=utf8mb4", "-N", "-B", "-r", "proarb", "-e", sql],
                         capture_output=True, text=True, check=True).stdout
    return [l.split("\t") for l in out.splitlines()]


products = prodrows("select p.id, p.article_number, p.name, coalesce(b.name,'') from products p left join brands b on b.id = p.brand_id")
variants = collections.defaultdict(list)
for pid, sku, size in prodrows("select product_id, sku, coalesce(size,'') from product_variants order by id"):
    variants[pid].append((sku, size.lower()))
by_art, name_key = collections.defaultdict(list), collections.defaultdict(list)
for pid, art, name, brand in products:
    by_art[art.lower()].append(pid)
    bt = set(toks(brand))
    key = frozenset(w for w in toks(name) if w not in bt and not w.isdigit())
    if key:
        name_key[key].append(pid)
pname = {pid: name for pid, _, name, _ in products}
match_cache = {}


def match_product(name):
    """Returnerar (produkt-id, hur) eller None. Endast säkra träffar."""
    if name in match_cache:
        return match_cache[name]
    res = None
    nums = re.findall(r"[A-Za-z]*\d{4,}[A-Za-z]*", name)
    cands = set()
    for w in nums:
        for key in (w.lower(), re.sub(r"^64(?=\d{4}$)", "", w.lower())):  # Projob: 64 + artikelnr
            cands.update(by_art.get(key, []))
    if len(cands) == 1:
        res = (next(iter(cands)), "artikelnummer")
    elif not nums:
        wt = [w for w in toks(name) if not SIZE_RE.match(w) and not w.isdigit()]
        # varumärkesord i namnet får finnas utöver produktens namn
        for key, pids in name_key.items():
            if len(pids) == 1 and len(key) >= 2 and key <= set(wt) and len(set(wt) - key) <= 3 and \
               set(wt) - key <= {w for pid, _, nm, br in products if pid == pids[0] for w in toks(br)} | set():
                res = (pids[0], "namn")
                break
    match_cache[name] = res
    return res


def pick_variant(pid, name):
    vs = variants.get(pid) or []
    if not vs:
        return None
    size = next((w for w in reversed(name.lower().replace("/", " ").split()) if SIZE_RE.match(w)), None)
    if size:
        for sku, sz in vs:
            if sz == size:
                return sku
    return vs[0][0]


tz = ZoneInfo("Europe/Stockholm")
report, o_rows, l_rows, matched = [], [], [], []
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
        name = name or "Artikel"
        is_print = 1 if "påvärm" in name.lower() else 0
        sku = (sku or "").strip()
        m = None if is_print else match_product(name)
        if m:
            sku = pick_variant(m[0], name) or sku
            matched.append((name, pname[m[0]], m[1]))
        l_rows.append(f"({q('WC-' + oid)},{n},{q(name[:255])},{q(sku)},{qty:g},{unit:.2f},{disc:.2f},{rate},{is_print})")
    if status != "wc-completed":
        report.append(("Ej slutförd i WooCommerce (importerad som Fakturerad)", oid, fn, co, em, f"{status} {total}"))

out = ["-- Gamla WooCommerce-ordrar för statistiken. Går att köra flera gånger.",
       "-- Kör EFTER produkt- och kundfilerna. Ordrarna läggs in som Fakturerad, utan lagerrörelser och utan faktura.",
       "SET NAMES utf8mb4;", "",
       "DROP TABLE IF EXISTS tmp_wc_orders;", "DROP TABLE IF EXISTS tmp_wc_lines;",
       "CREATE TABLE tmp_wc_orders (order_number VARCHAR(50) PRIMARY KEY, customer_number VARCHAR(50) NOT NULL, created_at DATETIME NOT NULL, notes VARCHAR(500)) DEFAULT CHARSET=utf8mb4;",
       "CREATE TABLE tmp_wc_lines (order_number VARCHAR(50) NOT NULL, n INT NOT NULL, description VARCHAR(255), sku VARCHAR(100), qty DECIMAL(10,2), unit_price DECIMAL(10,2), disc DECIMAL(5,2), tax DECIMAL(5,2), is_print TINYINT NOT NULL DEFAULT 0, PRIMARY KEY (order_number, n)) DEFAULT CHARSET=utf8mb4;", ""]
for i in range(0, len(o_rows), 100):
    out.append("INSERT INTO tmp_wc_orders VALUES\n" + ",\n".join(o_rows[i:i + 100]) + ";\n")
for i in range(0, len(l_rows), 100):
    out.append("INSERT INTO tmp_wc_lines VALUES\n" + ",\n".join(l_rows[i:i + 100]) + ";\n")
out.append("""INSERT INTO orders (order_number, customer_id, status, delivery_method, created_by, notes, created_at)
SELECT t.order_number, c.id, 'INVOICED', 'PICKUP', (SELECT MIN(id) FROM users WHERE role = 'ADMIN'), t.notes, t.created_at
FROM tmp_wc_orders t
JOIN customers c ON c.customer_number = t.customer_number
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.order_number = t.order_number);

INSERT INTO order_lines (order_id, product_variant_id, description, quantity, delivered_qty, unit_price, discount_percent, tax_rate_percent, sort_order,
                         print_description, print_price, print_discount_percent, cost_price, skip_inventory)
SELECT o.id, v.id, l.description, l.qty, l.qty,
       IF(l.is_print = 1, 0, l.unit_price), IF(l.is_print = 1, 0, l.disc), l.tax, l.n,
       IF(l.is_print = 1, l.description, NULL), IF(l.is_print = 1, l.unit_price, NULL), IF(l.is_print = 1, l.disc, 0),
       IF(l.is_print = 1, 0, NULL), 1
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
with open("launch-import/ordrar-matchningar.csv", "w", encoding="utf-8-sig", newline="") as f:
    w = csv.writer(f, delimiter=";")
    w.writerow(["Radtext i WooCommerce", "Kopplad till produkt", "Träff via", "Antal rader"])
    for (a, b, c), n in sorted(collections.Counter(matched).items(), key=lambda x: -x[1]):
        w.writerow([a, b, c, n])
print(len(matched), "rader kopplade till produkter,", sum(1 for r in l_rows if r.endswith(",1)")), "tryckrader")
print(len(o_rows), "ordrar,", len(l_rows), "rader; summa ex moms källa/ut:", round(tot_src, 2), round(tot_out, 2))
print(collections.Counter(r[0] for r in report))
