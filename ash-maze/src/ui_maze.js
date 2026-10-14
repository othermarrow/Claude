// ===== 迷宮の画面 =====
const ENC_RATE = 6;   // 1歩ごとに敵と出会う確率(%)

function mazeHdr() {
  const { f, x, y, d } = S.pos;
  const tags = (S.light > 0 ? '<span class="tag">灯</span>' : '') + (S.levit > 0 ? '<span class="tag">浮</span>' : '');
  return `<span>B${f}F　${DIR_N[d]}向き</span><span>${tags}${dispXY(x, y)}</span>`;
}
function scrMaze(note) {
  UI.screen = 'maze'; UI.rowClick = i => { if (!UI.busy) charSheet(partyChars()[i], 'camp').then(() => updateMaze()); };
  render(`<div class="hdr" id="mhdr">${mazeHdr()}</div>
    <canvas id="view" class="view"></canvas>
    <div id="msg" class="msg"></div>
    ${partyBox()}
    <div class="pad">
      ${b('↰ 左', () => turn(3))}${b('▲ 前へ', fwd, 'main')}${b('右 ↱', () => turn(1))}
      ${b('調べる', search, 'ghost')}${b('▼ 振り向く', () => turn(2))}${b('地図', () => scrMap(S.pos.f), 'ghost')}
    </div>
    <div class="menu">${b('キャンプ（呪文・道具・装備）', () => { if (!UI.busy) scrCamp(); })}</div>`);
  $('#view').addEventListener('click', () => { if (!UI.playing && !$('#ov').childElementCount) fwd(); });
  drawView($('#view'));
  if (note) setMsg(note);
}
function updateMaze() {
  if (UI.screen !== 'maze') return;
  const h = $('#mhdr'); if (h) h.innerHTML = mazeHdr();
  const v = $('#view'); if (v) drawView(v);
  const p = $('#party'); if (p) p.innerHTML = partyRows();
}
document.addEventListener('keydown', e => {
  if (UI.screen !== 'maze' || UI.busy || UI.playing || $('#ov').childElementCount) return;
  const k = { ArrowUp: fwd, ArrowLeft: () => turn(3), ArrowRight: () => turn(1), ArrowDown: () => turn(2), m: () => scrMap(S.pos.f), c: () => scrCamp(), s: search }[e.key];
  if (k) { e.preventDefault(); k(); }
});

function turn(n) {
  if (UI.busy || UI.playing) return;
  S.pos.d = (S.pos.d + n) & 3;
  setMsg('');
  updateMaze(); saveGame();
}
async function fwd() {
  if (UI.busy || UI.playing) return;
  const r = tryMove(S.pos.d);
  if (!r.ok) { setMsg(r.msg); vib(25); return; }
  UI.busy = true;
  try {
    setMsg(r.msg || '');
    const t = stepTick();
    updateMaze();
    if (t.length) await play(t, true);
    if (partyWiped()) { await wipeFlow(); return; }
    await arrive();
  } finally { UI.busy = false; }
  updateMaze();
  saveGame();
}
async function search() {
  if (UI.busy || UI.playing) return;
  UI.busy = true;
  try {
    const { f, x, y, d } = S.pos;
    const v = getW(WORLD[f], x, y, d);
    const thief = partyChars().some(c => CLS[c.cls].thief && canAct(c));
    const t = stepTick();
    let m;
    if (v === W_SECRET && !secretFound(f, x, y, d)) {
      if (pct(thief ? 70 : 35)) { S.secrets[secretKey(f, x, y, d)] = 1; m = '壁の継ぎ目に 隠し扉を見つけた！'; vib(60); }
      else m = '何も見つからない。';
    } else if (v === W_LOCK) m = '鍵穴のある 頑丈な扉だ。';
    else if (cellSp(f, x, y) && cellSp(f, x, y).t === 'anti') m = '空気が重い。ここでは呪文が効かないようだ。';
    else m = '何も見つからない。';
    setMsg(m);
    updateMaze();
    if (t.length) await play(t, true);
    if (partyWiped()) { await wipeFlow(); return; }
    if (pct(4)) await battleFlow(randomEncounter(f), {});
  } finally { UI.busy = false; }
  updateMaze(); saveGame();
}

// その場所に着いたとき
async function arrive() {
  const { f, x, y } = S.pos, F = WORLD[f], c = ci(x, y);
  if (!isDark(f, x, y)) markSeen(f, x, y);
  if (f > S.deepest) S.deepest = f;
  const bodies = bodiesHere();
  if (bodies.length) await bodiesFlow(bodies);
  const sp = F.sp[c];
  const prevT = UI.lastCellT; UI.lastCellT = sp ? sp.t : null;
  if (sp) {
    if (sp.t === 'msg') await alertMsg(FLOOR_MSG[f][sp.m]);
    else if (sp.t === 'pit') { if (await pitFlow(f)) return; }
    else if (sp.t === 'chute') {
      if (S.levit) setMsg('床に大きな穴がある。浮いているので落ちずにすんだ。');
      else {
        await alertMsg('床が抜けた！\n一行は 下の階へ 落ちていった……');
        S.pos.f = f + 1; UI.lastCellT = null;
        updateMaze();
        return arrive();
      }
    } else if (sp.t === 'tele') {
      const p = randomSafeCell(f);
      S.pos.x = p.x; S.pos.y = p.y; markSeen(f, p.x, p.y); UI.lastCellT = null;
      updateMaze();
      await alertMsg('足元が光った！\n……気がつくと、別の場所にいた。');
      return;
    } else if (sp.t === 'spin') S.pos.d = ri(0, 3);
    else if (sp.t === 'fount') await fountFlow();
    else if (sp.t === 'anti' && prevT !== 'anti') setMsg('空気が重い。呪文が効かない気がする……');
    else if (sp.t === 'dark' && prevT !== 'dark') setMsg('暗闇に入った。');
  }
  updateMaze();
  if (F.up.x === x && F.up.y === y) {
    if (await askYesNo(f === 1 ? '上り階段だ。町へ戻るか？' : '上り階段だ。上るか？')) {
      if (f === 1) { await returnTown(); return; }
      S.pos.f = f - 1; markSeen(S.pos.f, x, y); UI.lastCellT = null;
      updateMaze(); setMsg(`B${f - 1}Fに 上った。`);
      return;
    }
  }
  if (F.down && F.down.x === x && F.down.y === y) {
    if (await askYesNo('下り階段だ。下りるか？')) {
      S.pos.f = f + 1; markSeen(S.pos.f, x, y); UI.lastCellT = null;
      if (S.pos.f > S.deepest) S.deepest = S.pos.f;
      updateMaze(); setMsg(`B${f + 1}Fに 下りた。`);
      return;
    }
  }
  const r = F.room[c];
  if (r >= 0) {
    if (r === F.guardRoom && GUARDS[f]) {
      if (guardActive(f)) { S.guards[f] = 1; await guardFlow(f); return; }
    } else {
      const k = f + ':' + r;
      if (!S.rooms[k]) {
        S.rooms[k] = 1;
        if (pct(70)) { await battleFlow(randomEncounter(f), { chest: true, text: '部屋の中に 何者かがいる！' }); return; }
      }
    }
  }
  if (pct(ENC_RATE)) await battleFlow(randomEncounter(f), { chest: pct(15) });
}
function guardActive(f) {
  const g = GUARDS[f];
  if (S.guards[f]) return false;
  if (g.boss) return !S.boss;
  if (!S.guardDone) S.guardDone = {};
  return !S.guardDone[f] || !rosterHasKey(g.key);
}
async function guardFlow(f) {
  const g = GUARDS[f];
  await battleFlow(guardEncounter(f), { guard: f, boss: !!g.boss, text: g.text, chest: !g.boss });
}
async function pitFlow(f) {
  if (S.levit) { setMsg('落とし穴の上を ふわりと越えた。'); return false; }
  const msgs = ['落とし穴だ！'];
  for (const c of partyChars()) {
    if (isGone(c) || c.status === 'stoned') continue;
    const d = ri(f, f * 4 + 3);
    c.hp -= d; msgs.push(`${c.name}に ${d}のダメージ。`);
    if (c.hp <= 0) { c.hp = 0; c.status = 'dead'; c.poison = 0; msgs.push(`${c.name}は 死んだ。`); }
  }
  vib(80);
  updateMaze(); await play(msgs, true); updateMaze();
  if (partyWiped()) { await wipeFlow(); return true; }
  return false;
}
async function fountFlow() {
  if (!await askYesNo('石の泉がある。水を飲むか？')) return;
  const r = rnd();
  const ps = partyChars().filter(c => !isGone(c) && c.status !== 'stoned');
  if (r < 0.5) { for (const c of ps) { c.hp = c.mhp; c.poison = 0; } await alertMsg('冷たい水が 体にしみわたる。\n全員の傷が 癒えた！'); }
  else if (r < 0.75) { for (const c of ps) if (!pct(resistChance(c, 'poison'))) c.poison = 1; await alertMsg('うっ……　水に毒が混じっていた！'); }
  else await alertMsg('ただの水だった。');
  updateMaze();
}
async function bodiesFlow(bodies) {
  const names = bodies.map(c => c.name).join('、');
  const room = MAXP - S.party.length;
  if (room <= 0) { await alertMsg(`仲間の亡骸がある：${names}\n連れて行く余裕がない。（パーティは6人まで）`); return; }
  if (!await askYesNo(`仲間の亡骸がある：${names}\n連れて帰るか？`)) return;
  const take = bodies.slice(0, room);
  for (const c of take) { c.maze = null; S.party.push(c.id); }
  updateMaze();
  await alertMsg(`${take.map(c => c.name).join('、')}を 連れて行くことにした。` + (take.length < bodies.length ? '\n（全員は連れて行けなかった）' : ''));
}
async function wipeFlow() {
  updateMaze();
  await alertMsg('……パーティは 全滅した。', '……');
  wipeParty(); saveGame();
  scrTown('全滅した一行の亡骸は、迷宮に残された。\n別の仲間で その場所まで行けば、連れて帰れる。');
}
async function returnTown(note) {
  leaveMaze();
  const orb = partyChars().some(c => c.items.some(i => i.id === 'k04'));
  saveGame();
  if (orb) { await endingFlow(); return; }
  scrTown(note || '一行は 町に戻った。');
}
async function endingFlow() {
  for (const c of S.roster) c.items = c.items.filter(i => i.id !== 'k04');
  S.cleared++; S.gold += 50000;
  for (const c of partyChars()) c.honor = 1;
  saveGame();
  render(`<div class="title"><div class="logo">灰の迷宮</div><div class="story">${br(`王の宝珠は、玉座に戻った。

王は一行を迎え入れ、その名を 城の石碑に刻ませた。
${partyChars().map(c => '　' + c.name).join('\n')}

（全員に ★ の印がついた。褒美として 50000G を得た）

迷宮は まだそこにある。
冒険を続けることもできる。`)}</div><div class="menu">${b('町へ', () => scrTown('王の宝珠を取り戻した英雄たちが 帰ってきた。'))}</div></div>`);
}

// ---- 地図 ----
function scrMap(f) {
  UI.screen = 'map'; UI.rowClick = null;
  const floors = []; for (let i = 1; i <= S.deepest; i++) if (S.seen[i] && S.seen[i].includes('1')) floors.push(i);
  if (!floors.includes(f)) floors.push(f);
  floors.sort((a, b) => a - b);
  const i = floors.indexOf(f);
  render(`${header(`B${f}F の地図`, S.inMaze && S.pos.f === f ? dispXY(S.pos.x, S.pos.y) : '')}
    <canvas id="map" class="mapc"></canvas>
    <div class="note small">黄色の三角が今いる所。青は扉、赤は鍵の扉。上・下は階段、出は町への出口、文は石壁の文字、†は仲間の亡骸。隠し扉は見つけるまで壁に見える。</div>
    <div class="pad two">
      ${b('◀ 上の階', () => scrMap(floors[i - 1]), 'ghost', i <= 0)}${b('下の階 ▶', () => scrMap(floors[i + 1]), 'ghost', i >= floors.length - 1)}
    </div>
    <div class="menu">${b('戻る', () => S.inMaze ? (UI.campOpen ? scrCamp() : scrMaze()) : scrTown())}</div>`);
  drawMap($('#map'), f);
}

// ---- キャンプ ----
function scrCamp(note) {
  UI.screen = 'camp'; UI.campOpen = true; UI.rowClick = i => charSheet(partyChars()[i], 'camp').then(() => refreshCamp());
  const bis = partyChars().some(c => CLS[c.cls].ident && canAct(c));
  render(`${header('キャンプ', `B${S.pos.f}F ${dispXY(S.pos.x, S.pos.y)}`)}${partyBox()}
    <div id="msg" class="msg">${note ? br(note) : '一行は 腰を下ろした。'}</div>
    <div class="menu grid2">
      ${b('呪文を唱える', campCast)}${b('道具を使う', campUse)}
      ${b('持ち物・装備', async () => { const c = await pickChar('誰の持ち物？', partyChars()); if (c) await charSheet(c, 'camp'); refreshCamp(); })}
      ${b('並べ替え', async () => { await reorderParty(); scrCamp(); }, '', S.party.length < 2)}
      ${b('まとめて鑑定', campIdentAll, '', !bis)}
      ${b('地図', () => scrMap(S.pos.f))}
    </div>
    <div class="menu">${b('出発する', () => { UI.campOpen = false; scrMaze(); }, 'main')}${b('設定', scrSettings, 'ghost')}</div>`);
}
function refreshCamp() { if (UI.screen === 'camp') { const p = $('#party'); if (p) p.innerHTML = partyRows(); } }
async function campCast() {
  const casters = partyChars().filter(c => canAct(c) && knownSpells(c).some(s => s.w.includes('c')));
  const c = await pickChar('誰が唱える？', casters, x => `魔 ${x.mp.m.join('/')}　祈 ${x.mp.p.join('/')}`);
  if (!c) return;
  const sps = knownSpells(c).filter(s => s.w.includes('c'));
  const sp = await choose(`${c.name}の呪文`, sps.map(s => ({ label: `${s.n}<span class="lv">${s.s === 'm' ? '魔' : '祈'}${s.lv}</span>　残${c.mp[s.s][s.lv - 1]}`, sub: s.d, value: s, dis: !canCast(c, s) })));
  if (!sp) return;
  let t = null;
  if (sp.tg === 'ally') { t = await pickChar(`${sp.n}を 誰に？`, partyChars()); if (!t) return; }
  c.mp[sp.s][sp.lv - 1]--;
  await campEffect(campSpell(sp, t), `${c.name}は ${sp.n}を 唱えた。`);
}
async function campUse() {
  const users = partyChars().filter(c => canAct(c) && c.items.some(i => IT[i.id].use && SP[IT[i.id].use].w.includes('c')));
  const c = await pickChar('誰が使う？', users);
  if (!c) return;
  const opts = c.items.map((it, i) => ({ it, i })).filter(o => IT[o.it.id].use && SP[IT[o.it.id].use].w.includes('c')).map(o => ({ label: itemLine(o.it), value: o.i }));
  const i = await choose('どれを使う？', opts);
  if (i === null) return;
  await useItemCamp(c, i);
}
async function useItemCamp(c, i) {
  const it = c.items[i], d = IT[it.id], sp = SP[d.use];
  if (!S.inMaze || !sp.w.includes('c')) { await alertMsg('ここでは使えない。'); return; }
  let t = null;
  if (sp.tg === 'ally') { t = await pickChar(`誰に使う？`, partyChars()); if (!t) return; }
  it.idf = 1;
  const out = campSpell(sp, t);
  if (pct(d.brk || 0)) { c.items.splice(c.items.indexOf(it), 1); if (d.brk < 100) out.msgs.push(`${d.n}は 壊れてしまった。`); }
  await campEffect(out, `${c.name}は ${d.n}を 使った。`);
}
async function campEffect(out, first) {
  saveGame();
  if (UI.screen === 'camp') { refreshCamp(); setMsg(''); await play([first, ...out.msgs], true); refreshCamp(); }
  else await alertMsg([first, ...out.msgs].join('\n'));
  removeLost(); saveGame();
  if (out.home) { S.gold = Math.floor(S.gold / 2); await alertMsg('一行は 光に包まれ……\n気がつくと 町に戻っていた。（所持金が半分になった）'); await returnTown(); return; }
  if (out.warp) {
    const opts = [{ label: '町へ', value: 0 }];
    for (let f = 1; f <= S.deepest; f++) opts.push({ label: `B${f}F の上り階段へ`, value: f });
    const f = await choose('どこへ移る？', opts, 'やめる');
    if (f === null) return;
    if (f === 0) { await returnTown('一行は 町に移った。'); return; }
    S.pos = { f, x: WORLD[f].up.x, y: WORLD[f].up.y, d: 0 }; markSeen(f, S.pos.x, S.pos.y); UI.lastCellT = null; saveGame();
    UI.campOpen = false; scrMaze(`B${f}Fに 移った。`);
  }
}
async function campIdentAll() {
  const bs = partyChars().filter(c => CLS[c.cls].ident && canAct(c));
  const bi = bs.length === 1 ? bs[0] : await pickChar('誰が鑑定する？', bs, x => `成功率 ${identifyChance(x)}%`);
  if (!bi) return;
  const msgs = [];
  for (const c of partyChars()) for (const it of c.items) if (!it.idf) {
    if (pct(identifyChance(bi))) { it.idf = 1; msgs.push(`${IT[it.id].unk} → ${IT[it.id].n}（${c.name}）`); }
    else msgs.push(`${IT[it.id].unk}は わからなかった。（${c.name}）`);
  }
  saveGame(); refreshCamp();
  await play(msgs.length ? msgs : ['正体のわからない物はない。'], false);
}

// ---- 宝箱 ----
async function chestFlow(ch) {
  const names = TRAPS;
  for (;;) {
    const priest = partyChars().find(c => canAct(c) && knownSpells(c).some(s => s.id === 'wana') && c.mp.p[2] > 0);
    const r = await choose('宝箱がある。どうする？', [
      { label: '開ける', value: 'open' },
      { label: '罠を調べる', sub: '盗賊が得意', value: 'look' },
      { label: '罠見の呪文', sub: priest ? `${priest.name}が唱える` : '唱えられる者がいない', value: 'spell', dis: !priest },
      { label: '罠を外す', sub: '罠の名前を当てて外す', value: 'disarm' },
      { label: '立ち去る', value: 'leave' },
    ], false);
    const able = partyChars().filter(canAct);
    if (r === 'leave') { setMsg('宝箱を あとにした。'); return; }
    if (r === 'spell') {
      priest.mp.p[2]--;
      const guess = pct(95) ? ch.trap : ri(0, 8);
      await alertMsg(`${priest.name}は 罠見を唱えた。\n「${names[guess]}」だ。`);
      continue;
    }
    const who = able.length === 1 ? able[0] : await pickChar(r === 'open' ? '誰が開ける？' : r === 'look' ? '誰が調べる？' : '誰が外す？', able, c => `${CLS[c.cls].n} Lv${c.lv}　外す ${disarmChance(c)}%`);
    if (!who) continue;
    if (r === 'look') {
      if (pct(CLS[who.cls].thief ? 3 : 10)) { await alertMsg(`${who.name}は うっかり 罠に触れてしまった！`); await openChest(ch, who, true); return; }
      const guess = pct(inspectChance(who)) ? ch.trap : ri(0, 8);
      await alertMsg(`${who.name}は 宝箱を調べた。\n「${names[guess]}」のようだ。`);
      continue;
    }
    if (r === 'disarm') {
      const g = await choose('どの罠だと思う？', names.map((n, i) => ({ label: n, value: String(i) })));
      if (g === null) continue;
      if (+g === ch.trap) {
        if (!ch.trap || pct(disarmChance(who))) { await alertMsg(ch.trap ? `${who.name}は ${names[ch.trap]}を 外した！` : '罠は なかった。'); await openChest(ch, who, false); return; }
        if (pct(50)) { await alertMsg(`${who.name}は 罠を外しそこねた！`); await openChest(ch, who, true); return; }
        await alertMsg(`${who.name}は 罠を外せなかった。（まだ働いていない）`);
        continue;
      }
      await alertMsg(`違う罠だった！`);
      await openChest(ch, who, true); return;
    }
    if (r === 'open') { await openChest(ch, who, true); return; }
  }
}
async function openChest(ch, who, spring) {
  setMsg('');
  if (spring && ch.trap) {
    const out = springTrap(ch, who);
    updateMaze(); await play(out.msgs, true); updateMaze();
    if (partyWiped()) { await wipeFlow(); return; }
    if (out.tele) {
      const p = randomSafeCell(S.pos.f); S.pos.x = p.x; S.pos.y = p.y; markSeen(S.pos.f, p.x, p.y); UI.lastCellT = null;
      updateMaze(); await alertMsg('……気がつくと、別の場所にいた。宝箱は 置き去りになった。');
      return;
    }
    if (out.alarm) { await battleFlow(randomEncounter(S.pos.f), { text: '音を聞きつけて、敵がやって来た！' }); return; }
  }
  await loot(ch);
}
async function loot(ch) {
  const msgs = ['宝箱を開けた。'];
  S.gold += ch.gold; msgs.push(`金貨が ${ch.gold}枚 入っていた。`);
  const items = [];
  if (ch.item) items.push([ch.item, 0]);
  if (ch.key) items.push([ch.key, 1]);
  for (const [id, idf] of items) {
    let c = giveItemToParty(id, idf);
    if (!c && IT[id].kind === 'key') { c = partyChars()[0]; c.items.push({ id, eq: 0, idf: 1 }); }
    const nm = idf || IT[id].kind === 'key' ? IT[id].n : IT[id].unk;
    msgs.push(c ? `${nm}を 見つけた。（${c.name}が持った）` : `${nm}を 見つけたが、誰も持てない……`);
  }
  saveGame();
  updateMaze(); await play(msgs, true); updateMaze();
}
