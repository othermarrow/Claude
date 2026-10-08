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
  // text は画面に出す言葉。en があれば、それをそのままゲームに渡す（ボタンや「命令を作る」から）
  async function submit(text, en) {
    text = String(text || "").trim();
    if (busy || zm.finished) return;
    busy = true;
    try {
      let cmd = text;
      if (en) {
        cmd = en;
        push({ t: "cmd", ja: text || en, en: text && text !== en ? en : "" });
      } else if (text && !/^[\x20-\x7e]*$/.test(text)) {
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
      lastRaw = out;
      showOutput(out);
      updateSuggest();
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
  $("pad").addEventListener("click", e => {
    const b = e.target.closest("[data-en]");
    if (b) submit(b.textContent, b.dataset.en);
  });

  // ---- 入力欄の候補（英単語の続き・はい／いいえ） ----
  let lastRaw = "";
  const STARTERS = ["take", "drop", "open", "read", "examine", "turn on", "attack", "with"];
  function contextWords() {
    const set = new Set();
    const text = lastOutputText() + " " + choices().map(c => c.word).join(" ");
    for (const w of text.toLowerCase().split(/[^a-z]+/)) if (w) set.add(w.slice(0, 6));
    return set;
  }
  function chip(label, onClick, cls) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "key" + (cls ? " " + cls : ""); b.textContent = label;
    // 押したときに入力欄からフォーカスが外れないようにする
    b.addEventListener("pointerdown", e => e.preventDefault());
    b.addEventListener("click", onClick);
    return b;
  }
  function updateSuggest() {
    const box = $("suggest");
    box.textContent = "";
    const v = cmdEl.value;
    const typing = document.body.classList.contains("typing");
    if (/RESTART, RESTORE, or QUIT/.test(lastRaw)) {
      for (const [ja, en] of [["やり直す", "restart"], ["ロード", "restore"], ["終了", "quit"]]) box.append(chip(ja, () => submit(ja, en), "ask"));
    } else if (/\(Y is affirmative\)/.test(lastRaw)) {
      for (const [ja, en] of [["はい", "yes"], ["いいえ", "no"]]) box.append(chip(ja, () => submit(ja, en), "ask"));
    } else if (typing && /^[\x20-\x7e]*$/.test(v)) {
      const part = (v.match(/[a-z]+$/i) || [""])[0].toLowerCase();
      let list;
      if (part) {
        const ctx = contextWords();
        list = zm.dictWords().filter(w => w.startsWith(part) && w !== part)
          .sort((a, b) => (ctx.has(b) ? 1 : 0) - (ctx.has(a) ? 1 : 0) || a.length - b.length || (a < b ? -1 : 1))
          .slice(0, 10);
      } else list = v.trim() ? [] : STARTERS;
      for (const w of list) {
        box.append(chip(w, () => {
          cmdEl.value = part ? cmdEl.value.replace(/[a-z]+$/i, w + " ") : cmdEl.value + w + " ";
          cmdEl.focus(); updateSuggest();
        }));
      }
    }
    box.hidden = !box.childElementCount;
  }
  cmdEl.addEventListener("input", updateSuggest);
  cmdEl.addEventListener("focus", () => { document.body.classList.add("typing"); updateSuggest(); scrollDown(); });
  cmdEl.addEventListener("blur", () => {
    setTimeout(() => {
      if (document.activeElement !== cmdEl) { document.body.classList.remove("typing"); updateSuggest(); }
    }, 120);
  });

  // ---- 命令を作る（動詞 → 物 → 2つ目の物）。時計版 zork-watch と同じ流れ ----
  // [ボタンの文字, 英語の型, 日本語の型]。% は1つ目の物、# は2つ目の物
  const VERBS = [
    ["調べる", "examine %", "%を調べる"], ["取る", "take %", "%を取る"],
    ["置く", "drop %", "%を置く"], ["開ける", "open %", "%を開ける"],
    ["閉める", "close %", "%を閉める"], ["読む", "read %", "%を読む"],
    ["つける", "turn on %", "%をつける"], ["消す", "turn off %", "%を消す"],
    ["動かす", "move %", "%を動かす"], ["押す", "push %", "%を押す"],
    ["中を見る", "look in %", "%の中を見る"], ["登る", "climb %", "%に登る"],
    ["入る・乗る", "enter %", "%に入る"], ["食べる", "eat %", "%を食べる"],
    ["飲む", "drink %", "%を飲む"], ["振る", "wave %", "%を振る"],
    ["鳴らす", "ring %", "%を鳴らす"], ["こする", "rub %", "%をこする"],
    ["攻撃する", "attack % with #", "#で%を攻撃する"], ["入れる", "put % in #", "%を#に入れる"],
    ["上に置く", "put % on #", "%を#の上に置く"], ["結ぶ", "tie % to #", "%を#に結ぶ"],
    ["鍵を開ける", "unlock % with #", "#で%の鍵を開ける"], ["火をつける", "light % with #", "#で%に火をつける"],
    ["投げる", "throw % at #", "%を#に投げる"], ["渡す", "give % to #", "%を#に渡す"],
    ["ふくらます", "inflate % with #", "#で%をふくらます"], ["掘る", "dig in % with #", "#で%を掘る"],
  ];
  // 文章に出てきても、物の一覧には出さない名前
  const NOT_THINGS = ["you", "me", "myself", "yourself", "it", "them", "all", "ground", "number", "pseudo",
    "blessings", "kwpxm", "such thing", "random object", "lungs"];
  let allObjs = null;
  function lastOutputText() {
    let i = rows.length - 1;
    while (i >= 0 && rows[i].t !== "cmd") i--;
    return rows.slice(i + 1).filter(r => r.t === "out").map(r => r.en).join(" ");
  }
  // いま選べる物: [{ ja, en, word, held }]
  function choices() {
    const { here, held } = Scene.scene(zm);
    const out = [], seen = new Set();
    const add = (en, word, isHeld) => {
      if (!word || seen.has(word)) return;
      seen.add(word);
      out.push({ ja: tr.name(en) || en, en, word, held: isHeld });
    };
    for (const o of held) add(o.en, o.word, true);
    for (const o of here) add(o.en, o.word, false);
    if (!allObjs) allObjs = Scene.allObjects(zm);
    for (const o of Scene.mentioned(zm, allObjs, lastOutputText())) {
      if (NOT_THINGS.includes(o.word) || NOT_THINGS.includes(o.en)) continue;
      // 名前の最後の単語だけが出てきたときは、その単語で表示する
      add(o.word === o.last && o.en !== o.last ? o.last : o.en, o.word, false);
    }
    return out;
  }
  const builder = $("builder");
  const bs = { step: "verb", verb: null, obj1: null };
  function fill(tmpl, a, b) { return tmpl.replace("%", a).replace("#", b); }
  function bButton(main, sub, onClick, cls) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "bk" + (cls ? " " + cls : "");
    const m = document.createElement("span"); m.textContent = main; b.append(m);
    if (sub) { const t = document.createElement("span"); t.className = "sub"; t.textContent = sub; b.append(t); }
    b.addEventListener("click", onClick);
    return b;
  }
  function renderBuilder() {
    const list = $("b-list");
    list.textContent = "";
    list.scrollTop = 0;
    if (bs.step === "verb") {
      $("b-title").textContent = "何をする？";
      $("b-preview").textContent = "";
      list.className = "verbs";
      for (const v of VERBS) {
        list.append(bButton(v[0], v[1].replace(/ ?[%#]/g, "").trim(), () => {
          bs.verb = v; bs.step = "obj"; renderBuilder();
        }));
      }
      $("b-back").hidden = true;
      return;
    }
    $("b-back").hidden = false;
    const v = bs.verb, second = bs.step === "obj2";
    $("b-title").textContent = second ? "何で・何に？" : "何を？";
    $("b-preview").textContent = second
      ? fill(v[2], bs.obj1.ja, "…") + "　" + fill(v[1], bs.obj1.word, "…")
      : fill(v[2], "…", "…") + "　" + fill(v[1], "…", "…");
    list.className = "one";
    let items = choices();
    if (second) items = items.filter(it => it.word !== bs.obj1.word);
    if (!second && /^(take|drop|put) /.test(v[1])) items.push({ ja: "全部", en: "all", word: "all", held: false });
    for (const it of items) {
      const label = it.ja + (it.held ? "（持）" : "");
      list.append(bButton(label, it.ja !== it.en ? it.en : "", () => {
        if (!second) {
          bs.obj1 = it;
          if (v[1].includes("#")) { bs.step = "obj2"; renderBuilder(); return; }
          closeBuilder();
          submit(fill(v[2], it.ja, ""), fill(v[1], it.word, ""));
        } else {
          closeBuilder();
          submit(fill(v[2], bs.obj1.ja, it.ja), fill(v[1], bs.obj1.word, it.word));
        }
      }, it.held ? "held" : ""));
    }
    if (!items.length) {
      const p = document.createElement("p");
      p.className = "empty"; p.textContent = "選べる物がありません。「キーボードで書く」で入力できます。";
      list.append(p);
    }
  }
  function openBuilder() {
    if (busy || zm.finished) return;
    bs.step = "verb"; bs.verb = null; bs.obj1 = null;
    builder.hidden = false;
    $("build-btn").setAttribute("aria-expanded", "true");
    renderBuilder();
  }
  function closeBuilder() {
    builder.hidden = true;
    $("build-btn").setAttribute("aria-expanded", "false");
  }
  $("build-btn").addEventListener("click", openBuilder);
  $("b-close").addEventListener("click", closeBuilder);
  builder.addEventListener("click", e => { if (e.target === builder) closeBuilder(); });
  $("b-back").addEventListener("click", () => {
    bs.step = bs.step === "obj2" ? "obj" : "verb";
    renderBuilder();
  });
  // 一覧にない物はキーボードで。途中まで組み立てた英語の命令を入力欄に入れる
  $("b-keys").addEventListener("click", () => {
    let prefix = "";
    if (bs.verb) {
      prefix = bs.step === "obj2" ? fill(bs.verb[1], bs.obj1.word, "") : bs.verb[1].split("%")[0];
    }
    closeBuilder();
    cmdEl.value = prefix;
    cmdEl.focus();
    updateSuggest();
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !builder.hidden) closeBuilder(); });

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
    lastRaw = zm.run();
    showOutput(lastRaw);
    updateSuggest();
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
  if (!resumed) { zm.restart(); lastRaw = zm.run(); showOutput(lastRaw); }
  else lastRaw = lastOutputText();
  updateSuggest();
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
