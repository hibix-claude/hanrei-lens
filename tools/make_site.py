#!/usr/bin/env python3
"""判例レンズのページを組み立てる。

  python3 tools/make_site.py              … index.html（フォルダ版）と static/ の配布物をプロジェクト直下に、
                                            dist/hanrei-lens-standalone.html（単一ファイル版）を生成
  python3 tools/make_site.py --artifact   … さらに dist/artifact.html（claude.ai アーティファクト用、skeleton なし）を生成

- src/part1.html + part2.html + part3_head.js + oldmap + part3_tail.js を結合します（part3.html も更新）。
- __SITE_URL__ は site.config.json の site_url、__VERSION__ はデータの生成日＋ビルド日時に置き換えます。
- src/analytics.html があれば、その内容を index.html の </body> 直前に差し込みます（アクセス解析用）。
"""
import os, sys, json, re, base64, gzip, datetime, shutil
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def rd(p): return open(os.path.join(BASE, p), encoding="utf-8").read()
cfg = {"site_url": "https://hibix-claude.github.io/hanrei-lens/"}
if os.path.exists(os.path.join(BASE, "site.config.json")): cfg.update(json.load(open(os.path.join(BASE, "site.config.json"), encoding="utf-8")))
SITE_URL = cfg["site_url"].rstrip("/") + "/"

# データの生成日を読む（版番号に使う）
gen = ""
try:
    head = base64.b64decode(open(os.path.join(BASE, "data", "cases-a.txt"), "rb").read(4000) + b"====")  # 先頭だけで十分
except Exception:
    head = b""
try:
    raw = gzip.GzipFile(fileobj=__import__("io").BytesIO(base64.b64decode(open(os.path.join(BASE, "data", "cases-a.txt"), "rb").read()))).read(400)
    m = re.search(rb'"generated":"([^"]+)"', raw); gen = m.group(1).decode() if m else ""
except Exception:
    gen = ""
VERSION = (gen or "data") + "-" + datetime.datetime.utcnow().strftime("%Y%m%d%H%M")

part1, part2 = rd("src/part1.html"), rd("src/part2.html")
if os.path.exists(os.path.join(BASE, "src", "part3_head.js")):
    oldmap = rd("src/oldmap.js") if os.path.exists(os.path.join(BASE, "src", "oldmap.js")) else ""
    part3 = rd("src/part3_head.js").replace("//OLDMAP//", oldmap) + rd("src/part3_tail.js")
    open(os.path.join(BASE, "src", "part3.html"), "w", encoding="utf-8").write(part3)
else:
    part3 = rd("src/part3.html")
analytics = rd("src/analytics.html") if os.path.exists(os.path.join(BASE, "src", "analytics.html")) else ""

def fill(s): return s.replace("__SITE_URL__", SITE_URL).replace("__VERSION__", VERSION)
cut = part1.index('\n<div class="app">')
head_extra, markup = part1[:cut], part1[cut:]
HEAD = ('<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        '<meta name="description" content="裁判所ウェブサイト掲載の裁判例65,468件をブラウザだけで横断検索できる判例検索アプリ">\n'
        '<style>:root{color-scheme:light}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n')
# フォルダ版（index.html）
open(os.path.join(BASE, "index.html"), "w", encoding="utf-8").write(fill(HEAD + head_extra + "\n</head>\n<body>" + markup + "\n" + part2 + part3 + analytics + "</body>\n</html>\n"))
# static/ をプロジェクト直下へ（配信物）
for name in os.listdir(os.path.join(BASE, "static")):
    src = os.path.join(BASE, "static", name); dst = os.path.join(BASE, name)
    if name.endswith((".js", ".txt", ".html", ".webmanifest")):
        open(dst, "w", encoding="utf-8").write(fill(open(src, encoding="utf-8").read()))
    else:
        shutil.copyfile(src, dst)
# 単一ファイル版
os.makedirs(os.path.join(BASE, "dist"), exist_ok=True)
blocks = []
for k in "abc":
    p = os.path.join(BASE, "data", f"cases-{k}.txt")
    if os.path.exists(p): blocks.append(f'<script type="text/plain" id="hanrei-data-{k}">' + open(p, encoding="ascii").read().strip() + "</script>\n")
open(os.path.join(BASE, "dist", "hanrei-lens-standalone.html"), "w", encoding="utf-8").write(fill(HEAD + head_extra + "\n</head>\n<body>" + markup + "\n" + part2 + "".join(blocks) + part3 + "</body>\n</html>\n"))
if "--artifact" in sys.argv:
    open(os.path.join(BASE, "dist", "artifact.html"), "w", encoding="utf-8").write(fill(part1 + part2 + part3))
print(f"built: index.html, static assets, dist/hanrei-lens-standalone.html (version {VERSION}, site {SITE_URL})")
