import * as hmUI from '@zos/ui'
import { scrollTo } from '@zos/page'
import { setWakeUpRelaunch } from '@zos/display'
import { W, Canvas, CW, textHeight } from '../../shared/ui'
import { createGame } from '../../shared/engine'
import { io, loadSettings, saveSettings } from '../../shared/store'
import { buzz } from '../../shared/vibe'

// [ボタンの文字, 送る命令, 方角]。null は空き
const PAD = [
  ['上', 'up', 'u'], ['北', 'north', 'n'], null,
  ['西', 'west', 'w'], ['見る', 'look', ''], ['東', 'east', 'e'],
  null, ['南', 'south', 's'], ['下', 'down', 'd']
]
const COMMON = [
  ['持ち物', 'inventory'], ['待つ', 'wait'],
  ['耳をすます', 'listen'], ['寝る', 'sleep'],
  ['野帳', 'book'], ['遊び方', 'help']
]

// 色は HTML 版のレベルごとの色と同じ。停電中は暗くなる
// [背景, 文字, 明るい文字, 薄い文字, 枠, 方角キー, 警告]
const RAW = {
  t0: ['15130a', 'e0cd7a', 'fff3b8', '8f8250', '3f3a22', '1d1b10', 'e88a6a'],
  tm: ['efe6cf', '5a4630', '2a1f12', '8c7a5e', 'd6c8a6', 'e6dbbd', '9b3d1f'],
  t1: ['111315', 'b9c1c6', 'eef2f4', '6d777d', '2a3034', '171b1e', 'e3a07a'],
  t2: ['121015', 'b9aec8', 'ebe4f5', '6f6680', '2c2735', '18151d', 'e3a07a'],
  t3: ['160a09', 'd9a49a', 'ffe0d8', '8e5e56', '3c2320', '1e0f0e', 'ff8f6e'],
  t4: ['e9e7e0', '31363a', '0b0d0f', '727a80', 'c4c2ba', 'dcdad2', '9b2d1f'],
  t5: ['13070a', 'd8b67a', 'fbe6b8', '8b6a44', '3b1e22', '1c0b0f', 'ff8f7a'],
  t6: ['000000', '7a7a7a', 'b5b5b5', '4a4a4a', '1c1c1c', '080808', 'b07070'],
  t7: ['040c15', '8fb4ca', 'd6ecf8', '4f6f84', '16283a', '07131f', 'e3a07a'],
  dark: ['050505', '4a4a4a', '8a8a8a', '333333', '1a1a1a', '0c0c0c', 'b07070']
}
function theme(name) {
  const c = (RAW[name] || RAW.t0).map(h => parseInt(h, 16))
  return { bg: c[0], text: c[1], bright: c[2], dim: c[3], faint: c[4], key: c[5], warn: c[6] }
}

// 確かめたときの、ネオンの二行（HTML 版と同じ）
const TRUISM = {
  wall: ['LOOK. COUNT. THEN JUMP.', '見る。数える。それから、跳ぶ。'],
  crate: ['WHAT ARRIVES UNSEEN LEAVES UNSEEN.', '見ていないあいだに来たものは、見ていないあいだに去る。'],
  arms: ['TWO WARNINGS CAN BOTH BE TRUE.', '食い違う二つの忠告が、どちらも正しいことがある。'],
  growler: ['FIND THE HEAD BEFORE YOU THROW.', '投げる前に、頭がどこかを見る。'],
  smiler: ['THE DARK IS NOT ALWAYS THE DANGER.', '危ないのは、暗さのほうとは限らない。'],
  wretch: ['A SCREAM CAN BE A REQUEST.', '叫びは、頼みであることがある。'],
  faceling: ['THE RULE IS NOT THE ONE IN FRONT OF YOU.', '一般論は、目の前の一人のことではない。'],
  skin: ['DOUBT WHAT YOU SAW, NOT HOW THEY LOOK.', '疑うなら、見た目ではなく、見たことで。'],
  hound: ['DO NOT SHOW YOUR BACK TO WHAT YOU FEAR.', '怖いものに、背中を見せない。'],
  mahjong: ['NOT EVERYTHING NEEDS FINISHING.', '終わらせなくていいものもある。'],
  dark: ['THE THING IN THE DARK WAS AFRAID TOO.', '暗闇の何かも、怖がっていた。'],
  archive: ['WRITE WHAT YOU SAW.', '見たことを、書く。'],
  chair: ['LEAVE SOMETHING FOR THE NEXT ONE.', '次に来る人のために、置いていく。'],
  dive: ['BEYOND HERE, NO ONE HAS LOOKED.', 'ここから先は、まだ誰も見ていない。']
}
const CYAN = 0x00e5ff

Page({
  state: {},

  onInit() {
    const st = this.state
    st.canvas = new Canvas()
    st.mode = 'game' // game / verb / obj / obj2 / word
    st.verb = null
    st.obj1 = null
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
  },

  build() {
    this.render()
  },

  send(label, en) {
    const st = this.state
    st.mode = 'game'
    try {
      st.game.submit(label, en)
      const fx = st.game.fx()
      const f = fx.find(e => (e.type === 'verify' || e.type === 'end') && TRUISM[e.k])
      st.flash = f ? TRUISM[f.k] : null
      this.feel(fx)
    } catch (e) {
      st.error = (e && e.message) || String(e)
    }
    this.render()
  },

  // 出来事に合わせて振動する
  feel(fx) {
    if (!this.state.set.vibe) return
    const types = fx.map(e => e.type)
    if (types.includes('collapse')) { buzz(true); setTimeout(() => buzz(true), 300); return }
    if (types.includes('hurt')) { buzz(true); return }
    if (types.includes('verify') || types.includes('blackout') || types.includes('end')) buzz(false)
  },

  newGame() {
    const st = this.state
    st.mode = 'game'
    st.error = ''
    st.flash = null
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

  toggleVibe() {
    const st = this.state
    st.set.vibe = !st.set.vibe
    saveSettings(st.set)
    if (st.set.vibe) buzz(false)
    this.render()
  },

  // ---- 画面 ----
  render() {
    const st = this.state
    st.canvas.clear()
    const s = st.game && !st.error ? st.game.status() : null
    st.T = theme(s ? (s.blackout ? 'dark' : s.theme) : 't0')
    st.bg = st.canvas.add(hmUI.widget.FILL_RECT, { x: 0, y: 0, w: W, h: 480, color: st.T.bg })
    let y
    if (st.error) y = this.renderError()
    else if (st.mode === 'game') y = this.renderGame(s)
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
      cv.button((W - 240) / 2, y + 20, 240, 60, 'はじめから', () => this.newGame(), { color: T.faint, textColor: T.warn })
      y += 80
    }
    return y
  },

  // ネオンの二行。暗い帯の上に、水色と白で
  neon(y, pair) {
    const cv = this.state.canvas
    const h1 = textHeight(pair[0], 19, CW) + 4
    const h2 = textHeight(pair[1], 22, CW) + 4
    cv.add(hmUI.widget.FILL_RECT, { x: 0, y: y - 6, w: W, h: h1 + h2 + 18, color: 0x04080c })
    y = cv.text(y, pair[0], { size: 19, color: CYAN, center: true, gap: 2 })
    y = cv.text(y, pair[1], { size: 22, color: 0xffffff, center: true, gap: 14 })
    return y
  },

  renderGame(s) {
    const st = this.state
    const cv = st.canvas
    const T = st.T
    const g = st.game
    let y = 36
    y = cv.text(y, s.room, { size: 28, color: T.bright, center: true, gap: 0 })
    const info = [s.level + '　' + s.cls, '記録 ' + s.rec].concat(s.th ? [s.th] : []).concat(s.inj ? ['けが' + s.inj] : []).join('　')
    y = cv.text(y, info, { size: 20, color: s.hot || s.inj ? T.warn : T.dim, center: true, gap: 12 })
    for (const c of g.pastCommands(3)) y = cv.text(y, '> ' + c, { size: 20, color: T.dim, gap: 2 })
    y += 6
    if (st.flash) y = this.neon(y + 6, st.flash)
    for (const r of g.turn()) {
      if (r.t === 'gap') {
        y += 10
        continue
      }
      if (r.t === 'cmd') {
        y = cv.text(y, '> ' + r.ja, { size: 24, color: T.bright, gap: 8 })
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
      else if (cls === 'doc') { opt.color = T.bright; opt.size = 22; opt.indent = 10 }
      y = cv.text(y, r.ja, opt)
    }
    y += 12

    if (s.done) {
      cv.button((W - 260) / 2, y, 260, 64, 'はじめから', () => this.newGame(), { color: T.text, textColor: T.bg, size: 26 })
      return y + 64
    }

    cv.button((W - 300) / 2, y, 300, 70, '命令を作る', () => this.openBuilder(), { color: T.text, textColor: T.bg, size: 28, radius: 35 })
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
      const open = dir && s.exits.includes(dir)
      const color = !dir ? T.faint : open ? T.text : T.key
      const textColor = !dir ? T.bright : open ? T.bg : T.dim
      cv.button(bx, by, bw, bh, label, () => this.send(label, cmd), { color, textColor, size: 26 })
    })
    y += 3 * (bh + gap) + 6

    const cw = 170
    const cx = (W - (cw * 2 + gap)) / 2
    COMMON.forEach(([label, cmd], i) => {
      const bx = cx + (i % 2) * (cw + gap)
      const by = y + Math.floor(i / 2) * (bh + gap)
      cv.button(bx, by, cw, bh, label, () => this.send(label, cmd), { color: T.faint, textColor: T.text, size: 24 })
    })
    y += Math.ceil(COMMON.length / 2) * (bh + gap) + 10
    cv.button(cx, y, cw, 56, '振動：' + (st.set.vibe ? '入' : '切'), () => this.toggleVibe(), { color: T.faint, textColor: T.dim, size: 22 })
    cv.button(cx + cw + gap, y, cw, 56, 'はじめから', () => this.confirmNew(), { color: T.faint, textColor: T.warn, size: 22 })
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
    const titles = { verb: '何をする？', obj: '何を？', obj2: v && v[1].startsWith('give') ? '誰に？' : 'どこに？', word: '何と言う？' }
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
        cv.button(x0 + (i % 3) * (bw + gap), y + Math.floor(i / 3) * (bh + gap), bw, bh, label, fn, { color: T.faint, textColor: T.text, size: label.length > 4 ? 19 : 23, radius: 12 })
      })
      y += Math.ceil(items.length / 3) * (bh + gap) + 8
    } else {
      if (st.mode === 'word') {
        for (const w of g.wordsHere()) items.push(['「' + w.show + '」', () => this.send(`「${w.show}」と言う`, `say ${w.en}`)])
        if (!items.length) y = cv.text(y, '口にできることばが、思いつかない。', { size: 22, color: T.dim, center: true, gap: 10 })
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
        cv.button((W - bw) / 2, y, bw, bh, label, fn, { color: T.faint, textColor: T.text, size: label.length > 12 ? 19 : 22, radius: 12 })
        y += bh + 6
      })
      y += 6
    }
    cv.button((W - 200) / 2, y, 200, 56, '戻る', () => this.back(), { color: T.key, textColor: T.warn, size: 24 })
    return y + 56
  },

  pickVerb(v) {
    const st = this.state
    st.verb = v
    if (!v[1].includes('%')) {
      this.send(v[2], v[1])
      return
    }
    st.mode = v[1].startsWith('say') ? 'word' : 'obj'
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
