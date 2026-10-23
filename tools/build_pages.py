#!/usr/bin/env python3
"""GitHub Pages 用の配信フォルダ（_site）を組み立てる。

  python3 tools/build_pages.py [出力先=_site]

- index.html、data/、static の配信物（manifest, sw.js, icons, og.png, terms.html, robots.txt, .nojekyll）をコピー
- 判例ごとの軽量ページ p/<id>.html（タイトル・OGP・判示事項・裁判要旨・参照法条・アプリへのリンク）を生成
- sitemap.xml（インデックス）と sitemap-N.xml（1ファイル 10,000 URL）を生成

検索エンジンに判例単位で載せるためのページで、閲覧者が開くとアプリ本体（index.html#<id>）へ案内します。
"""
import os, sys, json, base64, gzip, shutil, html, datetime, re
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, sys.argv[1] if len(sys.argv) > 1 else "_site")
cfg = {"site_url": "https://hibix-claude.github.io/hanrei-lens/", "site_name": "判例レンズ"}
if os.path.exists(os.path.join(BASE, "site.config.json")): cfg.update(json.load(open(os.path.join(BASE, "site.config.json"), encoding="utf-8")))
SITE = cfg["site_url"].rstrip("/") + "/"
NAME = cfg.get("site_name", "判例レンズ")

if os.path.exists(OUT): shutil.rmtree(OUT)
os.makedirs(os.path.join(OUT, "data")); os.makedirs(os.path.join(OUT, "p"))
# 配信物のコピー
for name in ["index.html", "manifest.webmanifest", "sw.js", "icon-192.png", "icon-512.png", "og.png", "terms.html", "robots.txt", ".nojekyll"]:
    src = os.path.join(BASE, name)
    if os.path.exists(src): shutil.copyfile(src, os.path.join(OUT, name))
data_dir = os.path.join(BASE, "data") if os.path.exists(os.path.join(BASE, "data", "cases-a.txt")) else BASE
rows = []; fields = None
for k in "abc":
    src = os.path.join(data_dir, f"cases-{k}.txt")
    if not os.path.exists(src): continue
    shutil.copyfile(src, os.path.join(OUT, "data", f"cases-{k}.txt"))
    d = json.loads(gzip.decompress(base64.b64decode(open(src, "rb").read())).decode("utf-8"))
    fields = d["fields"]; rows += d["rows"]
I = {k: i for i, k in enumerate(fields)}
ERA = [("2019-05-01", "令和", 2018), ("1989-01-08", "平成", 1988), ("1926-12-25", "昭和", 1925), ("1912-07-30", "大正", 1911), ("0000-00-00", "明治", 1867)]
def wareki(iso):
    if not iso: return ""
    y, m, d = int(iso[:4]), int(iso[5:7]), int(iso[8:10])
    for lim, era, base in ERA:
        if iso >= lim: n = y - base; return f"{era}{'元' if n == 1 else n}年{m}月{d}日"
    return iso
def cut(s, n): return s if len(s) <= n else s[:n] + "…"
def title_of(r):
    if r[I["name"]]: return r[I["name"]]
    b = re.sub(r"^主文\s*", "", r[I["gist"]] or r[I["cgist"]] or r[I["ex"]] or "")
    return cut(b, 40) if b else "（事件名の記載なし）"
E = html.escape
TPL = """<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} | {name}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{url}">
<meta property="og:type" content="article"><meta property="og:title" content="{title}"><meta property="og:description" content="{desc}"><meta property="og:url" content="{url}"><meta property="og:image" content="{site}og.png"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="../icon-192.png" type="image/png">
<style>:root{{color-scheme:light dark}}body{{margin:0;font-family:"Noto Sans JP","Hiragino Kaku Gothic ProN","Yu Gothic",system-ui,sans-serif;line-height:1.8;background:#F5F7FA;color:#1B2430}}@media(prefers-color-scheme:dark){{body{{background:#12161C;color:#E7EAEE}}a{{color:#9DBDE6}}}}.w{{max-width:760px;margin:0 auto;padding:28px 16px 48px}}h1{{font-family:"Shippori Mincho","Hiragino Mincho ProN","Yu Mincho",serif;font-size:22px;line-height:1.4;margin:0 0 6px}}.m{{font-size:13px;opacity:.75;margin-bottom:16px}}h2{{font-size:12px;letter-spacing:.14em;opacity:.6;margin:18px 0 4px}}p{{margin:0;white-space:pre-line}}.b{{display:inline-block;margin-top:22px;background:#1F3A5F;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:700}}.s{{font-size:12px;opacity:.65;margin-top:26px}}.l{{font-size:13px;margin-top:8px}}</style></head><body><div class="w">
<div class="m"><a href="../">{name}</a></div>
<h1>{title}</h1>
<div class="m">{court}　{date}{num}{result}{rep}</div>
{body}
<a class="b" href="../#{id}">{name}で開く（検索・類似判例・審級・メモ）</a>
<div class="l"><a href="{detail}" rel="noopener">裁判所ウェブサイトの詳細ページ</a> ／ <a href="{pdf}" rel="noopener">全文PDF</a></div>
<div class="s">書誌情報・判示事項・裁判要旨は裁判所ウェブサイトの記載です。正確な内容は全文PDFで確認してください。本ページは法的助言を提供するものではありません。</div>
</div></body></html>"""
DETAIL = {1: 2, 2: 3, 4: 4, 8: 5, 16: 6, 32: 7}
urls = []
for r in rows:
    if not (r[I["gist"]] or r[I["cgist"]]): continue  # 判示事項・要旨のない判例は内容が薄いのでページを作らない
    rid = r[I["id"]]; cat = r[I["cat"]]
    dn = next((DETAIL[b] for b in (1, 2, 4, 8, 16, 32) if cat & b), 4)
    sid = str(rid).zfill(6)
    gist, cgist, law, ex = r[I["gist"]], r[I["cgist"]], r[I["law"]], r[I["ex"]]
    desc = cut((gist or cgist or ex or title_of(r)).replace("\n", " "), 150)
    body = ""
    if gist: body += f"<h2>判示事項</h2><p>{E(gist)}</p>"
    if cgist: body += f"<h2>裁判要旨</h2><p>{E(cgist)}</p>"
    if law: body += f"<h2>参照法条</h2><p>{E(law)}</p>"
    if ex and not gist and not cgist: body += f"<h2>主文（冒頭抜粋）</h2><p>{E(ex)}</p>"
    if r[I["ocourt"]]: body += f"<h2>原審</h2><p>{E(r[I['ocourt']])} {E(r[I['onum']])} {E(wareki(r[I['odate']]))}</p>"
    page = TPL.format(title=E(title_of(r)), name=E(NAME), desc=E(desc), url=f"{SITE}p/{rid}.html", site=SITE, id=rid,
                      court=E(r[I["court"]]), date=E(wareki(r[I["date"]])), num=("　" + E(r[I["num"]])) if r[I["num"]] else "",
                      result=("　" + E(r[I["result"]])) if r[I["result"]] else "", rep=("　" + E(r[I["rep"]])) if r[I["rep"]] else "",
                      body=body, detail=f"https://www.courts.go.jp/app/hanrei_jp/detail{dn}?id={rid}", pdf=f"https://www.courts.go.jp/app/files/hanrei_jp/{sid[-3:]}/{sid}_hanrei.pdf")
    open(os.path.join(OUT, "p", f"{rid}.html"), "w", encoding="utf-8").write(page)
    urls.append((f"{SITE}p/{rid}.html", r[I["date"]]))
# サイトマップ
today = datetime.date.today().isoformat()
CH = 10000; parts = []
for i in range(0, len(urls), CH):
    chunk = urls[i:i + CH]; fn = f"sitemap-{i // CH + 1}.xml"; parts.append(fn)
    with open(os.path.join(OUT, fn), "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')
        for u, d in chunk: f.write(f"<url><loc>{E(u)}</loc></url>\n")
        f.write("</urlset>\n")
with open(os.path.join(OUT, "sitemap.xml"), "w", encoding="utf-8") as f:
    f.write('<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')
    f.write(f"<sitemap><loc>{SITE}sitemap-top.xml</loc><lastmod>{today}</lastmod></sitemap>\n")
    for fn in parts: f.write(f"<sitemap><loc>{SITE}{fn}</loc><lastmod>{today}</lastmod></sitemap>\n")
    f.write("</sitemapindex>\n")
with open(os.path.join(OUT, "sitemap-top.xml"), "w", encoding="utf-8") as f:
    f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')
    f.write(f"<url><loc>{SITE}</loc><lastmod>{today}</lastmod></url>\n<url><loc>{SITE}terms.html</loc></url>\n</urlset>\n")
print(f"_site: {len(urls)} case pages, {len(parts)} sitemaps -> {OUT}")
