/* 相棒（#pal）を、指でドラッグして動かせるようにする。位置は覚えておく（面接アプリと「水面の記録」で別々）。
   動かしたあとの「押した」は、話しかけない。吹き出し（#pal-say）は、相棒のそばについていく。
   ダブルタップ（動かさずに素早く二回）で、元の場所に戻る。 */
(function () {
  const pal = document.getElementById("pal"), box = document.getElementById("pal-say");
  if (!pal) return;
  const KEY = "minamo.palpos." + (location.pathname.indexOf("story") >= 0 ? "story" : "talk");
  let moved = false, lastTap = 0;
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; } };
  const save = p => { try { p ? localStorage.setItem(KEY, JSON.stringify(p)) : localStorage.removeItem(KEY); } catch (e) { /* なくてもよい */ } };
  const clamp = (x, y) => {
    const w = pal.offsetWidth || 50, h = pal.offsetHeight || 50;
    return [Math.max(4, Math.min(innerWidth - w - 4, x)), Math.max(4, Math.min(innerHeight - h - 4, y))];
  };
  // 吹き出しを、相棒の左（右半分にいるとき）か右（左半分）、上寄せに置く
  function placeBubble() {
    if (!box || box.hidden || !pal.dataset.moved) return;
    const r = pal.getBoundingClientRect(), bw = box.offsetWidth, bh = box.offsetHeight;
    const onRight = r.left + r.width / 2 > innerWidth / 2;
    let left = onRight ? r.left - bw - 8 : r.right + 8, top = r.top + r.height / 2 > innerHeight / 2 ? r.bottom - bh : r.top;
    if (left < 4 || left + bw > innerWidth - 4) {          // 横に置く余地がない：相棒の上（なければ下）に出す
      left = onRight ? r.right - bw : r.left;
      top = r.top - bh - 8 >= 4 ? r.top - bh - 8 : r.bottom + 8;
    }
    box.style.right = "auto"; box.style.bottom = "auto";
    box.style.left = Math.max(4, Math.min(innerWidth - bw - 4, left)) + "px";
    box.style.top = Math.max(4, Math.min(innerHeight - bh - 4, top)) + "px";
  }
  function put(x, y) {
    [x, y] = clamp(x, y);
    pal.style.right = "auto"; pal.style.bottom = "auto";
    pal.style.left = x + "px"; pal.style.top = y + "px";
    pal.dataset.moved = "1";
    placeBubble();
  }
  function reset() {
    ["left", "top", "right", "bottom"].forEach(k => { pal.style[k] = ""; if (box) box.style[k] = ""; });
    delete pal.dataset.moved; save(null);
  }
  const saved = load();
  if (saved) put(saved.x * innerWidth, saved.y * innerHeight);
  addEventListener("resize", () => { const s = load(); if (s) put(s.x * innerWidth, s.y * innerHeight); });

  pal.style.touchAction = "none";
  let drag = null;
  pal.addEventListener("pointerdown", e => {
    const r = pal.getBoundingClientRect();
    drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top, sx: e.clientX, sy: e.clientY };
    moved = false;
    try { pal.setPointerCapture(e.pointerId); } catch (err) { /* なくてもよい */ }
  });
  pal.addEventListener("pointermove", e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 8) return;   // 8px 動くまでは「押した」
    moved = true;
    put(e.clientX - drag.dx, e.clientY - drag.dy);
  });
  const end = e => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    if (moved) {
      const r = pal.getBoundingClientRect();
      save({ x: r.left / innerWidth, y: r.top / innerHeight });
      return;
    }
    const now = Date.now();                              // 動かさなかった：二回続けて素早く押すと元に戻す
    if (now - lastTap < 350 && pal.dataset.moved) { reset(); lastTap = 0; e.preventDefault(); return; }
    lastTap = now;
  };
  pal.addEventListener("pointerup", end);
  pal.addEventListener("pointercancel", end);
  // 動かしたあとの click は、話しかけに使わせない（excess.js・story.js の click より先に止める）
  pal.addEventListener("click", e => { if (moved) { moved = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  if (box) {
    new MutationObserver(placeBubble).observe(box, { attributes: true, attributeFilter: ["hidden"], childList: true, subtree: true, characterData: true });
  }
})();
