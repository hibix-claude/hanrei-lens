/* 判例レンズ service worker
   - データファイル（data/cases-*.txt）は版番号つきでキャッシュ優先（2回目以降は16MBのダウンロードなし）
   - index.html などは「ネットワーク優先、失敗したらキャッシュ」（更新をすぐ反映しつつオフラインでも開ける） */
const VERSION = "2026-10-24-202610231944";
const CACHE = "hanrei-lens-" + VERSION;
const PRECACHE = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("hanrei-lens-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const isData = /\/cases-[abc]\.txt$/.test(url.pathname);
  if (isData) {
    // 版番号ごとに保存。別の版は activate で消える
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      const res = await fetch(req); if (res.ok) c.put(req, res.clone()); return res;
    }));
    return;
  }
  e.respondWith(fetch(req).then(res => {
    if (res.ok && (url.pathname.endsWith("/") || /\.(html|webmanifest|png|js|css|txt)$/.test(url.pathname))) caches.open(CACHE).then(c => c.put(req, res.clone()));
    return res;
  }).catch(() => caches.match(req).then(hit => hit || caches.match("./index.html"))));
});
