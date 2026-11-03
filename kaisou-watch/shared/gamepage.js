// ゲームの画面（どのゲームも同じ作り）。ゲームごとの違いは cfg で渡す。
//   cfg.id        保存のファイル名の頭
//   cfg.createGame ゲーム本体（shared/engines/*.js）
//   cfg.theme(s)  状態から、配色（themes.js の [背景, 文字, 明るい文字, 薄い文字, 枠, 方角キー, 警告]）を返す
//   cfg.info(s)   部屋の名前の下の一行 → { text, warn }
//   cfg.common    よく使う命令 [[ボタンの文字, 送る命令], …]（六つまで）
//   cfg.flash(fx) 確かめたときの二行（任意。野帳のネオン）→ [英, 日] か null
// 戻るのは、時計の「戻る」（右へのスワイプ）か、いちばん下の「階層目録へ」。
import * as hmUI from '@zos/ui'
import { scrollTo } from '@zos/page'
import { back } from '@zos/router'
import { setWakeUpRelaunch } from '@zos/display'
import { W, Canvas, CW, textHeight } from './ui'
import { makeIo, saveMeta, loadSettings, saveSettings } from './store'
import { buzz } from './vibe'

// [ボタンの文字, 送る命令, 方角]。null は空き
const PAD = [
  ['上', 'up', 'u'], ['北', 'north', 'n'], null,
  ['西', 'west', 'w'], ['見る', 'look', ''], ['東', 'east', 'e'],
  null, ['南', 'south', 's'], ['下', 'down', 'd']
]
const CYAN = 0x00e5ff

export function toTheme(arr) {
  const c = arr.map((h) => parseInt(h, 16))
  return { bg: c[0], text: c[1], bright: c[2], dim: c[3], faint: c[4], key: c[5], warn: c[6] }
}

// ゲームの種類で、出し方が少し違う本体の口を、そろえる
function adapt(g) {
  const turnStart = () => (typeof g.turnStart === 'function' ? g.turnStart() : 0)
  return {
    raw: g,
    VERBS: g.VERBS,
    start: (fresh) => g.start(fresh),
    submit: (label, en) => g.submit(label, en),
    status: () => g.status(),
    fx: () => (typeof g.fx === 'function' ? g.fx() : []),
    meta: () => (typeof g.meta === 'function' ? g.meta() : null),
    visible: () => g.visible(),
    wordsHere: (kind) => g.wordsHere(kind),
    turn: () => (typeof g.turn === 'function' ? g.turn() : g.rows().slice(turnStart())),
    pastCommands: (n) => (typeof g.pastCommands === 'function'
      ? g.pastCommands(n)
      : g.rows().slice(0, turnStart()).filter((r) => r.t === 'cmd').slice(-n).map((r) => r.ja))
  }
}

export function makeGamePage(cfg) {
  return {
    state: {},

    onInit() {
      const st = this.state
      st.canvas = new Canvas()
      st.mode = 'game' // game / verb / obj / obj2 / word
      st.verb = null
      st.obj1 = null
      st.error = ''
      st.flash = null
      st.set = loadSettings()
      try { setWakeUpRelaunch({ relaunch: true }) } catch (e) { /* なくてもよい */ }
      try {
        st.game = adapt(cfg.createGame(makeIo(cfg.id)))
        st.game.start(false)
        this.writeMeta()
      } catch (e) {
        st.error = (e && e.message) || String(e)
      }
    },

    build() {
      this.render()
    },

    // 起動画面の札に出す要約を残す
    writeMeta() {
      try {
        const m = this.state.game.meta()
        if (m) saveMeta(cfg.id, { endings: (m.endings || []).length, total: m.total || 0, deepest: m.deepest || '', runs: m.runs || 0 })
      } catch (e) { /* なくてもよい */ }
    },

    send(label, en) {
      const st = this.state
      st.mode = 'game'
      try {
        st.game.submit(label, en)
        const fx = st.game.fx()
        st.flash = cfg.flash ? cfg.flash(fx) : null
        this.feel(fx)
        this.writeMeta()
      } catch (e) {
        st.error = (e && e.message) || String(e)
      }
      this.render()
    },

    // 出来事に合わせて振動する
    feel(fx) {
      if (!this.state.set.vibe) return
      const types = (fx || []).map((e) => e.type)
      if (types.includes('collapse')) { buzz(true); setTimeout(() => buzz(true), 300); return }
      if (types.includes('hurt') || types.includes('shock')) { buzz(true); return }
      if (types.includes('verify') || types.includes('blackout') || types.includes('end')) buzz(false)
    },

    newGame() {
      const st = this.state
      st.mode = 'game'
      st.error = ''
      st.flash = null
      st.game.start(true)
      this.writeMeta()
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

    leave() {
      try { back() } catch (e) { /* 右へのスワイプで戻れる */ }
    },

    // ---- 画面 ----
    render() {
      const st = this.state
      st.canvas.clear()
      const s = st.game && !st.error ? st.game.status() : null
      st.T = toTheme(s ? cfg.theme(s) : cfg.theme({}))
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
      cv.button((W - 240) / 2, y + 20, 240, 56, '階層目録へ', () => this.leave(), { color: T.key, textColor: T.dim, size: 22 })
      return y + 76
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
      const inf = cfg.info(s)
      y = cv.text(y, inf.text, { size: 20, color: inf.warn ? T.warn : T.dim, center: true, gap: 12 })
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
        else if (cls === 'doc' || cls === 'rec') { opt.color = T.bright; opt.size = 22; opt.indent = 10 }
        y = cv.text(y, r.ja, opt)
      }
      y += 12

      if (s.done) {
        cv.button((W - 260) / 2, y, 260, 64, 'はじめから', () => this.newGame(), { color: T.text, textColor: T.bg, size: 26 })
        cv.button((W - 260) / 2, y + 74, 260, 56, '階層目録へ', () => this.leave(), { color: T.key, textColor: T.dim, size: 22 })
        return y + 130
      }

      cv.button((W - 300) / 2, y, 300, 70, '命令を作る', () => this.openBuilder(), { color: T.text, textColor: T.bg, size: 28, radius: 35 })
      y += 86

      // 方角。行ける方角だけ明るくする
      const bw = 116
      const bh = 64
      const gap = 8
      const x0 = (W - (bw * 3 + gap * 2)) / 2
      const exits = s.exits || []
      PAD.forEach((p, i) => {
        if (!p) return
        const [label, cmd, dir] = p
        const bx = x0 + (i % 3) * (bw + gap)
        const by = y + Math.floor(i / 3) * (bh + gap)
        const open = dir && exits.includes(dir)
        const color = !dir ? T.faint : open ? T.text : T.key
        const textColor = !dir ? T.bright : open ? T.bg : T.dim
        cv.button(bx, by, bw, bh, label, () => this.send(label, cmd), { color, textColor, size: 26 })
      })
      y += 3 * (bh + gap) + 6

      const cw = 170
      const cx = (W - (cw * 2 + gap)) / 2
      cfg.common.forEach(([label, cmd], i) => {
        const bx = cx + (i % 2) * (cw + gap)
        const by = y + Math.floor(i / 2) * (bh + gap)
        cv.button(bx, by, cw, bh, label, () => this.send(label, cmd), { color: T.faint, textColor: T.text, size: label.length > 5 ? 21 : 24 })
      })
      y += Math.ceil(cfg.common.length / 2) * (bh + gap) + 10
      cv.button(cx, y, cw, 56, '振動：' + (st.set.vibe ? '入' : '切'), () => this.toggleVibe(), { color: T.faint, textColor: T.dim, size: 22 })
      cv.button(cx + cw + gap, y, cw, 56, 'はじめから', () => this.confirmNew(), { color: T.faint, textColor: T.warn, size: 22 })
      y += 56 + gap
      cv.button((W - 240) / 2, y, 240, 56, '階層目録へ', () => this.leave(), { color: T.key, textColor: T.dim, size: 22 })
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
      const titles = {
        verb: '何をする？',
        obj: '何を？',
        obj2: v && v[1].startsWith('give') ? '誰に？' : 'どこに？',
        word: v && v[1].startsWith('write') ? '何と書く？' : '何と言う？'
      }
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
          cv.button(x0 + (i % 3) * (bw + gap), y + Math.floor(i / 3) * (bh + gap), bw, bh, label, fn,
            { color: T.faint, textColor: T.text, size: label.length > 4 ? 19 : 23, radius: 12 })
        })
        y += Math.ceil(items.length / 3) * (bh + gap) + 8
      } else {
        if (st.mode === 'word') {
          const kind = v[1].startsWith('write') ? 'write' : 'say'
          for (const w of g.wordsHere(kind)) {
            const show = w.show || w.ja
            items.push(['「' + show + '」', () => this.send(kind === 'say' ? `「${show}」と言う` : `「${show}」と書く`, `${kind} ${w.en}`)])
          }
          if (!items.length) {
            y = cv.text(y, kind === 'say' ? '口にできることばが、思いつかない。' : '書くことが、思いつかない。', { size: 22, color: T.dim, center: true, gap: 10 })
          }
        } else {
          let list = g.visible()
          if (st.mode === 'obj2') list = list.filter((o) => o.id !== st.obj1.id)
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
  }
}
