import * as hmUI from '@zos/ui'
import { scrollTo } from '@zos/page'
import { setWakeUpRelaunch } from '@zos/display'
import { W, Canvas } from '../../shared/ui'
import { createGame } from '../../shared/engine'
import { io } from '../../shared/store'

// [ボタンの文字, 送る命令, 方角]。null は空き
const PAD = [
  ['上', 'up', 'u'], ['北', 'north', 'n'], null,
  ['西', 'west', 'w'], ['見る', 'look', ''], ['東', 'east', 'e'],
  null, ['南', 'south', 's'], ['下', 'down', 'd']
]
const COMMON = [
  ['持ち物', 'inventory'], ['待つ', 'wait'],
  ['耳をすます', 'listen'], ['寝る', 'sleep'],
  ['わからない', 'dunno'], ['遊び方', 'help']
]

// 色。裏側の部屋は明暗が反転し、空の部屋は淡くなる（HTML 版と同じ）
const THEMES = {
  '': { bg: 0x0f1215, text: 0xc9d1d3, bright: 0xf4f7f7, dim: 0x7b868a, warn: 0xe3a19a, hot: 0xff6b5e, room: 0xf4f7f7, cmd: 0x8fb8d6, btn: 0x2a3136, btnText: 0xc9d1d3, dir: 0x1b2a33, open: 0x3d5566, ok: 0x4f6b5a, ng: 0x6b3a3a },
  ura: { bg: 0xd9d6cc, text: 0x2a2620, bright: 0x000000, dim: 0x6b665a, warn: 0x9b2d1f, hot: 0x9b2d1f, room: 0x000000, cmd: 0x3a4f63, btn: 0xb3ae9f, btnText: 0x1a1712, dir: 0xc4c0b3, open: 0x8f8a7b, ok: 0x8c9c84, ng: 0xa88a7f },
  sky: { bg: 0xe9e7e1, text: 0x3f5d72, bright: 0x172f40, dim: 0x7f98a8, warn: 0x8f4a6a, hot: 0x8a1f3a, room: 0x172f40, cmd: 0x4d6b80, btn: 0xc9d6dd, btnText: 0x172f40, dir: 0xdfe6ea, open: 0x9fbfd3, ok: 0xa9c4b4, ng: 0xd3b3c0 }
}

Page({
  state: {},

  onInit() {
    const st = this.state
    st.canvas = new Canvas()
    st.mode = 'game' // game / verb / obj / obj2 / word
    st.verb = null
    st.obj1 = null
    st.error = ''
    try {
      setWakeUpRelaunch({ relaunch: true })
    } catch (e) {}
    try {
      st.game = createGame(io)
      st.game.start(false)
    } catch (e) {
      st.error = (e && e.message) || String(e)
    }
  },

  build() {
    this.render()
  },

  send(label, en) {
    const st = this.state
    st.mode = 'game'
    try {
      st.game.submit(label, en)
    } catch (e) {
      st.error = (e && e.message) || String(e)
    }
    this.render()
  },

  newGame() {
    const st = this.state
    st.mode = 'game'
    st.error = ''
    st.game.start(true)
    this.render()
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

  // ---- 画面 ----
  render() {
    const st = this.state
    st.canvas.clear()
    const theme = st.game && !st.error ? st.game.status().theme : ''
    const T = THEMES[theme] || THEMES['']
    st.T = T
    st.bg = st.canvas.add(hmUI.widget.FILL_RECT, { x: 0, y: 0, w: W, h: 480, color: T.bg })
    let y
    if (st.error) y = this.renderError()
    else if (st.mode === 'game') y = this.renderGame()
    else y = this.renderBuilder()
    // 丸い画面の下で切れないよう、余白まで背景で埋める
    st.bg.setProperty(hmUI.prop.MORE, { x: 0, y: 0, w: W, h: Math.max(480, y + 140) })
    scrollTo({ y: 0 })
  },

  renderError() {
    const st = this.state
    const cv = st.canvas
    const T = st.T
    let y = cv.text(100, 'エラー', { size: 30, color: T.warn, center: true })
    y = cv.text(y, st.error, { size: 22, color: T.text, center: true })
    if (st.game) {
      cv.button((W - 240) / 2, y + 20, 240, 60, 'はじめから', () => this.newGame(), { color: T.ng })
      y += 80
    }
    return y
  },

  renderGame() {
    const st = this.state
    const cv = st.canvas
    const T = st.T
    const g = st.game
    const s = g.status()
    let y = 36
    y = cv.text(y, s.room + (s.ball ? '　●' : ''), { size: 28, color: T.room, center: true, gap: 0 })
    y = cv.text(y, s.day + '　' + s.temp, { size: 22, color: s.hot ? T.hot : T.dim, center: true, gap: 12 })
    for (const c of g.pastCommands(3)) y = cv.text(y, '> ' + c, { size: 20, color: T.dim, gap: 2 })
    y += 6
    for (const r of g.turn()) {
      if (r.t === 'gap') {
        y += 10
        continue
      }
      if (r.t === 'cmd') {
        y = cv.text(y, '> ' + r.ja, { size: 24, color: T.cmd, gap: 8 })
        continue
      }
      const cls = r.cls || ''
      const opt = { size: 25, color: T.text, gap: 6 }
      if (cls === 'title') opt.color = T.bright
      else if (cls === 'voice') { opt.color = T.bright; opt.indent = 16 }
      else if (cls === 'note') { opt.color = T.dim; opt.size = 21 }
      else if (cls === 'warn') opt.color = T.warn
      else if (cls === 'win') opt.color = T.bright
      else if (cls === 'indent') opt.indent = 24
      y = cv.text(y, r.ja, opt)
    }
    y += 12

    if (s.done) {
      cv.button((W - 260) / 2, y, 260, 64, 'はじめから', () => this.newGame(), { color: T.ok, textColor: T.btnText, size: 26 })
      return y + 64
    }

    cv.button((W - 300) / 2, y, 300, 70, '命令を作る', () => this.openBuilder(), { color: T.ok, textColor: T.btnText, size: 28, radius: 35 })
    y += 86

    // 方角。行ける方角だけ明るくする
    const bw = 116
    const bh = 64
    const gap = 8
    const x0 = (W - (bw * 3 + gap * 2)) / 2
    PAD.forEach((p, i) => {
      if (!p) return
      const [label, cmd, dir] = p
      const bx = x0 + (i % 3) * (bw + gap)
      const by = y + Math.floor(i / 3) * (bh + gap)
      const color = !dir ? T.btn : s.exits.includes(dir) ? T.open : T.dir
      cv.button(bx, by, bw, bh, label, () => this.send(label, cmd), { color, textColor: T.btnText, size: 26 })
    })
    y += 3 * (bh + gap) + 6

    const cw = 170
    const cx = (W - (cw * 2 + gap)) / 2
    COMMON.forEach(([label, cmd], i) => {
      const bx = cx + (i % 2) * (cw + gap)
      const by = y + Math.floor(i / 2) * (bh + gap)
      cv.button(bx, by, cw, bh, label, () => this.send(label, cmd), { color: T.btn, textColor: T.btnText, size: 24 })
    })
    y += Math.ceil(COMMON.length / 2) * (bh + gap) + 10
    cv.button((W - 240) / 2, y, 240, 56, 'はじめから', () => this.confirmNew(), { color: T.ng, textColor: T.btnText, size: 22 })
    return y + 56
  },

  // ---- 命令を作る：動詞 → 物（→ 2つ目の物）、または ことば ----
  openBuilder() {
    const st = this.state
    st.mode = 'verb'
    st.verb = null
    st.obj1 = null
    this.render()
  },

  back() {
    const st = this.state
    st.mode = st.mode === 'obj2' ? 'obj' : st.mode === 'verb' ? 'game' : 'verb'
    this.render()
  },

  renderBuilder() {
    const st = this.state
    const cv = st.canvas
    const T = st.T
    const g = st.game
    const v = st.verb
    let y = 40
    const titles = { verb: '何をする？', obj: '何を？', obj2: v && v[1].startsWith('give') ? '誰に？' : 'どこに？', word: v && v[1].startsWith('write') ? '何と書く？' : '何と言う？' }
    y = cv.text(y, titles[st.mode], { size: 28, color: T.bright, center: true, gap: 4 })
    if (st.mode === 'obj2') y = cv.text(y, v[2].replace('%', st.obj1.name).replace('#', '…'), { size: 20, color: T.dim, center: true, gap: 4 })
    y += 8

    const items = []
    if (st.mode === 'verb') {
      for (const vb of g.VERBS) items.push([vb[0], () => this.pickVerb(vb)])
      const bw = 126
      const bh = 58
      const gap = 6
      const x0 = (W - (bw * 3 + gap * 2)) / 2
      items.forEach(([label, fn], i) => {
        cv.button(x0 + (i % 3) * (bw + gap), y + Math.floor(i / 3) * (bh + gap), bw, bh, label, fn, { color: T.btn, textColor: T.btnText, size: label.length > 4 ? 19 : 23, radius: 12 })
      })
      y += Math.ceil(items.length / 3) * (bh + gap) + 8
    } else {
      if (st.mode === 'word') {
        const kind = v[1].startsWith('write') ? 'write' : 'say'
        for (const w of g.wordsHere(kind)) {
          items.push(['「' + w.show + '」', () => this.send(kind === 'say' ? `「${w.show}」と言う` : `「${w.show}」と書く`, `${kind} ${w.en}`)])
        }
        if (!items.length) y = cv.text(y, kind === 'say' ? '口にできることばが、思いつかない。' : '書くことが、思いつかない。', { size: 22, color: T.dim, center: true, gap: 10 })
      } else {
        let list = g.visible()
        if (st.mode === 'obj2') list = list.filter(o => o.id !== st.obj1.id)
        list.sort((a, b) => (b.held ? 1 : 0) - (a.held ? 1 : 0))
        for (const o of list) items.push([o.name + (o.held ? '（持）' : ''), () => this.pickObj(o)])
        if (!items.length) y = cv.text(y, '選べる物がない。', { size: 22, color: T.dim, center: true, gap: 10 })
      }
      const bw = 330
      const bh = 58
      items.forEach(([label, fn]) => {
        cv.button((W - bw) / 2, y, bw, bh, label, fn, { color: T.btn, textColor: T.btnText, size: 22, radius: 12 })
        y += bh + 6
      })
      y += 6
    }
    cv.button((W - 200) / 2, y, 200, 56, '戻る', () => this.back(), { color: T.ng, textColor: T.btnText, size: 24 })
    return y + 56
  },

  pickVerb(v) {
    const st = this.state
    st.verb = v
    if (!v[1].includes('%')) {
      this.send(v[2], v[1])
      return
    }
    st.mode = v[1].startsWith('say') || v[1].startsWith('write') ? 'word' : 'obj'
    this.render()
  },

  pickObj(o) {
    const st = this.state
    const v = st.verb
    if (st.mode === 'obj') {
      st.obj1 = o
      if (v[1].includes('#')) {
        st.mode = 'obj2'
        this.render()
        return
      }
      this.send(v[2].replace('%', o.name).replace('#', ''), v[1].replace('%', o.en).replace('#', ''))
      return
    }
    const a = st.obj1
    this.send(v[2].replace('%', a.name).replace('#', o.name), v[1].replace('%', a.en).replace('#', o.en))
  }
})
