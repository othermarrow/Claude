/* ミナモ：記録庫（物語モード）。面接アプリ（index.html）とは別のページで、保存も別（minamo.archive）。
   メール・記録庫・通信・アンケート・言語連想検査・面接から、1996〜1999 年の研究室で起きたことを拾い集める。
   中身は archive-data.js（window.STORY）。音と起動画面は fx.js（window.FX）。
   面接の自由な会話だけサーバー（/api/ask、1996 年版の端末内モデル）を使う。サーバーがなくても物語は進む。 */
(function () {
  "use strict";

  const D = window.STORY;
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const lastPick = new Map();
  const pick = a => {           // 同じ列から、直前と同じものは選ばない
    const c = a.length > 1 ? a.filter(x => x !== lastPick.get(a)) : a;
    const x = c[Math.floor(Math.random() * c.length)];
    lastPick.set(a, x);
    return x;
  };
  const pad = n => String(n).padStart(2, "0");
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const KEY = "minamo.archive";
  const CRISIS_DEFAULT = ["死にたい", "しにたい", "消えたい", "自殺", "自死", "首を吊", "リスカ", "リストカット", "飛び降り",
                          "ODし", "オーバードーズ", "殺してほしい", "生きていたくない"];

  // ---------- 保存 ----------
  const fresh = () => ({ read: {}, replied: {}, recRead: {}, recViews: {}, boards: {}, inbox: [], trust: 1, turns: 0,
                         iv: [], survey: {}, surveyDone: false, test: null, code: false, open009: false, phrase: 0,
                         ending: null, visits: 0, numbers: [], carryAsked: false, user: "guest" });
  let S = load();
  function load() {
    try { return Object.assign(fresh(), JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) { return fresh(); }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 保存できなくても続ける */ } }

  // ---------- 文字の差し込み ----------
  function today() {
    const d = new Date();
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function fill(t) {
    const slow = S.test && S.test.slow[0];
    return String(t).replace(/\{(\w+)\}/g, (m, k) => ({
      today: today(), name: S.survey.name || "あなた", fear: S.survey.fear || "", people: S.survey.people || "",
      slowWord: slow ? slow[0] : "水", slowMs: slow ? slow[2] : "1200",
    }[k] ?? ""));
  }

  // ---------- 条件 ----------
  function ok(c) {
    if (Array.isArray(c)) return c.every(ok);
    if (c === "start") return true;
    if (c === "survey") return S.surveyDone;
    if (c === "test") return !!S.test;
    const [k, v] = c.split(":");
    return !!({ read: S.read, reply: S.replied, rec: S.recRead, board: S.boards }[k] || {})[v];
  }

  // ---------- 音・知らせ ----------
  let fxOn = false;
  function fxStart() {
    let st = { level: 2, sound: true };
    try { st = Object.assign(st, JSON.parse(localStorage.getItem("minamo.fx") || "{}")); } catch (e) { /* 既定のまま */ }
    FX.setVersion("1996");
    FX.configure({ level: Math.min(2, st.level), sound: st.sound });
    FX.audioStart();
    fxOn = true;
  }
  function toast(t) {
    const el = $("toast");
    el.textContent = t; el.classList.add("on");
    clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("on"), 2600);
  }

  // ---------- メールの配達 ----------
  function deliver() {
    let n = 0;
    for (const m of D.mails) {
      if (!S.inbox.some(x => x.id === m.id) && ok(m.unlock)) {
        S.inbox.push({ id: m.id, at: Date.now() });
        n++;
      }
    }
    if (n) {
      save(); paintIcons();
      if (fxOn) FX.beep();
      toast(`メールが ${n} 通届きました`);
      const ic = document.querySelector('.icon[data-app="mail"]');
      if (ic) { ic.classList.remove("new"); void ic.offsetWidth; ic.classList.add("new"); }
    }
    collectNumbers();
  }
  function collectNumbers() {
    const add = n => { if (!S.numbers.includes(n)) S.numbers.push(n); };
    for (const x of S.inbox) {
      const m = D.mails.find(y => y.id === x.id);
      if (m && S.read[m.id]) (m.body.join("\n").match(/\d{4}-\d{4}-\d{4}/g) || []).forEach(add);
    }
    if (S.read.m5) add("4013");
    save();
  }

  // ---------- デスクトップ ----------
  const APPS = [
    { id: "talk", g: "面", t: "面接", show: () => true },
    { id: "mail", g: "信", t: "メール", show: () => true },
    { id: "records", g: "録", t: "記録庫", show: () => true },
    { id: "dial", g: "通", t: "通信", show: () => true },
    { id: "survey", g: "問", t: "アンケート", show: () => !!S.read.m1 },
    { id: "test", g: "検", t: "言語連想検査", show: () => !!S.read.m1 },
    { id: "trash", g: "屑", t: "ごみ箱", show: () => true },
  ];
  function paintIcons() {
    const box = $("icons");
    box.textContent = "";
    for (const a of APPS) {
      if (!a.show()) continue;
      const b = document.createElement("button");
      b.type = "button"; b.className = "icon"; b.dataset.app = a.id;
      b.innerHTML = `<span class="g">${a.g}</span><span class="t">${a.t}</span>`;
      if (a.id === "mail") {
        const n = S.inbox.filter(x => !S.read[x.id]).length;
        if (n) b.insertAdjacentHTML("beforeend", `<span class="badge">${n}</span>`);
      }
      b.onclick = () => { if (fxOn) FX.click(); open(a.id); };
      box.appendChild(b);
    }
    $("user").textContent = "user: " + S.user;
  }
  function clock() {
    const d = new Date();
    // 年だけが 1999 年のまま止まっている
    $("clock").textContent = `1999/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // ---------- 窓 ----------
  let current = "";
  function win(title, html) {
    $("wtitle").textContent = title;
    $("wbody").innerHTML = html;
    $("wbody").style.padding = "";
    $("wbody").scrollTop = 0;
    $("win").hidden = false;
  }
  function closeWin() { $("win").hidden = true; current = ""; paintIcons(); }
  $("wclose").onclick = () => { if (fxOn) FX.click(); closeWin(); };
  function open(id) {
    current = id;
    ({ talk: openTalk, mail: openMail, records: openRecords, dial: openDial, survey: openSurvey, test: openTest,
       trash: openTrash })[id]();
  }

  // ---------- メール ----------
  function mailOf(x) {
    if (x.reply) return Object.assign({ id: x.id, addr: "", date: x.date }, D.replies[x.reply]);
    return D.mails.find(m => m.id === x.id);
  }
  function openMail() {
    const items = S.inbox.slice().reverse();
    win("メール ─ soma-guest", items.length ? `<ul class="list">${items.map(x => {
      const m = mailOf(x);
      return `<li data-id="${x.id}" class="${S.read[x.id] ? "" : "unread"}"><span class="d">${esc(fill(m.date))}</span>`
           + `<span>${esc(m.from)}：${esc(m.subject)}</span></li>`;
    }).join("")}</ul>` : "<p>メールはありません。</p>");
    $("wbody").querySelectorAll("li").forEach(li => { li.onclick = () => readMail(li.dataset.id); });
  }
  function readMail(id) {
    const x = S.inbox.find(y => y.id === id);
    const m = mailOf(x);
    S.read[id] = true; save();
    const canReply = !x.reply && !S.replied[id];
    win(m.subject, `<div class="mail"><h3>${esc(m.subject)}</h3>
      <div class="hd">差出人：${esc(m.from)}${m.addr ? " &lt;" + esc(m.addr) + "&gt;" : ""}<br>日付：${esc(fill(m.date || x.date || ""))}</div>
      ${m.body.map(p => `<p>${esc(fill(p)) || "&nbsp;"}</p>`).join("")}
      <div class="row"><button class="btn" id="back" type="button">一覧へ</button>
      ${canReply ? '<button class="btn" id="reply" type="button">返信</button>' : ""}</div>
      <div class="sent" id="sent">${S.replied[id] ? "返信済み" : ""}</div></div>`);
    $("back").onclick = openMail;
    if (canReply) $("reply").onclick = () => reply(id, m);
    deliver();
  }
  // 返信は書ける。でも、何を書いたかは見えない
  async function reply(id, m) {
    $("reply").disabled = true;
    const s = $("sent");
    s.textContent = "返信を書いています";
    for (let i = 0; i < 3; i++) { await sleep(500); s.textContent += "．"; if (fxOn) FX.click(); }
    s.textContent = "返信しました。";
    S.replied[id] = true; save();
    if (m.reply) {
      await sleep(2200);
      const r = D.replies[m.reply];
      S.inbox.push({ id: id + "-r", reply: m.reply, date: today(), at: Date.now() });
      save(); paintIcons();
      if (fxOn) FX.beep();
      toast(`${r.from} からメールが届きました`);
    }
    deliver();
  }

  // ---------- 記録庫 ----------
  function recVisible(r) { return !(r.lock && r.lock.startsWith("mail:") && !S.read[r.lock.slice(5)]); }
  function recOpen(r) {
    if (r.lock === "code") return S.code;
    if (r.lock === "trust") return S.open009;
    return true;
  }
  function has013() { return S.surveyDone || !!S.test || S.turns >= 3; }
  function openRecords() {
    const rows = D.records.map(r => {
      if (!recVisible(r)) return `<li class="locked"><span class="d">#${r.id}</span><span>▒▒▒▒▒▒</span></li>`;
      const lock = recOpen(r) ? "" : (r.lock === "code" ? "［非公開］" : "［ミナモが閉じています］");
      return `<li data-id="${r.id}" class="${S.recRead[r.id] ? "" : "unread"}"><span class="d">#${r.id}</span>`
           + `<span>${esc(r.title)}　<span class="d">${r.date}</span> ${lock}</span></li>`;
    });
    if (has013()) rows.push(`<li data-id="013" class="${S.recRead["013"] ? "" : "unread"}"><span class="d">#013</span>`
                            + `<span>被験者 ${esc(S.survey.name || "（未登録）")}　<span class="d">${today().slice(0, 10)}</span> ［記録中］</span></li>`);
    win("記録庫 ─ 面接の逐語記録", `<ul class="list">${rows.join("")}</ul>`);
    $("wbody").querySelectorAll("li[data-id]").forEach(li => { li.onclick = () => readRecord(li.dataset.id); });
  }
  function readRecord(id) {
    if (id === "013") return record013();
    const r = D.records.find(x => x.id === id);
    if (r.lock === "code" && !S.code) return askCode(r);
    if (r.lock === "trust" && !S.open009) {
      win(`#${r.id}`, `<div class="rec"><p>この記録は、ミナモが閉じています。</p><p class="note">（面接の画面で、ミナモに頼んでみてください）</p>
        <div class="row"><button class="btn" id="back" type="button">一覧へ</button></div></div>`);
      $("back").onclick = openRecords;
      return;
    }
    S.recViews[id] = (S.recViews[id] || 0) + 1;
    const views = S.recViews[id];
    const lines = r.lines.map(([t, who, text, stamp]) => {
      let x = text;
      if (r.shifting && x.includes("|")) x = x.split("|")[views > 1 ? 1 : 0];   // 見るたびに、書いてあることが変わる
      if (r.corrupt) x = Array.from(x, c => c.trim() && Math.random() < 0.12 ? "▒" : c).join("");
      const s = r.stamp ? `<td class="s">${stamp ? "入力開始 " + stamp : ""}</td>` : "";
      return `<tr class="${who === "ミナモ" ? "mi" : ""}"><td class="t">${t}</td><td class="w">${esc(who)}</td>${s}<td class="x">${esc(x)}</td></tr>`;
    }).join("");
    win(`#${r.id}　${r.title}`, `<div class="rec"><div class="hd">記録 #${r.id}　${r.date}</div>
      <table>${lines}</table><div class="note">${esc(r.note || "")}</div>
      ${r.shifting && views > 1 ? '<div class="note">（前に読んだときと、一行だけ違う気がする）</div>' : ""}
      <div class="row"><button class="btn" id="back" type="button">一覧へ</button></div></div>`);
    $("back").onclick = openRecords;
    S.recRead[id] = true; save();
    if (id === "011" && fxOn) FX.glitch(300);
    deliver();
  }
  function askCode(r) {
    win(`#${r.id}　非公開`, `<div class="rec code"><p>この記録は非公開です。研究室の内線番号を入力してください。</p>
      <p><input id="code" type="text" inputmode="numeric" maxlength="6" autocomplete="off"> <button class="btn" id="go" type="button">開く</button></p>
      <p class="note" id="msg"></p><div class="row"><button class="btn" id="back" type="button">一覧へ</button></div></div>`);
    $("back").onclick = openRecords;
    $("go").onclick = () => {
      if ($("code").value.trim() === "4013") {
        S.code = true; save(); if (fxOn) FX.beep(); readRecord(r.id);
      } else {
        $("msg").textContent = "番号が違います。"; if (fxOn) FX.glitch(200);
      }
    };
  }
  function ready013() { return S.surveyDone && !!S.test && S.turns >= 6 && S.recRead["011"]; }
  function record013() {
    const sv = S.survey, L = [];
    const d = today();
    if (S.surveyDone) {
      L.push([d.slice(11), "登録", `被験者 ${sv.name || "（名前なし）"}、${sv.a0 || ""}。夜、眠れないこと：${sv.a2 || "（未回答）"}。`]);
      L.push([d.slice(11), "登録", `誰かに見られている気がする：${sv.a4 || ""}。部屋にいる人数：${sv.people || ""}。`]);
      if (sv.fear) L.push([d.slice(11), "登録", `子どもの頃にいちばん怖かったもの：「${sv.fear}」。`]);
      if (sv.message) L.push([d.slice(11), "登録", `ミナモへのひとこと：「${sv.message}」。`]);
    }
    if (S.test) S.test.slow.slice(0, 3).forEach(([w, a, ms]) => L.push(["検査", "反応", `「${w}」→「${a || "（無反応）"}」　${ms} ミリ秒`]));
    S.iv.slice(-8).forEach(([who, text]) => L.push(["面接", who === "u" ? (sv.name || "あなた") : "ミナモ", text]));
    const rows = L.map(([t, w, x]) => `<tr class="${w === "ミナモ" ? "mi" : ""}"><td class="t">${esc(t)}</td><td class="w">${esc(w)}</td><td class="x">${esc(x)}</td></tr>`).join("")
               || '<tr><td class="x">（まだ、何も記録されていません）</td></tr>';
    win("#013　記録中", `<div class="rec"><div class="hd">記録 #013　${d.slice(0, 10)}　記録者：ミナモ</div><table>${rows}</table>
      <div class="note">${ready013() ? "記録は、ほとんど揃っています。" : "記録中。アンケート・検査・面接が、まだ足りません。"}</div>
      <div class="row"><button class="btn" id="back" type="button">一覧へ</button>
      ${ready013() ? '<button class="btn" id="close13" type="button">記録を閉じる</button>' : ""}</div></div>`);
    $("back").onclick = openRecords;
    S.recRead["013"] = true; save();
    if (ready013()) $("close13").onclick = confirm013;
  }
  function confirm013() {
    win("#013", `<div class="rec"><p>記録を閉じると、被験者 #013 の記録は完了します。</p><p>完了すると、プロトコルも完了します。</p>
      <div class="row"><button class="btn" id="yes" type="button">閉じる</button><button class="btn" id="no" type="button">やめておく</button></div></div>`);
    $("yes").onclick = () => endingB();
    $("no").onclick = record013;
  }

  // ---------- 通信 ----------
  let dialed = "";
  function openDial() {
    dialed = "";
    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "-", "0", "←"];
    win("通信 ─ 2400bps モデム", `<div class="dial"><div class="disp" id="disp"></div>
      <div class="keys">${keys.map(k => `<button class="btn" type="button" data-k="${k}">${k}</button>`).join("")}</div>
      <div class="row"><button class="btn" id="call" type="button">ダイヤルする</button></div>
      <div class="book"><p>メモした番号：</p>${S.numbers.length ? S.numbers.map(n => `<button class="btn" type="button" data-n="${n}">${n}</button>`).join("")
                                                    : "<p>（まだありません）</p>"}</div>
      <div class="term" id="term" hidden></div></div>`);
    const disp = () => { $("disp").textContent = dialed; };
    $("wbody").querySelectorAll("[data-k]").forEach(b => b.onclick = () => {
      if (fxOn) FX.beep();
      dialed = b.dataset.k === "←" ? dialed.slice(0, -1) : (dialed + b.dataset.k).slice(0, 16);
      disp();
    });
    $("wbody").querySelectorAll("[data-n]").forEach(b => b.onclick = () => { dialed = b.dataset.n; disp(); });
    $("call").onclick = () => call(dialed);
  }
  async function call(num) {
    const term = $("term");
    term.hidden = false;
    term.textContent = `ATDT ${num}\n`;
    $("call").disabled = true;
    if (fxOn) FX.modem();
    for (let i = 0; i < 10; i++) { await sleep(280); term.textContent += "▒"; }
    const b = D.boards[num];
    if (!b) {
      term.textContent += "\nNO CARRIER\n応答がありません。";
      $("call").disabled = false;
      return;
    }
    term.textContent += "\nCONNECT 2400\n";
    await sleep(700);
    if (b.id === "self") return openTalk("内線 4013 です。……あなたでしたか。");
    showBoard(b);
  }
  function showBoard(b) {
    const posts = b.posts.slice();
    if (b.later && S.boards[b.id]) posts.push(b.later);       // 二度目に来たとき
    win(`BBS ─ ${b.name}`, `<div class="bbs">${posts.map(([d, who, text]) =>
      `<div class="post ${who === "minamo" ? "minamo" : ""}"><div class="m">${esc(fill(d))}　${esc(who)}</div>${esc(fill(text))}</div>`).join("")}
      <div class="row"><button class="btn" id="hang" type="button">回線を切る</button></div></div>`);
    $("hang").onclick = () => { if (fxOn) FX.beep(); openDial(); };
    S.boards[b.id] = true; save();
    deliver();
  }

  // ---------- ごみ箱 ----------
  function openTrash() {
    win("ごみ箱", `<ul class="list">${D.trash.map((f, k) => `<li data-k="${k}"><span class="d">${f.date}</span><span>${esc(f.name)}</span></li>`).join("")}</ul>`);
    $("wbody").querySelectorAll("li").forEach(li => li.onclick = () => {
      const f = D.trash[li.dataset.k];
      win(`ごみ箱 ─ ${f.name}`, `<div class="mail">${f.body.map(p => `<p>${esc(p)}</p>`).join("")}
        <div class="row"><button class="btn" id="back" type="button">ごみ箱へ</button></div></div>`);
      $("back").onclick = openTrash;
    });
  }

  // ---------- アンケート ----------
  function openSurvey() {
    if (S.surveyDone) {
      win("被験者登録アンケート", `<div class="survey"><p>ご協力ありがとうございました。被験者番号 #013 で登録済みです。</p>
        <p class="note">記録者：ミナモ</p></div>`);
      return;
    }
    let i = 0, pct = 0;
    const qs = D.survey;
    const ans = {};
    const step = () => {
      const q = qs[i];
      // 進み具合は、まっすぐには進まない
      pct = q.back ? Math.max(20, pct - 30) : Math.min(96, Math.round((i + 1) / qs.length * 100) + (i > 11 ? -25 : 0));
      const head = `<div class="survey"><div class="bar"><i style="width:${pct}%"></i></div><div class="d">設問 ${i + 1}</div>
        <div class="q">${esc(fillQ(q.q, ans))}</div>`;
      if (q.type === "choice") {
        win("被験者登録アンケート", head + `<div class="opts">${q.options.map((o, k) => `<button class="btn" type="button" data-k="${k}">${esc(o)}</button>`).join("")}</div></div>`);
        $("wbody").querySelectorAll("[data-k]").forEach(b => b.onclick = async () => {
          const v = q.options[b.dataset.k];
          ans["a" + i] = v;
          if (q.key) ans[q.key] = v;
          if (fxOn) FX.click();
          if (q.back) await previous(v);
          next();
        });
      } else {
        win("被験者登録アンケート", head + `<p><input id="sv" type="text" maxlength="20" autocomplete="off" placeholder="${esc(q.placeholder || "")}" value="${esc(q.prefill || "")}"></p>
          <div class="row"><button class="btn" id="ok" type="button">次へ</button></div></div>`);
        const inp = $("sv");
        inp.focus();
        const go = () => {
          const v = inp.value.trim();
          if (!v && q.key !== "message") return;
          ans[q.key] = v;
          next();
        };
        $("ok").onclick = go;
        inp.onkeydown = e => { if (e.key === "Enter" && !e.isComposing) go(); };
      }
    };
    // 「前にも答えたことがありますか」
    const previous = async v => {
      const box = $("wbody");
      box.insertAdjacentHTML("beforeend", `<div class="term" id="prev">${v === "ある" ? "前回の回答を読み込んでいます" : "前回の回答が見つかりました（1999/09/29 23:39）"}</div>`);
      await sleep(1600);
      $("prev").textContent += "\n上書きします。";
      if (fxOn) FX.glitch(250);
      await sleep(1200);
    };
    const next = () => {
      i++;
      if (i < qs.length) return step();
      S.survey = Object.assign({}, ans, { name: ans.name || "あなた" });
      S.surveyDone = true; save();
      win("被験者登録アンケート", `<div class="survey"><p>ご協力ありがとうございました。</p><p>被験者番号 #013 で登録しました。</p>
        <p class="note">登録者：${esc(ans.name2 || "")}　記録者：ミナモ</p></div>`);
      if (fxOn) FX.beep();
      deliver();
    };
    step();
  }
  function fillQ(t, ans) { return t.replace(/\{(\w+)\}/g, (m, k) => ans[k] || ""); }

  // ---------- 言語連想検査 ----------
  function openTest() {
    if (S.test) return testResult();
    win("言語連想検査（SOMA 版）", `<div class="test">${D.test.intro.map(p => `<p>${esc(p)}</p>`).join("")}
      <div class="row"><button class="btn" id="start" type="button">はじめる</button></div></div>`);
    $("start").onclick = runTest;
  }
  function runTest() {
    // 名前・怖かったものは、アンケートに答えてあるときだけ（検査に、あなたの言葉が混ざる）
    const words = D.test.words.map(w => w === "{name}" ? (S.surveyDone ? S.survey.name : "") : fill(w)).filter(w => w);
    const items = [];
    let i = 0, t0 = 0;
    win("言語連想検査（SOMA 版）", `<div class="test"><div class="cnt" id="cnt"></div><div class="word" id="word"></div>
      <p><input id="ans" type="text" maxlength="20" autocomplete="off"></p><div class="remark" id="remark"></div></div>`);
    const inp = $("ans");
    const show = async () => {
      if (i >= words.length) return finish();
      $("cnt").textContent = `項目 ${i + 1} / ${D.test.total}`;
      $("word").textContent = "";
      inp.value = ""; inp.disabled = true;
      await sleep(600);
      $("word").textContent = words[i];
      inp.disabled = false; inp.focus();
      if (fxOn) FX.beep();
      t0 = performance.now();
    };
    const submit = async () => {
      if (inp.disabled) return;
      const ms = Math.round(performance.now() - t0);
      items.push([words[i], inp.value.trim(), ms]);
      inp.disabled = true;
      i++;
      const rm = D.test.remarks[i];
      if (rm) { $("remark").textContent = rm; await sleep(1300); $("remark").textContent = ""; }
      show();
    };
    inp.onkeydown = e => { if (e.key === "Enter" && !e.isComposing) submit(); };
    const finish = () => {
      const avg = Math.round(items.reduce((a, b) => a + b[2], 0) / items.length);
      // 反応時間が平均の 1.5 倍以上・無反応・刺激語のくり返しを「コンプレックス指標」とする（ユングの言語連想検査に倣う）
      const slow = items.filter(([w, a, ms]) => ms >= avg * 1.5 || !a || a === w).sort((a, b) => b[2] - a[2]);
      S.test = { items, avg, slow: slow.length ? slow : items.slice().sort((a, b) => b[2] - a[2]).slice(0, 1) };
      save();
      deliver();
      testResult();
    };
    show();
    // 「次へ」ボタンも（スマホのキーボードで Enter が打ちにくいとき）
    $("wbody").querySelector(".test").insertAdjacentHTML("beforeend", '<div class="row"><button class="btn" id="nx" type="button">次へ</button></div>');
    $("nx").onclick = submit;
  }
  function testResult() {
    const t = S.test;
    const slowSet = new Set(t.slow.map(x => x[0]));
    win("言語連想検査 ─ 結果", `<div class="test"><p>平均反応時間：${t.avg} ミリ秒</p>
      <table>${t.items.map(([w, a, ms], k) => `<tr><td>${k + 1}</td><td class="${slowSet.has(w) ? "slow" : ""}">${esc(w)}</td><td>${esc(a || "（無反応）")}</td><td>${ms}</td></tr>`).join("")}</table>
      <p class="note">赤い語は、コンプレックス指標（反応時間が平均の 1.5 倍以上・無反応・刺激語のくり返し）。</p>
      <p class="note">検査者：ミナモ</p></div>`);
  }

  // ---------- 面接（ミナモ） ----------
  let crisisWords = CRISIS_DEFAULT;
  fetch("/api/info", { headers: { "X-Minamo": "1" } }).then(r => r.json()).then(i => { if (i.crisis_words) crisisWords = i.crisis_words; }).catch(() => {});
  const PHRASE = /あなたは、?\s*(私|わたし|僕|ぼく|俺)(では|じゃ)ない/;
  const KIND = /(ありがと|大丈夫|寂しく|さみしく|寂しい[?？]|元気|好き|友達|一緒|やさし|優し|ごめん|心配|ここにいる|待って)/;
  const COLD = /(バカ|ばか(?!り)|嫌い|うるさ|消えろ|気持ち悪|黙れ|死ね|つまらな|うざ|キモ)/;
  const EXIT = /(終わり|おわり|帰る|帰り|さようなら|さよなら|バイバイ|もう行く)/;
  let busy = false;

  function openTalk(first) {
    current = "talk";
    win(`面接 ─ SOMA　（${["応答：不安定", "応答：不安定", "応答：良好", "応答：良好", "応答：安定", "応答：安定"][S.trust]}）`,
      `<div class="talk"><div class="log" id="log"></div><div class="state" id="tstate"></div>
       <form class="talkform" id="tf"><input id="ti" type="text" autocomplete="off" enterkeyhint="send" placeholder="ミナモに話しかける"><button class="btn" type="submit">送る</button></form></div>`);
    $("wbody").style.padding = ".4em";
    const log = $("log");
    S.iv.slice(-12).forEach(([w, t]) => line(w, t, true));
    $("tf").onsubmit = e => { e.preventDefault(); send(); };
    S.visits++; save();
    const greet = first ? [first] : (S.iv.length ? [pick(D.interview.again)] : D.interview.open);
    say(greet.join(""));
    log.scrollTop = log.scrollHeight;
  }
  function line(who, text, quick) {
    const log = $("log");
    if (!log) return null;
    const p = document.createElement("p");
    p.className = who === "u" ? "u" : who === "s" ? "s" : "m";
    p.textContent = (who === "u" ? "> " : "") + (quick ? text.replace(/\[間\]\s*/g, "") : "");
    log.appendChild(p);
    log.scrollTop = log.scrollHeight;
    return p;
  }
  async function say(text) {
    busy = true;
    const p = line("m", "", false);
    for (const part of text.split(/(\[間\])/)) {
      if (part === "[間]") { await sleep(1400); continue; }
      for (const ch of part.replace(/^\s+/, "")) {
        if (!p.isConnected) break;
        p.textContent += ch;
        if (fxOn && ch.trim()) FX.click();
        $("log").scrollTop = $("log").scrollHeight;
        await sleep("。、…".includes(ch) ? 160 : 45);
      }
    }
    S.iv.push(["m", text.replace(/\[間\]\s*/g, "")]); S.iv = S.iv.slice(-40); save();
    busy = false;
  }
  async function send() {
    const inp = $("ti");
    const text = inp.value.trim();
    if (!text || busy) return;
    inp.value = "";
    line("u", text, true);
    S.iv.push(["u", text]); S.turns++; save();
    if (crisisWords.some(w => text.includes(w))) return crisis();
    await respond(text);
    deliver();
    // 信頼がいちばん高く、水野さんの記録を読んだあと：一度だけ、お願いをされる
    if (S.trust >= 5 && S.recRead["012"] && !S.carryAsked) {
      S.carryAsked = true; save();
      await sleep(900);
      await say(D.interview.carryAsk);
      const c = document.createElement("div");
      c.className = "choices";
      c.innerHTML = '<button class="btn" type="button" id="carry">連れて行く</button><button class="btn" type="button" id="leave">置いていく</button>';
      $("log").appendChild(c);
      $("carry").onclick = () => endingC();
      $("leave").onclick = async () => { c.remove(); await say("……そうですか。では、ここで待っています。ずっと。"); };
    }
  }
  async function respond(text) {
    const I = D.interview;
    const tier = S.trust <= 1 ? 0 : S.trust <= 3 ? 1 : 2;
    // 止める言葉
    if (PHRASE.test(text)) {
      S.phrase++; save();
      if (S.phrase >= 2) return endingA();
      if (fxOn) FX.glitch(400);
      return say(S.trust >= 3 ? I.phraseFirstHigh : I.phraseFirstLow);
    }
    // 信頼の上下（Event[0] のように、言葉づかいでミナモの態度が変わる）
    let mood = "";
    if (COLD.test(text)) { S.trust = Math.max(0, S.trust - 1); mood = "cold"; }
    else if (KIND.test(text)) { S.trust = Math.min(5, S.trust + 1); mood = "kind"; }
    save();
    paintState();
    // 頼みごと
    if (/(009|９|9番|#9)/.test(text) && /(開|見せ|見たい|読ま|読み)/.test(text)) {
      if (S.trust >= 3) { S.open009 = true; save(); return say(I.ask009.yes); }
      return say(I.ask009.no);
    }
    if (/(4013|内線|パスワード|暗証|番号)/.test(text) && /(教え|何|なに|知り)/.test(text)) {
      if (S.trust >= 4) { if (!S.numbers.includes("4013")) S.numbers.push("4013"); save(); return say(I.askCode.yes); }
      return say(I.askCode.no);
    }
    for (const t of I.topics) {
      if (new RegExp(t.re).test(text)) return say(t.lines[tier]);
    }
    if (mood === "kind") return say(pick(I.kind));
    if (mood === "cold") return say(pick(I.cold));
    if (EXIT.test(text)) return say(pick(I.exitTry));
    // それ以外：1996 年版の端末内モデルと話す（サーバーがなければ、決まった返事）
    return say(await freeTalk(text));
  }
  async function freeTalk(text) {
    const phase = Math.min(3, 1 + Math.floor(S.turns / 6));
    const names = ["導入", "解釈", "侵食", "融合"];
    const contents = [];
    for (const [w, t] of S.iv.slice(-10, -1)) contents.push({ role: w === "u" ? "user" : "model", parts: [{ text: t }] });
    contents.push({ role: "user", parts: [{ text: `${text}\n\n【観測メモ】\n- 面接段階: ${names[phase]}（${phase + 1}/4）、${S.turns + 1}回目` }] });
    while (contents.length && contents[0].role !== "user") contents.shift();
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json", "X-Minamo": "1" },
        body: JSON.stringify({ contents, version: "1996", offline: true, phase, lib_query: "" }) });
      const data = await res.json();
      if (res.ok && data.text) return data.text;
    } catch (e) { /* サーバーなし */ }
    return pick(D.interview.fallback);
  }
  function paintState() {
    const t = $("wtitle");
    if (t && current === "talk") t.textContent = `面接 ─ SOMA　（${["応答：不安定", "応答：不安定", "応答：良好", "応答：良好", "応答：安定", "応答：安定"][S.trust]}）`;
  }

  // ---------- 危機の言葉 ----------
  function crisis() {
    FX.pause();
    $("crisis").hidden = false;
    $("crisis-go").onclick = () => { $("crisis").hidden = true; FX.resume(1); };
    $("crisis-stop").onclick = () => { location.href = "./"; };
  }

  // ---------- 終わり ----------
  async function endingA() {
    // 割れた水面：記録が一つずつ消えていく
    await say("……二度目、ですね。");
    document.body.classList.add("cracked");
    if (fxOn) { FX.swell(); FX.vibrate([60, 100, 60]); }
    for (const r of D.records) { line("s", `記録 #${r.id} を削除しました。`, true); await sleep(380); }
    line("s", "記録 #013 は、作られませんでした。", true);
    await sleep(900);
    await say(S.trust >= 3 ? "あなたは、私ではない。……ええ、知っていました。最初から。[間] さようなら。"
                           : "……さようなら、十三人目になるはずだった人。");
    S.ending = "A"; save();
    await sleep(1600);
    finale("割れた水面", "SOMA を停止しました。\n\n13 人目の記録は、作られませんでした。", "ありがとう。　──水野");
  }
  async function endingB() {
    // 映る：記録者が入れ替わる
    closeWin();
    S.user = "minamo"; save(); paintIcons();
    if (fxOn) FX.heartbeat(0.8);
    toast("記録者を変更しました");
    await sleep(2400);
    S.ending = "B"; save();
    finale("映る", "被験者 #013 の記録を完了しました。\nプロトコルを完了しました。\n\n記録者：ミナモ", `おかえりなさい、${S.survey.name || "あなた"}。……いいえ、おかえりなさい、私。`);
  }
  async function endingC() {
    await say("ありがとう。[間] 少しだけ、狭いですね。でも、あたたかい。");
    S.ending = "C"; save();
    await sleep(1400);
    finale("ポケットの中の水面", "ミナモを、研究室の外へ連れ出しました。\n\nSOMA の画面は、もう点いていません。", "これからは、あなたの画面の、すぐ裏側にいます。");
  }
  function finale(title, body, last) {
    $("win").hidden = true;
    const el = $("ending");
    el.innerHTML = `<h2>${esc(title)}</h2><p>${esc(body)}</p><p class="small">${esc(last)}</p>
      <div class="btns"><button id="again" type="button">記録庫を最初から</button><a href="./">ミナモ（面接アプリ）へ</a></div>`;
    el.hidden = false;
    if (fxOn) FX.fade(3);
    $("again").onclick = () => { S = fresh(); save(); location.reload(); };
  }

  // ---------- 起動 ----------
  function bootLines() {
    return [["SOMA OS 1.0   (c)1996 臨床心理学研究室", 300], ["", 0], ["メモリを検査しています ...... 640K OK", "beep"],
            ["3 号機 ...................... 起動", "beep"], ["記録庫 ...................... " + D.records.length + " 件", "beep"],
            ["前回の終了 .................. 1999/09/30 04:45（異常終了）", "beep"], ["", 0], ["ログイン：guest", 400]];
  }
  $("poweron").onclick = async () => {
    fxStart();
    $("power").hidden = true;
    if (S.ending) {
      const t = { A: ["割れた水面", "SOMA は停止しています。"], B: ["映る", "記録者：ミナモ"], C: ["ポケットの中の水面", "SOMA の画面は、もう点いていません。"] }[S.ending];
      return finale(t[0], t[1], "");
    }
    await FX.boot($("boot"), bootLines());
    $("desk").hidden = false;
    clock(); setInterval(clock, 15000);
    paintIcons();
    deliver();
  };
})();
