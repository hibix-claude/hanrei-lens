<script>
(function(){
"use strict";
const $ = (s, r) => (r || document).querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const fmtN = n => Number(n).toLocaleString("ja-JP");
const DATA_VERSION = "__VERSION__";
const IN_CLAUDE = !!(window.claude && typeof window.claude.use === "function");

// ---------- 表記の正規化（検索語と収録テキストの両方に同じ規則を適用） ----------
//OLDMAP//
const RE_OLD = new RegExp("[" + Object.keys(OLDMAP).join("") + "]", "g"), RE_OLD_T = new RegExp("[" + Object.keys(OLDMAP).join("") + "]");
const KDIG = { "〇": 0, "零": 0, "一": 1, "壱": 1, "二": 2, "弐": 2, "三": 3, "参": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
const KUNIT = { "十": 10, "拾": 10, "百": 100, "千": 1000 };
function kanji2num(s){
  if (!/[十拾百千万]/.test(s)) { let o = ""; for (const ch of s) { if (!(ch in KDIG)) return null; o += KDIG[ch]; } return o; }
  let total = 0, sec = 0, num = -1;
  for (const ch of s) {
    if (ch in KDIG) num = KDIG[ch];
    else if (ch in KUNIT) { sec += (num < 0 ? 1 : num) * KUNIT[ch]; num = -1; }
    else if (ch === "万") { total += ((sec + (num < 0 ? 0 : num)) || 1) * 10000; sec = 0; num = -1; }
    else return null;
  }
  return String(total + sec + (num < 0 ? 0 : num));
}
const KN = "[〇零一壱二弐三参四五六七八九十拾百千万]+";
const RE_KN_T = /[〇零一壱二弐三参四五六七八九十拾百千万]/;
const RE_KN1 = new RegExp("第(" + KN + ")", "g");
const RE_KN2 = new RegExp("(" + KN + ")(?=[条項号年月日巻頁編章節款目審級回件名人割倍円歳個株通筆台枚度期段種類点])", "g");
const RE_KN3 = new RegExp("([条項号])の(" + KN + ")", "g");
function knum(s){
  if (!RE_KN_T.test(s)) return s;
  return s.replace(RE_KN1, (m, a) => { const n = kanji2num(a); return n === null ? m : "第" + n; })
          .replace(RE_KN2, m => { const n = kanji2num(m); return n === null ? m : n; })
          .replace(RE_KN3, (m, c, a) => { const n = kanji2num(a); return n === null ? m : c + "の" + n; });
}
function norm(s){
  let t = (s || "").normalize("NFKC").toLowerCase();
  if (RE_OLD_T.test(t)) t = t.replace(RE_OLD, ch => OLDMAP[ch]);
  return knum(t);
}
// 数字の表記（全角・漢数字・元）を数値に
function jnum(s){ if (!s) return NaN; s = s.normalize("NFKC"); if (s === "元") return 1; if (/^\d+$/.test(s)) return +s; const k = kanji2num(s); return k === null ? NaN : +k; }
// 法令の略称（どちらの表記でも探す）
const SYN = [["刑訴法","刑事訴訟法"],["民訴法","民事訴訟法"],["民執法","民事執行法"],["民保法","民事保全法"],["労基法","労働基準法"],["労契法","労働契約法"],["労組法","労働組合法"],["独禁法","独占禁止法"],["行訴法","行政事件訴訟法"],["行手法","行政手続法"],["行審法","行政不服審査法"],["国賠法","国家賠償法"],["地自法","地方自治法"],["会更法","会社更生法"],["民再法","民事再生法"],["不競法","不正競争防止法"],["消契法","消費者契約法"],["景表法","景品表示法"],["個情法","個人情報保護法"],["入管法","出入国管理及び難民認定法"],["道交法","道路交通法"],["銃刀法","銃砲刀剣類所持等取締法"],["公選法","公職選挙法"],["金商法","金融商品取引法"],["税通法","国税通則法"],["地税法","地方税法"],["特商法","特定商取引に関する法律"],["割販法","割賦販売法"],["均等法","男女雇用機会均等法"],["派遣法","労働者派遣法"],["安衛法","労働安全衛生法"],["労災保険法","労働者災害補償保険法"],["健保法","健康保険法"],["国年法","国民年金法"],["厚年法","厚生年金保険法"],["生保法","生活保護法"],["児福法","児童福祉法"],["日本国憲法","憲法"],["覚せい剤","覚醒剤"],["麻薬取締法","麻薬及び向精神薬取締法"],["売防法","売春防止法"],["軽犯法","軽犯罪法"],["建基法","建築基準法"],["都計法","都市計画法"],["区画整理法","土地区画整理法"],["収用法","土地収用法"],["所税法","所得税法"],["法税法","法人税法"],["消税法","消費税法"],["相税法","相続税法"],["税徴法","国税徴収法"],["借地法","借地借家法"],["民訴規","民事訴訟規則"],["刑訴規","刑事訴訟規則"]].map(([a, b]) => [norm(a), norm(b)]);

const CATS = [
  { bit: 1, label: "最高裁判例集", short: "最高裁", detail: 2 },
  { bit: 2, label: "高裁判例集", short: "高裁", detail: 3 },
  { bit: 4, label: "下級裁裁判例", short: "下級裁", detail: 4 },
  { bit: 8, label: "行政事件裁判例", short: "行政", detail: 5 },
  { bit: 16, label: "労働事件裁判例", short: "労働", detail: 6 },
  { bit: 32, label: "知的財産裁判例", short: "知財", detail: 7 },
  { bit: 64, label: "解説つき", short: "解説", detail: 0, ed: true }
];
const ED_BIT = 64;
const AREAS = [{ bit: 1, label: "民事" }, { bit: 2, label: "刑事" }, { bit: 4, label: "行政" }, { bit: 8, label: "労働" }, { bit: 16, label: "知的財産" }, { bit: 32, label: "家事" }, { bit: 64, label: "憲法" }, { bit: 128, label: "少年" }];
const AREA_BIT = Object.fromEntries(AREAS.map(a => [a.label, a.bit]));
const COURT_GROUPS = ["最高裁大法廷", "最高裁小法廷", "高等裁判所", "地方裁判所", "家庭裁判所", "簡易裁判所", "大審院"];
const FILES = ["data/cases-a.txt", "data/cases-b.txt", "data/cases-c.txt"]; // gzip を base64 で格納（data/ に無ければ同じ階層も探す）
const PAGE = 50;

// ---------- 和暦 ----------
function wareki(iso){
  if (!iso) return "";
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10);
  let era, n;
  if (iso >= "2019-05-01") { era = "令和"; n = y - 2018; }
  else if (iso >= "1989-01-08") { era = "平成"; n = y - 1988; }
  else if (iso >= "1926-12-25") { era = "昭和"; n = y - 1925; }
  else if (iso >= "1912-07-30") { era = "大正"; n = y - 1911; }
  else { era = "明治"; n = y - 1867; }
  return `${era}${n === 1 ? "元" : n}年${m}月${d}日`;
}
const ERA_BASE = { 明治: 1867, 大正: 1911, 昭和: 1925, 平成: 1988, 令和: 2018 };
function isoOf(era, y, m, d){ y = jnum(y); m = jnum(m); d = jnum(d); if (!(era in ERA_BASE) || !y || !m || !d || m > 12 || d > 31) return ""; return `${ERA_BASE[era] + y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
function courtGroup(c){
  if (c.includes("最高裁判所大法廷")) return "最高裁大法廷";
  if (c.includes("最高裁判所")) return "最高裁小法廷";
  if (c.includes("高等裁判所")) return "高等裁判所";
  if (c.includes("地方裁判所")) return "地方裁判所";
  if (c.includes("家庭裁判所")) return "家庭裁判所";
  if (c.includes("簡易裁判所")) return "簡易裁判所";
  if (c.includes("大審院")) return "大審院";
  return "その他";
}
// 裁判所名から部名を除いたキー（支部・法廷は残す）
function courtKey(c){
  c = (c || "").replace(/\s+/g, "");
  let m = c.match(/^最高裁判所(大法廷|第[一二三]小法廷)?/); if (m) return m[0];
  m = c.match(/^(.*?裁判所)(.*?支部)?/); return m ? m[1] + (m[2] || "") : c;
}
function shortCite(r){
  const k = r.kind === "決定" ? "決" : "判";
  const c = r.court || "";
  if (c.includes("最高裁判所大法廷")) return "最大" + k;
  if (c.includes("最高裁判所")) return "最" + k;
  if (c.includes("大審院")) return (c.includes("連合") ? "大連" : "大") + k;
  if (c.includes("知的財産高等裁判所")) return "知財高" + k;
  const m = c.match(/^(.+?)(高等|地方|家庭|簡易)裁判所/);
  if (m) return m[1] + { 高等: "高", 地方: "地", 家庭: "家", 簡易: "簡" }[m[2]] + k;
  return c + k;
}
const catLabels = mask => CATS.filter(c => (mask & c.bit) && !c.ed).map(c => c.short);
const areaLabels = mask => AREAS.filter(a => mask & a.bit).map(a => a.label);
function detailUrl(r){ if (typeof r.id !== "number") return ""; const c = CATS.find(c => (r.cat & c.bit) && c.detail); return c ? `https://www.courts.go.jp/app/hanrei_jp/detail${c.detail}?id=${r.id}` : ""; }
function pdfUrl(r){ if (typeof r.id !== "number") return ""; const s = String(r.id).padStart(6, "0"); return `https://www.courts.go.jp/app/files/hanrei_jp/${s.slice(-3)}/${s}_hanrei.pdf`; }
// 事件番号の符号から分野を推定（民事＝カタカナ、刑事＝ひらがな、行政＝「行」、家事＝「家」）
function areaMask(r){
  let m = 0;
  const sm = (r.num || "").match(/\(([^)]+)\)/); const sym = sm ? sm[1] : "";
  if (sym) {
    if (/^行/.test(sym)) m |= 4;
    else if (/^家/.test(sym) || sym === "タ" || /^人/.test(sym)) m |= 32;
    else if (/^少/.test(sym)) m |= 128;
    else if (/^[ぁ-ん]/.test(sym)) m |= 2;
    else if (/^[ァ-ヶ]/.test(sym) || /^(受|許)/.test(sym)) m |= 1;
  }
  if (r.cat & 8) m |= 4; if (r.cat & 16) m |= 8; if (r.cat & 32) m |= 16;
  if (r.field === "労働") m |= 8; if (r.field === "行政") m |= 4;
  if (r.law && /憲法/.test(r.law)) m |= 64;
  if (r.ed) r.ed.areas.forEach(a => { const b = AREA_BIT[a === "家族" ? "家事" : a]; if (b) m |= b; });
  return m;
}

// ---------- データ ----------
const ALL = []; const byId = new Map(); const byNum = new Map(); const byONum = new Map(); const byDate = new Map();
const EDIT = new Map(); CASES.forEach(c => { if (c.lid) EDIT.set(c.lid, c); });
const SEGW = [6, 8, 1, 3, 2, 3, 1, 1, 9, 4]; // name, num, court, gist, cgist, law, rep, ex, ed name, ed text
function index(r){
  const segs = [r.name, r.num, r.court, r.gist, r.cgist, r.law, r.rep, r.ex, r.ed ? r.ed.name : "", r.ed ? r.ed.tags.join(" ") + " " + r.ed.summary + " " + r.ed.laws.join(" ") : ""];
  const b = []; let s = "";
  for (let i = 0; i < segs.length; i++) { if (i) s += "\u0001"; b.push(s.length); s += norm(segs[i]); }
  r.hay = s; r.b = b;
  r.ck = courtKey(r.court); r.ckn = norm(r.ck); r.am = areaMask(r);
  if (r.num) { const k = norm(r.num); let l = byNum.get(k); if (!l) byNum.set(k, l = []); l.push(r); }
  if (r.onum) { const k = norm(r.onum); let l = byONum.get(k); if (!l) byONum.set(k, l = []); l.push(r); }
  if (r.date) { let l = byDate.get(r.date); if (!l) byDate.set(r.date, l = []); l.push(r); }
}
function makeRec(a){
  const r = { id: a[0], cat: a[1], num: a[2], name: a[3], court: a[4], date: a[5], kind: a[6], result: a[7], gist: a[8], cgist: a[9], law: a[10], rep: a[11], ocourt: a[12], onum: a[13], odate: a[14], right: a[15], ltype: a[16], field: a[17], ex: a[18], hastext: a[19], ed: null, year: +a[5].slice(0, 4), cg: courtGroup(a[4]), hay: "", b: null, ck: "", ckn: "", am: 0, dup: null, main: true };
  const e = EDIT.get(r.id); if (e) { r.ed = e; r.cat |= ED_BIT; }
  return r;
}
let edSeq = 0;
function makeEditorialRec(c){
  return { id: "e" + (++edSeq), cat: ED_BIT, num: c.caseNo, name: c.name, court: c.court + (c.bench ? c.bench : ""), date: c.date, kind: c.kind, result: c.result, gist: c.holdings, cgist: "", law: c.laws.join("，"), rep: c.reporter, ocourt: "", onum: "", odate: "", right: "", ltype: "", field: "", ex: "", hastext: 0, ed: c, year: +c.date.slice(0, 4), cg: courtGroup(c.court), hay: "", b: null, ck: "", ckn: "", am: 0, dup: null, main: true };
}
// 同一判決の別収録（事件番号＋裁判年月日が同じもの）を束ねる
function buildDupGroups(){
  const groups = new Map();
  for (const r of ALL) { if (!r.num || !r.date) continue; const k = norm(r.num) + "|" + r.date; let g = groups.get(k); if (!g) groups.set(k, g = []); g.push(r); }
  let n = 0;
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const score = r => (r.ed ? 1e6 : 0) + (r.gist || "").length * 2 + (r.cgist || "").length + (r.ex ? 50 : 0);
    g.sort((a, b) => score(b) - score(a) || (typeof a.id === "number" && typeof b.id === "number" ? a.id - b.id : 0));
    g.forEach((r, i) => { r.dup = g; r.main = i === 0; if (i) n++; });
  }
  return n;
}
const load = { total: 65468, done: 0, files: 0, finished: false, failed: false, reason: "", dups: 0 };
const loadbar = $("#loadbar"), loadfill = $("#loadfill"), loadtext = $("#loadtext");
function setLoad(){
  const pct = load.finished ? 100 : Math.min(99, Math.round(load.done / load.total * 100));
  loadfill.style.width = pct + "%";
  if (load.failed) {
    loadbar.classList.add("err");
    if (load.reason === "nogzip") loadtext.textContent = "お使いのブラウザは対応していません（Chrome 80以降・Safari 16.4以降・Firefox 113以降・Edge で開いてください）。";
    else if (load.reason === "file") loadtext.textContent = "HTMLファイルを直接開いているためデータを読み込めません。単一ファイル版（hanrei-lens-standalone.html）を使うか、Webサーバー経由で開いてください。";
    else loadtext.textContent = load.done ? `一部のデータを読み込めませんでした（${fmtN(load.done)} 件で検索できます）` : "裁判例データを読み込めませんでした。ページを再読み込みしてください。";
    return;
  }
  if (load.finished) { loadbar.classList.add("done"); loadtext.textContent = `${fmtN(ALL.length)} 件の裁判例を読み込みました`; setTimeout(() => { loadbar.hidden = true; }, 2500); return; }
  loadtext.textContent = `裁判例データを読み込んでいます… ${fmtN(load.done)} / ${fmtN(load.total)} 件`;
}
function b64ToRows(b64){
  const bin = atob(b64.replace(/\s+/g, "")); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text().then(t => JSON.parse(t));
}
async function fetchRows(url, idx){
  if (typeof DecompressionStream !== "function") throw new Error("nogzip");
  const inline = document.getElementById("hanrei-data-" + "abc"[idx]);
  if (inline) { const t = inline.textContent; inline.textContent = ""; return b64ToRows(t); }
  if (location.protocol === "file:") throw new Error("file");
  const v = DATA_VERSION.startsWith("__") ? "" : "?v=" + encodeURIComponent(DATA_VERSION);
  let res = await fetch(url + v);
  if (res.status === 404 && url.includes("/")) res = await fetch(url.slice(url.lastIndexOf("/") + 1) + v);
  if (!res.ok) throw new Error("HTTP " + res.status);
  const total = +res.headers.get("content-length") || 0; let got = 0; const parts = [];
  const reader = res.body.getReader(); const dec = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    got += value.byteLength; parts.push(dec.decode(value, { stream: true }));
    if (total) loadfill.style.width = Math.min(99, Math.round((load.done / load.total + got / total / FILES.length) * 100)) + "%";
  }
  parts.push(dec.decode());
  return b64ToRows(parts.join(""));
}
const yieldNow = () => new Promise(r => setTimeout(r, 0));
async function loadAll(){
  for (let fi = 0; fi < FILES.length; fi++) {
    let data;
    try { data = await fetchRows(FILES[fi], fi); }
    catch (e) { load.failed = true; load.reason = e && e.message; setLoad(); continue; }
    const rows = data.rows; load.total = data.total || load.total;
    for (let i = 0; i < rows.length; i++) {
      const r = makeRec(rows[i]); index(r); ALL.push(r); byId.set(String(r.id), r);
      if (i % 2000 === 1999) { load.done = ALL.length; setLoad(); await yieldNow(); }
    }
    load.done = ALL.length; load.files++; setLoad();
    runSearch(true);
    if (pendingId && byId.has(pendingId)) { select(pendingId, true); pendingId = null; }
    else if (!state.selected && !pendingId && state.results.length && !isNarrow()) select(state.results[0].id, false);
    if (state.view === "saved") renderSaved();
  }
  // 編集収録（裁判所サイト未掲載）の判例を追加
  CASES.filter(c => !c.lid).forEach(c => { const r = makeEditorialRec(c); index(r); ALL.push(r); byId.set(String(r.id), r); });
  ALL.sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  load.dups = buildDupGroups();
  load.finished = true; load.done = ALL.length; setLoad();
  $("#brandSub").textContent = `裁判所ウェブサイト掲載 ${fmtN(ALL.length - CASES.filter(c => !c.lid).length)} 件を横断検索`;
  fillAbout(); fillCourtList();
  runSearch(true);
  if (pendingId && byId.has(pendingId)) select(pendingId, true);
  pendingId = null;
  if (!state.selected && state.results.length && !isNarrow()) select(state.results[0].id, false);
  else if (state.selected) { const r = byId.get(state.selected); if (r) renderDetail(r); }
  if (state.view === "saved") renderSaved();
}
function fillAbout(){
  const counts = CATS.map(c => [c, ALL.filter(r => r.cat & c.bit).length]);
  const items = { 1: "判示事項・裁判要旨・参照法条・判例集等・原審", 2: "判示事項・原審", 4: "判示事項（一部）・主文冒頭", 8: "判示事項・裁判要旨（一部）・主文冒頭", 16: "分野・主文冒頭", 32: "権利種別・訴訟類型・主文冒頭", 64: "通称・編集要約・キーワード（編集部作成）" };
  $("#aboutCats").innerHTML = counts.map(([c, n]) => `<tr><td>${esc(c.label)}</td><td class="num">${fmtN(n)}</td><td>${esc(items[c.bit] || "")}</td></tr>`).join("");
  $("#aboutTotal").textContent = fmtN(ALL.filter(r => typeof r.id === "number").length);
  $("#aboutEd").textContent = fmtN(CASES.length);
}
function fillCourtList(){
  const cnt = new Map(); ALL.forEach(r => { if (r.ck) cnt.set(r.ck, (cnt.get(r.ck) || 0) + 1); });
  const list = [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 400);
  $("#courtList").innerHTML = list.map(([k, n]) => `<option value="${esc(k)}">${fmtN(n)} 件</option>`).join("");
}

// ---------- 設定・履歴 ----------
const SETTINGS_KEY = "hanrei-lens:settings", HIST_KEY = "hanrei-lens:hist";
let settings = { theme: "auto", font: "m", dedupe: true, facets: true };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {}); } catch (e) {}
function saveSettings(){ try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {} }
let hist = { queries: [], viewed: [], searches: [] };
try { Object.assign(hist, JSON.parse(localStorage.getItem(HIST_KEY) || "{}") || {}); } catch (e) {}
function saveHist(){ try { localStorage.setItem(HIST_KEY, JSON.stringify(hist)); } catch (e) {} }
function pushUnique(list, item, key, max){ const k = key(item); const i = list.findIndex(x => key(x) === k); if (i >= 0) list.splice(i, 1); list.unshift(item); if (list.length > max) list.length = max; }
function recordQuery(q){ q = (q || "").trim(); if (!q) return; pushUnique(hist.queries, q, x => x, 30); saveHist(); }
function recordViewed(id){ pushUnique(hist.viewed, { id: String(id), at: Date.now() }, x => x.id, 50); saveHist(); }

// ---------- 状態 ----------
const state = { q: "", groups: [], neg: [], cats: new Set(), areas: new Set(), court: "", courtName: "", kind: "", result: "", from: "", to: "", date: "", sort: "rel", view: "search", selected: null, results: [], shown: PAGE, loose: new Set(), hiddenDups: 0 };
const KEY = "hanrei-lens:saved";
let saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { saved = {}; }
function persist(){ try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) {} }

// ---------- 検索 ----------
const PART = /[のにをがはと・]/g, PART_T = /[のにをがはと・]/;
function tokenize(q){
  const out = []; const re = /"([^"]*)"|「([^」]*)」|(\S+)/g; let m;
  while ((m = re.exec(q))) { const t = m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]; if (t && t.trim()) out.push({ t: t.trim(), phrase: m[3] === undefined }); }
  return out;
}
function expand(t){ const v = new Set([t]); for (const [a, b] of SYN) { if (t.includes(a)) v.add(t.split(a).join(b)); if (t.includes(b)) v.add(t.split(b).join(a)); } return [...v]; }
function parseQuery(q){
  const groups = [], neg = []; let orNext = false;
  for (const tok of tokenize(norm(q))) {
    const t = tok.t;
    if (!tok.phrase && t === "or") { orNext = true; continue; }
    if (!tok.phrase && t.length > 1 && t[0] === "-") { neg.push(t.slice(1)); continue; }
    if (!tok.phrase && (t === "-" || t === "|")) continue;
    const alts = (tok.phrase ? [t] : t.split("|").filter(Boolean)).flatMap(expand);
    if (orNext && groups.length) groups[groups.length - 1].push(...alts); else groups.push(alts);
    orNext = false;
  }
  return { groups: groups.map(g => [...new Set(g)]), neg };
}
function segOf(b, pos){ let s = 0; for (let i = 1; i < b.length; i++) { if (b[i] <= pos) s = i; else break; } return s; }
function scoreRec(r){
  const hay = r.hay;
  for (const n of state.neg) if (hay.includes(n)) return -1;
  let s = 0;
  for (const g of state.groups) {
    let w = 0;
    for (const t of g) { let i = 0; while ((i = hay.indexOf(t, i)) !== -1) { w += SEGW[segOf(r.b, i)]; i += t.length; } }
    if (!w) return -1; s += w;
  }
  return s + (r.ed ? 2 : 0);
}
function passFilters(r, mask, amask, from, to, cn){
  if (mask && !(r.cat & mask)) return false;
  if (amask && !(r.am & amask)) return false;
  if (state.court && r.cg !== state.court) return false;
  if (cn && !r.ckn.includes(cn)) return false;
  if (state.kind && r.kind !== state.kind) return false;
  if (state.result && r.result !== state.result) return false;
  if (state.date && r.date !== state.date) return false;
  if (r.year < from || r.year > to) return false;
  return true;
}
function runSearch(keepShown){
  const p = parseQuery(state.q); state.groups = p.groups; state.neg = p.neg; state.loose = new Set(); state.hiddenDups = 0;
  const from = state.from ? +state.from : -Infinity, to = state.to ? +state.to : Infinity;
  let mask = 0; state.cats.forEach(b => { mask |= b; });
  let amask = 0; state.areas.forEach(b => { amask |= b; });
  const cn = norm(state.courtName).replace(/\s+/g, "");
  const hasTerms = state.groups.length > 0;
  const dedupe = settings.dedupe && load.finished;
  const rows = [];
  for (let i = 0; i < ALL.length; i++) {
    const r = ALL[i];
    if (!passFilters(r, mask, amask, from, to, cn)) continue;
    let s = 0;
    if (hasTerms || state.neg.length) { s = scoreRec(r); if (s < 0) continue; }
    if (dedupe && r.dup && !r.main) { state.hiddenDups++; continue; }
    rows.push([r, s]);
  }
  // 「権利の濫用」を「権利濫用」でも拾う緩い一致（結果が少ないときだけ）
  if (hasTerms && rows.length < 30 && state.groups.some(g => g.some(t => PART_T.test(t) || t.length >= 4))) {
    const lg = state.groups.map(g => g.map(t => t.replace(PART, "")).filter(t => t.length >= 2)).filter(g => g.length);
    if (lg.length === state.groups.length) {
      const seen = new Set(rows.map(x => x[0].id));
      for (let i = 0; i < ALL.length; i++) {
        const r = ALL[i]; if (seen.has(r.id) || !passFilters(r, mask, amask, from, to, cn)) continue;
        if (dedupe && r.dup && !r.main) continue;
        if (state.neg.some(n => r.hay.includes(n))) continue;
        const h = r.hay.replace(PART, "");
        if (lg.every(g => g.some(t => h.includes(t)))) { rows.push([r, 1]); state.loose.add(r.id); }
      }
    }
  }
  const byDateCmp = (a, b) => a[0].date < b[0].date ? 1 : a[0].date > b[0].date ? -1 : 0;
  if (state.sort === "new") { if (hasTerms) rows.sort(byDateCmp); }
  else if (state.sort === "old") rows.sort((a, b) => -byDateCmp(a, b));
  else if (hasTerms) rows.sort((a, b) => (b[1] - a[1]) || byDateCmp(a, b));
  state.results = rows.map(x => x[0]);
  if (!keepShown) state.shown = PAGE;
  renderResults();
  renderFacets();
  pushHash();
}

// ---------- 表示補助 ----------
const allTerms = () => state.groups.flat();
const toKanjiDigits = d => [...d].map(c => "〇一二三四五六七八九"[+c]).join("");
const toWideDigits = d => [...d].map(c => "０１２３４５６７８９"[+c]).join("");
function hl(text){
  let out = esc(text);
  const terms = allTerms(); if (!terms.length) return out;
  const vs = new Set();
  for (const t of terms) { vs.add(t); if (/\d/.test(t)) { vs.add(t.replace(/\d+/g, toKanjiDigits)); vs.add(t.replace(/\d+/g, toWideDigits)); } }
  const pat = [...vs].map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length).join("|");
  if (!pat) return out;
  try { out = out.replace(new RegExp("(" + pat + ")", "gi"), "<mark>$1</mark>"); } catch (e) {}
  return out;
}
function snippet(r){
  const cands = [r.gist, r.cgist, r.ed ? r.ed.summary : "", r.ex];
  const terms = allTerms();
  if (terms.length) {
    for (const c of cands) {
      if (!c) continue; const nc = norm(c);
      const t = terms.find(t => nc.includes(t));
      if (t) { const i = Math.max(0, nc.indexOf(t) - 40); const s = (i > 0 ? "…" : "") + c.slice(i, i + 130) + (i + 130 < c.length ? "…" : ""); return { html: hl(s), cls: "snip summ" }; }
    }
  }
  const b = cands.find(Boolean) || "";
  return { html: hl(b.slice(0, 160)) + (b.length > 160 ? "…" : ""), cls: "snip" };
}
function titleOf(r){
  if (r.ed) return r.ed.name;
  if (r.name) return r.name;
  const b = (r.gist || r.cgist || r.ex || "").replace(/^主文\s*/, "");
  return b ? b.slice(0, 40) + (b.length > 40 ? "…" : "") : "（事件名の記載なし）";
}
function metaHtml(r){
  const cats = catLabels(r.cat); const areas = areaLabels(r.am).slice(0, 3);
  return `<div class="meta">${cats.length ? `<span class="cat">${cats.map(esc).join(" · ")}</span>` : ""}${areas.length ? `<span>${areas.map(esc).join("・")}</span>` : ""}${r.ed ? `<span class="badge">解説</span>` : ""}<span>${esc(r.court)}</span><span>${esc(wareki(r.date))}</span>${r.kind ? `<span>${esc(r.kind)}</span>` : ""}${r.result ? `<span>${esc(r.result)}</span>` : ""}${r.num ? `<span>${hl(r.num)}</span>` : ""}${r.dup && settings.dedupe ? `<span class="badge" style="background:var(--panel-2);color:var(--muted)">別収録 ${r.dup.length - 1}</span>` : ""}${state.loose.has(r.id) ? `<span class="badge" style="background:var(--panel-2);color:var(--muted)">近い表現</span>` : ""}</div>`;
}

// ---------- 一覧 ----------
const resultList = $("#resultList"), moreBtn = $("#moreBtn");
function rowHtml(r, withMemo){
  const sid = String(r.id); const memo = saved[sid] && saved[sid].memo;
  return `<li class="row${state.selected === sid ? " sel" : ""}" data-id="${esc(sid)}" tabindex="0" role="button" aria-label="${esc(titleOf(r))}">
    ${metaHtml(r)}
    <div class="ttl">${hl(titleOf(r))}${r.ed && r.name ? `<span class="alias">${hl(r.name)}</span>` : ""}</div>
    <button type="button" class="star${saved[sid] ? " on" : ""}" data-star="${esc(sid)}" aria-label="${saved[sid] ? "保存を解除" : "保存する"}">${saved[sid] ? "★" : "☆"}</button>
    ${withMemo && memo ? `<div class="memo-prev">${esc(memo)}</div>` : (() => { const s = snippet(r); return s.html ? `<div class="${s.cls}">${s.html}</div>` : ""; })()}
  </li>`;
}
function renderResults(){
  $("#resultCount").textContent = fmtN(state.results.length);
  $("#resultQuery").textContent = state.q.trim() ? `「${state.q.trim()}」` : "";
  $("#srcLabel").textContent = load.finished ? `裁判所ウェブサイト 2025年1月時点 · ${fmtN(ALL.length)} 件` : (ALL.length ? `読み込み中 · ${fmtN(ALL.length)} 件で検索` : "");
  const dc = $("#dateChip"); dc.hidden = !state.date; if (state.date) $("#dateChipText").textContent = "日付: " + wareki(state.date);
  $("#dupNote").textContent = state.hiddenDups ? `（同一判決の別収録 ${fmtN(state.hiddenDups)} 件をまとめて表示）` : "";
  if (!state.results.length) {
    resultList.innerHTML = ALL.length ? `<li class="empty"><b>該当する判例がありません</b>語句を減らす、絞り込みを外す、OR検索（A OR B）に変える、事件番号を「平成28(受)2099」の形式で入力する、などをお試しください。</li>` : `<li class="empty"><b>裁判例データを読み込んでいます</b>数秒お待ちください。</li>`;
    moreBtn.hidden = true; return;
  }
  const slice = state.results.slice(0, state.shown);
  resultList.innerHTML = slice.map(r => rowHtml(r, false)).join("");
  moreBtn.hidden = state.results.length <= state.shown;
  moreBtn.textContent = `さらに表示（残り ${fmtN(state.results.length - state.shown)} 件）`;
}
moreBtn.addEventListener("click", () => {
  const start = state.shown; state.shown += PAGE;
  const frag = state.results.slice(start, state.shown).map(r => rowHtml(r, false)).join("");
  resultList.insertAdjacentHTML("beforeend", frag);
  moreBtn.hidden = state.results.length <= state.shown;
  moreBtn.textContent = `さらに表示（残り ${fmtN(Math.max(0, state.results.length - state.shown))} 件）`;
});
// 検索結果の内訳（ファセット）
function renderFacets(){
  const box = $("#facets");
  if (!settings.facets || !state.results.length || !load.finished) { box.hidden = true; return; }
  const cc = new Map(), ac = new Map(), gc = new Map(), dc = new Map();
  for (const r of state.results) {
    for (const c of CATS) if (r.cat & c.bit) cc.set(c.bit, (cc.get(c.bit) || 0) + 1);
    for (const a of AREAS) if (r.am & a.bit) ac.set(a.bit, (ac.get(a.bit) || 0) + 1);
    gc.set(r.cg, (gc.get(r.cg) || 0) + 1);
    const d = Math.floor(r.year / 10) * 10; dc.set(d, (dc.get(d) || 0) + 1);
  }
  const btn = (f, v, label, n, on) => `<button type="button" class="facet${on ? " on" : ""}" data-f="${f}" data-v="${esc(String(v))}">${esc(label)}<b>${fmtN(n)}</b></button>`;
  const rows = [];
  rows.push(`<div class="fg"><span class="fl">判例集</span>${CATS.filter(c => cc.get(c.bit)).map(c => btn("cat", c.bit, c.label, cc.get(c.bit), state.cats.has(c.bit))).join("")}</div>`);
  rows.push(`<div class="fg"><span class="fl">分野</span>${AREAS.filter(a => ac.get(a.bit)).map(a => btn("area", a.bit, a.label, ac.get(a.bit), state.areas.has(a.bit))).join("")}</div>`);
  rows.push(`<div class="fg"><span class="fl">裁判所</span>${COURT_GROUPS.filter(g => gc.get(g)).map(g => btn("cg", g, g, gc.get(g), state.court === g)).join("")}</div>`);
  const decades = [...dc.keys()].sort((a, b) => a - b);
  rows.push(`<div class="fg"><span class="fl">年代</span>${decades.map(d => btn("dec", d, `${d}年代`, dc.get(d), state.from === String(d) && state.to === String(d + 9))).join("")}</div>`);
  box.innerHTML = rows.join(""); box.hidden = false;
}
$("#facets").addEventListener("click", e => {
  const b = e.target.closest(".facet"); if (!b) return;
  const f = b.dataset.f, v = b.dataset.v;
  if (f === "cat") { const bit = +v; if (state.cats.has(bit)) state.cats.delete(bit); else state.cats.add(bit); }
  else if (f === "area") { const bit = +v; if (state.areas.has(bit)) state.areas.delete(bit); else state.areas.add(bit); }
  else if (f === "cg") state.court = state.court === v ? "" : v;
  else if (f === "dec") { const d = +v; if (state.from === String(d) && state.to === String(d + 9)) { state.from = ""; state.to = ""; } else { state.from = String(d); state.to = String(d + 9); } }
  syncFilterUi(); runSearch();
});
$("#dateChipClear").addEventListener("click", () => { state.date = ""; runSearch(); });

function renderSaved(){
  const ids = Object.keys(saved).sort((a, b) => (saved[b].at || 0) - (saved[a].at || 0));
  $("#savedTotal").textContent = ids.length;
  const list = $("#savedList");
  if (!ids.length) { list.innerHTML = `<li class="empty"><b>保存した判例はまだありません</b>一覧の ☆ か、詳細画面の「保存」から追加できます。</li>`; }
  else {
    const recs = ids.map(id => byId.get(id)).filter(Boolean);
    list.innerHTML = recs.map(r => rowHtml(r, true)).join("") + (recs.length < ids.length ? `<li class="empty">${fmtN(ids.length - recs.length)} 件はデータ読み込み後に表示されます</li>` : "");
  }
  // 保存した検索・最近の検索・最近見た判例
  const ss = $("#savedSearches");
  ss.innerHTML = hist.searches.length ? hist.searches.map((s, i) => `<li><span class="nm">${esc(s.name)}</span><button type="button" data-open-search="${i}">開く</button><button type="button" data-del-search="${i}">削除</button></li>`).join("") : `<li class="none">「この検索を保存」で追加できます。</li>`;
  const rq = $("#recentQueries");
  rq.innerHTML = hist.queries.length ? hist.queries.map(q => `<button type="button" data-q="${esc(q)}" title="${esc(q)}">${esc(q)}</button>`).join("") + `<button type="button" data-clear-q="1" style="color:var(--faint)">履歴を消す</button>` : `<span class="none">まだ検索していません。</span>`;
  const rv = $("#recentViewed");
  const vrecs = hist.viewed.map(v => byId.get(v.id)).filter(Boolean).slice(0, 15);
  rv.innerHTML = vrecs.length ? vrecs.map(r => `<li><span class="nm">${esc(titleOf(r))} <span style="color:var(--faint);font-size:12px">${esc(wareki(r.date))}</span></span><button type="button" data-open-id="${esc(String(r.id))}">開く</button></li>`).join("") : `<li class="none">まだ判例を開いていません。</li>`;
  updateSavedCount();
}
$("#savedView").addEventListener("click", e => {
  const t = e.target.closest("button"); if (!t) return;
  if (t.dataset.openSearch !== undefined) { const s = hist.searches[+t.dataset.openSearch]; if (s) { switchView("search"); applyHash(s.hash); } }
  else if (t.dataset.delSearch !== undefined) { hist.searches.splice(+t.dataset.delSearch, 1); saveHist(); renderSaved(); }
  else if (t.dataset.q !== undefined) { switchView("search"); setQuery(t.dataset.q); }
  else if (t.dataset.clearQ) { hist.queries = []; saveHist(); renderSaved(); }
  else if (t.dataset.openId) { switchView("search"); select(t.dataset.openId, true); }
});
function updateSavedCount(){ const n = Object.keys(saved).length; const el = $("#savedCount"); el.textContent = n; el.dataset.zero = n ? "0" : "1"; }

// ---------- ブックマークの書き出し・読み込み ----------
function exportItems(){
  return Object.keys(saved).sort((a, b) => (saved[b].at || 0) - (saved[a].at || 0)).map(id => {
    const r = byId.get(id);
    return { id: r && typeof r.id === "number" ? r.id : id, title: r ? titleOf(r) : "", caseNo: r ? r.num : "", court: r ? r.court : "", date: r ? r.date : "", memo: saved[id].memo || "", savedAt: new Date(saved[id].at || 0).toISOString(), url: r ? detailUrl(r) : "" };
  });
}
function exportJsonText(){ return JSON.stringify({ app: "hanrei-lens", version: 1, exported: new Date().toISOString(), items: exportItems() }, null, 2); }
function exportCsvText(){
  const q = v => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  const head = ["判例ID", "事件名", "事件番号", "裁判所", "裁判年月日", "メモ", "裁判所サイトURL", "保存日時"];
  return "﻿" + [head.map(q).join(",")].concat(exportItems().map(it => [it.id, it.title, it.caseNo, it.court, it.date, it.memo, it.url, it.savedAt].map(q).join(","))).join("\r\n");
}
let dlCap = null; // claude.ai 上では downloads 機能を使う（通常のダウンロードリンクは無効なため）
(async () => { try { dlCap = IN_CLAUDE ? await window.claude.use("downloads") : null; } catch (e) { dlCap = null; } })();
async function download(name, text, type){
  if (dlCap) { try { await dlCap.save({ filename: name, data: new Blob([text], { type }) }); return true; } catch (e) { return false; } }
  try { const blob = new Blob([text], { type }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); return true; } catch (e) { return false; }
}
function importFromText(text){
  let data; try { data = JSON.parse(text); } catch (e) { return { error: "JSONとして読み取れませんでした。" }; }
  const items = Array.isArray(data) ? data : (data && Array.isArray(data.items) ? data.items : null);
  if (!items) return { error: "ブックマークの形式ではありません（items 配列がありません）。" };
  let added = 0, updated = 0;
  for (const it of items) {
    if (!it || it.id === undefined || it.id === null) continue;
    const id = String(it.id); const memo = typeof it.memo === "string" ? it.memo : ""; const at = it.savedAt ? Date.parse(it.savedAt) || Date.now() : Date.now();
    if (!saved[id]) { saved[id] = { memo, at }; added++; }
    else if (memo && !(saved[id].memo || "").trim()) { saved[id].memo = memo; updated++; }
  }
  persist(); updateSavedCount(); renderSaved();
  return { added, updated, total: items.length };
}
(function bindIo(){
  const st = $("#ioState"), ta = $("#ioText");
  const stamp = () => new Date().toISOString().slice(0, 10);
  const hint = ok => { st.textContent = ok ? "書き出しました。ダウンロードが始まらない環境では「テキストで表示」からコピーしてください。" : "この環境ではダウンロードできません。「テキストで表示」からコピーしてください。"; };
  $("#exportJson").addEventListener("click", async () => { if (!Object.keys(saved).length) { st.textContent = "保存した判例がありません。"; return; } hint(await download(`hanrei-lens-bookmarks-${stamp()}.json`, exportJsonText(), "application/json")); });
  $("#exportCsv").addEventListener("click", async () => { if (!Object.keys(saved).length) { st.textContent = "保存した判例がありません。"; return; } hint(await download(`hanrei-lens-bookmarks-${stamp()}.csv`, exportCsvText(), "text/csv")); });
  $("#exportText").addEventListener("click", () => {
    if (!ta.hidden) { ta.hidden = true; st.textContent = ""; const b = $("#importText"); if (b) b.remove(); return; }
    ta.value = exportJsonText(); ta.hidden = false; ta.select();
    if (!$("#importText")) { const b = document.createElement("button"); b.type = "button"; b.className = "btn"; b.id = "importText"; b.textContent = "この欄の内容を読み込む"; ta.insertAdjacentElement("afterend", b); b.addEventListener("click", () => { const r = importFromText(ta.value); st.textContent = r.error || `${fmtN(r.total)} 件を読み込みました（新規 ${r.added}、メモ更新 ${r.updated}）。`; }); }
    st.textContent = "この内容をコピーして保存するか、別の端末で書き出したJSONを貼り付けて「この欄の内容を読み込む」を押してください。";
  });
  $("#importFile").addEventListener("change", ev => {
    const f = ev.target.files && ev.target.files[0]; if (!f) return;
    const fr = new FileReader(); fr.onload = () => { const r = importFromText(String(fr.result)); st.textContent = r.error || `${fmtN(r.total)} 件を読み込みました（新規 ${r.added}、メモ更新 ${r.updated}）。`; }; fr.onerror = () => { st.textContent = "ファイルを読めませんでした。"; }; fr.readAsText(f);
    ev.target.value = "";
  });
})();
