import * as hmUI from '@zos/ui'
import { scrollTo } from '@zos/page'
import { setWakeUpRelaunch } from '@zos/display'
import { W, Canvas } from '../../shared/ui'
import { ZMachine } from '../../shared/zmachine'
import { translateBlock, roomJa, nameJa } from '../../shared/translate'
import { scene, dictWords, allObjects, mentioned } from '../../shared/scene'
import { loadStory, saveState, loadState, clearState } from '../../shared/store'

// [ボタンの文字, 送る命令]
const DIRS = [
  ['北西', 'nw'], ['北', 'n'], ['北東', 'ne'],
  ['西', 'w'], ['見る', 'look'], ['東', 'e'],
  ['南西', 'sw'], ['南', 's'], ['南東', 'se']
]
const DIRS2 = [['上', 'u'], ['下', 'd'], ['中', 'in'], ['外', 'out']]
const CMDS = [
  ['持ち物', 'inventory'], ['全部取る', 'take all'],
  ['待つ', 'wait'], ['もう一度', 'again'],
  ['体調', 'diagnose'], ['得点', 'score'],
  ['はい yes', 'yes'], ['いいえ no', 'no'],
  ['セーブ', 'save'], ['ロード', 'restore']
]
// 命令を組み立てるときの動詞。% は1つ目の物、# は2つ目の物
const VERBS = [
  ['調べる', 'examine %'], ['取る', 'take %'],
  ['置く', 'drop %'], ['開ける', 'open %'],
  ['閉める', 'close %'], ['読む', 'read %'],
  ['つける', 'turn on %'], ['消す', 'turn off %'],
  ['動かす', 'move %'], ['押す', 'push %'],
  ['中を見る', 'look in %'], ['登る', 'climb %'],
  ['入る・乗る', 'enter %'], ['食べる', 'eat %'],
  ['飲む', 'drink %'], ['振る', 'wave %'],
  ['鳴らす', 'ring %'], ['こする', 'rub %'],
  ['攻撃する', 'attack % with #'], ['入れる', 'put % in #'],
  ['上に置く', 'put % on #'], ['結ぶ', 'tie % to #'],
  ['鍵を開ける', 'unlock % with #'], ['火をつける', 'light % with #'],
  ['投げる', 'throw % at #'], ['渡す', 'give % to #'],
  ['ふくらます', 'inflate % with #'], ['掘る', 'dig in % with #']
]
// キーボードの上に並べる単語（入力の途中でなければこれを出す）
const WORDS = ['take', 'drop', 'open', 'read', 'examine', 'with', 'turn on', 'attack']
const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']
// 文章に出てきても、物の一覧には出さない名前
const NOT_THINGS = ['you', 'me', 'myself', 'yourself', 'it', 'them', 'all', 'ground', 'number', 'pseudo', 'blessings', 'kwpxm', 'such thing', 'random object', 'lungs']

const C = {
  room: 0xffd33d,
  sub: 0x8b949e,
  cmd: 0x79c0ff,
  ja: 0xffffff,
  en: 0x9aa4ad,
  btn: 0x2d333b,
  dir: 0x1f3a5f,
  obj: 0x3b2f4a,
  ok: 0x2e7d32,
  ng: 0x8e2b2b
}

Page({
  state: {},

  onInit() {
    const st = this.state
    st.canvas = new Canvas()
    st.chips = new Canvas()
    st.mode = 'game'
    st.typed = ''
    st.lastCmd = ''
    st.lines = []
    st.error = ''
    try {
      setWakeUpRelaunch({ relaunch: true })
    } catch (e) {}
    try {
      st.zm = new ZMachine(loadStory())
      st.zm.onSave = (snap) => saveState('save', snap)
      st.zm.onRestore = () => loadState('save')
      const auto = loadState('auto')
      if (auto) {
        st.zm.load(auto)
        const ex = auto.extra || {}
        st.lines = ex.lines || []
        st.lastCmd = ex.lastCmd || ''
      } else {
        this.advance()
      }
    } catch (e) {
      st.error = (e && e.message) || String(e)
    }
  },

  build() {
    this.render()
  },

  onDestroy() {
    this.autosave()
  },

  // ---- ゲームを進める ----
  advance() {
    const zm = this.state.zm
    let r = zm.run()
    while (r === 'busy') r = zm.run()
    this.state.lines = translateBlock(zm.takeOutput())
    this.state.over = r === 'quit'
    if (r === 'quit') clearState('auto')
    else this.autosave()
  },

  autosave() {
    const st = this.state
    if (!st.zm || !st.zm.waiting) return
    try {
      saveState('auto', st.zm.snapshot(), { lines: st.lines, lastCmd: st.lastCmd })
    } catch (e) {}
  },

  send(cmd) {
    const st = this.state
    cmd = String(cmd || '').trim()
    if (!cmd || !st.zm) return
    st.lastCmd = cmd
    st.mode = 'game'
    st.busy = true
    this.render()
    setTimeout(() => {
      try {
        st.zm.input(cmd)
        this.advance()
      } catch (e) {
        st.error = (e && e.message) || String(e)
      }
      st.busy = false
      this.render()
    }, 20)
  },

  newGame() {
    const st = this.state
    clearState('auto')
    st.zm.reset()
    st.lastCmd = ''
    st.over = false
    this.advance()
    this.render()
  },

  go(mode) {
    this.state.mode = mode
    this.render()
  },

  // ---- 画面 ----
  render() {
    const st = this.state
    st.canvas.clear()
    st.chips.clear()
    if (st.mode === 'keys') this.renderKeys()
    else if (st.mode === 'verb') this.renderVerbs()
    else if (st.mode === 'obj' || st.mode === 'obj2') this.renderObjects()
    else this.renderGame()
    scrollTo({ y: 0 })
  },

  // 下の余白（丸い画面の下で切れないように）
  pad(y) {
    this.state.canvas.add(hmUI.widget.FILL_RECT, { x: 0, y, w: W, h: 140, color: 0x000000 })
  },

  renderGame() {
    const st = this.state
    const cv = st.canvas
    let y = 40
    if (st.error) {
      y = cv.text(y + 60, 'エラー', { size: 30, color: C.ng, center: true })
      y = cv.text(y, st.error, { size: 24, center: true })
      if (st.zm) cv.button((W - 240) / 2, y + 20, 240, 60, '最初から', () => this.newGame(), { color: C.ng })
      return
    }
    const s = st.zm.status
    if (s && s.room) {
      y = cv.text(y, roomJa(s.room), { size: 28, color: C.room, center: true, gap: 0 })
      y = cv.text(y, `${s.room}  ${s.score}点 / ${s.moves}手`, { size: 20, color: C.sub, center: true, gap: 10 })
    } else {
      y += 20
    }
    if (st.lastCmd) y = cv.text(y, '> ' + st.lastCmd, { size: 24, color: C.cmd, gap: 10 })
    if (st.busy) {
      cv.text(y + 20, '考え中…', { size: 28, color: C.sub, center: true })
      return
    }
    for (const l of st.lines) {
      if (!l.en) {
        y += 10
        continue
      }
      const indent = Math.min(l.indent || 0, 6) * 8
      if (l.ja) y = cv.text(y, l.ja, { size: 26, color: C.ja, indent, gap: 0 })
      y = cv.text(y, l.en, { size: l.ja ? 20 : 24, color: l.ja ? C.en : C.ja, indent, gap: 12 })
    }
    y += 10

    if (st.over) {
      y = cv.text(y, 'ゲームが終わりました', { size: 26, color: C.room, center: true, gap: 16 })
      cv.button((W - 260) / 2, y, 260, 64, '最初から遊ぶ', () => this.newGame(), { color: C.ok, size: 26 })
      this.pad(y + 64)
      return
    }

    // 入力
    const gap = 8
    cv.button(W / 2 - 170, y, 220, 72, '命令を作る', () => this.startBuild(), { color: C.ok, size: 28, radius: 36 })
    cv.button(W / 2 + 58, y, 112, 72, 'キー', () => this.openKeys(''), { color: C.btn, size: 24, radius: 36 })
    y += 72 + 16

    // 方角
    const bw = 116
    const bh = 64
    const x0 = (W - (bw * 3 + gap * 2)) / 2
    DIRS.forEach(([label, cmd], i) => {
      const bx = x0 + (i % 3) * (bw + gap)
      const by = y + Math.floor(i / 3) * (bh + gap)
      cv.button(bx, by, bw, bh, label, () => this.send(cmd), { color: cmd === 'look' ? C.btn : C.dir, size: 26 })
    })
    y += 3 * (bh + gap)
    const sw = 84
    const sx = (W - (sw * 4 + gap * 3)) / 2
    DIRS2.forEach(([label, cmd], i) => {
      cv.button(sx + i * (sw + gap), y, sw, bh, label, () => this.send(cmd), { color: C.dir, size: 26 })
    })
    y += bh + gap + 10

    // よく使う命令
    y = this.grid(y, CMDS, (cmd) => this.send(cmd))
    y += 10
    cv.button((W - 240) / 2, y, 240, 56, 'はじめから', () => this.confirmNew(), { color: C.ng, size: 22 })
    this.pad(y + 56)
  },

  // 2列のボタン。items: [[文字, 値], ...]
  grid(y, items, onClick, color = C.btn) {
    const cv = this.state.canvas
    const cw = 170
    const bh = 64
    const gap = 8
    const cx = (W - (cw * 2 + gap)) / 2
    items.forEach(([label, value], i) => {
      const bx = cx + (i % 2) * (cw + gap)
      const by = y + Math.floor(i / 2) * (bh + gap)
      cv.button(bx, by, cw, bh, label, () => onClick(value), { size: 24, color })
    })
    return y + Math.ceil(items.length / 2) * (bh + gap)
  },

  confirmNew() {
    const st = this.state
    if (st.confirmAt && Date.now() - st.confirmAt < 3000) {
      st.confirmAt = 0
      this.newGame()
      return
    }
    st.confirmAt = Date.now()
    hmUI.showToast({ text: 'もう一度押すと、はじめからになります' })
  },

  // ---- 命令を組み立てる（動詞 → 物 → 2つ目の物）----
  startBuild() {
    const st = this.state
    st.verb = null
    st.obj1 = ''
    this.go('verb')
  },

  renderVerbs() {
    const st = this.state
    const cv = st.canvas
    let y = cv.text(40, '何をする？', { size: 28, color: C.room, center: true, gap: 14 })
    y = this.grid(y, VERBS, (tmpl) => {
      st.verb = tmpl
      this.go('obj')
    })
    y += 10
    cv.button((W - 200) / 2, y, 200, 60, '戻る', () => this.go('game'), { color: C.ng, size: 24 })
    this.pad(y + 60)
  },

  // いま選べる物: [{ label, word }]
  choices() {
    const zm = this.state.zm
    const { here, held } = scene(zm)
    const out = []
    const seen = {}
    const add = (en, word, mark) => {
      if (!word || seen[word]) return
      seen[word] = true
      const ja = nameJa(en)
      out.push({ label: (ja || en) + mark, word, group: mark })
    }
    for (const o of held) add(o.en, o.word, '（持）')
    for (const o of here) add(o.en, o.word, '')
    // 文章に出てきた物（窓や家など）
    if (!this.state.allObjs) this.state.allObjs = allObjects(zm)
    const text = this.state.lines.map((l) => l.en).join(' ')
    for (const o of mentioned(zm, this.state.allObjs, text)) {
      if (NOT_THINGS.indexOf(o.word) >= 0 || NOT_THINGS.indexOf(o.en) >= 0) continue
      // 名前の最後の単語だけが出てきたときは、その単語で表示する
      add(o.word === o.last && o.en !== o.last ? o.last : o.en, o.word, '')
    }
    return out
  },

  renderObjects() {
    const st = this.state
    const cv = st.canvas
    const second = st.mode === 'obj2'
    const verb = st.verb
    const preview = second
      ? verb.replace('%', st.obj1).replace('#', '…')
      : verb.replace('%', '…').replace('#', '…')
    let y = cv.text(36, second ? '何で・何に？' : '何を？', { size: 28, color: C.room, center: true, gap: 0 })
    y = cv.text(y, preview, { size: 22, color: C.cmd, center: true, gap: 14 })

    const pick = (word) => {
      if (!second) {
        st.obj1 = word
        if (verb.indexOf('#') >= 0) this.go('obj2')
        else this.send(verb.replace('%', word))
      } else {
        this.send(verb.replace('%', st.obj1).replace('#', word))
      }
    }
    let items = this.choices()
    if (second) items = items.filter((it) => it.word !== st.obj1)
    if (!second && /^(take|drop|put) /.test(verb)) items.push({ label: '全部 all', word: 'all' })
    const bw = 360
    const bh = 60
    for (const it of items) {
      cv.button((W - bw) / 2, y, bw, bh, it.label, () => pick(it.word), { size: 24, color: C.obj })
      y += bh + 8
    }
    if (!items.length) y = cv.text(y, '選べる物がありません', { size: 24, color: C.sub, center: true, gap: 10 })
    y += 6
    // 一覧にない物はキーボードで
    const prefix = second ? verb.replace('%', st.obj1).split('#')[0] : verb.split('%')[0]
    cv.button((W - bw) / 2, y, bw, bh, 'キーボードで書く', () => this.openKeys(prefix), { size: 22 })
    y += bh + 8
    cv.button((W - 200) / 2, y, 200, 60, '戻る', () => this.go(second ? 'obj' : 'verb'), { color: C.ng, size: 24 })
    this.pad(y + 60)
  },

  // ---- キーボード ----
  openKeys(prefix) {
    const st = this.state
    st.typed = prefix || ''
    this.go('keys')
  },

  type(s) {
    const st = this.state
    if (s === '\b') st.typed = st.typed.slice(0, -1)
    else if (st.typed.length < 60) st.typed += s
    st.display.setProperty(hmUI.prop.TEXT, st.typed + '_')
    this.renderChips()
  },

  // 入力中の単語を、候補の単語に置きかえる
  complete(word) {
    const st = this.state
    st.typed = st.typed.replace(/[a-z]*$/, '') + word + ' '
    st.display.setProperty(hmUI.prop.TEXT, st.typed + '_')
    this.renderChips()
  },

  renderChips() {
    const st = this.state
    st.chips.clear()
    if (!st.words) st.words = dictWords(st.zm)
    const part = (st.typed.match(/[a-z]+$/) || [''])[0]
    let list
    if (part) {
      // いまの文章や物の名前に出てくる単語を先に出す（辞書の単語は6文字までなので、6文字で比べる）
      const ctx = {}
      const text = st.lines.map((l) => l.en).join(' ') + ' ' + this.choices().map((c) => c.word).join(' ')
      for (const w of text.toLowerCase().split(/[^a-z]+/)) if (w) ctx[w.slice(0, 6)] = true
      list = st.words
        .filter((w) => w.indexOf(part) === 0 && w !== part)
        .sort((a, b) => (ctx[b] ? 1 : 0) - (ctx[a] ? 1 : 0) || a.length - b.length || (a < b ? -1 : 1))
        .slice(0, 8)
    } else {
      list = WORDS
    }
    const ww = 84
    const wh = 50
    const g = 6
    const wx = (W - (ww * 4 + g * 3)) / 2
    list.forEach((wd, i) => {
      const bx = wx + (i % 4) * (ww + g)
      const by = 92 + Math.floor(i / 4) * (wh + g)
      const onClick = part ? () => this.complete(wd) : () => this.type(wd + ' ')
      st.chips.button(bx, by, ww, wh, wd, onClick, { size: 20, color: C.dir })
    })
  },

  renderKeys() {
    const st = this.state
    const cv = st.canvas
    st.display = cv.add(hmUI.widget.TEXT, {
      x: (W - 300) / 2, y: 34, w: 300, h: 52,
      text: st.typed + '_',
      text_size: 28,
      color: 0xffffff,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text_style: hmUI.text_style.ELLIPSIS
    })
    this.renderChips()
    // 文字
    const kw = 42
    const kh = 50
    const kg = 4
    let y = 208
    ROWS.forEach((row, r) => {
      const keys = row.split('')
      if (r === 2) keys.push('\b')
      const x0 = (W - (keys.length * (kw + kg) - kg)) / 2
      keys.forEach((k, i) => {
        cv.button(x0 + i * (kw + kg), y, kw, kh, k === '\b' ? 'DEL' : k, () => this.type(k), {
          size: k === '\b' ? 16 : 26,
          radius: 8,
          color: k === '\b' ? C.ng : C.btn
        })
      })
      y += kh + kg
    })
    y += 4
    cv.button(W / 2 - 160, y, 90, 54, '戻る', () => this.go('game'), { color: C.ng, size: 26 })
    cv.button(W / 2 - 64, y, 128, 54, 'space', () => this.type(' '), { size: 22 })
    cv.button(W / 2 + 70, y, 90, 54, '送る', () => this.send(st.typed), { color: C.ok, size: 26 })
  }
})
