// ゲームの出力を日本語にする（zork-ja/zork_ja.py の Translator を移植。AI 翻訳はなし）
import { NAMES, MSGS, PATTERNS, VERBS_EN } from './dict'

const PATS = PATTERNS.map(([rx, ja]) => [new RegExp(rx), ja])

function norm(s) {
  return String(s).trim().split(/\s+/).join(' ')
}

// 「Mr.」「1.」などの後では文を区切らない
const NO_SPLIT_RE = /(?:\b(?:Mr|Mrs|Dr|Mass|Mmm)|(?:^|[\s:])\d)\.$/

// 文の区切り: [.!?] の後の空白で、次が大文字・"・(・[ で始まるとき。または ." の後の空白
function splitSentences(s) {
  const out = []
  let start = 0
  for (let i = 1; i < s.length; i++) {
    if (s[i] !== ' ') continue
    const p = s[i - 1]
    const pp = s[i - 2]
    let j = i
    while (j < s.length && s[j] === ' ') j++
    const next = s[j] || ''
    const end1 = '.!?'.includes(p) && /[A-Z"([]/.test(next)
    const end2 = p === '"' && pp && '.!?'.includes(pp)
    if ((end1 || end2) && !NO_SPLIT_RE.test(s.slice(start, i))) {
      out.push(s.slice(start, i))
      start = j
      i = j
    }
  }
  out.push(s.slice(start))
  return out.filter((x) => x)
}

let SUFFIX = null
function suffixName(low) {
  if (!SUFFIX) {
    SUFFIX = {}
    for (const k of Object.keys(NAMES).sort((a, b) => a.length - b.length)) {
      const w = k.split(' ')
      for (let i = 1; i < w.length; i++) {
        const t = w.slice(i).join(' ')
        if (!(t in SUFFIX)) SUFFIX[t] = NAMES[k]
      }
    }
  }
  return SUFFIX[low] || null
}

export function nameJa(s) {
  s = norm(s)
  if (/^-?\d+$/.test(s)) return s
  const low = s.toLowerCase()
  if (NAMES[low]) return NAMES[low]
  const bare = low.replace(/^(a|an|the|some|your)\s+/, '')
  if (NAMES[bare]) return NAMES[bare]
  // 「candles」→「pair of candles」のように、名前の最後の部分だけのとき
  const tail = suffixName(bare)
  if (tail) return tail
  const parts = bare.split(/,\s*(?:and\s+|or\s+)?|\s+and\s+|\s+or\s+/)
  if (parts.length > 1) {
    const out = parts.filter((p) => p).map(nameJa)
    if (out.every((x) => x)) return out.join('、')
  }
  return null
}

// 「sword: You can't ...」のような「物の名前: 文」の形
const PREFIX_RE = /^([a-z][a-z' -]{1,30}): (.+)$/
// 辞書にない名前でも、短い名詞なら英語のままテンプレートに入れる
const SHORT_NAME_RE = /^[A-Za-z][A-Za-z' -]*$/

function sentenceJa(s) {
  s = norm(s)
  if (!s) return ''
  if (MSGS[s]) return MSGS[s]
  const pm = s.match(PREFIX_RE)
  if (pm) {
    const j = nameJa(pm[1])
    const rest = sentenceJa(pm[2])
    if (j && rest !== null) return j + '：' + rest
  }
  for (const [rx, tmpl] of PATS) {
    const m = s.match(rx)
    if (!m) continue
    let out = tmpl
    let ok = true
    for (let i = 1; i < m.length; i++) {
      const g = m[i] || ''
      out = out.split('{r' + i + '}').join(g)
      // {v1} は動詞。辞書になければ英語を「」に入れる
      out = out.split('{v' + i + '}').join(VERBS_EN[norm(g).toLowerCase()] || '「' + g + '」')
      // {s1} は名前。辞書になければ英語のまま
      if (out.includes('{s' + i + '}')) out = out.split('{s' + i + '}').join(nameJa(g) || g)
      if (out.includes('{' + i + '}')) {
        let j = nameJa(g)
        if (j === null && SHORT_NAME_RE.test(g) && g.split(' ').length <= 3) j = g
        if (j === null) {
          ok = false
          break
        }
        out = out.split('{' + i + '}').join(j)
      }
    }
    if (ok) return out
  }
  return null
}

// 1行を訳す。全部訳せれば日本語、一部だけなら訳せなかった文を英語のまま混ぜる、
// 一つも訳せなければ null
function lineJa(text) {
  const s = norm(text)
  if (MSGS[s]) return MSGS[s]
  if (NAMES[s.toLowerCase()]) return NAMES[s.toLowerCase()]
  const parts = splitSentences(s).map((en) => [sentenceJa(en), en])
  const done = parts.filter((p) => p[0] !== null).length
  if (!done) return null
  if (done === parts.length) return parts.map((p) => p[0]).join('')
  return parts.map((p) => (p[0] !== null ? p[0] : p[1])).join(' ')
}

// ゲームの出力のかたまり → [{ en, ja, indent }]（空行は en: ''）
export function translateBlock(raw) {
  let lines = String(raw).replace(/\r/g, '').split('\n')
  while (lines.length && ['', '>'].includes(lines[lines.length - 1].trim())) lines.pop()
  while (lines.length && !lines[0].trim()) lines.shift()
  if (lines.length) lines[lines.length - 1] = lines[lines.length - 1].replace(/\s*>\s*$/, '')
  const out = []
  for (const ln of lines) {
    if (!ln.trim()) {
      if (out.length && out[out.length - 1].en !== '') out.push({ en: '', ja: null, indent: 0 })
      continue
    }
    const indent = ln.length - ln.replace(/^\s+/, '').length
    let ja = null
    if (indent) ja = nameJa(ln) || sentenceJa(ln)
    if (ja === null) ja = lineJa(ln)
    out.push({ en: ln.trim(), ja, indent })
  }
  return out
}

export function roomJa(room) {
  return nameJa(room) || room
}

// 訳せなかった文の一覧（辞書づくり用）
export function missing(raw) {
  const out = []
  for (const l of translateBlock(raw)) {
    if (!l.en) continue
    const s = norm(l.en)
    if (MSGS[s] || NAMES[s.toLowerCase()]) continue
    if (l.indent && (nameJa(s) || sentenceJa(s))) continue
    for (const en of splitSentences(s)) if (sentenceJa(en) === null) out.push(norm(en))
  }
  return out
}

