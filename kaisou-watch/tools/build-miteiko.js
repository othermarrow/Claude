// backrooms-pwa/games/miteiko.html（未定稿）の <script> から、画面（DOM）に触る部分を抜いて shared/engines/miteiko.js を作る。
// 未定稿は、ゲーム本体が画面の処理とひとつづきなので、空欄_2 の tools/build-engine.js と同じやり方で、切るところを一つずつ指定する。
// HTML 版のゲームを直したら、リポジトリ全体を置いた場所で  node kaisou-watch/tools/build-miteiko.js
// （切るところが見つからなければ、エラーで止まる。HTML 版の言い回しが変わったら、ここを直す）
const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..', '..')
const html = fs.readFileSync(path.join(root, 'backrooms-pwa', 'games', 'miteiko.html'), 'utf8')
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

// 頭：保存を io に、演出を空に
cut('"use strict";', '  // ---- 物の置き場 ----', `// 「未定稿」のゲーム本体。backrooms-pwa/games/miteiko.html の中身から、画面（DOM）に触る部分を抜いたもの。
// tools/build-miteiko.js で作る。直接は直さない。
// 画面側は createGame(io) で作り、submit() で命令を送り、status() / turn() / visible() で描く。
// io: { loadState(), saveState(obj), loadLoop(), saveLoop(obj) }（どれも失敗してよい）

export function createGame(io) {
  const VERSION = 1;
  // 結末。どれが正解なのかは、どこにも書いていない。どれも、救いにはならない
  const ENDINGS = { shuzo: "収蔵", nidone: "二度寝", toban: "当番", fujo: "浮上", kemono: "獣" };
  // 画面の演出（階層目録の FX）は、時計では使わない
  const fx = () => {};
  const sfx = () => {};
  function loadSaved() { try { return io.loadState(); } catch (e) { return null; } }
  function writeSaved(obj) { try { io.saveState(obj); } catch (e) { /* 残せなくても遊べる */ } }
  // 何周目か、何度消されたか、どこまで降りたかは、はじめからやり直しても残る
  function loadLoop() {
    const base = { n: 0, endings: [], runs: 0, deep: 0, deepLabel: "地上", erased: 0 };
    try {
      const v = io.loadLoop();
      if (v && typeof v === "object") {
        const out = Object.assign(base, v);
        if (!Array.isArray(out.endings)) out.endings = [];
        return out;
      }
    } catch (e) { /* 壊れていたら、はじめから */ }
    return base;
  }
  function saveLoop(v) { try { io.saveLoop(v); } catch (e) { /* 残らなくても遊べる */ } }
  function loopSet(patch) { LOOP = Object.assign({}, LOOP, patch); saveLoop(LOOP); }

`)
// 表示：行を溜めるだけ
cut('  let rows = [];\n  function rowEl(r) {', '  // 灯りが尽きかけると', `  let rows = [];
  let turnStart = 0;
  function push(r) {
    rows.push(r);
    if (rows.length > 700) { rows.splice(0, 200); turnStart = Math.max(0, turnStart - 200); }
  }
`)
swap('cls: cls || "" }, true); }', 'cls: cls || "" }); }')
cut('  function scrollDown()', '  // 過去に打った命令の一つが', '  function scrollDown() {}\n  function flicker() {}\n')
swap(`    rows[i] = { t: "cmd", ja: t, en: "", h: 1 };
    const el = logEl.children[i];
    if (el) { el.textContent = "> " + t; el.classList.add("haunted"); }`, '    rows[i] = { t: "cmd", ja: t, en: "", h: 1 };')
// 状態行：画面に書かず、値を返す
cut('  function setStatus() {', '  const score = ', `  function setStatus() { syncFx(); }
  function status() {
    const ex = lit() ? exitsOf(S.loc) : {};
    const have = O.candle.loc === "player" || O.candle.loc === S.loc
    return { room: lit() ? ROOMS[S.loc].name : "暗闇",
      lamp: have ? (S.fuel > 0 ? S.fuel + (S.lit ? "" : "（消）") : "尽") : "—", low: S.fuel <= 40 && held("candle"),
      score: score(), exits: Object.keys(ex).filter(k => ex[k]), stain: S.th.loc === S.loc && !S.done,
      lv: lvOf(S.loc), dark: !lit(), done: S.done };
  }
`)
swap('    document.body.dataset.lv = lv;\n    document.body.classList.toggle("dark", dark);\n', '')
cut('  function writeMeta() {', '  function reach(id) {', `  let metaData = null;
  function writeMeta() {
    metaData = { endings: (LOOP.endings || []).slice(), total: Object.keys(ENDINGS).length, deepest: LOOP.deepLabel || "地上", runs: LOOP.runs || 1 };
  }
`)
// 入力（submit）：画面の処理を除く
cut('  function submit(label, en) {', '  // ---- 入力 ----', `  function submit(label, en) {
    label = String(label || "").trim();
    const cmd = en || label;
    if (!cmd) return;
    if (rows.length > 400) { const d = rows.length - 300; rows = rows.slice(-300); turnStart = Math.max(0, turnStart - d); }
    turnStart = rows.length;
    gap();
    push({ t: "cmd", ja: label || cmd, en: en && en !== label ? en : "" });
    act(cmd, label || cmd);
    setStatus();
    writeSaved(snapshot());
  }

`)
// 命令を作る：動詞の表だけ残し、画面の部分は落とす。起動は作り直す
const verbs = s.slice(s.indexOf('  const VERBS = ['), s.indexOf('  const builder = $("builder");'))
const intro = s.slice(s.indexOf('  function intro() {'), s.indexOf('  function start(fresh) {'))
s = s.slice(0, s.indexOf('  // ---- 入力 ----')) + verbs + '\n' + intro + `  function start(fresh) {
    rows = [];
    LOOP = loadLoop();
    const saved = fresh ? null : loadSaved();
    if (saved && restore(saved)) {
      rows = (saved.log || []).slice();
      gap();
      say("（前回の続きから）", "note");
      turnStart = rows.length - 1;
    } else {
      newState();
      loopSet({ runs: (LOOP.runs || 0) + 1, n: (LOOP.n || 0) + 1 });
      turnStart = 0;
      intro();
      writeSaved(snapshot());
    }
    curLv = null; metaLoc = null;
    setStatus();
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
    meta: () => metaData,
    visible: () => visible().map(o => ({ id: o.id, name: o.name, en: o.en, held: o.loc === "player" })),
    wordsHere: () => wordsHere().map(w => ({ ja: w.ja, show: w.show || w.ja, en: w.en })),
  };
}
`
// 時計の画面に合わせた言い回し
if (s.includes('≡ のメニューから、はじめから')) swap('≡ のメニューから、はじめから', 'いちばん下の「はじめから」で、最初から')
if (s.includes('十字キーで移動し、「上」「下」で上下に動く。')) swap('十字キーで移動し、「上」「下」で上下に動く。', '方角のボタンで移動し、「上」「下」で上下に動く。')
if (/document\.|\$\(|logEl|screenEl|cmdEl|localStorage|window\./.test(s)) {
  const m = s.match(/.*(document\.|\$\(|logEl|screenEl|cmdEl|localStorage|window\.).*/)
  throw new Error('画面に触る部分が残っている: ' + m[0].trim().slice(0, 120))
}
fs.writeFileSync(path.join(__dirname, '..', 'shared', 'engines', 'miteiko.js'), s)
console.log('shared/engines/miteiko.js を作りました（' + (s.length / 1024).toFixed(0) + ' KB）')
