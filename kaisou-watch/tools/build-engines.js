// 階層目録（backrooms-pwa）のゲームから、時計用の本体と配色を作る。
// HTML 版のゲームを直したら、リポジトリ全体を置いた場所で  node kaisou-watch/tools/build-engines.js
//
//  shared/engines/noclip.js  … games/noclip.html の ENGINE BEGIN〜END
//  shared/engines/hikae.js   … games/hikae.html の ENGINE BEGIN〜END
//  shared/engines/yacho.js   … games/yacho.html の ENGINE BEGIN〜END（野帳の時計版 yacho-watch と同じ言い換え）
//  shared/engines/kuuran2.js … kuuran2-watch/shared/engine.js をそのまま写す（空欄_2 は、時計版の道具で作ったもの）
//  shared/engines/miteiko.js … tools/build-miteiko.js で作る（未定稿は、切るところを一つずつ指定する）
//  shared/themes.js          … noclip・hikae・miteiko の CSS（body[data-lv="…"]）の色を、時計用の表にしたもの
const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..', '..')
const out = path.join(__dirname, '..', 'shared')
const A = '// ==== ENGINE BEGIN ===='
const B = '// ==== ENGINE END ===='

function slice(id, file, title, swaps) {
  const html = fs.readFileSync(path.join(root, 'backrooms-pwa', 'games', file), 'utf8')
  if (!html.includes(A) || !html.includes(B)) throw new Error(file + ': ENGINE の区切りが見つからない')
  let s = html.slice(html.indexOf(A), html.indexOf(B))
  const swap = (from, to) => {
    if (!s.includes(from)) throw new Error(`${file}: 見つからない: ${from}`)
    s = s.split(from).join(to)
  }
  swap('function createGame(io) {', 'export function createGame(io) {')
  for (const [from, to] of swaps) swap(from, to)
  s = `// 「${title}」のゲーム本体。backrooms-pwa/games/${file} の ENGINE BEGIN〜END を抜き出し、言い回しを少し時計向けにしたもの。
// tools/build-engines.js で作る。直接は直さない。
` + s
  fs.writeFileSync(path.join(out, 'engines', id + '.js'), s)
  console.log(id, (s.length / 1024).toFixed(0) + ' KB')
}

slice('noclip', 'noclip.html', 'ノークリップ', [
  ['（手 ${S.moves}。≡ のメニューから、はじめから）', '（手 ${S.moves}。いちばん下の「はじめから」で、最初から）'],
  ['ここで、終わっている。≡ のメニューから、はじめから。', 'ここで、終わっている。いちばん下の「はじめから」で、最初から。'],
  ['十字キーで移動し、「上」「下」で上下に動く。入力欄に日本語で書いてもいい。（もとにした記事と著作権の表示は、≡ のメニューに）',
   '方角のボタンで移動し、「上」「下」で上下に動く。（もとにした記事と著作権の表示は、PWA 版のメニューに）']
])
slice('hikae', 'hikae.html', '控室', [
  ['（≡ のメニューから、はじめから）', '（いちばん下の「はじめから」で、最初から）'],
  ['ここで、終わっている。≡ のメニューから、はじめから。', 'ここで、終わっている。いちばん下の「はじめから」で、最初から。'],
  ['十字キーで移動する（光っている方角だけ）。「命令を作る」で、動詞 → 物（ことば）の順にタップ。入力欄に日本語で書いてもいい。「やめる」「尋ねる」は、どこででも使える。',
   '方角のボタンで移動する（光っている方角だけ）。「命令を作る」で、動詞 → 物（ことば）の順にタップ。「やめる」「尋ねる」は、どこででも使える。']
])
slice('yacho', 'yacho.html', '野帳', [
  ['≡ のメニューから、はじめから', 'いちばん下の「はじめから」で、最初から'],
  ['十字キーで移動し、「上」「下」で上下に動く。', '方角のボタンで移動し、「上」「下」で上下に動く。'],
  ['「命令を作る」を使うと確実だ。', '「命令を作る」を使う。']
])

const k2 = fs.readFileSync(path.join(root, 'kuuran2-watch', 'shared', 'engine.js'), 'utf8')
fs.writeFileSync(path.join(out, 'engines', 'kuuran2.js'),
  '// 「空欄_2」のゲーム本体。kuuran2-watch/shared/engine.js をそのまま写したもの（tools/build-engines.js）。直接は直さない。\n' + k2)
console.log('kuuran2', (k2.length / 1024).toFixed(0) + ' KB')

// ---- 配色：CSS の body[data-lv="…"] { --screen: …; --wall: …; … } を表にする ----
function colors(file, key) {
  const html = fs.readFileSync(path.join(root, 'backrooms-pwa', 'games', file), 'utf8')
  const table = {}
  const grab = (block) => {
    const g = (n) => {
      const m = block.match(new RegExp('--' + n + ':\\s*#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\\b'))
      if (!m) return null
      return m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
    }
    return { screen: g('screen'), wall: g('wall'), bright: g('bright'), dim: g('dim'), faint: g('faint'), key: g('key'), warn: g('warn') }
  }
  const root0 = html.match(/:root\s*\{([^}]*)\}/)
  table[''] = grab(root0[1])
  const re = /body(?:\[data-lv="([^"]+)"\]|\.(dark))\s*\{([^}]*)\}/g
  let m
  while ((m = re.exec(html))) {
    const key = m[1] || m[2]
    const c = grab(m[3])
    // 一部の値だけ変える規則は、元の色の上に重ねる
    const prev = table[key] || table['']
    table[key] = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v || prev[k]]))
  }
  return table
}
const toArr = (t) => Object.fromEntries(Object.entries(t).map(([k, c]) => [k, [c.screen, c.wall, c.bright, c.dim, c.faint, c.key, c.warn]]))
fs.writeFileSync(path.join(out, 'themes.js'),
  `// 階層目録のゲームごとの配色。[背景, 文字, 明るい文字, 薄い文字, 枠, 方角キー, 警告]（16 進）。
// noclip・hikae・miteiko は、HTML 版の CSS から tools/build-engines.js で作る。直接は直さない。
export const NOCLIP = ${JSON.stringify(toArr(colors('noclip.html')))}
export const HIKAE = ${JSON.stringify(toArr(colors('hikae.html')))}
export const MITEIKO = ${JSON.stringify(toArr(colors('miteiko.html')))}
`)
console.log('themes: noclip', Object.keys(colors('noclip.html')).length, 'hikae', Object.keys(colors('hikae.html')).length)
