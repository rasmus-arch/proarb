"""Minimal xlsx reader: values only (ignores styles). Yields rows as lists."""
import zipfile, re
from xml.etree import ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}

def col_index(ref):
    letters = re.match(r"[A-Z]+", ref).group(0)
    n = 0
    for ch in letters: n = n * 26 + (ord(ch) - 64)
    return n - 1

def sheets(path):
    z = zipfile.ZipFile(path)
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    rid = {r.get("Id"): r.get("Target") for r in rels}
    out = []
    for s in wb.find("m:sheets", NS):
        t = rid[s.get("{%s}id" % NS["r"])]
        t = t.lstrip("/")
        out.append((s.get("name"), t if t.startswith("xl/") else "xl/" + t))
    return z, out

def shared_strings(z):
    if "xl/sharedStrings.xml" not in z.namelist(): return []
    res = []
    for si in ET.fromstring(z.read("xl/sharedStrings.xml")):
        res.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
    return res

def rows(z, sheet_path, sst):
    m = "{%s}" % NS["m"]
    with z.open(sheet_path) as f:
        for _, el in ET.iterparse(f, events=("end",)):
            if el.tag != m + "row": continue
            cells = {}
            for c in el.findall(m + "c"):
                t = c.get("t"); v = c.find(m + "v")
                if t == "inlineStr":
                    val = "".join(x.text or "" for x in c.iter(m + "t"))
                elif v is None: continue
                elif t == "s": val = sst[int(v.text)]
                elif t in ("str", "e"): val = v.text
                elif t == "b": val = v.text == "1"
                else:
                    try: val = float(v.text); val = int(val) if val.is_integer() else val
                    except Exception: val = v.text
                cells[col_index(c.get("r"))] = val
            if cells:
                width = max(cells) + 1
                yield [cells.get(i) for i in range(width)]
            el.clear()
