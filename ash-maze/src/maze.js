// ===== 迷宮 =====
// 壁の値: 0=通路 1=壁 2=扉 3=隠し扉 4=鍵のかかった扉
const MW = 20, MH = 20, NFLOORS = 10;
const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
const DIR_N = ['北', '東', '南', '西'];
const W_OPEN = 0, W_WALL = 1, W_DOOR = 2, W_SECRET = 3, W_LOCK = 4;

function inb(x, y) { return x >= 0 && y >= 0 && x < MW && y < MH; }
function ci(x, y) { return y * MW + x; }

function makeFloor(f) {
  return {
    f, walls: new Uint8Array(MW * MH * 4).fill(W_WALL),
    room: new Int16Array(MW * MH).fill(-1), rooms: [],
    sp: {},             // 特別なマス: ci -> {t, ...}
    up: null, down: null, lock: null, guardRoom: -1,
  };
}
function getW(F, x, y, d) { return F.walls[ci(x, y) * 4 + d]; }
function setW(F, x, y, d, v) {
  F.walls[ci(x, y) * 4 + d] = v;
  const nx = x + DX[d], ny = y + DY[d];
  if (inb(nx, ny)) F.walls[ci(nx, ny) * 4 + ((d + 2) & 3)] = v;
}
function passable(v, opts) {
  if (v === W_OPEN || v === W_DOOR || v === W_SECRET) return true;
  if (v === W_LOCK) return !!(opts && opts.keys);
  return false;
}
function bfs(F, sx, sy, opts) {
  const dist = new Int16Array(MW * MH).fill(-1);
  const q = [ci(sx, sy)]; dist[q[0]] = 0;
  for (let h = 0; h < q.length; h++) {
    const c = q[h], x = c % MW, y = (c / MW) | 0;
    for (let d = 0; d < 4; d++) {
      const v = getW(F, x, y, d);
      if (opts && opts.noSecret && v === W_SECRET) continue;
      if (!passable(v, opts)) continue;
      const nx = x + DX[d], ny = y + DY[d];
      if (!inb(nx, ny)) continue;
      const n = ci(nx, ny);
      if (dist[n] < 0) { dist[n] = dist[c] + 1; q.push(n); }
    }
  }
  return dist;
}
function openSides(F, x, y) {
  let n = 0;
  for (let d = 0; d < 4; d++) if (passable(getW(F, x, y, d), { keys: 1 })) n++;
  return n;
}

function genFloor(f, up, R) {
  const F = makeFloor(f);
  F.up = up;
  // 部屋
  const nRooms = 4 + (f % 4);
  for (let t = 0; t < 400 && F.rooms.length < nRooms; t++) {
    const w = 2 + Math.floor(R() * 3), h = 2 + Math.floor(R() * 3);
    const x0 = Math.floor(R() * (MW - w)), y0 = Math.floor(R() * (MH - h));
    let ok = true;
    for (let y = y0 - 1; y <= y0 + h && ok; y++) for (let x = x0 - 1; x <= x0 + w && ok; x++) {
      if (!inb(x, y)) continue;
      if (F.room[ci(x, y)] >= 0) ok = false;
      if (Math.abs(x - up.x) + Math.abs(y - up.y) <= 2) ok = false;
    }
    if (!ok) continue;
    const id = F.rooms.length, cells = [];
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { F.room[ci(x, y)] = id; cells.push(ci(x, y)); }
    for (const c of cells) {
      const x = c % MW, y = (c / MW) | 0;
      for (let d = 1; d <= 2; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (inb(nx, ny) && F.room[ci(nx, ny)] === id) setW(F, x, y, d, W_OPEN);
      }
    }
    F.rooms.push({ id, x: x0, y: y0, w, h, cells });
  }
  // 穴掘り（深さ優先）。部屋は1つのかたまりとして扱う
  const vis = new Uint8Array(MW * MH);
  const stack = [];
  const visit = c => {
    const r = F.room[c];
    if (r >= 0) { for (const rc of F.rooms[r].cells) { vis[rc] = 1; stack.push(rc); } }
    else { vis[c] = 1; stack.push(c); }
  };
  visit(ci(up.x, up.y));
  while (stack.length) {
    const c = stack[stack.length - 1], x = c % MW, y = (c / MW) | 0;
    const opts = [];
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d], ny = y + DY[d];
      if (inb(nx, ny) && !vis[ci(nx, ny)]) opts.push(d);
    }
    if (!opts.length) { stack.pop(); continue; }
    const d = opts[Math.floor(R() * opts.length)];
    const nx = x + DX[d], ny = y + DY[d], n = ci(nx, ny);
    const roomEdge = F.room[c] >= 0 || F.room[n] >= 0;
    setW(F, x, y, d, roomEdge ? W_DOOR : (R() < 0.08 ? W_DOOR : W_OPEN));
    visit(n);
  }
  // 行き止まりをいくつか、つなげて輪にする
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const c = ci(x, y);
    if (F.room[c] >= 0 || openSides(F, x, y) !== 1 || R() > 0.4) continue;
    const ds = [];
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d], ny = y + DY[d];
      if (inb(nx, ny) && getW(F, x, y, d) === W_WALL) ds.push(d);
    }
    if (!ds.length) continue;
    const d = ds[Math.floor(R() * ds.length)];
    setW(F, x, y, d, F.room[ci(x + DX[d], y + DY[d])] >= 0 ? W_DOOR : W_OPEN);
  }
  // 下り階段
  const dist = bfs(F, up.x, up.y);
  let maxd = 0; for (let i = 0; i < dist.length; i++) maxd = Math.max(maxd, dist[i]);
  const lockKey = LOCKS[f];
  if (f < NFLOORS) {
    let cand = [];
    for (let c = 0; c < MW * MH; c++) {
      const x = c % MW, y = (c / MW) | 0;
      if (F.room[c] >= 0 || dist[c] < maxd * 0.55 || (x === up.x && y === up.y)) continue;
      if (lockKey && openSides(F, x, y) !== 1) continue;
      cand.push(c);
    }
    if (!cand.length) throw new Error('no down stairs candidate f=' + f);
    cand.sort((a, b) => dist[b] - dist[a]);
    cand = cand.slice(0, Math.max(1, Math.ceil(cand.length / 3)));
    const c = cand[Math.floor(R() * cand.length)];
    F.down = { x: c % MW, y: (c / MW) | 0 };
    if (lockKey) {
      for (let d = 0; d < 4; d++) if (passable(getW(F, F.down.x, F.down.y, d))) {
        setW(F, F.down.x, F.down.y, d, W_LOCK);
        F.lock = { x: F.down.x, y: F.down.y, d, key: lockKey };
      }
    }
  }
  // 番人の部屋（一番遠い部屋）
  if (GUARDS[f]) {
    let best = -1, bd = -1;
    for (const r of F.rooms) {
      let md = 1e9; for (const c of r.cells) if (dist[c] >= 0) md = Math.min(md, dist[c]);
      if (md < 1e9 && md > bd) { bd = md; best = r.id; }
    }
    F.guardRoom = best;
  }
  return F;
}

// 隠し扉：通れなくしても、行くべき場所に行けるものだけにする
function addSecrets(F, R, n) {
  const free = bfs(F, F.up.x, F.up.y, { noSecret: 1 });
  const must = [];
  if (F.down) must.push(ci(F.down.x, F.down.y));
  if (F.guardRoom >= 0) must.push(F.rooms[F.guardRoom].cells[0]);
  let placed = 0;
  for (let t = 0; t < 300 && placed < n; t++) {
    const x = Math.floor(R() * MW), y = Math.floor(R() * MH), d = 1 + Math.floor(R() * 2);
    const nx = x + DX[d], ny = y + DY[d];
    if (!inb(nx, ny)) continue;
    const v = getW(F, x, y, d);
    if (v !== W_OPEN && v !== W_DOOR) continue;
    if (F.room[ci(x, y)] >= 0 && F.room[ci(x, y)] === F.room[ci(nx, ny)]) continue;
    if (free[ci(x, y)] < 0) continue;
    setW(F, x, y, d, W_WALL);
    const dd = bfs(F, F.up.x, F.up.y, { keys: 1, noSecret: 1 });
    let ok = must.every(c => dd[c] >= 0);
    // 部屋はどこからでも入れるように
    for (const r of F.rooms) if (dd[r.cells[0]] < 0 && free[r.cells[0]] >= 0) ok = false;
    setW(F, x, y, d, ok ? W_SECRET : v);
    if (ok) placed++;
  }
}

// 特別なマスを置く
function placeSpecials(floors, R) {
  for (let f = 1; f <= NFLOORS; f++) {
    const F = floors[f];
    const free = bfs(F, F.up.x, F.up.y, { noSecret: 1 });  // 鍵の扉・隠し扉を通らずに行ける所
    F.free = free;
    const cand = [];
    for (let c = 0; c < MW * MH; c++) {
      const x = c % MW, y = (c / MW) | 0;
      if (free[c] < 3 || F.room[c] >= 0) continue;
      if (F.down && x === F.down.x && y === F.down.y) continue;
      cand.push(c);
    }
    const used = new Set();
    const take = () => {
      for (let t = 0; t < 200; t++) {
        const c = cand[Math.floor(R() * cand.length)];
        if (!used.has(c) && !F.sp[c]) { used.add(c); return c; }
      }
      return -1;
    };
    const put = (t, extra) => { const c = take(); if (c >= 0) F.sp[c] = Object.assign({ t }, extra || {}); return c; };
    (FLOOR_MSG[f] || []).forEach((m, i) => put('msg', { m: i }));
    const nPit = 1 + Math.floor(f / 2), nSpin = f >= 2 ? 1 + Math.floor(f / 3) : 0;
    const nTele = f >= 4 ? Math.floor(f / 3) : 0, nDark = f >= 3 ? 1 + Math.floor(f / 4) + (f === 9 ? 2 : 0) : 0;
    const nAnti = f >= 6 ? 2 : 0;
    for (let i = 0; i < nPit; i++) put('pit');
    for (let i = 0; i < nSpin; i++) put('spin');
    for (let i = 0; i < nTele; i++) put('tele');
    if (f === 2 || f === 6) put('fount');
    // 暗闇・魔法の効かない場所は、かたまりで置く
    const cluster = (t, size) => {
      let c = take(); if (c < 0) return;
      F.sp[c] = { t };
      for (let i = 1; i < size; i++) {
        const x = c % MW, y = (c / MW) | 0, ds = [];
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d], ny = y + DY[d];
          if (!inb(nx, ny) || !passable(getW(F, x, y, d))) continue;
          const n = ci(nx, ny);
          if (F.sp[n] || F.room[n] >= 0 || free[n] < 3 || (F.down && nx === F.down.x && ny === F.down.y)) continue;
          ds.push(n);
        }
        if (!ds.length) break;
        c = ds[Math.floor(R() * ds.length)]; F.sp[c] = { t }; used.add(c);
      }
    };
    for (let i = 0; i < nDark; i++) cluster('dark', 3 + Math.floor(R() * 4));
    for (let i = 0; i < nAnti; i++) cluster('anti', 2 + Math.floor(R() * 2));
    // 落とし戸（下の階へ落ちる）。鍵の扉を飛び越さない階だけ
    if ([2, 5, 6, 8].includes(f)) {
      const G = floors[f + 1], gfree = bfs(G, G.up.x, G.up.y, { noSecret: 1 });
      for (let t = 0; t < 50; t++) {
        const c = cand[Math.floor(R() * cand.length)];
        if (F.sp[c] || gfree[c] < 0 || G.room[c] >= 0) continue;
        F.sp[c] = { t: 'chute' }; break;
      }
    }
  }
}

let WORLD = null;
function buildWorld() {
  const R = mulberry32(20261014);
  const floors = [null];
  let up = { x: 0, y: MH - 1 };
  for (let f = 1; f <= NFLOORS; f++) {
    const F = genFloor(f, up, R);
    floors.push(F);
    if (F.down) up = { x: F.down.x, y: F.down.y };
  }
  for (let f = 1; f <= NFLOORS; f++) addSecrets(floors[f], R, 2 + Math.floor(f / 2));
  placeSpecials(floors, R);
  WORLD = floors;
  return floors;
}
// 表示用の座標（左下が0,0、北が上）
function dispXY(x, y) { return '東' + x + '・北' + (MH - 1 - y); }
