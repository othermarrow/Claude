// ===== ゲームの状態 =====
let S = null;
const SAVE_KEY = 'ashmaze_save_v1';
const MAXP = 6, MAXI = 8;

function newState() {
  return {
    v: 1, gold: 0, roster: [], party: [], nextId: 1,
    inMaze: false, pos: { f: 1, x: 0, y: MH - 1, d: 0 },
    light: 0, levit: 0, seen: {}, secrets: {}, rooms: {}, guards: {}, guardDone: {}, boss: 0,
    deepest: 1, shop: {}, cleared: 0, steps: 0, battles: 0,
    opts: { speed: 1, vib: 1 }, t: 0,
  };
}

// ----- 保存（ブラウザの保存領域。Tasker の関数があればファイルにも） -----
const TASKER_FILE = '/storage/emulated/0/Download/ash-maze-save.json';
function taskerFn(name) {
  try {
    if (typeof tk !== 'undefined' && tk && typeof tk[name] === 'function') return tk[name].bind(tk);
    // Tasker の関数が、そのままの名前で置かれている場合
    if (typeof setGlobal === 'function' && typeof window[name] === 'function') return window[name];
  } catch (e) { }
  return null;
}
// この画面で、ブラウザの保存領域が使えるか
function storageOk() {
  try { localStorage.setItem('ashmaze_test', '1'); const v = localStorage.getItem('ashmaze_test'); localStorage.removeItem('ashmaze_test'); return v === '1'; }
  catch (e) { return false; }
}
function saveGame() {
  if (!S) return;
  S.t = Date.now();
  const txt = JSON.stringify(S);
  try { localStorage.setItem(SAVE_KEY, txt); } catch (e) { }
  const wf = taskerFn('writeFile');
  if (wf) { try { wf(TASKER_FILE, txt, false); } catch (e) { } }
}
function loadGame() {
  let best = null;
  const tryParse = t => { try { const o = JSON.parse(t); return o && o.v ? o : null; } catch (e) { return null; } };
  try { best = tryParse(localStorage.getItem(SAVE_KEY)); } catch (e) { }
  const rf = taskerFn('readFile');
  if (rf) {
    try { const o = tryParse(rf(TASKER_FILE)); if (o && (!best || o.t > best.t)) best = o; } catch (e) { }
  }
  return best;
}
function exportSave() { return btoa(unescape(encodeURIComponent(JSON.stringify(S)))); }
function importSave(code) {
  const o = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
  if (!o || !o.v || !Array.isArray(o.roster)) throw new Error('記録の形が違います');
  return o;
}
function fixState(o) {   // 古い記録に足りない項目を足す
  const d = newState();
  for (const k in d) if (o[k] === undefined) o[k] = d[k];
  for (const c of o.roster) if (c.status === 'sleep') c.status = 'ok';   // 戦いの途中で閉じたとき
  return o;
}

// ----- キャラクター -----
function byId(id) { return S.roster.find(c => c.id === id); }
function partyChars() { return S.party.map(byId).filter(Boolean); }
function inTown(c) { return !S.party.includes(c.id) && !c.maze; }
function isGone(c) { return c.status === 'dead' || c.status === 'ash' || c.status === 'lost'; }
function canAct(c) { return c.status === 'ok'; }
function isDown(c) { return isGone(c) || c.status === 'stoned' || c.status === 'paralyzed'; }
const STATUS_N = { ok: '', sleep: '眠り', paralyzed: '麻痺', stoned: '石化', dead: '死亡', ash: '灰', lost: '消失' };
function statusText(c) {
  if (c.status !== 'ok') return STATUS_N[c.status];
  return c.poison ? '毒' : '';
}

function rollBonus() {
  let b = ri(5, 9);
  if (pct(12)) { b += 10; if (pct(15)) b += 10; }
  return b;
}
function classOk(cls, st, al) {
  if (!cls.al[al]) return false;
  for (let i = 0; i < 6; i++) if (st[i] < cls.req[i]) return false;
  return true;
}
function statBonus(v) { return v >= 18 ? 3 : v === 17 ? 2 : v === 16 ? 1 : v <= 3 ? -2 : v <= 5 ? -1 : 0; }
function hpRoll(cls, vit) { return Math.max(1, ri(1, cls.hd) + statBonus(vit)); }

function newChar(name, raceId, al, st, clsId) {
  const cls = CLS[clsId], race = RACES.find(r => r.id === raceId);
  const hd = cls.hd;
  const mhp = Math.max(2, ri(Math.ceil(hd / 2), hd) + Math.ceil(hd / 2) + statBonus(st[3]) + (cls.bonusHp || 0));
  const c = {
    id: S.nextId++, name, race: race.id, al, cls: clsId, lv: 1, exp: 0,
    hp: mhp, mhp, st: st.slice(), status: 'ok', poison: 0, items: [],
    mp: { m: [0, 0, 0, 0, 0, 0, 0], p: [0, 0, 0, 0, 0, 0, 0] },
    keep: { m: [0, 0, 0, 0, 0, 0, 0], p: [0, 0, 0, 0, 0, 0, 0] },
    maze: null, honor: 0, kills: 0,
  };
  restoreMp(c);
  return c;
}
function slotsBy(cls, lv, school, stat) {
  const spec = school === 'm' ? cls.mag : cls.pri;
  const out = [0, 0, 0, 0, 0, 0, 0];
  if (!spec) return out;
  for (let L = 1; L <= 7; L++) {
    const u = spec[0] + spec[1] * (L - 1);
    if (lvOk(lv, u)) {
      const n = spec[1] >= 3 ? 1 + Math.floor((lv - u) / 3) : 2 + Math.floor((lv - u) / 2);
      out[L - 1] = Math.min(9, n + (stat >= 17 ? 1 : 0));
    }
  }
  return out;
}
function lvOk(lv, u) { return lv >= u; }
function maxSlots(c, school) {
  const cls = CLS[c.cls];
  const a = slotsBy(cls, c.lv, school, school === 'm' ? c.st[1] : c.st[2]);
  return a.map((v, i) => Math.max(v, c.keep[school][i]));
}
function restoreMp(c) { c.mp.m = maxSlots(c, 'm'); c.mp.p = maxSlots(c, 'p'); }
function knownSpells(c) {
  const m = maxSlots(c, 'm'), p = maxSlots(c, 'p');
  return SPELLS.filter(s => (s.s === 'm' ? m : p)[s.lv - 1] > 0);
}
function canCast(c, sp) { return c.mp[sp.s][sp.lv - 1] > 0; }

function expNeed(c, L) { return Math.round(expBase(L) * CLS[c.cls].xm); }

function equipped(c, kind) { const it = c.items.find(i => i.eq && IT[i.id].kind === kind); return it ? IT[it.id] : null; }
function charAC(c) {
  let ac = 10;
  for (const i of c.items) if (i.eq) ac -= IT[i.id].ac;
  const cls = CLS[c.cls];
  if (cls.naked) {
    const arm = equipped(c, 'arm'), shd = equipped(c, 'shd');
    if ((!arm || arm.ninOK) && !shd) ac -= Math.floor(c.lv / 3) + 2;
  }
  return ac;
}
function hitSkill(c) {
  const cls = CLS[c.cls];
  let h = cls.hit === 3 ? 2 + Math.floor(c.lv / 2) : cls.hit === 2 ? 1 + Math.floor(c.lv / 3) : Math.floor(c.lv / 4);
  h += statBonus(c.st[0]);
  for (const i of c.items) if (i.eq) h += IT[i.id].hit || 0;
  return h;
}
function numAttacks(c) {
  const cls = CLS[c.cls];
  if (!cls.multi) return 1;
  return Math.min(5, 1 + Math.floor(c.lv / cls.multi));
}
function weaponDmg(c) {
  const w = equipped(c, 'wep');
  if (w) return w.dmg;
  if (CLS[c.cls].naked) return [2, 4, Math.floor(c.lv / 3)];
  return [1, 2, 0];
}
function critChance(c) {
  let p = 0;
  if (CLS[c.cls].crit) p = Math.min(40, c.lv * 2);
  const w = equipped(c, 'wep'); if (w && w.crit) p += w.crit;
  return p;
}
function resistChance(c, kind) {   // 状態異常をはね返す確率
  const race = RACES.find(r => r.id === c.race);
  let p = 15 + c.lv * 3 + Math.max(0, c.st[5] - 8) * 2 + ((race.res || {})[kind] || 0) + (kind === 'sleep' ? 20 : 0);
  if (kind === 'poison' && c.items.some(i => i.eq && IT[i.id].noPoison)) return 100;
  if (kind === 'drain' && c.items.some(i => i.eq && IT[i.id].noDrain)) return 100;
  return clamp(p, 0, 90);
}

// ----- レベルアップ（宿屋で） -----
function levelUp(c) {
  const msgs = [];
  const cls = CLS[c.cls];
  const beforeKnown = knownSpells(c).map(s => s.id);
  c.lv++;
  const gain = hpRoll(cls, c.st[3]);
  c.mhp += gain; c.hp += gain;
  msgs.push(`${c.name}は レベル${c.lv}になった！（HP +${gain}）`);
  const ch = [];
  for (let i = 0; i < 6; i++) {
    if (c.st[i] < 18 && pct(28)) { c.st[i]++; ch.push(STATS[i] + '+1'); }
    else if (c.st[i] > 3 && pct(4)) { c.st[i]--; ch.push(STATS[i] + '-1'); }
  }
  if (ch.length) msgs.push('　' + ch.join('　'));
  const newSp = knownSpells(c).filter(s => !beforeKnown.includes(s.id));
  if (newSp.length) msgs.push('　新しい呪文：' + newSp.map(s => s.n).join('・'));
  return msgs;
}
function drainLevel(c, n) {
  const old = c.lv;
  c.lv = Math.max(1, c.lv - n);
  if (c.lv === old) return false;
  c.mhp = Math.max(1, Math.round(c.mhp * c.lv / old));
  c.hp = Math.min(c.hp, c.mhp);
  c.exp = expNeed(c, c.lv);
  for (const s of ['m', 'p']) {
    const mx = maxSlots(c, s);
    c.mp[s] = c.mp[s].map((v, i) => Math.min(v, mx[i]));
  }
  return true;
}

// ----- 持ち物 -----
function itemName(it) { const d = IT[it.id]; return it.idf || d.kind === 'key' ? d.n : d.unk; }
function canEquipCls(c, d) { return d.cls.includes(CLS[c.cls].s); }
function addItem(c, id, idf) {
  if (c.items.length >= MAXI) return false;
  const d = IT[id];
  c.items.push({ id, eq: 0, idf: idf || d.kind === 'key' ? 1 : 0 });
  return true;
}
function giveItemToParty(id, idf) {
  const ps = partyChars().filter(c => c.status !== 'lost');
  const order = shuffle(ps.slice());
  for (const c of order) if (addItem(c, id, idf)) return c;
  return null;
}
function hasKey(key) { return partyChars().some(c => c.items.some(i => i.id === key)); }
function rosterHasKey(key) { return S.roster.some(c => c.items.some(i => i.id === key)); }
function equipItem(c, idx) {
  const it = c.items[idx], d = IT[it.id];
  if (!EQ_KINDS.includes(d.kind)) return '装備できない物だ。';
  if (!canEquipCls(c, d)) return CLS[c.cls].n + 'には装備できない。';
  const cur = c.items.find(i => i.eq && IT[i.id].kind === d.kind);
  if (cur && cur.cur) return `${itemName(cur)}が呪われていて外せない！`;
  if (cur) cur.eq = 0;
  it.eq = 1;
  if (d.curse) { it.idf = 1; it.cur = 1; return `${d.n}は呪われていた！　外せなくなった。`; }
  return `${itemName(it)}を装備した。`;
}
function unequipItem(c, idx) {
  const it = c.items[idx];
  if (it.cur) return '呪われていて外せない！';
  it.eq = 0;
  return `${itemName(it)}を外した。`;
}
function identifyChance(c) { return clamp(15 + c.lv * 5 + Math.max(0, c.st[1] - 10) * 2, 5, 95); }

// ----- 宿屋・寺院・商店 -----
function innCost(room, n) { return room === 0 ? 0 : room === 1 ? 10 * n : 50 * n; }
function stayInn(room) {
  const msgs = [];
  for (const c of partyChars()) {
    if (isDown(c)) { msgs.push(`${c.name}は ${STATUS_N[c.status]}なので休めない。`); continue; }
    c.poison = 0;
    if (room >= 1) c.hp = c.mhp;
    restoreMp(c);
    let n = 0;
    while (c.exp >= expNeed(c, c.lv + 1) && n < 50) { msgs.push(...levelUp(c)); n++; }
    if (!n) {
      const rest = expNeed(c, c.lv + 1) - c.exp;
      msgs.push(`${c.name}は 次のレベルまで あと${rest}。`);
    }
  }
  return msgs;
}
function templeCost(c) {
  const m = { paralyzed: 100, stoned: 200, dead: 250, ash: 500 }[c.status];
  return m ? m * c.lv : 0;
}
function templeHeal(c) {
  const msgs = [];
  if (c.status === 'paralyzed' || c.status === 'stoned') {
    c.status = 'ok'; msgs.push(`${c.name}は 元に戻った。`);
  } else if (c.status === 'dead') {
    if (pct(clamp(45 + c.st[3] * 3, 10, 95))) { c.status = 'ok'; c.hp = c.mhp; if (c.st[3] > 3) c.st[3]--; msgs.push(`${c.name}は 生き返った！`); }
    else { c.status = 'ash'; c.hp = 0; msgs.push(`しまった！　${c.name}は 灰になった……`); }
  } else if (c.status === 'ash') {
    if (pct(clamp(35 + c.st[3] * 3, 10, 90))) { c.status = 'ok'; c.hp = c.mhp; if (c.st[3] > 3) c.st[3]--; msgs.push(`${c.name}は 灰から よみがえった！`); }
    else { c.status = 'lost'; msgs.push(`${c.name}は 永遠に失われた……`); }
  }
  return msgs;
}
function removeLost() {
  const lost = S.roster.filter(c => c.status === 'lost');
  for (const c of lost) {
    S.roster = S.roster.filter(x => x !== c);
    S.party = S.party.filter(id => id !== c.id);
  }
  return lost;
}
function shopList() {
  return ITEMS.filter(d => d.kind !== 'key' && (d.dep === 0 || (S.shop[d.id] || 0) > 0));
}
function sellPrice(it) { const d = IT[it.id]; return it.idf ? Math.floor(d.price / 2) : Math.floor(d.price / 4); }

// ----- 迷宮 -----
function curFloor() { return WORLD[S.pos.f]; }
function seenArr(f) {
  if (!S.seen[f]) S.seen[f] = '0'.repeat(MW * MH);
  return S.seen[f];
}
function markSeen(f, x, y) {
  const a = seenArr(f), i = ci(x, y);
  if (a[i] === '1') return;
  S.seen[f] = a.slice(0, i) + '1' + a.slice(i + 1);
}
function isSeen(f, x, y) { return seenArr(f)[ci(x, y)] === '1'; }
function secretKey(f, x, y, d) {
  if (d === 0) { y--; d = 2; } else if (d === 3) { x--; d = 1; }
  return f + ',' + x + ',' + y + ',' + d;
}
function secretFound(f, x, y, d) { return !!S.secrets[secretKey(f, x, y, d)]; }
// 見た目の壁（隠し扉は、見つけたか灯りがあれば扉に見える）
function viewWall(f, x, y, d) {
  const v = getW(WORLD[f], x, y, d);
  if (v === W_SECRET) return (S.light > 0 || secretFound(f, x, y, d)) ? W_DOOR : W_WALL;
  return v;
}
function cellSp(f, x, y) { return WORLD[f].sp[ci(x, y)] || null; }
function isDark(f, x, y) { const s = cellSp(f, x, y); return !!(s && s.t === 'dark'); }

// 前に進む。結果: {ok, msg}
function tryMove(dir) {
  const { f, x, y } = S.pos;
  const v = getW(WORLD[f], x, y, dir);
  const nx = x + DX[dir], ny = y + DY[dir];
  if (!inb(nx, ny) || v === W_WALL) return { ok: false, msg: 'ゴツン！　壁だ。' };
  if (v === W_SECRET && !(S.light > 0 || secretFound(f, x, y, dir))) return { ok: false, msg: 'ゴツン！　壁だ。' };
  let msg = null;
  if (v === W_LOCK) {
    const k = WORLD[f].lock.key;
    if (!hasKey(k)) return { ok: false, msg: '鍵のかかった扉だ。開けるには何かが要る。' };
    msg = `${IT[k].n}を使って 扉を開けた。`;
  }
  if (v === W_SECRET && !secretFound(f, x, y, dir)) S.secrets[secretKey(f, x, y, dir)] = 1;
  S.pos.x = nx; S.pos.y = ny;
  return { ok: true, msg };
}
// 1歩ごとの処理（毒・指輪・灯りの残り）
function stepTick() {
  const msgs = [];
  S.steps++;
  if (S.light > 0) { S.light--; if (!S.light) msgs.push('灯りが消えた。'); }
  if (S.levit > 0) { S.levit--; if (!S.levit) msgs.push('体が床に降りた。'); }
  for (const c of partyChars()) {
    if (isGone(c) || c.status === 'stoned') continue;
    let d = 0;
    if (c.poison) d += 1;
    for (const i of c.items) if (i.eq) { const it = IT[i.id]; if (it.drain) d += it.drain; if (it.regen) d -= it.regen; }
    if (d > 0) {
      c.hp -= d;
      if (c.hp <= 0) { c.hp = 0; c.status = 'dead'; c.poison = 0; msgs.push(`${c.name}は 力尽きた……`); }
    } else if (d < 0) c.hp = Math.min(c.mhp, c.hp - d);
  }
  return msgs;
}
function partyWiped() { const p = partyChars(); return p.length > 0 && p.every(isDown); }
function randomSafeCell(f) {
  const F = WORLD[f], cs = [];
  for (let c = 0; c < MW * MH; c++) if (F.free[c] >= 0 && !F.sp[c] && F.room[c] < 0) cs.push(c);
  const c = pick(cs);
  return { x: c % MW, y: (c / MW) | 0 };
}
function revealAround(r) {
  const { f, x, y } = S.pos;
  for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++)
    if (inb(xx, yy) && !isDark(f, xx, yy)) markSeen(f, xx, yy);
}

// 敵の群れを作る
function makeGroup(mid, n) {
  const m = MN[mid];
  const units = [];
  for (let i = 0; i < n; i++) { const hp = Math.max(1, dice(m.hp)); units.push({ hp, mhp: hp, st: 'ok', sil: 0 }); }
  const lvMax = Math.max(1, ...partyChars().map(c => c.lv));
  const known = m.boss ? true : pct(clamp(30 + lvMax * 4, 30, 90));
  return { mid, units, known, acMod: 0 };
}
function randomEncounter(f) {
  const tbl = FLOOR_MON[f];
  const r = rnd() * 100, a = Math.min(15, f * 1.5);
  let ng = r < 50 - a ? 1 : r < 82 - a / 2 ? 2 : r < 96 ? 3 : 4;
  if (f <= 1 && ng > 2) ng = 2;
  const groups = [], cap = f === 1 ? 5 : f === 2 ? 7 : 9;
  let total = 0;
  for (let i = 0; i < ng && total < cap; i++) {
    const m = MN[pick(tbl)];
    const n = Math.min(ri(m.g[0], m.g[1]), cap - total);
    if (n <= 0) break;
    groups.push(makeGroup(m.id, n)); total += n;
  }
  return groups;
}
function guardEncounter(f) {
  return GUARDS[f].groups.map(([mid, n]) => makeGroup(mid, n));
}

// 宝箱
function makeChest(f) {
  const r = rnd() * 100;
  let trap = 0;
  if (r > 25 - f) trap = ri(1, Math.min(8, 3 + Math.floor(f / 2) + 1));
  return { f, trap, gold: f * ri(25, 75) + ri(0, 50), item: pct(55 + f * 2) ? randomItemId(f) : null };
}
function randomItemId(f) {
  const cand = [], w = [];
  for (const d of ITEMS) {
    if (d.kind === 'key') continue;
    const dep = d.dep || 1;
    if (dep > f + 1 || dep < f - 4) continue;
    cand.push(d.id); w.push(dep >= f - 1 ? 3 : 1);
  }
  let t = w.reduce((a, b) => a + b, 0) * rnd();
  for (let i = 0; i < cand.length; i++) { t -= w[i]; if (t < 0) return cand[i]; }
  return cand[cand.length - 1];
}
function disarmChance(c) {
  return CLS[c.cls].thief ? clamp(55 + c.lv * 3 + statBonus(c.st[4]) * 3, 5, 97) : clamp(10 + c.lv, 5, 40);
}
function inspectChance(c) {
  return CLS[c.cls].thief ? clamp(60 + c.lv * 3, 5, 97) : clamp(20 + c.lv * 2, 5, 60);
}
// 罠が働く。返り値: {msgs, tele, alarm}
function springTrap(chest, c) {
  const msgs = [], f = chest.f, out = { msgs };
  const t = TRAPS[chest.trap];
  if (!chest.trap) return out;
  msgs.push(`しまった！　${t}だ！`);
  const ps = partyChars().filter(p => !isGone(p) && p.status !== 'stoned');
  const hurt = (p, d) => {
    p.hp -= d;
    msgs.push(`${p.name}に ${d}のダメージ。`);
    if (p.hp <= 0) { p.hp = 0; p.status = 'dead'; p.poison = 0; msgs.push(`${p.name}は 死んだ。`); }
  };
  switch (chest.trap) {
    case 1: if (!pct(resistChance(c, 'poison'))) { c.poison = 1; msgs.push(`${c.name}は 毒をうけた。`); } else msgs.push(`${c.name}は 毒をよけた。`); break;
    case 2: hurt(c, dice([f, 6, 0])); break;
    case 3: for (const p of ps) if (!pct(resistChance(p, 'poison'))) { p.poison = 1; msgs.push(`${p.name}は 毒をうけた。`); } break;
    case 4: for (const p of ps) hurt(p, dice([Math.ceil(f / 2), 6, 0])); break;
    case 5: if (!pct(resistChance(c, 'paralyze'))) { c.status = 'paralyzed'; msgs.push(`${c.name}は 体がしびれて動けない！`); } break;
    case 6: if (!pct(resistChance(c, 'stone'))) { c.status = 'stoned'; msgs.push(`${c.name}は 石になった！`); } break;
    case 7: out.tele = true; msgs.push('景色が ぐにゃりと ゆがんだ……'); break;
    case 8: out.alarm = true; msgs.push('けたたましい音が 響きわたった！'); break;
  }
  return out;
}

// 全滅：迷宮に残される
function wipeParty() {
  const { f, x, y } = S.pos;
  for (const c of partyChars()) c.maze = { f, x, y };
  S.party = []; S.inMaze = false; S.light = 0; S.levit = 0;
}
function bodiesHere() {
  const { f, x, y } = S.pos;
  return S.roster.filter(c => c.maze && c.maze.f === f && c.maze.x === x && c.maze.y === y);
}
function leaveMaze() {   // 町に戻る
  S.inMaze = false; S.light = 0; S.levit = 0; S.rooms = {}; S.guards = {};
  for (const c of partyChars()) { c.poison = 0; if (c.status === 'sleep') c.status = 'ok'; }
  // 死んだ者を後ろへ
  S.party.sort((a, b) => (isDown(byId(a)) ? 1 : 0) - (isDown(byId(b)) ? 1 : 0));
}
function sortDeadBack() {
  S.party.sort((a, b) => (isDown(byId(a)) ? 1 : 0) - (isDown(byId(b)) ? 1 : 0));
}

// ----- 戦闘の外で呪文・道具を使う -----
// 戻り値 {msgs, warp?, home?}
function applyAllySpell(sp, target, fromItem) {
  const msgs = [], fx = sp.fx;
  if (fx.heal) {
    if (isGone(target)) { msgs.push(`${target.name}には 効かない。`); return msgs; }
    const before = target.hp;
    target.hp = fx.heal === 'full' ? target.mhp : Math.min(target.mhp, target.hp + dice(fx.heal));
    msgs.push(`${target.name}の HPが ${target.hp - before} 回復した。`);
  }
  if (fx.cure) {
    let done = false;
    if (fx.cure.includes('poison') && target.poison) { target.poison = 0; done = true; msgs.push(`${target.name}の 毒が消えた。`); }
    if (fx.cure.includes(target.status)) { msgs.push(`${target.name}の ${STATUS_N[target.status]}が治った。`); target.status = 'ok'; done = true; }
    if (!done && !fx.heal) msgs.push('何も起こらなかった。');
  }
  if (fx.raise) {
    const st = target.status;
    if (st === 'dead' || (st === 'ash' && fx.raise === 2)) {
      const p = clamp((fx.raise === 2 ? 60 : 40) + target.st[3] * 3 - (st === 'ash' ? 15 : 0), 10, 98);
      if (pct(p)) {
        target.status = 'ok'; target.hp = fx.raise === 2 ? target.mhp : 1;
        if (target.st[3] > 3) target.st[3]--;
        msgs.push(`${target.name}は 生き返った！`);
      } else if (st === 'dead') { target.status = 'ash'; msgs.push(`失敗した……　${target.name}は 灰になった。`); }
      else { target.status = 'lost'; msgs.push(`失敗した……　${target.name}は 消え失せた。`); }
    } else msgs.push(`${target.name}には 効かない。`);
  }
  return msgs;
}
function campSpell(sp, target) {
  const fx = sp.fx, out = { msgs: [] };
  if (cellSp(S.pos.f, S.pos.x, S.pos.y) && cellSp(S.pos.f, S.pos.x, S.pos.y).t === 'anti') {
    out.msgs.push('呪文は かき消された……（魔法の効かない場所だ）'); return out;
  }
  if (fx.light) { S.light = Math.max(S.light, fx.light); out.msgs.push('あたりが明るくなった。'); }
  if (fx.levit) { S.levit = Math.max(S.levit, fx.levit); out.msgs.push('体が ふわりと浮いた。'); }
  if (fx.reveal) { revealAround(fx.reveal); out.msgs.push('まわりの様子が 頭に浮かんだ。（地図を見よう）'); }
  if (fx.warp) out.warp = true;
  if (fx.home) out.home = true;
  if (fx.heal || fx.cure || fx.raise) out.msgs.push(...applyAllySpell(sp, target));
  return out;
}
