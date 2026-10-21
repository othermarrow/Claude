// zvm.js — Z マシン（バージョン 1〜5・7・8）のインタープリタ。
// 入力待ちになるまで実行して、{type:"line"|"char"|"quit"} を返す。
// 出力は host.out(文字列, スタイル) と、上の窓（this.upperLines()）で受け渡す。
"use strict";

const DEFAULT_UNI = "äöüÄÖÜß»«ëïÿËÏáéíóúýÁÉÍÓÚÝàèìòùÀÈÌÒÙâêîôûÂÊÎÔÛåÅøØãñõÃÑÕæÆçÇþðÞÐ£œŒ¡¿";
const A0 = "abcdefghijklmnopqrstuvwxyz";
const A1 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const A2 = " \n0123456789.,!?_#'\"/\\-:()";
const s16 = x => (x << 16) >> 16;

class ZVM {
  constructor(story, host) {
    this.story = story instanceof Uint8Array ? story : new Uint8Array(story);
    this.host = host || {};
    this.version = this.story[0];
    if (this.version < 1 || this.version > 8 || this.version === 6) {
      throw new Error("対応していないゲームファイルです（バージョン " + this.version + "）");
    }
    this.restart();
  }

  // ---- 準備 ----
  restart() {
    const v = this.version;
    this.mem = new Uint8Array(this.story);
    const m = this.mem;
    this.staticBase = this.w(0x0e);
    this.dictAddr = this.w(0x08);
    this.objTable = this.w(0x0a);
    this.globals = this.w(0x0c);
    this.abbrevs = this.w(0x18);
    this.objBase = this.objTable + (v <= 3 ? 62 : 126);
    if (v <= 3) {
      m[1] = (m[1] & ~0x70) | 0x20;      // 状態行あり・画面分割あり・等幅
    } else {
      m[1] = 0x1c;                       // 太字・斜体・等幅
      m[0x1e] = 6; m[0x1f] = 65;         // 機種番号・版
      m[0x20] = 255; m[0x21] = 80;
      if (v >= 5) {
        this.sw(0x22, 80); this.sw(0x24, 255);
        m[0x26] = 1; m[0x27] = 1;
        m[0x2c] = 9; m[0x2d] = 9;
      }
    }
    m[0x10] = 0; m[0x11] &= 0x03;
    m[0x32] = 1; m[0x33] = 1;
    this.alph = this.buildAlphabets();
    this.uni = this.buildUnicode();
    this.pc = this.w(0x06);
    this.stack = [];
    this.frames = [{ ret: 0, store: -1, locals: [], sp: 0, argc: 0 }];
    this.state = null;
    this.pending = null;
    this.buf = "";
    this.style = 0;
    this.win = 0;
    this.upperHeight = 0;
    this.grid = [];
    this.ucur = { r: 0, c: 0 };
    this.mstack = [];
    this.seed = 1;
    this.rand = null;
    this.undo = null;
    this.status = null;
  }

  buildAlphabets() {
    const custom = this.version >= 5 ? this.w(0x34) : 0;
    const out = [[], [], []];
    if (custom) {
      for (let a = 0; a < 3; a++) for (let i = 0; i < 26; i++) out[a].push(this.mem[custom + a * 26 + i]);
    } else {
      for (let i = 0; i < 26; i++) { out[0].push(A0.charCodeAt(i)); out[1].push(A1.charCodeAt(i)); }
      for (let i = 0; i < 26; i++) out[2].push(A2.charCodeAt(i));
    }
    out[2][0] = 0; out[2][1] = 13;
    return out;
  }
  buildUnicode() {
    if (this.version >= 5) {
      const ext = this.w(0x36);
      if (ext && this.w(ext) >= 3) {
        const t = this.w(ext + 6);
        if (t) {
          const n = this.mem[t], list = [];
          for (let i = 0; i < n; i++) list.push(String.fromCharCode(this.w(t + 1 + 2 * i)));
          return list;
        }
      }
    }
    return Array.from(DEFAULT_UNI);
  }

  w(a) { return (this.mem[a] << 8) | this.mem[a + 1]; }
  sw(a, v) { this.mem[a] = (v >> 8) & 0xff; this.mem[a + 1] = v & 0xff; }

  // ---- 変数 ----
  frame() { return this.frames[this.frames.length - 1]; }
  getVar(v) {
    if (v === 0) {
      if (!this.stack.length) throw new Error("スタックが空です");
      return this.stack.pop();
    }
    if (v < 16) return this.frame().locals[v - 1] | 0;
    return this.w(this.globals + 2 * (v - 16));
  }
  setVar(v, x) {
    x &= 0xffff;
    if (v === 0) this.stack.push(x);
    else if (v < 16) this.frame().locals[v - 1] = x;
    else this.sw(this.globals + 2 * (v - 16), x);
  }
  peekVar(v) { return v === 0 ? this.stack[this.stack.length - 1] : this.getVar(v); }
  pokeVar(v, x) {
    if (v === 0) this.stack[this.stack.length - 1] = x & 0xffff;
    else this.setVar(v, x);
  }

  fetchB() { return this.mem[this.pc++]; }
  fetchW() { const x = this.w(this.pc); this.pc += 2; return x; }
  store(x) { this.setVar(this.fetchB(), x); }
  branch(cond) {
    const b = this.fetchB();
    const on = !!(b & 0x80);
    let off;
    if (b & 0x40) off = b & 0x3f;
    else {
      off = ((b & 0x3f) << 8) | this.fetchB();
      if (off & 0x2000) off -= 0x4000;
    }
    if (!!cond === on) {
      if (off === 0) this.ret(0);
      else if (off === 1) this.ret(1);
      else this.pc += off - 2;
    }
  }

  // ---- 呼び出し ----
  unpackR(p) {
    const v = this.version;
    if (v <= 3) return 2 * p;
    if (v <= 5) return 4 * p;
    if (v === 7) return 4 * p + 8 * this.w(0x28);
    return 8 * p;
  }
  unpackS(p) {
    const v = this.version;
    if (v <= 3) return 2 * p;
    if (v <= 5) return 4 * p;
    if (v === 7) return 4 * p + 8 * this.w(0x2a);
    return 8 * p;
  }
  call(packed, args, storeVar) {
    if (packed === 0) {
      if (storeVar >= 0) this.setVar(storeVar, 0);
      return;
    }
    const a = this.unpackR(packed);
    const n = this.mem[a];
    let p = a + 1;
    const locals = [];
    for (let i = 0; i < n; i++) {
      if (this.version <= 4) { locals.push(this.w(p)); p += 2; } else locals.push(0);
    }
    for (let i = 0; i < args.length && i < n; i++) locals[i] = args[i];
    this.frames.push({ ret: this.pc, store: storeVar, locals, sp: this.stack.length, argc: args.length });
    this.pc = p;
  }
  ret(val) {
    const f = this.frames.pop();
    if (!this.frames.length) throw new Error("最上位のルーチンから戻りました");
    this.stack.length = f.sp;
    this.pc = f.ret;
    if (f.store >= 0) this.setVar(f.store, val);
  }

  // ---- オブジェクト ----
  oa(n) { return this.objBase + (n - 1) * (this.version <= 3 ? 9 : 14); }
  getAttr(o, a) { return (this.mem[this.oa(o) + (a >> 3)] >> (7 - (a & 7))) & 1; }
  setAttr(o, a, on) {
    const i = this.oa(o) + (a >> 3), bit = 0x80 >> (a & 7);
    if (on) this.mem[i] |= bit; else this.mem[i] &= ~bit;
  }
  rel(o, k) {
    const a = this.oa(o);
    if (this.version <= 3) return this.mem[a + 4 + k];
    return this.w(a + 6 + 2 * k);
  }
  setRel(o, k, x) {
    const a = this.oa(o);
    if (this.version <= 3) this.mem[a + 4 + k] = x;
    else this.sw(a + 6 + 2 * k, x);
  }
  parent(o) { return this.rel(o, 0); }
  sibling(o) { return this.rel(o, 1); }
  child(o) { return this.rel(o, 2); }
  removeObj(o) {
    const p = this.parent(o);
    if (!p) return;
    if (this.child(p) === o) this.setRel(p, 2, this.sibling(o));
    else {
      let c = this.child(p);
      while (c && this.sibling(c) !== o) c = this.sibling(c);
      if (c) this.setRel(c, 1, this.sibling(o));
    }
    this.setRel(o, 0, 0);
    this.setRel(o, 1, 0);
  }
  insertObj(o, d) {
    this.removeObj(o);
    this.setRel(o, 0, d);
    this.setRel(o, 1, this.child(d));
    this.setRel(d, 2, o);
  }
  propTable(o) {
    const a = this.oa(o);
    return this.w(a + (this.version <= 3 ? 7 : 12));
  }
  shortName(o) {
    if (!o) return "";
    const pt = this.propTable(o);
    return this.zcodes(pt + 1).text.map(c => this.zchr(c)).join("");
  }
  firstProp(o) {
    const pt = this.propTable(o);
    return pt + 1 + 2 * this.mem[pt];
  }
  propInfo(a) {
    const b = this.mem[a];
    if (this.version <= 3) return { num: b & 31, size: (b >> 5) + 1, hdr: 1 };
    if (b & 0x80) {
      let size = this.mem[a + 1] & 63;
      if (size === 0) size = 64;
      return { num: b & 63, size, hdr: 2 };
    }
    return { num: b & 63, size: b & 0x40 ? 2 : 1, hdr: 1 };
  }
  findProp(o, p) {
    let a = this.firstProp(o);
    while (this.mem[a]) {
      const i = this.propInfo(a);
      if (i.num === p) return { addr: a + i.hdr, size: i.size, next: a + i.hdr + i.size };
      if (i.num < p) return null;
      a += i.hdr + i.size;
    }
    return null;
  }
  getProp(o, p) {
    const f = this.findProp(o, p);
    if (!f) return this.w(this.objTable + 2 * (p - 1));
    return f.size === 1 ? this.mem[f.addr] : this.w(f.addr);
  }
  nextProp(o, p) {
    if (p === 0) {
      const a = this.firstProp(o);
      return this.mem[a] ? this.propInfo(a).num : 0;
    }
    const f = this.findProp(o, p);
    if (!f) return 0;
    return this.mem[f.next] ? this.propInfo(f.next).num : 0;
  }
  propLen(addr) {
    if (!addr) return 0;
    const b = this.mem[addr - 1];
    if (this.version <= 3) return (b >> 5) + 1;
    if (b & 0x80) return (b & 63) || 64;
    return b & 0x40 ? 2 : 1;
  }

  // ---- 文字列 ----
  zchr(c) {
    if (c === 13 || c === 10) return "\n";
    if (c >= 32 && c <= 126) return String.fromCharCode(c);
    if (c >= 155 && c <= 251) return this.uni[c - 155] || "?";
    return "";
  }
  // Z 文字列を ZSCII コードの並びにする。{text, end}
  zcodes(addr, noAbbrev) {
    const m = this.mem, v = this.version;
    const zc = [];
    let a = addr;
    for (;;) {
      const x = this.w(a); a += 2;
      zc.push((x >> 10) & 31, (x >> 5) & 31, x & 31);
      if (x & 0x8000) break;
    }
    const out = [];
    let cur = 0, lock = 0;
    for (let i = 0; i < zc.length; i++) {
      const z = zc[i];
      if (z === 0) { out.push(32); cur = lock; continue; }
      if (v === 1 && z === 1) { out.push(13); cur = lock; continue; }
      if ((v >= 3 && z >= 1 && z <= 3) || (v === 2 && z === 1)) {
        const nx = zc[++i];
        if (nx === undefined || noAbbrev) continue;
        const idx = 32 * (z - 1) + nx;
        const sa = this.w(this.abbrevs + 2 * idx) * 2;
        for (const c of this.zcodes(sa, true).text) out.push(c);
        cur = lock;
        continue;
      }
      if (z === 4 || z === 5) {
        if (v <= 2 && z >= 4) { lock = cur = (cur + (z - 3)) % 3; }
        else cur = z - 3;
        continue;
      }
      if (v <= 2 && (z === 2 || z === 3)) { cur = (lock + (z - 1)) % 3; continue; }
      if (cur === 2 && z === 6) {
        const hi = zc[++i], lo = zc[++i];
        if (hi !== undefined && lo !== undefined) out.push((hi << 5) | lo);
        cur = lock;
        continue;
      }
      out.push(this.alph[cur][z - 6]);
      cur = lock;
    }
    return { text: out, end: a };
  }
  // 単語を辞書の形に符号化する
  encodeWord(codes) {
    const res = this.version <= 3 ? 6 : 9;
    const z = [];
    for (const c of codes) {
      if (z.length >= res) break;
      let i = this.alph[0].indexOf(c);
      if (i >= 0) { z.push(6 + i); continue; }
      i = this.alph[1].indexOf(c);
      if (i >= 0) { z.push(4, 6 + i); continue; }
      i = this.alph[2].indexOf(c);
      if (i >= 2) { z.push(5, 6 + i); continue; }
      z.push(5, 6, (c >> 5) & 31, c & 31);
    }
    while (z.length < res) z.push(5);
    z.length = res;
    const bytes = [];
    for (let i = 0; i < res; i += 3) {
      let x = (z[i] << 10) | (z[i + 1] << 5) | z[i + 2];
      if (i + 3 >= res) x |= 0x8000;
      bytes.push(x >> 8, x & 255);
    }
    return bytes;
  }

  // ---- 出力 ----
  emit(codes) {
    if (this.mstack.length) {
      const t = this.mstack[this.mstack.length - 1];
      for (const c of codes) {
        this.mem[t.addr + 2 + t.len] = c === 10 ? 13 : c;
        t.len++;
      }
      return;
    }
    if (this.win === 1) {
      for (const c of codes) this.upperChar(c);
      return;
    }
    let s = "";
    for (const c of codes) s += this.zchr(c);
    this.buf += s;
  }
  flush() {
    if (this.buf) {
      if (this.host.out) this.host.out(this.buf, this.style);
      this.buf = "";
    }
  }
  setStyle(s) {
    this.flush();
    if (s === 0) this.style = 0; else this.style |= s;
  }
  upperChar(c) {
    const cur = this.ucur;
    if (c === 13 || c === 10) { cur.r++; cur.c = 0; return; }
    const ch = this.zchr(c);
    if (!ch) return;
    while (this.grid.length <= cur.r) this.grid.push([]);
    const row = this.grid[cur.r];
    while (row.length < cur.c) row.push(" ");
    row[cur.c] = ch;
    cur.c++;
  }
  upperLines() {
    const out = [];
    for (let i = 0; i < this.upperHeight; i++) out.push((this.grid[i] || []).join("").replace(/\s+$/, ""));
    return out;
  }
  eraseUpper() { this.grid = []; this.ucur = { r: 0, c: 0 }; }
  showStatus() {
    if (this.version > 3) return;
    const room = this.shortName(this.getVar(16));
    this.status = {
      room, a: s16(this.getVar(17)), b: s16(this.getVar(18)),
      time: !!(this.mem[1] & 2),
    };
  }

  // ---- 入力 ----
  // 一行入力をゲームに渡して、続きを実行する
  submitLine(text) {
    const p = this.pending;
    if (!p || p.kind !== "read") return;
    const m = this.mem, v = this.version;
    let codes = [];
    for (const ch of text.toLowerCase()) {
      const c = ch.codePointAt(0);
      if (c >= 32 && c <= 126) codes.push(c);
      else {
        const i = this.uni.indexOf(ch);
        codes.push(i >= 0 ? 155 + i : 63);
      }
    }
    if (codes.length > p.maxLen) codes = codes.slice(0, p.maxLen);
    const t = p.textAddr;
    if (v <= 4) {
      for (let i = 0; i < codes.length; i++) m[t + 1 + i] = codes[i];
      m[t + 1 + codes.length] = 0;
    } else {
      m[t + 1] = codes.length;
      for (let i = 0; i < codes.length; i++) m[t + 2 + i] = codes[i];
    }
    if (p.parseAddr) this.tokenise(t, p.parseAddr, 0, false);
    if (v >= 5) this.setVar(p.storeVar, 13);
    this.pending = null;
    this.state = null;
  }
  submitChar(code) {
    const p = this.pending;
    if (!p || p.kind !== "char") return;
    this.setVar(p.storeVar, code);
    this.pending = null;
    this.state = null;
  }
  readDict(addr) {
    const m = this.mem;
    const n = m[addr];
    const seps = new Set();
    for (let i = 0; i < n; i++) seps.add(m[addr + 1 + i]);
    const entLen = m[addr + 1 + n];
    const count = Math.abs(s16(this.w(addr + 2 + n)));
    return { seps, entLen, count, base: addr + 4 + n };
  }
  lookup(dict, codes) {
    const key = this.encodeWord(codes);
    const m = this.mem;
    for (let i = 0; i < dict.count; i++) {
      const a = dict.base + i * dict.entLen;
      let ok = true;
      for (let k = 0; k < key.length; k++) if (m[a + k] !== key[k]) { ok = false; break; }
      if (ok) return a;
    }
    return 0;
  }
  tokenise(textAddr, parseAddr, dictAddr, skip) {
    const m = this.mem, v = this.version;
    let start, len;
    if (v >= 5) { len = m[textAddr + 1]; start = textAddr + 2; }
    else { start = textAddr + 1; len = 0; while (m[start + len]) len++; }
    const chars = [];
    for (let i = 0; i < len; i++) {
      let c = m[start + i];
      if (c >= 65 && c <= 90) c += 32;
      chars.push(c);
    }
    const dict = this.readDict(dictAddr || this.dictAddr);
    const max = m[parseAddr];
    let count = 0, i = 0;
    while (i < len && count < max) {
      const c = chars[i];
      if (c === 32) { i++; continue; }
      let word, pos = i;
      if (dict.seps.has(c)) { word = [c]; i++; }
      else {
        while (i < len && chars[i] !== 32 && !dict.seps.has(chars[i])) i++;
        word = chars.slice(pos, i);
      }
      const entry = this.lookup(dict, word);
      if (!(skip && entry === 0)) {
        const pa = parseAddr + 2 + 4 * count;
        this.sw(pa, entry);
        m[pa + 2] = word.length;
        m[pa + 3] = pos + (start - textAddr);
      }
      count++;
    }
    m[parseAddr + 1] = count;
  }

  // ---- 保存と復元 ----
  snapshot(pc) {
    return {
      mem: this.mem.slice(0, this.staticBase),
      stack: this.stack.slice(),
      frames: this.frames.map(f => ({ ret: f.ret, store: f.store, locals: f.locals.slice(), sp: f.sp, argc: f.argc })),
      pc,
    };
  }
  loadSnapshot(s) {
    const keep1 = this.mem[0x11] & 0x03, keepFlags1 = this.mem[1];
    const hdr = this.mem.slice(0x1e, 0x40);
    this.mem.set(s.mem, 0);
    this.mem.set(hdr, 0x1e);
    this.mem[1] = keepFlags1;
    this.mem[0x11] = (this.mem[0x11] & ~0x03) | keep1;
    this.stack = s.stack.slice();
    this.frames = s.frames.map(f => ({ ret: f.ret, store: f.store, locals: f.locals.slice(), sp: f.sp, argc: f.argc }));
    this.pc = s.pc;
  }
  // 元のゲームとの差を RLE にして、JSON にできる形で返す
  makeSave(snap) {
    const diff = new Uint8Array(snap.mem.length);
    for (let i = 0; i < diff.length; i++) diff[i] = snap.mem[i] ^ this.story[i];
    const rle = [];
    for (let i = 0; i < diff.length;) {
      if (diff[i] === 0) {
        let j = i;
        while (j < diff.length && diff[j] === 0 && j - i < 65535) j++;
        rle.push(0, (j - i) >> 8, (j - i) & 255);
        i = j;
      } else { rle.push(diff[i]); i++; }
    }
    let bin = "";
    for (let i = 0; i < rle.length; i += 8192) bin += String.fromCharCode.apply(null, rle.slice(i, i + 8192));
    return {
      v: 1, rel: this.w(0x02) + ":" + this.w(0x1c), len: diff.length,
      rle: typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64"),
      stack: snap.stack, frames: snap.frames, pc: snap.pc,
    };
  }
  readSave(o) {
    if (!o || o.v !== 1 || o.rel !== this.w(0x02) + ":" + this.w(0x1c)) return null;
    const bin = typeof atob === "function" ? atob(o.rle) : Buffer.from(o.rle, "base64").toString("binary");
    const mem = new Uint8Array(o.len);
    let k = 0;
    for (let i = 0; i < bin.length;) {
      const b = bin.charCodeAt(i++);
      if (b === 0) {
        const n = (bin.charCodeAt(i) << 8) | bin.charCodeAt(i + 1); i += 2;
        for (let j = 0; j < n; j++, k++) mem[k] = this.story[k];
      } else { mem[k] = b ^ this.story[k]; k++; }
    }
    return { mem, stack: o.stack, frames: o.frames, pc: o.pc };
  }
  // 入力待ちの状態をそのまま書き出す／戻す（自動保存用）
  exportWaiting() {
    if (!this.pending || this.state === null) return null;
    const o = this.makeSave(this.snapshot(this.pc));
    o.pending = Object.assign({}, this.pending);
    o.state = Object.assign({}, this.state);
    o.upper = { h: this.upperHeight, grid: this.grid.map(r => r.join("")) };
    return o;
  }
  importWaiting(o) {
    const snap = this.readSave(o);
    if (!snap || !o.pending) return null;
    this.loadSnapshot(snap);
    this.buf = "";
    this.pending = o.pending;
    this.state = o.state;
    if (o.upper) { this.upperHeight = o.upper.h; this.grid = o.upper.grid.map(s => Array.from(s)); }
    return this.state;
  }
  // 辞書の単語の一覧（入力の候補に使う）
  dictWords() {
    if (this._words) return this._words;
    const d = this.readDict(this.dictAddr);
    const out = [];
    for (let i = 0; i < d.count; i++) {
      const w = this.zcodes(d.base + i * d.entLen).text.map(c => this.zchr(c)).join("").trim();
      if (/^[a-z][a-z'-]*$/.test(w)) out.push(w);
    }
    this._words = out;
    return out;
  }
  doSave(kind) {
    const snap = this.snapshot(this.pc);
    let ok = false;
    if (this.host.save) {
      try { ok = !!this.host.save(this.makeSave(snap)); } catch (e) { ok = false; }
    }
    if (kind === "branch") this.branch(ok); else this.store(ok ? 1 : 0);
  }
  doRestore(kind) {
    let snap = null;
    if (this.host.restore) {
      try { snap = this.readSave(this.host.restore()); } catch (e) { snap = null; }
    }
    if (!snap) {
      if (kind === "branch") this.branch(false); else this.store(0);
      return;
    }
    this.loadSnapshot(snap);
    this.buf = "";
    if (kind === "branch") this.branch(true); else this.store(2);
  }

  // ---- 実行 ----
  run() {
    this.state = null;
    while (this.state === null) this.step();
    this.flush();
    return this.state;
  }

  step() {
    const m = this.mem, v = this.version;
    let code = m[this.pc++];
    let kind, num;
    const types = [];
    if (code === 0xbe && v >= 5) {
      kind = "EXT"; num = m[this.pc++];
      this.readTypes(m[this.pc++], types);
    } else if (code & 0x80) {
      if (code & 0x40) {
        num = code & 0x1f;
        kind = code & 0x20 ? "VAR" : "OP2";
        this.readTypes(m[this.pc++], types);
        if (kind === "VAR" && (num === 12 || num === 26)) this.readTypes(m[this.pc++], types);
      } else {
        const t = (code >> 4) & 3;
        num = code & 15;
        if (t === 3) kind = "OP0"; else { kind = "OP1"; types.push(t); }
      }
    } else {
      kind = "OP2"; num = code & 0x1f;
      types.push(code & 0x40 ? 2 : 1, code & 0x20 ? 2 : 1);
    }
    const o = [];
    for (const t of types) {
      if (t === 0) o.push(this.fetchW());
      else if (t === 1) o.push(this.fetchB());
      else if (t === 2) o.push(this.getVar(this.fetchB()));
    }
    switch (kind) {
      case "OP2": return this.op2(num, o);
      case "OP1": return this.op1(num, o);
      case "OP0": return this.op0(num);
      case "VAR": return this.opVar(num, o);
      default: return this.opExt(num, o);
    }
  }
  readTypes(b, types) {
    for (let s = 6; s >= 0; s -= 2) {
      const t = (b >> s) & 3;
      if (t === 3) { for (; s >= 0; s -= 2) { /* 残りは省略 */ } break; }
      types.push(t);
    }
  }
  indirect(o0) { return o0 & 0xff; }

  op2(n, o) {
    const [a, b] = o;
    switch (n) {
      case 1: { let hit = false; for (let i = 1; i < o.length; i++) if (o[i] === a) hit = true; return this.branch(hit); }
      case 2: return this.branch(s16(a) < s16(b));
      case 3: return this.branch(s16(a) > s16(b));
      case 4: { const x = (s16(this.peekVar(a)) - 1) & 0xffff; this.pokeVar(a, x); return this.branch(s16(x) < s16(b)); }
      case 5: { const x = (s16(this.peekVar(a)) + 1) & 0xffff; this.pokeVar(a, x); return this.branch(s16(x) > s16(b)); }
      case 6: return this.branch(this.parent(a) === b);
      case 7: return this.branch((a & b) === b);
      case 8: return this.store(a | b);
      case 9: return this.store(a & b);
      case 10: return this.branch(this.getAttr(a, b));
      case 11: return this.setAttr(a, b, 1);
      case 12: return this.setAttr(a, b, 0);
      case 13: return this.pokeVar(a, b);
      case 14: return this.insertObj(a, b);
      case 15: return this.store(this.w((a + 2 * b) & 0xffff));
      case 16: return this.store(this.mem[(a + b) & 0xffff]);
      case 17: return this.store(this.getProp(a, b));
      case 18: { const f = this.findProp(a, b); return this.store(f ? f.addr : 0); }
      case 19: return this.store(this.nextProp(a, b));
      case 20: return this.store((s16(a) + s16(b)) & 0xffff);
      case 21: return this.store((s16(a) - s16(b)) & 0xffff);
      case 22: return this.store(Math.imul(s16(a), s16(b)) & 0xffff);
      case 23: if (!s16(b)) throw new Error("0 で割りました"); return this.store(Math.trunc(s16(a) / s16(b)) & 0xffff);
      case 24: if (!s16(b)) throw new Error("0 で割りました"); return this.store((s16(a) % s16(b)) & 0xffff);
      case 25: return this.call(a, [b], this.fetchB());
      case 26: return this.call(a, [b], -1);
      case 27: return;
      case 28: { // throw
        const target = b;
        this.frames.length = target + 1;
        return this.ret(a);
      }
      default: throw new Error("未対応の命令 2OP:" + n);
    }
  }

  op1(n, o) {
    const a = o[0];
    switch (n) {
      case 0: return this.branch(a === 0);
      case 1: { const s = this.sibling(a); this.store(s); return this.branch(s !== 0); }
      case 2: { const c = this.child(a); this.store(c); return this.branch(c !== 0); }
      case 3: return this.store(this.parent(a));
      case 4: return this.store(this.propLen(a));
      case 5: { const x = (s16(this.peekVar(a)) + 1) & 0xffff; return this.pokeVar(a, x); }
      case 6: { const x = (s16(this.peekVar(a)) - 1) & 0xffff; return this.pokeVar(a, x); }
      case 7: return this.emit(this.zcodes(a).text);
      case 8: return this.call(a, [], this.fetchB());
      case 9: return this.removeObj(a);
      case 10: return this.emit(this.zcodes(this.propTable(a) + 1).text);
      case 11: return this.ret(a);
      case 12: this.pc += s16(a) - 2; return;
      case 13: return this.emit(this.zcodes(this.unpackS(a)).text);
      case 14: return this.store(this.peekVar(a));
      case 15:
        if (this.version <= 4) return this.store(~a & 0xffff);
        return this.call(a, [], -1);
      default: throw new Error("未対応の命令 1OP:" + n);
    }
  }

  op0(n) {
    const v = this.version;
    switch (n) {
      case 0: return this.ret(1);
      case 1: return this.ret(0);
      case 2: { const r = this.zcodes(this.pc); this.pc = r.end; return this.emit(r.text); }
      case 3: { const r = this.zcodes(this.pc); this.pc = r.end; this.emit(r.text); this.emit([13]); return this.ret(1); }
      case 4: return;
      case 5: return this.doSave(v <= 3 ? "branch" : "store");
      case 6: return this.doRestore(v <= 3 ? "branch" : "store");
      case 7: this.flush(); this.restart(); return;
      case 8: return this.ret(this.stack.pop());
      case 9:
        if (v >= 5) return this.store(this.frames.length - 1);
        this.stack.pop(); return;
      case 10: this.flush(); this.state = { type: "quit" }; return;
      case 11: return this.emit([13]);
      case 12: return this.showStatus();
      case 13: return this.branch(true);
      case 15: return this.branch(true);
      default: throw new Error("未対応の命令 0OP:" + n);
    }
  }

  opVar(n, o) {
    const m = this.mem, v = this.version;
    switch (n) {
      case 0: return this.call(o[0], o.slice(1), this.fetchB());
      case 1: return this.sw((o[0] + 2 * o[1]) & 0xffff, o[2]);
      case 2: m[(o[0] + o[1]) & 0xffff] = o[2] & 0xff; return;
      case 3: {
        const f = this.findProp(o[0], o[1]);
        if (!f) throw new Error("存在しないプロパティへの書き込み");
        if (f.size === 1) m[f.addr] = o[2] & 0xff; else this.sw(f.addr, o[2]);
        return;
      }
      case 4: { // read
        const storeVar = v >= 5 ? this.fetchB() : -1;
        if (v <= 3) this.showStatus();
        this.flush();
        const t = o[0];
        this.pending = {
          kind: "read", textAddr: t, parseAddr: o[1] || 0, storeVar,
          maxLen: v <= 4 ? m[t] - 1 : m[t],
        };
        this.state = { type: "line" };
        return;
      }
      case 5: return this.emit([o[0]]);
      case 6: return this.emit(Array.from(String(s16(o[0]))).map(c => c.charCodeAt(0)));
      case 7: {
        const r = s16(o[0]);
        if (r > 0) return this.store(1 + Math.floor(this.random() * r));
        this.seed = r === 0 ? (Date.now() & 0x7fffffff) : Math.abs(r);
        this.rand = null;
        return this.store(0);
      }
      case 8: this.stack.push(o[0] & 0xffff); return;
      case 9: {
        if (o[0] === 0) { const x = this.stack.pop(); this.stack.pop(); this.stack.push(x); return; }
        return this.pokeVar(o[0], this.stack.pop());
      }
      case 10: { // split_window
        this.flush();
        this.upperHeight = o[0];
        if (v === 3) this.eraseUpper();
        return;
      }
      case 11: // set_window
        this.flush();
        this.win = o[0] === 1 ? 1 : 0;
        if (this.win === 1) this.ucur = { r: 0, c: 0 };
        return;
      case 12: return this.call(o[0], o.slice(1), this.fetchB());
      case 13: { // erase_window
        const w = s16(o[0]);
        this.flush();
        if (w === -1) { this.upperHeight = 0; this.eraseUpper(); if (this.host.clear) this.host.clear(); }
        else if (w === -2) { this.eraseUpper(); if (this.host.clear) this.host.clear(); }
        else if (w === 0) { if (this.host.clear) this.host.clear(); }
        else if (w === 1) this.eraseUpper();
        return;
      }
      case 14: return;
      case 15: // set_cursor
        if (this.win === 1) this.ucur = { r: Math.max(0, o[0] - 1), c: Math.max(0, (o[1] || 1) - 1) };
        return;
      case 16: // get_cursor
        this.sw(o[0], this.win === 1 ? this.ucur.r + 1 : 1);
        this.sw(o[0] + 2, this.win === 1 ? this.ucur.c + 1 : 1);
        return;
      case 17: return this.setStyle(o[0] & 0xffff);
      case 18: return;
      case 19: { // output_stream
        const n2 = s16(o[0]);
        if (n2 === 3) this.mstack.push({ addr: o[1], len: 0 });
        else if (n2 === -3 && this.mstack.length) {
          const t = this.mstack.pop();
          this.sw(t.addr, t.len);
        }
        return;
      }
      case 20: return;
      case 21: return;
      case 22: { // read_char
        const storeVar = this.fetchB();
        this.flush();
        this.pending = { kind: "char", storeVar };
        this.state = { type: "char" };
        return;
      }
      case 23: { // scan_table
        const [x, table, len] = o;
        const form = o.length > 3 ? o[3] : 0x82;
        const words = form & 0x80, step = form & 0x7f;
        let found = 0;
        for (let i = 0; i < len; i++) {
          const a = table + i * step;
          if ((words ? this.w(a) : m[a]) === x) { found = a; break; }
        }
        this.store(found);
        return this.branch(found !== 0);
      }
      case 24: return this.store(~o[0] & 0xffff);
      case 25: return this.call(o[0], o.slice(1), -1);
      case 26: return this.call(o[0], o.slice(1), -1);
      case 27: return this.tokenise(o[0], o[1], o[2] || 0, !!o[3]);
      case 28: { // encode_text
        const [text, len, from, dest] = o;
        const codes = [];
        for (let i = 0; i < len; i++) codes.push(m[text + from + i]);
        const enc = this.encodeWord(codes);
        for (let i = 0; i < enc.length; i++) m[dest + i] = enc[i];
        return;
      }
      case 29: { // copy_table
        const [first, second] = o;
        let size = s16(o[2]);
        if (second === 0) { for (let i = 0; i < Math.abs(size); i++) m[first + i] = 0; return; }
        if (size > 0 && second > first && second < first + size) {
          for (let i = size - 1; i >= 0; i--) m[second + i] = m[first + i];
        } else {
          size = Math.abs(size);
          for (let i = 0; i < size; i++) m[second + i] = m[first + i];
        }
        return;
      }
      case 30: { // print_table
        const [table, width] = o;
        const h = o.length > 2 ? o[2] : 1, skip = o.length > 3 ? o[3] : 0;
        let a = table;
        for (let r = 0; r < h; r++) {
          const row = [];
          for (let i = 0; i < width; i++) row.push(m[a + i]);
          this.emit(row);
          if (r < h - 1) this.emit([13]);
          a += width + skip;
        }
        return;
      }
      case 31: return this.branch(o[0] <= this.frame().argc);
      default: throw new Error("未対応の命令 VAR:" + n);
    }
  }

  opExt(n, o) {
    const v = this.version;
    switch (n) {
      case 0: return this.doSave("store");
      case 1: return this.doRestore("store");
      case 2: { const s = s16(o[1]); return this.store(s >= 0 ? (o[0] << s) & 0xffff : (o[0] >>> -s) & 0xffff); }
      case 3: { const s = s16(o[1]); return this.store(s >= 0 ? (s16(o[0]) << s) & 0xffff : (s16(o[0]) >> -s) & 0xffff); }
      case 4: return this.store(o[0] === 1 || o[0] === 4 ? 1 : 0);
      case 9: { this.undo = this.snapshot(this.pc); return this.store(1); }
      case 10: {
        if (!this.undo) return this.store(0);
        this.loadSnapshot(this.undo);
        return this.store(2);
      }
      case 11: { // print_unicode
        const c = o[0];
        if (c === 10) return this.emit([13]);
        if (c >= 32 && c <= 126) return this.emit([c]);
        const i = this.uni.indexOf(String.fromCharCode(c));
        if (i >= 0) return this.emit([155 + i]);
        if (this.win === 0 && !this.mstack.length) this.buf += String.fromCharCode(c);
        return;
      }
      case 12: return this.store(o[0] >= 32 ? 3 : 1);
      case 13: return; // set_true_colour など
      default: throw new Error("未対応の命令 EXT:" + n + "（バージョン " + v + "）");
    }
  }

  random() {
    if (!this.rand) {
      let a = this.seed >>> 0;
      this.rand = () => {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    return this.rand();
  }
}

if (typeof module !== "undefined") module.exports = { ZVM };
