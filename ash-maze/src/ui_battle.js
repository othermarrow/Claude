// ===== 戦闘の画面 =====
function scrBattle() {
  UI.screen = 'battle'; UI.rowClick = null;
  render(`${header('戦闘', `B${S.pos.f}F`)}
    <div id="enemies" class="ebox">${enemyRows(snap().g)}</div>
    <div id="msg" class="msg"></div>
    ${partyBox()}
    <div id="cmd" class="cmd"></div>`);
}
function setCmd(html) { Object.assign(ACT, PEND); PEND = {}; const c = $('#cmd'); if (c) c.innerHTML = html; }
function refreshBattle() {
  const g = $('#enemies'); if (g) g.innerHTML = enemyRows(snap().g);
  const p = $('#party'); if (p) p.innerHTML = partyRows();
}

async function battleFlow(groups, opt) {
  opt = opt || {};
  startBattle(groups, opt);
  UI.lastSnap = snap();
  scrBattle();
  vib(60);
  if (opt.text) await alertMsg(opt.text);
  await play(['敵が 現れた！', ...B.groups.map(g => `　${gname(g)} ×${g.units.length}`)]);
  if (B.surprise === 'enemy') {
    await play(['敵は まだ こちらに 気づいていない！'], true);
    const acts = await inputActions(true);
    if (acts.flee) { B.over = 'fled'; await play(['一行は そっと 立ち去った。']); }
    else await play(resolveRound(acts, 'party'));
  } else if (B.surprise === 'party') {
    await play(['不意をつかれた！'], true);
    await play(resolveRound({}, 'enemy'), true);
  }
  while (!B.over) {
    refreshBattle();
    const acts = await inputActions(false);
    setCmd('');
    if (acts.flee) {
      tryFlee();
      await play(B.msgs);
      if (!B.over) await play(resolveRound({}, 'enemy'), true);
      continue;
    }
    await play(resolveRound(acts));
  }
  refreshBattle();
  setCmd('');
  const over = B.over, f = S.pos.f;
  if (over === 'win') {
    const msgs = ['敵を 打ち倒した！', ...battleRewards()];
    if (B.guard) {
      if (!S.guardDone) S.guardDone = {};
      S.guardDone[B.guard] = 1;
      if (B.boss) {
        S.boss = 1;
        let c = giveItemToParty('k04', 1);
        if (!c) { c = partyChars()[0]; c.items.push({ id: 'k04', eq: 0, idf: 1 }); }
        msgs.push(`ヴァルガは 灰となって 崩れ落ちた。`, `王の宝珠を 取り戻した！（${c.name}が持った）`, '町へ持ち帰ろう。');
      }
    }
    await play(msgs, true);
    sortDeadBack();
    const chest = B.chest;
    const key = B.guard && !B.boss && !rosterHasKey(GUARDS[B.guard].key) ? GUARDS[B.guard].key : null;
    B = null;
    saveGame();
    scrMaze();
    if (chest || key) {
      const ch = makeChest(f);
      if (key) ch.key = key;
      await chestFlow(ch);
    }
  } else if (over === 'lose') {
    B = null;
    await wipeFlow();
    return;
  } else if (over === 'home') {
    B = null;
    for (const c of partyChars()) if (c.status === 'sleep') c.status = 'ok';
    S.gold = Math.floor(S.gold / 2);
    await alertMsg('一行は 光に包まれ……\n気がつくと 町に戻っていた。（所持金が半分になった）');
    await returnTown();
    return;
  } else {
    for (const c of partyChars()) if (c.status === 'sleep') c.status = 'ok';
    B = null;
    sortDeadBack();
    scrMaze('なんとか 逃げ切った。');
  }
  saveGame();
  updateMaze();
}

async function inputActions(surpriseRound) {
  const order = partyChars().filter(canAct);
  const acts = {};
  let k = 0;
  while (k < order.length) {
    const c = order[k];
    const r = await askCommand(c, k > 0, surpriseRound);
    if (r === 'back') { k--; delete acts[order[k].id]; continue; }
    if (r === 'flee') return { flee: true };
    acts[c.id] = r; k++;
  }
  return acts;
}
function askCommand(c, canBack) {
  return new Promise(resolve => {
    const pi = S.party.indexOf(c.id);
    const front = pi < 3;
    const spells = knownSpells(c).filter(s => s.w.includes('b'));
    const items = c.items.map((it, i) => ({ it, i })).filter(o => IT[o.it.id].use && SP[IT[o.it.id].use].w.includes('b'));
    const silenced = B.cs[c.id] && B.cs[c.id].sil;
    setCmd(`<div class="who">◆ ${esc(c.name)}（${CLS[c.cls].n}）の行動は？</div><div class="grid3">
      ${b('戦う', async () => { const g = await pickGroup(true); if (g !== null) resolve({ type: 'fight', g }); }, 'main', !front)}
      ${b('呪文', async () => { const a = await pickSpellB(c); if (a) resolve(a); }, '', !spells.length || silenced)}
      ${b('道具', async () => { const a = await pickItemB(c); if (a) resolve(a); }, '', !items.length)}
      ${b('防御', () => resolve({ type: 'parry' }))}
      ${canDispel(c) ? b('解呪', async () => { const g = await pickGroup(false); if (g !== null) resolve({ type: 'dispel', g }); }) : ''}
      ${b('逃げる', () => resolve('flee'), 'ghost')}
      ${canBack ? b('戻る', () => resolve('back'), 'ghost') : ''}
    </div>`);
  });
}
async function pickGroup(melee) {
  const gs = B.groups.map((g, i) => ({ g, i })).filter(o => liveUnits(o.g).length && (!melee || o.i < 2));
  if (!gs.length) return 0;
  if (gs.length === 1) return gs[0].i;
  return choose(melee ? 'どの敵と戦う？（前の2組まで）' : 'どの敵に？', gs.map(o => ({ label: `${o.i + 1}) ${esc(gname(o.g))} ×${liveUnits(o.g).length}`, value: o.i })));
}
async function targetFor(sp) {
  if (sp.tg === 'one' || sp.tg === 'grp') { const g = await pickGroup(false); return g === null ? null : { g }; }
  if (sp.tg === 'ally') {
    const t = await pickChar(`${sp.n}を 誰に？`, partyChars());
    return t ? { t: t.id } : null;
  }
  return {};
}
async function pickSpellB(c) {
  const sps = knownSpells(c).filter(s => s.w.includes('b'));
  const sp = await choose(`${c.name}の呪文`, sps.map(s => ({ label: `${s.n}<span class="lv">${s.s === 'm' ? '魔' : '祈'}${s.lv}</span>　残${c.mp[s.s][s.lv - 1]}`, sub: s.d, value: s, dis: !canCast(c, s) })));
  if (!sp) return null;
  const t = await targetFor(sp);
  if (!t) return null;
  return Object.assign({ type: 'spell', sp: sp.id }, t);
}
async function pickItemB(c) {
  const opts = c.items.map((it, i) => ({ it, i })).filter(o => IT[o.it.id].use && SP[IT[o.it.id].use].w.includes('b')).map(o => ({ label: itemLine(o.it), value: o.i }));
  const i = await choose('どれを使う？', opts);
  if (i === null) return null;
  const sp = SP[IT[c.items[i].id].use];
  const t = await targetFor(sp);
  if (!t) return null;
  return Object.assign({ type: 'item', i, id: c.items[i].id }, t);
}
