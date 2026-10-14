// ===== 描画（ワイヤーフレームの迷宮・地図） =====
const COL = { line: '#e9e6d8', door: '#e9e6d8', lock: '#ff8a65', bg: '#000', floor: '#7d8a6a', dim: '#3a3f35' };
const FONT = '"Noto Sans Mono CJK JP","Noto Sans CJK JP","Noto Sans JP",monospace';

function fitCanvas(cv) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function drawView(cv) {
  const { ctx, w: W, h: H } = fitCanvas(cv);
  ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, W, H);
  const { f, x, y, d } = S.pos;
  ctx.lineJoin = 'round';
  if (isDark(f, x, y)) {
    ctx.fillStyle = COL.dim; ctx.font = `16px ${FONT}`; ctx.textAlign = 'center';
    ctx.fillText('暗闇の中だ。何も見えない。', W / 2, H / 2);
    return;
  }
  const e = 0.75;
  const P = (X, z, Y) => [W / 2 + X * W * e / (z + e), H / 2 + Y * H * e / (z + e)];
  const R = (d + 1) & 3, L = (d + 3) & 3;
  let maxD = S.light > 0 ? 5 : 3;
  for (let dd = 1; dd <= maxD; dd++) {
    const cx = x + DX[d] * dd, cy = y + DY[d] * dd;
    if (!inb(cx, cy) || isDark(f, cx, cy)) { maxD = dd - 1; break; }
  }
  const lw = Math.max(1.2, W / 260);
  const poly = (pts, fill, stroke) => {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  };
  // 壁1枚：(X1,z1)-(X2,z2) の縦の面
  const wall = (X1, z1, X2, z2, v) => {
    if (v === W_OPEN) return;
    poly([P(X1, z1, -0.5), P(X2, z2, -0.5), P(X2, z2, 0.5), P(X1, z1, 0.5)], COL.bg, COL.line);
    if (v === W_DOOR || v === W_LOCK) {
      const at = (u, Y) => P(X1 + (X2 - X1) * u, z1 + (z2 - z1) * u, Y);
      poly([at(0.22, 0.5), at(0.22, -0.28), at(0.78, -0.28), at(0.78, 0.5)], null, v === W_LOCK ? COL.lock : COL.door);
      if (v === W_LOCK) {
        const k = at(0.66, 0.12), r = Math.max(1.5, (at(0.78, 0)[0] - at(0.22, 0)[0]) * 0.04);
        ctx.beginPath(); ctx.arc(k[0], k[1], Math.abs(r), 0, Math.PI * 2); ctx.fillStyle = COL.lock; ctx.fill();
      }
    }
  };
  const stairs = (dd, l, up) => {
    const a = P(l - 0.3, dd + 0.2, 0.5), b = P(l + 0.3, dd + 0.2, 0.5), c = P(l + 0.3, dd + 0.8, 0.5), e2 = P(l - 0.3, dd + 0.8, 0.5);
    poly([a, b, c, e2], null, COL.floor);
    for (let i = 1; i < 4; i++) {
      const z = dd + 0.2 + 0.15 * i;
      const p1 = P(l - 0.3, z, 0.5), p2 = P(l + 0.3, z, 0.5);
      ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.strokeStyle = COL.floor; ctx.lineWidth = lw; ctx.stroke();
    }
    if (dd <= 2) {
      const m = P(l, dd + 0.5, 0.5);
      const fs = Math.round(13 * (1.6 / (dd + 1.2)));
      ctx.font = `${fs}px ${FONT}`; ctx.textAlign = 'center';
      const tw = ctx.measureText('上り').width;
      ctx.fillStyle = COL.bg; ctx.fillRect(m[0] - tw / 2 - 3, m[1] - fs * 0.9, tw + 6, fs * 1.2);
      ctx.fillStyle = COL.floor; ctx.fillText(up ? '上り' : '下り', m[0], m[1]);
    }
  };
  const F = WORLD[f];
  for (let dd = maxD; dd >= 0; dd--) {
    for (const l of [-3, 3, -2, 2, -1, 1, 0]) {
      const cx = x + DX[d] * dd + DX[R] * l, cy = y + DY[d] * dd + DY[R] * l;
      if (!inb(cx, cy)) continue;
      if (dd > 0 && isDark(f, cx, cy)) continue;
      if (F.up && F.up.x === cx && F.up.y === cy) stairs(dd, l, true);
      if (F.down && F.down.x === cx && F.down.y === cy) stairs(dd, l, false);
      wall(l - 0.5, dd + 1, l + 0.5, dd + 1, viewWall(f, cx, cy, d));
      if (l <= 0) wall(l - 0.5, dd, l - 0.5, dd + 1, viewWall(f, cx, cy, L));
      if (l >= 0) wall(l + 0.5, dd, l + 0.5, dd + 1, viewWall(f, cx, cy, R));
    }
  }
}

// 地図
function drawMap(cv, f) {
  const { ctx, w: W, h: H } = fitCanvas(cv);
  ctx.fillStyle = '#050805'; ctx.fillRect(0, 0, W, H);
  const cs = Math.floor(Math.min(W, H) / MW), ox = Math.floor((W - cs * MW) / 2), oy = Math.floor((H - cs * MH) / 2);
  const F = WORLD[f];
  ctx.strokeStyle = '#1c241c'; ctx.lineWidth = 1;
  for (let i = 0; i <= MW; i++) {
    ctx.beginPath(); ctx.moveTo(ox + i * cs + 0.5, oy); ctx.lineTo(ox + i * cs + 0.5, oy + cs * MH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ox, oy + i * cs + 0.5); ctx.lineTo(ox + cs * MW, oy + i * cs + 0.5); ctx.stroke();
  }
  const seg = (x1, y1, x2, y2, col, w) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke(); };
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    if (!isSeen(f, x, y)) continue;
    const px = ox + x * cs, py = oy + y * cs;
    ctx.fillStyle = F.room[ci(x, y)] >= 0 ? '#22301f' : '#172016';
    ctx.fillRect(px + 1, py + 1, cs - 1, cs - 1);
    const sp = F.sp[ci(x, y)];
    for (let d = 0; d < 4; d++) {
      let v = getW(F, x, y, d);
      if (v === W_SECRET) v = secretFound(f, x, y, d) ? W_DOOR : W_WALL;
      if (v === W_OPEN) continue;
      const pts = [[px, py, px + cs, py], [px + cs, py, px + cs, py + cs], [px, py + cs, px + cs, py + cs], [px, py, px, py + cs]][d];
      seg(pts[0], pts[1], pts[2], pts[3], '#d8e6c8', 2);
      if (v === W_DOOR || v === W_LOCK) {
        const mx = (pts[0] + pts[2]) / 2, my = (pts[1] + pts[3]) / 2, q = cs * 0.22;
        if (d === 0 || d === 2) seg(mx - q, my, mx + q, my, v === W_LOCK ? COL.lock : '#7fb0ff', 3);
        else seg(mx, my - q, mx, my + q, v === W_LOCK ? COL.lock : '#7fb0ff', 3);
      }
    }
    let mark = '';
    if (F.up && F.up.x === x && F.up.y === y) mark = f === 1 ? '出' : '上';
    else if (F.down && F.down.x === x && F.down.y === y) mark = '下';
    else if (sp && sp.t === 'fount') mark = '泉';
    else if (sp && sp.t === 'msg') mark = '文';
    if (mark) {
      ctx.fillStyle = '#ffe082'; ctx.font = `${Math.floor(cs * 0.62)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(mark, px + cs / 2, py + cs / 2 + 1);
    }
  }
  // 亡骸
  for (const c of S.roster) if (c.maze && c.maze.f === f) {
    ctx.fillStyle = '#ff8a80'; ctx.font = `${Math.floor(cs * 0.7)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('†', ox + c.maze.x * cs + cs / 2, oy + c.maze.y * cs + cs / 2);
  }
  // 自分の位置
  if (S.inMaze && S.pos.f === f) {
    const cx = ox + S.pos.x * cs + cs / 2, cy = oy + S.pos.y * cs + cs / 2, r = cs * 0.38;
    const a = [-Math.PI / 2, 0, Math.PI / 2, Math.PI][S.pos.d];
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.lineTo(cx + Math.cos(a + 2.5) * r, cy + Math.sin(a + 2.5) * r);
    ctx.lineTo(cx + Math.cos(a - 2.5) * r, cy + Math.sin(a - 2.5) * r);
    ctx.closePath(); ctx.fillStyle = '#ffeb3b'; ctx.fill();
  }
  ctx.textBaseline = 'alphabetic';
}
