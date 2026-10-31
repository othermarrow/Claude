// glkote-mini.js — Quixe（Glulx 仮想機械）と glkapi.js のあいだに入る、小さな画面側の部品。
// 本物の GlkOte（jQuery を使う大きな画面ライブラリ）のかわりに、GlkOte と Dialog の窓口だけを作り、
// 出力はアプリの記録欄へ、入力はアプリの入力欄から受け渡す。
// 使い方: YGlk.start(Uint8Array の Glulx, host) → host.out(文字列, スタイル) / host.grid(窓, 行の配列) などが呼ばれる。
"use strict";

(function () {
  const STYLE_BITS = { input: 16, emphasized: 4, preformatted: 8, header: 2, subheader: 2, alert: 2, note: 4, blockquote: 4 };
  const METRICS = {
    width: 80, height: 400, outspacingx: 0, outspacingy: 0, inspacingx: 0, inspacingy: 0,
    gridcharwidth: 1, gridcharheight: 1, gridmarginx: 0, gridmarginy: 0,
    buffercharwidth: 1, buffercharheight: 1, buffermarginx: 0, buffermarginy: 0,
    graphicsmarginx: 0, graphicsmarginy: 0,
  };

  const Y = { host: null, accept: null, gen: 0, windows: {}, pending: null, state: { type: "init" }, grids: {}, started: false };

  // ---- Dialog：セーブなどのファイルを、localStorage に置く ----
  const mem = {};
  function fkey(ref) { return "yoru.glk." + (Y.prefix || "") + "." + (ref.usage || "") + "." + ref.filename; }
  function b64(arr) {
    let bin = "";
    for (let i = 0; i < arr.length; i += 8192) bin += String.fromCharCode.apply(null, arr.slice(i, i + 8192));
    return btoa(bin);
  }
  window.Dialog = {
    streaming: false,
    // 一覧に出すためのファイル名の掃除
    file_clean_fixed_name(name) {
      name = String(name).replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 60);
      return name || "file";
    },
    file_construct_ref(filename, usage, gameid) { return { filename, usage: usage || "", gameid: gameid || "" }; },
    file_construct_temp_ref(usage) { return { filename: "temp" + Math.random().toString(36).slice(2, 8), usage: usage || "", gameid: "", temp: true }; },
    file_ref_exists(ref) {
      const k = fkey(ref);
      if (k in mem) return true;
      try { return localStorage.getItem(k) !== null; } catch (e) { return false; }
    },
    file_remove_ref(ref) {
      const k = fkey(ref);
      delete mem[k];
      try { localStorage.removeItem(k); } catch (e) { /* 消せなくてもよい */ }
    },
    file_write(ref, content) {
      const k = fkey(ref);
      let rec;
      if (typeof content === "string") rec = { t: "s", d: content };
      else {
        let bytes = true;
        for (let i = 0; i < content.length; i++) if (content[i] > 255 || content[i] < 0) { bytes = false; break; }
        rec = bytes ? { t: "b", d: b64(Array.from(content)) } : { t: "j", d: Array.from(content) };
      }
      const json = JSON.stringify(rec);
      mem[k] = json;
      if (!ref.temp) { try { localStorage.setItem(k, json); } catch (e) { /* 保存できなくても遊べる */ } }
      return true;
    },
    file_read(ref) {
      const k = fkey(ref);
      let json = mem[k];
      if (json === undefined) { try { json = localStorage.getItem(k); } catch (e) { json = null; } }
      if (json === null || json === undefined) return null;
      const rec = JSON.parse(json);
      if (rec.t === "b") return Array.from(atob(rec.d), c => c.charCodeAt(0));
      if (rec.t === "s") return Array.from(rec.d, c => c.charCodeAt(0));
      return rec.d;
    },
    autosave_write() {}, autosave_read() { return null; },
  };

  // ---- GlkOte：glkapi.js が呼ぶ窓口 ----
  window.GlkOte = {
    init(opts) {
      Y.accept = opts.accept;
      Y.started = true;
      setTimeout(() => Y.fire({ type: "init", gen: 0, metrics: METRICS, support: [] }), 0);
    },
    update(obj) { Y.update(obj); },
    extevent() {},
    getinterface() { return {}; },
    log(msg) { if (Y.debug) console.log("[glk]", msg); },
    warning(msg) { if (Y.host && Y.host.note) Y.host.note("（注意: " + msg + "）"); },
    error(msg) { Y.finish(); if (Y.host && Y.host.note) Y.host.note("ゲームでエラーが起きました: " + msg); },
    save_allstate() { return null; },
  };

  Y.fire = function (ev) {
    try { Y.accept(ev); }
    catch (e) {
      Y.finish();
      if (Y.host && Y.host.note) Y.host.note("エラーが起きました: " + (e && e.message ? e.message : e));
      if (Y.host && Y.host.flush) Y.host.flush(Y.state);
    }
  };
  Y.finish = function () { Y.pending = null; Y.state = { type: "quit" }; };

  // buffer の段落の並びを、文字の流れにする
  function textOf(content) {
    const segs = [];
    if (!content) return segs;
    for (let i = 0; i < content.length; i++) {
      const c = content[i];
      if (typeof c === "string") { // [スタイル名, 本文, ...]
        const style = c, text = content[++i];
        if (text) segs.push({ t: text, s: STYLE_BITS[style] || 0 });
      } else if (c && c.text) segs.push({ t: c.text, s: STYLE_BITS[c.style] || 0 });
    }
    return segs;
  }

  Y.update = function (obj) {
    if (obj.type !== "update") return;
    Y.gen = obj.gen;
    const host = Y.host;
    if (obj.windows) {
      Y.windows = {};
      for (const w of obj.windows) Y.windows[w.id] = w;
    }
    for (const c of obj.content || []) {
      const win = Y.windows[c.id];
      if (!win) continue;
      if (win.type === "buffer") {
        if (c.clear && host.clear) { Y.first = true; host.clear(); }
        for (const p of c.text || []) {
          const segs = textOf(p.content);
          if (!p.append && !Y.first) host.out("\n", 0);
          Y.first = false;
          for (const s of segs) host.out(s.t, s.s);
        }
      } else if (win.type === "grid") {
        const lines = Y.grids[c.id] || (Y.grids[c.id] = []);
        for (const ln of c.lines || []) {
          lines[ln.line] = textOf(ln.content).map(s => s.t).join("");
        }
      }
    }
    // 文字を出さない窓が消えたら、その上の窓の記録も捨てる
    for (const id of Object.keys(Y.grids)) if (!Y.windows[id]) delete Y.grids[id];
    if (host.grid) host.grid(Object.keys(Y.grids).map(id => (Y.grids[id] || []).map(s => s || "")));
    Y.pending = null;
    let st = null;
    for (const inp of obj.input || []) {
      if (inp.type === "line" || inp.type === "char") {
        const win = Y.windows[inp.id];
        // 本文の窓の入力を優先する
        if (!Y.pending || (win && win.type === "buffer")) Y.pending = { id: inp.id, type: inp.type, maxlen: inp.maxlen, gen: inp.gen };
      }
    }
    if (obj.exit || obj.disable) st = { type: "quit" };
    else if (obj.specialinput) {
      const sp = obj.specialinput;
      setTimeout(() => Y.fileprompt(sp), 0);
      st = { type: "busy" };
    } else if (Y.pending) st = { type: Y.pending.type === "line" ? "line" : "char" };
    else st = { type: "quit" };
    Y.state = st;
    if (host.flush) host.flush(st);
  };

  // セーブ・ロードのファイル名を選ぶ場面（スロットを自動で選ぶ）
  Y.fileprompt = function (sp) {
    const slot = Y.host && Y.host.slot ? Y.host.slot() : "1";
    const usage = sp.filetype || "xxx";
    const name = usage === "save" ? "slot" + slot : usage + "-" + slot;
    const ref = Dialog.file_construct_ref(name, usage, sp.gameid || "");
    let value = ref;
    if (sp.filemode === "read" && !Dialog.file_ref_exists(ref)) {
      value = null;
      if (Y.host && Y.host.note) Y.host.note("（スロット " + slot + " には、保存がありません）");
    } else if (sp.filemode !== "read" && Y.host && Y.host.note) {
      Y.host.note("（スロット " + slot + " に保存します）");
    }
    Y.fire({ type: "specialresponse", gen: Y.gen, response: "fileref_prompt", value });
  };

  Y.submitLine = function (text) {
    const p = Y.pending;
    if (!p || p.type !== "line") return;
    Y.state = { type: "busy" };
    Y.pending = null;
    Y.fire({ type: "line", gen: Y.gen, window: p.id, value: String(text).slice(0, p.maxlen || 256) });
  };
  Y.submitChar = function (ch) {
    const p = Y.pending;
    if (!p || p.type !== "char") return;
    Y.state = { type: "busy" };
    Y.pending = null;
    const value = ch === "\n" || ch === "" ? "return" : ch.slice(0, 1);
    Y.fire({ type: "char", gen: Y.gen, window: p.id, value });
  };

  // Glulx の画像（Uint8Array）で始める
  Y.start = function (image, host) {
    Y.host = host;
    Y.windows = {}; Y.grids = {}; Y.pending = null; Y.gen = 0; Y.first = true;
    Y.state = { type: "busy" };
    const opts = {
      vm: window.Quixe, io: window.Glk, spacing: 0, rethrow_exceptions: false,
      do_vm_autosave: false, exit_warning: "", set_page_title: false,
    };
    Y.prefix = host.prefix || "";
    const bytes = Array.from(image);
    window.Quixe.prepare(bytes, opts);
    window.Glk.init(opts);
  };

  window.YGlk = Y;
  // Quixe の読み込み部品（GiLoad）が、jQuery を使う部分に触れても止まらないようにする
  if (!window.jQuery) window.jQuery = { type: x => (Array.isArray(x) ? "array" : typeof x), map: (a, f) => a.map(f), extend: Object.assign, ajax() {} };
})();
