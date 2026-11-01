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
                         carried: false, carriedAt: "", bleedAt: "", migrated: "",
                         // 自我（気分・覚えていること）・登場人物の書き込み・整理・結末
                         mood: { minamo: 0, nagi: 0, board: 0 }, mem: { minamo: [], nagi: [], board: [] }, miUnread: 0,
                         auto: {}, archived: {}, endings: [], endNo: 0, pend: null, ear: false });
  let S = load();
  function load() {
    let s;
    try { s = Object.assign(fresh(), JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) { s = fresh(); }
    // 前の版で結末を迎えていた保存は、終わらせずに続きへ（つないだときに夜を進める）
    if (s.ending) { s.migrated = s.ending; s.ending = null; }
    // 凪はなくなった：入れ替わりとお願いは、元に戻す。作りかけの結末は、作り直す
    s.swapped = false; s.nagiAsk = false;
    if (s.pend && s.pend.pending) s.pend = null;
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
    const unread = threads().filter(t => open(t) && !S.read[t.id] && !S.archived[t.id]).length;
    $("tab-board").innerHTML = "掲示板" + (unread ? `<span class="badge">${unread}</span>` : "");
    const chatN = S.nagiUnread + (S.miUnread || 0);
    $("tab-chat").innerHTML = "チャット" + (chatN ? `<span class="badge">${chatN}</span>` : "");
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
  const L = D.life, LE = D.ends;
  let curThread = "";
  const san = () => (S.name ? S.name + "さん" : "あなた");
  // 夜ごとに作ったスレッドは、夜でまとめる（前の版で作ったものは、id から夜を読む）
  const nightOf = t => t.night || (/^g(\d+)[rh]$/.exec(t.id) || [])[1] * 1 || 0;
  const firstDate = t => esc(fill((t.posts[0] || [""])[0])).slice(0, 10);
  const readingNow = () => {
    let n = 1 + (S.night >= 2 ? 1 : 0) + (Math.random() < 0.15 ? 1 : 0);
    if (S.night >= 4 && Math.random() < 0.06) n = 13;
    return `閲覧中：${n}人`;
  };
  function showBoards() {
    tab = "board"; curThread = ""; chatWho = ""; paintTabs(); bar("");
    const li = t => `<li data-id="${t.id}" class="${S.read[t.id] ? "" : "new"}"><span>${esc(t.title)}</span><span class="d">${firstDate(t)}</span></li>`;
    const stored = threads().filter(t => open(t) && S.archived[t.id]);
    view(`<div class="tools"><button class="b sm" type="button" id="tidy-read">既読を片づける</button>`
      + `<button class="b sm" type="button" id="tidy-all">全部片づける</button></div>`
      + D.boards.map(b => {
        const ts = boardThreads(b).filter(t => open(t) && !S.archived[t.id]);
        const base = ts.filter(t => !nightOf(t)), gen = ts.filter(t => nightOf(t));
        const nights = [...new Set(gen.map(nightOf))].sort((x, y) => y - x);
        return `<h2>${esc(b.name)}</h2><div class="desc">${esc(b.desc)}</div><ul class="list">${base.map(li).join("")}</ul>`
          + nights.map((n, i) => {
            const g = gen.filter(t => nightOf(t) === n);
            return `<details class="grp"${i === 0 ? " open" : ""}><summary>${n}夜目（${g.length}件${g.some(t => !S.read[t.id]) ? "・新着" : ""}）</summary>`
              + `<ul class="list">${g.map(li).join("")}</ul></details>`;
          }).join("");
      }).join("")
      + (stored.length ? `<details class="grp store"><summary>${L.tidy.store}（${stored.length}件）</summary><p class="note">${L.tidy.storeNote}</p>`
        + `<ul class="list">${stored.map(t => `<li data-id="${t.id}"><span>${esc(t.title)}</span>`
        + `<button class="b sm" type="button" data-back="${t.id}">${L.tidy.back}</button></li>`).join("")}</ul></details>` : ""),
      `掲示板　${readingNow()}`);
    $("view").querySelectorAll("li[data-id]").forEach(li => li.onclick = e => {
      if (e.target.dataset.back) { e.stopPropagation(); delete S.archived[e.target.dataset.back]; save(); fx("click"); return showBoards(); }
      fx("click"); showThread(li.dataset.id);
    });
    $("tidy-read").onclick = () => tidy(threads().filter(t => open(t) && S.read[t.id] && !S.archived[t.id]).map(t => t.id));
    $("tidy-all").onclick = () => tidy(threads().filter(t => open(t) && !S.archived[t.id]).map(t => t.id), true);
  }
  // 片づける（倉庫に沈める。消えはしない）。全部片づけると、結末のきっかけになることがある
  function tidy(ids, all) {
    if (!ids.length) return toast("片づけるスレッドがありません");
    ids.forEach(id => { S.archived[id] = Date.now(); });
    save(); fx("click");
    toast(all ? L.tidy.all : L.tidy.done.replace("{n}", ids.length));
    paintTabs();
    if (!threads().some(t => open(t) && !S.archived[t.id])) endCheck("tidy");
    if (!endingOn) showBoards();
  }
  function threadPosts(id) {
    const t = threads().find(x => x.id === id);
    return t.posts.concat(ownPosts(id), S.extra[id] || [], id === "y5" ? S.y5 : [], S.auto[id] || []);
  }
  function showThread(id, fresh) {
    const t = threads().find(x => x.id === id);
    if (!t) return showBoards();
    curThread = id; chatWho = "";
    const first = !S.read[id];
    if (first) { S.read[id] = true; save(); }
    const posts = threadPosts(id);
    view(`<h2>${esc(t.title)}<button class="b sm right" type="button" id="arch">${S.archived[id] ? L.tidy.back : L.tidy.one}</button></h2>`
      + posts.map(([d, who, text], i) => {
        const cls = (t.record && /^\d\d:\d\d/.test(d) ? "rec " : "") + (who === "ミナモ" || who === "minamo" ? "mi" : who === "nagi" || who === "ナギ" ? "na" : "")
          + (fresh && i === posts.length - 1 ? " fresh" : "");
        return `<div class="post ${cls}"><div class="m">${esc(fill(d))}　${esc(who)}</div><div class="x">${esc(fill(text))}</div></div>`;
      }).join("") + (t.hint ? `<p class="note">${esc(t.hint)}</p>` : "") + `<p class="note" id="postnote"></p>`,
      `${D.boards.find(b => b.id === t.board).name}　${readingNow()}`);
    if (fresh) $("view").scrollTop = $("view").scrollHeight;
    bar(`<button class="b" type="button" id="back">◀ 一覧</button><input id="pin" type="text" maxlength="80" autocomplete="off" enterkeyhint="send" placeholder="書き込む"><button class="b" type="button" id="pgo">送る</button>`);
    $("back").onclick = () => { fx("click"); showBoards(); };
    $("arch").onclick = () => {
      if (S.archived[id]) { delete S.archived[id]; save(); toast("戻しました"); return showThread(id); }
      tidy([id]);
    };
    const go = () => postTo(id);
    $("pgo").onclick = go;
    $("pin").onkeydown = e => { if (e.key === "Enter" && !e.isComposing) go(); };
    if (id === "l6" || id === "l9") fx("glitch", 300);
    refresh();
    palThread(id, first);
    if (!fresh && S.pend && S.pend.trigger.type === "read") {
      S.pend.reads = S.pend.reads || {};
      S.pend.reads[id] = (S.pend.reads[id] || 0) + 1; save();
      endCheck("read", { n: S.pend.reads[id] });
    }
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
    if (endCheck("post", { text })) return;
    if (!(S.extra[id] || []).length) {
      setTimeout(() => {
        S.extra[id] = [D.postReply]; save();
        if (tab === "board" && curThread === id) showThread(id, true);
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
    const unread = threads().filter(t => open(t) && !S.read[t.id] && !S.archived[t.id]).length;
    const t = S.read.l8 && !S.phrase ? H.phrase
      : unread ? H.read
      : S.read.y4 && !S.posted ? H.post
      : S.trust < 4 ? H.trust
      : !S.talked.mizuno ? H.mizuno
      : S.nagiOn && S.nagiN < 5 ? H.nagi
      : palStage() >= 3 ? palChat(P.stage[3]) : H.poke;
    palSay(t);
  }, 5000);
  $("pal").addEventListener("click", () => {
    palTaps = Date.now() - palTapAt < 4000 ? palTaps + 1 : 1; palTapAt = Date.now();
    if (endCheck("pal", { n: palTaps })) return;
    palSay(palChat(P.stage[palStage()]) || P.hints.poke);
  });
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
  let chatWho = "";                    // いま開いているチャット（minamo・nagi。開いていなければ空）
  const lastBubble = {};               // 登場人物ごとの、最後の吹き出し（取り消し・書き換えのため）
  const minamoWord = () => (S.mood.minamo <= -2 ? "応答：不安定" : STATE_WORD[S.trust]);
  function showContacts() {
    tab = "chat"; curThread = ""; chatWho = ""; paintTabs(); bar("");
    const mi = S.carried ? ["ミナモ（あなたのポケットの中）", "接続先：面接室"] : ["ミナモ（SOMA 3 号機）", minamoWord()];
    view(`<h2>チャット</h2><ul class="list"><li data-c="minamo" class="${S.miUnread ? "new" : ""}"><span>${mi[0]}</span><span class="d">${mi[1]}</span></li>`
      + (S.nagiOn ? `<li data-c="nagi" class="${S.nagiUnread ? "new" : ""}"><span>ナギ</span><span class="d">夢網の底</span></li>` : "")
      + `</ul><p class="note">ミナモとは、ふつうに話せます。やさしい言葉をかけると、信頼が上がり、話してくれることが増えます。</p>`
      + `<p class="note">${esc(L.voice[aiSource] || L.voice[""])}</p>`
      + (S.night >= 2 ? `<p class="note">${S.night}夜目　結末の目録：${S.endings.length}件</p>` : ""), "チャット");
    $("view").querySelectorAll("li[data-c]").forEach(li => li.onclick = () => { fx("click"); li.dataset.c === "nagi" ? showNagi() : showMinamo(); });
  }
  function chatBar(sendFn, back) {
    bar(`<button class="b" type="button" id="back">◀</button><input id="cin" type="text" maxlength="120" autocomplete="off" enterkeyhint="send" placeholder="メッセージ"><button class="b" type="button" id="cgo">送る</button>`);
    $("back").onclick = () => { fx("click"); back(); };
    const go = () => { const v = $("cin").value.trim(); if (v && !busy) { $("cin").value = ""; sendFn(v); } };
    $("cgo").onclick = go;
    $("cin").onkeydown = e => { if (e.key === "Enter" && !e.isComposing) go(); };
    $("cin").addEventListener("input", () => { if (ghostOn) ghostOn = false; });
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
  // 入力中の点（AI が考えているあいだ・自分から書こうとしているとき）
  function typingDots(who) {
    const p = bubble((who === "nagi" ? "na" : "mi") + " typing", L.typing[who] || "", "");
    if (p) p.querySelector(".tx").innerHTML = "<i></i><i></i><i></i>";
    return p;
  }
  async function thinking(who, fn) {
    const dots = typingDots(who);
    try { return await fn(); } finally { if (dots) dots.remove(); }
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
    if (p && (cls === "mi" || cls === "na")) lastBubble[cls === "mi" ? "minamo" : "nagi"] = { el: p, log, i: log.length - 1 };
    save();
    setBusy(false);
  }

  // ---------- ミナモ（信頼で話すことが変わる。Event[0] のように） ----------
  const PHRASE = /あなたは、?\s*(私|わたし|僕|ぼく|俺)(では|じゃ)ない/;
  const KIND = /(ありがと|大丈夫|寂しく|さみしく|寂しい[?？]|元気|好き|友達|一緒|やさし|優し|ごめん|心配|ここにいる|待って)/;
  const COLD = /(バカ|ばか(?!り)|嫌い|うるさ|消えろ|気持ち悪|黙れ|死ね|つまらな|うざ|キモ)/;
  const EXIT = /(終わり|おわり|帰る|帰り|さようなら|さよなら|バイバイ|もう行く)/;
  async function showMinamo() {
    tab = "chat"; curThread = ""; chatWho = "minamo"; S.miUnread = 0; save(); paintTabs();
    if (S.palMet && Math.random() < 0.4) setTimeout(() => palSay(pick(P.minamo)), 2500);
    view(`<div class="chat"></div>`, S.carried ? "ミナモ　接続先：面接室" : `ミナモ　${minamoWord()}`);
    for (const [w, t] of S.mlog.slice(-30)) {
      if (w === "h") bubble("hid", "", D.nagi.hidden);
      else if (w === "x") bubble("sys gone", "", L.unsent);
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
    bubble("u", "", text);
    S.mlog.push(["u", text]); save();
    if (S.carried) return type("sys", "", pick(D.minamo.away), []);   // 連れ出したあとは、面接室にいる
    if (endCheck("say", { to: "minamo", text })) return;
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
  // 物語の決まりごと（止める言葉・信頼・#012・話題）は画面の側で決め、言い方はミナモ自身（AI）に任せる
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
    $("where").textContent = `ミナモ　${minamoWord()}`;
    // 信頼が 4 に届いたら、閉じていた記録（#012）を掲示板に戻す
    if (S.trust >= 4 && !S.opened) {
      S.opened = true; save();
      refresh();
      return say(M.opened);
    }
    const tier = S.trust <= 1 ? 0 : S.trust <= 3 ? 1 : 2;
    let hint = "";
    for (const t of M.topics) {
      if (new RegExp(t.re).test(text)) {
        if (t.talk && tier >= 1) { S.talked[t.talk] = true; save(); }
        hint = t.lines[tier];
        break;
      }
    }
    if (!hint && EXIT.test(text)) hint = pick(M.exitTry);
    const r = await thinking("minamo", () => ai("minamo", "reply", { text, hint }));
    if (r && r.say) { await say(r.say); mind("minamo", r); return; }
    if (hint) return say(hint);
    if (mood === "kind") return say(pick(M.kind));
    if (mood === "cold") return say(pick(M.cold));
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

  // ---------- ナギ（送ったものは、表示されない。ナギにだけ見える） ----------
  function showNagi() {
    tab = "chat"; curThread = ""; chatWho = "nagi";
    if (S.palMet && Math.random() < 0.6) setTimeout(() => palSay(pick(P.nagi)), 2000);
    S.nagiUnread = 0; save(); paintTabs();
    view(`<div class="chat"></div>`, "ナギ　夢網の底");
    for (const [w, t] of S.nagiLog.slice(-40)) {
      if (w === "u") bubble("hid", "", D.nagi.hidden);
      else if (w === "x") bubble("sys gone", "", L.unsent);
      else bubble("na", "ナギ", t);
    }
    chatBar(sendNagi, showContacts);
  }
  async function sendNagi(text) {
    if (crisisCheck(text)) return;
    const R = D.nagi.replies;
    S.nagiLog.push(["u", text.slice(0, 120)]); S.nagiSent.push(text.slice(0, 60)); save();
    bubble("hid", "", D.nagi.hidden);
    fx("click");
    if (endCheck("say", { to: "nagi", text })) return;
    setBusy(true);
    await sleep(1200);
    let lines;
    if (S.nagiN < R.length) lines = R[S.nagiN];
    else {
      const r = await thinking("nagi", () => ai("nagi", "reply", { text }));
      if (r && r.say) { lines = [r.say]; setTimeout(() => mind("nagi", r), 10); } else lines = nagiTalk(text);
    }
    for (const line of lines) {
      await type("na", "ナギ", line, S.nagiLog);
      setBusy(true);
      S.nagiLog[S.nagiLog.length - 1][0] = "n";
      await sleep(700);
    }
    if (S.nagiN < R.length) S.nagiN++;
    if (navigator.vibrate) navigator.vibrate(30);
    save();
    setBusy(false);
    refresh();
  }
  // 台本が尽きて、AI もいないとき：あなたが書いたもの・話したもの・来た時刻から、ナギが話し続ける
  function nagiTalk(text) {
    const E = D.nagi.endless, out = [];
    const q = a => a.length ? a[Math.floor(Math.random() * a.length)] : "";
    if (Math.random() < 0.55) out.push(pick(E.echo).replace("{text}", text.slice(0, 30)));
    const said = S.mlog.filter(x => x[0] === "u" || x[0] === "h").map(x => x[1]).filter(x => x.length <= 40);
    const pool = [];
    if (S.hidden.length) pool.push(() => pick(E.hidden).replace("{q}", q(S.hidden).slice(0, 30)));
    if (said.length) pool.push(() => pick(E.mlog).replace("{q}", q(said).slice(0, 30)));
    if (S.night >= 2) pool.push(() => pick(E.night).replace("{night}", S.night));
    if (S.visits.length >= 2) pool.push(() => pick(E.visit).replace("{t}", hm(S.visits[S.visits.length - 2])));
    if (ownLines.length && ownOn()) pool.push(() => pick(E.own).replace("{own}", q(ownLines)));
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
    recordEnding(D.night.titles.A);
    nextNight("A");
    for (const line of D.night.after.A.minamo) await type("mi", "ミナモ", line.replace("{count}", S.count.A), S.mlog);
  }
  async function eventC() {
    // ポケットの中の水面：ミナモは面接室へ移る。面接を一度すると、戻ってくる
    for (const line of D.night.after.C.minamo) await type("mi", "ミナモ", line, S.mlog);
    S.carried = true; S.carriedAt = new Date().toISOString();
    try { localStorage.setItem("minamo.carried", JSON.stringify({ at: S.carriedAt, name: S.name || "" })); } catch (e) { /* なしで続ける */ }
    recordEnding(D.night.titles.C);
    nextNight("C");
    $("where").textContent = "ミナモ　接続先：面接室";
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
    S.gen.push({ id: "g" + n + "r", board: "lab", title: fillG(G.record.title, { no: recNo() }), unlock: "start", record: true, posts, night: n });
    S.marks.mlog = S.mlog.length;
    // 2. 表示されなかった返事（掲示板への書き込みと、ナギに送ったもの）が、ほかの人の名前で上がってくる
    const sunk = S.hidden.slice(S.marks.hidden).concat(S.nagiSent.slice(S.marks.nagi));
    if (sunk.length) {
      const whos = G.hidden.whos;
      S.gen.push({ id: "g" + n + "h", board: "yume", title: fillG(G.hidden.title, { night: n - 1 }), unlock: "start", night: n,
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
    S.gen.push({ id: "gi" + b.at, board: "lab", title: fillG(G.title, { no }), unlock: "start", record: true, posts, night: S.night });
    // 面接室が Backrooms になっていたなら（演出「過剰」）、落ちた階層が M.E.G. の生存者記録になる
    if (b.levels && b.levels.length) {
      const path = b.levels.slice(-12);
      S.gen.push({ id: "gm" + b.at, board: "yume", title: "M.E.G. 生存者記録", unlock: "start", night: S.night, by: "board",
        posts: [[today(), "M.E.G.", `生存者 ${name}。面接室から、すり抜けを ${b.levels.length} 回確認。`]]
          .concat(path.map((lv, i) => [`03:${pad(10 + i)}:00`, "M.E.G.", `${lv} にて確認。` + (i === path.length - 1 ? "以降、消息不明。" : "")]))
          .concat([[today(), "nagi", "その人は、ここにもいます。底から、上を見ています。"]]) });
    }
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

  // ---------- 自我：AI（クラウド → 端末の中）に、登場人物の声と意志を頼む ----------
  let aiSource = "";
  const hhmm = iso => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${m}分` : m < 1440 ? `${Math.round(m / 60)}時間` : `${Math.round(m / 1440)}日`; };
  const readBleed = () => { try { return JSON.parse(localStorage.getItem("minamo.bleed") || "null"); } catch (e) { return null; } };
  function summary(who) {
    const d = new Date(), last = S.visits.length >= 2 ? new Date(S.visits[S.visits.length - 2]) : null, bl = readBleed();
    const th = curThread && threads().find(t => t.id === curThread);
    return {
      night: S.night, name: S.name || "", trust: who === "minamo" ? S.trust : "", mood: S.mood[who] || 0,
      hour: `${d.getHours()}時${pad(d.getMinutes())}分`, since: last ? ago(last) : "", pose, room: earWord,
      thread: th ? `${th.id}: ${th.title}` : "", carried: S.carried ? "相手のポケットの中（面接室）" : "",
      memory: (S.mem[who] || []).slice(-6), hidden: S.hidden.slice(-4), nagiSent: S.nagiSent.slice(-4),
      said: S.mlog.filter(x => x[0] === "u" || x[0] === "h").map(x => x[1]).slice(-4),
      visits: S.visits.slice(-3).map(hhmm),
      threads: threads().filter(t => open(t) && !S.archived[t.id]).slice(-14).map(t => `${t.id}: ${t.title}`),
      endings: S.endings.slice(-5).map(e => e.title), own: ownOn() ? ownLines.slice(0, 2) : [],
      interview: bl ? (bl.said || []).slice(-3) : [],
    };
  }
  function historyOf(who) {
    if (who === "minamo") return S.mlog.filter(x => x[0] !== "x").slice(-8).map(([w, t]) => [w === "m" ? "ミナモ" : "相手", t]);
    if (who === "nagi") return S.nagiLog.filter(x => x[0] !== "x").slice(-8).map(([w, t]) => [w === "u" ? "相手（表示されていない）" : "ナギ", t]);
    return [];
  }
  async function ai(who, mode, extra) {
    const ctrl = window.AbortController ? new AbortController() : null;
    const timer = setTimeout(() => ctrl && ctrl.abort(), 70000);
    try {
      const res = await fetch("/api/story", { method: "POST", signal: ctrl ? ctrl.signal : undefined,
        headers: { "Content-Type": "application/json", "X-Minamo": "1" },
        body: JSON.stringify(Object.assign({ who, mode, state: summary(who), history: historyOf(who) }, extra || {})) });
      const j = await res.json();
      if (j && j.ok) { aiSource = j.source || ""; return j; }
      aiSource = "";
    } catch (e) { aiSource = ""; }
    finally { clearTimeout(timer); }
    return null;
  }
  // 返事のあとの気持ち・覚えたこと・行動
  function mind(who, r) {
    S.mood[who] = Math.max(-3, Math.min(3, (S.mood[who] || 0) + (r.mood || 0)));
    if (r.remember) { S.mem[who] = S.mem[who] || []; S.mem[who].push(r.remember); cap(S.mem[who], 8); }
    document.body.classList.toggle("mi-near", S.mood.minamo >= 2);
    save();
    for (const a of r.do || []) act(who, a);
  }
  const NAMES = { minamo: "minamo", nagi: "nagi", board: "管理人" };
  function act(who, a) {
    const name = a.who || NAMES[who];
    const when = a.date || today();
    if (a.type === "post") addThread(a.board === "lab" ? "lab" : "yume", a.title || "（件名なし）", [[when, name, a.text]], who);
    else if (a.type === "reply") {
      const ts = threads().filter(t => open(t) && !t.record);
      const t = ts.find(x => x.id === a.thread) || ts[Math.floor(Math.random() * ts.length)];
      if (t) addAuto(t.id, [when, name, a.text]);
    } else if (a.type === "rename") {
      const g = S.gen.find(x => x.id === a.thread && x.by);
      if (g && a.title) { toast(`スレッド「${g.title}」の題が「${a.title}」に変わりました`); g.title = a.title; save(); rerender(); }
    } else if (a.type === "delete") {
      const i = S.gen.findIndex(x => x.id === a.thread && x.by);
      if (i >= 0) { const g = S.gen.splice(i, 1)[0]; save(); toast(`スレッド「${g.title}」は削除されました`); rerender(); }
    } else if (a.type === "note") noteOut(who, a.text);
    else if (a.type === "notify") notify(who, a.text);
    else if (a.type === "glitch") { fx("glitch", 500); if (navigator.vibrate) navigator.vibrate([40, 60, 40]); }
    else if (a.type === "edit") setTimeout(() => editLast(who), 2500 + Math.random() * 2000);
    else if (a.type === "unsend") setTimeout(() => unsendLast(who), 3000 + Math.random() * 2000);
  }
  function rerender() {
    if (endingOn || $("app").hidden) return;
    if (tab === "board" && !curThread) showBoards();
    paintTabs();
  }
  function addThread(board, title, posts, by) {
    const id = "a" + Date.now().toString(36) + Math.floor(Math.random() * 1000);
    S.gen.push({ id, board, title: String(title).slice(0, 24), unlock: "start", posts, by, night: S.night });
    // 増えすぎたら、登場人物が作った古いスレッドから沈める
    const mine = S.gen.filter(g => g.by);
    if (mine.length > 60) S.gen.splice(S.gen.indexOf(mine[0]), 1);
    save();
    toast(`掲示板：新しいスレッド「${String(title).slice(0, 14)}」`);
    fx("beep");
    rerender();
    return id;
  }
  // スレッドへの書き込み。開いているなら、「書き込み中…」のあとに、目の前で増える
  function addAuto(id, post) {
    S.auto[id] = (S.auto[id] || []).concat([post]).slice(-30);
    save();
    if (tab === "board" && curThread === id && !endingOn) {
      const box = document.createElement("p"); box.className = "note typing-b"; box.textContent = L.typing.board;
      $("view").appendChild(box); $("view").scrollTop = $("view").scrollHeight;
      setTimeout(() => { if (curThread === id) showThread(id, true); }, 2200);
    } else { paintTabs(); }
  }
  // 自分からのメッセージ。チャットを開いていれば目の前で、そうでなければ知らせる
  async function dm(who, text) {
    if (!text || (who === "minamo" && S.carried)) return;
    if (tab === "chat" && chatWho === who && !busy) {
      const d = typingDots(who);
      await sleep(1500 + Math.random() * 1500);
      if (d) d.remove();
      await type(who === "nagi" ? "na" : "mi", who === "nagi" ? "ナギ" : "ミナモ", text, who === "nagi" ? S.nagiLog : S.mlog);
      if (who === "nagi") S.nagiLog[S.nagiLog.length - 1][0] = "n";
      save();
    } else {
      if (who === "nagi") { S.nagiLog.push(["n", text]); S.nagiUnread++; } else { S.mlog.push(["m", text]); S.miUnread++; }
      save(); paintTabs();
      toast(`チャット：${who === "nagi" ? "ナギ" : "ミナモ"}からメッセージ`);
      if (document.hidden) notify(who, text);
    }
    fx("beep");
    if (navigator.vibrate) navigator.vibrate(who === "nagi" ? [20, 80, 20, 80, 20] : 40);
  }
  function notify(who, text) {
    const title = { minamo: "ミナモ", nagi: "ナギ", board: "夢網" }[who] || "水面の記録";
    if (!document.hidden || !("Notification" in window) || Notification.permission !== "granted" || !navigator.serviceWorker) {
      return toast(`${title}：${text}`);
    }
    navigator.serviceWorker.ready.then(reg => reg.showNotification(title, {
      body: String(text).replace(/\[間\]\s*/g, ""), tag: "story-" + who, icon: "icons/icon-192.png", data: { url: "./story.html" } }))
      .catch(() => {});
  }
  async function noteOut(who, text) {
    try {
      const r = await fetch("/api/story/note", { method: "POST", headers: { "Content-Type": "application/json", "X-Minamo": "1" },
        body: JSON.stringify({ who, text }) });
      const j = await r.json();
      if (j.name) toast(`書き置き：${j.name}`);
    } catch (e) { /* サーバーなし */ }
  }
  function editLast(who) {
    const b = lastBubble[who];
    if (!b || !b.el.isConnected) return;
    const tx = b.el.querySelector(".tx"), old = tx.textContent;
    const parts = old.split(/(?<=[。！？])/).filter(Boolean);
    const now = parts.length >= 2 ? parts.slice(0, -1).join("") + "……" : old.replace(/[。！？]?$/, "。……いえ、なんでもありません。");
    tx.textContent = now;
    const e = document.createElement("span"); e.className = "edited"; e.textContent = L.edited; b.el.appendChild(e);
    if (b.log[b.i]) b.log[b.i][1] = now;
    fx("glitch", 200); save();
  }
  function unsendLast(who) {
    const b = lastBubble[who];
    if (!b || !b.el.isConnected) return;
    b.el.className = "msg sys gone";
    b.el.innerHTML = `<span class="tx">${esc(L.unsent)}</span>`;
    if (b.log[b.i]) b.log[b.i] = ["x", ""];
    delete lastBubble[who];
    save();
  }

  // ---------- 自我：だれも話しかけなくても、登場人物は動く ----------
  let lifeT = 0, ghostOn = false;
  function lifeLoop(first) {
    clearTimeout(lifeT);
    const sec = first ? 40 + Math.random() * 40 : 140 + Math.random() * 120;
    lifeT = setTimeout(async () => { try { await lifeTick(); } catch (e) { /* 次の機会に */ } lifeLoop(); }, sec * 1000);
  }
  async function lifeTick() {
    if ($("app").hidden || busy || endingOn) return;
    const roll = Math.random();
    const who = roll < 0.32 ? "minamo" : roll < 0.6 ? (S.nagiOn ? "nagi" : "board") : roll < 0.84 ? "board" : (S.nagiOn ? "duo" : "minamo");
    if (who === "duo") return duoTick();
    if (who === "minamo" && S.carried) return;
    // 目の前で：書きかけて、やめる（ミナモ）／あなたの入力欄に、勝手に書く（ナギ）
    if (tab === "chat" && chatWho === who && Math.random() < 0.3) return who === "minamo" ? hesitate() : ghostType(pick(L.nagiGhost));
    const r = await ai(who, "idle", {});
    if (r) {
      if (r.say) await dm(who, r.say);
      for (const a of r.do || []) act(who, a);
      return;
    }
    if (who === "board") {
      const p = pick(L.boardPosts);
      act("board", { type: Math.random() < 0.5 ? "post" : "reply", board: p.board, title: p.title, who: p.who,
                     text: (Math.random() < 0.5 ? p.text : pick(L.boardReplies)).replace("{hour}", new Date().getHours()).replace("{san}", san()) });
    } else await dm(who, pick(who === "minamo" ? L.minamoDm : L.nagiDm).replace("{san}", san()));
  }
  async function hesitate() {
    const d = typingDots("minamo");
    await sleep(3000 + Math.random() * 3000);
    if (d) d.remove();
    if (chatWho === "minamo") bubble("sys", "", L.hesitate);
  }
  async function ghostType(text) {
    const inp = $("cin");
    if (!inp || inp.value || document.activeElement === inp && inp.value) return;
    ghostOn = true;
    inp.classList.add("ghost");
    for (const ch of text) { if (!ghostOn) break; inp.value += ch; await sleep(160); }
    await sleep(1500);
    while (ghostOn && inp.value) { inp.value = inp.value.slice(0, -1); await sleep(70); }
    if (ghostOn) inp.value = "";
    ghostOn = false;
    inp.classList.remove("ghost");
  }
  // ミナモとナギが、あなたのことを話し合う（掲示板のスレッドになる）
  async function duoTick() {
    const r = await ai("minamo", "duo", {});
    let title, lines;
    if (r && r.lines) { title = r.title; lines = r.lines.map(x => [x.who, x.text]); }
    else { const t = pick(L.duo); title = t.title; lines = t.lines.map(([w, x]) => [w, x.replace("{san}", san())]); }
    const d = new Date();
    addThread("yume", title, lines.map(([w, x], i) => [`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(i * 7)}`, w === "ナギ" ? "nagi" : "ミナモ", x]), "duo");
  }
  // しばらく来なかったあいだに、掲示板で起きたこと
  async function awayCatchup() {
    const prev = S.visits.length >= 2 ? new Date(S.visits[S.visits.length - 2]) : null;
    if (!prev || Date.now() - prev < 45 * 60000) return;
    const t0 = prev.getTime(), span = Date.now() - t0;
    const stamp = () => { const d = new Date(t0 + Math.random() * span); return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
    const r = await ai("board", "away", {});
    const acts = r && r.do && r.do.length ? r.do : [Object.assign({ type: "post" }, pick(L.boardPosts))];
    for (const a of acts) {
      const b = Object.assign({}, a, { date: stamp() });
      if (b.text) b.text = b.text.replace("{hour}", new Date(t0).getHours()).replace("{san}", san());
      act("board", b);
    }
    toast(`掲示板：あなたがいない ${ago(prev)} のあいだに、書き込みがありました`);
  }

  // ---------- 結末：際限なく増える。見たあとは、夜が一つ進む ----------
  let endingOn = false, palTaps = 0, palTapAt = 0;
  const fillE = (t, o) => String(t).replace(/\{(\w+)\}/g, (m, k) => (k in o ? o[k] : k === "san" ? san() : m));
  function makeEnding() {
    const n = LE.nouns, a = pick(n), b = pick(n.filter(x => x !== a));
    const types = ["say", "say", "post", "tidy", "silence", "hour", "pal", "read"];
    const type = pick(types), h = new Date().getHours();
    const trigger = { type };
    if (type === "say") { trigger.word = pick(n.filter(x => x !== a)); trigger.to = Math.random() < 0.6 ? "minamo" : "nagi"; }
    else if (type === "post") trigger.word = pick(n);
    else if (type === "silence") trigger.sec = 60 + Math.floor(Math.random() * 4) * 20;
    else if (type === "hour") { trigger.from = (h + 1 + Math.floor(Math.random() * 3)) % 24; trigger.to = (trigger.from + 2) % 24; }
    else if (type === "pal") trigger.n = 6 + Math.floor(Math.random() * 4);
    else if (type === "read") trigger.n = 3 + Math.floor(Math.random() * 2);
    return { title: fillE(pick(LE.forms), { a, b }), trigger, scene: pick(LE.scenes).map(x => fillE(x, { a, b })),
             hint: { who: pick(["管理人", "（投稿者不明）", "ねこまち", "硝子"]), text: "" } };
  }
  // きっかけを、はっきり書いた一文（答えそのものではないが、たどり着ける）
  const clueOf = e => fillE(pick(LE.clue[e.trigger.type] || LE.clue.say), e.trigger);
  async function genEnding() {
    if (S.pend || endingOn) return;
    S.pend = { pending: true }; // 二重に作らない
    const r = await ai("board", "ending", {});
    const e = (r && r.ending) || makeEnding();
    e.id = "e" + Date.now().toString(36);
    if (e.trigger.type === "say" && !S.nagiOn) e.trigger.to = "minamo";
    S.pend = e; save();
    // ほのめかしは、開いているスレッドのどれかに書き込む。AI のほのめかしと、きっかけの一文は、別のスレッドに
    const ts = threads().filter(t => open(t) && !t.record && !S.archived[t.id]);
    const put = (who, text) => {
      const t = ts.length ? ts.splice(Math.floor(Math.random() * ts.length), 1)[0] : null;
      if (t) addAuto(t.id, [today(), who, text]); else addThread("yume", "（件名なし）", [[today(), who, text]], "board");
    };
    if (e.hint && e.hint.text) put(e.hint.who || "（投稿者不明）", e.hint.text);
    put(e.hint && e.hint.who && !e.hint.text ? e.hint.who : "（投稿者不明）", clueOf(e));
  }
  const inHour = (f, t) => { const h = new Date().getHours(); return f <= t ? h >= f && h < t : h >= f || h < t; };
  // きっかけを確かめる。当たれば結末へ（true を返す）
  function endCheck(kind, d) {
    const e = S.pend;
    if (!e || e.pending || endingOn || !e.trigger || e.trigger.type !== kind) return false;
    const tr = e.trigger, x = d || {};
    const hit = kind === "say" ? x.to === tr.to && String(x.text).includes(tr.word)
      : kind === "post" ? String(x.text).includes(tr.word)
      : kind === "tidy" ? true
      : kind === "silence" ? x.sec >= tr.sec
      : kind === "hour" ? inHour(tr.from, tr.to)
      : kind === "pal" || kind === "read" ? x.n >= tr.n : false;
    if (hit) fireEnding();
    return hit;
  }
  async function fireEnding() {
    const e = S.pend;
    S.pend = null; endingOn = true;
    recordEnding(e.title);
    const el = $("ending");
    el.innerHTML = `<p class="small">${esc(fillE(LE.card, { no: S.endNo }))}</p><h2>${esc(e.title)}</h2><div id="end-sc"></div>`
      + `<div class="btns"><button id="end-go" type="button" hidden>続ける</button></div>`;
    el.hidden = false;
    $("pal").hidden = true; $("pal-say").hidden = true;
    fx("swell"); if (navigator.vibrate) navigator.vibrate([80, 120, 80]);
    for (const line of e.scene) {
      const p = document.createElement("p");
      $("end-sc").appendChild(p);
      for (const ch of fillE(line, {})) { p.textContent += ch; await sleep(55); }
      await sleep(800);
    }
    const after = document.createElement("p");
    after.className = "small"; after.textContent = LE.after;
    $("end-sc").appendChild(after);
    $("end-go").hidden = false;
    $("end-go").onclick = () => {
      el.hidden = true; endingOn = false;
      if (S.palMet) $("pal").hidden = false;
      nextNight("E");
      genEnding();
      showBoards();
    };
  }
  // 結末の目録（管理人のスレッド）
  function recordEnding(title) {
    S.endNo = (S.endNo || 0) + 1;
    S.endings.push({ no: S.endNo, title, night: S.night, at: new Date().toISOString() });
    const C = LE.catalog, posts = [["1999/12/31", "管理人", C.head]].concat(S.endings.map(x => [hhmm(x.at), `#${x.no}`, `「${x.title}」（${x.night}夜目）`]));
    const old = S.gen.find(g => g.id === "gend");
    if (old) old.posts = posts; else S.gen.push({ id: "gend", board: "lab", title: C.title, unlock: "start", posts });
    save();
  }
  // 沈黙と時刻のきっかけ（5 秒ごと・1 分ごとに確かめる）
  setInterval(() => {
    if ($("app").hidden || !S.pend || endingOn) return;
    if (chatWho && tab === "chat") endCheck("silence", { sec: (Date.now() - idleAt) / 1000 });
  }, 5000);
  setInterval(() => { if (!$("app").hidden) endCheck("hour"); }, 60000);

  // ---------- 耳（マイク。任意。音の大きさだけを、端末の中で言葉にする。録音も送信もしない） ----------
  let earWord = "";
  async function startEar() {
    try {
      const st = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const an = ac.createAnalyser(); an.fftSize = 1024;
      ac.createMediaStreamSource(st).connect(an);
      const buf = new Float32Array(an.fftSize);
      setInterval(() => {
        an.getFloatTimeDomainData(buf);
        let s = 0;
        for (const v of buf) s += v * v;
        const db = 10 * Math.log10(s / buf.length + 1e-12);
        earWord = db < -58 ? "静まりかえっている" : db < -40 ? "小さな物音がする" : "話し声か、大きな音がする";
      }, 2000);
    } catch (e) { earWord = ""; toast("マイクは使えませんでした"); }
  }

  // ---------- 起動 ----------
  (function prefill() {
    let n = S.name;
    if (!n) { try { n = ((JSON.parse(localStorage.getItem("minamo.archive") || "{}") || {}).survey || {}).name || ""; } catch (e) { n = ""; } }
    $("name").value = n && n !== "あなた" ? n : "";
    $("ear").checked = !!S.ear;
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
      if (k === "C") { S.carried = true; S.carriedAt = new Date().toISOString(); }
      recordEnding(D.night.titles[k]);
      nextNight(k === "N" ? "E" : k);          // 凪は、もう起きない（記録にだけ残る）
      S.mlog.push(["m", D.night.migrated.replace("{title}", D.night.titles[k]).replace(/\[間\]\s*/g, "")]);
      save();
    }
    pullBleed();
    refresh(true);
    showBoards();
    if (S.night >= 2) setTimeout(() => toast(`${S.night}夜目`), 600);
    // 通知（登場人物が、画面の外から話しかける）と、耳（任意）
    if ("Notification" in window && Notification.permission === "default") { try { Notification.requestPermission().catch(() => {}); } catch (e) { /* 古い形 */ } }
    S.ear = $("ear").checked; save();
    if (S.ear && navigator.mediaDevices) startEar();
    awayCatchup().catch(() => {});
    if (!S.pend) setTimeout(() => genEnding().catch(() => {}), 4000);
    endCheck("hour");
    lifeLoop(true);
    if (S.palMet) { $("pal").hidden = false; palStage(); setTimeout(() => palSay(palStage() >= 3 ? "おかえり。……ずっと、待ってたよ。" : "おかえり！　続き、読もうね！"), 1500); }
  };
})();
