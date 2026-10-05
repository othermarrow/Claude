// Z-machine（バージョン3）のインタプリタ。Zork I（zork1.z3）を動かす。
// 画面や保存の処理は持たず、入力待ちになるたびに run() から戻る。
//   const zm = new ZMachine(storyBytes)
//   zm.run()            -> 'input' | 'quit'   出力は zm.takeOutput()、状態行は zm.status
//   zm.input('open mailbox'); zm.run()
//   zm.snapshot() / zm.load(snap)   入力待ちの状態を丸ごと保存・復元する
//   zm.onSave(snap) -> bool / zm.onRestore() -> snap   ゲーム内の save / restore 命令用

const A0 = 'abcdefghijklmnopqrstuvwxyz'
const A1 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const A2 = ' \n0123456789.,!?_#\'"/\\-:()'

function s16(v) {
  return (v << 16) >> 16
}

export class ZMachine {
  constructor(story) {
    this.story = story // 元のファイル（restart 用に書き換えない）
    this.onSave = null
    this.onRestore = null
    this.reset()
  }

  reset() {
    this.mem = new Uint8Array(this.story) // 複製
    const m = this.mem
    if (m[0] !== 3) throw new Error('バージョン3のゲームファイルではありません: v' + m[0])
    this.pc = this.rw(0x06)
    this.dictAddr = this.rw(0x08)
    this.objAddr = this.rw(0x0a)
    this.globAddr = this.rw(0x0c)
    this.staticAddr = this.rw(0x0e)
    this.abbrAddr = this.rw(0x18)
    this.stack = []
    this.frames = [] // {ret, store, locals, sp}
    this.locals = []
    this.out = ''
    this.status = null
    this.waiting = null // 入力待ちの {text, parse}
    this.finished = false
    this.seed = 0
    // 状態行のある画面だと知らせる（flags1 bit4: 状態行なし を立てない）
    m[0x01] &= ~0x10
    m[0x01] |= 0x20 // 画面分割あり
    m[0x20] = 255 // 画面の高さ（行）
    m[0x21] = 80 // 画面の幅（文字）
    this.initDict()
  }

  rw(a) {
    return (this.mem[a] << 8) | this.mem[a + 1]
  }

  ww(a, v) {
    this.mem[a] = (v >> 8) & 0xff
    this.mem[a + 1] = v & 0xff
  }

  // ---- 変数 ----
  getVar(n) {
    if (n === 0) {
      if (!this.stack.length) throw new Error('スタックが空です')
      return this.stack.pop()
    }
    if (n < 16) return this.locals[n - 1]
    return this.rw(this.globAddr + 2 * (n - 16))
  }

  setVar(n, v) {
    v &= 0xffff
    if (n === 0) this.stack.push(v)
    else if (n < 16) this.locals[n - 1] = v
    else this.ww(this.globAddr + 2 * (n - 16), v)
  }

  // inc / dec / load / store などの「間接参照」ではスタックの一番上をその場で読み書きする
  peekVar(n) {
    if (n === 0) return this.stack[this.stack.length - 1]
    return this.getVar(n)
  }

  pokeVar(n, v) {
    if (n === 0) this.stack[this.stack.length - 1] = v & 0xffff
    else this.setVar(n, v)
  }

  store(v) {
    this.setVar(this.mem[this.pc++], v)
  }

  branch(cond) {
    const b = this.mem[this.pc++]
    let off
    if (b & 0x40) off = b & 0x3f
    else {
      off = ((b & 0x3f) << 8) | this.mem[this.pc++]
      if (off & 0x2000) off -= 0x4000
    }
    if (!!(b & 0x80) !== cond) return
    if (off === 0 || off === 1) this.ret(off)
    else this.pc += off - 2
  }

  // ---- ルーチン ----
  call(addr, args, store) {
    if (addr === 0) {
      if (store >= 0) this.setVar(store, 0)
      return
    }
    this.frames.push({ ret: this.pc, store, locals: this.locals, sp: this.stack.length })
    let a = addr * 2
    const n = this.mem[a++]
    const locals = new Array(n)
    for (let i = 0; i < n; i++, a += 2) locals[i] = i < args.length ? args[i] : this.rw(a)
    this.locals = locals
    this.pc = a
  }

  ret(v) {
    const f = this.frames.pop()
    this.stack.length = f.sp
    this.locals = f.locals
    this.pc = f.ret
    if (f.store >= 0) this.setVar(f.store, v)
  }

  // ---- 文字列 ----
  decode(addr, out) {
    // out: 文字列の配列（ここに足す）。戻り値は終わりの次のアドレス
    const zs = []
    for (;;) {
      const w = this.rw(addr)
      addr += 2
      zs.push((w >> 10) & 31, (w >> 5) & 31, w & 31)
      if (w & 0x8000) break
    }
    let alpha = 0
    for (let i = 0; i < zs.length; i++) {
      const z = zs[i]
      if (z === 0) out.push(' ')
      else if (z <= 3) {
        const idx = 32 * (z - 1) + zs[++i]
        this.decode(this.rw(this.abbrAddr + idx * 2) * 2, out)
      } else if (z === 4) {
        alpha = 1
        continue
      } else if (z === 5) {
        alpha = 2
        continue
      } else if (alpha === 2 && z === 6) {
        const c = (zs[i + 1] << 5) | zs[i + 2]
        i += 2
        out.push(this.zscii(c))
      } else if (alpha === 0) out.push(A0[z - 6])
      else if (alpha === 1) out.push(A1[z - 6])
      else out.push(A2[z - 6])
      alpha = 0
    }
    return addr
  }

  text(addr) {
    const out = []
    this.decode(addr, out)
    return out.join('')
  }

  zscii(c) {
    if (c === 13) return '\n'
    if (c >= 32 && c < 127) return String.fromCharCode(c)
    return ''
  }

  print(s) {
    this.out += s
  }

  takeOutput() {
    const s = this.out
    this.out = ''
    return s
  }

  // ---- オブジェクト ----
  obj(n) {
    return this.objAddr + 62 + (n - 1) * 9
  }

  parent(n) {
    return this.mem[this.obj(n) + 4]
  }

  sibling(n) {
    return this.mem[this.obj(n) + 5]
  }

  child(n) {
    return this.mem[this.obj(n) + 6]
  }

  objName(n) {
    if (!n) return ''
    const p = this.rw(this.obj(n) + 7)
    return this.mem[p] ? this.text(p + 1) : ''
  }

  firstProp(n) {
    const p = this.rw(this.obj(n) + 7)
    return p + 1 + this.mem[p] * 2
  }

  findProp(n, prop) {
    let a = this.firstProp(n)
    for (;;) {
      const sz = this.mem[a]
      if (!sz) return 0
      const num = sz & 31
      if (num === prop) return a
      if (num < prop) return 0 // 番号の大きい順に並んでいる
      a += 2 + (sz >> 5)
    }
  }

  removeObj(n) {
    const p = this.parent(n)
    if (!p) return
    const o = this.obj(n)
    const next = this.mem[o + 5]
    if (this.child(p) === n) this.mem[this.obj(p) + 6] = next
    else {
      let c = this.child(p)
      while (c) {
        const co = this.obj(c)
        if (this.mem[co + 5] === n) {
          this.mem[co + 5] = next
          break
        }
        c = this.mem[co + 5]
      }
    }
    this.mem[o + 4] = 0
    this.mem[o + 5] = 0
  }

  // ---- 辞書と入力 ----
  initDict() {
    let a = this.dictAddr
    const n = this.mem[a++]
    this.seps = []
    for (let i = 0; i < n; i++) this.seps.push(String.fromCharCode(this.mem[a++]))
    this.entryLen = this.mem[a++]
    this.entryCount = s16(this.rw(a))
    this.entries = a + 2
  }

  encode(word) {
    const zs = []
    for (const ch of word) {
      let i = A0.indexOf(ch)
      if (i >= 0) {
        zs.push(i + 6)
        continue
      }
      i = A2.indexOf(ch, 2)
      if (i >= 2) zs.push(5, i + 6)
      else {
        const c = ch.charCodeAt(0) & 0x3ff
        zs.push(5, 6, c >> 5, c & 31)
      }
    }
    while (zs.length < 6) zs.push(5)
    return [(zs[0] << 10) | (zs[1] << 5) | zs[2], ((zs[3] << 10) | (zs[4] << 5) | zs[5]) | 0x8000]
  }

  lookup(word) {
    const [w1, w2] = this.encode(word)
    let lo = 0
    let hi = Math.abs(this.entryCount) - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const a = this.entries + mid * this.entryLen
      const d = this.rw(a) - w1 || this.rw(a + 2) - w2
      if (d === 0) return a
      if (d < 0) lo = mid + 1
      else hi = mid - 1
    }
    return 0
  }

  // 入力された命令を渡す（入力待ちのときだけ）
  input(line) {
    if (!this.waiting) return
    const { text, parse } = this.waiting
    this.waiting = null
    const max = this.mem[text] - 1
    let s = String(line).toLowerCase().replace(/[^\x20-\x7e]/g, '')
    s = s.slice(0, Math.max(0, max))
    for (let i = 0; i < s.length; i++) this.mem[text + 1 + i] = s.charCodeAt(i)
    this.mem[text + 1 + s.length] = 0
    // 単語に分ける
    const words = []
    let i = 0
    while (i < s.length) {
      const c = s[i]
      if (c === ' ') {
        i++
        continue
      }
      if (this.seps.indexOf(c) >= 0) {
        words.push([c, i])
        i++
        continue
      }
      let j = i
      while (j < s.length && s[j] !== ' ' && this.seps.indexOf(s[j]) < 0) j++
      words.push([s.slice(i, j), i])
      i = j
    }
    const maxWords = this.mem[parse]
    const n = Math.min(words.length, maxWords)
    this.mem[parse + 1] = n
    for (let k = 0; k < n; k++) {
      const [w, pos] = words[k]
      const a = parse + 2 + k * 4
      this.ww(a, this.lookup(w))
      this.mem[a + 2] = w.length
      this.mem[a + 3] = pos + 1
    }
  }

  updateStatus() {
    const g = (i) => this.rw(this.globAddr + 2 * i)
    this.status = { room: this.objName(g(0)), score: s16(g(1)), moves: g(2) }
  }

  random(n) {
    if (n <= 0) {
      this.seed = -n
      return 0
    }
    if (this.seed) {
      // 予測できる乱数（テスト用）
      this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff
      return (this.seed % n) + 1
    }
    return Math.floor(Math.random() * n) + 1
  }

  // ---- 保存 ----
  snapshot() {
    return {
      v: 1,
      pc: this.pc,
      stack: this.stack.slice(),
      locals: this.locals.slice(),
      frames: this.frames.map((f) => ({ ret: f.ret, store: f.store, sp: f.sp, locals: f.locals.slice() })),
      waiting: this.waiting,
      status: this.status,
      mem: this.mem.slice(0, this.staticAddr)
    }
  }

  load(s) {
    // 起動時に書き換えた画面情報は、そのまま残す
    const keep = this.mem.slice(0x01, 0x02)
    const keep2 = this.mem.slice(0x20, 0x22)
    this.mem.set(s.mem, 0)
    this.mem.set(keep, 0x01)
    this.mem.set(keep2, 0x20)
    this.pc = s.pc
    this.stack = s.stack.slice()
    this.locals = s.locals.slice()
    this.frames = s.frames.map((f) => ({ ret: f.ret, store: f.store, sp: f.sp, locals: f.locals.slice() }))
    this.waiting = s.waiting || null
    this.status = s.status || null
    this.finished = false
  }

  // ---- 実行 ----
  // 入力待ちか終了まで動かす。limit 命令を超えたら 'busy' で一度戻る
  run(limit = 2000000) {
    if (this.finished) return 'quit'
    if (this.waiting) return 'input'
    for (let i = 0; i < limit; i++) {
      this.step()
      if (this.waiting) return 'input'
      if (this.finished) return 'quit'
    }
    return 'busy'
  }

  step() {
    const m = this.mem
    const op = m[this.pc++]
    let ops
    let num
    let kind // 0:0OP 1:1OP 2:2OP 3:VAR
    if (op < 0x80) {
      // 2OP の短い形
      kind = 2
      num = op & 31
      const a = m[this.pc++]
      const b = m[this.pc++]
      ops = [op & 0x40 ? this.getVar(a) : a, op & 0x20 ? this.getVar(b) : b]
    } else if (op < 0xc0) {
      num = op & 15
      const t = (op >> 4) & 3
      if (t === 3) {
        kind = 0
        ops = []
      } else {
        kind = 1
        ops = [this.operand(t)]
      }
    } else {
      kind = op < 0xe0 ? 2 : 3
      num = op & 31
      const types = m[this.pc++]
      ops = []
      for (let s = 6; s >= 0; s -= 2) {
        const t = (types >> s) & 3
        if (t === 3) break
        ops.push(this.operand(t))
      }
    }
    if (kind === 2) this.op2(num, ops)
    else if (kind === 1) this.op1(num, ops[0])
    else if (kind === 0) this.op0(num)
    else this.opVar(num, ops)
  }

  operand(t) {
    if (t === 0) {
      const v = this.rw(this.pc)
      this.pc += 2
      return v
    }
    if (t === 1) return this.mem[this.pc++]
    return this.getVar(this.mem[this.pc++])
  }

  op2(num, o) {
    const a = o[0]
    const b = o[1]
    switch (num) {
      case 1: {
        let eq = false
        for (let i = 1; i < o.length; i++) if (a === o[i]) eq = true
        return this.branch(eq)
      }
      case 2:
        return this.branch(s16(a) < s16(b))
      case 3:
        return this.branch(s16(a) > s16(b))
      case 4: {
        const v = (s16(this.peekVar(a)) - 1) & 0xffff
        this.pokeVar(a, v)
        return this.branch(s16(v) < s16(b))
      }
      case 5: {
        const v = (s16(this.peekVar(a)) + 1) & 0xffff
        this.pokeVar(a, v)
        return this.branch(s16(v) > s16(b))
      }
      case 6:
        return this.branch(this.parent(a) === b)
      case 7:
        return this.branch((a & b) === b)
      case 8:
        return this.store(a | b)
      case 9:
        return this.store(a & b)
      case 10:
        return this.branch(!!(this.mem[this.obj(a) + (b >> 3)] & (0x80 >> (b & 7))))
      case 11:
        this.mem[this.obj(a) + (b >> 3)] |= 0x80 >> (b & 7)
        return
      case 12:
        this.mem[this.obj(a) + (b >> 3)] &= ~(0x80 >> (b & 7))
        return
      case 13:
        return this.pokeVar(a, b)
      case 14: {
        this.removeObj(a)
        const o2 = this.obj(a)
        const d = this.obj(b)
        this.mem[o2 + 4] = b
        this.mem[o2 + 5] = this.mem[d + 6]
        this.mem[d + 6] = a
        return
      }
      case 15:
        return this.store(this.rw((a + 2 * s16(b)) & 0xffff))
      case 16:
        return this.store(this.mem[(a + s16(b)) & 0xffff])
      case 17: {
        const p = this.findProp(a, b)
        if (!p) return this.store(this.rw(this.objAddr + 2 * (b - 1)))
        const len = (this.mem[p] >> 5) + 1
        return this.store(len === 1 ? this.mem[p + 1] : this.rw(p + 1))
      }
      case 18: {
        const p = this.findProp(a, b)
        return this.store(p ? p + 1 : 0)
      }
      case 19: {
        let p
        if (b === 0) p = this.firstProp(a)
        else {
          p = this.findProp(a, b)
          if (!p) throw new Error('get_next_prop: 属性がありません')
          p += 2 + (this.mem[p] >> 5)
        }
        return this.store(this.mem[p] & 31)
      }
      case 20:
        return this.store(s16(a) + s16(b))
      case 21:
        return this.store(s16(a) - s16(b))
      case 22:
        return this.store(Math.imul(s16(a), s16(b)))
      case 23:
        if (s16(b) === 0) throw new Error('0 で割り算しました')
        return this.store(Math.trunc(s16(a) / s16(b)))
      case 24:
        if (s16(b) === 0) throw new Error('0 で割り算しました')
        return this.store(s16(a) % s16(b))
      default:
        throw new Error('不明な命令 2OP:' + num + ' @' + this.pc.toString(16))
    }
  }

  op1(num, a) {
    switch (num) {
      case 0:
        return this.branch(a === 0)
      case 1: {
        const v = this.sibling(a)
        this.store(v)
        return this.branch(v !== 0)
      }
      case 2: {
        const v = this.child(a)
        this.store(v)
        return this.branch(v !== 0)
      }
      case 3:
        return this.store(this.parent(a))
      case 4:
        return this.store(a === 0 ? 0 : (this.mem[a - 1] >> 5) + 1)
      case 5:
        return this.pokeVar(a, s16(this.peekVar(a)) + 1)
      case 6:
        return this.pokeVar(a, s16(this.peekVar(a)) - 1)
      case 7:
        return this.print(this.text(a))
      case 9:
        return this.removeObj(a)
      case 10:
        return this.print(this.objName(a))
      case 11:
        return this.ret(a)
      case 12:
        this.pc += s16(a) - 2
        return
      case 13:
        return this.print(this.text(a * 2))
      case 14:
        return this.store(this.peekVar(a))
      case 15:
        return this.store(~a)
      default:
        throw new Error('不明な命令 1OP:' + num)
    }
  }

  op0(num) {
    switch (num) {
      case 0:
        return this.ret(1)
      case 1:
        return this.ret(0)
      case 2:
        this.pc = this.decode(this.pc, (this._buf = []))
        return this.print(this._buf.join(''))
      case 3:
        this.pc = this.decode(this.pc, (this._buf = []))
        this.print(this._buf.join('') + '\n')
        return this.ret(1)
      case 4:
        return
      case 5: {
        // save: 分岐情報の位置を pc として保存する
        let ok = false
        if (this.onSave) {
          try {
            ok = !!this.onSave(this.snapshot())
          } catch (e) {
            ok = false
          }
        }
        return this.branch(ok)
      }
      case 6: {
        let s = null
        if (this.onRestore) {
          try {
            s = this.onRestore()
          } catch (e) {
            s = null
          }
        }
        if (!s) return this.branch(false)
        this.load(s)
        return this.branch(true) // save 命令の分岐として続ける
      }
      case 7:
        this.reset()
        return
      case 8:
        return this.ret(this.getVar(0))
      case 9:
        this.stack.pop()
        return
      case 10:
        this.finished = true
        return
      case 11:
        return this.print('\n')
      case 12:
        return this.updateStatus()
      case 13:
        return this.branch(true)
      default:
        throw new Error('不明な命令 0OP:' + num)
    }
  }

  opVar(num, o) {
    switch (num) {
      case 0: {
        const store = this.mem[this.pc++]
        return this.call(o[0], o.slice(1), store)
      }
      case 1:
        return this.ww((o[0] + 2 * s16(o[1])) & 0xffff, o[2])
      case 2:
        this.mem[(o[0] + s16(o[1])) & 0xffff] = o[2] & 0xff
        return
      case 3: {
        const p = this.findProp(o[0], o[1])
        if (!p) throw new Error('put_prop: 属性がありません')
        if (this.mem[p] >> 5) this.ww(p + 1, o[2])
        else this.mem[p + 1] = o[2] & 0xff
        return
      }
      case 4:
        this.updateStatus()
        this.waiting = { text: o[0], parse: o[1] }
        return
      case 5:
        return this.print(this.zscii(o[0]))
      case 6:
        return this.print(String(s16(o[0])))
      case 7:
        return this.store(this.random(s16(o[0])))
      case 8:
        this.stack.push(o[0])
        return
      case 9: {
        const v = this.getVar(0)
        return this.pokeVar(o[0], v)
      }
      case 10: // split_window
      case 11: // set_window
      case 19: // output_stream
      case 20: // input_stream
      case 21: // sound_effect
        return
      default:
        throw new Error('不明な命令 VAR:' + num)
    }
  }
}
