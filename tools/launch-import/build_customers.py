"""Bygger launch-import/kunder-import.sql från en Fortnox-kundexport (CSV).

Kör: python3 -I tools/launch-import/build_customers.py kundregister.csv
Filen innehåller kunduppgifter och checkas inte in (launch-import/ är ignorerad).
"""
import csv, re, sys, os

src = sys.argv[1]
rows = list(csv.reader(open(src, encoding="utf-8-sig")))[1:]


def q(v):
    v = (v or "").strip().replace("\\", "").replace(";", ",").replace("'", "''")
    return f"'{v}'" if v else "NULL"


def org(v):
    d = re.sub(r"\D", "", v or "")
    if len(d) == 12 and d[:2] in ("16", "19", "20"):
        d = d[2:]
    return f"{d[:6]}-{d[6:]}" if len(d) == 10 else (v or "").strip()


vals = []
for r in rows:
    if not r[0].strip() or not r[1].strip():
        continue
    addr = ", ".join(x.strip() for x in (r[58], r[59]) if x.strip())
    country = (r[62].strip() or "SE")[:2].upper()
    terms = int(r[4]) if r[4].strip().isdigit() else 30
    vals.append("(" + ",".join([
        q(r[1]), q(r[1]), q(r[0]), q(org(r[39])), q(r[20]), q(r[14]),
        q(r[64]), q(addr), q(r[60]), q(r[61]), q(country), str(terms),
    ]) + ")")

cols = ("customer_number, fortnox_customer_number, name, org_number, email, "
        "invoice_email, phone, address, postal_code, city, country, payment_terms_days")
out = ["-- Kunder från Fortnox (kundregister). Går att köra flera gånger.",
       "-- Kör EFTER reset-for-launch.sql. Dubbletter (samma namn, olika kundnummer) behålls.",
       "SET NAMES utf8mb4;", ""]
for i in range(0, len(vals), 50):
    out.append(f"INSERT INTO customers ({cols}) VALUES\n" + ",\n".join(vals[i:i + 50]) + "\n"
               "ON DUPLICATE KEY UPDATE name = VALUES(name), org_number = VALUES(org_number), "
               "email = VALUES(email), invoice_email = VALUES(invoice_email), phone = VALUES(phone), "
               "address = VALUES(address), postal_code = VALUES(postal_code), city = VALUES(city), "
               "country = VALUES(country), fortnox_customer_number = VALUES(fortnox_customer_number);\n")
out.append("-- Swish-kunden är kontantkund (annars skapar appen en egen vid omstart).\nUPDATE customers SET is_cash_customer = 1 WHERE name LIKE 'Swish%';\n")
out.append("SELECT COUNT(*) AS antal_kunder FROM customers;")
os.makedirs("launch-import", exist_ok=True)
open("launch-import/kunder-import.sql", "w", encoding="utf-8").write("\n".join(out))
print(len(vals), "kunder")
