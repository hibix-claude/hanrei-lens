#!/usr/bin/env python3
"""編集解説の追加候補（tools/editorial/add*.py の CASES_ADD）を公式データ（data/cases-*.txt）と照合し、
一致したものだけを src/part2.html の CASES 配列へ追記する。

  python3 tools/editorial/merge.py            # 照合結果を表示するだけ
  python3 tools/editorial/merge.py --write    # src/part2.html に追記

照合の順序:
  1. 事件番号（全角半角・空白を正規化）が一致し、裁判年月日も一致
  2. 事件番号が一致（年月日は候補が1件なら採用し、日付を公式に補正）
  3. 裁判年月日＋裁判所（最高裁/高裁/地裁の別）が一致し、判示事項・要旨との語の重なりが大きい
一致しないものは追加しない（事件番号・日付の誤りを防ぐため）。
"""
import os, sys, re, json, gzip, base64, glob, unicodedata, importlib.util
BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ED = os.path.join(BASE, "tools", "editorial")
P2 = os.path.join(BASE, "src", "part2.html")
WRITE = "--write" in sys.argv

rows = []; fields = None
for k in "abc":
    p = os.path.join(BASE, "data", f"cases-{k}.txt")
    d = json.loads(gzip.decompress(base64.b64decode(open(p, "rb").read())).decode("utf-8"))
    fields = d["fields"]; rows += d["rows"]
I = {k: i for i, k in enumerate(fields)}
R = [dict(zip(fields, r)) for r in rows]

def nnum(s):
    s = unicodedata.normalize("NFKC", s or "").replace(" ", "").replace("　", "")
    s = s.replace("第", "").replace("号", "").replace("元", "1")
    return s
byNum = {}; byDate = {}
for r in R:
    byNum.setdefault(nnum(r["num"]), []).append(r)
    byDate.setdefault(r["date"], []).append(r)

def cgroup(c):
    c = c or ""
    if "最高" in c: return "最高"
    if "大審院" in c: return "大審院"
    if "高等" in c or "知的財産" in c: return "高裁"
    if "地方" in c: return "地裁"
    if "家庭" in c: return "家裁"
    if "簡易" in c: return "簡裁"
    return "?"

ERA = [("2019-05-01", "令和", 2018), ("1989-01-08", "平成", 1988), ("1926-12-25", "昭和", 1925), ("1912-07-30", "大正", 1911), ("0000-00-00", "明治", 1867)]
def wareki(iso):
    y, m, d = int(iso[:4]), int(iso[5:7]), int(iso[8:10])
    for lim, era, base in ERA:
        if iso >= lim: n = y - base; return f"{era}{'元' if n == 1 else n}年{m}月{d}日"
    return iso

def bigrams(s):
    s = re.sub(r"[\s、。「」『』（）()・，,.．\d]", "", unicodedata.normalize("NFKC", s or ""))
    return {s[i:i+2] for i in range(len(s) - 1)}
def overlap(a, b):
    A, B = bigrams(a), bigrams(b)
    return len(A & B) / max(1, min(len(A), len(B)))

def official_text(r): return (r["gist"] or "") + (r["cgist"] or "") + (r["name"] or "") + (r["ex"] or "")

def match(c):
    key = nnum(c.get("caseNo", "")); date = c.get("date", ""); cg = cgroup(c.get("court", ""))
    text = c["holdings"] + c["summary"] + " ".join(c.get("laws", [])) + " ".join(c.get("tags", []))
    cands = byNum.get(key, []) if key else []
    # 1. 事件番号＋年月日
    same = [r for r in cands if r["date"] == date]
    if same: return pick(same, text), "num+date"
    # 2. 年月日＋裁判所種別＋本文の重なり（日付の方が事件番号より信頼できるので先に試す）
    if date:
        dc = [r for r in byDate.get(date, []) if cg == "?" or cgroup(r["court"]) == cg]
        if dc:
            best = pick(dc, text); sc = overlap(text, official_text(best))
            if sc >= 0.22: return best, f"date + text ({sc:.2f}; {c.get('caseNo','')} -> {best['num']})"
    # 3. 事件番号のみ（本文の重なりがあるときだけ）
    if cands:
        cands2 = [r for r in cands if cgroup(r["court"]) == cg] or cands if cg != "?" else cands
        best = pick(cands2, text); sc = overlap(text, official_text(best))
        if sc >= 0.2: return best, f"num + text ({sc:.2f}; date {date} -> {best['date']})"
    return None, "no match"

def pick(cands, text):
    def score(r): return (len(r["gist"] or "") > 0, overlap(text, official_text(r)), len(r["gist"] or "") + len(r["cgist"] or ""))
    return max(cands, key=score)

def court_split(c):
    m = re.match(r"^(最高裁判所)(大法廷|第[一二三]小法廷)?$", c or "")
    if m: return m.group(1), m.group(2) or ""
    return c, ""

def js(s): return json.dumps(s, ensure_ascii=False)

mods = sorted(glob.glob(os.path.join(ED, "add*.py")))
existing = open(P2, encoding="utf-8").read()
ex_lids = set(int(x) for x in re.findall(r'lid:(\d+)', existing)); ex_names = set(re.findall(r'name:"([^"]*)"', existing))
seq = len(re.findall(r'^\{id:"c', existing, re.M))
out = []; report = []; seen = set(ex_lids)
for mp in mods:
    spec = importlib.util.spec_from_file_location(os.path.basename(mp)[:-3], mp); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    for c in m.CASES_ADD:
        if c.get("skip"): continue
        r, how = match(c)
        if not r: report.append(f"  ✗ {c['name']}  {c.get('caseNo','')} {c.get('date','')}  — {how}"); continue
        if r["id"] in seen: report.append(f"  = {c['name']} → id {r['id']} は既に収録済み（重複スキップ）"); continue
        if c["name"] in ex_names: report.append(f"  = {c['name']} 同名の解説が既にあるためスキップ"); continue
        seen.add(r["id"]); seq += 1
        court, bench = court_split(r["court"])
        out.append({"id": f"c{seq:03d}", "lid": r["id"], "name": c["name"], "caseNo": r["num"], "date": r["date"], "wareki": wareki(r["date"]),
                    "court": court, "bench": bench, "kind": r["kind"] or "判決", "result": r["result"] or "", "reporter": r["rep"] or "",
                    "areas": c["areas"], "holdings": c["holdings"], "summary": c["summary"], "laws": c.get("laws", []), "tags": c.get("tags", [])})
        flag = "✓" if how == "num+date" else "~"
        report.append(f"  {flag} {c['name']} → {r['num']} {r['date']} {r['court']} id={r['id']}  [{how}]")
print("\n".join(report))
n_ok = sum(1 for l in report if l.strip().startswith(("✓", "~"))); n_ng = sum(1 for l in report if l.strip().startswith("✗"))
print(f"\n一致 {n_ok} 件 / 不一致 {n_ng} 件 / 既存 {len(ex_lids)} 件 → 合計 {len(ex_lids) + n_ok} 件")
if WRITE and out:
    lines = []
    for c in out:
        lines.append("{id:%s,lid:%d,name:%s,caseNo:%s,date:%s,wareki:%s,court:%s,bench:%s,kind:%s,result:%s,reporter:%s,areas:%s,\n holdings:%s,\n summary:%s,\n laws:%s,tags:%s}" % (
            js(c["id"]), c["lid"], js(c["name"]), js(c["caseNo"]), js(c["date"]), js(c["wareki"]), js(c["court"]), js(c["bench"]), js(c["kind"]), js(c["result"]), js(c["reporter"]), js(c["areas"]),
            js(c["holdings"]), js(c["summary"]), js(c["laws"]), js(c["tags"])))
    block = ",\n" + ",\n".join(lines)
    idx = existing.rfind("\n];")
    new = existing[:idx] + block + existing[idx:]
    open(P2, "w", encoding="utf-8").write(new)
    print(f"src/part2.html に {len(out)} 件を追記しました")
