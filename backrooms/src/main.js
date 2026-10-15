// ===== 起動と、毎フレームの処理 =====
let lastT = 0, perfAcc = 0, perfN = 0, perfWarned = false;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, Math.max(0, (now - lastT) / 1000)); lastT = now;
  if (!WD) return;
  if (G.mode === 'title') {
    G.t += dt; G.demoA += dt * 0.12;
    renderFrame(G.t, { x: START.x, y: START.y, a: G.demoA }, [], { noise: 0.06, fogMul: 1.2 });
    return;
  }
  if (!S) return;
  if (G.mode === 'play') update(dt);
  if (G.mode === 'trans') {
    G.t += dt; G.transT += dt;
    if (G.transT > 1.7 && !G.transDone) { G.transDone = true; finishTrans(); }
  }
  if (G.mode === 'play' || G.mode === 'trans' || G.needDraw) {
    const t0 = performance.now();
    renderFrame(G.t, S, sprites(), frameFx());
    G.needDraw = false;
    // 重いときは画質を下げる
    perfAcc += performance.now() - t0; perfN++;
    if (perfN >= 90) {
      if (perfAcc / perfN > 30 && OPT.q > 0) { OPT.q--; saveOpts(); setupRender($('#view'), OPT.q); toast('動きが重いので、画質を下げた'); }
      perfAcc = 0; perfN = 0;
    }
  }
  hud(dt);
}
function boot() {
  loadOpts();
  buildTextures();
  setupRender($('#view'), OPT.q);
  setupInput();
  let rt = null;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { setupRender($('#view'), OPT.q); G.needDraw = true; }, 150); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (G.mode === 'play') showPause(); saveGame(); audioSuspend(true); }
    else audioSuspend(false);
  });
  showTitle();
  // Tasker の関数があとから用意されたときは、タイトルを出し直す（「保存されない」の表示を消す）
  if (!storageOk()) setTimeout(() => { if (storageOk() && G.mode === 'title') { setupRender($('#view'), OPT.q); showTitle(); } }, 1000);
  requestAnimationFrame(t => { lastT = t; loop(t); });
}
window.addEventListener('DOMContentLoaded', boot);
// テスト用
window.DBG = {
  G, get S() { return S; }, get WD() { return WD; },
  toExit() { const e = WD.exit; S.x = e.fx + 0.5; S.y = e.fy + 0.5; S.a = Math.atan2(e.wy - e.fy, e.wx - e.fx); },
  level(n) { enterLevel(n, true); startPlay(); },
  spawn(type) { return trySpawn(type); },
};
