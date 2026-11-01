import * as hmUI from '@zos/ui'
import { scrollTo } from '@zos/page'
import { setWakeUpRelaunch, setPageBrightTime } from '@zos/display'
import { W, MARGIN, CW, Canvas, textHeight } from '../../shared/ui'
import { createTalk, REPLIES } from '../../shared/talk'
import { startSense, observe } from '../../shared/sense'
import { load, save } from '../../shared/store'
import { buzz, pulse } from '../../shared/vibe'

// 色：ミナモの画面と同じ、暗い緑がかった黒。段階が進むと、文字が少しずつ白く冷たくなる
const BG = 0x0a0f0d
const TEXT = [0xcfe3d6, 0xd8ece0, 0xe6f2ea, 0xf4fbf6]
const DIM = 0x6b8578
const KEY = 0x13201b
const WARN = 0xd9826f

Page({
  state: {},

  onInit() {
    const st = this.state
    st.canvas = new Canvas()
    st.token = 0
    st.busy = false
    st.ended = false
    st.idleT = 0
    st.idles = 0
    try { setWakeUpRelaunch({ relaunch: true }) } catch (e) { /* なくてもよい */ }
    try { setPageBrightTime({ brightTime: 60000 }) } catch (e) { /* なくてもよい */ }
    startSense()
    st.talk = createTalk(load())
    this.show(st.talk.start(observe()), false)
  },

  onDestroy() {
    const st = this.state
    st.token++
    clearTimeout(st.idleT)
    if (!st.ended) { st.talk.end(observe()); save(st.talk.state) }   // 途中で閉じても、会ったことは覚えておく
  },

  // 画面を作り直して、ミナモの言葉を一文字ずつ出す
  show(text, pulseIt) {
    const st = this.state, c = st.canvas, ph = st.talk.phase(), obs = observe()
    c.clear()
    c.add(hmUI.widget.FILL_RECT, { x: 0, y: 0, w: W, h: 2000, color: BG })
    c.add(hmUI.widget.TEXT, {
      x: MARGIN, y: 40, w: CW, h: 30, text: `ミナモ ・ ${st.talk.phaseName()}` + (obs.hr ? `　♥ ${obs.hr}` : ''),
      text_size: 20, color: DIM, align_h: hmUI.align.CENTER_H
    })
    const clean = text.replace(/\[間\]\s*/g, '')
    const h = textHeight(clean, 28, CW) + 10
    const body = c.add(hmUI.widget.TEXT, {
      x: MARGIN, y: 80, w: CW, h, text: '', text_size: 28, color: TEXT[ph], text_style: hmUI.text_style.WRAP
    })
    let y = 80 + h + 16
    if (st.ended) {
      y = this.endButtons(y)
    } else {
      const bw = Math.floor((CW - 12) / 2), bh = 62
      REPLIES.forEach((r, i) => {
        const x = MARGIN + (i % 2) * (bw + 12), yy = y + Math.floor(i / 2) * (bh + 10)
        c.button(x, yy, bw, bh, r.label, () => this.tap(r.id), { color: KEY, size: 26, textColor: TEXT[ph] })
      })
      y += 3 * (bh + 10) + 6
      c.button(MARGIN + CW / 4, y, CW / 2, 52, '終わる', () => this.finish(), { color: 0x222222, size: 22, textColor: DIM })
      y += 60
    }
    c.add(hmUI.widget.FILL_RECT, { x: 0, y, w: W, h: 120, color: BG })
    scrollTo({ y: 0 })
    if (pulseIt) pulse()
    this.type(body, text)
  },

  // 一文字ずつ。[間] で止まる。打ち終わったら、黙っていると話しかけてくるタイマーを入れる
  type(body, text) {
    const st = this.state, my = ++st.token
    st.busy = true
    clearTimeout(st.idleT)
    const parts = text.split(/(\[間\])/)
    let shown = '', pi = 0, ci = 0
    const step = () => {
      if (my !== st.token) return
      if (pi >= parts.length) { st.busy = false; this.armIdle(); return }
      const part = parts[pi]
      if (part === '[間]') { pi++; ci = 0; setTimeout(step, 1100); return }
      if (ci >= part.length) { pi++; ci = 0; setTimeout(step, 10); return }
      const ch = part[ci++]
      shown += ch
      try { body.setProperty(hmUI.prop.TEXT, shown) } catch (e) { /* 消えた部品 */ }
      setTimeout(step, '。、…'.includes(ch) ? 140 : 45)
    }
    step()
  },

  armIdle() {
    const st = this.state
    if (st.ended || st.idles >= 3) return
    clearTimeout(st.idleT)
    st.idleT = setTimeout(() => {
      if (st.ended || st.busy) return
      st.idles++
      const r = st.talk.idle(observe())
      this.show(r.text, r.pulse)
    }, 50000 + Math.floor(Math.random() * 30000))
  },

  tap(id) {
    const st = this.state
    if (st.busy || st.ended) return
    st.idles = 0
    buzz(false)
    const r = st.talk.reply(id, observe())
    this.show(r.text, r.pulse)
  },

  finish() {
    const st = this.state
    if (st.ended) return
    st.ended = true
    clearTimeout(st.idleT)
    const line = st.talk.end(observe())
    save(st.talk.state)
    buzz(true)
    this.show(line, false)
  },

  endButtons(y) {
    const st = this.state, c = st.canvas
    c.add(hmUI.widget.TEXT, {
      x: MARGIN, y, w: CW, h: 34, text: `記録しました（${st.talk.state.turns} 回）`,
      text_size: 20, color: DIM, align_h: hmUI.align.CENTER_H
    })
    y += 44
    c.button(MARGIN + CW / 6, y, (CW * 2) / 3, 56, 'もう一度、話す', () => {
      st.ended = false; st.idles = 0
      st.talk = createTalk(st.talk.state)
      this.show(st.talk.start(observe()), false)
    }, { color: KEY, size: 24, textColor: WARN })
    return y + 66
  }
})
