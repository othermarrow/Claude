// 5つの層を、いくつもの種で作って、出口に歩いて行けるか確かめる
const { load } = require('./load');
const E = load();
let fail = 0;
const ok = (c, m) => { if (!c) { console.log('NG:', m); fail++; } };
for (let lv = 0; lv < 5; lv++) {
  let sum = 0, mn = 1e9, mx = 0, t0 = Date.now(), items = {};
  for (let s = 1; s <= 30; s++) {
    E(`newWorld(${lv}, ${s * 7919})`);
    const ex = E('WD.exit');
    ok(!E(`isWall(${ex.fx}, ${ex.fy})`) && E(`isWall(${ex.wx}, ${ex.wy})`), `lv${lv} seed${s} 出口の位置がおかしい`);
    ok(!E('isWall(8, 8)'), `lv${lv} スタートが壁`);
    const B = E('bfsFrom')(8, 8, 120);
    const d = B.at(ex.fx, ex.fy);
    ok(d >= 0, `lv${lv} seed${s} 出口に行けない`);
    sum += d; mn = Math.min(mn, d); mx = Math.max(mx, d);
    // 周りのチャンクの物の数
    for (let cx = -3; cx <= 3; cx++) for (let cy = -3; cy <= 3; cy++) for (const it of E('chunkAt')(cx, cy).items) items[it.t] = (items[it.t] || 0) + 1;
    // 開けた床の割合
  }
  let open = 0; for (let y = -40; y < 40; y++) for (let x = -40; x < 40; x++) if (!E(`isWall(${x}, ${y})`)) open++;
  console.log(`lv${lv} ${E(`LEVELS[${lv}].name`)}: 出口まで ${mn}〜${mx}歩（平均${(sum / 30).toFixed(0)}） 床${(open / 6400 * 100).toFixed(0)}% 物/30回(7x7チャンク) ${JSON.stringify(items)} ${Date.now() - t0}ms`);
}
// 決まった種なら同じ形になる
E('newWorld(1, 42)'); const a = JSON.stringify(E('WD.exit'));
E('newWorld(1, 42)'); const b = JSON.stringify(E('WD.exit'));
ok(a === b, '同じ種で同じ出口');
// 見通し
E('newWorld(0, 5)');
ok(E('lineOfSight(8.5, 8.5, 9.5, 8.5)'), 'となりのマスは見える');
// ASCII で第0層と第2層の様子
for (const lv of [0, 2]) {
  E(`newWorld(${lv}, 99)`);
  const ex = E('WD.exit'); const lines = [];
  for (let y = -2; y < 22; y++) { let s = ''; for (let x = -2; x < 40; x++) s += (x === 8 && y === 8) ? '@' : (x === ex.wx && y === ex.wy) ? 'E' : E(`isWall(${x}, ${y})`) ? '#' : (E(`lampAt(${x}, ${y})`) === 1 ? '+' : E(`lampAt(${x}, ${y})`) ? '-' : '.'); lines.push(s); }
  console.log(lines.join('\n'));
}
console.log(fail ? `失敗 ${fail}` : 'すべてOK');
process.exit(fail ? 1 : 0);
