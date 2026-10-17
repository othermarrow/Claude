// ===== ゲームの中身 =====
const SAVE_KEY = 'backrooms_save_v1', OPT_KEY = 'backrooms_opts_v1';
const WALK = 1.9, RUN = 3.5, RADIUS = 0.22;
let S = null;                        // 保存するもの
let OPT = { q: 1, sens: 1, vol: 0.8, vib: 1, claude: 1, wire: 0 };
const G = {                          // 保存しないもの
  mode: 'title', t: 0, ents: [], spawn: {}, bob: 0, bobPh: 0, run: false, tired: false,
  in: { mx: 0, my: 0, turn: 0 }, keys: {}, noise: 0, fear: 0, seen: false, nearExit: false,
  hint: 0, saveT: 0, items: [], itemChunk: null, lastThump: 0, dark: 0, flashT: 0,
};

// 保存先：ふつうはブラウザの保存領域（localStorage）。
// Tasker の WebView などで使えないときは、Tasker のグローバル変数（%BrSave・%BrOpts）に保存する。
// Tasker の関数（global・setGlobal）は、WebView の「Allow Phone Access」がオンのときに使える
function findStore() {
  try {
    localStorage.setItem('br_t', '1'); const ok = localStorage.getItem('br_t') === '1'; localStorage.removeItem('br_t');
    if (ok) return { kind: 'local', get: k => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v), del: k => localStorage.removeItem(k) };
  } catch (e) { }
  try {
    if (typeof setGlobal === 'function' && typeof global === 'function') {
      const name = k => k === OPT_KEY ? 'BrOpts' : 'BrSave';
      const last = {};
      return {
        kind: 'tasker',
        get: k => { const v = global(name(k)); return v && typeof v === 'string' && v[0] !== '%' ? v : null; },
        set: (k, v) => { if (last[k] !== v) { setGlobal(name(k), v); last[k] = v; } },
        del: k => { setGlobal(name(k), ''); last[k] = ''; },
      };
    }
  } catch (e) { }
  return null;
}
const MEM = {}, MEMSTORE = { kind: 'none', get: k => (k in MEM ? MEM[k] : null), set: (k, v) => { MEM[k] = v; }, del: k => { delete MEM[k]; } };
let STORE = null;
function store() {        // 保存先が見つかるまでは、呼ばれるたびに探し直す（Tasker の関数があとから用意されることもあるので）
  if (STORE && STORE.kind !== 'none') return STORE;
  const s = findStore();
  if (s) { STORE = s; try { Object.assign(OPT, JSON.parse(s.get(OPT_KEY)) || {}); } catch (e) { } }
  else STORE = MEMSTORE;
  return STORE;
}
function loadOpts() { try { Object.assign(OPT, JSON.parse(store().get(OPT_KEY)) || {}); } catch (e) { } }
function saveOpts() { try { store().set(OPT_KEY, JSON.stringify(OPT)); } catch (e) { } }
function storageOk() { return store().kind !== 'none'; }
function saveGame() { if (!S) return; try { store().set(SAVE_KEY, JSON.stringify(S)); } catch (e) { } }
function loadSave() { try { const o = JSON.parse(store().get(SAVE_KEY)); return o && o.v === 1 ? o : null; } catch (e) { return null; } }
function clearSave() { try { store().del(SAVE_KEY); } catch (e) { } }
function vibe(ms) { try { if (OPT.vib && navigator.vibrate) navigator.vibrate(ms); } catch (e) { } }

function newState(mode) {
  return {
    v: 1, mode: mode || 'normal', seed: (Math.random() * 2147483647) | 0, lv: 0, x: START.x, y: START.y, a: 0,
    san: 100, thirst: 100, bat: 100, spare: 0, water: 0, maps: 0, stam: 100, flash: false,
    taken: {}, notes: [], time: 0, deaths: 0, cleared: 0, snap: null,
  };
}
function snapshot() { return { san: S.san, thirst: S.thirst, bat: S.bat, spare: S.spare, water: S.water, maps: S.maps }; }
function enterLevel(lv, fresh) {
  S.lv = lv;
  if (!S.mode) S.mode = 'normal';
  newWorld(lv, S.seed, levelCfg(lv, S.mode));
  if (fresh) { S.x = START.x; S.y = START.y; S.a = 0; S.snap = snapshot(); }
  G.ents = []; G.items = []; G.itemChunk = null; G.hint = 0; S.flash = false; G.blackout = false; G.blackT = null;
  refreshCaches(S.x, S.y); updateLight(G.t);
  G.spawn = {};
  const E = WD.cfg.ents; for (const k in E) G.spawn[k] = E[k].first;
  audioLevel(WD.cfg);
}
// 救いのない版で死んだときに残るメモ
function graveText(g) {
  const why = g.c === 'lost' ? '壁の模様が、ずっと話しかけてくる。' : '後ろの足音が、止まらない。';
  return `第${g.d}層まで来た。${Math.floor(g.t / 60)}分${String(Math.floor(g.t % 60)).padStart(2, '0')}秒、歩き続けた。\n${why}\nここで、終わる。`;
}
function addGrave(cause) {
  OPT.graves = (OPT.graves || []).concat({ d: S.lv, t: Math.floor(S.time), c: cause }).slice(-6);
  OPT.hardBest = Math.max(OPT.hardBest || 0, S.lv);
  saveOpts();
}
function restartLevel() {
  const sn = S.snap || snapshot();
  Object.assign(S, sn);
  S.san = Math.max(S.san, 55); S.thirst = Math.max(S.thirst, 45);
  S.deaths++; S.flash = false; S.stam = 100;
  enterLevel(S.lv, false);
  S.x = START.x; S.y = START.y; S.a = 0;
  refreshCaches(S.x, S.y); updateLight(G.t);
  saveGame();
}

// ---- 動く ----
function solidAt(x, y) { return wallFast(Math.floor(x), Math.floor(y)) === 1; }
function blocked(x, y) {
  const r = RADIUS;
  return solidAt(x - r, y - r) || solidAt(x + r, y - r) || solidAt(x - r, y + r) || solidAt(x + r, y + r);
}
function movePlayer(dx, dy) {
  if (!blocked(S.x + dx, S.y)) S.x += dx;
  if (!blocked(S.x, S.y + dy)) S.y += dy;
}
function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }

// ---- 拾う物 ----
function nearbyItems() {
  const cx = Math.floor(S.x / CH), cy = Math.floor(S.y / CH), key = cx + ',' + cy + ',' + WD.lv;
  if (G.itemChunk !== key) {
    G.itemChunk = key; G.items = [];
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) for (const it of chunkAt(cx + i, cy + j).items) G.items.push(it);
  }
  return G.items.filter(it => !S.taken[it.id]);
}
const ITEM_SPR = { water: 'sp_water', battery: 'sp_battery', map: 'sp_map', note: 'sp_note' };
function waterName(def) { const n = WD && WD.cfg.itemNames; return (n && n.water) || def; }
function pickUp(it) {
  S.taken[it.id] = 1;
  sfx('pick'); vibe(15);
  if (it.t === 'water') { S.water++; toast(`${waterName('水のボトル')}を拾った（${S.water}本）`); }
  else if (it.t === 'battery') { S.spare++; toast(`電池を拾った（予備 ${S.spare}本）`); }
  else if (it.t === 'map') { S.maps++; toast(`地図の切れ端を拾った（${S.maps}枚）`); }
  else if (it.t === 'note') {
    if (THEMES[S.mode]) {   // 五つの報告書・山羊文学版：その層の言葉を順に拾う
      const list = themeNotes(S.mode, S.lv);
      const i = list.findIndex((n, k) => !S.notes.some(x => x.lv === S.lv && x.i === k));
      if (i < 0) toast('濡れて、文字が読めないメモだった');
      else { const n = list[i]; S.notes.push({ lv: S.lv, i, t: n.t, src: n.src }); showNote(n.t, true, n.src); }
    } else if (S.mode === 'hard') {
      // 前に死んだ自分のメモが、混じっていることがある
      const graves = (OPT.graves || []).filter((g, i) => !(S.gseen || []).includes(i));
      const hn = H_NOTES.findIndex((n, i) => !S.notes.some(x => x.h === i));
      if (graves.length && (Math.random() < 0.35 || hn < 0)) {
        const gi = (OPT.graves || []).indexOf(graves[0]);
        S.gseen = (S.gseen || []).concat(gi);
        const t = graveText(graves[0]);
        S.notes.push({ t, mine: 1 }); showNote(t, true, '見覚えのある字だ。');
      } else if (hn >= 0) { S.notes.push({ h: hn, t: H_NOTES[hn] }); showNote(H_NOTES[hn], true); }
      else toast('濡れて、文字が読めないメモだった');
    } else {
      const idx = NOTES.findIndex((n, i) => n[0] === S.lv && !S.notes.includes(i));
      if (idx < 0) { toast('濡れて、文字が読めないメモだった'); }
      else { S.notes.push(idx); showNote(NOTES[idx][1], true); }
    }
  }
  saveGame();
}
function drinkWater() {
  if (!S.water || G.mode !== 'play') return;
  S.water--;
  if (S.mode === 'hard') { S.thirst = Math.min(100, S.thirst + 30); sfx('drink'); toast(`水を飲んだ。渇きはおさまった。気分は晴れない（残り ${S.water}本）`); }
  else if (WD.cfg.itemNames) { S.thirst = Math.min(100, S.thirst + 45); S.san = Math.min(100, S.san + 25); sfx('drink'); toast(`${waterName('水')}を飲んだ。ほのかに甘く、アーモンドの香りがする。気持ちが落ち着いた（残り ${S.water}本）`); }
  else { S.thirst = Math.min(100, S.thirst + 45); S.san = Math.min(100, S.san + 15); sfx('drink'); toast(`水を飲んだ。少し落ち着いた（残り ${S.water}本）`); }
  saveGame();
}
function useMap() {
  if (!S.maps || G.mode !== 'play') return;
  S.maps--; G.hint = 30; sfx('click');
  toast('地図の切れ端を見た。出口の向きが分かる（30秒）'); saveGame();
}
function toggleFlash() {
  if (G.mode !== 'play' || WD.cfg.orig) return;
  if (WD.cfg.noLight) { S.flash = false; toast('スイッチを入れても、光が出ない。ここでは、明かりが死んでいる'); sfx('click'); return; }
  if (!S.flash && S.bat <= 0) {
    if (S.spare > 0) { S.spare--; S.bat = 100; toast('電池を入れ替えた'); }
    else { toast('電池がない'); sfx('click'); return; }
  }
  S.flash = !S.flash; sfx('click');
}
function toggleRun() { G.run = !G.run; }

// ---- 怪物 ----
function trySpawn(type) {
  for (let k = 0; k < 50; k++) {
    const ang = Math.random() * Math.PI * 2, d = (WD.cfg.orig ? 16 : 11) + Math.random() * 9;
    const x = Math.floor(S.x + Math.cos(ang) * d), y = Math.floor(S.y + Math.sin(ang) * d);
    if (isWall(x, y) || lineOfSight(S.x, S.y, x + 0.5, y + 0.5)) continue;
    if (type === 'grin' && lightAt(x + 0.5, y + 0.5) > 0.3) continue;
    const e = { type, x: x + 0.5, y: y + 0.5, st: 'wander', tgt: null, next: null, repath: 0, lost: 0, stepT: 0, sndT: 1 + Math.random() * 2, burn: 0, hearT: 0 };
    if (WD.cfg.orig) { hearPlayer(e); if (!G.warned) { G.warned = true; toast('……近くで、何かが歩き回る音がする'); } }
    G.ents.push(e);
    return true;
  }
  return false;
}
// 原作版：「それ」はときどき、こちらの居場所を聞きつける。時間がたつほど、正確に、頻繁に
function hearPlayer(e) {
  const err = Math.max(1.5, 10 - S.time / 80);
  for (let k = 0; k < 10; k++) {
    const x = Math.floor(S.x + (Math.random() * 2 - 1) * err), y = Math.floor(S.y + (Math.random() * 2 - 1) * err);
    if (!isWall(x, y)) { e.tgt = { x: x + 0.5, y: y + 0.5 }; break; }
  }
  if (e.st !== 'chase') e.st = 'hunt';
  e.hearT = Math.max(10, 45 - S.time / 22);
}
function spawnTick(dt) {
  const E = WD.cfg.ents;
  for (const type in E) {
    if (!(G.spawn[type] >= -1e9)) G.spawn[type] = E[type].first;
    G.spawn[type] -= dt;
    if (G.spawn[type] > 0) continue;
    G.spawn[type] = E[type].every * (0.7 + Math.random() * 0.6);
    if (G.ents.filter(e => e.type === type).length < E[type].max) trySpawn(type);
  }
}
function stepEntity(e, speed, dt, ok) {
  const ex = Math.floor(e.x), ey = Math.floor(e.y);
  if (!e.tgt) return;
  const tx = Math.floor(e.tgt.x), ty = Math.floor(e.tgt.y);
  let gx, gy;
  if (ex === tx && ey === ty) { gx = e.tgt.x; gy = e.tgt.y; }
  else {
    e.repath -= dt;
    if (e.repath <= 0 || !e.next || (Math.floor(e.x) === e.next.x && Math.floor(e.y) === e.next.y && Math.hypot(e.x - e.next.x - 0.5, e.y - e.next.y - 0.5) < 0.12)) {
      e.next = nextStep(ex, ey, tx, ty, 22, ok);
      e.repath = 0.4;
      if (!e.next) { e.tgt = null; return; }
    }
    gx = e.next.x + 0.5; gy = e.next.y + 0.5;
  }
  const dx = gx - e.x, dy = gy - e.y, d = Math.hypot(dx, dy);
  const s = Math.min(d, speed * dt);
  if (d > 1e-4) { e.x += dx / d * s; e.y += dy / d * s; }
  e.moving = s > 1e-4;
}
function randomTarget(e, r, ok) {
  for (let k = 0; k < 15; k++) {
    const x = Math.floor(e.x + (Math.random() * 2 - 1) * r), y = Math.floor(e.y + (Math.random() * 2 - 1) * r);
    if (!isWall(x, y) && (!ok || ok(x, y))) return { x: x + 0.5, y: y + 0.5 };
  }
  return null;
}
function updateEnts(dt) {
  G.fear = 0; G.seen = false; G.seenFace = false;
  let caught = null;
  for (const e of G.ents) {
    const P = ENTS[e.type];
    const dx = S.x - e.x, dy = S.y - e.y, d = Math.hypot(dx, dy);
    const los = d < (P.see + 2) && lineOfSight(e.x, e.y, S.x, S.y);
    const bearing = Math.atan2(e.y - S.y, e.x - S.x), rel = angDiff(bearing, S.a);
    const inView = los && Math.abs(rel) < 0.75 && d < 14;
    const mul = (WD.cfg.speedMul || 1) * (WD.cfg.orig ? 1 + Math.min(0.25, S.time / 1800) : 1);
    let speed = 0;
    if (e.type === 'face') {           // 顔のない人：ゆっくり歩き回るだけ。見ると少し落ち着かない
      if (!e.tgt) e.tgt = randomTarget(e, 6);
      stepEntity(e, P.speed[0], dt);
      if (inView && d < 7) G.seenFace = true;
      e.sndT -= dt;
    } else if (e.type === 'wander') {
      const seeR = (WD.cfg.orig ? 8 : P.see) * (WD.cfg.seeMul || 1), hearR = G.noise * (WD.cfg.hearMul || 1);
      if (WD.cfg.huntAlways) {          // Level !：いつも、こちらの居場所を知っている
        e.st = los ? 'chase' : 'hunt'; e.lost = 5; e.tgt = { x: S.x, y: S.y };
      } else if (los && d < seeR) { e.st = 'chase'; e.lost = 5; e.tgt = { x: S.x, y: S.y }; }
      else if (G.noise && d < hearR) { if (e.st !== 'chase') e.st = 'hunt'; e.tgt = { x: S.x, y: S.y }; }
      else if (e.st === 'chase') { e.lost -= dt; if (e.lost <= 0) e.st = 'hunt'; }
      if (e.st === 'hunt' && e.tgt && Math.hypot(e.tgt.x - e.x, e.tgt.y - e.y) < 0.3) { e.st = 'wander'; e.tgt = null; }
      if (WD.cfg.orig) {
        e.hearT -= dt;
        if (e.hearT <= 0) hearPlayer(e);
        if (d > 30) {   // 遠くに離れても、いつのまにか近くにいる
          for (let k = 0; k < 30; k++) {
            const a = Math.random() * Math.PI * 2, r = 14 + Math.random() * 6;
            const x = Math.floor(S.x + Math.cos(a) * r), y = Math.floor(S.y + Math.sin(a) * r);
            if (!isWall(x, y) && !lineOfSight(S.x, S.y, x + 0.5, y + 0.5)) { e.x = x + 0.5; e.y = y + 0.5; e.next = null; hearPlayer(e); break; }
          }
        }
      }
      if (e.st === 'wander' && !e.tgt) e.tgt = randomTarget(e, 7);
      speed = P.speed[e.st === 'chase' ? 2 : e.st === 'hunt' ? 1 : 0] * mul;
      // Wiki設定版のハウンド：にらみ返すと、少しのあいだだけ止まる
      if (WD.cfg.stare && (WD.cfg.entSpr || {}).wander === 'sp_hound' && inView && d < 7 && !G.run && !(e.stareCd > 0)) { e.stareT = 2.2; e.stareCd = 7; }
      if (e.stareCd > 0) e.stareCd -= dt;
      if (e.stareT > 0) { e.stareT -= dt; speed *= 0.12; }
      if (e.st === 'chase' && los && d < 2.5) {   // 目の前なら、まっすぐ来る
        const s = Math.min(d, speed * dt); e.x += dx / d * s; e.y += dy / d * s; e.moving = true;
      } else stepEntity(e, speed, dt);
      if (e.st !== 'wander') G.fear = Math.max(G.fear, clamp(1 - d / 11, 0, 1));
      // 足音
      e.stepT -= dt;
      if (e.moving && e.stepT <= 0 && d < 20) {
        e.stepT = e.st === 'chase' ? 0.36 : 0.62;
        sfx('thump', { pan: Math.sin(rel), gain: 0.35 * Math.pow(1 - d / 20, 1.5) * (WD.cfg.quietEnts ? 0.3 : 1) });
      }
      if (inView) G.seen = true;
    } else if (e.type === 'grin') {
      const ecx = Math.floor(e.x), ecy = Math.floor(e.y);
      const dark = (x, y) => lightAt(x + 0.5, y + 0.5) < 0.34 || (x === Math.floor(S.x) && y === Math.floor(S.y)) || (x === ecx && y === ecy);
      const lh = lightAt(S.x, S.y);
      const lure = WD.cfg.lightLure, lit = S.flash && S.bat > 0;   // Wiki設定版：光と物音に寄ってくる
      const beam = !lure && !WD.cfg.grinStill && lit && los && d < 9 && Math.abs(rel) < 0.33;
      // Wiki設定版のスマイラー：目を合わせたまま、明かりを消して静かにしていれば、寄ってこない
      const held = WD.cfg.eyeContact && ((WD.cfg.entSpr || {}).grin || 'sp_grin') === 'sp_grin' && inView && !lit && G.noise < 5;
      if (beam) e.fleeT = 2.2;
      if (WD.cfg.grinStill) {           // 肉食の風船：動かない。近づいたものをつかまえる
        e.st = 'lurk'; if (d < 1.0) caught = e;
      } else if (e.fleeT > 0) {
        e.fleeT -= dt; e.st = 'flee'; if (beam) e.burn += dt;
        if (e.sndT <= 0) { sfx('hiss', { pan: Math.sin(rel), gain: 0.25 }); e.sndT = 0.6; }
        // となりのマスのうち、こちらから一番遠くなる所へ下がる
        let best = null, bd = d;
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const nx = ecx + ox, ny = ecy + oy;
          if (isWall(nx, ny) || (ox && oy && (isWall(ecx + ox, ecy) || isWall(ecx, ecy + oy)))) continue;
          const nd = Math.hypot(nx + 0.5 - S.x, ny + 0.5 - S.y);
          if (nd > bd + 0.05) { bd = nd; best = { x: nx + 0.5, y: ny + 0.5 }; }
        }
        if (best) {
          const mx = best.x - e.x, my = best.y - e.y, md = Math.hypot(mx, my), s = Math.min(md, 1.25 * dt);
          if (md > 1e-4) { e.x += mx / md * s; e.y += my / md * s; }
        }
        if (e.burn > 1.6) { e.gone = true; toast('笑い声が、遠ざかっていった'); }
      } else if (!held && (lure ? ((lit && d < P.see) || (G.noise >= 5 && d < G.noise)) : (lh < 0.34 && d < P.see))) {
        e.st = 'chase'; e.tgt = { x: S.x, y: S.y }; speed = P.speed[2] * mul;
        if (los && d < 2.5) { const s = Math.min(d, speed * dt); e.x += dx / d * s; e.y += dy / d * s; }
        else stepEntity(e, speed, dt, dark);
        G.fear = Math.max(G.fear, clamp(1 - d / 10, 0, 1));
      } else {
        e.st = 'lurk';
        if (!e.tgt || Math.random() < 0.005) e.tgt = randomTarget(e, 3, dark);
        stepEntity(e, P.speed[0], dt, dark);
      }
      e.sndT -= dt;
      if (e.sndT <= 0 && d < 13) { sfx('giggle', { pan: Math.sin(rel), gain: 0.22 * (1 - d / 13) }); e.sndT = 1.6 + Math.random() * 2.5; }
      if (inView) G.seen = true;
    }
    if (d < 0.42 && e.st !== 'flee' && e.type !== 'face') caught = e;
    if (d > 42 && !WD.cfg.orig) e.gone = true;
  }
  G.ents = G.ents.filter(e => !e.gone);
  return caught;
}

// ---- 毎フレーム ----
function update(dt) {
  G.t += dt; S.time += dt;
  refreshCaches(S.x, S.y);
  const k = G.keys;
  // 向き
  S.a += G.in.turn; G.in.turn = 0;
  S.a += ((k.ArrowRight || k.e2 ? 1 : 0) - (k.ArrowLeft || k.q2 ? 1 : 0)) * 2.2 * dt;
  // 移動
  let fw = G.in.my + ((k.w || k.ArrowUp) ? 1 : 0) - ((k.s || k.ArrowDown) ? 1 : 0);
  let st = G.in.mx + (k.d ? 1 : 0) - (k.a ? 1 : 0);
  const mag = Math.hypot(fw, st);
  if (mag > 1) { fw /= mag; st /= mag; }
  const moving = mag > 0.12;
  if (G.tired && S.stam > 30) G.tired = false;
  const running = (G.run || k.Shift) && moving && !G.tired && S.stam > 0;
  const speed = (running ? RUN : WALK) * (S.thirst <= 0 ? 0.75 : 1) * (WD.cfg.moveMul || 1) * Math.min(1, mag + 0.15);
  if (moving) {
    const ca = Math.cos(S.a), sa = Math.sin(S.a);
    movePlayer((ca * fw - sa * st) * speed * dt, (sa * fw + ca * st) * speed * dt);
    const before = Math.floor(G.bobPh / Math.PI);
    G.bobPh += dt * speed * 3.1;
    if (Math.floor(G.bobPh / Math.PI) !== before) sfx('step', { surf: WD.cfg.step, loud: running });
    G.bob = Math.sin(G.bobPh) * (running ? 1.5 : 1);
  } else G.bob *= 0.9;
  G.noise = running ? ENTS.wander.hear : moving ? 4 : 0;
  // Level 1 のフリッカリング：ときどき灯りがいっせいに消え、何かが狩りに出てくる
  const bo = WD.cfg.blackout;
  if (bo) {
    if (G.blackT == null) G.blackT = bo.every[0] + Math.random() * (bo.every[1] - bo.every[0]);
    G.blackT -= dt;
    if (G.blackT <= 0) {
      G.blackout = !G.blackout;
      if (G.blackout) {
        G.blackT = bo.dur[0] + Math.random() * (bo.dur[1] - bo.dur[0]);
        toast('灯りが、いっせいに消えた。……フリッカリングだ'); sfx('zap', { pan: 0 }); vibe(30);
        if (G.ents.filter(e => e.type === 'wander').length < (WD.cfg.ents.wander ? WD.cfg.ents.wander.max : 1) + 1) trySpawn('wander');
      } else { G.blackT = bo.every[0] + Math.random() * (bo.every[1] - bo.every[0]); toast('灯りが戻った'); }
    }
    if (G.blackout && S.flash && S.bat > 0) G.noise = Math.max(G.noise, 10);   // 暗闇で明かりをつけると、気づかれる
  }
  // 体力
  if (running) { S.stam -= 22 * dt; if (S.stam <= 0) { S.stam = 0; G.tired = true; toast('息が切れた'); } }
  else S.stam = Math.min(100, S.stam + (moving ? 11 : 20) * dt);
  const cfg = WD.cfg;
  if (cfg.noLight) S.flash = false;   // Level 6：明かりがつかない
  // 懐中電灯
  if (S.flash) {
    S.bat -= 0.42 * (cfg.hard ? 1.3 : 1) * (cfg.batMul || 1) * dt;
    if (S.bat <= 0) {
      if (S.spare > 0) { S.spare--; S.bat = 100; toast('電池を入れ替えた'); }
      else { S.bat = 0; S.flash = false; toast('電池が切れた'); sfx('click'); }
    }
  }
  // 渇きと正気
  const calm = !!cfg.calm;
  if (!cfg.noStats) S.thirst = Math.max(0, S.thirst - (calm ? 0.03 : 0.085) * (cfg.thirstMul || 1) * dt);
  const lh = lightAt(S.x, S.y);
  G.dark = lh;
  let drain = cfg.sanDrain || 0.05;
  if (lh < 0.3 && !(S.flash && S.bat > 0)) drain += 0.32;
  if (S.thirst <= 0) drain += 0.4;
  // 拾う
  for (const it of nearbyItems()) if (Math.hypot(it.x - S.x, it.y - S.y) < 0.55) { pickUp(it); if (G.mode !== 'play') return; }
  // 出口
  const ep = exitPoint() || { x: S.x + 1e4, y: S.y };
  const edx = ep.x - S.x, edy = ep.y - S.y, ed = Math.hypot(edx, edy);
  G.nearExit = !!WD.exit && ed < 1.25 && Math.abs(angDiff(Math.atan2(edy, edx), S.a)) < 1.0;
  if (G.hint > 0) G.hint -= dt;
  // 怪物
  spawnTick(dt);
  const caught = updateEnts(dt);
  if (G.seen) drain += 1.5;
  if (G.seenFace) drain += 0.25;
  if (calm) drain = -0.7;
  if (!cfg.noStats) S.san = clamp(S.san - drain * dt, 0, 100);
  // 音
  const exf = WD.exit ? { x: WD.exit.fx + 0.5, y: WD.exit.fy + 0.5 } : null;
  audioUpdate({
    lightHere: lh, exitDist: ed, exitPan: Math.sin(angDiff(Math.atan2(edy, edx), S.a)),
    exitLos: !!exf && ed < 30 && lineOfSight(S.x, S.y, exf.x, exf.y), fear: G.fear, sanity: S.san,
  });
  // ちらつく灯りのジジッという音
  G.flashT -= dt;
  if (G.flashT <= 0) {
    G.flashT = 0.25;
    const X = Math.floor(S.x), Y = Math.floor(S.y);
    for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) if (lampAt(X + i, Y + j) === 2 && Math.random() < 0.5) {
      const b = flickAt(X + i, Y + j, G.t);
      if (b > 0.4) sfx('zap', { pan: clamp(i / 3, -1, 1) });   // 少し離れたちらつきも聞こえる
    }
  }
  if (caught) { gameOver('caught', caught); return; }
  if (S.san <= 0) { gameOver('lost'); return; }
  G.saveT -= dt;
  if (G.saveT <= 0) { G.saveT = store().kind === 'tasker' ? 10 : 4; saveGame(); }   // Tasker の変数へは間をあけて
}
function sprites() {
  const out = [];
  const cfg = WD.cfg, es = cfg.entSpr || {};
  const ic = cfg.itemSpr || (OPT.claude ? 'sp_claude' : '');   // 拾う物を Claude のマークで描く
  const itx = cfg.itemTex || {};
  for (const it of nearbyItems()) out.push(ic ? { x: it.x, y: it.y, spr: ic, h: 0.4, lift: 0.08 + 0.04 * Math.sin(G.t * 2 + it.x), emit: 1 } : { x: it.x, y: it.y, spr: itx[it.t] || ITEM_SPR[it.t], h: 0.42 });
  for (const e of G.ents) {
    if (e.type === 'wander') out.push({ x: e.x, y: e.y, spr: es.wander || 'sp_wander', h: es.wanderH || 1.22 });
    else if (e.type === 'face') out.push({ x: e.x, y: e.y, spr: es.face || 'sp_face', h: 1.12 });
    else out.push({ x: e.x, y: e.y, spr: es.grin || 'sp_grin', h: 0.75, lift: 0.3, glow: e.st === 'flee' ? 0.5 + Math.random() * 0.5 : 1 });
  }
  return out;
}
function frameFx() {
  const low = clamp((40 - S.san) / 40, 0, 1), cfg = WD.cfg;
  return {
    desat: Math.min(0.85, (cfg.desat || 0) + (cfg.hard ? low * 0.3 : 0)),
    yellow: cfg.orig ? Math.min(0.55, S.time / 1500) : 0,
    bob: G.bob, flash: S.flash && S.bat > 0 ? 1.75 * (cfg.flashMul || 1) * (S.bat < 15 && Math.random() < 0.08 ? 0.3 : 1) : 0,
    noise: 0.04 + low * 0.32 + G.fear * 0.12 + (cfg.orig ? Math.min(0.12, S.time / 4000) : 0), glitch: low > 0.5 ? low : 0,
    dark: G.mode === 'trans' ? Math.min(1, G.transT) : 0, fogMul: 1 + low * 0.6,
  };
}
