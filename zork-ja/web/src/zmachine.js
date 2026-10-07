// zmachine.js — Zork I を動かすための、Z マシン バージョン3 の小さなインタープリタ。
// 入力待ちになるまで命令を実行し、出力した文字列を返す。保存・復元は状態をそのまま書き出す。
"use strict";

class ZMachine {
  constructor(story) {
    this.story = story instanceof Uint8Array ? story : new Uint8Array(story);
    if (this.story[0] !== 3) throw new Error("バージョン3のゲームファイルではありません");
    this.restart();
  }

  // ---- 準備 ----
  restart() {
    this.mem = new Uint8Array(this.story);
    const m = this.mem;
    this.staticBase = this.w(0x0e);
    this.dictAddr = this.w(0x08);
    this.objTable = this.w(0x0a);
    this.globals = this.w(0x0c);
    this.abbrevs = this.w(0x18);
    m[0x01] &= ~0x10;          // 状態行を表示できる
    m[0x01] |= 0x20;           // 画面分割を使える
    m[0x32] = 1; m[0x33] = 0;  // 規格 1.0
    this.pc = this.w(0x06);
    this.stack = [];
    this.frames = [];          // {ret, store, locals, sp}
    this.out = "";
    this.waiting = null;       // 入力待ちのときの {text, parse}
    this.finished = false;
    this.saveRequest = null;
    this.window = 0;
    this.seed = 0;
    this.buildDict();
  }

  w(a) { return (this.mem[a] << 8) | this.mem[a + 1]; }
  sw(a, v) { this.mem[a] = (v >> 8) & 0xff; this.mem[a + 1] = v & 0xff; }
  b(a) { return this.mem[a]; }
  sb(a, v) { this.mem[a] = v & 0xff; }

  // ---- 変数 ----
  getVar(v) {
    if (v === 0) {
      if (!this.stack.length) throw new Error("スタックが空です");
      return this.stack.pop();
    }
    if (v < 16) return this.frames[this.frames.length - 1].locals[v - 1];
    return this.w(this.globals + 2 * (v - 16));
  }
  setVar(v, x) {
    x &= 0xffff;
    if (v === 0) this.stack.push(x);
    else if (v < 16) this.frames[this.frames.length - 1].locals[v - 1] = x;
    else this.sw(this.globals + 2 * (v - 16), x);
  }
  // 間接参照（inc, store など）では、スタックの先頭をその場で読み書きする
  peekVar(v) {
    if (v === 0) return this.stack[this.stack.length - 1];
    return this.getVar(v);
  }
  pokeVar(v, x) {
    if (v === 0) this.stack[this.stack.length - 1] = x & 0xffff;
    else this.setVar(v, x);
  }

  // ---- 命令の読み出し ----
  fetchB() { return this.mem[this.pc++]; }
  fetchW() { const x = this.w(this.pc); this.pc += 2; return x; }
  operand(type) {
    if (type === 0) return this.fetchW();
    if (type === 1) return this.fetchB();
    if (type === 2) return this.getVar(this.fetchB());
    return undefined;
  }
  store(x) { this.setVar(this.fetchB(), x); }
  branch(cond) {
    const b1 = this.fetchB();
    let off;
    if (b1 & 0x40) off = b1 & 0x3f;
    else {
      off = ((b1 & 0x3f) << 8) | this.fetchB();
      if (off & 0x2000) off -= 0x4000;
    }
    if (!!(b1 & 0x80) === !!cond) {
      if (off === 0) this.ret(0);
      else if (off === 1) this.ret(1);
      else this.pc += off - 2;
    }
  }

  // ---- 呼び出し ----
  call(addr, args, storeVar) {
    if (addr === 0) { if (storeVar !== null) this.setVar(storeVar, 0); return; }
    let a = addr * 2;
    const n = this.mem[a++];
    const locals = [];
    for (let i = 0; i < n; i++) { locals.push(this.w(a)); a += 2; }
    for (let i = 0; i < args.length && i < n; i++) locals[i] = args[i] & 0xffff;
    this.frames.push({ ret: this.pc, store: storeVar, locals, sp: this.stack.length });
    this.pc = a;
  }
  ret(x) {
    const f = this.frames.pop();
    this.stack.length = f.sp;
    this.pc = f.ret;
    if (f.store !== null) this.setVar(f.store, x);
  }

  // ---- 文字列 ----
  decode(addr, maxBytes) {
    const zs = [];
    const end = maxBytes ? addr + maxBytes : Infinity;
    for (;;) {
      const word = this.w(addr);
      addr += 2;
      zs.push((word >> 10) & 31, (word >> 5) & 31, word & 31);
      if (word & 0x8000 || addr >= end) break;
    }
    return { text: this.zcharsToText(zs, true), next: addr };
  }
  zcharsToText(zs, allowAbbrev) {
    const A2 = " \n0123456789.,!?_#'\"/\\-:()";
    let s = "", alpha = 0;
    for (let i = 0; i < zs.length; i++) {
      const c = zs[i];
      if (c === 0) { s += " "; alpha = 0; continue; }
      if (c >= 1 && c <= 3) {
        if (!allowAbbrev) { alpha = 0; continue; }
        const x = zs[++i];
        if (x === undefined) break;
        const wa = this.w(this.abbrevs + 2 * (32 * (c - 1) + x)) * 2;
        s += this.decode(wa).text;
        alpha = 0;
        continue;
      }
      if (c === 4) { alpha = 1; continue; }
      if (c === 5) { alpha = 2; continue; }
      if (alpha === 2 && c === 6) {
        const hi = zs[++i], lo = zs[++i];
        if (hi === undefined || lo === undefined) break;
        s += this.zscii((hi << 5) | lo);
      } else if (alpha === 0) s += String.fromCharCode(97 + c - 6);
      else if (alpha === 1) s += String.fromCharCode(65 + c - 6);
      else s += A2[c - 6];
      alpha = 0;
    }
    return s;
  }
  zscii(c) {
    if (c === 13) return "\n";
    if (c >= 32 && c <= 126) return String.fromCharCode(c);
    return "";
  }
  print(s) { if (this.window === 0) this.out += s; }

  // ---- 辞書と字句解析 ----
  buildDict() {
    let a = this.dictAddr;
    const n = this.mem[a++];
    this.separators = [];
    for (let i = 0; i < n; i++) this.separators.push(String.fromCharCode(this.mem[a++]));
    const entryLen = this.mem[a++];
    const count = this.w(a); a += 2;
    this.dict = new Map();
    for (let i = 0; i < count; i++) {
      const key = Array.from(this.mem.subarray(a, a + 4)).join(",");
      this.dict.set(key, a);
      a += entryLen;
    }
  }
  encodeWord(word) {
    const A2 = "\n0123456789.,!?_#'\"/\\-:()";
    const zs = [];
    for (const ch of word) {
      if (ch >= "a" && ch <= "z") zs.push(ch.charCodeAt(0) - 97 + 6);
      else {
        const k = A2.indexOf(ch);
        if (k >= 0) zs.push(5, k + 7);
        else { const z = ch.charCodeAt(0); zs.push(5, 6, z >> 5, z & 31); }
      }
      if (zs.length >= 6) break;
    }
    while (zs.length < 6) zs.push(5);
    zs.length = 6;
    const w1 = (zs[0] << 10) | (zs[1] << 5) | zs[2];
    const w2 = 0x8000 | (zs[3] << 10) | (zs[4] << 5) | zs[5];
    return [w1 >> 8, w1 & 0xff, w2 >> 8, w2 & 0xff].join(",");
  }
  tokenize(textAddr, parseAddr) {
    const chars = [];
    for (let i = 1; this.mem[textAddr + i] !== 0; i++) chars.push(String.fromCharCode(this.mem[textAddr + i]));
    const words = [];
    let i = 0;
    while (i < chars.length) {
      const ch = chars[i];
      if (ch === " ") { i++; continue; }
      if (this.separators.includes(ch)) { words.push({ s: ch, pos: i + 1 }); i++; continue; }
      let j = i;
      while (j < chars.length && chars[j] !== " " && !this.separators.includes(chars[j])) j++;
      words.push({ s: chars.slice(i, j).join(""), pos: i + 1 });
      i = j;
    }
    const max = this.mem[parseAddr];
    const n = Math.min(words.length, max);
    this.mem[parseAddr + 1] = n;
    for (let k = 0; k < n; k++) {
      const e = parseAddr + 2 + 4 * k;
      const d = this.dict.get(this.encodeWord(words[k].s)) || 0;
      this.sw(e, d);
      this.mem[e + 2] = words[k].s.length;
      this.mem[e + 3] = words[k].pos;
    }
  }

  // ---- オブジェクト ----
  objAddr(o) { return this.objTable + 62 + 9 * (o - 1); }
  parent(o) { return o ? this.mem[this.objAddr(o) + 4] : 0; }
  sibling(o) { return o ? this.mem[this.objAddr(o) + 5] : 0; }
  child(o) { return o ? this.mem[this.objAddr(o) + 6] : 0; }
  setParent(o, p) { this.mem[this.objAddr(o) + 4] = p; }
  setSibling(o, s) { this.mem[this.objAddr(o) + 5] = s; }
  setChild(o, c) { this.mem[this.objAddr(o) + 6] = c; }
  propTable(o) { return this.w(this.objAddr(o) + 7); }
  objName(o) {
    if (!o) return "";
    const p = this.propTable(o);
    return this.mem[p] ? this.decode(p + 1).text : "";
  }
  testAttr(o, a) { return o ? !!(this.mem[this.objAddr(o) + (a >> 3)] & (0x80 >> (a & 7))) : false; }
  setAttr(o, a, on) {
    if (!o) return;
    const addr = this.objAddr(o) + (a >> 3);
    if (on) this.mem[addr] |= 0x80 >> (a & 7);
    else this.mem[addr] &= ~(0x80 >> (a & 7));
  }
  removeObj(o) {
    const p = this.parent(o);
    if (!p) return;
    if (this.child(p) === o) this.setChild(p, this.sibling(o));
    else {
      let c = this.child(p);
      while (c && this.sibling(c) !== o) c = this.sibling(c);
      if (c) this.setSibling(c, this.sibling(o));
    }
    this.setParent(o, 0);
    this.setSibling(o, 0);
  }
  insertObj(o, d) {
    this.removeObj(o);
    this.setSibling(o, this.child(d));
    this.setChild(d, o);
    this.setParent(o, d);
  }
  firstProp(o) { const p = this.propTable(o); return p + 1 + 2 * this.mem[p]; }
  findProp(o, n) {
    let a = this.firstProp(o);
    for (;;) {
      const sz = this.mem[a];
      if (sz === 0) return 0;
      const num = sz & 31, len = (sz >> 5) + 1;
      if (num === n) return a + 1;
      if (num < n) return 0;
      a += 1 + len;
    }
  }
  getProp(o, n) {
    const a = this.findProp(o, n);
    if (!a) return this.w(this.objTable + 2 * (n - 1));
    const len = (this.mem[a - 1] >> 5) + 1;
    return len === 1 ? this.mem[a] : this.w(a);
  }
  propLen(a) { return a ? (this.mem[a - 1] >> 5) + 1 : 0; }
  nextProp(o, n) {
    if (n === 0) {
      const sz = this.mem[this.firstProp(o)];
      return sz & 31;
    }
    const a = this.findProp(o, n);
    if (!a) throw new Error("存在しない属性の次を求めました");
    const next = a + this.propLen(a);
    return this.mem[next] & 31;
  }

  // ---- 状態行 ----
  status() {
    const loc = this.w(this.globals);
    return {
      room: this.objName(loc),
      score: this.toS(this.w(this.globals + 2)),
      moves: this.w(this.globals + 4),
    };
  }
  toS(x) { return x & 0x8000 ? x - 0x10000 : x; }

  random(range) {
    if (range <= 0) { this.seed = -range; return 0; }
    if (this.seed) {
      this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
      return (this.seed % range) + 1;
    }
    return Math.floor(Math.random() * range) + 1;
  }

  // ---- 実行 ----
  // 入力待ち・終了まで進め、その間の出力を返す
  run() {
    this.out = "";
    let steps = 0;
    while (!this.waiting && !this.finished) {
      this.step();
      if (++steps > 5000000) throw new Error("命令が止まりません");
    }
    return this.out;
  }

  // 入力を渡して続きを実行する
  input(line) {
    if (!this.waiting) return this.run();
    const { text, parse } = this.waiting;
    const max = this.mem[text];
    const s = line.toLowerCase().replace(/[^\x20-\x7e]/g, "").slice(0, max - 1);
    for (let i = 0; i < s.length; i++) this.mem[text + 1 + i] = s.charCodeAt(i);
    this.mem[text + 1 + s.length] = 0;
    if (parse) this.tokenize(text, parse);
    this.waiting = null;
    return this.run();
  }

  step() {
    const op = this.fetchB();
    let ops = [], form, num;
    if (op < 0x80) {
      form = "2OP"; num = op & 0x1f;
      ops.push(this.operand(op & 0x40 ? 2 : 1), this.operand(op & 0x20 ? 2 : 1));
    } else if (op < 0xc0) {
      const t = (op >> 4) & 3;
      num = op & 0x0f;
      if (t === 3) form = "0OP";
      else { form = "1OP"; ops.push(this.operand(t)); }
    } else {
      form = op < 0xe0 ? "2OP" : "VAR";
      num = op & 0x1f;
      const types = this.fetchB();
      for (let sh = 6; sh >= 0; sh -= 2) {
        const t = (types >> sh) & 3;
        if (t === 3) break;
        ops.push(this.operand(t));
      }
    }
    const s16 = x => (x & 0x8000 ? x - 0x10000 : x);
    const [a, b2] = ops;
    if (form === "2OP") {
      switch (num) {
        case 1: this.branch(ops.slice(1).some(x => x === a)); return;
        case 2: this.branch(s16(a) < s16(b2)); return;
        case 3: this.branch(s16(a) > s16(b2)); return;
        case 4: { const v = s16(this.peekVar(a)) - 1; this.pokeVar(a, v); this.branch(v < s16(b2)); return; }
        case 5: { const v = s16(this.peekVar(a)) + 1; this.pokeVar(a, v); this.branch(v > s16(b2)); return; }
        case 6: this.branch(this.parent(a) === b2); return;
        case 7: this.branch((a & b2) === b2); return;
        case 8: this.store(a | b2); return;
        case 9: this.store(a & b2); return;
        case 10: this.branch(this.testAttr(a, b2)); return;
        case 11: this.setAttr(a, b2, true); return;
        case 12: this.setAttr(a, b2, false); return;
        case 13: this.pokeVar(a, b2); return;
        case 14: this.insertObj(a, b2); return;
        case 15: this.store(this.w((a + 2 * s16(b2)) & 0xffff)); return;
        case 16: this.store(this.mem[(a + s16(b2)) & 0xffff]); return;
        case 17: this.store(this.getProp(a, b2)); return;
        case 18: this.store(a ? this.findProp(a, b2) : 0); return;
        case 19: this.store(this.nextProp(a, b2)); return;
        case 20: this.store(s16(a) + s16(b2)); return;
        case 21: this.store(s16(a) - s16(b2)); return;
        case 22: this.store(Math.imul(s16(a), s16(b2))); return;
        case 23: if (b2 === 0) throw new Error("0で割りました"); this.store(Math.trunc(s16(a) / s16(b2))); return;
        case 24: if (b2 === 0) throw new Error("0で割りました"); this.store(s16(a) % s16(b2)); return;
      }
    } else if (form === "1OP") {
      switch (num) {
        case 0: this.branch(a === 0); return;
        case 1: { const x = this.sibling(a); this.store(x); this.branch(x !== 0); return; }
        case 2: { const x = this.child(a); this.store(x); this.branch(x !== 0); return; }
        case 3: this.store(this.parent(a)); return;
        case 4: this.store(this.propLen(a)); return;
        case 5: this.pokeVar(a, s16(this.peekVar(a)) + 1); return;
        case 6: this.pokeVar(a, s16(this.peekVar(a)) - 1); return;
        case 7: this.print(this.decode(a).text); return;
        case 9: this.removeObj(a); return;
        case 10: this.print(this.objName(a)); return;
        case 11: this.ret(a); return;
        case 12: this.pc += s16(a) - 2; return;
        case 13: this.print(this.decode(a * 2).text); return;
        case 14: this.store(this.peekVar(a)); return;
        case 15: this.store(~a); return;
      }
    } else if (form === "0OP") {
      switch (num) {
        case 0: this.ret(1); return;
        case 1: this.ret(0); return;
        case 2: { const d = this.decode(this.pc); this.pc = d.next; this.print(d.text); return; }
        case 3: { const d = this.decode(this.pc); this.pc = d.next; this.print(d.text + "\n"); this.ret(1); return; }
        case 4: return;
        case 5: { // save: 状態を書き出して、成功として分岐する
          const at = this.pc;
          this.saveRequest = this.snapshot(at);
          this.branch(true);
          return;
        }
        case 6: { // restore
          const data = this.onRestore ? this.onRestore() : null;
          if (data && this.restoreSnapshot(data)) return;
          this.branch(false);
          return;
        }
        case 7: this.restart(); return;
        case 8: this.ret(this.stack.pop()); return;
        case 9: this.stack.pop(); return;
        case 10: this.finished = true; return;
        case 11: this.print("\n"); return;
        case 12: return;
        case 13: this.branch(true); return;
      }
    } else {
      switch (num) {
        case 0: this.call(a, ops.slice(1), this.fetchB()); return;
        case 1: this.sw((a + 2 * s16(b2)) & 0xffff, ops[2]); return;
        case 2: this.sb((a + s16(b2)) & 0xffff, ops[2]); return;
        case 3: {
          const pa = this.findProp(a, b2);
          if (!pa) throw new Error("存在しない属性に書き込みました");
          if (this.propLen(pa) === 1) this.mem[pa] = ops[2] & 0xff; else this.sw(pa, ops[2]);
          return;
        }
        case 4: this.waiting = { text: a, parse: b2 }; return;
        case 5: this.print(this.zscii(a)); return;
        case 6: this.print(String(s16(a))); return;
        case 7: this.store(this.random(s16(a))); return;
        case 8: this.stack.push(a); return;
        case 9: this.pokeVar(a, this.stack.pop()); return;
        case 10: return;
        case 11: this.window = a; return;
        case 19: case 20: case 21: return;
      }
    }
    throw new Error(`未対応の命令です: ${form} ${num} (pc=${this.pc})`);
  }

  // ---- 保存・復元 ----
  // 動的メモリは元のゲームファイルとの差分（XOR）を詰めて保存する
  snapshot(pcAt) {
    const n = this.staticBase;
    const diff = [];
    let zeros = 0;
    for (let i = 0; i < n; i++) {
      const x = this.mem[i] ^ this.story[i];
      if (x === 0) { zeros++; continue; }
      if (zeros) { diff.push(-zeros); zeros = 0; }
      diff.push(x);
    }
    return {
      v: 1,
      serial: this.serial(),
      pc: pcAt,
      diff,
      stack: this.stack.slice(),
      frames: this.frames.map(f => ({ ret: f.ret, store: f.store, locals: f.locals.slice(), sp: f.sp })),
    };
  }
  // 入力待ちの状態を書き出す（自動保存用）。復元するとそのまま入力待ちに戻る
  snapshotWaiting() {
    if (!this.waiting) return null;
    const s = this.snapshot(this.pc);
    s.waiting = { text: this.waiting.text, parse: this.waiting.parse };
    return s;
  }
  restoreSnapshot(s) {
    if (!s || s.v !== 1 || s.serial !== this.serial()) return false;
    const mem = new Uint8Array(this.story);
    let i = 0;
    for (const x of s.diff) {
      if (x < 0) i += -x;
      else { mem[i] ^= x; i++; }
    }
    // 状態行などのフラグは今の値を保つ
    mem[0x01] = this.mem[0x01];
    mem[0x10] = this.mem[0x10]; mem[0x11] = this.mem[0x11];
    this.mem = mem;
    this.stack = s.stack.slice();
    this.frames = s.frames.map(f => ({ ret: f.ret, store: f.store, locals: f.locals.slice(), sp: f.sp }));
    this.pc = s.pc;
    this.finished = false;
    if (s.waiting) this.waiting = { text: s.waiting.text, parse: s.waiting.parse };
    else { this.waiting = null; this.branch(true); }
    return true;
  }
  serial() { return String.fromCharCode(...this.story.subarray(0x12, 0x18)); }
}

if (typeof module !== "undefined") module.exports = { ZMachine };
