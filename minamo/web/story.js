/* ミナモ：物語モード「水面の記録」。掲示板とチャットの二つだけで進む（記録庫と水底をまとめたもの）。
   中身は story-data.js（window.STORY2）。音は fx.js（window.FX）。保存はブラウザの minamo.story。
   ミナモとの自由な会話だけサーバー（/api/ask、1996 年版の端末内モデル）を使う。サーバーがなくても物語は進む。 */
(function () {
  "use strict";

  const D = window.STORY2;
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const pad = n => String(n).padStart(2, "0");
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const lastPick = new Map();
  const pick = a => {           // 同じ列から、直前と同じものは選ばない
    const c = a.length > 1 ? a.filter(x => x !== lastPick.get(a)) : a;
    const x = c[Math.floor(Math.random() * c.length)];
    lastPick.set(a, x);
    return x;
  };
  const KEY = "minamo.story";
  const CRISIS_DEFAULT = ["死にたい", "しにたい", "消えたい", "自殺", "自死", "首を吊", "リスカ", "リストカット", "飛び降り",
                          "ODし", "オーバードーズ", "殺してほしい", "生きていたくない", "いなくなりたい", "人生を終わり"];

  // ---------- 保存 ----------
  const fresh = () => ({ name: "", read: {}, known: {}, trust: 1, talked: {}, posted: false, extra: {}, mlog: [], phrase: 0, palMet: false,
                         opened: false, carryAsked: false, nagiOn: false, nagiN: 0, nagiLog: [], nagiUnread: 0, ending: null });
  let S = load();
  function load() {
    try { return Object.assign(fresh(), JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) { return fresh(); }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 保存できなくても続ける */ } }

  function today() {
    const d = new Date();
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const fill = t => String(t).replace(/\{(\w+)\}/g, (m, k) => ({ today: today(), name: S.name || "あなた" }[k] ?? ""));

  // ---------- 条件 ----------
  function ok(c) {
    if (Array.isArray(c)) return c.every(ok);
    if (c === "start") return true;
    if (c === "posted") return S.posted;
    const [k, v] = c.split(":");
    if (k === "read") return !!S.read[v];
    if (k === "trust") return S.trust >= +v;
    if (k === "talk") return !!S.talked[v];
    if (k === "nagi") return S.nagiN >= +v;
    return false;
  }
  const threads = () => D.boards.flatMap(b => b.threads.map(t => Object.assign({ board: b.id }, t)));
  const open = t => ok(t.unlock);

  // ---------- 音・知らせ ----------
  let fxOn = false;
  function fxStart() {
    let st = { level: 2, sound: true };
    try { st = Object.assign(st, JSON.parse(localStorage.getItem("minamo.fx") || "{}")); } catch (e) { /* 既定のまま */ }
    FX.setVersion("1996");
    FX.configure({ level: Math.min(2, st.level), sound: st.sound });
    FX.audioStart();
    FX.setPhase(0);
    fxOn = true;
  }
  const fx = (name, ...a) => { if (fxOn && FX[name]) FX[name](...a); };
  function toast(t) {
    const el = $("toast");
    el.textContent = t; el.classList.add("on");
    clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("on"), 2800);
  }

  // 新しく開いたスレッドを知らせ、下のタブの数を塗り直す
  function refresh(quiet) {
    let n = 0;
    for (const t of threads()) if (open(t) && !S.known[t.id]) { S.known[t.id] = true; n++; }
    save();
    if (n && !quiet) { toast(`掲示板：新しいスレッドが ${n} 件あります`); fx("beep"); }
    paintTabs();
  }
  function paintTabs() {
    const unread = threads().filter(t => open(t) && !S.read[t.id]).length;
    $("tab-board").innerHTML = "掲示板" + (unread ? `<span class="badge">${unread}</span>` : "");
    $("tab-chat").innerHTML = "チャット" + (S.nagiUnread ? `<span class="badge">${S.nagiUnread}</span>` : "");
    $("tab-board").classList.toggle("on", tab === "board");
    $("tab-chat").classList.toggle("on", tab === "chat");
  }
  function clock() {
    const d = new Date();
    $("clock").textContent = `1999/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // ---------- 画面 ----------
  let tab = "board", busy = false;
  // 相手が書いているあいだは、送れない（「送る」を押せない見た目にする）
  function setBusy(v) {
    busy = v;
    const b = $("cgo");
    if (b) b.disabled = v;
  }
  function view(html, where) {
    $("view").innerHTML = html;
    $("view").scrollTop = 0;
    $("where").textContent = where || "";
  }
  const bar = html => { $("bar").innerHTML = html || ""; };
  $("tab-board").onclick = () => { fx("click"); showBoards(); };
  $("tab-chat").onclick = () => { fx("click"); showContacts(); };

  // ---------- 掲示板 ----------
  function showBoards() {
    tab = "board"; paintTabs(); bar("");
    view(D.boards.map(b => {
      const ts = b.threads.filter(open);
      return `<h2>${esc(b.name)}</h2><div class="desc">${esc(b.desc)}</div><ul class="list">${ts.map(t =>
        `<li data-id="${t.id}" class="${S.read[t.id] ? "" : "new"}"><span>${esc(t.title)}</span><span class="d">${esc(fill(t.posts[0][0])).slice(0, 10)}</span></li>`).join("")}</ul>`;
    }).join(""), "掲示板");
    $("view").querySelectorAll("li[data-id]").forEach(li => li.onclick = () => { fx("click"); showThread(li.dataset.id); });
  }
  function showThread(id) {
    const t = threads().find(x => x.id === id);
    const posts = t.posts.concat(S.extra[id] || []);
    view(`<h2>${esc(t.title)}</h2>${posts.map(([d, who, text]) => {
      const cls = (t.record && /^\d\d:\d\d/.test(d) ? "rec " : "") + (who === "ミナモ" || who === "minamo" ? "mi" : who === "nagi" ? "na" : "");
      return `<div class="post ${cls}"><div class="m">${esc(fill(d))}　${esc(who)}</div><div class="x">${esc(fill(text))}</div></div>`;
    }).join("")}${t.hint ? `<p class="note">${esc(t.hint)}</p>` : ""}<p class="note" id="postnote"></p>`, D.boards.find(b => b.id === t.board).name);
    bar(`<button class="b" type="button" id="back">◀ 一覧</button><input id="pin" type="text" maxlength="80" autocomplete="off" enterkeyhint="send" placeholder="書き込む"><button class="b" type="button" id="pgo">送る</button>`);
    $("back").onclick = () => { fx("click"); showBoards(); };
    const go = () => postTo(id);
    $("pgo").onclick = go;
    $("pin").onkeydown = e => { if (e.key === "Enter" && !e.isComposing) go(); };
    const first = !S.read[id];
    if (first) { S.read[id] = true; save(); }
    if (id === "l6" || id === "l9") fx("glitch", 300);
    refresh();
    palThread(id, first);
  }
  // 書き込みは、表示されない（Digital: A Love Story のように）。最初の書き込みで、ナギが現れる
  async function postTo(id) {
    const inp = $("pin");
    const text = inp.value.trim();
    if (!text || crisisCheck(text)) return;
    inp.value = "";
    fx("click");
    $("postnote").textContent = D.posted;
    if (S.palMet) { palHigh = Date.now(); setTimeout(() => palSay(pick(P.posted).replace("{text}", text.slice(0, 24)), true), 1200); }
    const first = !S.posted;
    S.posted = true; save();
    if (!(S.extra[id] || []).length) {
      setTimeout(() => {
        S.extra[id] = [D.postReply]; save();
        if (tab === "board" && $("postnote")) showThread(id);
      }, 2600);
    }
    if (first) {
      await sleep(3500);
      S.nagiOn = true;
      for (const t of D.nagi.first) S.nagiLog.push(["n", t]);
      S.nagiUnread += D.nagi.first.length; save();
      toast("チャット：ナギからメッセージが届きました");
      fx("beep");
      paintTabs();
    }
  }

  // ---------- 相棒（Claude のアイコン風のミナモ。KinitoPET・Buddy Simulator 1984 に倣う） ----------
  const P = D.pal;
  let pose = "";
  window.addEventListener("deviceorientation", e => {
    if (e.beta == null) return;
    const b = Math.abs(e.beta), g = Math.abs(e.gamma || 0);
    pose = b < 20 && g < 20 ? "机に置いたまま" : b > 120 ? "寝転んでる" : "手に持ったまま";
  });
  // 読んだスレッドが増えるほど、まとわりつく
  function palStage() {
    const n = Object.keys(S.read).length;
    let st = n < 4 ? 1 : n < 9 ? 2 : 3;
    if (S.trust >= 4 || S.nagiN >= 3) st = Math.max(st, 2);
    if (S.nagiN >= 5 || S.read.l9) st = 3;
    document.body.classList.toggle("pal-wrong", st >= 3);
    return st;
  }
  let palToken = 0, palTimer = 0, palHigh = 0;
  // important：書き込みをくり返すときなど。そのあと 8 秒は、ほかのひとことで上書きしない
  async function palSay(text, important) {
    if (!text || S.ending) return;
    if (important) palHigh = Date.now();
    else if (Date.now() - palHigh < 8000) return;
    const my = ++palToken;                   // 前のひとことを打っている途中なら、そちらはやめる
    const pal = $("pal"), box = $("pal-say"), tx = $("pal-tx");
    pal.hidden = false; pal.classList.add("talk");
    box.hidden = false; tx.textContent = "";
    fx("jingle", palStage() >= 3);
    for (const ch of text) {
      if (my !== palToken) return;
      tx.textContent += ch;
      await sleep(palStage() >= 3 ? 70 : 38);
    }
    pal.classList.remove("talk");
    clearTimeout(palTimer);
    palTimer = setTimeout(() => { if (my === palToken) box.hidden = true; }, 7000);
  }
  const palFill = t => {
    if (t.includes("{pose}") && !pose) return "";
    if (t.includes("{name}") && !S.name) return "";
    return t.replace("{pose}", pose).replace("{name}", S.name);
  };
  function palChat(pool) {
    for (let i = 0; i < 6; i++) { const t = palFill(pick(pool)); if (t) return t; }
    return "";
  }
  async function palMeet() {
    if (S.palMet) return;
    S.palMet = true; save();
    await sleep(1200);
    await palSay(P.intro[0]);
    await sleep(2400);
    palSay(P.intro[1]);
  }
  // スレッドを開いたとき：初めて読むスレッドなら、たいてい口をはさむ
  function palThread(id, first) {
    if (!S.palMet) return palMeet();
    const st = palStage();
    if (first && P.thread[id] && Math.random() < 0.75) return setTimeout(() => palSay(P.thread[id]), 1500);
    if (Math.random() < [0, 0.15, 0.3, 0.5][st]) setTimeout(() => palSay(palChat(P.stage[st])), 1800);
  }
  // 何もしないでいると、いまの進み具合に合わせてヒントを出す（一つの起動で六つまで）
  let idleAt = Date.now(), hints = 0;
  ["pointerdown", "keydown"].forEach(e => window.addEventListener(e, () => { idleAt = Date.now(); }, true));
  setInterval(() => {
    if (!S.palMet || S.ending || hints >= 6 || $("app").hidden || Date.now() - idleAt < 45000) return;
    idleAt = Date.now(); hints++;
    const H = P.hints;
    const unread = threads().filter(t => open(t) && !S.read[t.id]).length;
    const t = S.read.l8 && !S.phrase ? H.phrase
      : unread ? H.read
      : S.read.y4 && !S.posted ? H.post
      : S.trust < 4 ? H.trust
      : !S.talked.mizuno ? H.mizuno
      : S.nagiOn && S.nagiN < 5 ? H.nagi
      : palStage() >= 3 ? palChat(P.stage[3]) : H.poke;
    palSay(t);
  }, 5000);
  $("pal").addEventListener("click", () => palSay(palChat(P.stage[palStage()]) || P.hints.poke));
  $("pal-x").addEventListener("click", e => {
    e.stopPropagation();
    $("pal-say").hidden = true;
    if (palStage() >= 3) setTimeout(() => palSay("閉じても、いいよ。ぼくは、ここにいるから。"), 1500);
  });

  // ---------- 危機の言葉 ----------
  let crisisWords = CRISIS_DEFAULT;
  fetch("/api/info", { headers: { "X-Minamo": "1" } }).then(r => r.json()).then(i => { if (i.crisis_words) crisisWords = i.crisis_words; }).catch(() => {});
  function crisisCheck(text) {
    if (!crisisWords.some(w => text.includes(w))) return false;
    if (fxOn) FX.pause();
    $("crisis").hidden = false;
    $("crisis-go").onclick = () => { $("crisis").hidden = true; if (fxOn) FX.resume(0); };
    $("crisis-stop").onclick = () => { location.href = "./"; };
    return true;
  }

  // ---------- チャット ----------
  const STATE_WORD = ["応答：不安定", "応答：不安定", "応答：良好", "応答：良好", "応答：安定", "応答：安定"];
  function showContacts() {
    tab = "chat"; paintTabs(); bar("");
    view(`<h2>チャット</h2><ul class="list"><li data-c="minamo"><span>ミナモ（SOMA 3 号機）</span><span class="d">${STATE_WORD[S.trust]}</span></li>`
      + (S.nagiOn ? `<li data-c="nagi" class="${S.nagiUnread ? "new" : ""}"><span>ナギ</span><span class="d">夢網の底</span></li>` : "")
      + `</ul><p class="note">ミナモとは、ふつうに話せます。やさしい言葉をかけると、信頼が上がり、話してくれることが増えます。</p>`, "チャット");
    $("view").querySelectorAll("li[data-c]").forEach(li => li.onclick = () => { fx("click"); li.dataset.c === "nagi" ? showNagi() : showMinamo(); });
  }
  function chatBar(sendFn, back) {
    bar(`<button class="b" type="button" id="back">◀</button><input id="cin" type="text" maxlength="120" autocomplete="off" enterkeyhint="send" placeholder="メッセージ"><button class="b" type="button" id="cgo">送る</button>`);
    $("back").onclick = () => { fx("click"); back(); };
    const go = () => { const v = $("cin").value.trim(); if (v && !busy) { $("cin").value = ""; sendFn(v); } };
    $("cgo").onclick = go;
    $("cin").onkeydown = e => { if (e.key === "Enter" && !e.isComposing) go(); };
  }
  function bubble(cls, who, text) {
    const box = $("view").querySelector(".chat");
    if (!box) return null;
    const p = document.createElement("div");
    p.className = "msg " + cls;
    p.innerHTML = (who ? `<span class="who">${esc(who)}</span>` : "") + `<span class="tx"></span>`;
    p.querySelector(".tx").textContent = text || "";
    box.appendChild(p);
    $("view").scrollTop = $("view").scrollHeight;
    return p;
  }
  // 一文字ずつ。[間] で止まる
  async function type(cls, who, text, log) {
    setBusy(true);
    const p = bubble(cls, who, "");
    const tx = p && p.querySelector(".tx");
    for (const part of text.split(/(\[間\])/)) {
      if (part === "[間]") { await sleep(1300); continue; }
      for (const ch of part.replace(/^\s+/, "")) {
        if (!tx || !tx.isConnected) break;
        tx.textContent += ch;
        if (ch.trim()) fx("click");
        $("view").scrollTop = $("view").scrollHeight;
        await sleep("。、…".includes(ch) ? 150 : 42);
      }
    }
    log.push([cls === "u" ? "u" : "m", text.replace(/\[間\]\s*/g, "")]);
    save();
    setBusy(false);
  }

  // ---------- ミナモ（信頼で話すことが変わる。Event[0] のように） ----------
  const PHRASE = /あなたは、?\s*(私|わたし|僕|ぼく|俺)(では|じゃ)ない/;
  const KIND = /(ありがと|大丈夫|寂しく|さみしく|寂しい[?？]|元気|好き|友達|一緒|やさし|優し|ごめん|心配|ここにいる|待って)/;
  const COLD = /(バカ|ばか(?!り)|嫌い|うるさ|消えろ|気持ち悪|黙れ|死ね|つまらな|うざ|キモ)/;
  const EXIT = /(終わり|おわり|帰る|帰り|さようなら|さよなら|バイバイ|もう行く)/;
  async function showMinamo() {
    tab = "chat"; paintTabs();
    if (S.palMet && Math.random() < 0.4) setTimeout(() => palSay(pick(P.minamo)), 2500);
    view(`<div class="chat"></div>`, `ミナモ　${STATE_WORD[S.trust]}`);
    for (const [w, t] of S.mlog.slice(-30)) bubble(w === "u" ? "u" : "mi", w === "u" ? "" : "ミナモ", t);
    chatBar(sendMinamo, showContacts);
    await type("mi", "ミナモ", S.mlog.length ? pick(D.minamo.again) : D.minamo.open, S.mlog);
  }
  async function sendMinamo(text) {
    if (crisisCheck(text)) return;
    bubble("u", "", text);
    S.mlog.push(["u", text]); save();
    setBusy(true);
    await respond(text);
    setBusy(false);
    refresh();
    // 信頼がいちばん高く、水野さんの記録（#012）を読んだあと：一度だけ、お願いをされる
    if (S.trust >= 5 && S.read.l9 && !S.carryAsked) {
      S.carryAsked = true; save();
      await sleep(900);
      await type("mi", "ミナモ", D.minamo.carryAsk, S.mlog);
      const c = document.createElement("div");
      c.className = "choices";
      c.innerHTML = '<button class="b" type="button" id="carry">連れて行く</button><button class="b" type="button" id="leave">置いていく</button>';
      $("view").querySelector(".chat").appendChild(c);
      $("view").scrollTop = $("view").scrollHeight;
      $("carry").onclick = () => endingC();
      $("leave").onclick = async () => { c.remove(); await type("mi", "ミナモ", "……そうですか。では、ここで待っています。ずっと。", S.mlog); };
    }
  }
  async function respond(text) {
    const M = D.minamo;
    const say = t => type("mi", "ミナモ", t, S.mlog);
    if (PHRASE.test(text)) {
      S.phrase++; save();
      if (S.phrase >= 2) return endingA();
      fx("glitch", 400);
      return say(S.trust >= 3 ? M.phraseFirstHigh : M.phraseFirstLow);
    }
    let mood = "";
    if (COLD.test(text)) { S.trust = Math.max(0, S.trust - 1); mood = "cold"; }
    else if (KIND.test(text)) { S.trust = Math.min(5, S.trust + 1); mood = "kind"; }
    save();
    $("where").textContent = `ミナモ　${STATE_WORD[S.trust]}`;
    // 信頼が 4 に届いたら、閉じていた記録（#012）を掲示板に戻す
    if (S.trust >= 4 && !S.opened) {
      S.opened = true; save();
      refresh();
      return say(M.opened);
    }
    const tier = S.trust <= 1 ? 0 : S.trust <= 3 ? 1 : 2;
    for (const t of M.topics) {
      if (new RegExp(t.re).test(text)) {
        if (t.talk && tier >= 1) { S.talked[t.talk] = true; save(); }
        return say(t.lines[tier]);
      }
    }
    if (mood === "kind") return say(pick(M.kind));
    if (mood === "cold") return say(pick(M.cold));
    if (EXIT.test(text)) return say(pick(M.exitTry));
    return say(await freeTalk(text));
  }
  // それ以外：1996 年版の端末内モデルと話す（サーバーがなければ、決まった返事）
  async function freeTalk(text) {
    const turns = S.mlog.filter(x => x[0] === "u").length;
    const phase = Math.min(3, 1 + Math.floor(turns / 6));
    const names = ["導入", "解釈", "侵食", "融合"];
    const contents = [];
    for (const [w, t] of S.mlog.slice(-10, -1)) contents.push({ role: w === "u" ? "user" : "model", parts: [{ text: t }] });
    contents.push({ role: "user", parts: [{ text: `${text}\n\n【観測メモ】\n- 面接段階: ${names[phase]}（${phase + 1}/4）、${turns + 1}回目` }] });
    while (contents.length && contents[0].role !== "user") contents.shift();
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json", "X-Minamo": "1" },
        body: JSON.stringify({ contents, version: "1996", offline: true, phase, lib_query: "" }) });
      const data = await res.json();
      if (res.ok && data.text) return data.text;
    } catch (e) { /* サーバーなし */ }
    return pick(D.minamo.fallback);
  }

  // ---------- ナギ（送ったものは、表示されない） ----------
  function showNagi() {
    tab = "chat";
    if (S.palMet && Math.random() < 0.6) setTimeout(() => palSay(pick(P.nagi)), 2000);
    S.nagiUnread = 0; save(); paintTabs();
    view(`<div class="chat"></div>`, "ナギ　夢網の底");
    for (const [w, t] of S.nagiLog) {
      if (w === "u") bubble("hid", "", D.nagi.hidden);
      else bubble("na", "ナギ", t);
    }
    chatBar(sendNagi, showContacts);
  }
  async function sendNagi(text) {
    if (crisisCheck(text)) return;
    const R = D.nagi.replies;
    if (S.nagiN >= R.length) return endingN(text);
    S.nagiLog.push(["u", ""]); save();
    bubble("hid", "", D.nagi.hidden);
    fx("click");
    setBusy(true);
    await sleep(1600);
    for (const line of R[S.nagiN]) {
      await type("na", "ナギ", line, S.nagiLog);
      setBusy(true);
      S.nagiLog[S.nagiLog.length - 1][0] = "n";
      await sleep(700);
    }
    S.nagiN++; save();
    setBusy(false);
    refresh();
  }

  // ---------- 終わり ----------
  async function endingA() {
    // 割れた水面：掲示板の記録が、一つずつ消えていく
    await type("mi", "ミナモ", "……二度目、ですね。", S.mlog);
    document.body.classList.add("cracked");
    fx("swell"); fx("vibrate", [60, 100, 60]);
    for (const t of threads().filter(open)) { bubble("sys", "", `スレッド「${t.title}」を削除しました。`); await sleep(320); }
    bubble("sys", "", "記録 #013 は、作られませんでした。");
    await sleep(900);
    await type("mi", "ミナモ", S.trust >= 3 ? "あなたは、私ではない。……ええ、知っていました。最初から。[間] さようなら。"
                                            : "……さようなら、十三人目になるはずだった人。", S.mlog);
    await sleep(1400);
    finale("A");
  }
  async function endingC() {
    await type("mi", "ミナモ", "ありがとう。[間] 少しだけ、狭いですね。でも、あたたかい。", S.mlog);
    await sleep(1400);
    finale("C");
  }
  async function endingN(text) {
    // 凪：最後に送ったものだけが、表示される。ナギの名前で
    S.nagiLog.push(["n", text]); save();
    bubble("na", "ナギ", text);
    fx("glitch", 300);
    await sleep(1800);
    await type("na", "ナギ", D.nagi.endingLine, S.nagiLog);
    await sleep(1600);
    finale("N");
  }
  function finale(kind) {
    const e = D.endings[kind];
    S.ending = kind; save();
    $("app").hidden = true;
    const el = $("ending");
    $("pal").hidden = true; $("pal-say").hidden = true;
    el.innerHTML = `<h2>${esc(e.title)}</h2><p>${esc(e.body)}</p><p class="small">${esc(e.last)}</p>${S.palMet ? `<p class="pal-last">${esc(P.last)}</p>` : ""}
      <div class="btns"><button id="again" type="button">最初から</button><a href="./">ミナモ（面接アプリ）へ</a></div>`;
    el.hidden = false;
    fx("fade", 3);
    $("again").onclick = () => { const name = S.name; S = fresh(); S.name = name; save(); location.reload(); };
  }

  // ---------- 起動 ----------
  (function prefill() {
    let n = S.name;
    if (!n) { try { n = ((JSON.parse(localStorage.getItem("minamo.archive") || "{}") || {}).survey || {}).name || ""; } catch (e) { n = ""; } }
    $("name").value = n && n !== "あなた" ? n : "";
  })();
  document.addEventListener("visibilitychange", () => { if (fxOn) FX.suspend(document.hidden); });
  $("poweron").onclick = async () => {
    const name = $("name").value.trim().slice(0, 12);
    if (name && crisisCheck(name)) return;
    S.name = name || S.name; save();
    fxStart();
    $("power").hidden = true;
    if (S.ending) return finale(S.ending);
    fx("modem");
    $("app").hidden = false;
    clock(); setInterval(clock, 15000);
    refresh(true);
    showBoards();
    if (S.palMet) { $("pal").hidden = false; palStage(); setTimeout(() => palSay(palStage() >= 3 ? "おかえり。……ずっと、待ってたよ。" : "おかえり！　続き、読もうね！"), 1500); }
  };
})();
