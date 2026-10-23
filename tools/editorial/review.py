#!/usr/bin/env python3
"""merge.py の曖昧一致（~）について公式の判示事項を並べて表示し、目視確認するための補助スクリプト。
  python3 tools/editorial/review.py [絞り込み語]
"""
import re, subprocess, json, gzip, base64, os, sys
BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
rows = []; fields = None
for k in "abc":
    d = json.loads(gzip.decompress(base64.b64decode(open(os.path.join(BASE, "data", f"cases-{k}.txt"), "rb").read())).decode()); fields = d["fields"]; rows += d["rows"]
I = {k: i for i, k in enumerate(fields)}
by = {r[I["id"]]: r for r in rows}
out = subprocess.run([sys.executable, os.path.join(BASE, "tools", "editorial", "merge.py")], capture_output=True, text=True).stdout
flt = sys.argv[1] if len(sys.argv) > 1 else None
for l in out.splitlines():
    if l.strip().startswith("~") and (not flt or flt in l):
        rid = int(re.search(r"id=(\d+)", l).group(1)); r = by[rid]
        print(l.strip()[:90]); print("    ", r[I["name"]][:40], "|", (r[I["gist"]] or r[I["cgist"]] or r[I["ex"]])[:130].replace("\n", " "))
