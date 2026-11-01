/* ミナモ：サーバーを止めていても画面だけは開けるようにする。
   まずネットワーク（Termux のサーバー）から取り、取れないときは前に取っておいたものを返す。
   /api/ は取っておかない。ファイルを足したら FILES に足し、VERSION を上げる。
   VERSION を上げたら、app.js の BUILD も同じにする（起動画面で、画面が古いままかを見分ける）。 */
const VERSION = "minamo-v33";
const FILES = [
  "./",
  "./index.html",
  "./app.js",
  "./fx.js",
  "./walls.js",
  "./excess.js",
  "./bleed.js",
  "./story.html",
  "./story.js",
  "./story-data.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
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
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match("./index.html")))
  );
});

// 過剰の演出の通知（「まだ話の途中です」）を押したら、ミナモの画面に戻る
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const c of list) if ("focus" in c) return c.focus();
      return self.clients.openWindow((e.notification.data && e.notification.data.url) || "./");
    })
  );
});
