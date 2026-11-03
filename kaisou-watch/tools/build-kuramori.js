// backrooms-pwa/games/kura/*.js（蔵守の本体と世界）と、kuramori.html の配色・場所の表から、shared/engines/kuramori.js を作る。
// 蔵守は、ほかのゲームと作りが違う（Kura.create(ui) のエンジンに、世界を Kura.define() で渡す）ので、
// 本体と世界はそのまま束ね、ほかの四本と同じ口（createGame(io)・submit・status・turn・visible …）に包む。
// HTML 版のゲームを直したら、リポジトリ全体を置いた場所で  node kaisou-watch/tools/build-kuramori.js
const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..', '..')
const games = path.join(root, 'backrooms-pwa', 'games')
const read = (f) => fs.readFileSync(path.join(games, f), 'utf8')
const html = read('kuramori.html')

// html の中から、始まりの文字列から終わりの文字列までを取る
function take(from, to) {
  const a = html.indexOf(from)
  const b = html.indexOf(to, a)
  if (a < 0 || b < 0) throw new Error('見つからない: ' + (a < 0 ? from : to))
  return html.slice(a, b + to.length)
}

const engine = read('kura/engine.js').replace(/if \(typeof module[^\n]*\n?/, '')
const worlds = ['house', 'village', 'night', 'extra'].map((n) => read(`kura/${n}.js`)).join('\n')
const tables = [
  take('  const ENDINGS = [', '];\n'),
  take('  const DEEP = [', '];\n'),
  take('  function rankOf(S) {', '\n  }\n'),
  take('  const AREA = {', '\n  };\n'),
  take('  const PAL = {', '\n  };\n'),
  take('  function palFor(S) {', '\n  }\n'),
  take('  const REWORD = [', '\n')
].join('\n')

const adapter = `
// ---- ここから、時計用の口（ほかの四本と同じ形） ----
export function createGame(io) {
  io = io || {};
${tables}
  let game = null, rows = [], turnStart = 0, LOOP = null, statusL = '', statusR = '', metaData = null, fxq = [], saved = null;
  const gap = () => rows.push({ t: 'gap' });
  const note = (t) => rows.push({ t: 'out', ja: String(t), cls: 'note' });
  const ui = {
    say: (text, cls) => {
      let t = String(text);
      for (const [a, b] of REWORD) if (t.includes(a)) t = t.split(a).join(b);
      let c = cls || '';
      if (t.startsWith('【手がかり】')) c = 'clue';
      rows.push({ t: 'out', ja: t, cls: c.trim() });
    },
    gap,
    sep: gap,
    status: (l, r) => { statusL = l || ''; statusR = r || ''; },
    sys: note,
    flash: () => {},
    vibrate: () => { fxq.push({ type: 'shock' }); },
    ended: (id) => { fxq.push({ type: 'end' }); reach(id); },
  };

  // 見た結末・いちばん深いところ・周回（起動画面の札）。はじめからやり直しても残る
  function loadLoop() {
    const base = { v: 1, endings: [], runs: 0, deep: 0 };
    try {
      const v = io.loadLoop();
      if (v && typeof v === 'object' && v.v === 1) {
        const out = Object.assign(base, v);
        out.endings = Array.isArray(out.endings) ? out.endings.filter((id) => ENDINGS.includes(id)) : [];
        out.deep = Math.max(0, Math.min(DEEP.length - 1, out.deep | 0));
        out.runs = Math.max(0, out.runs | 0);
        return out;
      }
    } catch (e) { /* 壊れていたら、はじめから */ }
    return base;
  }
  function saveLoop() { try { io.saveLoop(LOOP); } catch (e) { /* 残らなくても遊べる */ } }
  function writeMeta() {
    metaData = { endings: LOOP.endings.slice(), total: ENDINGS.length, deepest: DEEP[LOOP.deep] || DEEP[0], runs: Math.max(1, LOOP.runs || 0) };
  }
  function reach(id) {
    if (!ENDINGS.includes(id) || LOOP.endings.includes(id)) return;
    LOOP.endings.push(id);
    saveLoop();
    writeMeta();
  }
  function writeSaved() {
    try { io.saveState({ v: 1, state: game.export(), log: rows.slice(-120) }); } catch (e) { /* 残せなくても遊べる */ }
  }
  function sync() {
    const S = game.state();
    const rk = rankOf(S);
    if (rk > LOOP.deep) { LOOP.deep = rk; saveLoop(); writeMeta(); }
  }

  // 命令（label は画面に出す文、cmd は送る命令）。方角・よく使う命令・「動詞 物 物」・「choose 番号」
  const DIRS = { north: 'n', south: 's', east: 'e', west: 'w', up: 'u', down: 'd' };
  const QUICK = { look: 'look', inventory: 'inv', inv: 'inv', wait: 'wait', listen: 'listen', sleep: 'sleep', undo: 'undo' };
  function submit(label, cmd) {
    cmd = String(cmd || label || '').trim();
    if (!cmd) return;
    if (rows.length > 400) { const d = rows.length - 300; rows = rows.slice(-300); turnStart = Math.max(0, turnStart - d); }
    turnStart = rows.length;
    fxq = [];
    const parts = cmd.split(' ');
    const head = parts[0];
    if (head !== 'choose') { gap(); rows.push({ t: 'cmd', ja: String(label || cmd) }); }
    try {
      if (DIRS[head]) game.go(DIRS[head]);
      else if (head === 'choose') { gap(); game.choose(parseInt(parts[1], 10)); }
      else if (head === 'hint') game.hint();
      else if (QUICK[head] && parts.length === 1) game.act(QUICK[head]);
      else game.act(head, parts[1], parts[2]);
    } catch (e) {
      note('（うまく動かなかった。別の言い方で、もう一度）');
    }
    sync();
    writeSaved();
  }

  function status() {
    const S = game.state();
    const P = PAL[palFor(S)] || PAL['omoya-day'];
    let room = statusL || ((Kura.DEFS.rooms[S.room] || {}).name || '');
    if (S.over) { const e = Kura.DEFS.endings[S.over]; room = '結末「' + (e && typeof e.title === 'string' ? e.title : S.over) + '」'; }
    const ex = S.over || S.prompt ? [] : game.exits().map((e) => e.dir);
    const choices = S.over ? [{ label: 'ひとつ戻す', cmd: 'undo' }] : game.choices().map((c) => ({ label: c.label, cmd: 'choose ' + c.id }));
    return { room, info: S.over ? '' : statusR, exits: ex, done: !!S.over, choices, pal: P };
  }

  function start(fresh) {
    rows = []; turnStart = 0; fxq = []; statusL = ''; statusR = '';
    LOOP = loadLoop();
    game = Kura.create(ui);
    let sv = null;
    if (!fresh) { try { sv = io.loadState(); } catch (e) { sv = null; } }
    let resumed = false;
    if (sv && sv.state) {
      try { resumed = !!game.import(sv.state); } catch (e) { resumed = false; }
      if (!resumed) game = Kura.create(ui);
    }
    if (resumed) {
      for (const r of sv.log || []) if (r && typeof r === 'object' && typeof r.t === 'string') rows.push(r);
      if (!rows.length) game.look(true);
      gap();
      note('（前回の続きから）');
      turnStart = rows.length - 1;
    } else {
      LOOP.runs = (LOOP.runs || 0) + 1;
      saveLoop();
      rows.push({ t: 'out', ja: '蔵守', cls: 'title' });
      game.start();
    }
    sync();
    writeMeta();
    writeSaved();
  }

  const verbPattern = (v) => v.id + (v.args >= 1 ? ' %' : '') + (v.args >= 2 ? ' #' : '');
  return {
    get VERBS() { return game.verbs().filter((v) => v.id !== 'undo').map((v) => [v.label, verbPattern(v), v.fmt]); },
    start,
    submit,
    status,
    turn: () => rows.slice(turnStart),
    pastCommands: (n) => rows.slice(0, turnStart).filter((r) => r.t === 'cmd').slice(-n).map((r) => r.ja),
    fx: () => fxq.slice(),
    meta: () => metaData,
    // 動詞ごとに選べるものが違う（verb は [ラベル, 型, 表示]、first は2つ目を選ぶときの1つ目）
    visible: (verb, first) => game.things(verb ? verb[1].split(' ')[0] : 'examine', first ? first.en : null)
      .map((t) => ({ id: t.id, name: t.label, en: String(t.id), held: !!t.held })),
    wordsHere: () => [],
  };
}
`

let out = `// 「蔵守」のゲーム本体と世界。backrooms-pwa/games/kura/*.js をそのまま束ね、kuramori.html の配色・場所の表と、時計用の口を足したもの。
// tools/build-kuramori.js で作る。直接は直さない。
` + engine + '\n' + worlds + '\n' + adapter
// 時計の画面に合わせた言い回し（メニューは時計にない）
if (/document\.|window\.|localStorage|navigator\./.test(out.replace(/\/\/[^\n]*/g, ''))) {
  const m = out.match(/.*(document\.|window\.|localStorage|navigator\.).*/)
  throw new Error('画面に触る部分が残っている: ' + m[0].trim().slice(0, 120))
}
fs.writeFileSync(path.join(__dirname, '..', 'shared', 'engines', 'kuramori.js'), out)
console.log('shared/engines/kuramori.js を作りました（' + (out.length / 1024).toFixed(0) + ' KB）')
