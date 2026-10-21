// app.js — 書庫の一覧と、ゲームの画面。
// Z マシンのゲームは zvm.js で動かし、Zork I だけは辞書で日本語に訳す。
// 日本語の書き下ろし（kura/）は、Kura という別のエンジンで動かす。
"use strict";

(function () {
  const $ = id => document.getElementById(id);
  const logEl = $("log"), screenEl = $("screen"), cmdEl = $("cmd");

  // ---- 保存 ----
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* 消せなくてもよい */ } },
  };
  const key = (id, name) => "yoru." + id + "." + name;

  // 持ち込んだゲームファイルは IndexedDB に置く
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("yoru-shoko", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("stories", { keyPath: "id" });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function dbDo(mode, fn) {
    const db = await idb();
    return new Promise((res, rej) => {
      const tx = db.transaction("stories", mode);
      const req = fn(tx.objectStore("stories"));
      tx.oncomplete = () => res(req && req.result);
      tx.onerror = () => rej(tx.error);
    });
  }
  const dbAll = () => dbDo("readonly", s => s.getAll()).catch(() => []);
  const dbGet = id => dbDo("readonly", s => s.get(id));
  const dbPut = rec => dbDo("readwrite", s => s.put(rec));
  const dbDel = id => dbDo("readwrite", s => s.delete(id));

  // ゲームファイルから、Z コードか Glulx の本体を取り出す。{ fmt: "z" | "g", bytes }
  function extractStory(bytes) {
    const tag = (o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
    if (bytes.length > 12 && tag(0) === "FORM" && tag(8) === "IFRS") {
      let p = 12;
      while (p + 8 <= bytes.length) {
        const id = tag(p);
        const len = (bytes[p + 4] << 24 | bytes[p + 5] << 16 | bytes[p + 6] << 8 | bytes[p + 7]) >>> 0;
        if (id === "ZCOD") return { fmt: "z", bytes: bytes.slice(p + 8, p + 8 + len) };
        if (id === "GLUL") return { fmt: "g", bytes: bytes.slice(p + 8, p + 8 + len) };
        p += 8 + len + (len & 1);
      }
      throw new Error("blorb の中にゲームが見つかりません。");
    }
    if (tag(0) === "Glul") return { fmt: "g", bytes };
    const v = bytes[0];
    if (v < 1 || v > 8 || v === 6) throw new Error("Z-machine でも Glulx でもないようです（先頭 " + v + "）。");
    return { fmt: "z", bytes };
  }

  // ---- 画面の切り替え ----
  let cur = null;                  // いま開いているゲーム
  let rows = [];                   // 画面の記録
  let fontSize = parseInt(LS.get("yoru.font") || "17", 10);
  document.documentElement.style.setProperty("--size", fontSize + "px");
  let mode = LS.get("yoru.mode") || "both";
  document.body.className = "mode-" + mode;

  function show(view) {
    $("library").hidden = view !== "library";
    $("game").hidden = view !== "game";
  }

  // ---- 書庫（一覧） ----
  async function renderLibrary() {
    const shelf = $("shelf");
    shelf.textContent = "";
    const section = (title) => {
      const h = document.createElement("h2");
      h.textContent = title;
      shelf.append(h);
    };
    const card = (g, extra) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "card";
      const t = document.createElement("div"); t.className = "t"; t.textContent = g.title;
      const s = document.createElement("div"); s.className = "s"; s.textContent = g.sub || "";
      const tags = document.createElement("div"); tags.className = "tags";
      for (const [label, cls] of (g.tags || [])) {
        const e = document.createElement("span"); e.className = "tag " + cls; e.textContent = label; tags.append(e);
      }
      if (LS.get(key(g.id, "auto"))) {
        const e = document.createElement("span"); e.className = "tag save"; e.textContent = "続きあり"; tags.append(e);
      }
      if (g.endings) {
        let seen = [];
        try { seen = JSON.parse(LS.get(key(g.id, "endings")) || "[]"); } catch (e) { seen = []; }
        if (seen.length) {
          const e = document.createElement("span"); e.className = "tag new"; e.textContent = "結末 " + seen.length + "/" + g.endings; tags.append(e);
        }
      }
      b.append(t, s, tags);
      if (extra) b.append(extra);
      b.addEventListener("click", () => openGame(g));
      return b;
    };
    section("日本語で遊ぶ");
    for (const g of GAMES.filter(x => x.kind === "kura")) shelf.append(card(g));
    section("ZORK");
    for (const g of GAMES.filter(x => x.kind === "z")) shelf.append(card(g));

    section("持ち込んだゲーム");
    const mine = await dbAll();
    for (const rec of mine) {
      const g = { id: rec.id, kind: "z", fmt: rec.fmt || "z", title: rec.title, sub: rec.name, bytes: rec.bytes, imported: true, tags: [["英語（訳すボタン）", ""], ["持ち込み", ""], [rec.fmt === "g" ? "Glulx" : "Z-machine", ""]] };
      shelf.append(card(g));
    }
    const p = document.createElement("p");
    p.className = "note";
    p.textContent = mine.length ? "" : "ゲームファイル（.z3 .z5 .z8 .ulx .zblorb .gblorb）を、自分で用意して開けます。ファイルはこの端末の中だけに置かれます。";
    shelf.append(p);
    const row = document.createElement("div");
    row.className = "row-btns";
    const open = document.createElement("button");
    open.type = "button"; open.className = "btn primary"; open.textContent = "ゲームファイルを開く";
    open.addEventListener("click", () => $("file").click());
    row.append(open);
    if (mine.length) {
      const del = document.createElement("button");
      del.type = "button"; del.className = "btn"; del.textContent = "持ち込みを消す";
      del.addEventListener("click", delImported);
      row.append(del);
    }
    shelf.append(row);

    const d = document.createElement("details");
    d.innerHTML = "<summary>ゲームの探しかた</summary>" +
      "<p>Anchorhead や Slouching Towards Bedlam のような無料のインタラクティブ・フィクションは、IFDB（ifdb.org）や IF Archive（ifarchive.org）で名前を検索すると、配布ページが見つかります。" +
      "Z-machine 形式（.z5 .z8 .zblorb）と Glulx 形式（.ulx .gblorb）が、ここで動きます。</p>" +
      "<p>作者が再配布を認めているかは、ゲームごとに違います。配布元のページで確かめて、自分で取ってきてください。このアプリには入れていません。</p>" +
      "<p>英語のゲームは、画面右上の「⋮」にある「訳す」で、いまの場面を翻訳サービスに送れます（押したときだけ、その文章が送られます）。</p>";
    shelf.append(d);
    const v = document.createElement("p");
    v.className = "note";
    v.textContent = "Zork I〜III は Microsoft が MIT ライセンスで公開したものです（stories/LICENSE-zork.txt）。";
    shelf.append(v);
  }

  $("file").addEventListener("change", async e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      const st = extractStory(new Uint8Array(await f.arrayBuffer()));
      if (st.fmt === "z") new ZVM(st.bytes, {});
      const name = f.name;
      const title = name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
      await dbPut({ id: "u" + Date.now().toString(36), name, title, bytes: st.bytes, fmt: st.fmt });
      renderLibrary();
    } catch (err) {
      alert("このファイルは開けませんでした。\n" + (err && err.message ? err.message : err));
    }
  });

  async function delImported() {
    const mine = await dbAll();
    if (!mine.length) return;
    const names = mine.map((r, i) => (i + 1) + ". " + r.title).join("\n");
    const n = parseInt(prompt("消すゲームの番号を入れてください。\n" + names, "1") || "", 10);
    if (!n || !mine[n - 1]) return;
    for (const k of ["auto", "log", "slot1", "slot2", "slot3"]) LS.del(key(mine[n - 1].id, k));
    await dbDel(mine[n - 1].id);
    renderLibrary();
  }

  // ---- 画面の行 ----
  function rowEl(r, fresh) {
    if (r.t === "gap") { const d = document.createElement("div"); d.className = "gap"; return d; }
    if (r.t === "sep") { const d = document.createElement("div"); d.className = "sep"; return d; }
    const p = document.createElement("p");
    if (r.t === "cmd") {
      p.className = "row cmd";
      p.textContent = "> " + r.ja;
      if (r.en && r.en !== r.ja) {
        const s = document.createElement("span");
        s.className = "sent"; s.textContent = r.en; p.append(s);
      }
      return p;
    }
    if (r.t === "sys") { p.className = "row sys"; p.textContent = r.ja; return p; }
    if (r.t === "k") { // 日本語の書き下ろし
      p.className = "row k" + (r.cls ? " " + r.cls : "") + (fresh ? " fresh" : "");
      p.textContent = r.ja;
      return p;
    }
    p.className = "row" + (r.cls ? " " + r.cls : "") + (fresh ? " fresh" : "");
    if (r.segs && !r.parts) { // 文字の飾りつき（英語のまま）
      for (const s of r.segs) {
        const sp = document.createElement("span");
        const cl = [];
        if (s.s & 1) cl.push("rev");
        if (s.s & 2) cl.push("b");
        if (s.s & 4) cl.push("i");
        if (s.s & 8) cl.push("fx");
        sp.className = cl.join(" ");
        sp.textContent = s.t;
        p.append(sp);
      }
      return p;
    }
    const same = !r.ja || r.ja === r.en;
    const ja = document.createElement("span");
    ja.className = "ja";
    ja.textContent = same ? r.en : r.ja;
    p.append(ja);
    if (!same) {
      const en = document.createElement("span");
      en.className = "en"; en.textContent = r.en; p.append(en);
    } else ja.classList.add("en-too");
    return p;
  }
  function push(r) {
    rows.push(r);
    logEl.append(rowEl(r, true));
  }
  function scrollDown() {
    requestAnimationFrame(() => { screenEl.scrollTop = screenEl.scrollHeight; });
  }
  function sys(text) { push({ t: "sys", ja: text }); scrollDown(); }
  function persistLog() {
    if (!cur) return;
    LS.set(key(cur.id, "log"), JSON.stringify(rows.slice(-300).map(r => ({
      t: r.t, ja: r.ja, en: r.en, cls: r.cls, segs: r.segs, parts: r.parts,
    }))));
  }
  function loadLog() {
    rows = [];
    logEl.textContent = "";
    try {
      const saved = JSON.parse(LS.get(key(cur.id, "log")) || "[]");
      for (const r of saved) { rows.push(r); logEl.append(rowEl(r, false)); }
    } catch (e) { rows = []; }
  }
  function setBar(left, leftEn, right) {
    const roomEl = $("room");
    roomEl.textContent = "";
    roomEl.append(document.createTextNode(left || ""));
    if (leftEn && leftEn !== left) {
      const e = document.createElement("span"); e.className = "en"; e.textContent = leftEn; roomEl.append(e);
    }
    $("score").textContent = right || "";
  }

  // ---- 開く ----
  async function openGame(g) {
    cur = g;
    show("game");
    document.title = g.title + " — 夜の書庫";
    cmdEl.value = "";
    $("upper").hidden = true;
    $("builder").hidden = true;
    $("chips").textContent = "";
    $("pad").textContent = "";
    setBar(g.title, "", "");
    loadLog();
    try {
      if (g.kind === "kura") await startKura(false);
      else await startZ(false);
    } catch (e) {
      sys("開けませんでした: " + (e && e.message ? e.message : e));
    }
  }
  function closeGame() {
    persistLog();
    if (cur && cur.kind === "kura" && Kura.current) Kura.current.save && Kura.current.save();
    cur = null;
    zp = null; kp = null;
    document.title = "夜の書庫";
    show("library");
    renderLibrary();
  }
  $("back").addEventListener("click", closeGame);
  window.addEventListener("pagehide", persistLog);
  document.addEventListener("visibilitychange", () => { if (document.hidden) persistLog(); });

  // ---- 共通の入力 ----
  $("prompt").addEventListener("submit", e => {
    e.preventDefault();
    const v = cmdEl.value;
    cmdEl.value = "";
    submit(v);
  });
  cmdEl.addEventListener("focus", () => { document.body.classList.add("typing"); scrollDown(); });
  cmdEl.addEventListener("blur", () => {
    setTimeout(() => { if (document.activeElement !== cmdEl) document.body.classList.remove("typing"); }, 120);
  });
  function submit(text, en) {
    if (!cur) return;
    if (cur.kind === "kura") kuraSubmit(text, en);
    else zSubmit(text, en);
  }
  function chip(label, onClick, cls) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "key" + (cls ? " " + cls : ""); b.textContent = label;
    b.addEventListener("pointerdown", e => e.preventDefault());
    b.addEventListener("click", onClick);
    return b;
  }

  // =====================================================================
  // Z マシンのゲーム
  // =====================================================================
  let zp = null;   // {vm, tr, cp, segs, upperDirty}
  let pendingFresh = false;
  const Z_DIRS = [["n", "北"], ["s", "南"], ["e", "東"], ["w", "西"], ["u", "上"], ["d", "下"],
    ["ne", "北東"], ["nw", "北西"], ["se", "南東"], ["sw", "南西"], ["in", "入る"], ["out", "出る"]];
  const Z_VERBS = [["look", 1], ["inventory", 1], ["wait", 1], ["again", 1], ["undo", 1],
    ["examine", 0], ["take", 0], ["drop", 0], ["open", 0], ["close", 0], ["read", 0], ["push", 0], ["pull", 0],
    ["unlock", 0], ["put", 0], ["give", 0], ["ask", 0], ["tell", 0], ["show", 0], ["wear", 0], ["enter", 0],
    ["climb", 0], ["search", 0], ["turn on", 0], ["listen", 1], ["smell", 1]];
  const STOP = new Set("with from into onto that this there here them then what where when have your the and for out off not but all any are was you can see one two its his her has had".split(" "));

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = () => rej(new Error(src + " を読めませんでした"));
      document.head.append(s);
    });
  }

  async function storyBytes(g) {
    if (g.bytes) return g.bytes;
    if (g.imported) { const rec = await dbGet(g.id); return rec.bytes; }
    const res = await fetch(g.file);
    if (!res.ok) throw new Error(g.file + " を読めませんでした");
    return new Uint8Array(await res.arrayBuffer());
  }

  async function startZ(fresh) {
    const g = cur;
    const bytes = await storyBytes(g);
    if (g.fmt === "g") return startG(bytes, fresh || pendingFresh);
    let tr = null, cp = null;
    if (g.dict) {
      if (typeof ZDICT === "undefined") { await loadScript("translate.js"); await loadScript("dict.js"); }
      tr = new Translator(ZDICT, new Map());
      cp = new CommandParser(ZDICT, tr);
    }
    const z = zp = { vm: null, tr, cp, segs: [], lastText: "" };
    const slot = () => key(g.id, "slot" + (parseInt(LS.get(key(g.id, "slotn")) || "1", 10)));
    const host = {
      out: (t, s) => z.segs.push({ t, s }),
      clear: () => { zFlush(); push({ t: "sep" }); },
      save: o => {
        const ok = LS.set(slot(), JSON.stringify(o));
        z.note = ok ? "（スロット " + (LS.get(key(g.id, "slotn")) || "1") + " に保存しました）" : "（保存できませんでした）";
        return ok;
      },
      restore: () => {
        try { return JSON.parse(LS.get(slot()) || "null"); } catch (e) { return null; }
      },
    };
    z.vm = new ZVM(bytes, host);
    let st = null;
    const auto = fresh ? null : LS.get(key(g.id, "auto"));
    if (auto) {
      try { st = z.vm.importWaiting(JSON.parse(auto)); } catch (e) { st = null; }
    }
    if (st) {
      zShowBar();
      zUpdateInput();
      scrollDown();
      return;
    }
    if (fresh) { rows = []; logEl.textContent = ""; LS.del(key(g.id, "auto")); }
    z.vm = new ZVM(bytes, host);
    zPresent(z.vm.run());
  }

  function zFlush() {
    const z = zp;
    const segs = z.segs;
    z.segs = [];
    if (!segs.length) return;
    // 行に分ける
    let lines = [[]];
    for (const sg of segs) {
      const parts = sg.t.split("\n");
      parts.forEach((p, i) => {
        if (i > 0) lines.push([]);
        if (p) lines[lines.length - 1].push({ t: p, s: sg.s });
      });
    }
    const text = l => l.map(x => x.t).join("");
    // 最後のプロンプト「>」を消す
    while (lines.length && !text(lines[lines.length - 1]).trim()) lines.pop();
    if (lines.length && text(lines[lines.length - 1]).trim() === ">") lines.pop();
    while (lines.length && !text(lines[lines.length - 1]).trim()) lines.pop();
    while (lines.length && !text(lines[0]).trim()) lines.shift();
    if (!lines.length) return;
    z.lastText = lines.map(text).join("\n");
    if (z.tr) {
      const roomName = z.vm.status ? z.vm.status.room : "";
      for (const r of z.tr.block(z.lastText)) {
        if (r.blank) { push({ t: "gap" }); continue; }
        const j = z.tr.jaOf(r);
        const row = { t: "out", en: (r.indent ? "  " : "") + r.en, ja: j.text, parts: r.parts, cls: r.indent ? "indent" : "" };
        if (r.en === roomName) row.cls = "room";
        push(row);
      }
    } else {
      let blank = false;
      for (const l of lines) {
        if (!text(l).trim()) { if (!blank) push({ t: "gap" }); blank = true; continue; }
        blank = false;
        push({ t: "out", en: text(l), segs: l });
      }
    }
    scrollDown();
  }

  function zShowBar() {
    const z = zp, vm = z.vm;
    const up = vm.upperLines().filter(s => s.trim());
    const collapse = s => s.trim().replace(/\s{2,}/g, "  ·  ");
    if (vm.version <= 3) {
      const s = vm.status;
      if (s) {
        const ja = z.tr ? z.tr.name(s.room) : null;
        setBar(ja || s.room, ja ? s.room : "", s.time
          ? (s.a + ":" + String(s.b).padStart(2, "0"))
          : (z.tr ? "得点 " + s.a + "　手数 " + s.b : "Score: " + s.a + "  Moves: " + s.b));
      }
      $("upper").hidden = true;
      return;
    }
    if (up.length) setBar(collapse(up[0]), "", "");
    const upEl = $("upper");
    if (up.length > 1) { upEl.textContent = up.map(s => s.replace(/\s+$/, "")).join("\n"); upEl.hidden = false; }
    else upEl.hidden = true;
  }

  function zUpdateInput() {
    const z = zp, vm = z.vm, st = vm.state;
    // 候補の言葉
    const chips = $("chips");
    chips.textContent = "";
    if (!st || st.type === "quit") { chips.hidden = true; $("pad").textContent = ""; return; }
    chips.hidden = false;
    if (st.type === "char") {
      cmdEl.placeholder = "キーを1つ入力（送るだけなら Enter）";
      chips.append(chip("Enter（進める）", () => submit(""), "ask"), chip("スペース", () => submit(" "), "ask"));
    } else {
      cmdEl.placeholder = z.tr ? "命令（英語でも日本語でも）" : "命令を英語で入力";
      const text = (z.lastText + " " + (z.vm.status ? z.vm.status.room : "")).toLowerCase();
      const dict = z.words || (z.words = new Set(vm.dictWords()));
      if (/\(y is affirmative\)|\[y\/n\]|\(y\/n\)|yes or no/i.test(z.lastText)) {
        chips.append(chip("はい（yes）", () => submit("yes"), "ask"), chip("いいえ（no）", () => submit("no"), "ask"));
      }
      if (/restart, restore, or quit|restart, restore, undo|would you like to restart/i.test(z.lastText)) {
        for (const w of ["restart", "restore", "quit"]) chips.append(chip(w, () => submit(w), "ask"));
      }
      const seen = new Set();
      for (const w of text.split(/[^a-z]+/)) {
        if (w.length < 3 || STOP.has(w) || seen.has(w) || !dict.has(w)) continue;
        seen.add(w);
        chips.append(chip(w, () => {
          const v = cmdEl.value.trim();
          cmdEl.value = v ? v + " " + w : w;
        }, "word"));
        if (seen.size >= 14) break;
      }
      for (const [v, one] of Z_VERBS) {
        chips.append(chip(v, () => {
          if (one) submit(v);
          else { cmdEl.value = v + " "; }
        }, "verb"));
      }
    }
    const pad = $("pad");
    if (!pad.childElementCount) {
      for (const [en, ja] of Z_DIRS) {
        const b = chip(ja, () => submit(en), "");
        const s = document.createElement("small"); s.textContent = en; b.append(s);
        pad.append(b);
      }
    }
  }

  function zPresent(st) {
    const z = zp;
    zFlush();
    if (z.note) { sys(z.note); z.note = null; }
    zShowBar();
    zUpdateInput();
    if (st.type === "quit") {
      LS.del(key(cur.id, "auto"));
      push({ t: "sys", ja: "ゲームが終わりました。右上の ⋮ から「はじめから遊ぶ」を選べます。" });
      scrollDown();
    } else {
      const o = z.vm.exportWaiting();
      if (o) LS.set(key(cur.id, "auto"), JSON.stringify(o));
    }
    persistLog();
  }

  function zSubmit(text, en) {
    const z = zp;
    if (!z) return;
    if (z.glk) return gSubmit(text);
    const vm = z.vm, st = vm.state;
    if (!st || st.type === "quit") return;
    try {
      text = String(text || "");
      if (st.type === "char") {
        const c = text.length ? text.charCodeAt(0) : 13;
        push({ t: "cmd", ja: text.trim() ? text : "（Enter）", en: "" });
        vm.submitChar(c);
      } else {
        let cmd = text.trim(), shown = cmd, sent = "";
        if (z.cp && cmd && !/^[\x20-\x7e]*$/.test(cmd)) {
          const e = z.cp.parse(cmd);
          if (!e) {
            push({ t: "cmd", ja: cmd, en: "" });
            sys("その命令はうまく英語に直せませんでした。言い方を変えるか、英語で入力してください。");
            return;
          }
          sent = e; cmd = e;
        }
        push({ t: "cmd", ja: shown, en: sent });
        vm.submitLine(cmd);
      }
      zPresent(vm.run());
    } catch (e) {
      sys("エラーが起きました: " + (e && e.message ? e.message : e));
    }
  }

  // =====================================================================
  // Glulx のゲーム（Quixe）
  // =====================================================================
  async function startG(bytes, fresh) {
    const g = cur;
    pendingFresh = false;
    // Quixe は同じページで二度は始められない。二つ目からは、再読み込みして始める
    if (window.Quixe && window.Quixe.vm_started) {
      try { sessionStorage.setItem("yoru.autoopen", g.id); sessionStorage.setItem("yoru.autofresh", fresh ? "1" : "0"); } catch (e) { /* 失敗したら手で開き直す */ }
      sys("Glulx のゲームを切りかえるため、画面を読み込みなおします…");
      persistLog();
      setTimeout(() => location.reload(), 300);
      return;
    }
    if (typeof window.Quixe === "undefined") {
      await loadScript("glulx/quixe.min.js");
      await loadScript("glulx/glkapi.min.js");
      await loadScript("glulx/glkote-mini.js");
    }
    if (fresh) { rows = []; logEl.textContent = ""; LS.del(key(g.id, "log")); }
    else if (rows.length) { push({ t: "sep" }); sys("（Glulx のゲームは、ゲーム内の「save」「restore」で続きを遊びます。最初から始めます）"); }
    const z = zp = { glk: true, segs: [], tr: null, vm: null, lastText: "", state: { type: "busy" } };
    const slotNo = () => LS.get(key(g.id, "slotn")) || "1";
    YGlk.start(bytes, {
      prefix: g.id,
      slot: slotNo,
      out: (t, s) => { if (!(s & 16)) z.segs.push({ t, s }); },
      clear: () => { zFlush(); push({ t: "sep" }); },
      grid: lines => { z.grid = lines; },
      note: t => { z.notes = (z.notes || []).concat(t); },
      flush: st => gPresent(st),
    });
  }

  function gPresent(st) {
    const z = zp;
    if (!z || !z.glk) return;
    z.state = st;
    if (st.type === "busy") return;
    zFlush();
    for (const n of z.notes || []) sys(n);
    z.notes = [];
    // 状態行（文字の窓）
    const lines = (z.grid || []).flat().filter(s => s.trim());
    const collapse = s => s.trim().replace(/\s{2,}/g, "  ·  ");
    if (lines.length) setBar(collapse(lines[0]), "", "");
    const upEl = $("upper");
    if (lines.length > 1) { upEl.textContent = lines.map(s => s.replace(/\s+$/, "")).join("\n"); upEl.hidden = false; }
    else upEl.hidden = true;
    gUpdateInput();
    if (st.type === "quit") {
      push({ t: "sys", ja: "ゲームが終わりました。右上の ⋮ から「はじめから遊ぶ」を選べます。" });
      scrollDown();
    }
    persistLog();
  }

  function gUpdateInput() {
    const z = zp, st = z.state;
    const chips = $("chips");
    chips.textContent = "";
    const pad = $("pad");
    if (st.type === "quit" || st.type === "busy") { chips.hidden = true; pad.textContent = ""; return; }
    chips.hidden = false;
    if (st.type === "char") {
      cmdEl.placeholder = "キーを1つ入力（送るだけなら Enter）";
      chips.append(chip("Enter（進める）", () => submit(""), "ask"), chip("スペース", () => submit(" "), "ask"));
    } else {
      cmdEl.placeholder = "命令を英語で入力";
      if (/\(y\/n\)|\[y\/n\]|yes or no|\(y is affirmative\)/i.test(z.lastText)) {
        chips.append(chip("はい（yes）", () => submit("yes"), "ask"), chip("いいえ（no）", () => submit("no"), "ask"));
      }
      for (const [v, one] of Z_VERBS) {
        chips.append(chip(v, () => { if (one) submit(v); else cmdEl.value = v + " "; }, "verb"));
      }
    }
    if (!pad.childElementCount) {
      for (const [en, ja] of Z_DIRS) {
        const b = chip(ja, () => submit(en), "");
        const s = document.createElement("small"); s.textContent = en; b.append(s);
        pad.append(b);
      }
    }
  }

  function gSubmit(text) {
    const z = zp, st = z.state;
    if (!st || st.type === "busy" || st.type === "quit") return;
    text = String(text || "");
    try {
      if (st.type === "char") {
        push({ t: "cmd", ja: text.trim() ? text : "（Enter）", en: "" });
        z.state = { type: "busy" };
        YGlk.submitChar(text.length ? text : "\n");
      } else {
        push({ t: "cmd", ja: text.trim(), en: "" });
        z.state = { type: "busy" };
        YGlk.submitLine(text.trim());
      }
    } catch (e) {
      sys("エラーが起きました: " + (e && e.message ? e.message : e));
    }
  }

  // =====================================================================
  // 日本語の書き下ろし（Kura エンジン）
  // =====================================================================
  let kp = null;   // {game, verb, a}
  async function startKura(fresh) {
    if (typeof Kura === "undefined") {
      for (const s of cur.scripts) await loadScript(s);
    }
    const ui = {
      say: (text, cls) => { push({ t: "k", ja: text, cls: cls || "" }); scrollDown(); },
      gap: () => push({ t: "gap" }),
      sep: () => push({ t: "sep" }),
      status: (l, r) => setBar(l, "", r),
      sys: text => sys(text),
      flash: () => {},
      vibrate: p => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) { /* 振動できなくてもよい */ } },
      ended: (id, title) => {
        let seen = [];
        try { seen = JSON.parse(LS.get(key(cur.id, "endings")) || "[]"); } catch (e) { seen = []; }
        if (!seen.includes(id)) { seen.push(id); LS.set(key(cur.id, "endings"), JSON.stringify(seen)); }
      },
    };
    const game = Kura.create(ui);
    Kura.current = game;
    kp = { game, verb: null, a: null };
    let saved = null;
    if (!fresh) { try { saved = JSON.parse(LS.get(key(cur.id, "auto")) || "null"); } catch (e) { saved = null; } }
    if (fresh) { rows = []; logEl.textContent = ""; LS.del(key(cur.id, "auto")); }
    game.onChange = () => { LS.set(key(cur.id, "auto"), JSON.stringify(game.export())); persistLog(); kuraBuilder(); };
    game.save = () => LS.set(key(cur.id, "auto"), JSON.stringify(game.export()));
    if (saved && game.import(saved)) {
      game.look(true);
    } else {
      game.start();
    }
    kuraBuilder();
    scrollDown();
  }

  function kuraSubmit(text, en) {
    const k = kp;
    if (!k) return;
    text = String(text || "").trim();
    if (!text) return;
    push({ t: "cmd", ja: text, en: "" });
    k.verb = null; k.a = null;
    k.game.text(text);
    scrollDown();
  }

  // 「命令を作る」：動詞 → 物 → （2つ目の物）
  function kuraBuilder() {
    const k = kp, game = k.game;
    const box = $("builder");
    box.textContent = "";
    box.hidden = false;
    $("chips").textContent = "";
    const pad = $("pad");
    pad.textContent = "";
    cmdEl.placeholder = "日本語で命令（例: 蔵の戸を調べる）";
    const head = document.createElement("div"); head.className = "head";
    const grid = document.createElement("div"); grid.className = "grid";
    box.append(head, grid);
    const choices = game.choices();
    if (choices.length) {
      head.textContent = "どうする？";
      for (const c of choices) grid.append(chip(c.label, () => { game.choose(c.id); scrollDown(); }, "ask"));
      return;
    }
    if (game.state().over) {
      head.textContent = "物語は、ここで終わった。";
      grid.append(chip("ひとつ戻す", () => { game.act("undo"); scrollDown(); }, "ask"));
      grid.append(chip("最初から遊ぶ", () => restartGame(), "ask"));
      return;
    }
    const done = (v, a, b) => {
      const label = v.fmt.replace("%", a ? a.label : "").replace("#", b ? b.label : "");
      push({ t: "cmd", ja: label, en: "" });
      k.verb = null; k.a = null;
      game.act(v.id, a && a.id, b && b.id);
      scrollDown();
    };
    if (!k.verb) {
      head.textContent = "どうする？";
      for (const e of game.exits()) grid.append(chip(e.label, () => { push({ t: "cmd", ja: e.label + "へ行く", en: "" }); game.go(e.dir); scrollDown(); }, "dir"));
      for (const v of game.verbs()) {
        grid.append(chip(v.label, () => {
          if (v.args === 0) done(v);
          else { k.verb = v; k.a = null; kuraBuilder(); }
        }, v.quick ? "ask" : ""));
      }
      grid.append(chip("ひとつ戻す", () => { game.act("undo"); scrollDown(); }, "ask"));
    } else {
      const v = k.verb;
      const second = v.args === 2 && k.a;
      head.textContent = second ? v.label + "：" + k.a.label + "を、何に？" : v.label + "：何を？";
      grid.append(chip("やめる", () => { k.verb = null; k.a = null; kuraBuilder(); }, "ask"));
      for (const t of game.things(v.id, second ? k.a.id : null)) {
        if (second && t.id === k.a.id) continue;
        grid.append(chip(t.label, () => {
          if (v.args === 2 && !second) { k.a = t; kuraBuilder(); }
          else if (second) done(v, k.a, t);
          else done(v, t);
        }, t.held ? "held" : ""));
      }
    }
  }

  // =====================================================================
  // メニュー
  // =====================================================================
  function openSheet() {
    const box = $("sheetbox");
    box.textContent = "";
    const h = t => { const e = document.createElement("h3"); e.textContent = t; box.append(e); };
    const line = () => { const e = document.createElement("div"); e.className = "line"; box.append(e); return e; };
    const btn = (label, fn, pressed) => {
      const b = chip(label, fn);
      if (pressed !== undefined) b.setAttribute("aria-pressed", String(pressed));
      return b;
    };
    h("文字の大きさ");
    let l = line();
    l.append(btn("小さく", () => setFont(fontSize - 1)), btn("大きく", () => setFont(fontSize + 1)));
    if (cur.kind === "z" && cur.dict) {
      h("表示");
      l = line();
      for (const [m, label] of [["both", "日本語＋英語"], ["ja", "日本語"], ["en", "英語"]]) {
        l.append(btn(label, () => { mode = m; LS.set("yoru.mode", m); document.body.className = "mode-" + m; openSheet(); }, mode === m));
      }
    }
    if (cur.kind === "z") {
      h("セーブの場所（ゲームの save / restore で使う）");
      l = line();
      const n = parseInt(LS.get(key(cur.id, "slotn")) || "1", 10);
      for (let i = 1; i <= 3; i++) {
        l.append(btn("スロット " + i + (LS.get(key(cur.id, "slot" + i)) ? "（あり）" : ""), () => { LS.set(key(cur.id, "slotn"), String(i)); openSheet(); }, n === i));
      }
      if (!cur.dict) {
        h("英語を日本語で読む");
        l = line();
        l.append(btn("いまの場面を訳す", () => { translateLast(); }));
        l.append(btn("コピー", () => { copyLast(); }));
        const p = document.createElement("p"); p.className = "note";
        p.textContent = "「訳す」は、いまの場面の英文を Google 翻訳のページに送ります。押したときだけ送られます。";
        box.append(p);
      }
    }
    if (cur.kind === "kura") {
      h("ヒント");
      l = line();
      l.append(btn("ヒントを見る", () => { closeSheet(); kp.game.hint(); scrollDown(); }));
    }
    h("ゲーム");
    l = line();
    l.append(btn("はじめから遊ぶ", () => {
      if (!confirm("いまの続きは消えます。はじめから遊びますか？")) return;
      closeSheet();
      restartGame();
    }));
    l.append(btn("履歴を全部コピー", () => { copyAll(); }));
    l.append(btn("とじる", closeSheet));
    $("sheet").hidden = false;
  }
  function closeSheet() { $("sheet").hidden = true; }
  function restartGame() {
    rows = []; logEl.textContent = "";
    LS.del(key(cur.id, "log"));
    (cur.kind === "kura" ? startKura(true) : startZ(true)).catch(e => sys(String(e && e.message || e)));
  }
  $("sheet").addEventListener("click", e => { if (e.target === $("sheet")) closeSheet(); });
  $("menu").addEventListener("click", openSheet);
  function setFont(n) {
    fontSize = Math.max(12, Math.min(28, n));
    LS.set("yoru.font", String(fontSize));
    document.documentElement.style.setProperty("--size", fontSize + "px");
  }
  function lastScene() {
    const out = [];
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].t === "cmd") break;
      if (rows[i].t === "out") out.unshift(rows[i].en);
    }
    return out.join("\n").slice(0, 1800);
  }
  function translateLast() {
    const t = lastScene();
    if (!t) { sys("訳す文章がありません。"); closeSheet(); return; }
    window.open("https://translate.google.com/?sl=en&tl=ja&op=translate&text=" + encodeURIComponent(t), "_blank", "noopener");
    closeSheet();
  }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); sys("コピーしました。"); }
    catch (e) { sys("コピーできませんでした。"); }
    closeSheet();
  }
  function copyLast() { copyText(lastScene()); }
  function copyAll() {
    copyText(rows.map(r => r.t === "cmd" ? "> " + r.ja : (r.en || r.ja || "")).join("\n"));
  }

  // ---- 起動 ----
  renderLibrary().then(async () => {
    // Glulx は、同じページで二つ目を始められない。そのときは再読み込みして、ここから開く
    let id = null, fresh = false;
    try { id = sessionStorage.getItem("yoru.autoopen"); fresh = sessionStorage.getItem("yoru.autofresh") === "1"; sessionStorage.removeItem("yoru.autoopen"); sessionStorage.removeItem("yoru.autofresh"); } catch (e) { id = null; }
    if (!id) return;
    const rec = (await dbAll()).find(r => r.id === id);
    if (!rec) return;
    pendingFresh = fresh;
    openGame({ id: rec.id, kind: "z", fmt: rec.fmt || "z", title: rec.title, sub: rec.name, bytes: rec.bytes, imported: true, tags: [] });
  });
  window.YoruDebug = { get zp() { return zp; }, get kp() { return kp; } };
})();
