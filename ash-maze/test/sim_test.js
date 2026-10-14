// 階ごとに、決まったレベルのパーティで戦わせて、勝率と稼ぎを見る
const { load } = require('./load');
const E = load();
E('buildWorld()');
E('setRng(Math.random)');
const gearBy = lv => lv < 3 ? ['w05', 'a03', 's01', 'h01'] : lv < 6 ? ['w10', 'a07', 's03', 'h01', 'g01'] : lv < 9 ? ['w14', 'a08', 's04', 'h02', 'g01'] : lv < 12 ? ['w20', 'a10', 's05', 'h02', 'g02'] : ['w21', 'a11', 's07', 'h05', 'g03', 'r05'];
function makeParty(lv) {
  E('S = newState()');
  const spec = [['FIG', 'hum'], ['FIG', 'dwa'], ['PRI', 'dwa'], ['THI', 'hob'], ['MAG', 'elf'], ['BIS', 'elf']];
  const ids = [];
  for (const [cls, race] of spec) {
    const c = E('newChar')('x', race, cls === 'THI' ? 1 : 0, [15, 15, 15, 15, 14, 12], cls);
    E('S').roster.push(c);
    for (let l = 1; l < lv; l++) { c.exp = E('expNeed')(c, l + 1); E('levelUp')(c); }
    E('restoreMp')(c); c.hp = c.mhp;
    const G = gearBy(lv);
    for (const id of G) { E('addItem')(c, id, 1); }
    c.items.forEach((it, i) => { if (E('canEquipCls')(c, E('IT')[it.id])) E('equipItem')(c, i); });
    if (cls === 'MAG' || cls === 'BIS') { c.items = []; E('addItem')(c, 'w02', 1); E('addItem')(c, 'a01', 1); E('equipItem')(c, 0); E('equipItem')(c, 1); }
    ids.push(c.id);
  }
  E('S').party = ids;
}
// 簡単な作戦：前衛は殴る、魔術師は一番強い攻撃呪文、僧侶は回復か光弾
function plan() {
  const B = E('B'), acts = {};
  const P = E('partyChars()');
  P.forEach((c, i) => {
    if (!E('canAct')(c)) return;
    const known = E('knownSpells')(c).filter(s => E('canCast')(c, s) && s.w.includes('b'));
    const hurt = P.filter(p => !E('isGone')(p) && p.hp < p.mhp * 0.5);
    const heal = known.filter(s => s.fx.heal).sort((a, b) => b.lv - a.lv)[0];
    if (hurt.length && heal && (c.cls === 'PRI' || c.cls === 'BIS')) { acts[c.id] = { type: 'spell', sp: heal.id, t: hurt[0].id }; return; }
    const atk = known.filter(s => s.fx.dmg || s.fx.sleep).sort((a, b) => b.lv - a.lv)[0];
    if (i >= 3 && atk) { acts[c.id] = { type: 'spell', sp: atk.id, g: 0 }; return; }
    if (i < 3) { acts[c.id] = { type: 'fight', g: 0 }; return; }
    acts[c.id] = { type: 'parry' };
  });
  return acts;
}
function run(f, lv, N) {
  let win = 0, lose = 0, exp = 0, rounds = 0, deaths = 0, hpLoss = 0;
  for (let k = 0; k < N; k++) {
    makeParty(lv);
    E('S').pos.f = f;
    const groups = E('randomEncounter')(f);
    E('startBattle')(groups, {});
    let r = 0;
    while (!E('B').over && r < 40) { E('resolveRound')(plan()); r++; }
    rounds += r;
    const B = E('B');
    if (B.over === 'win') { win++; exp += B.exp / 6; } else lose++;
    const P = E('partyChars()');
    deaths += P.filter(c => E('isDown')(c)).length;
    hpLoss += P.reduce((a, c) => a + (c.mhp - c.hp) / c.mhp, 0) / 6;
  }
  return { f, lv, win: (win / N * 100).toFixed(0) + '%', expPerFight: Math.round(exp / Math.max(1, win)), rounds: (rounds / N).toFixed(1), deaths: (deaths / N).toFixed(2), hpLoss: (hpLoss / N * 100).toFixed(0) + '%', need: E('expBase')(lv + 1) - E('expBase')(lv) };
}
const plan2 = [[1, 1], [1, 2], [2, 2], [2, 3], [3, 4], [4, 5], [5, 7], [6, 8], [7, 9], [8, 10], [9, 12], [10, 13], [10, 15]];
for (const [f, lv] of plan2) console.log(JSON.stringify(run(f, lv, 300)));
// ボス
function boss(lv, N) {
  let win = 0;
  for (let k = 0; k < N; k++) {
    makeParty(lv); E('S').pos.f = 10;
    E('startBattle')(E('guardEncounter')(10), { guard: 10 });
    let r = 0; while (!E('B').over && r < 60) { E('resolveRound')(plan()); r++; }
    if (E('B').over === 'win') win++;
  }
  return win / N * 100;
}
for (const g of [3, 6, 9]) {
  for (const lv of [g + 2, g + 4]) {
    let win = 0; const N = 200;
    for (let k = 0; k < N; k++) {
      makeParty(lv); E('S').pos.f = g;
      E('startBattle')(E('guardEncounter')(g), { guard: g });
      let r = 0; while (!E('B').over && r < 60) { E('resolveRound')(plan()); r++; }
      if (E('B').over === 'win') win++;
    }
    console.log(`番人 f${g} lv${lv}: 勝率 ${(win / N * 100).toFixed(0)}%`);
  }
}
for (const lv of [13, 15, 17]) console.log(`ボス lv${lv}: 勝率 ${boss(lv, 200).toFixed(0)}%`);
