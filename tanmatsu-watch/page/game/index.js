import * as hmUI from '@zos/ui'
import * as interaction from '@zos/interaction'
import { scrollTo } from '@zos/page'
import { setWakeUpRelaunch } from '@zos/display'
import { W, Canvas, CW, MARGIN } from '../../shared/ui'
import { createGame } from '../../shared/engine'
import { io, loadSettings, saveSettings } from '../../shared/store'
import { buzz, feel } from '../../shared/vibe'

// 画面の色。[背景, 文字, 明るい文字, 薄い文字, ボタン, 警告]
const RAW = {
  frame: ['0a0a0a', 'cfcfcf', 'ffffff', '7a7a7a', '262626', 'e08a6a'],
  1: ['000a03', '33ff66', 'c4ffd2', '1f8f3f', '0c2a14', 'ffcc66'],
  2: ['0f0900', 'ffb000', 'ffe2a8', '99681a', '2e1f05', 'ff6040'],
  3: ['00080c', '4fd8ff', 'd6f6ff', '2a7a94', '0a2430', 'ff8060'],
  4: ['0c0000', 'ff5a4a', 'ffd6cf', '8f3028', '2a0a08', 'ffcc66']
}
function theme(name) {
  const c = (RAW[name] || RAW.frame).map(h => parseInt(h, 16))
  return { bg: c[0], text: c[1], bright: c[2], dim: c[3], key: c[4], warn: c[5] }
}

Page({
  state: {},

  onInit() {
    const st = this.state
    st.canvas = new Canvas()
    st.sel = null // 記録 1 で選んでいる物
    st.error = ''
    st.set = loadSettings()
    try {
      setWakeUpRelaunch({ relaunch: true })
    } catch (e) {}
    try {
      st.game = createGame(io)
      st.game.start(false)
    } catch (e) {
      st.error = (e && e.message) || String(e)
    }
    // 竜頭（回せる時計なら）で周波数を回す
    try {
      if (typeof interaction.onDigitalCrown === 'function') {
        interaction.onDigitalCrown({
          callback: (key, degree) => {
            const g = st.game
            if (!g || g.phase() !== 'play' || g.cur() !== 3 || !degree) return
            this.tune(degree > 0 ? 1 : -1)
          }
        })
        st.crown = true
      }
    } catch (e) {}
  },

  build() {
    this.render()
  },

  onDestroy() {
    try {
      if (this.state.crown) interaction.offDigitalCrown()
    } catch (e) {}
  },

  // ゲームを動かしてから描き直す
  run(fn) {
    const st = this.state
    try {
      fn(st.game)
      if (st.set.vibe) feel(st.game.fx)
    } catch (e) {
      st.error = (e && e.message) || String(e)
    }
    this.render()
  },

  confirmNew() {
    const st = this.state
    if (st.confirmAt && Date.now() - st.confirmAt < 3000) {
      st.confirmAt = 0
      st.sel = null
      st.error = ''
      this.run(g => g.start(true))
      return
    }
    st.confirmAt = Date.now()
    hmUI.showToast({ text: 'もう一度押すと、はじめからになります' })
  },

  toggleVibe() {
    const st = this.state
    st.set.vibe = !st.set.vibe
    saveSettings(st.set)
    if (st.set.vibe) buzz(false)
    this.render()
  },

  // ---- 画面 ----
  // keep が真なら、スクロールの位置を変えない（その場の小さな操作のとき）
  render(keep) {
    const st = this.state
    const g = st.game
    st.canvas.clear()
    st.live = null
    const ph = g && !st.error ? g.phase() : 'error'
    st.T = theme(ph === 'play' ? g.cur() : 'frame')
    st.bg = st.canvas.add(hmUI.widget.FILL_RECT, { x: 0, y: 0, w: W, h: 480, color: st.T.bg })
    let y
    if (ph === 'error') y = this.renderError()
    else if (ph === 'menu') y = this.renderMenu()
    else if (ph === 'play') y = [0, this.render1, this.render2, this.render3, this.render4][g.cur()].call(this)
    else y = this.renderText(ph)
    // 丸い画面の下で切れないよう、余白まで背景で埋める
    st.bg.setProperty(hmUI.prop.MORE, { x: 0, y: 0, w: W, h: Math.max(480, y + 140) })
    if (!keep) scrollTo({ y: 0 })
  },

  btn(x, y, w, h, label, fn, opt = {}) {
    const T = this.state.T
    return this.state.canvas.button(x, y, w, h, label, fn, {
      color: opt.color === undefined ? T.key : opt.color,
      textColor: opt.textColor === undefined ? T.text : opt.textColor,
      size: opt.size || (label.length > 9 ? 20 : 24),
      radius: opt.radius
    })
  },

  // 真ん中に一つ、大きなボタン
  bigBtn(y, label, fn) {
    const T = this.state.T
    this.btn((W - 280) / 2, y, 280, 66, label, fn, { color: T.text, textColor: T.bg, size: 26, radius: 33 })
    return y + 66
  },

  lines(y, list) {
    const st = this.state
    const T = st.T
    for (const r of list) {
      const opt = { size: 24, color: T.text, gap: 8 }
      if (r.cls === 'bright') opt.color = T.bright
      else if (r.cls === 'dim') { opt.color = T.dim; opt.size = 21 }
      else if (r.cls === 'warn') opt.color = T.warn
      else if (r.cls === 'voice') { opt.color = T.bright; opt.indent = 14 }
      else if (r.cls === 'print') { opt.color = T.bright; opt.size = 21; opt.indent = 10 }
      else if (r.cls === 'cmd') { opt.color = T.dim; opt.size = 22 }
      y = st.canvas.text(y, r.ja, opt)
    }
    return y
  },

  renderError() {
    const st = this.state
    const T = st.T
    let y = st.canvas.text(100, 'エラー', { size: 30, color: T.warn, center: true })
    y = st.canvas.text(y, st.error, { size: 22, color: T.text, center: true })
    if (st.game) y = this.bigBtn(y + 20, 'はじめから', () => this.confirmNew())
    return y
  },

  // 起動の文・記録の前後の地の文
  renderText(ph) {
    const st = this.state
    const g = st.game
    const T = st.T
    let y = 60
    if (ph === 'intro' || ph === 'outro') {
      const ep = g.EPS[g.cur() - 1]
      y = st.canvas.text(y, '記録 ' + ep.n + '　' + ep.name, { size: 22, color: T.dim, center: true, gap: 16 })
    } else {
      y = st.canvas.text(y, '端末の夜', { size: 34, color: T.bright, center: true, gap: 18 })
    }
    y = this.lines(y, g.log()) + 16
    if (ph === 'prologue') return this.bigBtn(y, '電源を入れる', () => this.run(g => g.toMenu()))
    if (ph === 'intro') return this.bigBtn(y, '始める', () => this.run(g => g.begin()))
    return this.bigBtn(y, '端末に戻る', () => this.run(g => g.toMenu()))
  },

  renderMenu() {
    const st = this.state
    const g = st.game
    const T = st.T
    const cv = st.canvas
    let y = 40
    y = cv.text(y, '端末の夜', { size: 32, color: T.bright, center: true, gap: 2 })
    y = cv.text(y, 'フロッピーを選ぶ', { size: 20, color: T.dim, center: true, gap: 12 })
    for (const ep of g.EPS) {
      const open = g.unlocked(ep.n)
      const label = open ? '記録' + ep.n + '　' + ep.name + (g.cleared(ep.n) ? '　済' : '') : '記録' + ep.n + '　――'
      const color = open ? theme(ep.n).key : T.key
      const textColor = open ? theme(ep.n).text : T.dim
      this.btn((W - 340) / 2, y, 340, 62, label, () => {
        if (!open) {
          hmUI.showToast({ text: '前の記録を終えてから' })
          return
        }
        st.sel = null
        this.run(g => g.insert(ep.n))
      }, { color, textColor, size: 24, radius: 14 })
      y += 70
    }
    const got = g.endings()
    y = cv.text(y + 6, '結末 ' + got.length + '／' + g.ENDINGS.length + (got.length ? '：' + got.map(e => e[1]).join('・') : ''), { size: 20, color: T.dim, center: true, gap: 14 })
    const bw = 170
    const x0 = (W - (bw * 2 + 8)) / 2
    this.btn(x0, y, bw, 56, '振動：' + (st.set.vibe ? '入' : '切'), () => this.toggleVibe(), { textColor: T.dim, size: 22 })
    this.btn(x0 + bw + 8, y, bw, 56, 'はじめから', () => this.confirmNew(), { textColor: T.warn, size: 22 })
    return y + 56
  },

  // 記録を終えたら「次へ」、途中なら「取り出す」
  footer(y) {
    const st = this.state
    const g = st.game
    if (g.epDone()) return this.bigBtn(y + 6, '次へ', () => this.run(g => g.finish()))
    this.btn((W - 220) / 2, y + 10, 220, 54, '取り出す', () => this.run(g => g.toMenu()), { textColor: st.T.dim, size: 22 })
    return y + 64
  },

  // ---- 記録 1：観測所 ----
  render1() {
    const st = this.state
    const g = st.game
    const T = st.T
    const cv = st.canvas
    let y = 36
    y = cv.text(y, g.e1Room(), { size: 24, color: T.bright, center: true, gap: 8 })
    for (const c of g.past()) y = cv.text(y, '> ' + c, { size: 20, color: T.dim, gap: 2 })
    y = this.lines(y + 4, g.log()) + 10
    if (g.epDone()) return this.footer(y)

    const bw = 340
    for (const o of g.e1Objects()) {
      const open = st.sel === o.id
      this.btn((W - bw) / 2, y, bw, 56, o.name, () => {
        if (o.acts.length === 1) {
          st.sel = null
          this.run(g => g.e1Act(o, o.acts[0]))
          return
        }
        st.sel = open ? null : o.id
        this.render(true)
      }, { color: open ? T.text : T.key, textColor: open ? T.bg : T.text, radius: 10 })
      y += 62
      if (open) {
        for (const a of o.acts) {
          this.btn((W - bw) / 2 + 30, y, bw - 30, 52, '→ ' + a[1], () => {
            st.sel = null
            this.run(g => g.e1Act(o, a))
          }, { textColor: T.bright, size: 22, radius: 10 })
          y += 58
        }
      }
    }
    y += 6
    const G = [['look', '見回す'], ['wait', '待つ'], ['raise', '目を上げる']]
    const gw = 126
    const x0 = (W - (gw * 3 + 12)) / 2
    G.forEach(([id, label], i) => {
      this.btn(x0 + i * (gw + 6), y, gw, 56, label, () => {
        st.sel = null
        this.run(g => g.e1Global(id, label))
      }, { textColor: T.dim, size: 21 })
    })
    return this.footer(y + 56)
  },

  // ---- 記録 2：手順書 ----
  render2() {
    const st = this.state
    const g = st.game
    const T = st.T
    const cv = st.canvas
    const e = g.ep()
    let y = 36
    y = cv.text(y, 'KS-2　' + (e.power ? '● 電源' : '○ 電源'), { size: 22, color: e.power ? T.bright : T.dim, center: true, gap: 6 })
    // 表示窓
    const scr = g.e2Screen() || '　'
    cv.add(hmUI.widget.FILL_RECT, { x: MARGIN, y, w: CW, h: 70, radius: 8, color: 0x000000 })
    cv.add(hmUI.widget.TEXT, {
      x: MARGIN, y, w: CW, h: 70, text: scr, text_size: 24, color: e.power ? T.text : T.dim,
      align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V, text_style: hmUI.text_style.WRAP
    })
    y += 80
    y = this.lines(y, g.log()) + 8
    if (g.epDone()) return this.footer(y)

    const bw = 120
    const gap = 6
    const x0 = (W - (bw * 3 + gap * 2)) / 2
    const rows = [
      [['電源', 'power'], ['校正', 'cal'], ['切替：' + g.MODES[e.mode], 'mode']],
      [['ダイヤル−', 'dminus'], ['DIAL ' + e.dial, null], ['ダイヤル+', 'dplus']],
      [['記録', 'rec'], ['紙送り', 'feed'], null]
    ]
    rows.forEach((row, r) => {
      row.forEach((b, i) => {
        if (!b) return
        const [label, id] = b
        const fn = id ? () => this.run(g => g.e2Press(id)) : () => {}
        this.btn(x0 + i * (bw + gap), y + r * 62, bw, 56, label, fn, { color: id ? T.key : T.bg, textColor: id ? T.text : T.bright, size: label.length > 4 ? 19 : 23, radius: 10 })
      })
    })
    y += 3 * 62 + 10

    // 手順書
    const [title, body] = g.e2Manual()
    y = cv.text(y, '― 手順書 ―', { size: 20, color: T.dim, center: true, gap: 2 })
    y = cv.text(y, title, { size: 21, color: T.bright, center: true, gap: 2 })
    y = cv.text(y, body, { size: 22, color: T.text, gap: 8 })
    const pw = 150
    this.btn(W / 2 - pw - 4, y, pw, 52, '◀ 前', () => { g.e2Page(-1); this.render(true) }, { textColor: T.dim, size: 22 })
    this.btn(W / 2 + 4, y, pw, 52, '次 ▶', () => { g.e2Page(1); this.render(true) }, { textColor: T.dim, size: 22 })
    return this.footer(y + 52)
  },

  // ---- 記録 3：周波数 ----
  render3() {
    const st = this.state
    const g = st.game
    const T = st.T
    const cv = st.canvas
    const info = g.e3Info()
    let y = 40
    const freq = cv.add(hmUI.widget.TEXT, {
      x: 0, y, w: W, h: 70, text: info.freq, text_size: 60, color: T.bright,
      align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V
    })
    y += 70
    cv.add(hmUI.widget.TEXT, { x: 0, y, w: W, h: 26, text: 'MHz', text_size: 18, color: T.dim, align_h: hmUI.align.CENTER_H })
    y += 30
    // 受信の強さ
    const mw = 300
    const mx = (W - mw) / 2
    cv.add(hmUI.widget.FILL_RECT, { x: mx, y, w: mw, h: 10, radius: 5, color: T.key })
    const meter = cv.add(hmUI.widget.FILL_RECT, { x: mx, y, w: Math.max(4, Math.round(mw * info.strength)), h: 10, radius: 5, color: T.text })
    y += 18
    const frag = cv.add(hmUI.widget.TEXT, {
      x: MARGIN, y, w: CW, h: 96, text: info.frag, text_size: 21, color: info.dist === 0 ? T.bright : T.dim,
      align_h: hmUI.align.CENTER_H, text_style: hmUI.text_style.WRAP
    })
    y += 100
    st.live = { freq, meter, frag, mx, mw, my: y - 118 }

    if (!g.epDone()) {
      const bw = 86
      const gap = 6
      const x0 = (W - (bw * 4 + gap * 3)) / 2
      const B = [['−1.0', -10], ['−0.1', -1], ['+0.1', 1], ['+1.0', 10]]
      B.forEach(([label, d], i) => {
        this.btn(x0 + i * (bw + gap), y, bw, 64, label, () => this.tune(d), { size: 22, radius: 12 })
      })
      y += 72
      if (st.crown) y = cv.text(y, '竜頭を回しても合わせられる', { size: 18, color: T.dim, center: true, gap: 6 })
    }
    const found = g.e3Found()
    if (found.length) y = cv.text(y + 4, '聞いたもの：' + found.join('　'), { size: 19, color: T.dim, center: true, gap: 8 })
    y = this.lines(y + 4, g.log())
    return this.footer(y)
  },

  // 回すたびに描き直すと重いので、新しく聞こえたときだけ描き直す
  tune(d) {
    const st = this.state
    const g = st.game
    if (g.epDone()) return
    let changed = false
    try {
      changed = g.e3Tune(d)
      if (st.set.vibe) feel(g.fx)
    } catch (e) {
      st.error = (e && e.message) || String(e)
      changed = true
    }
    if (changed || !st.live) {
      this.render()
      return
    }
    const info = g.e3Info()
    const L = st.live
    L.freq.setProperty(hmUI.prop.TEXT, info.freq)
    L.meter.setProperty(hmUI.prop.MORE, { x: L.mx, y: L.my, w: Math.max(4, Math.round(L.mw * info.strength)), h: 10 })
    L.frag.setProperty(hmUI.prop.TEXT, info.frag)
    L.frag.setProperty(hmUI.prop.COLOR, info.dist === 0 ? st.T.bright : st.T.dim)
  },

  // ---- 記録 4：応答 ----
  render4() {
    const st = this.state
    const g = st.game
    const T = st.T
    const cv = st.canvas
    const v = g.e4View()
    let y = 36
    y = cv.text(y, v.clock, { size: 40, color: T.bright, center: true, gap: 8 })
    y = this.lines(y, g.log())
    if (g.epDone()) return this.footer(y + 6)
    y += 6
    y = this.lines(y, v.prompt.map(([ja, cls]) => ({ ja, cls }))) + 8

    const bw = 340
    for (const c of v.choices) {
      this.btn((W - bw) / 2, y, bw, 60, c.label, () => this.run(g => g.e4Choose(c.id)), { textColor: T.bright, size: c.label.length > 12 ? 19 : 22, radius: 12 })
      y += 66
    }
    if (v.dial) {
      const code = g.ep().code
      const cw = 90
      const x0 = (W - (cw * 3 + 24)) / 2
      for (let i = 0; i < 3; i++) {
        const x = x0 + i * (cw + 12)
        // 数字だけ書き換える（描き直さない）
        const spin = d => {
          g.e4Dial(i, d)
          digit.setProperty(hmUI.prop.TEXT, String(g.ep().code[i]))
        }
        this.btn(x, y, cw, 52, '▲', () => spin(1), { size: 22 })
        const digit = cv.add(hmUI.widget.TEXT, { x, y: y + 56, w: cw, h: 60, text: String(code[i]), text_size: 44, color: T.bright, align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V })
        this.btn(x, y + 120, cw, 52, '▼', () => spin(-1), { size: 22 })
      }
      y += 180
      y = this.bigBtn(y, '伝える', () => this.run(g => g.e4Send())) + 4
    }
    return this.footer(y)
  }
})
