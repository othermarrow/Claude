const { load } = require('./load');
const E = load(['data.js', 'maze.js']);
const W = E('buildWorld()');
const MW = 20, MH = 20;
let fail = 0;
function check(c, msg) { if (!c) { console.log('NG:', msg); fail++; } }
for (let f = 1; f <= 10; f++) {
  const F = W[f];
  const noKey = E('bfs')(F, F.up.x, F.up.y);
  const withKey = E('bfs')(F, F.up.x, F.up.y, { keys: 1 });
  const noSec = E('bfs')(F, F.up.x, F.up.y, { keys: 1, noSecret: 1 });
  let reach = 0; for (let i = 0; i < 400; i++) if (withKey[i] >= 0) reach++;
  check(reach === 400, `f${f} 全マス到達できない (${reach})`);
  if (F.down) {
    const dc = F.down.y * MW + F.down.x;
    check(withKey[dc] >= 0, `f${f} 下り階段に行けない`);
    check(noSec[dc] >= 0, `f${f} 下り階段に隠し扉なしで行けない`);
    if (F.lock) check(noKey[dc] < 0, `f${f} 鍵なしで下り階段に行けてしまう`);
    else check(noKey[dc] >= 0, `f${f} 下り階段に行けない(鍵なし)`);
  }
  if (F.guardRoom >= 0) {
    const r = F.rooms[F.guardRoom];
    check(noSec[r.cells[0]] >= 0, `f${f} 番人の部屋に行けない`);
  }
  if (f > 1) {
    const P = W[f - 1];
    check(P.down.x === F.up.x && P.down.y === F.up.y, `f${f} 階段の位置がずれている`);
  }
  for (const k in F.sp) {
    const s = F.sp[k];
    if (s.t === 'chute') {
      const G = W[f + 1]; const g = E('bfs')(G, G.up.x, G.up.y);
      check(g[k] >= 0, `f${f} 落とし戸の先が閉じた場所`);
      check(!F.lock, `f${f} 鍵の階に落とし戸`);
    }
  }
  const cnt = {}; for (const k in F.sp) cnt[F.sp[k].t] = (cnt[F.sp[k].t] || 0) + 1;
  let maxd = 0; for (let i = 0; i < 400; i++) maxd = Math.max(maxd, noSec[i]);
  console.log(`f${f} 部屋${F.rooms.length} up(${F.up.x},${F.up.y}) down${F.down ? `(${F.down.x},${F.down.y}) 距離${noSec[F.down.y * MW + F.down.x]}` : 'なし'} 最遠${maxd} lock:${F.lock ? F.lock.key : '-'} 番人:${F.guardRoom}`, JSON.stringify(cnt));
}
// 1階の絵
function draw(F) {
  const lines = [];
  for (let y = 0; y < MH; y++) {
    let top = '', mid = '';
    for (let x = 0; x < MW; x++) {
      const n = E('getW')(F, x, y, 0), w = E('getW')(F, x, y, 3);
      const ch = v => v === 1 ? '#' : v === 0 ? ' ' : v === 2 ? 'D' : v === 3 ? 'S' : 'L';
      top += '+' + ch(n).repeat(2);
      const c = y * MW + x;
      let cell = F.room[c] >= 0 ? '..' : '  ';
      if (F.up.x === x && F.up.y === y) cell = '<<';
      if (F.down && F.down.x === x && F.down.y === y) cell = '>>';
      if (F.sp[c]) cell = F.sp[c].t.slice(0, 2);
      mid += ch(w) + cell;
    }
    lines.push(top + '+', mid + '#');
  }
  lines.push('+--'.repeat(MW) + '+');
  return lines.join('\n');
}
console.log(draw(W[1]));
console.log(draw(W[4]));
console.log(fail ? `失敗 ${fail}` : 'すべてOK');
process.exit(fail ? 1 : 0);
