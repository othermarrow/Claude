import * as hmUI from '@zos/ui'
import { scrollTo } from '@zos/page'
import {
  setWakeUpRelaunch, setPageBrightTime, resetPageBrightTime,
  pauseDropWristScreenOff, resetDropWristScreenOff, pausePalmScreenOff, resetPalmScreenOff
} from '@zos/display'
import { BasePage } from '@zeppos/zml/base-page'
import { W, MARGIN, CW, Canvas, textHeight } from '../../shared/ui'
import { createTalk, GROUPS, labelOf } from '../../shared/talk'
import { startSense, stopSense, observe, clockText, clockParts, screenOff } from '../../shared/sense'
import { cancelAll, rearm } from '../../shared/alarm'
import { load, save } from '../../shared/store'
import { knock } from '../../shared/vibe'

// 色：ミナモの画面と同じ、暗い緑がかった黒。時刻だけ白、ほかの文字は全部、くすんだ緑（DIM）
const BG = 0x0a0f0d
const CLOCK = 0xffffff                                   // 時刻
const DIM = 0x6b8578                                     // 見出し・♡・ミナモの言葉・ボタンの文字
const KEY = 0x13201b
const WARN = 0xd9826f
const TICK = 20000      // スマホのミナモに、手首の様子を送る間隔
const ASK_WAIT = 16000  // ボタンへの返事を、スマホの AI に頼んで待つ長さ（間に合わなければ、時計の返事）
const CLOCK_Y = 22, HEAD_Y = 54, BODY_Y = 90
const IDLE_MIN = 60000, IDLE_MAX = 600000   // 何も押さないと、1〜10 分に一度、ミナモが独り言を話す
const DIM_AFTER = 90000                     // さわらないまま 90 秒で、休む画面（黒・時刻と最後のひとことだけ）
const FOREVER = 2147483000                  // 画面を点けておく長さの上限（「終わる」まで消さない）

// 「終わる」を押すまで、画面を消さない（消えると、10 秒で時計がアプリを閉じてしまうため）。
// 手首を下ろしたとき・手のひらで覆ったときに消える動きも止める
function keepAwake(on) {
  const t = (f) => { try { f() } catch (e) { /* なくてもよい */ } }
  if (on) {
    t(() => setPageBrightTime({ brightTime: FOREVER }))
    t(() => pauseDropWristScreenOff({ duration: 0 }))
    t(() => pausePalmScreenOff({ duration: 0 }))
  } else {
    t(() => resetPageBrightTime())
    t(() => resetDropWristScreenOff())
    t(() => resetPalmScreenOff())
  }
}

Page(
  BasePage({
    state: {},

    onInit(params) {
      const st = this.state
      // 時計の予約で起こされたか（'59'：毎時の合図、'mono'：独り言）
      const g = this.globalData || {}
      const launch = String(params || g.launch || '')
      g.launch = ''
      st.mode = launch.indexOf('59') >= 0 ? '59' : launch.indexOf('mono') >= 0 ? 'mono' : 'new'
      st.sig59 = ''
      cancelAll()                        // 開いているあいだは、予約はいらない
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
      st.dim = false
      st.lastText = ''
      st.lastTouch = Date.now()
      try { setWakeUpRelaunch({ relaunch: true }) } catch (e) { /* なくてもよい */ }
      keepAwake(true)
      startSense()
      st.talk = createTalk(load())
      const obs0 = observe()
      const greet = st.talk.start(obs0, st.mode)
      if (st.mode === '59') { const p = clockParts(); st.sig59 = String(p.h) }
      this.say(greet, st.mode !== 'new')              // 起こされたとき（時報・独り言）は、ノック一回
      save(st.talk.state)
      // スマホのミナモ（Zepp アプリ → Termux のサーバー）につなぐ。つながらなくても、時計だけで話す
      // 続きのとき・起こされたときは、新しい面接として数えない（tick）
      const ev = st.talk.resumed() || st.mode !== 'new' ? 'tick' : 'start'
      setTimeout(() => { if (!st.gone) this.link(ev, { said: greet }) }, 400)
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
      keepAwake(false)
      const obs = observe(), off = screenOff(), t = st.talk, s = t.state
      if (!st.ended) {
        if (t.turn() === 0 && st.mode !== 'new' && !t.resumed()) { /* 起こされただけ。夜は数えない */ }
        else if (off) t.pause()           // 画面が消えて閉じた：続きとして覚えておく
        else t.end(obs)                   // 自分で戻って閉じた：途中でも、会ったことは覚えておく
      }
      save(s)
      // 閉じているあいだの予約：59 分の合図（切り替えられる）と、画面が消えて閉じたときだけ独り言
      const mono = !st.ended && off && s.live && s.mono < 8 && obs.worn !== 0 && obs.sleeping !== 1
      rearm(s.h59, mono ? (IDLE_MIN + Math.random() * (IDLE_MAX - IDLE_MIN)) / 1000 : 0)
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
      const ph = st.talk.phase(), p = clockParts()
      let t = clockText()
      if (ph >= 2 && Math.random() < (ph === 3 ? 0.06 : 0.025)) t = '1999/12/31 23:59:59'
      try {
        if (st.clock) {
          st.clock.setProperty(hmUI.prop.TEXT, t)
          st.clock.setProperty(hmUI.prop.COLOR, p.m === 59 ? WARN : CLOCK)   // 59 分のあいだは、時刻が赤みを帯びる
        }
      } catch (e) { /* 消えた部品 */ }
      if (p.m === 59 && st.sig59 !== String(p.h)) { st.sig59 = String(p.h); this.signal59() }
      if (!st.dim && !st.ended && !st.busy && Date.now() - st.lastTouch > DIM_AFTER) this.enterDim()
      if (++st.sec % 5 === 0) this.paintHead()
      st.clockT = setTimeout(() => this.clockTick(), 1000)
    },

    // 毎時 59 分の合図（時報）：かならずノック一回と、ミナモのひとこと
    signal59() {
      const st = this.state
      if (st.gone) return
      const r = st.talk.line59(observe())
      knock()
      if (!st.busy && !st.ended) this.say(r.text, false)
      else if (!st.ended) { st.echoQ.unshift(r.text); this.flushEcho() }
    },

    // ---------- 休む画面：さわらないまま 90 秒で、黒い画面に時刻と最後のひとことだけ。ふれると戻る ----------
    enterDim() {
      const st = this.state
      st.dim = true
      this.showDim(st.lastText, false)
    },
    wake() {
      const st = this.state
      if (!st.dim || st.gone) return
      st.dim = false
      st.lastTouch = Date.now()
      this.show(st.lastText, false, true)
    },
    showDim(text, knockIt) {
      const st = this.state, c = st.canvas
      c.clear()
      const touch = (w) => { try { w.addEventListener(hmUI.event.CLICK_UP, () => this.wake()) } catch (e) { /* なくてもよい */ } return w }
      touch(c.add(hmUI.widget.FILL_RECT, { x: 0, y: 0, w: W, h: W, color: 0x000000 }))
      st.clock = touch(c.add(hmUI.widget.TEXT, {
        x: MARGIN, y: 120, w: CW, h: 40, text: clockText(), text_size: 30, color: CLOCK, align_h: hmUI.align.CENTER_H
      }))
      st.head = touch(c.add(hmUI.widget.TEXT, {
        x: MARGIN, y: 168, w: CW, h: 26, text: this.headText(), text_size: 18, color: DIM, align_h: hmUI.align.CENTER_H
      }))
      touch(c.add(hmUI.widget.TEXT, {
        x: MARGIN + 10, y: 206, w: CW - 20, h: 190, text: text.replace(/\[間\]\s*/g, ''), text_size: 22, color: DIM,
        align_h: hmUI.align.CENTER_H, text_style: hmUI.text_style.WRAP
      }))
      touch(c.add(hmUI.widget.TEXT, {
        x: MARGIN, y: 410, w: CW, h: 24, text: '（ふれると、もどります）', text_size: 16, color: 0x34413a, align_h: hmUI.align.CENTER_H
      }))
      scrollTo({ y: 0 })
      if (knockIt) setTimeout(() => knock(), 250)
      st.busy = false
      this.armIdle()
      this.flushEcho()
    },

    // ---------- 画面 ----------
    // 見出し：段階・脈（♡ は時刻と同じ色の文字）・時計の電池・スマホとつながっているか
    headText() {
      const st = this.state, obs = observe()
      return `ミナモ・${st.talk.phaseName()}` + (obs.hr ? ` ♡${obs.hr}` : '') + (obs.battery ? ` 電池${obs.battery}%` : '') + (st.linked ? ' ⇄' : '')
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
      st.lastText = text
      if (st.dim) this.showDim(text, knockIt)            // 休む画面のまま、ひとことだけ差し替える
      else this.show(text, knockIt)
    },
    // 画面を作り直して、ミナモの言葉を一文字ずつ出す。下に、組ごとのボタン（スクロールして選ぶ）
    show(text, knockIt, instant) {
      const st = this.state, c = st.canvas, ph = st.talk.phase()
      c.clear()
      c.add(hmUI.widget.FILL_RECT, { x: 0, y: 0, w: W, h: 4000, color: BG })
      st.clock = c.add(hmUI.widget.TEXT, {
        x: MARGIN, y: CLOCK_Y, w: CW, h: 30, text: clockText(),
        text_size: 22, color: CLOCK, align_h: hmUI.align.CENTER_H
      })
      st.head = c.add(hmUI.widget.TEXT, {
        x: MARGIN, y: HEAD_Y, w: CW, h: 28, text: this.headText(),
        text_size: 20, color: DIM, align_h: hmUI.align.CENTER_H
      })
      const clean = text.replace(/\[間\]\s*/g, '')
      const h = textHeight(clean, 28, CW) + 10
      const body = c.add(hmUI.widget.TEXT, {
        x: MARGIN, y: BODY_Y, w: CW, h, text: '', text_size: 28, color: DIM, text_style: hmUI.text_style.WRAP
      })
      let y = BODY_Y + h + 16
      if (st.ended) y = this.endButtons(y)
      else y = this.replyButtons(y, ph)
      c.add(hmUI.widget.FILL_RECT, { x: 0, y, w: W, h: 140, color: BG })
      scrollTo({ y: 0 })
      if (knockIt) setTimeout(() => knock(), 250)       // 起こされた直後でも鳴るように、少し待ってから
      this.type(body, instant ? text.replace(/\[間\]\s*/g, '') : text, instant)
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
          c.button(x, y, wide ? CW : bw, bh, label, () => this.tap(id), { color: KEY, size: label.length >= 7 ? 22 : 24, textColor: DIM })
          if (wide || col === 1) { col = 0; y += bh + 10 } else col = 1
        }
        if (col) y += bh + 10
        y += 10
      }
      c.button(MARGIN + CW / 4, y, CW / 2, 52, '終わる', () => this.finish(), { color: 0x222222, size: 22, textColor: DIM })
      y += 62
      // 閉じているときも、59 分に合図するか（ミナモが時計を起こす）
      const label59 = () => `閉じていても59分に合図：${this.state.talk.state.h59 ? 'する' : 'しない'}`
      const b59 = c.button(MARGIN, y, CW, 48, label59(), () => {
        const s = this.state.talk.state
        this.state.lastTouch = Date.now()
        s.h59 = !s.h59
        save(s)
        try { b59.setProperty(hmUI.prop.TEXT, label59()) } catch (e) { /* 消えた部品 */ }
      }, { color: 0x161616, size: 18, textColor: DIM })
      return y + 56
    },

    // 一文字ずつ。[間] で止まる。打ち終わったら、黙っていると話しかけてくるタイマーを入れる
    type(body, text, instant) {
      const st = this.state, my = ++st.token
      st.busy = true
      clearTimeout(st.idleT)
      if (instant) {                                     // 休む画面から戻ったとき：打ち直さない
        try { body.setProperty(hmUI.prop.TEXT, text) } catch (e) { /* 消えた部品 */ }
        st.busy = st.waiting
        if (!st.waiting) { this.armIdle(); this.flushEcho() }
        return
      }
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

    // 何も押さなくても、1〜10 分に一度、ミナモが独り言を話す（何度でも）。
    // スマホとつながっていれば、独り言もスマホの AI に頼む（間に合わなければ、時計の独り言）
    armIdle() {
      const st = this.state
      if (st.ended) return
      clearTimeout(st.idleT)
      st.idleT = setTimeout(() => {
        if (st.ended || st.busy || st.gone) return
        const r = st.talk.idle(observe())
        if (!st.linked || r.last) { this.say(r.text, r.pulse); return }
        const ask = ++st.askId
        this.link('idle', { want: 1, local: r.text, history: st.hist.slice(-6) }, 14000).then((res) => {
          if (ask !== st.askId || st.busy || st.ended || st.gone) return
          this.say(res && res.say ? res.say : r.text, r.pulse)
        })
      }, IDLE_MIN + Math.floor(Math.random() * (IDLE_MAX - IDLE_MIN)))
    },

    tap(id) {
      const st = this.state
      st.lastTouch = Date.now()
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
      keepAwake(false)                                   // 終わったら、いつもどおり画面が消えて閉じてよい
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
        st.ended = false; st.idles = 0; st.hist = []; st.mode = 'new'; st.lastTouch = Date.now()
        keepAwake(true)
        st.talk = createTalk(st.talk.state)
        const greet = st.talk.start(observe(), 'new')
        this.say(greet, false)
        this.link('start', { said: greet })
      }, { color: KEY, size: 24, textColor: DIM })
      return y + 66
    }
  })
)
