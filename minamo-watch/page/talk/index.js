import * as hmUI from '@zos/ui'
import { scrollTo } from '@zos/page'
import {
  setWakeUpRelaunch, setPageBrightTime, resetPageBrightTime,
  pauseDropWristScreenOff, resetDropWristScreenOff, pausePalmScreenOff, resetPalmScreenOff
} from '@zos/display'
import { BasePage } from '@zeppos/zml/base-page'
import { W, MARGIN, CW, Canvas, textHeight } from '../../shared/ui'
import { createTalk, GROUPS, labelOf } from '../../shared/talk'
import { startSense, stopSense, observe, clockLines, clockParts, screenOff } from '../../shared/sense'
import { cancelAll, rearm } from '../../shared/alarm'
import { load, save } from '../../shared/store'
import { knock } from '../../shared/vibe'

// minamo（面接室のミナモ・掲示板の水面とは別の、手首の上の小さな子）と、ときどき nagi（男の子）が話す画面。
// 色：暗い緑がかった黒。時刻だけ白、ほかの文字は全部、くすんだ緑（DIM）。nagi の言葉だけ、くすんだ青（NAGI）
const BG = 0x0a0f0d
const CLOCK = 0xffffff                                   // 時刻
const DIM = 0x6b8578                                     // 見出し・♡・minamo の言葉・ボタンの文字
const NAGI = 0x6a8aa3                                    // nagi の言葉と見出し
const KEY = 0x13201b
const WARN = 0xd9826f
const TICK = 20000      // スマホのミナモ（mo）に、手首の様子を送る間隔
const ASK_WAIT = 16000  // ボタンへの返事を、スマホの AI に頼んで待つ長さ（間に合わなければ、時計の返事）
// 上から：日付と曜日（小さめ）・時刻（大きく）・見出し・minamo（か nagi）の言葉
const DATE_Y = 14, TIME_Y = 40, HEAD_Y = 104, BODY_Y = 140
const IDLE_MIN = 60000, IDLE_MAX = 300000   // 何も押さないと、1〜5 分に一度、minamo が独り言を話す（5 分は空けない）
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

    // 起動で止まったら、真っ暗のままにせず、理由を画面に出す（1.6.0 で、時計が真っ暗になった報告があったため）。
    // 保存が原因かもしれないので、一度だけ、保存を使わずに開き直す
    onInit(params) {
      try { this.init(params, false) } catch (e) {
        console.log('minamo onInit error: ' + ((e && e.stack) || e))
        try { this.init(params, true) } catch (e2) { this.fatal(e, e2) }
      }
    },
    fatal(e, e2) {
      const msg = (x) => String((x && (x.stack || x.message)) || x).slice(0, 260)
      try {
        hmUI.createWidget(hmUI.widget.FILL_RECT, { x: 0, y: 0, w: W, h: W, color: 0x000000 })
        hmUI.createWidget(hmUI.widget.TEXT, {
          x: 30, y: 60, w: W - 60, h: W - 100, color: WARN, text_size: 20, text_style: hmUI.text_style.WRAP,
          text: 'minamo：起動できませんでした。この画面を Claude に見せてください。\n' + msg(e) + (e2 ? '\n---\n' + msg(e2) : '')
        })
      } catch (x) { /* 描けなければ、どうにもならない */ }
    },

    init(params, fresh) {
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
      st.who = 'minamo'                  // いま画面で話しているのは、minamo か nagi か
      st.booted = false                  // スマホのサーバーが起きたあいさつを、この画面で言ったか
      st.lastTouch = Date.now()
      try { setWakeUpRelaunch({ relaunch: true }) } catch (e) { /* なくてもよい */ }
      keepAwake(true)
      startSense()
      st.talk = createTalk(fresh ? null : load())
      const obs0 = observe()
      const greet = st.talk.start(obs0, st.mode)
      if (st.mode === '59') { const p = clockParts(); st.sig59 = String(p.h) }
      this.say(greet, st.mode !== 'new')              // 起こされたとき（時報・独り言）は、ノック一回
      save(st.talk.state)
      // スマホのミナモ（Zepp アプリ → Termux のサーバー mo）につなぐ。つながらなくても、時計だけで話す
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

    // ---------- スマホのミナモ（mo）とのつながり ----------
    // 届かなかったあいだに押したボタン（away）は、つながったときにまとめて渡す。
    // サーバーが起きてから初めてつながったときは、boot が返ってくる（minamo が、ひとこと言う）
    link(ev, extra, timeout) {
      const st = this.state
      const away = st.talk.awayList()
      const params = Object.assign({ ev, obs: observe(), turn: st.talk.turn(), phase: st.talk.phase(),
        close: st.talk.close(), known: st.talk.known(), days: st.talk.days() }, away.length ? { away } : {}, extra || {})
      return this.request({ method: 'WATCH', params }, { timeout: timeout || 12000 })
        .then((r) => {
          const ok = !!(r && r.ok)
          this.setLinked(ok)
          if (ok) {
            const got = Number(r.away_got) || 0
            if (got) { st.talk.dropAway(got); save(st.talk.state) }
            if (r.boot && !st.booted) { st.booted = true; this.queueEcho(st.talk.boot(r.boot, got), 'minamo', true) }
            if (r.echo) this.queueEcho(r.echo, r.echo_who === 'nagi' ? 'nagi' : 'minamo')
          }
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
    // スマホから漏れ出してきた言葉・nagi のひとこと・起動のあいさつ。読み終わるころ（打ち終わって 6 秒）に、割り込んでくる
    // first：列のいちばん前に入れる（起動のあいさつ）
    queueEcho(text, who, first) {
      const st = this.state
      if (!text) return
      const item = { text, who: who === 'nagi' ? 'nagi' : 'minamo' }
      if (first) st.echoQ.unshift(item); else st.echoQ.push(item)
      if (st.echoQ.length > 3) st.echoQ.pop()
      this.flushEcho()
    },
    flushEcho() {
      const st = this.state
      if (!st.echoQ.length || st.busy || st.ended || st.gone) return
      clearTimeout(st.echoT)
      st.echoT = setTimeout(() => {
        if (st.busy || st.ended || st.gone || !st.echoQ.length) return
        const it = st.echoQ.shift()
        this.say(it.text, true, it.who)
      }, st.echoQ.length && st.echoQ[0].who === 'nagi' ? 4000 : 6000)
    },

    // ---------- 時計（一行目 yyyy/mm/dd（曜）、二行目 hh:mm:ss）。侵食からは、ときどき、あの夜の時刻になる ----------
    clockTick() {
      const st = this.state
      if (st.gone) return
      const ph = st.talk.phase(), p = clockParts()
      let t = clockLines()
      if (ph >= 2 && Math.random() < (ph === 3 ? 0.06 : 0.025)) t = { date: '1999/12/31（金）', time: '23:59:59' }
      try {
        if (st.dateW) st.dateW.setProperty(hmUI.prop.TEXT, t.date)
        if (st.timeW) {
          st.timeW.setProperty(hmUI.prop.TEXT, t.time)
          st.timeW.setProperty(hmUI.prop.COLOR, p.m === 59 ? WARN : CLOCK)   // 59 分のあいだは、時刻が赤みを帯びる
        }
      } catch (e) { /* 消えた部品 */ }
      if (p.m === 59 && st.sig59 !== String(p.h)) { st.sig59 = String(p.h); this.signal59() }
      if (!st.dim && !st.ended && !st.busy && Date.now() - st.lastTouch > DIM_AFTER) this.enterDim()
      if (++st.sec % 5 === 0) this.paintHead()
      st.clockT = setTimeout(() => this.clockTick(), 1000)
    },

    // 毎時 59 分の合図（時報）：かならずノック一回と、minamo のひとこと（深夜は、nagi がつけ足すことがある）
    signal59() {
      const st = this.state
      if (st.gone) return
      const r = st.talk.line59(observe())
      knock()
      if (!st.busy && !st.ended) this.say(r.text, false)
      else if (!st.ended) this.queueEcho(r.text, 'minamo', true)
      if (r.nagi && !st.ended) this.queueEcho(r.nagi, 'nagi')
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
      const t = clockLines()
      st.dateW = touch(c.add(hmUI.widget.TEXT, {
        x: MARGIN, y: 92, w: CW, h: 32, text: t.date, text_size: 24, color: CLOCK, align_h: hmUI.align.CENTER_H
      }))
      st.timeW = touch(c.add(hmUI.widget.TEXT, {
        x: MARGIN, y: 122, w: CW, h: 74, text: t.time, text_size: 62, color: CLOCK, align_h: hmUI.align.CENTER_H
      }))
      const col = st.who === 'nagi' ? NAGI : DIM
      st.head = touch(c.add(hmUI.widget.TEXT, {
        x: MARGIN, y: 200, w: CW, h: 26, text: this.headText(), text_size: 18, color: col, align_h: hmUI.align.CENTER_H
      }))
      touch(c.add(hmUI.widget.TEXT, {
        x: MARGIN + 10, y: 236, w: CW - 20, h: 166, text: text.replace(/\[間\]\s*/g, ''), text_size: 22, color: col,
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
    // 見出し：いま話している子（minamo か nagi）・段階・脈・時計の電池・スマホとつながっているか
    headText() {
      const st = this.state, obs = observe()
      if (st.who === 'nagi') return 'nagi' + (st.linked ? ' ⇄' : '')
      return `minamo・${st.talk.phaseName()}` + (obs.hr ? ` ♡${obs.hr}` : '') + (obs.battery ? ` 電池${obs.battery}%` : '') + (st.linked ? ' ⇄' : '')
    },
    paintHead() {
      const st = this.state
      try { if (st.head) st.head.setProperty(hmUI.prop.TEXT, this.headText()) } catch (e) { /* 消えた部品 */ }
    },
    // minamo（か nagi）が言ったこととして残し（スマホの AI に、前の流れを渡すため）、画面に出す
    say(text, knockIt, who) {
      const st = this.state
      st.who = who === 'nagi' ? 'nagi' : 'minamo'
      st.hist.push([st.who === 'nagi' ? 'n' : 'm', text.replace(/\[間\]\s*/g, '')])
      if (st.hist.length > 12) st.hist.shift()
      if (st.who === 'minamo') st.talk.heard(text)
      st.lastText = text
      if (st.dim) this.showDim(text, knockIt)            // 休む画面のまま、ひとことだけ差し替える
      else this.show(text, knockIt)
    },
    // 画面を作り直して、minamo（か nagi）の言葉を一文字ずつ出す。下に、組ごとのボタン（スクロールして選ぶ）
    show(text, knockIt, instant) {
      const st = this.state, c = st.canvas, ph = st.talk.phase()
      c.clear()
      c.add(hmUI.widget.FILL_RECT, { x: 0, y: 0, w: W, h: 4000, color: BG })
      const t = clockLines()
      st.dateW = c.add(hmUI.widget.TEXT, {
        x: MARGIN, y: DATE_Y, w: CW, h: 28, text: t.date, text_size: 22, color: CLOCK, align_h: hmUI.align.CENTER_H
      })
      st.timeW = c.add(hmUI.widget.TEXT, {
        x: MARGIN, y: TIME_Y, w: CW, h: 60, text: t.time, text_size: 50, color: CLOCK, align_h: hmUI.align.CENTER_H
      })
      const col = st.who === 'nagi' ? NAGI : DIM
      st.head = c.add(hmUI.widget.TEXT, {
        x: MARGIN, y: HEAD_Y, w: CW, h: 28, text: this.headText(),
        text_size: 20, color: col, align_h: hmUI.align.CENTER_H
      })
      const clean = text.replace(/\[間\]\s*/g, '')
      const h = textHeight(clean, 28, CW) + 10
      const body = c.add(hmUI.widget.TEXT, {
        x: MARGIN, y: BODY_Y, w: CW, h, text: '', text_size: 28, color: col, text_style: hmUI.text_style.WRAP
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
      // 閉じているときも、59 分に合図するか（minamo が時計を起こす）
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

    // 何も押さなくても、1〜5 分に一度、minamo が独り言を話す（何度でも）。外しているとき・深夜は、nagi がつけ足すことがある。
    // スマホとつながっていれば、独り言もスマホの AI に頼む（間に合わなければ、時計の独り言）
    armIdle() {
      const st = this.state
      if (st.ended) return
      clearTimeout(st.idleT)
      st.idleT = setTimeout(() => {
        if (st.ended || st.busy || st.gone) return
        const r = st.talk.idle(observe())
        // 読み上げ（数字をならべたもの）は、時計の言葉のまま。それ以外は、つながっていればスマホの AI に頼む
        if (!st.linked || r.last || r.kind === 'readout') { this.say(r.text, r.pulse); if (r.nagi) this.queueEcho(r.nagi, 'nagi'); return }
        const ask = ++st.askId
        this.link('idle', { want: 1, local: r.text, history: st.hist.slice(-6) }, 14000).then((res) => {
          if (ask !== st.askId || st.busy || st.ended || st.gone) return
          this.say(res && res.say ? res.say : r.text, r.pulse)
          if (r.nagi) this.queueEcho(r.nagi, 'nagi')
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
        // つながっていない：時計の返事のまま。押したことは取っておき、スマホに届いたときにまとめて渡す
        this.say(r.text, r.pulse)
        if (r.nagi) this.queueEcho(r.nagi, 'nagi')
        st.talk.keepAway(id, label)
        save(st.talk.state)
        this.link('tick', { said: r.text })
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
        if (!res) { st.talk.keepAway(id, label); save(st.talk.state) }   // 届かなかった：あとで、まとめて渡す
        this.say(res && res.say ? res.say : r.text, r.pulse)
        if (r.nagi) this.queueEcho(r.nagi, 'nagi')
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
      y += 66
      // はじめから：時計の記録（会った回数・ゆめ・近さ・十三人目・生まれた日）を消して、初めて会うところから。二度押す
      let sure = false
      const rb = c.button(MARGIN + CW / 6, y, (CW * 2) / 3, 50, 'はじめから', () => {
        st.lastTouch = Date.now()
        if (!sure) {
          sure = true
          try { rb.setProperty(hmUI.prop.TEXT, 'もう一度押すと消えます') } catch (e) { /* 消えた部品 */ }
          return
        }
        save({ h59: st.talk.state.h59 })
        st.ended = false; st.idles = 0; st.hist = []; st.mode = 'new'; st.booted = false
        keepAwake(true)
        st.talk = createTalk(load())
        const greet = st.talk.start(observe(), 'new')
        save(st.talk.state)
        this.say(greet, false)
        this.link('start', { said: greet })
      }, { color: 0x221414, size: 20, textColor: WARN })
      return y + 60
    }
  })
)
