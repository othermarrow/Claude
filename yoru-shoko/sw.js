/* 夜の書庫：オフラインでも開けるようにする。
   まずネットワーク（Termux のサーバー）から取り、取れないときは前に取っておいたものを返す。
   ファイルを足したら FILES に足し、VERSION を上げる。 */
const VERSION = "yoru-v2";
const FILES = [
  "./",
  "./index.html",
  "./app.js",
  "./games.js",
  "./zvm.js",
  "./translate.js",
  "./dict.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./stories/zork1.z3",
  "./stories/zork2.z3",
  "./stories/zork3.z3",
  "./glulx/quixe.min.js",
  "./glulx/glkapi.min.js",
  "./glulx/glkote-mini.js",
  "./kura/engine.js",
  "./kura/house.js",
  "./kura/village.js",
  "./kura/night.js",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(FILES.map(f => c.add(f).catch(() => {})))).then(() => self.skipWaiting()));
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
