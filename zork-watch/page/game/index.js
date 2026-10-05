import * as hmUI from '@zos/ui'
import { scrollTo } from '@zos/page'
import { setWakeUpRelaunch } from '@zos/display'
import { W, H, MARGIN, CW, Canvas } from '../../shared/ui'
import { ZMachine } from '../../shared/zmachine'
import { translateBlock, roomJa } from '../../shared/translate'
import { loadStory, saveState, loadState, clearState } from '../../shared/store'

// [ボタンの文字, 送る命令]
const DIRS = [
  ['北西', 'nw'], ['北', 'n'], ['北東', 'ne'],
  ['西', 'w'], ['見る', 'look'], ['東', 'e'],
  ['南西', 'sw'], ['南', 's'], ['南東', 'se']
]
const DIRS2 = [['上', 'u'], ['下', 'd'], ['中', 'in'], ['外', 'out']]
const CMDS = [
  ['持ち物 i', 'inventory'], ['全部取る', 'take all'],
  ['待つ', 'wait'], ['もう一度', 'again'],
  ['体調', 'diagnose'], ['得点', 'score'],
  ['はい yes', 'yes'], ['いいえ no', 'no'],
  ['セーブ', 'save'], ['ロード', 'restore']
]
// キーボードの上に並べる単語（押すと後ろに空白付きで足す）
const WORDS = ['take', 'drop', 'open', 'read', 'examine', 'with', 'turn on', 'attack']
const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']

const C = {
  room: 0xffd33d,
  sub: 0x8b949e,
  cmd: 0x79c0ff,
  ja: 0xffffff,
  en: 0x9aa4ad,
  btn: 0x2d333b,
  dir: 0x1f3a5f,
  ok: 0x2e7d32,
  ng: 0x8e2b2b
}

Page({
  state: {},

  onInit() {
    const st = this.state
    st.canvas = new Canvas()
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

  // ---- 画面 ----
  render() {
    const st = this.state
    st.canvas.clear()
    if (st.mode === 'keys') this.renderKeys()
    else this.renderGame()
    scrollTo({ y: 0 })
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
      cv.add(hmUI.widget.FILL_RECT, { x: 0, y: y + 64, w: W, h: 140, color: 0x000000 })
      return
    }

    // 入力
    cv.button((W - 300) / 2, y, 300, 70, '英語で入力', () => this.openKeys(), { color: C.ok, size: 28, radius: 35 })
    y += 86

    // 方角
    const bw = 116
    const bh = 64
    const gap = 8
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
    const cw = 170
    const cx = (W - (cw * 2 + gap)) / 2
    CMDS.forEach(([label, cmd], i) => {
      const bx = cx + (i % 2) * (cw + gap)
      const by = y + Math.floor(i / 2) * (bh + gap)
      cv.button(bx, by, cw, bh, label, () => this.send(cmd), { size: 24 })
    })
    y += Math.ceil(CMDS.length / 2) * (bh + gap) + 10
    cv.button((W - 240) / 2, y, 240, 56, 'はじめから', () => this.confirmNew(), { color: C.ng, size: 22 })
    y += 56
    // 丸い画面の下で切れないよう余白
    cv.add(hmUI.widget.FILL_RECT, { x: 0, y, w: W, h: 140, color: 0x000000 })
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

  // ---- キーボード ----
  openKeys() {
    const st = this.state
    st.typed = ''
    st.mode = 'keys'
    this.render()
  },

  type(s) {
    const st = this.state
    if (s === '\b') st.typed = st.typed.slice(0, -1)
    else if (st.typed.length < 60) st.typed += s
    st.display.setProperty(hmUI.prop.TEXT, st.typed + '_')
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
    // 単語
    const ww = 84
    const wh = 50
    const g = 6
    const wx = (W - (ww * 4 + g * 3)) / 2
    WORDS.forEach((wd, i) => {
      const bx = wx + (i % 4) * (ww + g)
      const by = 92 + Math.floor(i / 4) * (wh + g)
      cv.button(bx, by, ww, wh, wd, () => this.type(wd + ' '), { size: 20, color: C.dir })
    })
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
    cv.button(W / 2 - 160, y, 90, 54, '戻る', () => {
      st.mode = 'game'
      this.render()
    }, { color: C.ng, size: 26 })
    cv.button(W / 2 - 64, y, 128, 54, 'space', () => this.type(' '), { size: 22 })
    cv.button(W / 2 + 70, y, 90, 54, '送る', () => this.send(st.typed), { color: C.ok, size: 26 })
  }
})
