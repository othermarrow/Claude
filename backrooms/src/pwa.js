// ===== アプリとして入れたとき（pwa/ の版だけに入る。Tasker 用の backrooms.html には入らない） =====
// 1度開けば、サーバーが止まっていても sw.js が覚えた中身で動く
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { }));
}
// 記録を消されにくくする（入れたアプリなら、たいてい認められる）
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });

// タイトルに「アプリとして入れる」を出す（Chrome が入れられると判断したときだけ）
let pwaPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); pwaPrompt = e; if (G.mode === 'title') showTitle(); });
window.addEventListener('appinstalled', () => { pwaPrompt = null; toast('ホーム画面に入れた'); if (G.mode === 'title') showTitle(); });
const titleBase = showTitle;
showTitle = function () {
  titleBase();
  const bs = document.querySelector('#ov .bs');
  if (!pwaPrompt || !bs) return;
  const b = document.createElement('button');
  b.className = 'b ghost wide'; b.dataset.pwa = 'install';
  b.innerHTML = 'アプリとして入れる<span class="sub">ホーム画面から全画面で開ける</span>';
  b.addEventListener('click', ev => {
    ev.stopPropagation();
    const p = pwaPrompt; pwaPrompt = null; if (!p) return;
    p.prompt(); p.userChoice.catch(() => { }).then(() => { if (G.mode === 'title') showTitle(); });
  });
  bs.appendChild(b);
};

// 遊んでいる間は画面を消さない
let wakeLock = null;
setInterval(() => {
  const want = (G.mode === 'play' || G.mode === 'trans') && !document.hidden;
  if (want && !wakeLock && navigator.wakeLock) {
    wakeLock = 'wait';
    navigator.wakeLock.request('screen').then(l => { wakeLock = l; l.addEventListener('release', () => { if (wakeLock === l) wakeLock = null; }); }).catch(() => { wakeLock = null; });
  } else if (!want && wakeLock && wakeLock !== 'wait') { const l = wakeLock; wakeLock = null; l.release().catch(() => { }); }
}, 1000);

// 全画面で開いているときは、戻る操作（ボタン・画面のふちからのスワイプ）でアプリを閉じずに一時停止にする。
// Chrome は指で触れたあとに積んだ履歴しか「戻る」で止まらないので、触れたときに積む
const standalone = () => matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
let backTrap = false;
const armBack = () => { if (!backTrap && G.mode !== 'title' && standalone()) { history.pushState({ br: 1 }, ''); backTrap = true; } };
['touchend', 'pointerup', 'click'].forEach(ev => window.addEventListener(ev, armBack, true));
window.addEventListener('popstate', () => { backTrap = false; if (G.mode === 'play') showPause(); });
