// yacho/yacho.html の「ゲーム本体」（ENGINE BEGIN〜END）を抜き出して shared/engine.js を作る。
// HTML 版のゲームを直したら、リポジトリ全体を置いた場所で  node yacho-watch/tools/build-engine.js
const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..', '..')
const html = fs.readFileSync(path.join(root, 'yacho', 'yacho.html'), 'utf8')
const A = '// ==== ENGINE BEGIN ===='
const B = '// ==== ENGINE END ===='
if (!html.includes(A) || !html.includes(B)) throw new Error('ENGINE の区切りが見つからない')
let s = html.slice(html.indexOf(A), html.indexOf(B))

function swap(from, to) {
  if (!s.includes(from)) throw new Error('見つからない: ' + from)
  s = s.split(from).join(to)
}

swap('function createGame(io) {', 'export function createGame(io) {')
s = `// 「野帳」のゲーム本体。yacho/yacho.html の ENGINE BEGIN〜END をそのまま抜き出し、言い回しを少し時計向けにしたもの。
// tools/build-engine.js で作る。直接は直さない。
` + s
// 時計の画面に合わせた言い回し
swap('≡ のメニューから、はじめから', 'いちばん下の「はじめから」で、最初から')
swap('十字キーで移動し、「上」「下」で上下に動く。', '方角のボタンで移動し、「上」「下」で上下に動く。')
swap('「命令を作る」を使うと確実だ。', '「命令を作る」を使う。')
// 時計の保存は小さく
swap('log: rows.slice(-300) }', 'log: rows.slice(-80) }')
swap('if (rows.length > 600) rows = rows.slice(-400);', 'if (rows.length > 300) rows = rows.slice(-200);')

if (/document\.|window\.|localStorage|≡|十字キー/.test(s)) throw new Error('画面やブラウザに触る部分、または時計にない言い回しが残っている')
fs.writeFileSync(path.join(__dirname, '..', 'shared', 'engine.js'), s)
console.log('shared/engine.js を作りました（' + s.length + ' 文字）')
