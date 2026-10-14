// ===== 戦闘 =====
let B = null;

function startBattle(groups, opt) {
  opt = opt || {};
  B = {
    groups, round: 0, chest: !!opt.chest, guard: opt.guard || 0, boss: !!opt.boss,
    cs: {}, stop: 0, exp: 0, gold: 0, over: null, msgs: [], surprise: null,
    startText: opt.text || null,
  };
  for (const c of partyChars()) B.cs[c.id] = { ac: 0, sil: 0, parry: 0 };
  if (!opt.guard) {
    const r = rnd() * 100;
    if (r < 12) B.surprise = 'enemy';
    else if (r < 22) B.surprise = 'party';
  }
  S.battles++;
  return B;
}
function gname(g) { const m = MN[g.mid]; return g.known ? m.n : m.unk; }
function liveUnits(g) { return g.units.filter(u => u.st !== 'dead'); }
function snap() {
  return {
    p: partyChars().map(c => ({ hp: c.hp, st: c.status, poison: c.poison })),
    g: B.groups.map(g => ({ n: gname(g), a: liveUnits(g).length, s: g.units.filter(u => u.st === 'sleep').length })),
  };
}
function log(t) { B.msgs.push({ t, snap: snap() }); }
function battleAC(c) { const s = B.cs[c.id] || {}; return charAC(c) - (s.ac || 0) - (s.parry ? 2 : 0); }
function inAnti() { const s = cellSp(S.pos.f, S.pos.x, S.pos.y); return !!(s && s.t === 'anti'); }

function killUnit(g, u, killer) {
  u.st = 'dead'; u.hp = 0;
  const m = MN[g.mid];
  B.exp += monExp(m);
  B.gold += m.lv * ri(1, 6);
  if (killer) killer.kills = (killer.kills || 0) + 1;
}
function hurtUnit(g, u, d, killer) {
  u.hp -= d;
  if (u.hp <= 0) { killUnit(g, u, killer); return true; }
  return false;
}
function hurtChar(c, d) {
  c.hp -= d;
  if (c.hp <= 0) { c.hp = 0; c.status = 'dead'; c.poison = 0; return true; }
  if (c.status === 'sleep' && pct(50)) c.status = 'ok';
  return false;
}
function frontTargets() {
  const ps = partyChars();
  const ok = c => !isGone(c) && c.status !== 'stoned';
  const f = ps.slice(0, 3).filter(ok);
  return f.length ? f : ps.filter(ok);
}
function magicSave(c) { return clamp(c.lv * 3 + (c.st[5] - 8) * 2, 0, 75); }

// ---- 味方の行動 ----
function doFight(c, act) {
  let g = B.groups[act.g] || B.groups[0];
  if (!g || !liveUnits(g).length) g = B.groups.find(x => liveUnits(x).length);
  if (!g) return;
  const m = MN[g.mid];
  let left = numAttacks(c);
  while (left > 0) {
    const lu = liveUnits(g);
    if (!lu.length) break;
    const u = pick(lu);
    let hits = 0, dmg = 0, dead = false, crit = false;
    while (left > 0 && !dead) {
      left--;
      const ac = m.ac + g.acMod + (u.st === 'sleep' ? 5 : 0);
      if (!pct(clamp(30 + 5 * hitSkill(c) + 4 * ac, 5, 95))) continue;
      hits++;
      if (!m.boss && pct(critChance(c))) { crit = true; dead = true; killUnit(g, u, c); break; }
      let d = Math.max(1, dice(weaponDmg(c)) + statBonus(c.st[0]));
      const w = equipped(c, 'wep');
      if (w && w.vsU && m.fl.includes('U')) d *= w.vsU;
      if (w && w.vsR && m.fl.includes('R')) d *= w.vsR;
      dmg += d;
      if (u.st === 'sleep' && pct(30)) u.st = 'ok';
      if (hurtUnit(g, u, d, c)) dead = true;
    }
    const nm = gname(g);
    if (crit) log(`${c.name}は ${nm}の 急所を突いた！　一撃でたおした！`);
    else if (!hits) log(`${c.name}の攻撃は ${nm}に 当たらない。`);
    else {
      log(`${c.name}は ${nm}に ${hits}回あたり、${dmg}のダメージ。`);
      if (dead) log(`${nm}を たおした！`);
    }
    if (!dead) break;
  }
}
function castOnEnemies(c, sp, gi, power) {
  const fx = sp.fx;
  const targets = sp.tg === 'all' ? B.groups.slice() : [B.groups[gi] || B.groups.find(x => liveUnits(x).length)].filter(Boolean);
  for (const g of targets) {
    const m = MN[g.mid], nm = gname(g);
    let units = liveUnits(g);
    if (!units.length) continue;
    if (sp.tg === 'one') units = [pick(units)];
    if (fx.dmg) {
      let killed = 0, resisted = 0, total = 0, hit = 0;
      for (const u of units) {
        if (!fx.pierce && m.mr && pct(m.mr)) { resisted++; continue; }
        const d = dice(fx.dmg); total += d; hit++;
        if (hurtUnit(g, u, d, c)) killed++;
      }
      if (hit) log(`${nm}${units.length > 1 ? 'たち' : ''}に ${sp.tg === 'one' ? total : '平均' + Math.round(total / hit)}のダメージ。`);
      if (resisted) log(`${nm}${resisted > 1 ? resisted + '体' : ''}は 呪文を はね返した。`);
      if (killed) log(killed > 1 || units.length > 1 ? `${nm}を ${killed}体たおした！` : `${nm}を たおした！`);
    }
    if (fx.sleep) {
      let n = 0;
      for (const u of units) {
        if (u.st !== 'ok' || m.fl.includes('X') || m.fl.includes('U')) continue;
        if (m.mr && pct(m.mr)) continue;
        if (pct(clamp(85 - 6 * m.lv, 5, 85))) { u.st = 'sleep'; n++; }
      }
      log(n ? `${nm}が ${n}体 眠った。` : `${nm}は 眠らなかった。`);
    }
    if (fx.acmod) { g.acMod = Math.min(9, g.acMod + fx.acmod); log(`${nm}の 守りが 弱まった。`); }
    if (fx.silence) {
      let n = 0;
      for (const u of units) if (!(m.mr && pct(m.mr)) && pct(clamp(80 - 3 * m.lv, 10, 80))) { u.sil = 1; n++; }
      log(n ? `${nm}${n > 1 ? n + '体' : ''}の 声が 封じられた。` : `${nm}には 効かなかった。`);
    }
    if (fx.death) {
      let n = 0;
      for (const u of units) {
        if (m.boss || m.fl.includes('U')) continue;
        if (m.mr && pct(m.mr)) continue;
        if (pct(clamp(80 - 4 * m.lv + (power || 0), 5, 80))) { killUnit(g, u, c); n++; }
      }
      log(n ? `${nm}が ${n}体 息絶えた！` : `${nm}には 効かなかった。`);
    }
    if (fx.undead) {
      if (!m.fl.includes('U')) { log(`${nm}には 効かない。`); continue; }
      let n = 0;
      for (const u of units) if (pct(clamp(60 + 5 * (c.lv - m.lv), 10, 95))) { killUnit(g, u, c); n++; }
      log(n ? `${nm}が ${n}体 消え去った！` : `${nm}は 消えなかった。`);
    }
  }
}
function applySpellInBattle(c, sp, act) {
  const fx = sp.fx;
  if (inAnti()) { log('呪文は かき消された……'); return; }
  if (sp.tg === 'one' || sp.tg === 'grp' || sp.tg === 'all') castOnEnemies(c, sp, act.g);
  if (fx.pac) { for (const p of partyChars()) if (B.cs[p.id]) B.cs[p.id].ac += fx.pac; log('味方の守りが 固くなった。'); }
  if (fx.stop) { B.stop = 1; log('時が 止まった！'); }
  if (fx.home) { B.over = 'home'; log('一行は 光に包まれた……'); }
  if (sp.tg === 'ally') {
    const t = byId(act.t);
    if (t) applyAllySpell(sp, t).forEach(log);
  }
}
function doSpell(c, act) {
  const sp = SP[act.sp];
  if (B.cs[c.id] && B.cs[c.id].sil) { log(`${c.name}は 声が出せず、呪文を唱えられない！`); return; }
  if (!canCast(c, sp)) { log(`${c.name}は ${sp.n}を もう唱えられない。`); return; }
  c.mp[sp.s][sp.lv - 1]--;
  log(`${c.name}は ${sp.n}を 唱えた。`);
  applySpellInBattle(c, sp, act);
}
function doItem(c, act) {
  const it = c.items[act.i];
  if (!it || it.id !== act.id) { log(`${c.name}は 道具を見つけられなかった。`); return; }
  const d = IT[it.id], sp = SP[d.use];
  log(`${c.name}は ${itemName(it)}を 使った。`);
  it.idf = 1;
  applySpellInBattle(c, sp, act);
  if (pct(d.brk || 0)) { c.items.splice(c.items.indexOf(it), 1); if (d.brk < 100) log(`${d.n}は 壊れてしまった。`); }
}
function doDispel(c, act) {
  const g = B.groups[act.g] || B.groups[0];
  if (!g) return;
  log(`${c.name}は 祈りを捧げ、不死の者を はらおうとした。`);
  castOnEnemies(c, { tg: 'grp', fx: { undead: 1 } }, B.groups.indexOf(g));
}
function canDispel(c) { const d = CLS[c.cls].dispel; return !!d && c.lv >= d; }

// ---- 敵の行動 ----
function monSpell(g, u, spId) {
  const m = MN[g.mid], sp = SP[spId], fx = sp.fx, nm = gname(g);
  log(`${nm}は ${sp.n}を 唱えた！`);
  if (inAnti()) { log('呪文は かき消された……'); return; }
  const ps = partyChars().filter(c => !isGone(c) && c.status !== 'stoned');
  if (fx.heal) {
    let best = null;
    for (const gg of B.groups) for (const x of liveUnits(gg)) if (!best || x.mhp - x.hp > best.mhp - best.hp) best = x;
    if (best) { const before = best.hp; best.hp = fx.heal === 'full' ? best.mhp : Math.min(best.mhp, best.hp + dice(fx.heal)); log(`敵の傷が ${best.hp - before} 回復した。`); }
    return;
  }
  if (fx.dmg) {
    const tg = sp.tg === 'one' ? [pick(frontTargets())].filter(Boolean) : ps;
    for (const c of tg) {
      let d = dice(fx.dmg);
      if (pct(magicSave(c))) d = Math.ceil(d / 2);
      log(`${c.name}に ${d}のダメージ。`);
      if (hurtChar(c, d)) log(`${c.name}は 死んだ。`);
    }
  }
  if (fx.sleep) {
    for (const c of ps) if (c.status === 'ok' && !pct(resistChance(c, 'sleep'))) { c.status = 'sleep'; log(`${c.name}は 眠ってしまった。`); }
  }
  if (fx.acmod) { for (const c of ps) if (B.cs[c.id]) B.cs[c.id].ac -= fx.acmod; log('味方の守りが 弱まった。'); }
  if (fx.silence) {
    for (const c of ps) if (B.cs[c.id] && !pct(magicSave(c))) { B.cs[c.id].sil = 1; log(`${c.name}は 声を封じられた。`); }
  }
  if (fx.death) {
    for (const c of ps) if (!pct(clamp(resistChance(c, 'death') + magicSave(c), 0, 95))) { c.hp = 0; c.status = 'dead'; c.poison = 0; log(`${c.name}は 息絶えた！`); }
  }
}
function monBreath(g, u) {
  const nm = gname(g);
  log(`${nm}は 炎を吐いた！`);
  const base = Math.max(1, Math.floor(u.hp / 2));
  for (const c of partyChars()) {
    if (isGone(c) || c.status === 'stoned') continue;
    let d = base;
    if (pct(magicSave(c))) d = Math.ceil(d / 2);
    log(`${c.name}に ${d}のダメージ。`);
    if (hurtChar(c, d)) log(`${c.name}は 死んだ。`);
  }
}
function monMelee(g, u) {
  const m = MN[g.mid], nm = gname(g);
  const t = pick(frontTargets());
  if (!t) return;
  let hits = 0, dmg = 0;
  const effects = [];
  for (const a of m.atk) {
    if (!pct(clamp(25 + 5 * m.lv + 4 * battleAC(t) + (t.status === 'sleep' ? 20 : 0), 5, 95))) continue;
    hits++; dmg += dice(a);
  }
  if (!hits) { log(`${nm}は ${t.name}に 襲いかかったが、外れた。`); return; }
  log(`${nm}は ${t.name}に ${hits}回あたり、${dmg}のダメージ。`);
  if (hurtChar(t, dmg)) { log(`${t.name}は 死んだ。`); return; }
  const fl = m.fl;
  if (fl.includes('C') && pct(7) && !pct(resistChance(t, 'death'))) { t.hp = 0; t.status = 'dead'; t.poison = 0; log(`${nm}は ${t.name}の 首をはねた！`); return; }
  if (fl.includes('D') && pct(30) && !pct(resistChance(t, 'drain'))) { if (drainLevel(t, 1)) log(`${t.name}は 生気を吸われた！　レベルが ${t.lv}に下がった。`); }
  if (fl.includes('S') && pct(25) && !pct(resistChance(t, 'stone'))) { t.status = 'stoned'; log(`${t.name}は 石になった！`); return; }
  if (fl.includes('Z') && pct(30) && !pct(resistChance(t, 'paralyze'))) { t.status = 'paralyzed'; log(`${t.name}は 体がしびれた！`); return; }
  if (fl.includes('P') && !t.poison && pct(30) && !pct(resistChance(t, 'poison'))) { t.poison = 1; log(`${t.name}は 毒をうけた。`); }
}
function monAct(g, u) {
  const m = MN[g.mid];
  const gi = B.groups.indexOf(g);
  if (m.sp && !u.sil && pct(m.caster || 40)) {
    let opts = m.sp.slice();
    const hurt = B.groups.some(gg => liveUnits(gg).some(x => x.hp < x.mhp * 0.6));
    if (!hurt) opts = opts.filter(s => !SP[s].fx.heal);
    if (opts.length) { monSpell(g, u, pick(opts)); return; }
  }
  if (m.br && pct(m.br)) { monBreath(g, u); return; }
  if (gi < 2) monMelee(g, u);
}

// ---- 1回分の戦い ----
// acts: {charId: {type, g, sp, t, i, id}}
function resolveRound(acts, mode) {
  B.msgs = [];
  B.round++;
  for (const id in B.cs) B.cs[id].parry = 0;
  const actors = [];
  if (mode !== 'enemy') {
    for (const c of partyChars()) {
      const a = acts[c.id];
      if (!a || !canAct(c)) continue;
      if (a.type === 'parry') { B.cs[c.id].parry = 1; continue; }
      actors.push({ c, a, init: ri(1, 10) + statBonus(c.st[4]) * 2 + (CLS[c.cls].id === 'NIN' ? 2 : 0) });
    }
  }
  let monsStop = false;
  if (mode !== 'party') {
    if (B.stop) { monsStop = true; B.stop = 0; log('敵は 止まった時の中で 動けない。'); }
    else for (const g of B.groups) for (const u of g.units) if (u.st === 'ok') actors.push({ g, u, init: ri(1, 10) + Math.floor(MN[g.mid].lv / 4) });
  }
  actors.sort((a, b) => b.init - a.init);
  for (const a of actors) {
    if (B.over) break;
    if (!B.groups.some(g => liveUnits(g).length)) break;
    if (partyChars().every(isDown)) break;
    if (a.c) {
      if (!canAct(a.c)) continue;
      const t = a.a.type;
      if (t === 'fight') doFight(a.c, a.a);
      else if (t === 'spell') doSpell(a.c, a.a);
      else if (t === 'item') doItem(a.c, a.a);
      else if (t === 'dispel') doDispel(a.c, a.a);
    } else {
      if (a.u.st !== 'ok') continue;
      monAct(a.g, a.u);
    }
  }
  endOfRound();
  return B.msgs;
}
function endOfRound() {
  for (const c of partyChars()) {
    if (c.status === 'sleep' && pct(40)) { c.status = 'ok'; log(`${c.name}は 目を覚ました。`); }
    if (c.poison && !isGone(c) && c.status !== 'stoned') {
      if (hurtChar(c, 1)) log(`${c.name}は 毒で 力尽きた……`);
    }
  }
  for (const g of B.groups) for (const u of g.units) if (u.st === 'sleep' && pct(20)) u.st = 'ok';
  B.groups = B.groups.filter(g => liveUnits(g).length);
  if (!B.over) {
    if (!B.groups.length) B.over = 'win';
    else if (partyChars().every(isDown)) B.over = 'lose';
  }
}
function tryFlee() {
  B.msgs = [];
  const ps = partyChars().filter(c => !isDown(c));
  const pl = ps.reduce((a, c) => a + c.lv, 0) / Math.max(1, ps.length);
  let ml = 0, n = 0;
  for (const g of B.groups) for (const u of liveUnits(g)) { ml += MN[g.mid].lv; n++; }
  ml = n ? ml / n : 1;
  const p = clamp(55 + 4 * (pl - ml) - (B.guard ? 40 : 0), 5, 95);
  if (pct(p)) { B.over = 'fled'; log('一行は 逃げ出した。'); return true; }
  log('逃げられなかった！');
  return false;
}
// 勝ったとき
function battleRewards() {
  const msgs = [];
  const ps = partyChars().filter(c => !isGone(c) && c.status !== 'stoned');
  const each = ps.length ? Math.floor(B.exp / ps.length) : 0;
  for (const c of ps) c.exp += each;
  for (const c of partyChars()) if (c.status === 'sleep') c.status = 'ok';
  if (each) msgs.push(`ひとりにつき ${each}の 経験値を 得た。`);
  if (B.gold) { S.gold += B.gold; msgs.push(`金貨を ${B.gold}枚 拾った。`); }
  for (const c of ps) if (c.exp >= expNeed(c, c.lv + 1)) { msgs.push('（宿屋で休むと、レベルが上がる者がいる）'); break; }
  return msgs;
}
