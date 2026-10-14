// ===== 起動 =====
function boot() {
  buildWorld();
  scrTitle();
  let rt = null;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      if (UI.screen === 'maze') updateMaze();
      else if (UI.screen === 'map') { const m = $('#map'); if (m) drawMap(m, +($('.hdr span').textContent.match(/B(\d+)F/) || [0, S.pos.f])[1]); }
    }, 150);
  });
}
window.addEventListener('DOMContentLoaded', boot);
