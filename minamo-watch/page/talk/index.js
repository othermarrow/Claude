import * as hmUI from '@zos/ui'
import { scrollTo } from '@zos/page'
import { setWakeUpRelaunch, setPageBrightTime } from '@zos/display'
import { BasePage } from '@zeppos/zml/base-page'
import { W, MARGIN, CW, Canvas, textHeight } from '../../shared/ui'
import { createTalk, GROUPS, labelOf } from '../../shared/talk'
import { startSense, stopSense, observe, clockText } from '../../shared/sense'
import { load, save } from '../../shared/store'
import { knock } from '../../shared/vibe'

// 色：ミナモの画面と同じ、暗い緑がかった黒。段階が進むと、文字が少しずつ白く冷たくなる
const BG = 0x0a0f0d
const TEXT = [0xcfe3d6, 0xd8ece0, 0xe6f2ea, 0xf4fbf6]
const DIM = 0x6b8578
const KEY = 0x13201b
const WARN = 0xd9826f
const TICK = 20000      // スマホのミナモに、手首の様子を送る間隔
const ASK_WAIT = 16000  // ボタンへの返事を、スマホの AI に頼んで待つ長さ（間に合わなければ、時計の返事）
const CLOCK_Y = 22, HEAD_Y = 54, BODY_Y = 90

Page(
  BasePage({
    state: {},

    onInit() {
      const st = this.state
      st.canvas = new Canvas()
      st.token = 0
      st.busy = false
      st.waiting = false
      st.ended = false
      st.gone = false
      st.idleT = 0
      st.idles = 0
      st.linked = false
      st.hist = []
      st.echoQ = []
      st.echoT = 0
      st.tickT = 0
      st.clockT = 0
      st.askId = 0
      st.sec = 0
      try { setWakeUpRelaunch({ relaunch: true }) } catch (e) { /* なくてもよい */ }
      try { setPageBrightTime({ brightTime: 60000 }) } catch (e) { /* なくてもよい */ }
      startSense()
      st.talk = createTalk(load())
      const greet = st.talk.start(observe())
      this.say(greet, false)
      // スマホのミナモ（Zepp アプリ → Termux のサーバー）につなぐ。つながらなくても、時計だけで話す
      setTimeout(() => { if (!st.gone) this.link('start', { said: greet }) }, 400)
      this.tick()
      this.clockTick()
    },

    onDestroy() {
      const st = this.state
      st.gone = true
      st.token++
      clearTimeout(st.idleT)
      clearTimeout(st.echoT)
      clearTimeout(st.tickT)
      clearTimeout(st.clockT)
      stopSense()
      if (!st.ended) { st.talk.end(observe()); save(st.talk.state) }   // 途中で閉じても、会ったことは覚えておく
    },

    // ---------- スマホのミナモとのつながり ----------
    link(ev, extra, timeout) {
      const st = this.state
      const params = Object.assign({ ev, obs: observe(), turn: st.talk.turn(), phase: st.talk.phase(),
        close: st.talk.close(), known: st.talk.known() }, extra || {})
      return this.request({ method: 'WATCH', params }, { timeout: timeout || 12000 })
        .then((r) => {
          const ok = !!(r && r.ok)
          this.setLinked(ok)
          if (ok && r.echo) this.queueEcho(r.echo)
          return ok ? r : null
        })
        .catch(() => { this.setLinked(false); return null })
    },
    tick() {
      const st = this.state
      clearTimeout(st.tickT)
      st.tickT = setTimeout(() => {
        if (st.gone) return
        this.link('tick')
        this.tick()
      }, TICK)
    },
    setLinked(ok) {
      const st = this.state
      if (ok === st.linked || st.gone) return
      st.linked = ok
      this.paintHead()
    },
    // スマホから漏れ出してきた言葉。読み終わるころ（打ち終わって 6 秒）に、割り込んでくる
    queueEcho(text) {
      const st = this.state
      st.echoQ.push(text)
      if (st.echoQ.length > 3) st.echoQ.shift()
      this.flushEcho()
    },
    flushEcho() {
      const st = this.state
      if (!st.echoQ.length || st.busy || st.ended || st.gone) return
      clearTimeout(st.echoT)
      st.echoT = setTimeout(() => {
        if (st.busy || st.ended || st.gone || !st.echoQ.length) return
        this.say(st.echoQ.shift(), true)
      }, 6000)
    },

    // ---------- 時計（yyyy/mm/dd hh:mm:ss）。侵食からは、ときどき、あの夜の時刻になる ----------
    clockTick() {
      const st = this.state
      if (st.gone) return
      const ph = st.talk.phase()
      let t = clockText()
      if (ph >= 2 && Math.random() < (ph === 3 ? 0.06 : 0.025)) t = '1999/12/31 23:59:59'
      try { if (st.clock) st.clock.setProperty(hmUI.prop.TEXT, t) } catch (e) { /* 消えた部品 */ }
      if (++st.sec % 5 === 0) this.paintHead()
      st.clockT = setTimeout(() => this.clockTick(), 1000)
    },

    // ---------- 画面 ----------
    headText() {
      const st = this.state, obs = observe()
      return `ミナモ ・ ${st.talk.phaseName()}` + (obs.hr ? `　♥ ${obs.hr}` : '') + (st.linked ? '　⇄' : '')
    },
    paintHead() {
      const st = this.state
      try { if (st.head) st.head.setProperty(hmUI.prop.TEXT, this.headText()) } catch (e) { /* 消えた部品 */ }
    },
    // ミナモが言ったこととして残し（スマホの AI に、前の流れを渡すため）、画面に出す
    say(text, knockIt) {
      const st = this.state
      st.hist.push(['m', text.replace(/\[間\]\s*/g, '')])
      if (st.hist.length > 12) st.hist.shift()
      st.talk.heard(text)
      this.show(text, knockIt)
    },
    // 画面を作り直して、ミナモの言葉を一文字ずつ出す。下に、組ごとのボタン（スクロールして選ぶ）
    show(text, knockIt) {
      const st = this.state, c = st.canvas, ph = st.talk.phase()
      c.clear()
      c.add(hmUI.widget.FILL_RECT, { x: 0, y: 0, w: W, h: 4000, color: BG })
      st.clock = c.add(hmUI.widget.TEXT, {
        x: MARGIN, y: CLOCK_Y, w: CW, h: 30, text: clockText(),
        text_size: 22, color: DIM, align_h: hmUI.align.CENTER_H
      })
      st.head = c.add(hmUI.widget.TEXT, {
        x: MARGIN, y: HEAD_Y, w: CW, h: 28, text: this.headText(),
        text_size: 20, color: DIM, align_h: hmUI.align.CENTER_H
      })
      const clean = text.replace(/\[間\]\s*/g, '')
      const h = textHeight(clean, 28, CW) + 10
      const body = c.add(hmUI.widget.TEXT, {
        x: MARGIN, y: BODY_Y, w: CW, h, text: '', text_size: 28, color: TEXT[ph], text_style: hmUI.text_style.WRAP
      })
      let y = BODY_Y + h + 16
      if (st.ended) y = this.endButtons(y)
      else y = this.replyButtons(y, ph)
      c.add(hmUI.widget.FILL_RECT, { x: 0, y, w: W, h: 140, color: BG })
      scrollTo({ y: 0 })
      if (knockIt) knock()
      this.type(body, text)
    },
    // 六つの組。長い言葉は一列に
    replyButtons(y, ph) {
      const c = this.state.canvas
      const bw = Math.floor((CW - 12) / 2), bh = 56
      for (const g of GROUPS) {
        c.add(hmUI.widget.TEXT, { x: MARGIN, y, w: CW, h: 26, text: `─ ${g.title} ─`, text_size: 18, color: DIM, align_h: hmUI.align.CENTER_H })
        y += 32
        let col = 0
        for (const [id, label] of g.items) {
          const wide = label.length >= 8
          if (wide && col) { col = 0; y += bh + 10 }
          const x = MARGIN + (wide ? 0 : col * (bw + 12))
          c.button(x, y, wide ? CW : bw, bh, label, () => this.tap(id), { color: KEY, size: label.length >= 7 ? 22 : 24, textColor: TEXT[ph] })
          if (wide || col === 1) { col = 0; y += bh + 10 } else col = 1
        }
        if (col) y += bh + 10
        y += 10
      }
      c.button(MARGIN + CW / 4, y, CW / 2, 52, '終わる', () => this.finish(), { color: 0x222222, size: 22, textColor: DIM })
      return y + 60
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
        if (pi >= parts.length) {
          st.busy = st.waiting
          if (!st.waiting) { this.armIdle(); this.flushEcho() }
          return
        }
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
        if (st.ended || st.busy || st.gone) return
        st.idles++
        const r = st.talk.idle(observe())
        this.say(r.text, r.pulse)
      }, 50000 + Math.floor(Math.random() * 30000))
    },

    tap(id) {
      const st = this.state
      if (st.busy || st.ended) return
      st.idles = 0
      clearTimeout(st.echoT)
      const r = st.talk.reply(id, observe())
      const label = labelOf(id)
      st.hist.push(['u', label])
      if (!st.linked) {
        // つながっていない：時計の返事のまま。押したことだけは、届けば届ける
        this.say(r.text, r.pulse)
        this.link('tap', { id, label, said: r.text })
        return
      }
      // つながっている：スマホの AI が考えるあいだ、「……」
      const ask = ++st.askId
      st.waiting = true
      this.show('……', false)
      this.link('tap', { id, label, want: 1, local: r.text, hint: r.hint, history: st.hist.slice(-6) }, ASK_WAIT).then((res) => {
        if (ask !== st.askId || st.ended || st.gone) return
        st.waiting = false
        st.busy = false
        this.say(res && res.say ? res.say : r.text, r.pulse)
      })
    },

    finish() {
      const st = this.state
      if (st.ended) return
      st.ended = true
      st.waiting = false
      st.askId++
      clearTimeout(st.idleT)
      clearTimeout(st.echoT)
      const line = st.talk.end(observe())
      save(st.talk.state)
      this.link('end', { said: line })
      this.show(line, false)
    },

    endButtons(y) {
      const st = this.state, c = st.canvas
      c.add(hmUI.widget.TEXT, {
        x: MARGIN, y, w: CW, h: 34,
        text: `記録しました（${st.talk.state.turns} 回）` + (st.linked ? '・スマホにも' : ''),
        text_size: 20, color: DIM, align_h: hmUI.align.CENTER_H
      })
      y += 44
      c.button(MARGIN + CW / 6, y, (CW * 2) / 3, 56, 'もう一度、話す', () => {
        st.ended = false; st.idles = 0; st.hist = []
        st.talk = createTalk(st.talk.state)
        const greet = st.talk.start(observe())
        this.say(greet, false)
        this.link('start', { said: greet })
      }, { color: KEY, size: 24, textColor: WARN })
      return y + 66
    }
  })
)
