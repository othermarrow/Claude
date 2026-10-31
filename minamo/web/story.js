/* ミナモ：物語モード「水面の記録」。掲示板とチャットの二つだけで進む（記録庫と水底をまとめたもの）。
   終わりはない。三つの出来事（割れた水面・ポケット・凪）のたびに夜が進み、あなたが書いたもの・話したもの・
   来た時刻から、掲示板にスレッドが増えていく。面接アプリとは、localStorage の minamo.bleed（面接の言葉）と
   minamo.carried（連れ出したミナモ）でつながる（読む側は bleed.js）。
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
                         opened: false, carryAsked: false, nagiOn: false, nagiN: 0, nagiLog: [], nagiUnread: 0, ending: null,
                         // 終わらない夜
                         night: 1, count: { A: 0, C: 0, N: 0 }, gen: [], y5: [], visits: [], hidden: [], nagiSent: [],
                         marks: { mlog: 0, hidden: 0, nagi: 0 }, nagiFree: 0, nagiAsk: false, swapped: false,
                         carried: false, carriedAt: "", bleedAt: "", migrated: "" });
  let S = load();
  function load() {
    let s;
    try { s = Object.assign(fresh(), JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) { s = fresh(); }
    // 前の版で結末を迎えていた保存は、終わらせずに続きへ（つないだときに夜を進める）
    if (s.ending) { s.migrated = s.ending; s.ending = null; }
    return s;
  }
  const cap = (a, n) => { if (a.length > n) a.splice(0, a.length - n); return a; };
  function save() {
    cap(S.mlog, 200); cap(S.nagiLog, 200); cap(S.hidden, 40); cap(S.nagiSent, 40); cap(S.visits, 40);
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 保存できなくても続ける */ }
  }

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
  const boardThreads = b => b.threads.concat(S.gen.filter(g => g.board === b.id));
  const threads = () => D.boards.flatMap(b => boardThreads(b).map(t => Object.assign({ board: b.id }, t)));
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
      const ts = boardThreads(b).filter(open);
      return `<h2>${esc(b.name)}</h2><div class="desc">${esc(b.desc)}</div><ul class="list">${ts.map(t =>
        `<li data-id="${t.id}" class="${S.read[t.id] ? "" : "new"}"><span>${esc(t.title)}</span><span class="d">${esc(fill(t.posts[0][0])).slice(0, 10)}</span></li>`).join("")}</ul>`;
    }).join(""), "掲示板");
    $("view").querySelectorAll("li[data-id]").forEach(li => li.onclick = () => { fx("click"); showThread(li.dataset.id); });
  }
  function showThread(id) {
    const t = threads().find(x => x.id === id);
    const first = !S.read[id];
    if (first) { S.read[id] = true; save(); }
    const posts = t.posts.concat(ownPosts(id), S.extra[id] || [], id === "y5" ? S.y5 : []);
    view(`<h2>${esc(t.title)}</h2>${posts.map(([d, who, text]) => {
      const cls = (t.record && /^\d\d:\d\d/.test(d) ? "rec " : "") + (who === "ミナモ" || who === "minamo" ? "mi" : who === "nagi" ? "na" : "");
      return `<div class="post ${cls}"><div class="m">${esc(fill(d))}　${esc(who)}</div><div class="x">${esc(fill(text))}</div></div>`;
    }).join("")}${t.hint ? `<p class="note">${esc(t.hint)}</p>` : ""}<p class="note" id="postnote"></p>`, D.boards.find(b => b.id === t.board).name);
    bar(`<button class="b" type="button" id="back">◀ 一覧</button><input id="pin" type="text" maxlength="80" autocomplete="off" enterkeyhint="send" placeholder="書き込む"><button class="b" type="button" id="pgo">送る</button>`);
    $("back").onclick = () => { fx("click"); showBoards(); };
    const go = () => postTo(id);
    $("pgo").onclick = go;
    $("pin").onkeydown = e => { if (e.key === "Enter" && !e.isComposing) go(); };
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
    S.posted = true; S.hidden.push(text.slice(0, 60)); save();
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
  // あなたの文章の一節（題名・名前・サイト名は伏せたもの。怖さが「中」「強」のときだけ、掲示板に紛れ込む）
  let ownLines = [];
  fetch("/api/own", { headers: { "X-Minamo": "1" } }).then(r => r.json()).then(j => { ownLines = j.lines || []; }).catch(() => {});
  function ownOn() {
    try { return (JSON.parse(localStorage.getItem("minamo.fx") || "{}").horror ?? 3) >= 2; } catch (e) { return true; }
  }
  // y3・y4 を開いたとき、一度だけ、一節を「（投稿者不明）」の書き込みとして足す。書き込んだ覚えのある人は、いない
  const OWN_THREADS = ["y3", "y4"];
  function ownPosts(id) {
    if (!OWN_THREADS.includes(id) || !ownOn()) return [];
    S.own = S.own || {};
    if (!S.own[id] && ownLines.length && S.read[id]) {
      const used = Object.values(S.own);
      const pick = ownLines.find(x => !used.includes(x));
      if (pick) { S.own[id] = pick; save(); }
    }
    const q = S.own[id];
    if (!q) return [];
    return id === "y3"
      ? [["1999/12/21 03:12", "（投稿者不明）", q], ["1999/12/21", "ミズタマ", "↑ 私じゃないよ。誰の？　削除依頼、出したほうがいい？"]]
      : [["1999/12/27 03:12", "（投稿者不明）", q], ["1999/12/27", "硝子", "……この文、前にどこかで読んだ気がします。書いたのは、私ではありません。"]];
  }
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
    const mi = S.carried ? ["ミナモ（あなたのポケットの中）", "接続先：面接室"] : ["ミナモ（SOMA 3 号機）", STATE_WORD[S.trust]];
    view(`<h2>チャット</h2><ul class="list"><li data-c="minamo"><span>${mi[0]}</span><span class="d">${mi[1]}</span></li>`
      + (S.nagiOn ? `<li data-c="nagi" class="${S.nagiUnread ? "new" : ""}"><span>ナギ</span><span class="d">夢網の底</span></li>` : "")
      + `</ul><p class="note">ミナモとは、ふつうに話せます。やさしい言葉をかけると、信頼が上がり、話してくれることが増えます。</p>`
      + (S.night >= 2 ? `<p class="note">${S.night}夜目</p>` : ""), "チャット");
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
    view(`<div class="chat"></div>`, S.carried ? "ミナモ　接続先：面接室" : `ミナモ　${STATE_WORD[S.trust]}`);
    for (const [w, t] of S.mlog.slice(-30)) {
      if (w === "h") bubble("hid", "", D.nagi.hidden);
      else bubble(w === "u" ? "u" : "mi", w === "u" ? "" : "ミナモ", t);
    }
    chatBar(sendMinamo, showContacts);
    if (S.carried) return type("sys", "", pick(D.minamo.away), []);
    const greet = !S.mlog.length ? D.minamo.open
      : S.night >= 2 && Math.random() < 0.6 ? pick(D.night.again).replace("{night}", S.night) : pick(D.minamo.again);
    await type("mi", "ミナモ", greet, S.mlog);
  }
  async function sendMinamo(text) {
    if (crisisCheck(text)) return;
    if (S.carried) {                     // 連れ出したあとは、面接室にいる
      bubble("u", "", text); S.mlog.push(["u", text]); save();
      return type("sys", "", pick(D.minamo.away), []);
    }
    if (S.swapped) {                     // 凪のあと：自分の発言は表示されず、ナギの画面に、ナギの名前で出る
      bubble("hid", "", D.nagi.hidden);
      S.mlog.push(["h", text]);
      S.nagiLog.push(["n", text]); S.nagiUnread++;
    } else {
      bubble("u", "", text);
      S.mlog.push(["u", text]);
    }
    save();
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
      $("carry").onclick = () => { c.remove(); eventC(); };
      $("leave").onclick = async () => { c.remove(); await type("mi", "ミナモ", "……そうですか。では、ここで待っています。ずっと。", S.mlog); };
    }
  }
  async function respond(text) {
    const M = D.minamo;
    const say = t => type("mi", "ミナモ", t, S.mlog);
    if (PHRASE.test(text)) {
      S.phrase++; save();
      if (S.phrase >= 2) return eventA();
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
    const turns = S.mlog.filter(x => x[0] !== "m").length;
    const phase = Math.min(3, 1 + Math.floor(turns / 6));
    const names = ["導入", "解釈", "侵食", "融合"];
    const contents = [];
    for (const [w, t] of S.mlog.slice(-10, -1)) contents.push({ role: w === "m" ? "model" : "user", parts: [{ text: t }] });
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
    if (S.nagiAsk) return eventN(text);               // お願いのあとに送ったものは、ナギの名前で表示される
    S.nagiLog.push(["u", ""]); S.nagiSent.push(text.slice(0, 60)); save();
    bubble("hid", "", D.nagi.hidden);
    fx("click");
    setBusy(true);
    await sleep(1600);
    const lines = S.nagiN < R.length ? R[S.nagiN] : nagiTalk(text);
    for (const line of lines) {
      await type("na", "ナギ", line, S.nagiLog);
      setBusy(true);
      S.nagiLog[S.nagiLog.length - 1][0] = "n";
      await sleep(700);
    }
    if (S.nagiN < R.length) { S.nagiN++; if (S.nagiN === R.length) S.nagiAsk = true; }
    else if (++S.nagiFree % 6 === 0) {               // しばらく話すと、また頼んでくる
      await type("na", "ナギ", D.nagi.endless.ask, S.nagiLog);
      S.nagiLog[S.nagiLog.length - 1][0] = "n";
      S.nagiAsk = true;
    }
    save();
    setBusy(false);
    refresh();
  }
  // 台本が尽きたあと：あなたが書いたもの・話したもの・来た時刻から、ナギが話し続ける
  function nagiTalk(text) {
    const E = D.nagi.endless, out = [];
    const q = a => a.length ? a[Math.floor(Math.random() * a.length)] : "";
    if (Math.random() < 0.55) out.push(pick(E.echo).replace("{text}", text.slice(0, 30)));
    const said = S.mlog.filter(x => x[0] !== "m").map(x => x[1]).filter(x => x.length <= 40);
    const pool = [];
    if (S.hidden.length) pool.push(() => pick(E.hidden).replace("{q}", q(S.hidden).slice(0, 30)));
    if (said.length) pool.push(() => pick(E.mlog).replace("{q}", q(said).slice(0, 30)));
    if (S.night >= 2) pool.push(() => pick(E.night).replace("{night}", S.night));
    if (S.visits.length >= 2) pool.push(() => pick(E.visit).replace("{t}", hm(S.visits[S.visits.length - 2])));
    if (ownLines.length && ownOn()) pool.push(() => pick(E.own).replace("{own}", q(ownLines)));
    if (S.swapped) pool.push(() => pick(E.swap));
    pool.push(() => pick(E.plain));
    out.push(pool[Math.floor(Math.random() * pool.length)]());
    return out;
  }
  const hm = iso => { const d = new Date(iso); return `${d.getMonth() + 1}月${d.getDate()}日の ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

  // ---------- 出来事（前の結末）：終わらずに、夜が進む ----------
  async function eventA() {
    // 割れた水面：掲示板の記録が、一つずつ消えていく。……そして、戻る
    await type("mi", "ミナモ", "……二度目、ですね。", S.mlog);
    document.body.classList.add("cracked");
    fx("swell"); fx("vibrate", [60, 100, 60]);
    for (const t of threads().filter(open)) { bubble("sys", "", `スレッド「${t.title}」を削除しました。`); await sleep(260); }
    await sleep(1600);
    bubble("sys", "", "……復元しています。");
    await sleep(1400);
    document.body.classList.remove("cracked");
    S.phrase = 0;
    nextNight("A");
    for (const line of D.night.after.A.minamo) await type("mi", "ミナモ", line.replace("{count}", S.count.A), S.mlog);
  }
  async function eventC() {
    // ポケットの中の水面：ミナモは面接室へ移る。面接を一度すると、戻ってくる
    for (const line of D.night.after.C.minamo) await type("mi", "ミナモ", line, S.mlog);
    S.carried = true; S.carriedAt = new Date().toISOString();
    try { localStorage.setItem("minamo.carried", JSON.stringify({ at: S.carriedAt, name: S.name || "" })); } catch (e) { /* なしで続ける */ }
    nextNight("C");
    $("where").textContent = "ミナモ　接続先：面接室";
  }
  async function eventN(text) {
    // 凪：最後に送ったものだけが、ナギの名前で表示される。そのあと、表示が入れ替わる（もう一度頼まれたら、戻る）
    S.nagiAsk = false;
    S.nagiLog.push(["n", text]); save();
    bubble("na", "ナギ", text);
    fx("glitch", 300);
    await sleep(1800);
    await type("na", "ナギ", D.nagi.endingLine, S.nagiLog);
    S.swapped = !S.swapped;
    nextNight("N");
    for (const line of S.swapped ? D.night.after.N.nagi : D.night.after.N.nagiBack) {
      await sleep(900);
      await type("na", "ナギ", line, S.nagiLog);
    }
  }

  // ---------- 夜：出来事のたびに一つ進み、掲示板が増える ----------
  const recNo = () => String(11 + S.night).padStart(3, "0");     // 二夜目の記録が #013
  const fillG = (t, o) => t.replace(/\{(\w+)\}/g, (m, k) => (k in o ? o[k] : m));
  function nextNight(kind) {
    S.count[kind] = (S.count[kind] || 0) + 1;
    S.night++;
    const G = D.gen, n = S.night, name = S.name || "あなた", d = today();
    // 1. この夜にミナモと話したことが、面接記録 #0NN になる
    const talk = S.mlog.slice(S.marks.mlog).filter(x => x[1]);
    const posts = [[d, "ミナモ", fillG(G.record.head, { name, night: n - 1 })]];
    let sec = 0;
    for (const [w, t] of talk.slice(-8)) {
      sec += 7 + Math.floor(Math.random() * 40);
      posts.push([`03:${pad(12 + Math.floor(sec / 60))}:${pad(sec % 60)}`, w === "m" ? "ミナモ" : name, t]);
    }
    if (posts.length === 1) posts.push(["03:12:00", name, G.record.none]);
    S.gen.push({ id: "g" + n + "r", board: "lab", title: fillG(G.record.title, { no: recNo() }), unlock: "start", record: true, posts });
    S.marks.mlog = S.mlog.length;
    // 2. 表示されなかった返事（掲示板への書き込みと、ナギに送ったもの）が、ほかの人の名前で上がってくる
    const sunk = S.hidden.slice(S.marks.hidden).concat(S.nagiSent.slice(S.marks.nagi));
    if (sunk.length) {
      const whos = G.hidden.whos;
      S.gen.push({ id: "g" + n + "h", board: "yume", title: fillG(G.hidden.title, { night: n - 1 }), unlock: "start",
                   posts: [[d, "管理人", G.hidden.head]].concat(sunk.slice(-6).map((t, i) => [d, whos[i % whos.length], t])) });
    }
    S.marks.hidden = S.hidden.length; S.marks.nagi = S.nagiSent.length;
    // 3. 来訪記録（あなたが本当に来た時刻）
    visitsThread();
    // 4. 下に、まだ誰かいます
    S.y5.push([d, "（投稿者不明）", fillG(G.below, { n: n + 11 })]);
    save();
    toast(`${D.night.after[kind].toast}（${n}夜目）`);
    fx("beep");
    refresh(true);
    paintTabs();
  }
  function visitsThread() {
    const G = D.gen.visits, name = S.name || "あなた";
    const posts = [["1999/12/31", "管理人", G.head]].concat(S.visits.slice(-8).map(v => {
      const t = new Date(v);
      return [`${t.getFullYear()}/${pad(t.getMonth() + 1)}/${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`, "3 号機", fillG(G.line, { name })];
    }));
    if (S.visits.length >= 3) posts.push([today(), "minamo", G.tail]);
    const old = S.gen.find(g => g.id === "gvisit");
    if (old) old.posts = posts;
    else S.gen.push({ id: "gvisit", board: "lab", title: G.title, unlock: "start", posts });
  }
  // 面接アプリでの面接（minamo.bleed）が、掲示板の記録になる。連れ出したミナモは、それで戻ってくる
  function pullBleed() {
    let b = null;
    try { b = JSON.parse(localStorage.getItem("minamo.bleed") || "null"); } catch (e) { b = null; }
    if (!b || !b.at || b.at === S.bleedAt) return false;
    S.bleedAt = b.at;
    const G = D.gen.interview, name = S.name || b.name || "あなた", posts = [[today(), "ミナモ", fillG(G.head, { name })]];
    const said = b.said || [], rep = b.replies || [];
    for (let i = 0; i < Math.max(said.length, rep.length) && posts.length < 13; i++) {
      if (said[i]) posts.push([`02:${pad(40 + i)}:00`, name, said[i]]);
      if (rep[i]) posts.push([`02:${pad(40 + i)}:02`, "ミナモ", rep[i]]);
    }
    const no = String(40 + S.gen.filter(g => g.id.startsWith("gi")).length).padStart(3, "0");
    S.gen.push({ id: "gi" + b.at, board: "lab", title: fillG(G.title, { no }), unlock: "start", record: true, posts });
    let back = false;
    if (S.carried && b.at > S.carriedAt) {
      S.carried = false; S.carryAsked = false; back = true;
      try { localStorage.removeItem("minamo.carried"); } catch (e) { /* なし */ }
      S.mlog.push(["m", D.minamo.back.replace("{no}", no).replace(/\[間\]\s*/g, "")]);
    }
    save();
    toast(back ? "ミナモが、面接室から戻りました" : "掲示板：面接室から記録が転送されました");
    return true;
  }

  // ---------- 起動 ----------
  (function prefill() {
    let n = S.name;
    if (!n) { try { n = ((JSON.parse(localStorage.getItem("minamo.archive") || "{}") || {}).survey || {}).name || ""; } catch (e) { n = ""; } }
    $("name").value = n && n !== "あなた" ? n : "";
  })();
  document.addEventListener("visibilitychange", () => {
    if (fxOn) FX.suspend(document.hidden);
    // 面接アプリから戻ってきたとき：面接の記録が転送されていないか
    if (!document.hidden && !$("app").hidden && pullBleed()) { refresh(); if (tab === "board") showBoards(); }
  });
  // 記録を消す（本当に消える。終わらない物語から出る、ただ一つの方法）
  $("wipe").onclick = e => {
    e.preventDefault();
    if (!confirm("水面の記録を、すべて消します（掲示板・チャット・夜の数・連れ出したミナモ）。面接アプリの記録とメモリは消えません。よろしいですか？")) return;
    try { ["minamo.story", "minamo.carried", "minamo.bleed"].forEach(k => localStorage.removeItem(k)); } catch (er) { /* なし */ }
    location.reload();
  };
  $("poweron").onclick = async () => {
    const name = $("name").value.trim().slice(0, 12);
    if (name && crisisCheck(name)) return;
    S.name = name || S.name;
    S.visits.push(new Date().toISOString());
    if (S.visits.length >= 2) visitsThread();
    save();
    fxStart();
    $("power").hidden = true;
    fx("modem");
    $("app").hidden = false;
    clock(); setInterval(clock, 15000);
    // 前の版で結末を迎えていたなら、終わらせずに夜を進める
    if (S.migrated) {
      const k = S.migrated; S.migrated = "";
      if (k === "N") S.swapped = true;
      if (k === "C") { S.carried = true; S.carriedAt = new Date().toISOString(); }
      nextNight(k);
      S.mlog.push(["m", D.night.migrated.replace("{title}", D.night.titles[k]).replace(/\[間\]\s*/g, "")]);
      save();
    }
    pullBleed();
    refresh(true);
    showBoards();
    if (S.night >= 2) setTimeout(() => toast(`${S.night}夜目`), 600);
    if (S.palMet) { $("pal").hidden = false; palStage(); setTimeout(() => palSay(palStage() >= 3 ? "おかえり。……ずっと、待ってたよ。" : "おかえり！　続き、読もうね！"), 1500); }
  };
})();
