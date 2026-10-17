// ===== 終わりのない層 =====
// マス: 0=床 1=壁。16×16 マスのかたまり（チャンク）ごとに、座標から決まる乱数で作る
const CH = 16;
const DXY = [[0, -1], [1, 0], [0, 1], [-1, 0]];   // 北 東 南 西
const START = { x: 8.5, y: 8.5 };
let WD = null;

function newWorld(lv, seed, cfg) {
  WD = { lv, seed: (seed ^ Math.imul(lv + 1, 2654435761)) | 0, cfg: cfg || LEVELS[lv], chunks: new Map(), exit: null };
  if (WD.cfg.exitD > 0) placeExit();
  return WD;
}
function ckey(cx, cy) { return (cx + 32768) * 65536 + (cy + 32768); }
function chunkAt(cx, cy) {
  const k = ckey(cx, cy);
  let c = WD.chunks.get(k);
  if (!c) { c = genChunk(cx, cy); WD.chunks.set(k, c); }
  return c;
}
function cellAt(x, y) {
  const cx = Math.floor(x / CH), cy = Math.floor(y / CH);
  return chunkAt(cx, cy).cells[(y - cy * CH) * CH + (x - cx * CH)];
}
function isWall(x, y) { return cellAt(x, y) === 1; }

function genChunk(cx, cy) {
  const cfg = WD.cfg, cells = new Uint8Array(CH * CH);
  const R = mulberry32(hashInt(WD.seed, cx, cy));
  const ri = (a, b) => a + Math.floor(R() * (b - a + 1));
  const set = (lx, ly, v) => { if (lx >= 0 && ly >= 0 && lx < CH && ly < CH) cells[ly * CH + lx] = v; };
  const X0 = cx * CH, Y0 = cy * CH;
  if (cfg.gen === 'office') {
    const p = cfg.walls;
    const nseg = ri(p.segs[0], p.segs[1]);
    for (let s = 0; s < nseg; s++) {
      const hz = R() < 0.5, len = ri(2, 9), x0 = ri(0, CH - 1), y0 = ri(0, CH - 1);
      const gap = R() < 0.35 ? ri(1, len - 1) : -1;
      for (let i = 0; i < len; i++) if (i !== gap) set(hz ? x0 + i : x0, hz ? y0 : y0 + i, 1);
    }
    const np = ri(p.pillars[0], p.pillars[1]);
    for (let i = 0; i < np; i++) set(ri(0, CH - 1), ri(0, CH - 1), 1);
    if (R() < p.rooms) {   // 扉が2つある部屋
      const w = ri(4, 7), h = ri(4, 7), x0 = ri(0, CH - w - 1), y0 = ri(0, CH - h - 1);
      for (let x = x0; x <= x0 + w; x++) { set(x, y0, 1); set(x, y0 + h, 1); }
      for (let y = y0; y <= y0 + h; y++) { set(x0, y, 1); set(x0 + w, y, 1); }
      const doors = [[ri(x0 + 1, x0 + w - 1), y0], [ri(x0 + 1, x0 + w - 1), y0 + h], [x0, ri(y0 + 1, y0 + h - 1)], [x0 + w, ri(y0 + 1, y0 + h - 1)]];
      const a = ri(0, 3); let b2 = ri(0, 3); if (b2 === a) b2 = (a + 2) & 3;
      set(doors[a][0], doors[a][1], 0); set(doors[b2][0], doors[b2][1], 0);
    }
  } else if (cfg.gen === 'warehouse') {
    for (let ly = 0; ly < CH; ly++) for (let lx = 0; lx < CH; lx++) {
      const X = X0 + lx, Y = Y0 + ly;
      if (((X % 5) + 5) % 5 === 0 && ((Y % 5) + 5) % 5 === 0) set(lx, ly, 1);   // 柱
    }
    const nrow = ri(2, 4);   // 棚の列
    for (let s = 0; s < nrow; s++) {
      const hz = R() < 0.6, len = ri(4, 12), x0 = ri(0, CH - 1), y0 = ri(1, CH - 2);
      const gap = ri(1, len - 2);
      for (let i = 0; i < len; i++) if (i !== gap && i !== gap + 1) set(hz ? x0 + i : x0, hz ? y0 : y0 + i, 1);
    }
    const ncrate = ri(0, 3);
    for (let i = 0; i < ncrate; i++) { const x = ri(0, CH - 2), y = ri(0, CH - 2); set(x, y, 1); set(x + 1, y, 1); set(x, y + 1, 1); set(x + 1, y + 1, 1); }
  } else if (cfg.gen === 'maze') {
    const s2 = WD.seed + 11;
    const north = (X, Y) => hash3(s2, X, Y) < 0.5;           // 節(偶数,偶数)が北へつながるか（そうでなければ東）
    const loops = cfg.loops || 0.2;
    const extra = (X, Y) => hash3(s2 + 1, X, Y) < loops;     // 余分な抜け道（多いほど逃げ道ができる）
    for (let ly = 0; ly < CH; ly++) for (let lx = 0; lx < CH; lx++) {
      const X = X0 + lx, Y = Y0 + ly, ex = (X & 1) === 0, ey = (Y & 1) === 0;
      let wall;
      if (ex && ey) wall = false;
      else if (!ex && !ey) wall = true;
      else if (!ex && ey) wall = !(!north(X - 1, Y) || extra(X, Y));        // 東西の通路
      else wall = !(north(X, Y + 1) || extra(X, Y));                         // 南北の通路
      // ときどき小部屋
      const bx = Math.floor(X / 6), by = Math.floor(Y / 6);
      if (hash3(s2 + 2, bx, by) < 0.1) { const ix = X - bx * 6, iy = Y - by * 6; if (ix >= 1 && iy >= 1 && ix <= 4 && iy <= 4) wall = false; }
      set(lx, ly, wall ? 1 : 0);
    }
  } else if (cfg.gen === 'hall') {
    // 廊下と部屋：8マスごとに幅2の廊下が縦横に通り、そのあいだに扉のある部屋（ときどき行き止まり）
    const B = 8, s3 = WD.seed + 21, P = cfg.hall || { block: 0.15, solid: 0.1 };
    for (let ly = 0; ly < CH; ly++) for (let lx = 0; lx < CH; lx++) {
      const X = X0 + lx, Y = Y0 + ly, mx = ((X % B) + B) % B, my = ((Y % B) + B) % B;
      const bx = Math.floor(X / B), by = Math.floor(Y / B), corX = mx <= 1, corY = my <= 1;
      let wall;
      if (corX || corY) {
        wall = false;
        if (corX && !corY && my === 4 && hash3(s3, bx, by) < P.block) wall = true;        // 縦の廊下をふさぐ
        if (corY && !corX && mx === 4 && hash3(s3 + 1, bx, by) < P.block) wall = true;    // 横の廊下をふさぐ
      } else if (hash3(s3 + 7, bx, by) < P.solid) wall = true;                            // 部屋のない区画
      else if (mx === 2 || mx === 7 || my === 2 || my === 7) {
        wall = true;
        if (my === 2 && mx === 4 && hash3(s3 + 2, bx, by) < 0.6) wall = false;
        if (my === 7 && mx === 5 && hash3(s3 + 3, bx, by) < 0.45) wall = false;
        if (mx === 2 && my === 5 && hash3(s3 + 4, bx, by) < 0.45) wall = false;
        if (mx === 7 && my === 4 && hash3(s3 + 5, bx, by) < 0.45) wall = false;
      } else wall = hash3(s3 + 6, X, Y) < 0.1;                                           // 部屋の中の家具
      set(lx, ly, wall ? 1 : 0);
    }
  } else if (cfg.gen === 'pool') {
    // 柱の間隔・残す割合・壁のかたまりの数と長さは、層ごとに変えられる（海の岩の島、畑の生け垣と木など）
    const E = cfg.poolEvery || 7, keep = cfg.pillarKeep == null ? 1 : cfg.pillarKeep, s4 = WD.seed + 31;
    for (let ly = 0; ly < CH; ly++) for (let lx = 0; lx < CH; lx++) {
      const X = X0 + lx, Y = Y0 + ly;
      if (((X % E) + E) % E === 3 && ((Y % E) + E) % E === 3 && (keep >= 1 || hash3(s4, X, Y) < keep)) set(lx, ly, 1);
    }
    const PS = cfg.poolSegs || [0, 1], PL = cfg.segLen || [3, 7];
    const nseg = cfg.poolSegs ? ri(PS[0], PS[1]) : (R() < 0.5 ? 1 : 0);
    for (let s = 0; s < nseg; s++) { const hz = R() < 0.5, len = ri(PL[0], PL[1]), x0 = ri(0, CH - 1), y0 = ri(0, CH - 1), gap = R() < 0.5 ? ri(1, len - 2) : -1; for (let i = 0; i < len; i++) if (i !== gap) set(hz ? x0 + i : x0, hz ? y0 : y0 + i, 1); }
  }
  // スタート地点のまわりは空ける
  if (cx === 0 && cy === 0) for (let y = 5; y <= 11; y++) for (let x = 5; x <= 11; x++) {
    if (cfg.gen === 'maze' && !(Math.abs(x - 8) <= 1 && Math.abs(y - 8) <= 1)) continue;
    set(x, y, 0);
  }
  // 拾う物
  const items = [];
  let k = 0;
  const place = t => {
    for (let tr = 0; tr < 12; tr++) {
      const lx = ri(0, CH - 1), ly = ri(0, CH - 1);
      if (cells[ly * CH + lx]) continue;
      items.push({ id: `${WD.lv}:${cx},${cy}:${k++}`, t, x: X0 + lx + 0.5, y: Y0 + ly + 0.5 });
      return;
    }
  };
  for (const t of ['water', 'battery', 'map', 'note']) if (R() < (cfg.items[t] || 0)) place(t);
  if (WD.lv === 0 && cx === 0 && cy === 0 && !cfg.orig) {
    items.push({ id: '0:start:w', t: 'water', x: 10.5, y: 7.5 });
    items.push({ id: '0:start:n', t: 'note', x: 7.5, y: 10.5 });
  }
  return { cells, items };
}

// 灯り: 0=なし 1=点いている 2=ちらつく 3=消えている
function lampAt(X, Y) {
  const L = WD.cfg.lamps, e = L.every, off = WD.cfg.gen === 'maze' ? 0 : 1;
  if ((((X - off) % e) + e) % e !== 0 || (((Y - off) % e) + e) % e !== 0) return 0;
  if (cellAt(X, Y) === 1) return 0;
  if (L.on <= 0 && L.flick <= 0) return 0;   // 灯りのない層には、灯りの枠も描かない
  if (L.on > 0 && Math.abs(X - 8) <= 4 && Math.abs(Y - 8) <= 4) return 1;   // 始まりの場所は明るく
  if (L.darkBlock && hash3(WD.seed + 5, Math.floor(X / 8), Math.floor(Y / 8)) < L.darkBlock) return 3;
  const r = hash3(WD.seed + 3, X, Y);
  return r < L.on ? 1 : r < L.on + L.flick ? 2 : 3;
}

// 見通し（壁にさえぎられないか）
function lineOfSight(ax, ay, bx, by) {
  let x = Math.floor(ax), y = Math.floor(ay);
  const tx = Math.floor(bx), ty = Math.floor(by);
  const dx = bx - ax, dy = by - ay;
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
  const ddx = Math.abs(1 / (dx || 1e-9)), ddy = Math.abs(1 / (dy || 1e-9));
  let tmx = (dx > 0 ? (x + 1 - ax) : (ax - x)) * ddx, tmy = (dy > 0 ? (y + 1 - ay) : (ay - y)) * ddy;
  for (let i = 0; i < 80; i++) {
    if (x === tx && y === ty) return true;
    if (tmx < tmy) { tmx += ddx; x += sx; } else { tmy += ddy; y += sy; }
    if (isWall(x, y)) return false;
  }
  return false;
}

// 幅優先探索：start から各マスへの歩数（半径 r の四角の中）
function bfsFrom(sx, sy, r, ok) {
  const S2 = 2 * r + 1, dist = new Int16Array(S2 * S2).fill(-1);
  const ox = sx - r, oy = sy - r;
  const q = [(sy - oy) * S2 + (sx - ox)]; dist[q[0]] = 0;
  for (let h = 0; h < q.length; h++) {
    const i = q[h], x = i % S2, y = (i / S2) | 0;
    for (const [ddx, ddy] of DXY) {
      const nx = x + ddx, ny = y + ddy;
      if (nx < 0 || ny < 0 || nx >= S2 || ny >= S2) continue;
      const j = ny * S2 + nx;
      if (dist[j] >= 0 || isWall(nx + ox, ny + oy)) continue;
      if (ok && !ok(nx + ox, ny + oy)) continue;
      dist[j] = dist[i] + 1; q.push(j);
    }
  }
  return { dist, ox, oy, S2, at: (x, y) => { const ix = x - ox, iy = y - oy; return ix < 0 || iy < 0 || ix >= S2 || iy >= S2 ? -1 : dist[iy * S2 + ix]; } };
}
// target から逆向きに調べて、from から次に進むマス
function nextStep(fx, fy, tx, ty, r, ok) {
  if (fx === tx && fy === ty) return null;
  if (Math.abs(fx - tx) > r || Math.abs(fy - ty) > r) return null;
  const B = bfsFrom(tx, ty, r, ok);
  const here = B.at(fx, fy);
  if (here < 0) return null;
  for (const [ddx, ddy] of DXY) {
    const v = B.at(fx + ddx, fy + ddy);
    if (v >= 0 && v < here) return { x: fx + ddx, y: fy + ddy };
  }
  return null;
}

// 出口：スタートから歩いて exitD 歩くらいの、壁の前
function placeExit() {
  const D = WD.cfg.exitD, R = mulberry32(hashInt(WD.seed, 777, 333));
  const r = D + 24;
  const B = bfsFrom(Math.floor(START.x), Math.floor(START.y), r);
  for (let span = 10; span < 80; span += 10) {
    const cand = [];
    for (let i = 0; i < B.dist.length; i++) {
      const d = B.dist[i];
      if (d < D || d > D + span) continue;
      const fx = (i % B.S2) + B.ox, fy = ((i / B.S2) | 0) + B.oy;
      for (let dir = 0; dir < 4; dir++) {
        const wx = fx + DXY[dir][0], wy = fy + DXY[dir][1];
        if (isWall(wx, wy)) cand.push({ fx, fy, wx, wy, face: (dir + 2) & 3, steps: d });
      }
    }
    if (cand.length) { WD.exit = cand[Math.floor(R() * cand.length)]; return; }
  }
  // 見つからないとき（まずないが）スタートのそばに
  WD.exit = { fx: 8, fy: 8, wx: 8, wy: 4, face: 2, steps: 0 };
}
function exitPoint() {   // 出口の扉の真ん中（床の上）。出口がない層では null
  const e = WD.exit; if (!e) return null;
  const d = DXY[(e.face)];
  return { x: e.wx + 0.5 + d[0] * 0.5, y: e.wy + 0.5 + d[1] * 0.5 };
}
