
// ---------- 詳細 ----------
const detailEl = $("#detail"), detailIn = $("#detailIn");
const chatTurns = new Map();
let aiState = "pending", sampleFn = null, currentAbort = null, simToken = 0;
const AI_COPY = {
  rate_limited: "利用が集中しています。少し時間をおいてからもう一度お試しください。",
  session_expired: "claude.ai にもう一度サインインしてからお試しください。",
  refused: "この内容には回答できませんでした。質問を変えてお試しください。",
  empty_completion: "回答が生成されませんでした。もう一度お試しください。",
  invalid_json: "回答の形式を読み取れませんでした。もう一度お試しください。",
  prompt_too_large: "内容が長すぎます。質問を短くしてお試しください。",
  upstream_error: "接続に問題がありました。もう一度お試しください。",
  auth: "APIキーが無効か、権限がありません。設定を確認してください。",
  invalid_request: "リクエストが受け付けられませんでした。モデルIDを確認してください。"
};
const AI_HIDE = new Set(["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"]);
const cut = (s, n) => s && s.length > n ? s.slice(0, n) + "…" : (s || "");
function caseContext(r){
  const lines = [
    `事件名: ${titleOf(r)}${r.ed && r.name ? `（${r.name}）` : ""}`,
    `裁判所: ${r.court}`, `裁判年月日: ${wareki(r.date)}（${r.date}）`, `事件番号: ${r.num || "（記載なし）"}`,
    r.kind ? `裁判種別: ${r.kind}` : "", r.result ? `結果: ${r.result}` : "", r.rep ? `判例集等: ${r.rep}` : "",
    r.ocourt ? `原審: ${r.ocourt} ${r.onum} ${wareki(r.odate)}` : "",
    r.gist ? `判示事項: ${cut(r.gist, 1500)}` : "", r.cgist ? `裁判要旨: ${cut(r.cgist, 2500)}` : "",
    r.law ? `参照法条: ${cut(r.law, 500)}` : "", r.ex ? `主文（冒頭抜粋）: ${r.ex}` : "",
    r.ed ? `編集部の解説（要約）: ${r.ed.summary}\nキーワード: ${r.ed.tags.join("、")}` : ""
  ].filter(Boolean);
  return lines.join("\n");
}
function summaryPrompt(r){
  return `あなたは、法律の専門家ではない一般の人に日本の裁判例をわかりやすく説明する解説者です。以下の裁判例について、次の見出しごとに日本語で答えてください。見出しはそのまま使い、全体で400字程度にしてください。\n\n【ひとことで】1文\n【なにが争われたか】2〜3文\n【裁判所の判断】2〜3文\n【この判例の意味】1〜2文（その後の実務や日常生活にどう関わるか）\n\n専門用語には短い言い換えを添えてください。事実の記述は下記の情報の範囲にとどめ、情報にないことは推測で断定しないでください。情報が書誌事項と主文しかない場合は、その旨を述べたうえで分かる範囲で説明してください。これは一般的な解説であり法的助言ではありません。\n\n${caseContext(r)}`;
}
const QA_RULES = r => `以下は日本の裁判例の情報です。ユーザーの質問に対し、この情報と一般的な法律知識の範囲で、日本語で簡潔に（200字程度まで）答えてください。判例の内容として情報にないことは「この判例の情報だけでは分かりません」と述べ、推測で断定しないでください。個別の事案への法的助言はできない旨を必要に応じて添えてください。\n\n${caseContext(r)}`;
function lawList(s){ return (s || "").split(/[，,、]\s*/).map(x => x.trim()).filter(Boolean); }

// ---------- 要旨中の判例引用をリンクに ----------
const KDN = "[0-9０-９〇零一二三四五六七八九十百千元]+";
const RE_CITE = new RegExp(
  "(明治|大正|昭和|平成|令和)(" + KDN + ")年?\\s*[(（]([^()（）\\s]{1,8})[)）]\\s*(?:第)?([0-9０-９〇零一二三四五六七八九十百千]+)(?:号)?" +
  "|(最高裁判所|最高裁|最大判|最大決|最判|最決|大審院|大判|大決|大連判|(?:[^\\s、。，,（()）]{1,5})(?:高等裁判所|高裁|地方裁判所|地裁|家庭裁判所|家裁|簡易裁判所|簡裁))\\s*(大法廷|第[一二三１２３123]小法廷)?\\s*(?:判決|決定)?\\s*(明治|大正|昭和|平成|令和)(" + KDN + ")年(" + KDN + ")月(" + KDN + ")日(?:\\s*(大法廷|第[一二三１２３123]小法廷))?" +
  "|同(" + KDN + ")年(" + KDN + ")月(" + KDN + ")日(?:\\s*(大法廷|第[一二三１２３123]小法廷))?", "g");
function cgOfCite(court, bench){
  bench = (bench || "").normalize("NFKC");
  if (/^(最大判|最大決)$/.test(court) || bench === "大法廷") return ["最高裁大法廷"];
  if (/^(最判|最決)$/.test(court) || /小法廷/.test(bench)) return ["最高裁小法廷"];
  if (/^最高裁/.test(court)) return ["最高裁大法廷", "最高裁小法廷"];
  if (/^(大審院|大判|大決|大連判)$/.test(court)) return ["大審院"];
  if (/高等裁判所|高裁/.test(court)) return ["高等裁判所"];
  if (/地方裁判所|地裁/.test(court)) return ["地方裁判所"];
  if (/家庭裁判所|家裁/.test(court)) return ["家庭裁判所"];
  if (/簡易裁判所|簡裁/.test(court)) return ["簡易裁判所"];
  return [];
}
function resolveCite(m, self, lastEra){
  if (m[12]) { // 「同２３年３月１２日大法廷判決」のように元号を省いた引用（直前の引用の元号を使う）
    if (!lastEra) return null;
    const iso = isoOf(lastEra, m[12], m[13], m[14]); if (!iso) return null;
    const groups = cgOfCite("", m[15]);
    const recs = (byDate.get(iso) || []).filter(r => r !== self && (!groups.length || groups.includes(r.cg)));
    if (!recs.length) return null;
    if (recs.length === 1) return { id: String(recs[0].id) };
    const main = recs.filter(r => r.main); if (main.length === 1) return { id: String(main[0].id) };
    return { hash: "date=" + iso + (groups.length === 1 ? "&court=" + encodeURIComponent(groups[0]) : "") };
  }
  if (m[1]) {
    const y = jnum(m[2]), n = jnum(m[4]); if (!y || !n) return null;
    const key = norm(`${m[1]}${y}(${m[3]})${n}`);
    const recs = (byNum.get(key) || []).filter(r => r !== self && !(self && r.dup && r.dup === self.dup));
    if (!recs.length) return null;
    if (recs.length === 1) return { id: String(recs[0].id) };
    return { hash: "q=" + encodeURIComponent(`${m[1]}${y}(${m[3]})${n}`) };
  }
  const iso = isoOf(m[7], m[8], m[9], m[10]); if (!iso) return null;
  const groups = cgOfCite(m[5], m[6] || m[11]);
  let recs = (byDate.get(iso) || []).filter(r => r !== self && (!groups.length || groups.includes(r.cg)));
  const pref = m[5].replace(/(高等裁判所|高裁|地方裁判所|地裁|家庭裁判所|家裁|簡易裁判所|簡裁)$/, "");
  if (pref && !/^(最高裁判所|最高裁|最大判|最大決|最判|最決|大審院|大判|大決|大連判)$/.test(m[5])) recs = recs.filter(r => r.court.startsWith(pref));
  if (!recs.length) return null;
  if (recs.length === 1) return { id: String(recs[0].id) };
  const main = recs.filter(r => r.main); if (main.length === 1) return { id: String(main[0].id) };
  return { hash: "date=" + iso + (groups.length === 1 ? "&court=" + encodeURIComponent(groups[0]) : "") };
}
function richText(text, self){
  if (!text) return "";
  let out = "", last = 0, lastEra = ""; RE_CITE.lastIndex = 0; let m;
  while ((m = RE_CITE.exec(text))) {
    out += hl(text.slice(last, m.index));
    const t = resolveCite(m, self, lastEra);
    if (m[1]) lastEra = m[1]; else if (m[7]) lastEra = m[7];
    if (t) out += `<a class="cite" href="#${t.id ? esc(t.id) : esc(t.hash)}" ${t.id ? `data-id="${esc(t.id)}"` : `data-hash="${esc(t.hash)}"`}>${hl(m[0])}</a>`;
    else out += hl(m[0]);
    last = m.index + m[0].length;
  }
  return out + hl(text.slice(last));
}

// ---------- 審級（原審・上訴審） ----------
const sameCourt = (a, b) => !a || !b || a === b || a.startsWith(b) || b.startsWith(a);
function lowerOf(r){
  if (!r.onum) return null;
  const c = byNum.get(norm(r.onum)) || []; let best = null; const ock = courtKey(r.ocourt);
  for (const o of c) { if (o === r) continue; if (ock && !sameCourt(ock, o.ck)) continue; if (r.odate && o.date !== r.odate) { if (!best) best = o; continue; } return o; }
  return best;
}
function uppersOf(r){
  if (!r.num) return [];
  return (byONum.get(norm(r.num)) || []).filter(o => o !== r && sameCourt(courtKey(o.ocourt), r.ck) && (!o.odate || o.odate === r.date));
}
function levelLabel(r){ const g = r.cg; return g === "最高裁大法廷" || g === "最高裁小法廷" ? "最高裁" : g === "高等裁判所" ? "高裁" : g === "地方裁判所" ? "地裁" : g === "家庭裁判所" ? "家裁" : g === "簡易裁判所" ? "簡裁" : g === "大審院" ? "大審院" : "—"; }
function lineageHtml(r){
  const down = []; let cur = r;
  for (let i = 0; i < 4; i++) { const l = lowerOf(cur); if (!l || l === r || down.includes(l)) break; down.push(l); cur = l; }
  const ups = []; let layer = uppersOf(r); const seen = new Set([r]);
  for (let i = 0; i < 4 && layer.length; i++) { layer = layer.filter(o => !seen.has(o)); layer.forEach(o => seen.add(o)); if (!layer.length) break; ups.push(layer); layer = [...new Set(layer.flatMap(uppersOf))]; }
  const item = (o, cls) => `<li class="${cls}" ${cls === "link" ? `data-id="${esc(String(o.id))}" tabindex="0" role="button"` : ""}><span class="lv">${esc(levelLabel(o))}</span><span class="t">${esc(titleOf(o))}</span><span class="m">${esc(o.court)} ${esc(wareki(o.date))}${o.num ? " " + esc(o.num) : ""}${o.result ? " · " + esc(o.result) : ""}</span></li>`;
  const parts = [];
  if (!down.length && r.ocourt) parts.push(`<li class="none"><span class="lv">原審</span><span class="t" style="font-family:var(--sans);font-weight:400;color:var(--muted)">${esc(r.ocourt)}${r.onum ? " " + esc(r.onum) : ""}${r.odate ? " " + esc(wareki(r.odate)) : ""}（裁判所サイト未収録）</span></li>`);
  down.slice().reverse().forEach(o => parts.push(item(o, "link")));
  parts.push(item(r, "cur"));
  ups.forEach(layer => layer.forEach(o => parts.push(item(o, "link"))));
  if (parts.length === 1) return `<span class="sim-state">原審・上訴審の情報は記録されていません。</span>`;
  return `<ul class="lineage">${parts.join("")}</ul>`;
}

function renderDetail(r){
  const sid = String(r.id); const isSaved = !!saved[sid]; const memo = isSaved ? (saved[sid].memo || "") : "";
  const cats = catLabels(r.cat); const areas = areaLabels(r.am); const durl = detailUrl(r), purl = pdfUrl(r);
  const alts = r.dup ? r.dup.filter(o => o !== r) : [];
  detailIn.innerHTML = `
    <div class="d-kicker">${cats.map(c => `<span class="cat">${esc(c)}</span>`).join("")}${r.ed ? `<span class="badge">解説</span>` : ""}<span>${esc(r.court)}</span>${r.kind ? `<span>${esc(r.kind)}</span>` : ""}<span>${esc(wareki(r.date))}</span></div>
    <h2 class="d-title">${esc(titleOf(r))}</h2>
    ${r.ed && r.name ? `<p class="d-alias">${esc(r.name)}</p>` : ""}
    <dl class="d-cite">
      <dt>事件番号</dt><dd>${r.num ? esc(r.num) : "—"}</dd>
      <dt>裁判年月日</dt><dd>${esc(wareki(r.date))}（${esc(r.date)}）</dd>
      ${r.result ? `<dt>結果</dt><dd>${esc(r.result)}</dd>` : ""}
      ${r.rep ? `<dt>判例集等</dt><dd>${esc(r.rep)}</dd>` : ""}
      ${r.ocourt ? `<dt>原審</dt><dd>${esc(r.ocourt)}${r.onum ? " " + esc(r.onum) : ""}${r.odate ? " " + esc(wareki(r.odate)) : ""}</dd>` : ""}
      ${areas.length ? `<dt>分野（推定）</dt><dd>${esc(areas.join("・"))}</dd>` : ""}
      ${r.right ? `<dt>権利種別</dt><dd>${esc(r.right)}</dd>` : ""}
      ${r.ltype ? `<dt>訴訟類型</dt><dd>${esc(r.ltype)}</dd>` : ""}
    </dl>
    <div class="d-actions">
      <button type="button" class="btn accent${isSaved ? " on" : ""}" id="bmBtn">${isSaved ? "★ 保存済み" : "☆ 保存する"}</button>
      <button type="button" class="btn" id="copyCite">引用をコピー</button>
      <button type="button" class="btn" id="copyLink">この判例のリンク</button>
      <button type="button" class="btn" id="cmpAdd">${compare.includes(sid) ? "比較に追加済み" : "比較に追加"}</button>
      <button type="button" class="btn" id="printBtn">印刷</button>
      ${durl ? `<a class="btn" href="${durl}" target="_blank" rel="noopener">裁判所サイトで見る ↗</a>` : ""}
      ${purl ? `<a class="btn primary" href="${purl}" target="_blank" rel="noopener">全文PDF ↗</a>` : ""}
    </div>
    ${r.ed ? `<section class="d-sec ed"><h3>解説（編集部の要約）</h3><p>${richText(r.ed.summary, r)}</p><div class="tags" style="margin-top:8px">${r.ed.tags.map(t => `<button type="button" data-tag="${esc(t)}">${esc(t)}</button>`).join("")}</div></section>` : ""}
    ${r.gist ? `<section class="d-sec"><h3>判示事項</h3><p>${richText(r.gist, r)}</p></section>` : ""}
    ${r.cgist ? `<section class="d-sec"><h3>裁判要旨</h3><p>${richText(r.cgist, r)}</p></section>` : ""}
    ${r.law ? `<section class="d-sec"><h3>参照法条 <span style="font-weight:400;letter-spacing:0;color:var(--faint)">（クリックでその条文の判例を検索）</span></h3><div class="laws">${lawList(r.law).map(l => `<button type="button" data-law="${esc(l)}">${hl(l)}</button>`).join("")}</div></section>` : ""}
    ${r.ex ? `<section class="d-sec"><h3>主文（冒頭抜粋）</h3><div class="ex">${hl(r.ex)}</div></section>` : ""}
    ${!r.gist && !r.cgist && !r.ex && !r.ed ? `<section class="d-sec"><p class="ai-off">この裁判例には判示事項・要旨が付されていません。内容は全文PDFで確認してください。</p></section>` : ""}
    ${alts.length ? `<section class="d-sec"><h3>同一判決の別収録</h3><ul class="alt">${alts.map(o => `<li><a class="cite" href="#${esc(String(o.id))}" data-id="${esc(String(o.id))}">${esc(catLabels(o.cat).join("・") || "収録")}：${esc(o.name || titleOf(o))}</a>${o.gist && o.gist !== r.gist ? `<span style="color:var(--faint);font-size:12px">（判示事項の記載が異なります）</span>` : ""}</li>`).join("")}</ul></section>` : ""}
    <section class="d-sec"><h3>審級</h3><div id="lineageBox">${load.finished ? lineageHtml(r) : `<span class="sim-state">データ読み込み後に表示します</span>`}</div></section>
    <section class="d-sec"><h3>メモ</h3><textarea class="memo" id="memo" placeholder="この判例についてのメモ。入力すると自動で保存されます。">${esc(memo)}</textarea><div class="memo-state" id="memoState"></div></section>
    <div class="ai" id="aiBox">
      <div class="ai-head"><h3><span class="dot"></span>AIでやさしく読む</h3><div id="aiCtl"></div></div>
      <div id="aiBody"></div>
    </div>
    <section class="d-sec"><h3>類似判例</h3><div id="simBox"><span class="sim-state">${load.finished ? "計算中…" : "データ読み込み後に計算します"}</span></div></section>
    <div class="src-note">書誌情報・判示事項・裁判要旨は裁判所ウェブサイトの記載、主文はPDFからの機械抽出（誤変換を含むことがあります）、分野は事件番号の符号からの推定、解説は編集部の要約です。要旨中の判例引用リンクは日付・事件番号から機械的に探したもので、別の判例を指すことがあります。正確な内容は全文PDFで確認してください。</div>`;
  detailEl.scrollTop = 0;
  bindDetail(r);
  renderAi(r);
  computeSimilar(r);
}
function copyText(btn, text, label, doneLabel){
  const done = () => { btn.textContent = doneLabel; setTimeout(() => { btn.textContent = label; }, 1600); };
  const fallback = () => { const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); done(); } catch (e) { btn.textContent = text; } ta.remove(); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
}
function bindDetail(r){
  const sid = String(r.id);
  $("#bmBtn").addEventListener("click", () => { toggleSave(sid); renderDetail(r); });
  $("#copyCite").addEventListener("click", ev => copyText(ev.currentTarget, `${titleOf(r)}（${shortCite(r)}${wareki(r.date)}${r.rep ? " " + r.rep : ""}${r.num ? " " + r.num : ""}）`, "引用をコピー", "コピーしました"));
  $("#copyLink").addEventListener("click", ev => copyText(ev.currentTarget, baseUrl() + "#" + sid, "この判例のリンク", "リンクをコピーしました"));
  $("#cmpAdd").addEventListener("click", () => { addCompare(sid); renderDetail(r); });
  $("#printBtn").addEventListener("click", () => { try { window.print(); } catch (e) {} });
  detailIn.querySelectorAll("[data-tag]").forEach(b => b.addEventListener("click", () => { setQuery(b.dataset.tag); switchView("search"); closeDetail(); }));
  detailIn.querySelectorAll("[data-law]").forEach(b => b.addEventListener("click", () => { setQuery(b.dataset.law); switchView("search"); closeDetail(); }));
  detailIn.querySelectorAll("a.cite").forEach(a => a.addEventListener("click", ev => {
    ev.preventDefault();
    if (a.dataset.id) select(a.dataset.id, true);
    else if (a.dataset.hash) { closeDetail(); switchView("search"); applyHash(a.dataset.hash); }
  }));
  detailIn.querySelectorAll(".lineage li.link").forEach(li => { const go = () => select(li.dataset.id, true); li.addEventListener("click", go); li.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } }); });
  let t; const memo = $("#memo"), st = $("#memoState");
  memo.addEventListener("input", () => {
    clearTimeout(t); st.textContent = "保存中…";
    t = setTimeout(() => {
      const v = memo.value;
      if (v.trim()) saved[sid] = { memo: v, at: (saved[sid] && saved[sid].at) || Date.now() };
      else if (saved[sid]) saved[sid].memo = "";
      persist(); st.textContent = v.trim() ? "保存しました（このブラウザ内）" : ""; updateSavedCount();
      const bm = $("#bmBtn"); if (bm && saved[sid]) { bm.classList.add("on"); bm.textContent = "★ 保存済み"; }
      refreshRowsStar();
    }, 400);
  });
}
function toggleSave(sid){
  if (saved[sid]) delete saved[sid]; else saved[sid] = { memo: "", at: Date.now() };
  persist(); updateSavedCount(); refreshRowsStar(); if (state.view === "saved") renderSaved();
}
function refreshRowsStar(){
  document.querySelectorAll("[data-star]").forEach(b => { const on = !!saved[b.dataset.star]; b.classList.toggle("on", on); b.textContent = on ? "★" : "☆"; });
}

// ---------- 2件比較 ----------
const compare = [];
function addCompare(sid){
  if (compare.includes(sid)) return;
  if (compare.length >= 2) compare.shift();
  compare.push(sid); renderCmpBar();
}
function renderCmpBar(){
  const bar = $("#cmpBar"); const recs = compare.map(id => byId.get(id)).filter(Boolean);
  if (!recs.length) { bar.hidden = true; return; }
  bar.hidden = false; $("#cmpText").textContent = recs.length === 1 ? `比較: ${cut(titleOf(recs[0]), 18)}（もう1件選んでください）` : `比較: ${cut(titleOf(recs[0]), 14)} と ${cut(titleOf(recs[1]), 14)}`;
  $("#cmpOpen").hidden = recs.length < 2;
}
function openCompare(){
  const recs = compare.map(id => byId.get(id)).filter(Boolean); if (recs.length < 2) return;
  const col = r => `<div class="col"><h4>${esc(titleOf(r))}</h4><div class="m">${esc(r.court)} ${esc(wareki(r.date))}${r.num ? " " + esc(r.num) : ""}${r.result ? " · " + esc(r.result) : ""}${r.rep ? " · " + esc(r.rep) : ""}</div>
    ${r.ed ? `<h5>解説</h5><p>${esc(r.ed.summary)}</p>` : ""}${r.gist ? `<h5>判示事項</h5><p>${esc(r.gist)}</p>` : ""}${r.cgist ? `<h5>裁判要旨</h5><p>${esc(r.cgist)}</p>` : ""}${r.law ? `<h5>参照法条</h5><p>${esc(r.law)}</p>` : ""}${r.ex ? `<h5>主文（冒頭）</h5><p>${esc(r.ex)}</p>` : ""}</div>`;
  $("#cmpBody").innerHTML = col(recs[0]) + col(recs[1]);
  $("#cmpOverlay").hidden = false;
}
$("#cmpOpen").addEventListener("click", openCompare);
$("#cmpClear").addEventListener("click", () => { compare.length = 0; renderCmpBar(); const b = $("#cmpAdd"); if (b) b.textContent = "比較に追加"; });
$("#cmpClose").addEventListener("click", () => { $("#cmpOverlay").hidden = true; });
$("#cmpOverlay").addEventListener("click", e => { if (e.target === e.currentTarget) e.currentTarget.hidden = true; });

// ---------- 類似判例 ----------
function bigramsOf(text, max){
  const s = norm(text).replace(/[\s、。，．・「」『』（）()：:；;,.\-–—【】〔〕\u0001]/g, "");
  const set = new Set();
  for (let i = 0; i < s.length - 1 && set.size < max; i++) { const g = s.slice(i, i + 2); if (!/^[0-9]{2}$/.test(g)) set.add(g); }
  return Array.from(set);
}
function computeSimilar(r){
  const box = $("#simBox"); if (!box) return;
  const token = ++simToken;
  if (!load.finished) return;
  const base = (r.gist || "") + " " + (r.cgist || "") + (!r.gist && !r.cgist ? " " + r.ex : "") + (r.gist || r.cgist || r.ex ? "" : " " + r.name + (r.ed ? " " + r.ed.summary : ""));
  const grams = bigramsOf(base, 200);
  if (grams.length < 8) { box.innerHTML = `<span class="sim-state">比較できる要旨がないため計算できません。</span>`; return; }
  const gl = grams.length; const baseLen = Math.max(40, norm(base).length);
  const df = new Uint32Array(gl); const cands = []; let i = 0; const STEP = 4000;
  let minShared = 3;
  const simText = o => { const t = o.hay.slice(o.b[3], o.b[5]); return t.length > 12 ? t : o.hay.slice(o.b[7], o.b[8]); };
  const step = () => {
    if (token !== simToken) return;
    const end = Math.min(ALL.length, i + STEP);
    for (; i < end; i++) {
      const o = ALL[i]; const h = simText(o); if (h.length < 10) continue;
      let shared = 0; const hit = [];
      for (let k = 0; k < gl; k++) if (h.includes(grams[k])) { df[k]++; shared++; hit.push(k); }
      if (o === r || (o.dup && o.dup === r.dup) || shared < minShared) continue;
      if (settings.dedupe && o.dup && !o.main) continue;
      cands.push([o, hit, h.length]);
      if (cands.length > 30000) { minShared++; for (let j = cands.length - 1; j >= 0; j--) if (cands[j][1].length < minShared) cands.splice(j, 1); }
    }
    if (i < ALL.length) { setTimeout(step, 0); return; }
    if (token !== simToken) return;
    const N = ALL.length; const idf = new Float64Array(gl); let selfW = 0;
    for (let k = 0; k < gl; k++) { idf[k] = Math.log((N + 1) / (df[k] + 1)); selfW += idf[k] * idf[k]; }
    const top = [];
    for (const [o, hit, hlen] of cands) {
      let w = 0; for (const k of hit) w += idf[k] * idf[k];
      const sc = w / selfW / Math.sqrt(Math.max(1, hlen / baseLen));
      if (top.length < 6 || sc > top[top.length - 1][1]) { top.push([o, sc]); top.sort((a, b) => b[1] - a[1]); if (top.length > 6) top.pop(); }
    }
    if (!top.length) { box.innerHTML = `<span class="sim-state">似た判例は見つかりませんでした。</span>`; return; }
    box.innerHTML = `<ul class="sim">${top.map(([o, s]) => `<li data-id="${esc(String(o.id))}" tabindex="0" role="button"><span class="t">${esc(titleOf(o))}</span><span class="pct">${Math.round(Math.min(1, s) * 100)}%</span><span class="m">${esc(o.court)} ${esc(wareki(o.date))}${o.num ? " " + esc(o.num) : ""}</span><span class="bar"><i style="width:${Math.max(4, Math.round(Math.min(1, s) * 100))}%"></i></span></li>`).join("")}</ul>`;
    box.querySelectorAll("li").forEach(li => { const go = () => select(li.dataset.id, true); li.addEventListener("click", go); li.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } }); });
  };
  setTimeout(step, 0);
}

// ---------- AI ----------
// 提供元は2通り: claude.ai 上で開いたときの sample 機能 / 利用者自身の Anthropic API キー（ブラウザに保存）
const API_KEY_STORE = "hanrei-lens:api"; const DEFAULT_MODEL = "claude-sonnet-5-5";
let apiCfg = null; try { apiCfg = JSON.parse(localStorage.getItem(API_KEY_STORE) || "null"); } catch (e) { apiCfg = null; }
let aiProvider = "";
function apiSample(input, opts){
  opts = opts || {};
  return new Promise(async (resolve, reject) => {
    const msgs = typeof input === "string" ? [{ role: "user", content: input }] : input.map(t => ({ role: t.role, content: t.content }));
    let text = "", stop = null;
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", signal: opts.signal,
        headers: { "content-type": "application/json", "x-api-key": apiCfg.key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: apiCfg.model || DEFAULT_MODEL, max_tokens: 1200, stream: true, messages: msgs })
      });
      if (!res.ok) {
        let msg = ""; try { msg = (await res.json()).error.message; } catch (e) {}
        const code = res.status === 401 || res.status === 403 ? "auth" : res.status === 429 ? "rate_limited" : res.status === 400 || res.status === 404 ? "invalid_request" : "upstream_error";
        reject({ code, message: msg || ("HTTP " + res.status) }); return;
      }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl; while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          let ev; try { ev = JSON.parse(line.slice(5)); } catch (e) { continue; }
          if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") { text += ev.delta.text; if (opts.onText) opts.onText({ text, delta: ev.delta.text }); }
          else if (ev.type === "message_delta" && ev.delta) stop = ev.delta.stop_reason;
          else if (ev.type === "error") { reject({ code: "upstream_error", message: ev.error && ev.error.message, text }); return; }
        }
      }
      if (!text) { reject({ code: "empty_completion", message: "empty" }); return; }
      resolve({ text, truncated: stop === "max_tokens", modelTierApplied: "default" });
    } catch (e) {
      if (e && e.name === "AbortError") reject({ code: "cancelled", message: "cancelled", text });
      else reject({ code: "upstream_error", message: String(e && e.message || e), text });
    }
  });
}
function saveApiCfg(cfg){ apiCfg = cfg; try { if (cfg) localStorage.setItem(API_KEY_STORE, JSON.stringify(cfg)); else localStorage.removeItem(API_KEY_STORE); } catch (e) {} }
function renderApiSettings(r, body, ctl){
  ctl.innerHTML = "";
  body.innerHTML = `<div class="ai-off">AIによる要約と質問は、お使いの Anthropic API キーを設定すると使えます。キーはこのブラウザにだけ保存され、api.anthropic.com に直接送信されます（このサイトの運営者には送られません）。利用料金はキーの持ち主に課金されます。</div>
    <form id="apiForm" style="display:grid;gap:8px;margin-top:10px;max-width:520px">
      <input id="apiKey" type="password" placeholder="sk-ant-… （Anthropic API キー）" autocomplete="off" style="border:1px solid var(--line-2);border-radius:8px;padding:7px 10px;background:var(--panel)" value="${esc(apiCfg && apiCfg.key || "")}">
      <input id="apiModel" placeholder="モデルID（省略時 ${DEFAULT_MODEL}）" autocomplete="off" style="border:1px solid var(--line-2);border-radius:8px;padding:7px 10px;background:var(--panel)" value="${esc(apiCfg && apiCfg.model || "")}">
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="submit" class="btn primary">保存して有効にする</button>${apiCfg ? `<button type="button" class="btn" id="apiClear">キーを削除</button>` : ""}<a class="btn" href="https://platform.claude.com/" target="_blank" rel="noopener">キーを取得 ↗</a></div>
    </form>`;
  $("#apiForm").addEventListener("submit", ev => { ev.preventDefault(); const key = $("#apiKey").value.trim(); if (!key) return; saveApiCfg({ key, model: $("#apiModel").value.trim() || DEFAULT_MODEL }); sampleFn = apiSample; aiProvider = "api"; aiState = "on"; renderAi(r); });
  const clr = $("#apiClear"); if (clr) clr.addEventListener("click", () => { saveApiCfg(null); sampleFn = null; aiProvider = ""; aiState = "off"; renderAi(r); });
}
function renderAi(r){
  const body = $("#aiBody"), ctl = $("#aiCtl"); if (!body) return;
  ctl.innerHTML = "";
  if (aiState === "pending") { body.innerHTML = `<div class="ai-off">AI機能を確認しています…</div>`; return; }
  if (aiState === "off" || aiState === "settings") { renderApiSettings(r, body, ctl); return; }
  ctl.innerHTML = `<button type="button" class="btn primary" id="aiSum">要約する</button><button type="button" class="btn" id="aiStop" hidden>停止</button>${aiProvider === "api" ? `<button type="button" class="btn" id="aiCfg" title="APIキーの設定">設定</button>` : ""}`;
  body.innerHTML = `<p class="ai-out" id="aiOut"></p><div class="ai-note" id="aiNote"></div>
    <div class="ai-chat" id="aiChat"></div>
    <form class="ai-q" id="aiForm"><input id="aiQ" placeholder="この判例について質問する（例：なぜこの結論になったの？）" autocomplete="off" aria-label="質問"><button type="submit" class="btn">送信</button></form>`;
  const out = $("#aiOut"), note = $("#aiNote"), sumBtn = $("#aiSum"), stopBtn = $("#aiStop");
  const cfgBtn = $("#aiCfg"); if (cfgBtn) cfgBtn.addEventListener("click", () => { aiState = "settings"; renderAi(r); });
  const sid = String(r.id); const turns = chatTurns.get(sid) || []; chatTurns.set(sid, turns);
  const chat = $("#aiChat"); turns.forEach(t => chat.insertAdjacentHTML("beforeend", `<div class="bub ${t.role === "user" ? "u" : "a"}">${esc(t.content)}</div>`));
  stopBtn.addEventListener("click", () => { if (currentAbort) currentAbort.abort(); });
  const fail = (e, target) => {
    if (!e || typeof e !== "object") { note.textContent = AI_COPY.upstream_error; return; }
    if (e.code === "cancelled") { if (e.text && target) target.textContent = e.text + " …（停止）"; return; }
    if (AI_HIDE.has(e.code)) { aiState = "off"; aiProvider = ""; sampleFn = null; renderAi(r); return; }
    if (e.text && target && e.code !== "refused") target.textContent = e.text;
    else if (target && e.code === "refused") target.textContent = "";
    note.textContent = (AI_COPY[e.code] || AI_COPY.upstream_error) + (e.code === "auth" || e.code === "invalid_request" ? (e.message ? `（${e.message}）` : "") : "");
  };
  const busy = on => { sumBtn.disabled = on; stopBtn.hidden = !on; $("#aiForm").querySelector("button").disabled = on; };
  sumBtn.addEventListener("click", async () => {
    note.textContent = ""; out.textContent = "考えています…"; out.classList.add("thinking"); busy(true);
    currentAbort = new AbortController();
    try {
      const o = { signal: currentAbort.signal, onText: ({ text }) => { out.classList.remove("thinking"); out.textContent = text; } };
      if (aiProvider === "claude") o.cache = { gcTime: 86400000 };
      const res = await sampleFn(summaryPrompt(r), o);
      out.classList.remove("thinking"); out.textContent = res.text; if (res.truncated) note.textContent = "回答が途中で切れました。";
    } catch (e) { out.classList.remove("thinking"); if (out.textContent === "考えています…") out.textContent = ""; fail(e, out); }
    finally { busy(false); currentAbort = null; }
  });
  $("#aiForm").addEventListener("submit", async ev => {
    ev.preventDefault(); const q = $("#aiQ").value.trim(); if (!q) return; $("#aiQ").value = ""; note.textContent = "";
    turns.push({ role: "user", content: q });
    chat.insertAdjacentHTML("beforeend", `<div class="bub u">${esc(q)}</div><div class="bub a thinking">考えています…</div>`);
    const bub = chat.lastElementChild; busy(true); currentAbort = new AbortController();
    const recent = turns.slice(-8);
    try {
      const o = { signal: currentAbort.signal, onText: ({ text }) => { bub.classList.remove("thinking"); bub.textContent = text; } };
      if (aiProvider === "claude") o.cache = false;
      const res = await sampleFn([{ role: "user", content: QA_RULES(r) }, ...recent], o);
      bub.classList.remove("thinking"); bub.textContent = res.text; turns.push({ role: "assistant", content: res.text });
    } catch (e) { bub.classList.remove("thinking"); if (bub.textContent === "考えています…") bub.textContent = ""; fail(e, bub); if (!bub.textContent) bub.remove(); turns.pop(); }
    finally { busy(false); currentAbort = null; bub.scrollIntoView({ block: "nearest" }); }
  });
}
(async () => {
  try { sampleFn = IN_CLAUDE ? await window.claude.use("sample") : null; } catch (e) { sampleFn = null; }
  if (sampleFn) aiProvider = "claude";
  else if (apiCfg && apiCfg.key) { sampleFn = apiSample; aiProvider = "api"; }
  aiState = sampleFn ? "on" : "off";
  if (state.selected) { const r = byId.get(state.selected); if (r && $("#aiBody")) renderAi(r); }
})();

// ---------- URL での状態共有 ----------
const baseUrl = () => location.href.split("#")[0];
let hashLock = false, lastHash = null;
function stateToHash(){
  const p = new URLSearchParams();
  if (state.q.trim()) p.set("q", state.q.trim());
  if (state.cats.size) p.set("cat", [...state.cats].join(","));
  if (state.areas.size) p.set("area", [...state.areas].join(","));
  if (state.court) p.set("court", state.court);
  if (state.courtName) p.set("cn", state.courtName);
  if (state.kind) p.set("kind", state.kind);
  if (state.result) p.set("res", state.result);
  if (state.from) p.set("from", state.from);
  if (state.to) p.set("to", state.to);
  if (state.date) p.set("date", state.date);
  if (state.sort !== "rel") p.set("sort", state.sort);
  const s = p.toString();
  if (state.selected) return s ? s + "&id=" + encodeURIComponent(state.selected) : state.selected;
  return s;
}
function pushHash(){
  if (hashLock) return;
  const h = stateToHash(); if (h === lastHash) return; lastHash = h;
  try { history.replaceState(null, "", h ? "#" + h : baseUrl()); } catch (e) {}
}
function syncFilterUi(){
  $("#catChips").querySelectorAll("[data-bit]").forEach(b => b.classList.toggle("on", state.cats.has(+b.dataset.bit)));
  $("#areaChips").querySelectorAll("[data-abit]").forEach(b => b.classList.toggle("on", state.areas.has(+b.dataset.abit)));
  $("#fCourt").value = state.court; $("#fCourtName").value = state.courtName; $("#fKind").value = state.kind; $("#fResult").value = state.result;
  $("#fFrom").value = state.from; $("#fTo").value = state.to; $("#fSort").value = state.sort;
  qEl.value = state.q; qClear.hidden = !state.q;
}
function applyHash(h){
  if (!h) return null;
  if (!h.includes("=")) return h; // 判例IDだけの短いリンク
  const p = new URLSearchParams(h);
  const nums = v => new Set((v || "").split(",").map(Number).filter(Boolean));
  hashLock = true;
  state.q = p.get("q") || ""; state.cats = nums(p.get("cat")); state.areas = nums(p.get("area"));
  state.court = p.get("court") || ""; state.courtName = p.get("cn") || ""; state.kind = p.get("kind") || ""; state.result = p.get("res") || "";
  state.from = p.get("from") || ""; state.to = p.get("to") || ""; state.date = /^\d{4}-\d{2}-\d{2}$/.test(p.get("date") || "") ? p.get("date") : "";
  state.sort = ["rel", "new", "old"].includes(p.get("sort")) ? p.get("sort") : "rel";
  syncFilterUi(); runSearch();
  hashLock = false; pushHash();
  return p.get("id");
}

// ---------- 選択・表示切替 ----------
function isNarrow(){ return window.matchMedia("(max-width: 860px)").matches; }
function select(id, open){
  const sid = String(id); const r = byId.get(sid); if (!r) return;
  state.selected = sid; if (open) state.autoSel = false;
  document.querySelectorAll(".row").forEach(x => x.classList.toggle("sel", x.dataset.id === sid));
  renderDetail(r);
  document.title = `${titleOf(r)} | 判例レンズ`;
  recordViewed(sid); if (state.q.trim()) recordQuery(state.q);
  pushHash();
  if (open && isNarrow()) detailEl.classList.add("open");
}
function closeDetail(){ detailEl.classList.remove("open"); }
$("#dClose").addEventListener("click", closeDetail);
function switchView(v){
  state.view = v;
  document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.view === v));
  $("#searchView").hidden = v !== "search"; $("#savedView").hidden = v !== "saved"; $("#aboutView").hidden = v !== "about";
  if (v === "saved") { renderSaved(); $("#savedView .main").appendChild(detailEl); }
  else if (v === "search") { $("#searchView .main").appendChild(detailEl); }
  closeDetail();
}
document.querySelectorAll(".tabs button").forEach(b => b.addEventListener("click", () => switchView(b.dataset.view)));
function listClick(ev){
  const star = ev.target.closest("[data-star]"); if (star) { ev.stopPropagation(); toggleSave(star.dataset.star); return; }
  const row = ev.target.closest(".row"); if (row) select(row.dataset.id, true);
}
function listKey(ev){ if ((ev.key === "Enter" || ev.key === " ") && ev.target.classList.contains("row")) { ev.preventDefault(); select(ev.target.dataset.id, true); } }
resultList.addEventListener("click", listClick); resultList.addEventListener("keydown", listKey);
$("#savedList").addEventListener("click", listClick); $("#savedList").addEventListener("keydown", listKey);

// ---------- キーボード操作 ----------
function moveSel(d){
  if (!state.results.length) return;
  let i = state.results.findIndex(r => String(r.id) === state.selected); i = Math.max(0, Math.min(state.results.length - 1, i + d));
  if (i >= state.shown) { state.shown = Math.min(state.results.length, state.shown + PAGE); renderResults(); }
  select(state.results[i].id, false);
  const row = resultList.querySelector(`.row[data-id="${CSS.escape(String(state.results[i].id))}"]`); if (row) row.scrollIntoView({ block: "nearest" });
}
function closeOverlays(){ $("#settingsPop").hidden = true; $("#helpPop").hidden = true; $("#cmpOverlay").hidden = true; closeDetail(); }
document.addEventListener("keydown", e => {
  const t = e.target; const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
  if (e.key === "Escape") { if (typing) t.blur(); closeOverlays(); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  switch (e.key) {
    case "/": e.preventDefault(); switchView("search"); qEl.focus(); qEl.select(); break;
    case "j": moveSel(1); break;
    case "k": moveSel(-1); break;
    case "Enter": if (state.selected && isNarrow()) detailEl.classList.add("open"); break;
    case "s": if (state.selected) { toggleSave(state.selected); const r = byId.get(state.selected); if (r) renderDetail(r); } break;
    case "c": if (state.selected) { addCompare(state.selected); const r = byId.get(state.selected); if (r) renderDetail(r); } break;
    case "?": $("#helpPop").hidden = !$("#helpPop").hidden; $("#settingsPop").hidden = true; break;
  }
});

// ---------- 表示設定 ----------
function applySettings(){
  const root = document.documentElement;
  if (settings.theme === "auto") { if (root.dataset.hlTheme) { root.removeAttribute("data-theme"); delete root.dataset.hlTheme; } }
  else { root.dataset.theme = settings.theme; root.dataset.hlTheme = "1"; }
  root.style.setProperty("--fs", { s: "13px", m: "14px", l: "16px" }[settings.font] || "14px");
  $("#optTheme").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === settings.theme));
  $("#optFont").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === settings.font));
  $("#optDedupe").checked = !!settings.dedupe; $("#optFacets").checked = !!settings.facets;
}
$("#optTheme").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; settings.theme = b.dataset.v; saveSettings(); applySettings(); });
$("#optFont").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; settings.font = b.dataset.v; saveSettings(); applySettings(); });
$("#optDedupe").addEventListener("change", e => { settings.dedupe = e.target.checked; saveSettings(); runSearch(true); });
$("#optFacets").addEventListener("change", e => { settings.facets = e.target.checked; saveSettings(); renderFacets(); });
$("#settingsBtn").addEventListener("click", () => { const p = $("#settingsPop"); p.hidden = !p.hidden; $("#helpPop").hidden = true; });
$("#helpBtn").addEventListener("click", () => { const p = $("#helpPop"); p.hidden = !p.hidden; $("#settingsPop").hidden = true; });
document.addEventListener("click", e => { if (!e.target.closest(".pop") && !e.target.closest(".iconbtn")) { $("#settingsPop").hidden = true; $("#helpPop").hidden = true; } });
applySettings();

// ---------- 検索UI ----------
const qEl = $("#q"), qClear = $("#qClear");
function setQuery(q){ qEl.value = q; state.q = q; qClear.hidden = !q; runSearch(); }
let deb; qEl.addEventListener("input", () => { clearTimeout(deb); deb = setTimeout(() => setQuery(qEl.value), 220); });
$("#searchForm").addEventListener("submit", e => { e.preventDefault(); clearTimeout(deb); setQuery(qEl.value); recordQuery(qEl.value); qEl.blur(); });
qClear.addEventListener("click", () => { setQuery(""); qEl.focus(); });
const chips = $("#catChips");
chips.innerHTML = CATS.map(c => `<button type="button" class="chip${c.ed ? " ed" : ""}" data-bit="${c.bit}">${c.label}</button>`).join("");
chips.addEventListener("click", e => { const b = e.target.closest("[data-bit]"); if (!b) return; const bit = +b.dataset.bit; if (state.cats.has(bit)) state.cats.delete(bit); else state.cats.add(bit); b.classList.toggle("on", state.cats.has(bit)); runSearch(); });
const achips = $("#areaChips");
achips.innerHTML = AREAS.map(a => `<button type="button" class="chip area" data-abit="${a.bit}" title="事件番号の符号などから推定した分野">${a.label}</button>`).join("");
achips.addEventListener("click", e => { const b = e.target.closest("[data-abit]"); if (!b) return; const bit = +b.dataset.abit; if (state.areas.has(bit)) state.areas.delete(bit); else state.areas.add(bit); b.classList.toggle("on", state.areas.has(bit)); runSearch(); });
$("#fCourt").addEventListener("change", e => { state.court = e.target.value; runSearch(); });
let cnDeb; $("#fCourtName").addEventListener("input", e => { clearTimeout(cnDeb); cnDeb = setTimeout(() => { state.courtName = e.target.value.trim(); runSearch(); }, 220); });
$("#fKind").addEventListener("change", e => { state.kind = e.target.value; runSearch(); });
$("#fResult").addEventListener("change", e => { state.result = e.target.value; runSearch(); });
$("#fFrom").addEventListener("input", e => { state.from = e.target.value; runSearch(); });
$("#fTo").addEventListener("input", e => { state.to = e.target.value; runSearch(); });
$("#fSort").addEventListener("change", e => { state.sort = e.target.value; runSearch(); });
$("#fReset").addEventListener("click", () => {
  state.cats.clear(); state.areas.clear(); state.court = state.courtName = state.kind = state.result = state.from = state.to = state.date = ""; state.sort = "rel"; state.q = "";
  syncFilterUi(); runSearch();
});
$("#shareBtn").addEventListener("click", ev => {
  const h = stateToHash();
  copyText(ev.currentTarget, baseUrl() + (h ? "#" + h : ""), "検索条件のリンクをコピー", "コピーしました");
});
$("#saveSearchBtn").addEventListener("click", ev => {
  const saveSel = state.selected; state.selected = null; const h = stateToHash(); state.selected = saveSel;
  if (!h) { ev.currentTarget.textContent = "条件がありません"; setTimeout(() => { ev.currentTarget.textContent = "この検索を保存"; }, 1500); return; }
  const parts = [];
  if (state.q.trim()) parts.push(`「${state.q.trim()}」`);
  if (state.cats.size) parts.push([...state.cats].map(b => (CATS.find(c => c.bit === b) || {}).label).filter(Boolean).join("/"));
  if (state.areas.size) parts.push([...state.areas].map(b => (AREAS.find(a => a.bit === b) || {}).label).filter(Boolean).join("/"));
  if (state.court) parts.push(state.court); if (state.courtName) parts.push(state.courtName); if (state.kind) parts.push(state.kind); if (state.result) parts.push(state.result);
  if (state.from || state.to) parts.push(`${state.from || ""}〜${state.to || ""}`); if (state.date) parts.push(wareki(state.date));
  pushUnique(hist.searches, { name: parts.join(" · ") || "条件なし", hash: h, at: Date.now() }, x => x.hash, 30); saveHist();
  const b = ev.currentTarget; b.textContent = "保存しました"; setTimeout(() => { b.textContent = "この検索を保存"; }, 1500);
});

// ---------- 起動 ----------
let pendingId = applyHash((location.hash || "").slice(1));
updateSavedCount();
if (!pendingId) renderResults();
window.addEventListener("hashchange", () => {
  const h = (location.hash || "").slice(1); if (h === lastHash) return;
  const id = applyHash(h); if (id && byId.has(id) && id !== state.selected) select(id, true); else if (id) pendingId = id;
});
if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol) && !IN_CLAUDE && !DATA_VERSION.startsWith("__")) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => {}); });
}
loadAll();
})();
</script>
