// ===== 描画（レイキャスト） =====
const WH = 1.3;                                  // 天井の高さ（マスの幅を1として）
const RD = { cv: null, ctx: null, W: 0, H: 0, img: null, buf: null, z: null, top: null, bot: null, beam: null, vig: null, pl: 0.75 };
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
  RD.pl = Math.tan((H > W ? 76 : 66) * Math.PI / 360);
  RD.beam = new Float32Array(W * H); RD.vig = new Float32Array(W * H);
  const r = W * 0.55, cx = W / 2, cy = H * 0.5, R2 = Math.hypot(W / 2, H / 2);
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
  const S4 = LG + 4, amb = WD.cfg.amb, lk = WD.cfg.lampK || 1;
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

function renderFrame(t, cam, sprites, fx) {
  const W = RD.W, H = RD.H, buf = RD.buf, Z = RD.z, TOP = RD.top, BOT = RD.bot, BEAM = RD.beam, pl = RD.pl;
  const cfg = WD.cfg, px = cam.x, py = cam.y;
  refreshCaches(px, py); updateLight(t);
  const dirX = Math.cos(cam.a), dirY = Math.sin(cam.a), planeX = -dirY * pl, planeY = dirX * pl;
  const hor = H / 2 + (fx.bob || 0) * H * 0.012;
  const tR = cfg.light[0] / 255, tG = cfg.light[1] / 255, tB = cfg.light[2] / 255;
  const fogR = cfg.fog[0], fogG = cfg.fog[1], fogB = cfg.fog[2], fogK = cfg.fogK * (fx.fogMul || 1);
  const flash = fx.flash || 0;
  const wt = TEX[cfg.tex.wall], et = TEX[cfg.tex.exit], ft = TEX[cfg.tex.floor], ctt = TEX[cfg.tex.ceil];
  const ex = WD.exit;
  const fogPix = (255 << 24) | (fogB << 16) | (fogG << 8) | fogR;
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
    const lineH = W * WH / (perp * pl), top = hor - lineH / 2;
    const ds = Math.max(0, Math.ceil(top)), de = Math.min(H - 1, Math.floor(hor + lineH / 2));
    TOP[x] = ds; BOT[x] = de;
    const hx = px + rdx * perp, hy = py + rdy * perp;
    let wx = side === 0 ? hy - Math.floor(hy) : hx - Math.floor(hx);
    let tx = (wx * 64) | 0;
    if ((side === 0 && rdx < 0) || (side === 1 && rdy > 0)) tx = 63 - tx;
    const face = side === 0 ? (sx > 0 ? 3 : 1) : (sy > 0 ? 0 : 2);
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
  const fd = ft.d, cd = ctt.d, shimmer = cfg.calm ? 1 : 0;
  const pR = Math.min(255, 255 * tR * 1.05), pG = Math.min(255, 255 * tG * 1.05), pB = Math.min(255, 255 * tB * 1.05);
  for (let y = 0; y < H; y++) {
    const isFloor = y > hor;
    const p = isFloor ? y + 0.5 - hor : hor - y - 0.5;
    if (p <= 0.3) { for (let x = 0; x < W; x++) if (y < TOP[x] || y > BOT[x]) buf[y * W + x] = fogPix; continue; }
    const rowD = WH * 0.5 * W / (pl * p);
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
        if (lb >= 0 && ux > 0.18 && ux < 0.82 && uy > 0.34 && uy < 0.66) {
          const lv = lb < 0.08 ? 0.28 : lb;
          const lou = (((ux * 20) | 0) & 3) === 0 ? 0.82 : 1;
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
    const unit = W / (tY * pl);
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
    for (let x = xs; x <= xe; x++) {
      if (tY >= Z[x]) continue;
      const tx = Math.min(tw - 1, ((x - x0) / sw * tw) | 0);
      for (let y = ys; y <= ye; y++) {
        const tyy = Math.min(th - 1, ((y - top) / sh * th) | 0), ti = tyy * tw + tx, k = ti * 4;
        if (td[k + 3] < 110) continue;
        let r, g, b;
        if (tem[ti]) { const gl = s.glow == null ? 1 : s.glow; r = td[k] * gl * fe + fogR * fe1; g = td[k + 1] * gl * fe + fogG * fe1; b = td[k + 2] * gl * fe + fogB * fe1; }
        else {
          const bm = fl * BEAM[y * W + x] * (1.1 - (l > 1 ? 0.75 : l * 0.75));
          r = td[k] * (l * tR + bm) * f + fogR * f1; g = td[k + 1] * (l * tG + bm) * f + fogG * f1; b = td[k + 2] * (l * tB + bm) * f + fogB * f1;
        }
        buf[y * W + x] = (255 << 24) | ((b > 255 ? 255 : b) << 16) | ((g > 255 ? 255 : g) << 8) | (r > 255 ? 255 : r);
      }
    }
  }
  // ---- 仕上げ（周辺を暗く・ざらつき・ゆがみ） ----
  const VIG = RD.vig, noise = fx.noise || 0, dark = fx.dark || 0;
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
      if (noise) { seed = (seed * 1664525 + 1013904223) | 0; const n = ((seed >>> 24) - 128) * noise; r += n; g += n; b += n; }
      r = r < 0 ? 0 : r > 255 ? 255 : r; g = g < 0 ? 0 : g > 255 ? 255 : g; b = b < 0 ? 0 : b > 255 ? 255 : b;
      buf[i] = (255 << 24) | (b << 16) | (g << 8) | r;
    }
  }
  RD.ctx.putImageData(RD.img, 0, 0);
}
