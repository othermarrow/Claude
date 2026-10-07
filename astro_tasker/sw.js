// 天文データ（PWA）のキャッシュ。
// ページ（HTML）は先にネットから取り、つながらないときだけ保存したものを使う（更新がすぐ反映されるように）。
// フォントなどは保存したものを先に使う。
// ページを大きく変えたときは CACHE の番号を上げる（古い保存は消える）
const CACHE = 'astro-v2';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Rajdhani:wght@600;700&display=swap'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS).catch(()=>{}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))
    )
  );
  self.clients.claim();
});

function save(req, res){
  if(res && res.status===200 && res.type!=='opaque'){
    const clone = res.clone();
    caches.open(CACHE).then(c => c.put(req, clone));
  }
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const isPage = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  if(isPage){
    // ページ: ネット優先
    e.respondWith(
      fetch(req).then(res => save(req, res)).catch(() => caches.match(req).then(c => c || caches.match('./index.html')))
    );
    return;
  }
  // それ以外: 保存したもの優先
  e.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(res => save(req, res)).catch(() => cached))
  );
});
