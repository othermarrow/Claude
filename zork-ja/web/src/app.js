// app.js — 画面。ゲームを動かし、出力を訳して表示し、入力を英語に直して渡す。
"use strict";

(function () {
  const $ = id => document.getElementById(id);
  const logEl = $("log"), screenEl = $("screen"), cmdEl = $("cmd");
  // Tasker のシーン（Webビュー、「電話へのアクセスを許可」あり）で開いたときは、
  // Tasker の readFile / writeFile で Tasker/zork-ja/zork-ja-data.json にも保存する。
  // Tasker はないファイルを読むとエラーを出してページの処理を止めるので、
  // 一度書いたことを Tasker の変数 %ZORKJA（またはブラウザの記憶）に残し、書いたあとでだけ読む。
  const TK = (() => {
    try {
      if (typeof tk !== "undefined" && tk && typeof tk.readFile === "function" && typeof tk.writeFile === "function") return tk;
      if (typeof readFile === "function" && typeof writeFile === "function") {
        return {
          readFile, writeFile,
          global: typeof global === "function" ? global : undefined,
          setGlobal: typeof setGlobal === "function" ? setGlobal : undefined,
        };
      }
    } catch (e) { /* Tasker の外 */ }
    return null;
  })();
  const TK_FILE = "/storage/emulated/0/Tasker/zork-ja/zork-ja-data.json";
  const MARK = "zorkja.tkfile";
  function tkWritten() {
    try { if (TK.global && String(TK.global("ZORKJA")) === "1") return true; } catch (e) { /* 変数を読めない */ }
    try { return localStorage.getItem(MARK) === "1"; } catch (e) { return false; }
  }
  let tkData = {};
  if (TK && tkWritten()) {
    try { tkData = JSON.parse(String(TK.readFile(TK_FILE) || "{}")) || {}; } catch (e) { tkData = {}; }
  }
  let tkTimer = null;
  function tkFlush() {
    tkTimer = null;
    try {
      TK.writeFile(TK_FILE, JSON.stringify(tkData), false);
      try { if (TK.setGlobal) TK.setGlobal("ZORKJA", "1"); } catch (e) { /* 変数に書けない */ }
      try { localStorage.setItem(MARK, "1"); } catch (e) { /* 同上 */ }
    } catch (e) { /* 書けなくても遊べる */ }
  }
  function tkSchedule() { if (!tkTimer) tkTimer = setTimeout(tkFlush, 400); }
  document.addEventListener("visibilitychange", () => { if (TK && tkTimer && document.hidden) { clearTimeout(tkTimer); tkFlush(); } });
  const LS = {
    get(k) {
      if (TK && typeof tkData[k] === "string") return tkData[k];
      try { return localStorage.getItem(k); } catch (e) { return null; }
    },
    set(k, v) {
      if (TK) { tkData[k] = v; tkSchedule(); }
      try { localStorage.setItem(k, v); } catch (e) { /* 保存できなくても遊べる */ }
    },
    del(k) {
      if (TK) { delete tkData[k]; tkSchedule(); }
      try { localStorage.removeItem(k); } catch (e) { /* 同上 */ }
    },
  };
  const K = { auto: "zorkja.autosave", log: "zorkja.log", save: "zorkja.save", cache: "zorkja.tcache", mode: "zorkja.mode", ai: "zorkja.ai" };
  const IN_CLAUDE = !!(window.claude && window.claude.use);

  // ---- 準備 ----
  const story = Uint8Array.from(atob(ZDATA.story), c => c.charCodeAt(0));
  const cache = new Map(Object.entries(JSON.parse(LS.get(K.cache) || "{}")));
  const tr = new Translator(ZDATA, cache);
  const cp = new CommandParser(ZDATA, tr);
  const zm = new ZMachine(story);

  let mode = LS.get(K.mode) || "both";
  let aiWanted = LS.get(K.ai) !== "off";
  let sample = null, aiDisabled = false;
  // 以前の版で保存した Gemini のキーとモデル名は、もう使わないので消す
  for (const old of ["zorkja.gemini", "zorkja.gmodel"]) if (LS.get(old) !== null) LS.del(old);
  let db = null, uid = null;
  let savedGame = null;           // ロード用に読み込んでおいたセーブ
  let rows = [];                  // 画面の記録 {t, ja, en, cls}
  let busy = false;

  zm.onRestore = () => savedGame;

  // ---- 表示 ----
  function applyMode() {
    document.body.classList.remove("mode-both", "mode-ja", "mode-en");
    document.body.classList.add("mode-" + mode);
    for (const b of document.querySelectorAll("[data-mode]")) b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
    for (const b of document.querySelectorAll("[data-ai]")) b.setAttribute("aria-pressed", String((b.dataset.ai === "on") === aiWanted));
  }

  function rowEl(r, fresh) {
    if (r.t === "gap") { const d = document.createElement("div"); d.className = "gap"; return d; }
    const p = document.createElement("p");
    if (r.t === "cmd") {
      p.className = "row cmd";
      p.textContent = "> " + r.ja;
      if (r.en && r.en !== r.ja) {
        const s = document.createElement("span");
        s.className = "sent"; s.textContent = r.en;
        p.append(s);
      }
      return p;
    }
    if (r.t === "note") { p.className = "row note"; p.textContent = r.ja; return p; }
    p.className = "row" + (r.cls ? " " + r.cls : "") + (fresh ? " fresh" : "");
    const same = !r.ja || r.ja === r.en;
    const ja = document.createElement("span");
    ja.className = "ja";
    ja.textContent = same ? r.en : r.ja;
    p.append(ja);
    if (!same) {
      const en = document.createElement("span");
      en.className = "en"; en.textContent = r.en;
      p.append(en);
    } else {
      // 訳がない行は、英語表示のときもそのまま見えるように同じ文を英語側にも置く
      ja.classList.add("en-too");
    }
    if (r.pending) {
      p.classList.add("pending");
      const t = document.createElement("span");
      t.className = "tag"; t.textContent = "翻訳中…";
      ja.append(t);
    }
    r.el = p;
    return p;
  }

  function push(r) {
    rows.push(r);
    r.el = rowEl(r, true);
    logEl.append(r.el);
  }

  function redrawRow(r) {
    if (!r.el) return;
    const n = rowEl(r, false);
    r.el.replaceWith(n);
    r.el = n;
  }

  function scrollDown() {
    requestAnimationFrame(() => { screenEl.scrollTop = screenEl.scrollHeight; });
  }

  function setStatus() {
    const s = zm.status();
    const roomEl = $("room");
    roomEl.textContent = "";
    const ja = tr.name(s.room);
    roomEl.append(document.createTextNode(ja || s.room));
    if (ja && ja !== s.room) {
      const e = document.createElement("span");
      e.className = "en"; e.textContent = s.room;
      roomEl.append(e);
    }
    $("score").textContent = mode === "en" ? `Score: ${s.score}  Moves: ${s.moves}` : `得点 ${s.score}　手数 ${s.moves}`;
  }

  // ---- ゲーム出力 ----
  function showOutput(raw) {
    const s = zm.status();
    const roomName = s.room;
    const out = tr.block(raw);
    const fresh = [];
    for (const r of out) {
      if (r.blank) { push({ t: "gap" }); continue; }
      const j = tr.jaOf(r);
      const row = { t: "out", en: (r.indent ? "  " : "") + r.en, ja: j.text, parts: r.parts, cls: "" };
      if (r.indent) row.cls = "indent";
      if (r.en === roomName) row.cls = "room";
      if (!j.complete) fresh.push(row);
      push(row);
    }
    setStatus();
    scrollDown();
    persist();
    if (fresh.length) translateRows(fresh);
  }

  // ---- 辞書にない文を訳す（claude.ai の中だけ。Claude を使う） ----
  const aiReady = () => !aiDisabled && aiWanted && !!sample;
  const askJson = prompt => sample.json(prompt, { modelTier: "quick" });
  let aiQueue = Promise.resolve();
  function translateRows(list) {
    if (!aiReady() || mode === "en") return;
    const todo = tr.pending(list);
    if (!todo.length) { list.forEach(refreshRow); return; }
    list.forEach(r => { r.pending = true; redrawRow(r); });
    aiQueue = aiQueue.then(async () => {
      try {
        const gloss = tr.glossaryFor(todo);
        const prompt =
          "あなたはテキストアドベンチャー『Zork I』の日本語翻訳者です。" +
          "次の JSON 配列の英文を、ゲームの語り口に合う自然な日本語に訳してください。" +
          "二人称は「あなた」、地の文は常体（〜だ・〜である）。固有名詞は用語集に合わせてください。" +
          "同じ順番・同じ件数の JSON 文字列配列だけを返してください。\n" +
          (gloss.length ? "用語集:\n" + gloss.join("\n") + "\n" : "") +
          "英文:\n" + JSON.stringify(todo);
        const out = await askJson(prompt);
        if (Array.isArray(out) && out.length === todo.length) {
          todo.forEach((en, i) => { const ja = String(out[i] || "").trim(); if (ja) cache.set(en, ja); });
          saveCache();
        }
      } catch (e) {
        handleAiError(e);
      }
      list.forEach(r => { r.pending = false; refreshRow(r); });
      persist();
    });
  }
  function refreshRow(r) {
    if (!r.parts) return;
    const j = tr.jaOf({ parts: r.parts });
    r.ja = j.text;
    redrawRow(r);
  }
  function saveCache() {
    const obj = {};
    let n = 0;
    for (const [k, v] of [...cache].reverse()) { obj[k] = v; if (++n >= 3000) break; }
    LS.set(K.cache, JSON.stringify(obj));
  }
  function handleAiError(e) {
    const code = e && e.code;
    if (["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"].includes(code)) {
      aiDisabled = true;
      push({ t: "note", ja: "（辞書にない文の翻訳は使えないため、英語のまま表示します）" });
    } else if (code === "rate_limited") {
      push({ t: "note", ja: "（翻訳の回数が上限に達しました。しばらくしてから続きを訳します）" });
    }
  }

  async function aiCommand(text) {
    if (!aiReady()) return null;
    const key = "CMD:" + text;
    if (cache.has(key)) return cache.get(key);
    try {
      const en = await askJson(
        "テキストアドベンチャー『Zork I』の命令を英語に直します。次の日本語の命令を、" +
        "Zork のパーサが理解できる短い英語の命令（例: open mailbox, take lamp, attack troll with sword, north）" +
        "1つにして、JSON 文字列だけで返してください。\n命令: " + text);
      if (typeof en === "string" && en.trim()) {
        const v = en.trim().toLowerCase();
        cache.set(key, v); saveCache();
        return v;
      }
    } catch (e) { handleAiError(e); }
    return null;
  }

  // ---- 保存 ----
  function persist() {
    const snap = zm.snapshotWaiting();
    if (snap) LS.set(K.auto, JSON.stringify(snap));
    const keep = rows.slice(-400).map(r => ({ t: r.t, ja: r.ja, en: r.en, cls: r.cls, parts: r.parts }));
    LS.set(K.log, JSON.stringify(keep));
  }
  async function writeSave(snap) {
    savedGame = snap;
    LS.set(K.save, JSON.stringify(snap));
    if (db && uid) {
      try { await db.doc(`data/users/${uid}/save`).set({ game: JSON.stringify(snap), at: Date.now() }); }
      catch (e) { push({ t: "note", ja: "（セーブはこの端末の中にだけ残しました）" }); }
    }
  }

  // ---- 入力 ----
  async function submit(text) {
    text = text.trim();
    if (busy || zm.finished) return;
    busy = true;
    try {
      let cmd = text;
      if (text && !/^[\x20-\x7e]*$/.test(text)) {
        cmd = cp.parse(text);
        if (!cmd) {
          const note = { t: "note", ja: "（考え中…）" };
          push({ t: "cmd", ja: text, en: "" });
          push(note);
          cmd = await aiCommand(text);
          note.el && note.el.remove();
          rows.splice(rows.indexOf(note), 1);
          if (!cmd) {
            push({ t: "note", ja: "その命令はうまく英語に直せませんでした。言い方を変えるか、英語で入力してください。" });
            scrollDown();
            return;
          }
          const last = rows[rows.length - 1];
          last.en = cmd; redrawRow(last);
        } else push({ t: "cmd", ja: text, en: cmd });
      } else push({ t: "cmd", ja: text, en: "" });
      const out = zm.input(cmd);
      if (zm.saveRequest) { const s = zm.saveRequest; zm.saveRequest = null; writeSave(s); }
      showOutput(out);
      if (zm.finished) {
        push({ t: "note", ja: "ゲームが終わりました。右上の ≡ から「はじめから遊ぶ」を選べます。" });
        LS.del(K.auto);
        scrollDown();
      }
    } catch (e) {
      push({ t: "note", ja: "エラーが起きました: " + (e && e.message ? e.message : e) });
      scrollDown();
    } finally {
      busy = false;
    }
  }

  $("prompt").addEventListener("submit", e => {
    e.preventDefault();
    const v = cmdEl.value;
    cmdEl.value = "";
    submit(v);
  });
  $("keys").addEventListener("click", e => {
    const b = e.target.closest("[data-cmd]");
    if (b) submit(b.dataset.cmd);
  });

  // ---- メニュー ----
  const sheet = $("sheet");
  function openSheet(open) {
    sheet.hidden = !open;
    $("menu-btn").setAttribute("aria-expanded", String(open));
    $("restart-yes").hidden = $("restart-no").hidden = true;
    $("restart-btn").hidden = false;
  }
  $("menu-btn").addEventListener("click", () => openSheet(sheet.hidden));
  $("close-sheet").addEventListener("click", () => openSheet(false));
  sheet.addEventListener("click", e => { if (e.target === sheet) openSheet(false); });
  $("opt-mode").addEventListener("click", e => {
    const b = e.target.closest("[data-mode]");
    if (!b) return;
    mode = b.dataset.mode; LS.set(K.mode, mode); applyMode(); setStatus();
  });
  $("opt-ai").addEventListener("click", e => {
    const b = e.target.closest("[data-ai]");
    if (!b) return;
    aiWanted = b.dataset.ai === "on"; LS.set(K.ai, aiWanted ? "on" : "off"); applyMode();
  });
  // 辞書にない文の翻訳は claude.ai の中でしか使えないので、外では設定を出さない
  $("opt-ai").hidden = !IN_CLAUDE;
  $("restart-btn").addEventListener("click", () => {
    $("restart-btn").hidden = true;
    $("restart-yes").hidden = $("restart-no").hidden = false;
  });
  $("restart-no").addEventListener("click", () => openSheet(false));
  $("restart-yes").addEventListener("click", () => {
    openSheet(false);
    LS.del(K.auto); LS.del(K.log);
    rows = []; logEl.textContent = "";
    zm.restart();
    showOutput(zm.run());
  });

  // ---- 起動 ----
  applyMode();
  let resumed = false;
  try {
    const auto = JSON.parse(LS.get(K.auto) || "null");
    if (auto && zm.restoreSnapshot(auto)) {
      const old = JSON.parse(LS.get(K.log) || "[]");
      for (const r of old) push(r);
      push({ t: "note", ja: "（前回の続きから）" });
      setStatus(); scrollDown();
      resumed = true;
    }
  } catch (e) { /* 壊れた自動保存は使わない */ }
  if (!resumed) { zm.restart(); showOutput(zm.run()); }
  try { savedGame = JSON.parse(LS.get(K.save) || "null"); } catch (e) { savedGame = null; }

  // claude.ai の中で開いたときだけ使える機能
  if (IN_CLAUDE) {
    window.claude.use("sample").then(s => {
      sample = s;
      if (sample) {
        // 起動時の画面で訳せていない行があれば訳す
        const fresh = rows.filter(r => r.t === "out" && r.parts && !tr.jaOf({ parts: r.parts }).complete);
        if (fresh.length) translateRows(fresh.slice(-30));
      }
    });
    Promise.all([window.claude.use("db"), window.claude.use("user")]).then(async ([d, u]) => {
      if (!d || !u) return;
      try {
        uid = await u.id();
        if (!uid) return;
        db = d;
        const snap = await db.doc(`data/users/${uid}/save`).get();
        if (snap.exists) {
          const g = JSON.parse(snap.data().game);
          if (g) savedGame = g;
        }
      } catch (e) { db = null; }
    });
  }
  // 画面の小さい端末では、開いたとたんにキーボードが出ないようにする
  if (matchMedia("(pointer: fine)").matches) cmdEl.focus({ preventScroll: true });
})();
