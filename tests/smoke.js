// 判例レンズ 回帰テスト: ローカルの静的サーバーで index.html を開き、読み込み・検索・絞り込み・詳細表示を確認する
//   npm install playwright && npx playwright install chromium && node tests/smoke.js
const { chromium } = require('playwright');
const fs = require('fs'); const http = require('http'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.js': 'application/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.json': 'application/json', '.xml': 'application/xml' };
const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]); if (u === '/') u = '/index.html';
  const p = path.join(ROOT, u);
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream', 'content-length': fs.statSync(p).size });
  fs.createReadStream(p).pipe(res);
});
const checks = []; let failed = 0;
function check(name, ok, info) { checks.push(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); if (!ok) failed++; }
(async () => {
  await new Promise(r => server.listen(0, r)); const port = server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://localhost:${port}/`);
  await page.waitForFunction(() => document.querySelector('#loadbar').classList.contains('done') || document.querySelector('#loadbar').classList.contains('err'), null, { timeout: 180000 });
  await page.waitForTimeout(500);
  const loadText = await page.textContent('#loadtext');
  check('データ読み込み', /件の裁判例を読み込みました/.test(loadText), loadText);
  const total = +(await page.textContent('#resultCount')).replace(/,/g, '');
  check('収録件数が 60,000 件以上', total >= 60000, String(total));
  const q = async s => { await page.fill('#q', s); await page.waitForTimeout(700); return +(await page.textContent('#resultCount')).replace(/,/g, ''); };
  check('事件番号検索（平成28(受)2099）', (await q('平成28(受)2099')) >= 1);
  check('漢数字の正規化（刑法200条 = 刑法二〇〇条）', (await q('刑法200条')) === (await q('刑法二〇〇条')) && (await q('刑法200条')) > 0);
  check('法令略称（刑訴法 = 刑事訴訟法）', (await q('刑訴法435条')) === (await q('刑事訴訟法435条')) && (await q('刑訴法435条')) > 0);
  const a = await q('尊属殺'), b = await q('嫡出'), ab = await q('尊属殺 OR 嫡出');
  check('OR検索', ab >= Math.max(a, b) && ab <= a + b, `${a} + ${b} -> ${ab}`);
  check('フレーズ検索', (await q('"権利の濫用"')) > 0);
  check('解説つき判例の検索（三菱樹脂事件）', (await q('三菱樹脂事件')) >= 1);
  await page.fill('#q', '尊属殺'); await page.waitForTimeout(700); await page.click('.row'); await page.waitForTimeout(2500);
  check('詳細表示', /尊属殺/.test(await page.textContent('.d-title')));
  check('類似判例の計算', (await page.locator('#simBox .sim li').count()) >= 1);
  check('審級欄の表示', (await page.locator('#lineageBox').count()) === 1);
  await page.click('#areaChips [data-abit="2"]'); await page.waitForTimeout(600);
  check('分野チップ（刑事）で絞り込み', +(await page.textContent('#resultCount')).replace(/,/g, '') > 0);
  await page.click('#fReset'); await page.waitForTimeout(500);
  await page.fill('#fCourtName', '東京地方裁判所'); await page.waitForTimeout(700);
  check('裁判所名で絞り込み', +(await page.textContent('#resultCount')).replace(/,/g, '') > 1000);
  await page.fill('#fCourtName', ''); await page.waitForTimeout(500);
  check('サイト内にJavaScriptエラーなし', errors.length === 0, errors.slice(0, 3).join(' / '));
  check('横スクロールなし', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await browser.close(); server.close();
  console.log(checks.join('\n'));
  if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
  console.log('\nall checks passed');
})().catch(e => { console.error('FAIL', e); server.close(); process.exit(1); });
