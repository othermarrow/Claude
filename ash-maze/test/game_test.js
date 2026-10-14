// ゲームの仕組みのテスト（Node だけで動く）
const { load } = require('./load');
const E = load();
E('buildWorld()');
let fail = 0;
const ok = (c, m) => { if (!c) { console.log('NG:', m); fail++; } else console.log('ok:', m); };
E('setRng')(E('mulberry32')(42));
E('S = newState()');
const S = () => E('S');
// キャラを作る
const mk = (cls, race, al, st) => { const c = E('newChar')('t' + cls, race, al, st, cls); S().roster.push(c); S().party.push(c.id); return c; };
const fig = mk('FIG', 'hum', 1, [16, 8, 6, 14, 8, 8]);
const pri = mk('PRI', 'dwa', 0, [10, 7, 14, 12, 5, 6]);
const mag = mk('MAG', 'elf', 1, [7, 14, 9, 7, 10, 6]);
const bis = mk('BIS', 'elf', 0, [7, 12, 12, 8, 9, 6]);
ok(E('knownSpells')(mag).map(s => s.id).join() === 'hiya,nemu', '魔術師Lv1は火矢と眠霧');
ok(mag.mp.m[0] === 2, '魔術師Lv1の1レベル呪文は2回');
ok(E('knownSpells')(pri).some(s => s.id === 'iya'), '僧侶は癒しを覚えている');
ok(E('knownSpells')(bis).length === 2 && E('knownSpells')(bis).every(s => s.s === 'm'), '司教Lv1は魔術だけ');
ok(E('canDispel')(pri) && !E('canDispel')(bis), '僧侶は解呪できる・司教Lv1はできない');
ok(E('charAC')(fig) === 10, '装備なしはAC10');
E('addItem')(fig, 'a03', 1); E('addItem')(fig, 's01', 1);
E('equipItem')(fig, 0); E('equipItem')(fig, 1);
ok(E('charAC')(fig) === 5, '鎖帷子と小盾でAC5');
// 呪い
E('addItem')(fig, 'w12', 0);
const msg = E('equipItem')(fig, 2);
ok(/呪われ/.test(msg) && fig.items[2].cur === 1, '呪いの剣は装備すると呪われる');
ok(/外せない/.test(E('unequipItem')(fig, 2)), '呪われた物は外せない');
// レベルアップ
mag.exp = E('expNeed')(mag, 4);
S().gold = 1000;
const msgs = E('stayInn')(1);
ok(mag.lv === 4, '宿屋でまとめてレベルアップ: Lv' + mag.lv);
ok(!E('knownSpells')(mag).some(s => s.id === 'kaky') && E('knownSpells')(mag).some(s => s.id === 'tomo'), 'Lv4魔術師はレベル2呪文まで（' + E('knownSpells')(mag).map(s => s.n).join() + '）');
console.log('  ', msgs.join(' / '));
// 魔術師のレベル3呪文はLv5から
mag.exp = E('expNeed')(mag, 5); E('stayInn')(0);
ok(E('knownSpells')(mag).some(s => s.id === 'kaky'), 'Lv5魔術師は火球を覚えた');
// 吸収
const lv = mag.lv; E('drainLevel')(mag, 1);
ok(mag.lv === lv - 1 && mag.exp === E('expNeed')(mag, mag.lv), 'レベル吸収で1下がる');
// 寺院
fig.status = 'dead'; fig.hp = 0;
ok(E('templeCost')(fig) === 250, '死亡の寄付はLv×250');
let r = E('templeHeal')(fig);
ok(fig.status === 'ok' || fig.status === 'ash', '寺院: ' + r.join(''));
// 転職で呪文が残る
const keep = E('maxSlots')(pri, 'p');
// 罠
const ch = { f: 3, trap: 4, gold: 10, item: null };
const hp0 = E('partyChars()').map(c => c.hp);
const out = E('springTrap')(ch, pri);
ok(out.msgs[0].includes('爆弾'), '爆弾の罠: ' + out.msgs.join(' '));
// 迷宮の移動
S().inMaze = true; const F1 = E('WORLD')[1];
S().pos = { f: 1, x: F1.up.x, y: F1.up.y, d: 0 };
let moved = 0;
for (let d = 0; d < 4; d++) { S().pos.d = d; const before = { ...S().pos }; const m = E('tryMove')(d); if (m.ok) { moved++; S().pos = before; } }
ok(moved >= 1, '入口から少なくとも1方向に進める');
// 鍵の扉
const F4 = E('WORLD')[4];
S().pos = { f: 4, x: F4.lock.x + E('DX')[F4.lock.d], y: F4.lock.y + E('DY')[F4.lock.d], d: (F4.lock.d + 2) & 3 };
let m = E('tryMove')(S().pos.d);
ok(!m.ok && /鍵/.test(m.msg), '鍵がないと通れない: ' + m.msg);
E('addItem')(pri, 'k01', 1);
m = E('tryMove')(S().pos.d);
ok(m.ok && S().pos.x === F4.down.x && S().pos.y === F4.down.y, '銀の鍵で通れる: ' + m.msg);
// 全滅と回収
S().pos = { f: 2, x: 5, y: 5, d: 0 };
for (const c of E('partyChars()')) { c.status = 'dead'; c.hp = 0; }
ok(E('partyWiped()'), '全員死ぬと全滅');
E('wipeParty()');
ok(S().party.length === 0 && S().roster.every(c => c.maze && c.maze.f === 2), '全滅すると迷宮に残る');
const res = E('newChar')('救助', 'hum', 1, [15, 8, 8, 12, 8, 8], 'FIG'); S().roster.push(res); S().party = [res.id];
S().pos = { f: 2, x: 5, y: 5, d: 0 };
ok(E('bodiesHere()').length === 4, '同じ場所に来ると亡骸が見つかる');
// 保存の書き出しと読み込み（btoa が要るので Node の Buffer で代用）
const json = JSON.stringify(S());
const back = JSON.parse(json);
ok(back.roster.length === S().roster.length, '記録を JSON にして戻せる');
// 敵の群れ
for (let f = 1; f <= 10; f++) {
  const g = E('randomEncounter')(f);
  const n = g.reduce((a, x) => a + x.units.length, 0);
  if (!(g.length >= 1 && g.length <= 4 && n >= 1 && n <= 10)) { ok(false, `f${f} の敵の数がおかしい ${n}`); }
}
ok(true, '敵の群れは1〜4組・1〜10体');
// 宝箱の中身
const items = new Set();
for (let i = 0; i < 2000; i++) { const c = E('makeChest')(1 + (i % 10)); if (c.item) items.add(c.item); }
ok(items.size > 40, '宝箱から出る品物の種類: ' + items.size);
console.log(fail ? `失敗 ${fail}` : 'すべてOK');
process.exit(fail ? 1 : 0);
