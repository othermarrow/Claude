// backrooms-pwa/games/kuuran2.html（空欄_2）の <script> から、画面（DOM）に触る部分を抜いて shared/engine.js を作る。
// HTML 版のゲームを直したら、リポジトリ全体を置いた場所で  node kuuran2-watch/tools/build-engine.js
const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..', '..')
const html = fs.readFileSync(path.join(root, 'backrooms-pwa', 'games', 'kuuran2.html'), 'utf8')
let s = html.slice(html.indexOf('"use strict";'), html.indexOf('})();\n</script>') + 6)

function cut(from, to, put) {
  const a = s.indexOf(from)
  const b = s.indexOf(to, a)
  if (a < 0 || b < 0) throw new Error('見つからない: ' + (a < 0 ? from : to))
  s = s.slice(0, a) + put + s.slice(b)
}
function swap(from, to) {
  if (!s.includes(from)) throw new Error('見つからない: ' + from)
  s = s.split(from).join(to)
}

cut('"use strict";', '  // ---- 物の置き場 ----', `// 「空欄_2」のゲーム本体。backrooms-pwa/games/kuuran2.html の中身から、画面（DOM）に触る部分を抜いたもの。
// tools/build-engine.js で作る。直接は直さない。
// 画面側は createGame(io) で作り、submit() で命令を送り、status() / turn() / visible() で描く。
// io: { loadState(), saveState(obj), loadLoop(), saveLoop(obj) }（どれも失敗してよい）

export function createGame(io) {
  const VERSION = 1;
  // 画面の演出（階層目録の FX）は、時計では使わない
  const fx = () => {};
  const sfx = () => {};
  function loadSaved() { try { return io.loadState(); } catch (e) { return null; } }
  function writeSaved(obj) { try { io.saveState(obj); } catch (e) { /* 残せなくても遊べる */ } }
  // 何回目か、前のあなたが何をしたかは、はじめからやり直しても残る
  function loadLoop() { try { return io.loadLoop() || { n: 0, echo: [] }; } catch (e) { return { n: 0, echo: [] }; } }
  function saveLoop(v) { try { io.saveLoop(v); } catch (e) { /* 残らなくても遊べる */ } }
  function loopSet(patch) { LOOP = Object.assign({}, LOOP, patch); saveLoop(LOOP); }

`)
cut('  let rows = [];\n  function rowEl(r) {', '  // 熱が上がってくると', `  let rows = [];
  let turnStart = 0;
  let flashed = false;
  function push(r) { rows.push(r); }
`)
swap('cls: cls || "" }, true); }', 'cls: cls || "" }); }')
cut('  function scrollDown()', '  // 過去に打った命令の一つが', '  function flicker() { flashed = true; }\n')
swap(`    rows[i] = { t: "cmd", ja: t, en: "", h: 1 };
    const el = logEl.children[i];
    if (el) { el.textContent = "> " + t; el.classList.add("haunted"); }`, '    rows[i] = { t: "cmd", ja: t, en: "", h: 1 };')
cut('  function setStatus() {', '  // ---- 世界のしくみ ----', `  function status() {
    const ex = exitsOf(S.loc);
    return { room: ROOMS[S.loc].name, day: dayName() + "曜", temp: S.t.toFixed(1) + "℃", hot: S.t >= 37.5, ball: hot(),
      exits: Object.keys(ex).filter(k => ex[k]), done: S.done, theme: S.loc === "ura" ? "ura" : S.loc === "sky" ? "sky" : "" };
  }

`)
swap('log: rows.slice(-300) }', 'log: rows.slice(-120) }')

const verbs = s.slice(s.indexOf('  // ---- 命令を作る ----'), s.indexOf('  const builder = $("builder");'))
const intro = s.slice(s.indexOf('  // ---- 起動 ----'), s.indexOf('  function start(fresh) {'))
s = s.slice(0, s.indexOf('  function submit(label, en) {')) + `  function submit(label, en) {
    label = String(label || "").trim();
    const cmd = en || label;
    if (!cmd) return;
    if (rows.length > 400) rows = rows.slice(-300);
    turnStart = rows.length;
    flashed = false;
    push({ t: "cmd", ja: label || cmd, en: en && en !== label ? en : "" });
    act(cmd, label || cmd);
    writeSaved(snapshot());
  }

` + verbs + intro + `  function start(fresh) {
    rows = [];
    LOOP = loadLoop();
    const saved = fresh ? null : loadSaved();
    if (saved && restore(saved)) {
      rows = (saved.log || []).slice();
      turnStart = rows.length;
      say("（前回の続きから）", "note");
      describe(false);
    } else {
      newState();
      turnStart = 0;
      intro();
      writeSaved(snapshot());
    }
  }

  return {
    VERBS,
    start,
    submit,
    status,
    // 今の手で出た行（命令の行を含む）
    turn: () => rows.slice(turnStart),
    // 直前までの命令（古い順）。ときどき書き換わる
    pastCommands: n => rows.slice(0, turnStart).filter(r => r.t === "cmd").slice(-n).map(r => r.ja),
    flashed: () => flashed,
    visible: () => visible().map(o => ({ id: o.id, name: o.name, en: o.en, held: o.loc === "player" })),
    wordsHere: kind => wordsHere(kind).map(w => ({ ja: w.ja, show: w.show || w.ja, en: w.en })),
  };
}
`
// 時計の画面に合わせた言い回し
swap('≡ のメニューから、はじめから', 'いちばん下の「はじめから」で、最初から')
swap('十字キーで移動し、「上」「下」で上下に動く。', '方角のボタンで移動し、「上」「下」で上下に動く。')
swap('「命令を作る」を使うと確実だ。', '「命令を作る」を使う。')

if (/document\.|\$\(|logEl|localStorage/.test(s)) throw new Error('画面に触る部分が残っている')
fs.writeFileSync(path.join(__dirname, '..', 'shared', 'engine.js'), s)
console.log('shared/engine.js を作りました（' + s.length + ' 文字）')
