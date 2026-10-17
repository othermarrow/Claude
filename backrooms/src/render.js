// ===== 描画（レイキャスト） =====
const WH = 1.3;                                  // 天井の高さ（マスの幅を1として）
const RD = { cv: null, ctx: null, W: 0, H: 0, img: null, buf: null, z: null, top: null, bot: null, beam: null, vig: null, pl: 0.75, vs: 300 };
const LG = 60;                                   // 灯りを計算する範囲（マス）
const LGRID = new Float32Array(LG * LG);         // 各マスの明るさ
const PGRID = new Float32Array((LG + 4) * (LG + 4));
const LAMPS = new Uint8Array((LG + 4) * (LG + 4));
let lox = 0, loy = 0, lampOx = 1e9, lampOy = 1e9, lampLv = -1, lampSeed = 0;
const CW = 72, CWIN = new Uint8Array(CW * CW);   // 壁の早見表
let cwx = 1e9, cwy = 1e9, cwLv = -1, cwSeed = 0;

function setupRender(cv, quality) {
  RD.cv = cv;
  const cssW = Math.max(1, cv.clientWidth), cssH = Math.max(1, cv.clientHeight);
  let scale = [2.8, 2.0, 1.5][quality] || 2.0;
  let W = Math.round(cssW / scale), H = Math.round(cssH / scale);
  while (W * H > 150000) { scale *= 1.1; W = Math.round(cssW / scale); H = Math.round(cssH / scale); }
  W = Math.max(80, W); H = Math.max(60, H);
  cv.width = W; cv.height = H;
  RD.W = W; RD.H = H;
  RD.ctx = cv.getContext('2d');
  RD.img = RD.ctx.createImageData(W, H);
  RD.buf = new Uint32Array(RD.img.data.buffer);
  RD.z = new Float32Array(W); RD.top = new Int16Array(W); RD.bot = new Int16Array(W);
  // 縦向き：横の視野76°、高さは横幅に合わせる（壁が高く見える）。
  // 横向き：横の視野を100°に広げ、高さは見たままの比率に近づける（壁で画面が埋まらないように）
  const land = W > H;
  RD.pl = Math.tan((land ? 100 : 76) * Math.PI / 360);
  RD.vs = land ? W / (2 * RD.pl) * 1.05 : W / RD.pl;      // 1マス先の、高さ1あたりの画面の点の数
  RD.beam = new Float32Array(W * H); RD.vig = new Float32Array(W * H);
  const r = land ? RD.vs * 0.43 : W * 0.55, cx = W / 2, cy = H * 0.5, R2 = Math.hypot(W / 2, H / 2);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d2 = ((x - cx) ** 2 + (y - cy) ** 2) / (r * r);
    RD.beam[y * W + x] = Math.pow(Math.max(0, 1 - d2), 0.8) + 0.06;
    const v = Math.hypot(x - cx, y - cy) / R2;
    RD.vig[y * W + x] = 1 - Math.pow(v, 2.2) * 0.55;
  }
}

function wallFast(x, y) {
  const ix = x - cwx, iy = y - cwy;
  if (ix >= 0 && iy >= 0 && ix < CW && iy < CW) return CWIN[iy * CW + ix];
  return cellAt(x, y);
}
function refreshCaches(px, py) {
  const nx = Math.floor(px) - (CW >> 1), ny = Math.floor(py) - (CW >> 1);
  if (nx !== cwx || ny !== cwy || cwLv !== WD.lv || cwSeed !== WD.seed) {
    cwx = nx; cwy = ny; cwLv = WD.lv; cwSeed = WD.seed;
    for (let y = 0; y < CW; y++) for (let x = 0; x < CW; x++) CWIN[y * CW + x] = cellAt(cwx + x, cwy + y);
  }
  lox = Math.floor(px) - (LG >> 1); loy = Math.floor(py) - (LG >> 1);
  if (lox !== lampOx || loy !== lampOy || lampLv !== WD.lv || lampSeed !== WD.seed) {
    lampOx = lox; lampOy = loy; lampLv = WD.lv; lampSeed = WD.seed;
    const S4 = LG + 4;
    for (let j = 0; j < S4; j++) for (let i = 0; i < S4; i++) LAMPS[j * S4 + i] = lampAt(lox - 2 + i, loy - 2 + j);
  }
}
// ちらつく灯りの明るさ
function flickAt(X, Y, t) {
  const s = WD.seed + 9;
  if (hash3(s, X, Y + Math.floor(t / 2.5) * 977) < 0.35) return hash3(s + 1, X, Math.floor(t * 9)) < 0.06 ? 0.8 : 0.03;
  const v = hash3(s + 2, X * 131 + Math.floor(t * 13), Y);
  return v < 0.22 ? 0.04 : v < 0.32 ? 0.45 : 1;
}
const KER = [];
for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
  const d = Math.hypot(dx, dy);
  KER.push([dx, dy, d === 0 ? 0.95 : d < 1.1 ? 0.7 : d < 1.5 ? 0.55 : d < 2.1 ? 0.33 : d < 2.3 ? 0.26 : 0.15]);
}
function updateLight(t) {
  const S4 = LG + 4, amb = WD.cfg.amb, lk = (WD.cfg.lampK || 1) * (typeof G !== 'undefined' && G.blackout ? 0 : 1);
  for (let j = 0; j < S4; j++) for (let i = 0; i < S4; i++) {
    const k = j * S4 + i, ty = LAMPS[k];
    PGRID[k] = (ty === 1 ? 1 : ty === 2 ? flickAt(lox - 2 + i, loy - 2 + j, t) : 0) * lk;
  }
  for (let j = 0; j < LG; j++) for (let i = 0; i < LG; i++) {
    let s = amb;
    for (let q = 0; q < 25; q++) { const kk = KER[q]; s += PGRID[(j + 2 + kk[1]) * S4 + (i + 2 + kk[0])] * kk[2]; }
    LGRID[j * LG + i] = s > 1.25 ? 1.25 : s;
  }
}
function lightAt(fx, fy) {
  const gx = fx - 0.5 - lox, gy = fy - 0.5 - loy;
  const ix = Math.floor(gx), iy = Math.floor(gy);
  if (ix < 0 || iy < 0 || ix >= LG - 1 || iy >= LG - 1) return WD.cfg.amb;
  const tx = gx - ix, ty = gy - iy, i = iy * LG + ix;
  const a = LGRID[i], b = LGRID[i + 1], c = LGRID[i + LG], d = LGRID[i + LG + 1];
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}
function lampBright(X, Y) {   // 天井の灯りの明るさ（灯りがなければ -1）
  const S4 = LG + 4, i = X - lox + 2, j = Y - loy + 2;
  if (i < 0 || j < 0 || i >= S4 || j >= S4) return -1;
  return LAMPS[j * S4 + i] ? PGRID[j * S4 + i] / (WD.cfg.lampK || 1) : -1;
}

// ---- 線だけの見た目（ウィザードリィ風） ----
const LC = {};                                   // 1フレームぶんの、線を引くための値
const WFACE = [], WSEEN = new Set();             // 見えている壁の面（x, y, 向き）
function texAvg(tex, emOnly) {                   // 絵の平均の色（いちばん明るい色を255にそろえる）
  const key = emOnly ? 'avgE' : 'avg';
  if (tex[key]) return tex[key];
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < tex.w * tex.h; i++) {
    if (tex.d[i * 4 + 3] < 110 || (emOnly && !tex.em[i])) continue;
    r += tex.d[i * 4]; g += tex.d[i * 4 + 1]; b += tex.d[i * 4 + 2]; n++;
  }
  if (!n) return (tex[key] = [235, 235, 225]);
  const m = Math.max(r, g, b, 1) / 255;
  return (tex[key] = [r / m, g / m, b / m]);
}
function wPlot(i, r, g, b) {                     // 重なったら明るいほうを残す
  const c = RD.buf[i];
  if (r + g + b <= (c & 255) + ((c >> 8) & 255) + ((c >> 16) & 255)) return;
  RD.buf[i] = (255 << 24) | ((b > 255 ? 255 : b) << 16) | ((g > 255 ? 255 : g) << 8) | (r > 255 ? 255 : r);
}
// 3D の線（床から高さ h の点 a → b）を、壁に隠れるところは描かずに引く。
// la, lb：両端の明るさ。em があれば、その色で自分で光る線
function wLine(ax, ay, ah, bx, by, bh, la, lb, em) {
  const C = LC;
  let dx = ax - C.px, dy = ay - C.py;
  let aX = C.inv * (C.dirY * dx - C.dirX * dy), aY = C.inv * (-C.planeY * dx + C.planeX * dy);
  dx = bx - C.px; dy = by - C.py;
  let bX = C.inv * (C.dirY * dx - C.dirX * dy), bY = C.inv * (-C.planeY * dx + C.planeX * dy);
  const N = 0.06;
  if (aY < N && bY < N) return;
  if (aY < N) { const q = (N - aY) / (bY - aY); aX += (bX - aX) * q; ah += (bh - ah) * q; la += (lb - la) * q; aY = N; }
  else if (bY < N) { const q = (N - bY) / (aY - bY); bX += (aX - bX) * q; bh += (ah - bh) * q; lb += (la - lb) * q; bY = N; }
  if (aY > 34 && bY > 34) return;
  const W = C.W, H = C.H, k = C.vs;
  const x0 = W / 2 * (1 + aX / aY), y0 = C.hor + (WH * 0.5 - ah) * k / aY, z0 = 1 / aY;
  const x1 = W / 2 * (1 + bX / bY), y1 = C.hor + (WH * 0.5 - bh) * k / bY, z1 = 1 / bY;
  // 画面の外を切る
  let t0 = 0, t1 = 1;
  const ddx = x1 - x0, ddy = y1 - y0;
  const P = [-ddx, ddx, -ddy, ddy], Q = [x0 + 0.49, W - 0.51 - x0, y0 + 0.49, H - 0.51 - y0];
  for (let i = 0; i < 4; i++) {
    if (P[i] === 0) { if (Q[i] < 0) return; continue; }
    const r = Q[i] / P[i];
    if (P[i] < 0) { if (r > t1) return; if (r > t0) t0 = r; } else { if (r < t0) return; if (r < t1) t1 = r; }
  }
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(ddx), Math.abs(ddy)) * (t1 - t0)));
  const Z = C.Z, BEAM = RD.beam;
  for (let i = 0; i <= n; i++) {
    const t = t0 + (t1 - t0) * i / n;
    const x = Math.round(x0 + ddx * t), y = Math.round(y0 + ddy * t);
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const iz = z0 + (z1 - z0) * t, d = 1 / iz;
    const zl = x > 0 ? Z[x - 1] : Z[x], zr = x < W - 1 ? Z[x + 1] : Z[x];
    if (d > Math.max(Z[x], zl, zr) * 1.02 + 0.03) continue;      // 壁の向こう
    const j = y * W + x;
    if (em) { const fe = Math.exp(-d * C.fogK * 0.4); wPlot(j, em[0] * fe, em[1] * fe, em[2] * fe); continue; }
    const u = t * z1 / ((1 - t) * z0 + t * z1);
    const l = la + (lb - la) * u, f = Math.exp(-d * C.fogK), fl = C.flash / (1 + d * d * 0.035);
    const bm = fl * BEAM[j] * (1.1 - (l > 1 ? 0.75 : l * 0.75));
    wPlot(j, C.cR * (l * C.tR + bm) * f, C.cG * (l * C.tG + bm * 0.97) * f, C.cB * (l * C.tB + bm * 0.86) * f);
  }
}
function wireScene(t, cfg) {
  const C = LC, F = WFACE, ex = WD.exit;
  // 壁の面：上と下のふち、両はしの縦の線
  for (let i = 0; i < F.length; i += 3) {
    const mx = F[i], my = F[i + 1], fc = F[i + 2];
    let ax, ay, bx, by, ox = 0, oy = 0;
    if (fc === 0) { ax = mx; ay = my; bx = mx + 1; by = my; oy = -0.04; }
    else if (fc === 2) { ax = mx; ay = my + 1; bx = mx + 1; by = my + 1; oy = 0.04; }
    else if (fc === 3) { ax = mx; ay = my; bx = mx; by = my + 1; ox = -0.04; }
    else { ax = mx + 1; ay = my; bx = mx + 1; by = my + 1; ox = 0.04; }
    const la = lightAt(ax + ox, ay + oy), lb = lightAt(bx + ox, by + oy);
    wLine(ax, ay, 0, bx, by, 0, la, lb);
    wLine(ax, ay, WH, bx, by, WH, la, lb);
    wLine(ax, ay, 0, ax, ay, WH, la, la);
    wLine(bx, by, 0, bx, by, WH, lb, lb);
    // 出口：壁に扉の形を、出口の光の色で
    if (ex && mx === ex.wx && my === ex.wy && fc === ex.face) {
      const em = C.exitC, px = (u, k) => [ax + (bx - ax) * u + ox * k, ay + (by - ay) * u + oy * k];
      for (const [u0, u1, h1] of [[0.24, 0.76, WH * 0.74], [0.3, 0.7, WH * 0.68]]) {
        const p0 = px(u0, 0.5), p1 = px(u1, 0.5);
        wLine(p0[0], p0[1], 0, p0[0], p0[1], h1, 0, 0, em);
        wLine(p1[0], p1[1], 0, p1[0], p1[1], h1, 0, 0, em);
        wLine(p0[0], p0[1], h1, p1[0], p1[1], h1, 0, 0, em);
      }
      const s0 = px(0.36, 0.5), s1 = px(0.64, 0.5);
      wLine(s0[0], s0[1], WH * 0.84, s1[0], s1[1], WH * 0.84, 0, 0, em);
      wLine(s0[0], s0[1], WH * 0.93, s1[0], s1[1], WH * 0.93, 0, 0, em);
    }
  }
  // 天井の灯り：四角いふちだけ。ちらつきはそのまま（空の Level では描かない）
  if (cfg.sky) return;
  const R = 13, cx = Math.floor(C.px), cy = Math.floor(C.py);
  for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
    const X = cx + i, Y = cy + j, lb = lampBright(X, Y);
    if (lb < 0 || (X + 0.5 - C.px) * C.dirX + (Y + 0.5 - C.py) * C.dirY < -0.6) continue;
    const v = lb < 0.08 ? 0.22 : Math.min(1, lb), em = [C.pR * v, C.pG * v, C.pB * v];
    const x0 = X + 0.18, x1 = X + 0.82, y0 = Y + 0.34, y1 = Y + 0.66;
    wLine(x0, y0, WH, x1, y0, WH, 0, 0, em); wLine(x1, y0, WH, x1, y1, WH, 0, 0, em);
    wLine(x1, y1, WH, x0, y1, WH, 0, 0, em); wLine(x0, y1, WH, x0, y0, WH, 0, 0, em);
  }
}

function renderFrame(t, cam, sprites, fx) {
  const W = RD.W, H = RD.H, buf = RD.buf, Z = RD.z, TOP = RD.top, BOT = RD.bot, BEAM = RD.beam, pl = RD.pl, vs = RD.vs;
  const cfg = WD.cfg, px = cam.x, py = cam.y;
  refreshCaches(px, py); updateLight(t);
  const dirX = Math.cos(cam.a), dirY = Math.sin(cam.a), planeX = -dirY * pl, planeY = dirX * pl;
  const hor = H / 2 + (fx.bob || 0) * H * 0.012;
  const tR = cfg.light[0] / 255, tG = cfg.light[1] / 255, tB = cfg.light[2] / 255;
  const wire = !!(typeof OPT !== 'undefined' && OPT.wire);       // 線だけの見た目
  const fogR = wire ? 0 : cfg.fog[0], fogG = wire ? 0 : cfg.fog[1], fogB = wire ? 0 : cfg.fog[2], fogK = cfg.fogK * (fx.fogMul || 1);
  const flash = fx.flash || 0;
  const wt = TEX[cfg.tex.wall], et = TEX[cfg.tex.exit], ft = TEX[cfg.tex.floor], ctt = TEX[cfg.tex.ceil];
  const ex = WD.exit;
  const fogPix = (255 << 24) | (fogB << 16) | (fogG << 8) | fogR;
  const pR = Math.min(255, 255 * tR * 1.05), pG = Math.min(255, 255 * tG * 1.05), pB = Math.min(255, 255 * tB * 1.05);
  if (wire) {
    buf.fill(0xff000000); WSEEN.clear(); WFACE.length = 0;
    const wc = texAvg(wt);
    Object.assign(LC, { px, py, dirX, dirY, planeX, planeY, inv: 1 / (planeX * dirY - dirX * planeY), W, H, pl, vs, hor, Z, fogK, flash, tR, tG, tB, pR, pG, pB,
      cR: 120 + wc[0] * 0.5, cG: 120 + wc[1] * 0.5, cB: 120 + wc[2] * 0.5, exitC: texAvg(et, true) });
  }
  let lastKey = -1;
  // ---- 壁 ----
  for (let x = 0; x < W; x++) {
    const camX = 2 * x / W - 1, rdx = dirX + planeX * camX, rdy = dirY + planeY * camX;
    let mx = Math.floor(px), my = Math.floor(py);
    const ddx = Math.abs(1 / (rdx || 1e-9)), ddy = Math.abs(1 / (rdy || 1e-9));
    const sx = rdx < 0 ? -1 : 1, sy = rdy < 0 ? -1 : 1;
    let sdx = (rdx < 0 ? px - mx : mx + 1 - px) * ddx, sdy = (rdy < 0 ? py - my : my + 1 - py) * ddy;
    let side = 0, hit = false, perp = 40;
    for (let s = 0; s < 90; s++) {
      if (sdx < sdy) { sdx += ddx; mx += sx; side = 0; } else { sdy += ddy; my += sy; side = 1; }
      if (wallFast(mx, my) === 1) { hit = true; break; }
      if ((side === 0 ? sdx - ddx : sdy - ddy) > 32) break;
    }
    if (hit) perp = side === 0 ? sdx - ddx : sdy - ddy;
    if (perp < 0.04) perp = 0.04;
    Z[x] = hit ? perp : 1e9;
    if (!hit) { TOP[x] = Math.round(hor); BOT[x] = Math.round(hor) - 1; continue; }
    const lineH = WH * vs / perp, top = hor - lineH / 2;
    const ds = Math.max(0, Math.ceil(top)), de = Math.min(H - 1, Math.floor(hor + lineH / 2));
    TOP[x] = ds; BOT[x] = de;
    const hx = px + rdx * perp, hy = py + rdy * perp;
    let wx = side === 0 ? hy - Math.floor(hy) : hx - Math.floor(hx);
    let tx = (wx * 64) | 0;
    if ((side === 0 && rdx < 0) || (side === 1 && rdy > 0)) tx = 63 - tx;
    const face = side === 0 ? (sx > 0 ? 3 : 1) : (sy > 0 ? 0 : 2);
    if (wire) {
      const key = ((mx + 32768) * 65536 + (my + 32768)) * 4 + face;
      if (key !== lastKey) { lastKey = key; if (!WSEEN.has(key)) { WSEEN.add(key); WFACE.push(mx, my, face); } }
      continue;
    }
    const tex = (ex && mx === ex.wx && my === ex.wy && face === ex.face) ? et : wt;
    const td = tex.d, tem = tex.em;
    const l = lightAt(hx - rdx * 0.03, hy - rdy * 0.03) * (side ? 0.86 : 1);
    const f = Math.exp(-perp * fogK), f1 = 1 - f, fe = Math.exp(-perp * fogK * 0.4), fe1 = 1 - fe;
    const fl = flash / (1 + perp * perp * 0.035);
    const step = 64 / lineH;
    let ty = (ds - top) * step;
    for (let y = ds; y <= de; y++, ty += step) {
      const ti = ((ty | 0) & 63) * 64 + tx, k = ti * 4;
      let r, g, b;
      if (tem[ti]) { r = td[k] * fe + fogR * fe1; g = td[k + 1] * fe + fogG * fe1; b = td[k + 2] * fe + fogB * fe1; }
      else {
        const bm = fl * BEAM[y * W + x] * (1.1 - (l > 1 ? 0.75 : l * 0.75));
        r = td[k] * (l * tR + bm) * f + fogR * f1; g = td[k + 1] * (l * tG + bm * 0.97) * f + fogG * f1; b = td[k + 2] * (l * tB + bm * 0.86) * f + fogB * f1;
      }
      buf[y * W + x] = (255 << 24) | ((b > 255 ? 255 : b) << 16) | ((g > 255 ? 255 : g) << 8) | (r > 255 ? 255 : r);
    }
  }
  // ---- 床と天井 ----
  const rdxL = dirX - planeX, rdyL = dirY - planeY, rdxR = dirX + planeX, rdyR = dirY + planeY;
  const fd = ft.d, cd = ctt.d, shimmer = cfg.calm || cfg.shimmer ? 1 : 0;
  if (wire) wireScene(t, cfg);
  const blob = cfg.lampStyle === 'blob';   // 洞窟：灯りは丸く光るもの（菌類など）
  const sky = cfg.sky;   // 外の Level：天井のかわりに空（上ほど暗い色、星）
  for (let y = 0; y < (wire ? 0 : H); y++) {
    const isFloor = y > hor;
    if (sky && !isFloor) {
      const tt = clamp(y / Math.max(1, hor), 0, 1), T0 = sky.top, T1 = sky.hor;
      const r0 = T0[0] + (T1[0] - T0[0]) * tt, g0 = T0[1] + (T1[1] - T0[1]) * tt, b0 = T0[2] + (T1[2] - T0[2]) * tt;
      for (let x = 0; x < W; x++) {
        if (y >= TOP[x]) continue;
        let r = r0, g = g0, b = b0;
        if (sky.stars && hash3(77, Math.floor((cam.a + Math.atan((2 * x / W - 1) * pl)) * 260), y) > 0.995) { r = 190; g = 196; b = 210; }
        buf[y * W + x] = (255 << 24) | (b << 16) | (g << 8) | r;
      }
      continue;
    }
    const p = isFloor ? y + 0.5 - hor : hor - y - 0.5;
    if (p <= 0.3) { for (let x = 0; x < W; x++) if (y < TOP[x] || y > BOT[x]) buf[y * W + x] = fogPix; continue; }
    const rowD = WH * 0.5 * vs / p;
    if (rowD > 34) { for (let x = 0; x < W; x++) if (y < TOP[x] || y > BOT[x]) buf[y * W + x] = fogPix; continue; }
    let wx = px + rowD * rdxL, wy = py + rowD * rdyL;
    const stx = rowD * (rdxR - rdxL) / W, sty = rowD * (rdyR - rdyL) / W;
    const f = Math.exp(-rowD * fogK), f1 = 1 - f, fe = Math.exp(-rowD * fogK * 0.4), fe1 = 1 - fe;
    const fl = flash / (1 + rowD * rowD * 0.035);
    for (let x = 0; x < W; x++, wx += stx, wy += sty) {
      if (isFloor ? y <= BOT[x] : y >= TOP[x]) continue;
      const cx = Math.floor(wx), cy = Math.floor(wy), ux = wx - cx, uy = wy - cy;
      const ti = (((uy * 64) | 0) & 63) * 64 + (((ux * 64) | 0) & 63), k = ti * 4;
      let r, g, b;
      if (!isFloor) {
        const lb = lampBright(cx, cy);
        if (lb >= 0 && (blob ? (ux - 0.5) * (ux - 0.5) + (uy - 0.5) * (uy - 0.5) < 0.05 : ux > 0.18 && ux < 0.82 && uy > 0.34 && uy < 0.66)) {
          const lv = lb < 0.08 ? 0.28 : lb;
          const lou = blob ? 0.75 + 0.25 * Math.sin(ux * 9 + uy * 7) : (((ux * 20) | 0) & 3) === 0 ? 0.82 : 1;
          const base = lb < 0.08 ? 70 : 255;
          r = (lb < 0.08 ? base : pR) * lv * lou; g = (lb < 0.08 ? base : pG) * lv * lou; b = (lb < 0.08 ? base : pB) * lv * lou;
          r = r * fe + fogR * fe1; g = g * fe + fogG * fe1; b = b * fe + fogB * fe1;
          buf[y * W + x] = (255 << 24) | ((b > 255 ? 255 : b) << 16) | ((g > 255 ? 255 : g) << 8) | (r > 255 ? 255 : r);
          continue;
        }
      }
      // 明るさ（その場で双線形）
      const gx = wx - 0.5 - lox, gy = wy - 0.5 - loy, ix = Math.floor(gx), iy = Math.floor(gy);
      let l;
      if (ix < 0 || iy < 0 || ix >= LG - 1 || iy >= LG - 1) l = cfg.amb;
      else {
        const qx = gx - ix, qy = gy - iy, i = iy * LG + ix;
        const a0 = LGRID[i], a1 = LGRID[i + 1], a2 = LGRID[i + LG], a3 = LGRID[i + LG + 1];
        l = (a0 + (a1 - a0) * qx) * (1 - qy) + (a2 + (a3 - a2) * qx) * qy;
      }
      if (!isFloor) l *= 0.8;
      else if (shimmer) l *= 1 + 0.09 * Math.sin(wx * 4.1 + t * 1.4) * Math.sin(wy * 3.7 - t * 1.1);
      const bm = fl * BEAM[y * W + x] * (1.1 - (l > 1 ? 0.75 : l * 0.75));
      const d = isFloor ? fd : cd;
      r = d[k] * (l * tR + bm) * f + fogR * f1; g = d[k + 1] * (l * tG + bm * 0.97) * f + fogG * f1; b = d[k + 2] * (l * tB + bm * 0.86) * f + fogB * f1;
      buf[y * W + x] = (255 << 24) | ((b > 255 ? 255 : b) << 16) | ((g > 255 ? 255 : g) << 8) | (r > 255 ? 255 : r);
    }
  }
  // ---- 物と怪物 ----
  const invDet = 1 / (planeX * dirY - dirX * planeY);
  const vis = [];
  for (const s of sprites) {
    const dx = s.x - px, dy = s.y - py;
    const tX = invDet * (dirY * dx - dirX * dy), tY = invDet * (-planeY * dx + planeX * dy);
    if (tY < 0.12 || tY > 30) continue;
    vis.push({ s, tX, tY });
  }
  vis.sort((a, b) => b.tY - a.tY);
  for (const v of vis) {
    const s = v.s, tex = TEX[s.spr], tY = v.tY;
    const unit = vs / tY;
    const sh = s.h * unit, sw = sh * tex.w / tex.h;
    const scrX = (W / 2) * (1 + v.tX / tY);
    const floorY = hor + WH * 0.5 * unit - (s.lift || 0) * unit;
    const top = floorY - sh, x0 = scrX - sw / 2;
    const l = s.emit ? 1 : lightAt(s.x, s.y);
    const f = Math.exp(-tY * fogK), f1 = 1 - f, fe = Math.exp(-tY * fogK * 0.4), fe1 = 1 - fe;
    const fl = flash / (1 + tY * tY * 0.035);
    const td = tex.d, tem = tex.em, tw = tex.w, th = tex.h;
    const xs = Math.max(0, Math.ceil(x0)), xe = Math.min(W - 1, Math.floor(x0 + sw));
    const ys = Math.max(0, Math.ceil(top)), ye = Math.min(H - 1, Math.floor(floorY));
    const op = (x, y) => {                       // その画面の点に、絵があるか
      const a = Math.floor((x - x0) / sw * tw), b = Math.floor((y - top) / sh * th);
      return a >= 0 && b >= 0 && a < tw && b < th && td[(b * tw + a) * 4 + 3] >= 110;
    };
    for (let x = xs; x <= xe; x++) {
      if (tY >= Z[x]) continue;
      const tx = Math.min(tw - 1, ((x - x0) / sw * tw) | 0);
      for (let y = ys; y <= ye; y++) {
        const tyy = Math.min(th - 1, ((y - top) / sh * th) | 0), ti = tyy * tw + tx, k = ti * 4;
        if (td[k + 3] < 110) continue;
        let r, g, b;
        if (tem[ti]) { const gl = s.glow == null ? 1 : s.glow; r = td[k] * gl * fe + fogR * fe1; g = td[k + 1] * gl * fe + fogG * fe1; b = td[k + 2] * gl * fe + fogB * fe1; }
        else if (wire) {
          if (op(x - 1, y) && op(x + 1, y) && op(x, y - 1) && op(x, y + 1)) { buf[y * W + x] = 0xff000000; continue; }
          const bm = fl * BEAM[y * W + x] * (1.1 - (l > 1 ? 0.75 : l * 0.75));
          r = LC.cR * (l * tR + bm) * f; g = LC.cG * (l * tG + bm) * f; b = LC.cB * (l * tB + bm) * f;
        } else {
          const bm = fl * BEAM[y * W + x] * (1.1 - (l > 1 ? 0.75 : l * 0.75));
          r = td[k] * (l * tR + bm) * f + fogR * f1; g = td[k + 1] * (l * tG + bm) * f + fogG * f1; b = td[k + 2] * (l * tB + bm) * f + fogB * f1;
        }
        buf[y * W + x] = (255 << 24) | ((b > 255 ? 255 : b) << 16) | ((g > 255 ? 255 : g) << 8) | (r > 255 ? 255 : r);
      }
    }
  }
  // ---- 仕上げ（周辺を暗く・ざらつき・ゆがみ） ----
  const VIG = RD.vig, noise = fx.noise || 0, dark = fx.dark || 0, desat = fx.desat || 0, yel = fx.yellow || 0;
  let seed = (t * 1e4) | 0;
  const glitch = fx.glitch || 0;
  for (let y = 0; y < H; y++) {
    let shift = 0;
    if (glitch && ((hash3(7, y >> 2, Math.floor(t * 8)) * 100) | 0) < glitch * 18) shift = ((hash3(8, y, Math.floor(t * 8)) - 0.5) * W * 0.06) | 0;
    const row = y * W;
    if (shift) { const tmp = buf.slice(row, row + W); for (let x = 0; x < W; x++) buf[row + x] = tmp[(x - shift + W) % W]; }
    for (let x = 0; x < W; x++) {
      const i = row + x, c = buf[i];
      let m = VIG[i] * (1 - dark);
      let r = (c & 255) * m, g = ((c >> 8) & 255) * m, b = ((c >> 16) & 255) * m;
      if (desat) { const gy = (r + g + b) / 3; r += (gy - r) * desat; g += (gy - g) * desat; b += (gy - b) * desat; }
      if (yel) { const gy = r * 0.3 + g * 0.59 + b * 0.11; r += (gy * 1.1 - r) * yel; g += (gy * 0.98 - g) * yel; b += (gy * 0.42 - b) * yel; }
      if (noise) { seed = (seed * 1664525 + 1013904223) | 0; const n = ((seed >>> 24) - 128) * noise; r += n; g += n; b += n; }
      r = r < 0 ? 0 : r > 255 ? 255 : r; g = g < 0 ? 0 : g > 255 ? 255 : g; b = b < 0 ? 0 : b > 255 ? 255 : b;
      buf[i] = (255 << 24) | (b << 16) | (g << 8) | r;
    }
  }
  RD.ctx.putImageData(RD.img, 0, 0);
}
