// src/ をまとめて、1枚の backrooms.html を作る（Tasker の WebView でそのまま開ける）
// あわせて、Chrome でアプリとして入れられる版を pwa/ に作る
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { draw } = require('./icon');
const src = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const JS = ['levels.js', 'world.js', 'tex.js', 'render.js', 'audio.js', 'game.js', 'ui.js', 'main.js'];
const make = (files, head) => {
  const js = files.map(f => `// ---- ${f} ----\n` + src(f)).join('\n');
  return src('template.html').replace('</head>', () => head + '</head>')
    .replace('/*CSS*/', () => src('style.css')).replace('/*JS*/', () => js.replace(/<\/script/gi, '<\\/script'));
};
const html = make(JS, '');
const out = path.join(__dirname, 'backrooms.html');
fs.writeFileSync(out, html);
console.log('wrote', out, (html.length / 1024).toFixed(1) + 'KB');

// ---- アプリとして入れる版 ----
const dir = path.join(__dirname, 'pwa');
fs.mkdirSync(dir, { recursive: true });
const icons = { 'icon-192.png': draw(192), 'icon-512.png': draw(512) };
const page = make(JS.concat('pwa.js'), '<link rel="manifest" href="manifest.json">\n<link rel="icon" href="icon-192.png">\n<link rel="apple-touch-icon" href="icon-192.png">\n');
const manifest = {
  id: './', name: '迷い部屋', short_name: '迷い部屋', lang: 'ja',
  description: 'Backrooms 風の探索ホラー。終わりのない黄色い部屋をさまよい、出口を探す。',
  start_url: './', scope: './', display: 'fullscreen', background_color: '#000000', theme_color: '#000000',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
const files = { 'index.html': page, 'manifest.json': JSON.stringify(manifest, null, 2) + '\n', ...icons };
// 中身が変わったら名前も変わるので、ブラウザが新しい sw.js に入れかえる
const ver = crypto.createHash('sha256').update(Object.values(files).map(v => Buffer.from(v)).reduce((a, b) => Buffer.concat([a, b]))).digest('hex').slice(0, 12);
files['sw.js'] = `// 迷い部屋：1度開いたら、サーバーが止まっていても遊べるようにする
const CACHE = 'backrooms-${ver}';
const FILES = ['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// サーバーが動いていれば新しいほうを使って覚え直し、止まっていれば覚えているほうを使う
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(fetch(r.url, { cache: 'no-cache' }).then(res => {
    if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); }
    return res;
  }).catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || caches.match('index.html'))));
});
`;
for (const [f, v] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), v);
console.log('wrote', dir, Object.keys(files).join(' '));
