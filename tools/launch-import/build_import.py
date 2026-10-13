#!/usr/bin/env python3
"""
Bygger EN SQL-fil med alla produkter från leverantörernas prisfiler (xlsx).

Körs med:  /usr/bin/python3 tools/launch-import/build_import.py
Resultat i launch-import/ (ligger i .gitignore, innehåller inköpspriser):
  produkter-import.sql      -- importeras i phpMyAdmin (fliken SQL / Importera)
  produkter-import.sql.gz   -- samma fil gzippad (phpMyAdmin läser den direkt)
  import-rapport.csv        -- det som hoppats över, uppskattats eller ändrats
  import-sammanfattning.csv -- antal produkter/varianter per leverantör och varumärke

Nya leverantörsfiler läggs till i FILES nedan (en parser per filformat) och
UPLOADS pekar på mappen med xlsx-filerna.

Regler:
  * Pris (base_price) = rekommenderat pris/listpris exkl moms. Filer med bara
    ett pris (Helly Hansen, Båstadgruppen, Tee Jays) får det som pris.
  * Inköpspris (cost_price) = leverantörens nettopris (ÅF-pris, Netto pris,
    Customer Net, ListPrice hos Craft, Gross price hos Seger). Annars tomt.
  * Rader utan pris hoppas över. Saknas bara rek. pris men inköpspris finns
    uppskattas priset med varumärkets mediankvot (listas i rapporten).
  * Likartade varumärken slås ihop till leverantörens namn (Printer RED ->
    Printer). Båstadgruppen och New Wave behåller sina riktiga varumärken.
  * Produktnamn får varumärket framför sig om det inte redan står där.
  * Produkt = (leverantör, artikelnummer). Avvikande variantpriser sparas som
    price_override. Dubbletter av SKU/streckkod rensas och rapporteras.
  * Externa bild-länkar importeras inte (säkerhetsrubrikerna blockerar dem).
"""
import csv
import gzip
import json
import os
import re
import statistics
import sys
from collections import Counter, OrderedDict, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import xl  # noqa: E402

UPLOADS = "/root/.claude/uploads/a1073bdf-d7b6-54d1-aab6-aa46346d4fe8"
OUT_DIR = os.path.join(HERE, "..", "..", "launch-import")
CACHE_DIR = os.path.join(OUT_DIR, ".cache")

# ---------------------------------------------------------------------------
# Hjälpfunktioner
# ---------------------------------------------------------------------------

def read_sheet(path, sheet=None):
    """Alla rader i ett blad (lista av listor). Cacheas som JSONL."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    key = f"{os.path.basename(path)}.{int(os.path.getmtime(path))}.{sheet or 'first'}.jsonl"
    cache = os.path.join(CACHE_DIR, re.sub(r"[^\w.\-]", "_", key))
    if os.path.exists(cache):
        return [json.loads(line) for line in open(cache, encoding="utf-8")]
    z, sheets = xl.sheets(path)
    sst = xl.shared_strings(z)
    chosen = next((p for n, p in sheets if sheet is None or n == sheet), None)
    if chosen is None:
        raise SystemExit(f"Bladet {sheet!r} finns inte i {path}")
    rows = list(xl.rows(z, chosen, sst))
    with open(cache, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    return rows


def table(path, sheet=None, header_row=0):
    rows = read_sheet(path, sheet)
    header = [str(h).strip() if h is not None else None for h in rows[header_row]]
    out = []
    for r in rows[header_row + 1:]:
        r = r + [None] * (len(header) - len(r))
        out.append((dict(zip(header, r)), r, header))
    return out


def s(value):
    if value is None:
        return None
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    t = re.sub(r"\s+", " ", str(value).replace("\xa0", " ")).strip()
    return t or None


def num(value):
    if value is None or value == "":
        return None
    try:
        n = float(str(value).replace(",", ".").replace(" ", "").replace("\xa0", ""))
    except ValueError:
        return None
    return round(n, 2) if n > 0 else None


def ean(value):
    t = re.sub(r"\D", "", str(value or ""))
    if len(t) not in (8, 12, 13, 14) or set(t) == {"0"}:
        return None
    return t


def is_upper(t):
    return bool(re.search(r"[A-Za-zÅÄÖåäö]", t)) and t == t.upper()


def smart_title(t):
    sep = re.compile(r"(\s+|[-/(),])")

    def fix(tok):
        if not tok or sep.fullmatch(tok) or any(c.isdigit() for c in tok):
            return tok
        if len(tok) <= 2 and tok.isalpha():
            return tok
        return tok[0].upper() + tok[1:].lower()

    return "".join(fix(p) for p in sep.split(t))


def tidy(t):
    """Gemener/versaler: ALLA VERSALER blir Normal Skrivning."""
    t = s(t)
    return smart_title(t) if t and is_upper(t) else t


def first_token(t):
    t = s(t)
    return s(t.split(";")[0]) if t else None


def unit_of(value):
    v = (s(value) or "").lower()
    if v in ("par", "pair", "pr"):
        return "par"
    if v in ("förp", "forp", "pack"):
        return "förp"
    return "st"


def shorten(t, n):
    t = s(t)
    if not t or len(t) <= n:
        return t
    cut = t[:n].rsplit(" ", 1)[0].rstrip(",.;:- ")
    return cut + "…"


# ---------------------------------------------------------------------------
# Leverantörer och varumärken
# ---------------------------------------------------------------------------
# (leverantör, varumärke) per varumärke i filen. Likartade varumärken slås
# ihop till leverantörens eget namn (Helly Hansen Workwear -> Helly Hansen,
# Printer RED/PRIME -> Printer, ...). Båstadgruppen och New Wave är
# paraplyleverantörer: där behålls varumärkena.

SUPPLIER_CODE = {
    "Helly Hansen": "HH", "Jobman": "JOB", "Printer": "PRI", "Projob": "PRJ", "Båstadgruppen": "BAS",
    "Tegera Ejendals": "TEG", "Jalas Ejendals": "JAL", "Tee Jays": "TJ", "Craft": "CRA", "Clique": "CLI",
    "Cutter & Buck": "CB", "New Wave": "NW", "D&J": "DJ", "Segereurope": "SEG",
}

BRAND_MAP_F1 = {
    "Jobman": ("Jobman", "Jobman"),
    "Printer": ("Printer", "Printer"),
    "Printer RED": ("Printer", "Printer"),
    "Printer PRIME": ("Printer", "Printer"),
    "James Harvest": ("New Wave", "James Harvest"),
    "J.Harvest & Frost": ("New Wave", "J.Harvest & Frost"),
    "Mac One": ("New Wave", "Mac One"),
    "Hurricane": ("New Wave", "Hurricane"),
    "Jingham": ("New Wave", "Jingham"),
    "No Label": ("New Wave", "No Label"),
}

BRAND_MAP_F8 = {
    "Kosta Linnewäfveri": ("New Wave", "Kosta Linnewäfveri"),
    "Lord Nelson": ("New Wave", "Lord Nelson"),
    "Lord Nelson Victory": ("New Wave", "Lord Nelson"),
    "Queen Anne": ("New Wave", "Queen Anne"),
    "Orrefors Jernverk": ("New Wave", "Orrefors"),
    "Orrefors Hunting": ("New Wave", "Orrefors"),
    "Orrefors Outdoor": ("New Wave", "Orrefors"),
    "MORBERG by Orrefors Hunting": ("New Wave", "Orrefors"),
    "Nightingale": ("New Wave", "Nightingale"),
    "NDS": ("New Wave", "NDS"),
    "D&J": ("D&J", "D&J"),
}

BRAND_MAP_F9 = {
    "Clique": ("Clique", "Clique"),
    "Cutter & Buck": ("Cutter & Buck", "Cutter & Buck"),
    "Ahead LLC": ("New Wave", "Ahead"),
}

EJENDALS_GROUPS = {
    "Tegera Gloves": ("Tegera Ejendals", "Tegera", "Handskar"),
    "Jalas Shoes & Boots": ("Jalas Ejendals", "Jalas", "Skor & stövlar"),
    "Insoles, Socks, acc.": ("Jalas Ejendals", "Jalas", "Tillbehör"),
    "Graninge & Other sh.": ("Jalas Ejendals", "Jalas", "Skor & stövlar"),
}

TEE_JAYS_GROUPS = {
    "T-SHIRTS": "T-shirts", "SWEATSHIRTS": "Sweatshirts", "POLOS": "Pikéer", "OUTERWEAR": "Ytterkläder",
    "FLEECE/SOFTSHELL": "Fleece & softshell", "SHIRTS": "Skjortor", "KNITWEAR": "Stickat",
}

SEGER_CATEGORIES = {"6115": "Strumpor", "6109": "T-shirts", "6108": "Underkläder", "6505": "Mössor", "6117": "Tillbehör"}

REPORT = []  # (typ, leverantör, varumärke, artikel, namn, sku, detalj)


def rec(supplier, brand, article, name, sku, color=None, size=None, ean_=None, base=None, cost=None,
        desc=None, category=None, unit="st", discontinued=False, estimated=False, source=""):
    return dict(supplier=supplier, brand=brand, article=s(article), name=s(name), sku=s(sku), color=s(color), size=s(size),
                ean=ean(ean_), base=base, cost=cost, desc=desc, category=category, unit=unit,
                discontinued=discontinued, estimated=estimated, source=source)


# ---------------------------------------------------------------------------
# Parsers (en per filformat)
# ---------------------------------------------------------------------------

def parse_nwg_export(path, brand_map, base_col, cost_col, name_col="Product name (sv)", source=""):
    """New Wave Group-exporter (Jobman/Printer/…, Clique/Cutter & Buck, Lord Nelson/…)."""
    out = []
    for d, _, _ in table(path):
        brand = s(d.get("Brand"))
        if brand not in brand_map:
            raise SystemExit(f"{source}: okänt varumärke {brand!r} — lägg till i BRAND_MAP")
        sup, br = brand_map[brand]
        out.append(rec(sup, br, d["Product number"], tidy(d[name_col]), d["Sku"], tidy(d.get("Color (sv)")), s(d.get("Size name")),
                       d.get("Ean"), num(d.get(base_col)), num(d.get(cost_col)), shorten(d.get("Description (sv)"), 800),
                       tidy(first_token(d.get("Category (sv)"))), unit_of(d.get("Sales unit - code")), source=source))
    return out


def parse_f2_bastad(path):
    out = []
    for d, _, _ in table(path, "PriceFile_AW2025_SEK 251106"):
        brand = s(d.get("Brand"))
        brand = None if brand in (None, "Other") else brand
        out.append(rec("Båstadgruppen", brand, d["MasterPartNumber"], tidy(d["Description"]), d["PartNumber"], tidy(d.get("ColorName")),
                       s(d.get("SizeName")), d.get("EAN"), num(d.get("CurrentPrice")), None, shorten(d.get("ExtendedTextSVE"), 800),
                       tidy(s(d.get("ItemCategoryDescription"))), unit_of(d.get("Unit")), source="Båstadgruppen"))
    return out


def parse_f3_hh(path):
    out = []
    rows = table(path, "WW PRICAT SS27 SWEDEN", header_row=2)
    for d, raw, header in rows:
        if not d.get("Style Code"):
            continue
        i = header.index("Sales Price SS27")
        # Priset står i kolumnen efter rubriken "Sales Price SS27" (rubriken har valutan).
        price = num(raw[i + 1]) or num(raw[header.index("Sales Price FW26")])
        out.append(rec("Helly Hansen", "Helly Hansen", d["Style Code"], tidy(d["Style Name"]), d["Item Number"], tidy(d.get("Color Description")),
                       s(d.get("Size")), d.get("EAN Number"), price, None, None, tidy(s(d.get("Specification (Item Grp)"))),
                       unit_of(d.get("Unit")), source="Helly Hansen"))
    return out


def parse_f4_projob(path):
    out = []
    for d, _, _ in table(path):
        out.append(rec("Projob", "Projob", d["Product number"], tidy(d["Product name (sv)"]), d["Sku"], tidy(d.get("Color (sv)")),
                       s(d.get("Size name")), d.get("Ean"), num(d.get("Rek. ut")), num(d.get("ÅF-pris")), shorten(d.get("Description (sv)"), 800),
                       tidy(first_token(d.get("Category (sv)"))), unit_of(d.get("Sales unit - code")), source="Projob"))
    return out


def parse_f5_ejendals(path):
    out = []
    for d, _, _ in table(path, "2026-02-24"):
        sup, brand, cat = EJENDALS_GROUPS[s(d["Price group"])]
        out.append(rec(sup, brand, d["Item"], s(d["Description Short"]), d["Item No."], None, s(d.get("Size")), d.get("EAN/UPC"),
                       num(d.get("List price")), num(d.get("Customer Net")), shorten(d.get("Description Long"), 800), cat,
                       unit_of(d.get("Unit")), discontinued=(s(d.get("Status")) == "Utg"), source="Ejendals"))
    return out


def parse_f6_teejays(path):
    out = []
    for d, _, _ in table(path, "SEK"):
        style = s(d["TJ_Style_no"])
        out.append(rec("Tee Jays", "Tee Jays", f"TJ{style}", tidy(d["Product_Name"]), d["CSV_Code"], tidy(d.get("Colour")), s(d.get("Size")),
                       d.get("Gtin_no."), num(d.get("Grp_A_Price")), None, shorten(d.get("Description"), 800),
                       TEE_JAYS_GROUPS.get(s(d.get("Group")), tidy(s(d.get("Group")))), "st", source="Tee Jays"))
    return out


def parse_f7_craft(path):
    out = []
    for d, _, _ in table(path, "Masterdata Craft", header_row=2):
        if not d.get("ModelNo"):
            continue
        cat = s(d.get("ProductSubGroup")) or s(d.get("ProductGroup"))
        out.append(rec("Craft", "Craft", d["ModelNo"], tidy(d["Name"]), d["ID"], tidy(d.get("Color")), s(d.get("Size")), d.get("EAN13"),
                       num(d.get("Rek Price ex Vat")), num(d.get("ListPrice")), shorten(d.get("MarketingInfo"), 800), tidy(cat),
                       unit_of(d.get("UnitOfMeasure")), source="Craft"))
    return out


def parse_f10_seger(path):
    out = []
    for d, _, _ in table(path, "Mall"):
        cat = SEGER_CATEGORIES.get(str(d.get("Customs of tariff No (Stat No)") or "")[:4])
        out.append(rec("Segereurope", "Seger", d["Model no"], tidy(d["Product name"]), d["ItemID"], tidy(d.get("Color")), s(d.get("Size")),
                       d.get("Barcode EAN13"), num(d.get("Rec retail price:1 SEK")), num(d.get("Gross price SEK")), None, cat,
                       unit_of(d.get("Unit of measure")), source="Segereurope"))
    return out


# ---------------------------------------------------------------------------
# Filer (ordning = prioritet vid dubbletter)
# ---------------------------------------------------------------------------

FILES = [
    ("41f268ec-WW_PRICAT_SS27_SWEDEN.xlsx", parse_f3_hh),
    ("1d969e52-2025-11-27_08_36_36_723_q8JnIUlzEu30qE6WcFmTA.xlsx",
     lambda p: parse_nwg_export(p, BRAND_MAP_F1, "Rek. ut", "ÅF-pris", source="Jobman/Printer/New Wave")),
    ("5a5f7887-Prisfil.xlsx", parse_f4_projob),
    ("2551e3e7-Price_File_AW25_SEK_5.xlsx", parse_f2_bastad),
    ("b6b98ca0-43614_Prisfil_Profil__Arbetsklader_2026-02-24.xlsx", parse_f5_ejendals),
    ("ddce95d0-TEE_JAYS_Datafile_2025-11-03_SEK.xlsx", parse_f6_teejays),
    ("2d87bcf4-SS26_CORPORATE_MASTERDATA.xlsx", parse_f7_craft),
    ("9f3847c3-2025-11-25_10_04_46_346_Q8xsaVGJ90GCBC1aA4sxKw.xlsx",
     lambda p: parse_nwg_export(p, BRAND_MAP_F8, "REK. Pris från 1st", "ÅF", source="New Wave (hemtextil)")),
    ("5a801476-2025-11-28_08_10_34_246_ZzRDeeh8U6S6JbTIzZ2w.xlsx",
     lambda p: parse_nwg_export(p, BRAND_MAP_F9, "Rek.utpris", "Netto pris", source="Clique/Cutter & Buck")),
    ("89082f3c-Artikelfil_2026.xlsx", parse_f10_seger),
]


# ---------------------------------------------------------------------------
# Efterbehandling: priser, dubbletter, produkter
# ---------------------------------------------------------------------------

def estimate_missing_base(records):
    """Rader med inköpspris men utan rekommenderat pris (Clique): uppskattas med
    varumärkets mediankvot inköpspris/rek. pris. Listas i rapporten."""
    ratios = defaultdict(list)
    for r in records:
        if r["base"] and r["cost"]:
            ratios[(r["supplier"], r["brand"])].append(r["cost"] / r["base"])
    for r in records:
        if not r["base"] and r["cost"]:
            key = (r["supplier"], r["brand"])
            if len(ratios[key]) >= 20:
                r["base"] = round(r["cost"] / statistics.median(ratios[key]))
                r["estimated"] = True


def finish(records):
    estimate_missing_base(records)

    # 1) rader utan pris hoppas över
    kept = []
    for r in records:
        if not r["base"] or not r["article"] or not r["name"] or not r["sku"]:
            REPORT.append(("Överhoppad (saknar pris/namn/artikelnr)", r["supplier"], r["brand"], r["article"], r["name"], r["sku"], r["source"]))
            continue
        if r["estimated"]:
            REPORT.append(("Pris uppskattat (rek. pris saknades)", r["supplier"], r["brand"], r["article"], r["name"], r["sku"],
                           f"inköp {r['cost']} -> pris {r['base']}"))
        kept.append(r)

    # 2) produkter = (leverantör, artikelnr)
    groups = OrderedDict()
    for r in kept:
        groups.setdefault((r["supplier"], r["article"].lower()), []).append(r)

    # 3) unika artikelnummer över alla leverantörer (case-okänsligt, som databasen)
    by_article = defaultdict(list)
    for key in groups:
        by_article[key[1]].append(key)
    final_article = {}
    for art, keys in by_article.items():
        for key in keys:
            raw = groups[key][0]["article"]
            if len(keys) == 1:
                final_article[key] = raw
            else:
                code = SUPPLIER_CODE.get(key[0], key[0][:3].upper())
                final_article[key] = f"{code}-{raw}"
                REPORT.append(("Artikelnummer fanns hos flera leverantörer", key[0], groups[key][0]["brand"], raw, groups[key][0]["name"], "",
                               f"blev {code}-{raw}"))

    products = OrderedDict()
    seen_sku, seen_ean = {}, {}
    dup_sku = dup_ean = 0
    for key, rows in groups.items():
        art = final_article[key][:100]
        first = rows[0]
        # pris på produktnivå = vanligaste priset, avvikande varianter får eget pris
        base_mode = Counter(r["base"] for r in rows).most_common(1)[0][0]
        costs = [r["cost"] for r in rows if r["cost"]]
        cost_mode = Counter(costs).most_common(1)[0][0] if costs else None
        desc = next((r["desc"] for r in rows if r["desc"]), None)
        cat = next((r["category"] for r in rows if r["category"]), None)
        brand = first["brand"]
        name = first["name"]
        if brand and brand.lower() not in name.lower():
            name = f"{brand} {name}"
        variants = []
        for r in rows:
            sku = r["sku"]
            low = sku.lower()
            if low in seen_sku:
                if seen_sku[low] == art:
                    dup_sku += 1
                    REPORT.append(("Dubblettrad (samma SKU två gånger)", key[0], brand, art, name, sku, ""))
                    continue
                code = SUPPLIER_CODE.get(key[0], key[0][:3].upper())
                sku = f"{code}-{sku}"
                low = sku.lower()
                REPORT.append(("SKU fanns hos annan leverantör", key[0], brand, art, name, r["sku"], f"blev {sku}"))
            seen_sku[low] = art
            e = r["ean"]
            if e:
                if e in seen_ean:
                    owner_art, owner_sku, owner_ident = seen_ean[e]
                    ident = ((r["color"] or "").lower(), re.sub(r"[^0-9a-z]", "", (r["size"] or "").lower()))
                    if owner_art == art and owner_ident == ident:
                        # Samma vara med storleken skriven på två sätt (35/38 och 3538).
                        dup_ean += 1
                        REPORT.append(("Dubblettrad (samma streckkod, färg och storlek)", key[0], brand, art, name, sku, f"samma som {owner_sku}"))
                        seen_sku.pop(low, None)
                        continue
                    REPORT.append(("Streckkod fanns redan (tas bort på denna variant)", key[0], brand, art, name, sku,
                                   f"EAN {e} används av {owner_sku}"))
                    e = None
                else:
                    seen_ean[e] = (art, sku, ((r["color"] or "").lower(), re.sub(r"[^0-9a-z]", "", (r["size"] or "").lower())))
            variants.append(dict(sku=sku[:100], ean=e, color=(r["color"] or "")[:80] or None, size=(r["size"] or "")[:30] or None,
                                 override=None if abs(r["base"] - base_mode) < 0.005 else r["base"]))
        if not variants:
            continue
        products[art] = dict(article=art, name=name[:255], desc=desc, category=cat, brand=brand, supplier=key[0],
                             unit=first["unit"], base=base_mode, cost=cost_mode,
                             discontinued=all(r["discontinued"] for r in rows), variants=variants, source=first["source"])
    return products


# ---------------------------------------------------------------------------
# SQL
# ---------------------------------------------------------------------------

def q(value):
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return f"{value:.2f}" if isinstance(value, float) else str(value)
    t = str(value).replace("\\", "/")
    t = re.sub(r"[\x00-\x1f\x7f]", " ", t)
    t = re.sub(r" {2,}", " ", t).strip()
    return "'" + t.replace("'", "''") + "'"


def batches(items, n):
    for i in range(0, len(items), n):
        yield items[i:i + n]


def build_sql(products):
    suppliers = sorted({p["supplier"] for p in products.values()})
    brands = sorted({p["brand"] for p in products.values() if p["brand"]}, key=str.lower)
    cats = sorted({p["category"] for p in products.values() if p["category"]}, key=str.lower)
    n_var = sum(len(p["variants"]) for p in products.values())
    L = []
    w = L.append
    w("-- =============================================================================")
    w("-- PRODUKTIMPORT INFÖR LANSERING")
    w("-- =============================================================================")
    w(f"-- {len(products)} produkter och {n_var} varianter från {len(suppliers)} leverantörer.")
    w("-- Leverantörer: " + ", ".join(suppliers))
    w("--")
    w("-- KÖR EFTER reset-for-launch.sql och suppliers-launch.sql.")
    w("-- Importera i phpMyAdmin: välj databasen -> fliken Importera -> välj filen")
    w("-- (.sql eller .sql.gz) -> Kör. Hela filen går att köra igen: produkter och")
    w("-- varianter uppdateras i stället för att dubbleras.")
    w("--")
    w("-- Pris = leverantörens rekommenderade pris/listpris, exkl moms. Inköpspris =")
    w("-- leverantörens nettopris där filen har ett, annars tomt (se längst ner för")
    w("-- hur du sätter det med en rabatt per leverantör).")
    w("-- =============================================================================")
    w("")
    w("SET NAMES utf8mb4;")
    w("")
    w("-- 1. Leverantörer som saknas")
    for name in suppliers:
        w(f"INSERT INTO suppliers (name) SELECT {q(name)} FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE name = {q(name)});")
    w("")
    w("-- 2. Varumärken")
    for b in batches(brands, 200):
        w("INSERT IGNORE INTO brands (name) VALUES " + ", ".join(f"({q(x)})" for x in b) + ";")
    w("")
    w("-- 3. Kategorier som saknas")
    for c in cats:
        w(f"INSERT INTO product_categories (name) SELECT {q(c)} FROM DUAL WHERE NOT EXISTS "
          f"(SELECT 1 FROM product_categories WHERE name = {q(c)} AND parent_id IS NULL);")
    w("")
    w("-- 4. Mellanlager (tas bort sist i filen)")
    w("DROP TABLE IF EXISTS tmp_import_variants;")
    w("DROP TABLE IF EXISTS tmp_import_products;")
    w("""CREATE TABLE tmp_import_products (
  article_number VARCHAR(100) NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  category VARCHAR(255) NULL,
  brand VARCHAR(255) NULL,
  supplier VARCHAR(255) NOT NULL,
  unit VARCHAR(20) NOT NULL,
  base_price DECIMAL(10,2) NOT NULL,
  cost_price DECIMAL(10,2) NULL,
  discontinued TINYINT(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;""")
    w("""CREATE TABLE tmp_import_variants (
  sku VARCHAR(100) NOT NULL PRIMARY KEY,
  article_number VARCHAR(100) NOT NULL,
  barcode VARCHAR(100) NULL,
  color VARCHAR(80) NULL,
  size VARCHAR(30) NULL,
  price_override DECIMAL(10,2) NULL,
  INDEX idx_tiv_article (article_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;""")
    w("")
    w("-- 5. Produkter till mellanlagret")
    plist = list(products.values())
    for b in batches(plist, 150):
        w("INSERT INTO tmp_import_products (article_number, name, description, category, brand, supplier, unit, base_price, cost_price, discontinued) VALUES")
        w(",\n".join(f"({q(p['article'])},{q(p['name'])},{q(p['desc'])},{q(p['category'])},{q(p['brand'])},{q(p['supplier'])},{q(p['unit'])},"
                     f"{q(p['base'])},{q(p['cost'])},{q(p['discontinued'])})" for p in b) + ";")
    w("")
    w("-- 6. Varianter till mellanlagret")
    vlist = [(p["article"], v) for p in plist for v in p["variants"]]
    for b in batches(vlist, 500):
        w("INSERT INTO tmp_import_variants (sku, article_number, barcode, color, size, price_override) VALUES")
        w(",\n".join(f"({q(v['sku'])},{q(a)},{q(v['ean'])},{q(v['color'])},{q(v['size'])},{q(v['override'])})" for a, v in b) + ";")
    w("")
    w("-- 7. Produkter in i systemet")
    w("""INSERT INTO products (article_number, name, description, category_id, brand_id, supplier_id, unit, tax_rate_percent, base_price, cost_price, discontinued)
SELECT t.article_number, t.name, t.description, c.id, b.id, s.id, t.unit, 25.00, t.base_price, t.cost_price, t.discontinued
FROM tmp_import_products t
LEFT JOIN brands b ON b.name = t.brand
LEFT JOIN (SELECT name, MIN(id) AS id FROM suppliers GROUP BY name) s ON s.name = t.supplier
LEFT JOIN (SELECT name, MIN(id) AS id FROM product_categories WHERE parent_id IS NULL GROUP BY name) c ON c.name = t.category
ON DUPLICATE KEY UPDATE
  name = VALUES(name), description = VALUES(description), category_id = VALUES(category_id), brand_id = VALUES(brand_id),
  supplier_id = VALUES(supplier_id), unit = VALUES(unit), base_price = VALUES(base_price), cost_price = VALUES(cost_price),
  discontinued = VALUES(discontinued);""")
    w("")
    w("-- 8. Varianter in i systemet")
    w("""INSERT INTO product_variants (product_id, sku, barcode, color, size, price_override, active)
SELECT p.id, v.sku, v.barcode, v.color, v.size, v.price_override, 1
FROM tmp_import_variants v
JOIN products p ON p.article_number = v.article_number
ON DUPLICATE KEY UPDATE
  product_id = VALUES(product_id), barcode = VALUES(barcode), color = VALUES(color), size = VALUES(size),
  price_override = VALUES(price_override);""")
    w("")
    w("-- 9. Städa")
    w("DROP TABLE tmp_import_variants;")
    w("DROP TABLE tmp_import_products;")
    w("")
    w("-- 10. Kontroll: antal per leverantör (ska stämma med siffrorna överst i filen)")
    w("""SELECT s.name AS leverantor, COUNT(DISTINCT p.id) AS produkter, COUNT(v.id) AS varianter
FROM products p
LEFT JOIN suppliers s ON s.id = p.supplier_id
LEFT JOIN product_variants v ON v.product_id = p.id
GROUP BY s.name ORDER BY s.name;""")
    w("")
    w("-- =============================================================================")
    w("-- VALFRITT EFTERÅT: inköpspris och pris där filen bara hade ett pris")
    w("-- Helly Hansen, Båstadgruppen och Tee Jays: priset i filen är satt som pris och")
    w("-- inköpspriset är tomt. Byt 0.40 mot er rabatt (0.40 = 40 %) och kör raden:")
    w("--")
    for sup in ("Helly Hansen", "Båstadgruppen"):
        w(f"-- UPDATE products SET cost_price = ROUND(base_price * (1 - 0.40), 2) WHERE supplier_id = (SELECT MIN(id) FROM suppliers WHERE name = {q(sup)});")
    w("-- Tee Jays: filens pris är troligen inköpspriset (återförsäljarpris). Så här blir det inköpspris")
    w("-- och priset ett påslag (2.0 = dubbla inköpspriset):")
    w("-- UPDATE products SET cost_price = base_price, base_price = ROUND(base_price * 2.0, 0) WHERE supplier_id = (SELECT MIN(id) FROM suppliers WHERE name = 'Tee Jays');")
    w("-- =============================================================================")
    return "\n".join(L) + "\n"


# ---------------------------------------------------------------------------

def main():
    records = []
    for name, parser in FILES:
        path = os.path.join(UPLOADS, name)
        got = parser(path)
        print(f"{name[:40]:42} {len(got):6} rader")
        records.extend(got)
    products = finish(records)

    os.makedirs(OUT_DIR, exist_ok=True)
    sql = build_sql(products)
    sql_path = os.path.join(OUT_DIR, "produkter-import.sql")
    with open(sql_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(sql)
    with gzip.open(sql_path + ".gz", "wt", encoding="utf-8", compresslevel=9) as f:
        f.write(sql)

    with open(os.path.join(OUT_DIR, "import-rapport.csv"), "w", encoding="utf-8-sig", newline="") as f:
        wr = csv.writer(f, delimiter=";")
        wr.writerow(["Typ", "Leverantör", "Varumärke", "Artikelnr", "Namn", "SKU", "Detalj"])
        for row in REPORT:
            wr.writerow(row)

    summary = defaultdict(lambda: [0, 0, 0, 0])
    for p in products.values():
        k = (p["supplier"], p["brand"] or "")
        summary[k][0] += 1
        summary[k][1] += len(p["variants"])
        summary[k][2] += 1 if p["cost"] else 0
        summary[k][3] += 1 if p["discontinued"] else 0
    with open(os.path.join(OUT_DIR, "import-sammanfattning.csv"), "w", encoding="utf-8-sig", newline="") as f:
        wr = csv.writer(f, delimiter=";")
        wr.writerow(["Leverantör", "Varumärke", "Produkter", "Varianter", "Produkter med inköpspris", "Utgångna"])
        for (sup, br), v in sorted(summary.items()):
            wr.writerow([sup, br, *v])

    n_var = sum(len(p["variants"]) for p in products.values())
    print(f"\n{len(products)} produkter, {n_var} varianter -> {sql_path} ({os.path.getsize(sql_path) / 1e6:.1f} MB, "
          f"{os.path.getsize(sql_path + '.gz') / 1e6:.1f} MB gz)")
    print("Rapportrader:", Counter(r[0] for r in REPORT))


if __name__ == "__main__":
    main()
