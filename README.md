# 判例レンズ — 裁判例検索アプリ

裁判所ウェブサイト「裁判例検索」に掲載されている裁判例の全件（65,468件、2025年1月時点）を、
ブラウザだけで検索・絞り込み・保存できるアプリです。サーバーもアカウントも Claude も不要です。

公開サイト: https://hibix-claude.github.io/hanrei-lens/

## 主な機能

- **全文検索**: 事件番号・事件名・判示事項・裁判要旨・参照法条・主文冒頭を対象。全角半角・漢数字・旧字体・法令略称を正規化し、AND / OR / フレーズ / 除外に対応
- **絞り込み**: 判例集・分野（民事/刑事/行政/労働/知財/家事/憲法/少年）・裁判所・裁判所名・種別・結果・年・並び順。検索結果にはファセット（分野・裁判所・年代の件数つきボタン）が出ます
- **判例引用の自動リンク**: 本文中の「平成○年(受)第○号」「最高裁昭和○年○月○日判決」などを、収録データ内の判例・その日の判例一覧へリンク
- **参照法条クリック検索**、**審級（原審・上訴審）のつながり**、**同一判決の別収録の統合**、**類似判例**（本文の文字バイグラムによる類似度）
- **解説つき判例 304件**: 憲法・民事・刑事・労働・知的財産・行政の代表判例に、通称・要約・キーワードを付与（公式データと照合済み）
- **ブックマーク・メモ・保存した検索・検索履歴・最近見た判例**（ブラウザ内に保存。JSON/CSV で書き出し・読み込み）
- **2件比較**、**キーボード操作**（`/` 検索、`j`/`k` 移動、`s` 保存、`c` 比較、`?` ヘルプ）、**ダークモード・文字サイズ**、**印刷用レイアウト**、**PWA**（ホーム画面に追加・オフライン利用）
- **AI要約・質問**（任意）: claude.ai 上ではそのまま、独立サイトでは閲覧者自身の Anthropic API キーで動作

## 使い方は3通り

### A. 単一ファイル版（いちばん簡単）

`dist/hanrei-lens-standalone.html`（約16MB）をダブルクリックするだけで動きます。
データはファイルの中に埋め込まれているので、オフラインでも使えます。

### B. フォルダ版（静的サイトとして公開）

`index.html`・`data/`・`manifest.webmanifest`・`sw.js`・アイコン・`terms.html`・`robots.txt` を、そのまま静的ホスティングに置いてください。

| 置き場所 | 手順 |
|---|---|
| GitHub Pages | 下の「C」を参照（自動ビルド・自動更新つき） |
| Netlify | https://app.netlify.com/drop にフォルダをドラッグ＆ドロップ |
| Cloudflare Pages | Pages → Create → Upload assets でフォルダをアップロード |
| レンタルサーバー等 | FTP でアップロード |
| 自分のPCで試す | このフォルダで `python3 -m http.server 8000` を実行し http://localhost:8000 を開く |

`index.html` をダブルクリックで直接開くとデータを読み込めません（ブラウザの制限）。手元で開くだけなら単一ファイル版を使ってください。

### C. GitHub Pages（GitHub Actions で自動ビルド）

このリポジトリをそのまま GitHub に置き、Settings → Pages → Source を **GitHub Actions** にすると、`.github/workflows/pages.yml` が

1. `index.html` などの配信物をコピー
2. 判例ごとの静的ページ `p/<裁判例ID>.html`（約3万ページ。判示事項・要旨のある判例のみ）と `sitemap.xml` を生成
3. GitHub Pages にデプロイ

します。`.github/workflows/update-data.yml` は毎週日曜に収集データ（japanese-law-analysis/data_set）を取り込み直し、変更があればコミットして再デプロイします。`.github/workflows/test.yml` は push のたびに Playwright で回帰テスト（`tests/smoke.js`）を走らせます。

#### 独自ドメイン（お名前.com などで取得したドメインを使う）

1. ドメインの DNS 設定で、使いたいホスト名（例 `hanrei.example.com`）の **CNAME** を `<GitHubユーザー名>.github.io` に向ける（ルートドメインを使う場合は A レコードで GitHub Pages の IP を指定）
2. リポジトリの Settings → Pages → Custom domain にそのホスト名を入力し、「Enforce HTTPS」をオンにする
3. `site.config.json` の `site_url` をそのドメインに変えて push（OGP・サイトマップ・canonical の URL に使われます）

#### 検索エンジンへの登録とアクセス解析

- Google Search Console にサイトを登録し、`https://<サイトURL>/sitemap.xml` を送信すると、判例ごとのページが検索結果に載るようになります。
- アクセス解析を入れる場合は `src/analytics.html` を作り、埋め込みタグ（Google Analytics や Cloudflare Web Analytics など）を書いてください。ビルド時に `index.html` の末尾へ挿入されます。何も置かなければ解析は入りません（プライバシーポリシーもその前提で書いてあります）。

## 収録データ

- 出典: 裁判所ウェブサイト（courts.go.jp）の裁判例検索。収集済みデータ [japanese-law-analysis/data_set](https://github.com/japanese-law-analysis/data_set)（CC0）を取り込んでいます。
- 内訳: 最高裁判例集 29,307 / 高裁判例集 4,931 / 下級裁裁判例 14,107 / 行政事件 6,154 / 労働事件 2,219 / 知的財産 14,448（重複あり、ユニーク 65,468件）
- 項目: 事件番号・事件名・裁判所・裁判年月日・結果・判例集等・原審・判示事項・裁判要旨・参照法条（付いているもののみ）・主文の冒頭（PDFから機械抽出、約240文字）
- 判決文の全文は入っていません。各判例から裁判所サイトの詳細ページと全文PDFへリンクしています。
- 解説つき判例（`src/part2.html` の `CASES`）は編集要約です。追加するときは `tools/editorial/add*.py` に候補を書き、`python3 tools/editorial/merge.py` で公式データと照合（事件番号＋年月日、または年月日＋裁判所＋本文の重なり）してから `--write` で追記します。照合できない候補は追記されません。

判決は著作権法13条3号により著作権の目的とならないため、データの再配布に法的な制約はありません。
このアプリのコード（HTML/JavaScript/Python）も自由に改変・再配布して構いません。

## 検索のしくみ

- 検索語と収録テキストは同じ規則で正規化してから比較します。全角・半角、漢数字（「二〇〇条」「第十四条」→「200条」「第14条」）、旧字体（約260字）をそろえ、「刑訴法／刑事訴訟法」などの法令略称は両方の表記で探します。
- `A B` で AND、`A OR B` または `A|B` で OR、`"語 句"` でフレーズ、`-語` で除外。
- 「分野」は事件番号の符号から機械的に推定したものです（民事＝カタカナ、刑事＝ひらがな、行政＝「行」、家事＝「家」）。誤りを含むことがあります。
- 「審級」欄は、各判例に記録された原審の裁判所名・事件番号から、収録データ内の原審・上訴審をつないだものです。
- 検索語と絞り込み条件は URL（`#q=...`）に反映されるので、そのまま共有できます。

## AI要約・質問（任意）

AI機能は使わなくても構いません。使う場合は、判例の詳細画面の「AIでやさしく読む」欄で
Anthropic の API キーを入力してください（取得先: https://platform.claude.com/ ）。

- キーはそのブラウザの localStorage にだけ保存され、api.anthropic.com に直接送信されます。サイトの運営者には送られません。
- 利用料金はキーの持ち主に課金されます。公開サイトにする場合、閲覧者が各自のキーを入れる形になります。
- claude.ai 上で開いたときは、キーなしで閲覧者の Claude アカウントで動きます。

## ビルドとテスト

```bash
# データの再生成（裁判所サイトの新しい収集データが出たとき）
git clone --depth 1 https://github.com/japanese-law-analysis/data_set
python3 tools/build_data.py data_set/precedent data      # data/cases-{a,b,c}.txt

# サイトの組み立て
python3 tools/make_site.py --artifact                     # index.html / dist/hanrei-lens-standalone.html / dist/artifact.html
python3 tools/build_pages.py                              # _site/（判例ごとのページとサイトマップ。Actions が実行するものと同じ）

# 回帰テスト
npm install playwright && npx playwright install chromium
node tests/smoke.js
```

画面の文言（「2025年1月時点」など）は `src/part1.html` に書かれているので、データ更新時に書き換えてください。

## フォルダ構成

```
index.html                 組み立て済みのアプリ本体（make_site.py が生成）
data/cases-{a,b,c}.txt     裁判例データ（gzip を base64 化したもの）
manifest.webmanifest sw.js icon-*.png og.png terms.html robots.txt .nojekyll
src/part1.html             画面・CSS・OGP
src/part2.html             解説つき判例（CASES）
src/part3_head.js oldmap.js part3_tail.js   アプリのロジック（旧字体表は oldmap.js）
src/analytics.html         （任意）アクセス解析タグ
static/                    配信する静的ファイルの元
tools/build_data.py        収集データ → data/
tools/make_site.py         src/ → index.html, dist/
tools/build_pages.py       判例ごとのページとサイトマップ
tools/editorial/           解説の追加候補と照合スクリプト
tests/smoke.js             Playwright 回帰テスト
.github/workflows/         Pages デプロイ・週次データ更新・テスト
site.config.json           サイト URL・名称
```

## 動作環境

- Chrome / Edge 80以降、Safari 16.4以降、Firefox 113以降（gzip 展開に DecompressionStream を使うため）
- 65,000件をブラウザのメモリに載せるため、約150〜200MBのメモリを使います。古いスマートフォンでは動作が重いことがあります。

## 免責

判示事項・裁判要旨は裁判所ウェブサイトの記載、主文は PDF からの機械抽出（誤変換を含むことがあります）、
解説は編集要約です。正確な内容は必ず全文 PDF で確認してください。本アプリは法的助言を提供するものではありません。
利用規約・プライバシーポリシー・お問い合わせ先は `terms.html` にあります。
