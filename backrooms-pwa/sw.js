/* 階層目録：オフラインでも開けるようにする。
   まずネットワーク（Termux のサーバー）から取り、取れないときは前に取っておいたものを返す。
   ファイルを足したら FILES に足し、VERSION を上げる。 */
const VERSION = "kaisou-v13";
const FILES = [
  "./",
  "./index.html",
  "./fx.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./games/noclip.html",
  "./games/yacho.html",
  "./games/miteiko.html",
  "./games/kuuran2.html",
  "./games/kuramori.html",
  "./games/kura/engine.js",
  "./games/kura/house.js",
  "./games/kura/village.js",
  "./games/kura/night.js",
  "./games/kura/extra.js",
  "./games/hikae.html",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION && !k.startsWith("fonts")).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // フォントは一度取れたら、それを使いつづける
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(
      caches.open("fonts").then(c => c.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok || res.type === "opaque") c.put(req, res.clone());
        return res;
      }).catch(() => new Response("", { status: 504 }))))
    );
    return;
  }
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match("./index.html")))
  );
});
