// いま触れられる物の一覧を、ゲームのオブジェクトの木から取り出す（Zork I 用）。
// 属性番号は zork1.z3 で調べたもの: 7 = 見えない, 10 = 台（上に物を置ける）, 11 = 開いている, 12 = 透けて見える
const INVISIBLE = 7
const SEE_INSIDE = [10, 11, 12]

function hasAttr(zm, n, a) {
  return !!(zm.mem[zm.obj(n) + (a >> 3)] & (0x80 >> (a & 7)))
}

// 命令に使う英単語。辞書にある単語だけで名前を作る
export function nounWord(zm, name) {
  const words = name.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return ''
  const ofAt = words.indexOf('of')
  if (ofAt >= 0 && ofAt < words.length - 1) return words[words.length - 1]
  const known = words.filter((w) => zm.lookup(w))
  if (known.length === words.length) return words.join(' ')
  return known.length ? known[known.length - 1] : words[words.length - 1]
}

function collect(zm, parent, out, depth, player) {
  for (let c = zm.child(parent); c; c = zm.sibling(c)) {
    if (c === player || hasAttr(zm, c, INVISIBLE)) continue
    const name = zm.objName(c)
    if (!name) continue
    out.push({ id: c, en: name, word: nounWord(zm, name) })
    if (depth < 2 && SEE_INSIDE.some((a) => hasAttr(zm, c, a))) collect(zm, c, out, depth + 1, player)
  }
}

export function findPlayer(zm, room) {
  for (let c = zm.child(room); c; c = zm.sibling(c)) if (zm.objName(c) === 'cretin') return c
  return 0
}

// { here: [...部屋の物], held: [...持ち物] }
export function scene(zm) {
  const room = zm.rw(zm.globAddr)
  if (!room) return { here: [], held: [] }
  const player = findPlayer(zm, room)
  const here = []
  const held = []
  collect(zm, room, here, 0, player)
  if (player) collect(zm, player, held, 0, 0)
  return { here, held }
}

// 辞書の単語の一覧（キーボードの候補用）
export function dictWords(zm) {
  const out = []
  const n = Math.abs(zm.entryCount)
  for (let i = 0; i < n; i++) {
    const w = zm.text(zm.entries + i * zm.entryLen)
    if (/^[a-z]+$/.test(w)) out.push(w)
  }
  return out
}

// ゲームの物すべて（部屋とプレイヤーを除く）: [{ id, en, word, last }]
export function allObjects(zm) {
  // オブジェクト表は、いちばん前にある属性表の手前で終わる
  let first = 0xffff
  let count = 0
  for (let n = 1; zm.obj(n) < first; n++) {
    const p = zm.rw(zm.obj(n) + 7)
    if (p < first) first = p
    count = n
  }
  const room = zm.rw(zm.globAddr)
  const top = room ? zm.parent(room) : 0
  const out = []
  for (let n = 1; n <= count; n++) {
    if (n === top || (top && zm.parent(n) === top)) continue
    const en = zm.objName(n)
    if (!en || !/^[a-z][a-z -]*$/.test(en) || en === 'cretin') continue
    const words = en.split(' ')
    out.push({ id: n, en, word: nounWord(zm, en), last: words[words.length - 1] })
  }
  return out
}

// 文章に出てきた物
export function mentioned(zm, objs, text) {
  const low = ' ' + String(text).toLowerCase().replace(/[^a-z]+/g, ' ') + ' '
  const out = []
  for (const o of objs) {
    if (low.indexOf(' ' + o.en + ' ') >= 0) out.push(o)
    else if (o.last.length >= 4 && zm.lookup(o.last) && low.indexOf(' ' + o.last + ' ') >= 0) {
      out.push({ id: o.id, en: o.en, word: o.last, last: o.last })
    }
  }
  return out
}
