import json, glob, gzip, re, sys, collections, unicodedata, os
# 使い方: python3 tools/build_data.py <data_set/precedent のパス> <出力先 data フォルダ>
#   例: git clone https://github.com/japanese-law-analysis/data_set
#       python3 tools/build_data.py data_set/precedent site/data
if len(sys.argv) < 3:
    print("usage: build_data.py <precedent_dir> <out_dir> [excerpt_chars]"); sys.exit(1)
ROOT = sys.argv[1].rstrip("/")
OUT = sys.argv[2].rstrip("/")
os.makedirs(OUT, exist_ok=True)
ERA = {"Showa": 1925, "Heisei": 1988, "Reiwa": 2018, "Taisho": 1911, "Meiji": 1867}
ERAJ = {"Showa": "昭和", "Heisei": "平成", "Reiwa": "令和", "Taisho": "大正", "Meiji": "明治"}
CAT = {"SupremeCourt": 0, "HighCourt": 1, "LowerCourt": 2, "AdministrativeCase": 3, "LaborCase": 4, "IPCase": 5}
EXCERPT = int(sys.argv[3]) if len(sys.argv) > 3 else 240

def iso(d):
    if not d or not d.get("era") in ERA: return ""
    y = ERA[d["era"]] + int(d.get("year") or 0)
    return "%04d-%02d-%02d" % (y, int(d.get("month") or 0), int(d.get("day") or 0))

def clean(s):
    if not s: return ""
    s = s.replace("　", " ").replace("\n", " ").replace("\r", " ")
    s = re.sub(r"\s+", " ", s).strip()
    return s

WS = re.compile(r"[ \u3000\t]+")
GARBAGE = re.compile(r"^[\s\W\d_a-zA-Z]{0,12}$")  # 記号・数字・短い英字だけの行（m/s, =, ページ番号など）
HEADER = re.compile(r"(判決言渡|決定言渡|原本交付|裁判所書記官|口頭弁論終結|^\s*(平成|令和|昭和)[0-9０-９元]+年[（(]|第[0-9０-９]+号|事件$|^\s*(原告|被告|控訴人|被控訴人|上告人|被上告人|申立人|相手方|弁護人|検察官|訴訟代理人|同訴訟代理人)|代理人弁護士|^\s*判\s*決\s*$|^\s*決\s*定\s*$)")
END = re.compile(r"^\s*(理\s*由|事\s*実|事\s*実\s*及\s*び\s*理\s*由|事実及び理由の要旨|理由の要旨)\s*$")
CJK_SPACE = re.compile(r"(?<=[^\x00-\x7f])[ \u3000]+(?=[^\x00-\x7f])")
def excerpt(c, n):
    if not c or n <= 0: return ""
    lines = [l.strip() for l in c.replace("\r", "").split("\n")[:400]]
    lines = [l for l in lines if l and not GARBAGE.match(l)]
    if not lines: return ""
    start = None
    for i, l in enumerate(lines[:120]):
        if re.match(r"^[○●◯\s]*主\s*文\s*$", l) or re.match(r"^[○●◯\s]*主\s*文[\s　]", l): start = i; break
    if start is None:
        body = [l for l in lines[:60] if not HEADER.search(l)]
    else:
        body = []
        for l in lines[start:]:
            if body and END.match(l): break
            body.append(l)
    text = " ".join(body)
    text = re.sub(r"[○●◯]\s*", "", text)
    text = WS.sub(" ", text)
    text = CJK_SPACE.sub("", text).strip()
    if len(text) < (8 if start is not None else 20) or re.fullmatch(r"[\smM/s=.\-]*", text): return ""
    return text[:n] + ("…" if len(text) > n else "")

recs = {}
for f in glob.glob(ROOT + "/*/*.json"):
    if f.endswith("list.json"): continue
    d = json.load(open(f))
    lid = int(d["lawsuit_id"])
    cat = CAT[d["trial_type"]]
    r = recs.get(lid)
    if r is None:
        r = {"id": lid, "cats": set(), "num": clean(d.get("case_number")), "name": clean(d.get("case_name")),
             "court": clean(d.get("court_name")), "date": iso(d.get("date")), "kind": clean(d.get("result_type")),
             "result": clean(d.get("result")), "gist": clean(d.get("gist")), "cgist": clean(d.get("case_gist")),
             "law": clean(d.get("ref_law")), "rep": clean(d.get("article_info")), "ocourt": clean(d.get("original_court_name")),
             "onum": clean(d.get("original_case_number")), "odate": iso(d.get("original_date")),
             "right": clean(d.get("right_type")), "ltype": clean(d.get("lawsuit_type")), "field": clean(d.get("field")),
             "ex": excerpt(d.get("contents"), EXCERPT), "hastext": bool(d.get("contents") and len(d["contents"].strip()) > 200)}
        recs[lid] = r
    else:
        for k, src in (("gist", "gist"), ("cgist", "case_gist"), ("law", "ref_law"), ("rep", "article_info"), ("kind", "result_type"), ("result", "result"), ("field", "field"), ("right", "right_type"), ("ltype", "lawsuit_type"), ("ocourt", "original_court_name"), ("onum", "original_case_number")):
            if not r[k] and d.get(src): r[k] = clean(d.get(src))
        if not r["ex"] and d.get("contents"): r["ex"] = excerpt(d.get("contents"), EXCERPT)
        if not r["hastext"] and d.get("contents") and len(d["contents"].strip()) > 200: r["hastext"] = True
        if not r["date"]: r["date"] = iso(d.get("date"))
    r["cats"].add(cat)

for r in recs.values():
    if r["cgist"] in ("（省略）", "(省略)"): r["cgist"] = ""

rows = []
for lid in sorted(recs, key=lambda i: (recs[i]["date"], i), reverse=True):
    r = recs[lid]
    catmask = sum(1 << c for c in r["cats"])
    rows.append([r["id"], catmask, r["num"], r["name"], r["court"], r["date"], r["kind"], r["result"], r["gist"], r["cgist"], r["law"], r["rep"], r["ocourt"], r["onum"], r["odate"], r["right"], r["ltype"], r["field"], r["ex"], 1 if r["hastext"] else 0])

FIELDS = ["id", "cat", "num", "name", "court", "date", "kind", "result", "gist", "cgist", "law", "rep", "ocourt", "onum", "odate", "right", "ltype", "field", "ex", "hastext"]
import base64, datetime
GEN = datetime.date.today().isoformat()
print("records", len(rows))
chunks = {"a": [r for r in rows if r[5] >= "2010"], "b": [r for r in rows if "1990" <= r[5] < "2010"], "c": [r for r in rows if r[5] < "1990"]}
for k, rs in chunks.items():
    b = json.dumps({"fields": FIELDS, "generated": GEN, "total": len(rows), "rows": rs}, ensure_ascii=False, separators=(",", ":")).encode()
    g = gzip.compress(b, 9)
    open(OUT + "/cases-%s.txt" % k, "wb").write(base64.b64encode(g))
    print("chunk", k, len(rs), "raw MB", round(len(b) / 1e6, 1), "gz MB", round(len(g) / 1e6, 2))
stats = collections.Counter()
for r in recs.values():
    stats["gist"] += bool(r["gist"] or r["cgist"]); stats["ex"] += bool(r["ex"]); stats["hastext"] += r["hastext"]
    stats["none"] += not (r["gist"] or r["cgist"] or r["ex"]); stats["law"] += bool(r["law"]); stats["kind"] += bool(r["kind"]); stats["result"] += bool(r["result"])
print(stats)
