/* ミナモ：水底（物語モード その二）。面接アプリ・記録庫とは別のページで、保存も別（minamo.minasoko）。
   夢網の頁を巡回して「水面の言葉」を通報し（Hypnospace Outlaw）、BBS と表示されない返事でナギと話し（Digital: A Love Story）、
   時間で開く深層の頁からかけらを拾い、水の音がしたら画面を伏せる（Welcome to the Game）。
   中身は minasoko-data.js（window.SOKO）。音は fx.js（window.FX）。サーバーがなくても、全部遊べる。 */
(function () {
  "use strict";

  const D = window.SOKO;
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const pad = n => String(n).padStart(2, "0");
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const KEY = "minamo.minasoko";
  const CRISIS_DEFAULT = ["死にたい", "しにたい", "消えたい", "自殺", "自死", "首を吊", "リスカ", "リストカット", "飛び降り",
                          "ODし", "オーバードーズ", "殺してほしい", "生きていたくない"];

  // ---------- 保存 ----------
  const fresh = () => ({ name: "", points: 0, owned: {}, flagged: {}, visited: {}, found: {}, numbers: [], tags: [],
                         mails: [], mailRead: {}, nagi: [], nagiRead: {}, nagiReplied: {}, boards: {}, installed: false,
                         frags: {}, fragOrder: [], fragEver: false, hidOnce: false, caught: 0, charmUsed: false, ending: null });
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
  const fill = t => String(t).replace(/\{(\w+)\}/g, (m, k) => ({ today: today(), name: S.name || "巡回員" }[k] ?? ""));
  const fragCount = () => Object.keys(S.frags).length;
  const goodFlags = () => Object.values(S.flagged).filter(v => v).length;

  // ---------- 条件 ----------
  function ok(c) {
    if (Array.isArray(c)) return c.every(ok);
    if (c === "start") return true;
    if (c === "installed") return S.installed;
    const [k, v] = c.split(":");
    if (k === "flags") return goodFlags() >= +v;
    if (k === "frags") return fragCount() >= +v;
    if (k === "flagged") return v in S.flagged;
    return !!({ visit: S.visited, board: S.boards, replied: S.nagiReplied }[k] || {})[v];
  }

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
  function nudge(app) {
    const ic = document.querySelector(`.icon[data-app="${app}"]`);
    if (ic) { ic.classList.remove("new"); void ic.offsetWidth; ic.classList.add("new"); }
  }

  // ---------- 指示と私信の配達 ----------
  function deliver() {
    let m = 0, n = 0;
    for (const x of D.mails) if (!S.mails.includes(x.id) && ok(x.when)) { S.mails.push(x.id); m++; }
    for (const x of D.nagi) if (!S.nagi.includes(x.id) && ok(x.when)) { S.nagi.push(x.id); n++; }
    if (!m && !n) return;
    save(); paintIcons();
    fx("beep");
    if (m) { toast("巡回票に、汐見さんから新しい指示が届きました"); nudge("junkai"); }
    if (n) { setTimeout(() => { toast("回線：私信が届きました"); fx("beep"); }, m ? 3000 : 0); nudge("kaisen"); }
  }
  function note(kind, v) {
    const list = kind === "num" ? S.numbers : S.tags;
    if (!list.includes(v)) { list.push(v); save(); }
  }

  // ---------- デスクトップ ----------
  const APPS = [
    { id: "junkai", g: "票", t: "巡回票", show: () => true },
    { id: "yume", g: "夢", t: "夢網", show: () => true },
    { id: "kaisen", g: "線", t: "回線", show: () => S.numbers.length > 0 },
    { id: "techo", g: "帳", t: "手帳", show: () => true },
    { id: "shinso", g: "深", t: "深層", cls: "deep", show: () => S.installed },
    { id: "water", g: "水", t: "水.txt", cls: "deep", show: () => S.installed },
  ];
  function paintIcons() {
    const box = $("icons");
    box.textContent = "";
    for (const a of APPS) {
      if (!a.show()) continue;
      const b = document.createElement("button");
      b.type = "button"; b.className = "icon " + (a.cls || ""); b.dataset.app = a.id;
      b.innerHTML = `<span class="g">${a.g}</span><span class="t">${a.t}</span>`;
      const unread = a.id === "junkai" ? S.mails.filter(id => !S.mailRead[id]).length
                   : a.id === "kaisen" ? S.nagi.filter(id => !S.nagiRead[id]).length : 0;
      if (unread) b.insertAdjacentHTML("beforeend", `<span class="badge">${unread}</span>`);
      b.onclick = () => { fx("click"); open(a.id); };
      box.appendChild(b);
    }
    $("pts").textContent = `巡回点 ${S.points}`;
    $("facedown").hidden = !S.installed;
  }
  function clock() {
    const d = new Date();
    // 日付は 1999/12/31 のまま。時と分だけが進む
    $("clock").textContent = `1999/12/31 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // ---------- 窓（いつも一つだけ、全面） ----------
  let current = "";
  function win(title, html, opt) {
    const o = opt || {};
    $("wtitle").textContent = title;
    $("wtool").innerHTML = o.tool || "";
    $("wbody").innerHTML = html;
    $("wbody").scrollTop = 0;
    $("win").classList.toggle("deep", !!o.deep);
    $("win").hidden = false;
  }
  function closeWin() {
    $("win").hidden = true; current = ""; stopSilence(); paintIcons();
    if (fxOn) FX.setPhase(0);
  }
  $("wclose").onclick = () => { fx("click"); closeWin(); };
  function open(id) {
    stopSilence();
    current = id;
    if (fxOn) FX.setPhase(id === "shinso" ? 2 : 0);
    ({ junkai: openJunkai, yume: openYume, kaisen: openKaisen, techo: openTecho, shinso: openShinso, water: openWater })[id]();
  }

  // ---------- 巡回票（汐見さんの指示・決まり・道具との交換） ----------
  function openJunkai(tab) {
    const t = tab || "mail";
    const tabs = `<div class="tabs">${[["mail", "指示"], ["rules", "決まり"], ["shop", "交換"]].map(([k, v]) =>
      `<button class="btn ${k === t ? "on" : ""}" type="button" data-tab="${k}">${v}</button>`).join("")}</div>`;
    let body = "";
    if (t === "mail") {
      const last = D.mails.find(m => m.id === S.mails[S.mails.length - 1]);
      body = `<div class="task">いまのお願い：${esc(last ? last.task : "")}</div>`
           + `<ul class="list">${S.mails.slice().reverse().map(id => {
                const m = D.mails.find(x => x.id === id);
                return `<li data-id="${id}" class="${S.mailRead[id] ? "" : "unread"}"><span>${esc(m.subject)}</span></li>`;
              }).join("")}</ul>`;
    } else if (t === "rules") {
      body = `<ol class="rules">${D.rules.map(r => `<li>${esc(r)}</li>`).join("")}</ol>`
           + `<p><b>「水面の言葉」の例</b></p><ul class="rules">${D.examples.map(r => `<li>${esc(r)}</li>`).join("")}</ul>`;
    } else {
      body = `<p>巡回点：${S.points}</p><ul class="list shop">${D.shop.map(x => `<li><b>${esc(x.name)}（${x.price} 点）</b>`
           + `<span class="note">${esc(x.desc)}</span><span>${S.owned[x.id] ? "交換済み" + (x.id === "charm" && S.charmUsed ? "（ほどけた）" : "")
             : `<button class="btn" type="button" data-buy="${x.id}" ${S.points < x.price ? "disabled" : ""}>交換する</button>`}</span></li>`).join("")}</ul>`;
    }
    win(`巡回票 ─ ${S.name}`, body, { tool: tabs });
    $("wtool").querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { fx("click"); openJunkai(b.dataset.tab); });
    $("wbody").querySelectorAll("li[data-id]").forEach(li => li.onclick = () => readMail(li.dataset.id));
    $("wbody").querySelectorAll("[data-buy]").forEach(b => b.onclick = () => {
      const x = D.shop.find(y => y.id === b.dataset.buy);
      if (S.points < x.price) return;
      S.points -= x.price; S.owned[x.id] = true; save();
      fx("beep"); toast(`${x.name}と交換しました`);
      paintIcons(); openJunkai("shop");
    });
  }
  function readMail(id) {
    const m = D.mails.find(x => x.id === id);
    S.mailRead[id] = true; save(); paintIcons();
    win(m.subject, `<div class="mail"><h3>${esc(m.subject)}</h3><div class="hd">差出人：${esc(m.from)}</div>
      ${m.body.map(p => `<p>${esc(fill(p))}</p>`).join("")}<div class="task">いまのお願い：${esc(m.task)}</div>
      <div class="row"><button class="btn" id="back" type="button">一覧へ</button></div></div>`);
    $("back").onclick = () => openJunkai("mail");
  }

  // ---------- 夢網（1999 年の個人の頁を巡回する） ----------
  let hist = [];
  const pageOf = id => D.pages.find(p => p.id === id);
  const gone = p => S.flagged[p.id] === true;
  function yumeTool(withFlag) {
    return `<button class="btn" type="button" id="yback">◀</button><button class="btn" type="button" id="yhome">ホーム</button>`
         + `<input id="ytag" type="text" maxlength="16" autocomplete="off" enterkeyhint="search" placeholder="タグで探す">`
         + `<button class="btn" type="button" id="ysearch">探す</button>`
         + (withFlag ? `<button class="btn" type="button" id="yflag">通報</button>` : "");
  }
  function bindYume(view) {
    $("yback").onclick = () => { fx("click"); hist.pop(); const prev = hist.pop(); prev ? showView(prev) : openYume(); };
    $("yhome").onclick = () => { fx("click"); openYume(); };
    const go = () => { const v = $("ytag").value.trim().replace(/^[#＃]/, ""); if (v) search(v); };
    $("ysearch").onclick = go;
    $("ytag").onkeydown = e => { if (e.key === "Enter" && !e.isComposing) go(); };
    if ($("yflag")) $("yflag").onclick = () => flagAsk(view.id);
  }
  function showView(v) { v.kind === "page" ? showPage(v.id) : v.kind === "search" ? search(v.q) : openYume(); }
  function openYume() {
    hist = [{ kind: "home" }];
    const zones = D.home.zones.map(z => `<div class="zone"><h3>${esc(z.name)}　<span class="note">${esc(z.desc)}</span></h3>
      <ul class="list">${D.pages.filter(p => p.zone === z.id && (!p.hidden || S.found[p.id])).map(p =>
        `<li data-id="${p.id}" class="${gone(p) ? "gone" : ""}"><span>${esc(p.title)}</span><span class="d">${esc(p.user)}</span></li>`).join("")}</ul></div>`).join("");
    win("夢網 ─ ホーム", `<div class="banner">${esc(D.home.banner)}</div><p>${esc(D.home.intro)}</p>${zones}
      <p class="note">頁の右上の「通報」で、「水面の言葉」を含む頁を知らせます。区画の一覧に出ない頁は、タグで探します。</p>`,
      { tool: yumeTool(false) });
    bindYume({ kind: "home" });
    $("wbody").querySelectorAll("li[data-id]").forEach(li => li.onclick = () => { fx("click"); showPage(li.dataset.id); });
  }
  function search(q) {
    if (crisisCheck(q)) return;
    hist.push({ kind: "search", q });
    const hits = D.pages.filter(p => p.tags.includes(q));
    let fresh1 = 0;
    for (const p of hits) if (p.hidden && !S.found[p.id]) { S.found[p.id] = true; S.points += D.points.hidden; fresh1++; }
    if (fresh1) { save(); paintIcons(); fx("beep"); toast(`区画の一覧にない頁を見つけました（巡回点 +${D.points.hidden * fresh1}）`); }
    win(`夢網 ─ タグ「${q}」`, hits.length ? `<ul class="list">${hits.map(p =>
      `<li data-id="${p.id}" class="${gone(p) ? "gone" : ""}"><span>${esc(p.title)}</span><span class="d">${esc(p.user)}</span></li>`).join("")}</ul>`
      : `<p>タグ「${esc(q)}」の頁は、見つかりませんでした。</p>`, { tool: yumeTool(false) });
    $("ytag").value = q;
    bindYume({ kind: "search" });
    $("wbody").querySelectorAll("li[data-id]").forEach(li => li.onclick = () => { fx("click"); showPage(li.dataset.id); });
  }
  function showPage(id) {
    const p = pageOf(id);
    hist.push({ kind: "page", id });
    if (gone(p)) {
      win(`夢網 ─ ${p.title}`, `<div class="gonepage">この頁は、公開する写しから外されました。<br>（通報済み）</div>`, { tool: yumeTool(false) });
      return bindYume({ kind: "page", id });
    }
    const th = p.theme;
    const html = `<div class="yp ${th.font}" style="background:${th.bg};color:${th.fg}">
      <h2>${esc(p.title)}</h2><div class="by">作者：${esc(p.user)}</div>
      ${p.marquee ? `<div class="marq"><span>${esc(p.marquee)}</span></div>` : ""}
      ${p.body.map(t => `<p>${esc(t)}</p>`).join("")}
      ${p.midi ? `<div class="midi">${p.midi.map((m, k) => `<button type="button" data-midi="${k}">♪ ${esc(m.name)}<br><small>${esc(m.note)}</small></button>`).join("")}</div>` : ""}
      <div class="counter">あなたは <b>${String(p.counter).padStart(6, "0")}</b> 人目のお客さまです</div>
      ${p.guest.length ? `<div class="guest"><b>記帳</b>${p.guest.map(([w, t]) => `<div>◇ ${esc(w)}：${esc(t)}</div>`).join("")}</div>` : ""}
      <div class="tags">タグ：${p.tags.map(t => `<button type="button" data-tag="${esc(t)}">${esc(t)}</button>`).join("")}</div></div>`;
    win(`夢網 ─ ${p.title}`, html, { tool: yumeTool(true) });
    bindYume({ kind: "page", id });
    $("wbody").querySelectorAll("[data-tag]").forEach(b => b.onclick = () => { fx("click"); search(b.dataset.tag); });
    $("wbody").querySelectorAll("[data-midi]").forEach(b => b.onclick = () => playTune(p.midi[b.dataset.midi].tune));
    S.visited[id] = true;
    p.tags.forEach(t => note("tag", t));
    (p.body.join("\n").match(/\d{4}-\d{4}-\d{4}/g) || []).forEach(n => note("num", n));
    save(); paintIcons();
    deliver();
  }
  function flagAsk(id) {
    const p = pageOf(id);
    if (id in S.flagged) return toast(S.flagged[id] ? "この頁は、通報済みです。" : "この頁の通報は、取り消されています。");
    $("wbody").insertAdjacentHTML("beforeend", `<div class="flagbox" id="fbox">この頁を「水面の言葉」で通報しますか？
      <div class="row"><button class="btn" type="button" id="fyes">通報する</button><button class="btn" type="button" id="fno">やめる</button></div></div>`);
    $("wbody").scrollTop = $("wbody").scrollHeight;
    $("fno").onclick = () => $("fbox").remove();
    $("fyes").onclick = () => {
      S.flagged[id] = !!p.viol;
      S.points = Math.max(0, S.points + (p.viol ? D.points.flag : D.points.wrong));
      save(); paintIcons();
      if (p.viol) {
        fx("beep");
        toast(`通報しました（巡回点 +${D.points.flag}）`);
        hist.pop(); showPage(id);
      } else {
        fx("glitch", 200);
        $("fbox").innerHTML = `汐見：この頁に、水面の言葉は見つかりませんでした。通報は取り消します。（巡回点 ${D.points.wrong}）`;
      }
      deliver();
    };
  }
  // 波音 MIDI 置き場の音（音声ファイルなし。WebAudio の音で）
  function playTune(name) {
    if (!fxOn) return;
    if (name === "wave") { FX.swell(); setTimeout(() => FX.swell(), 1800); return; }
    if (name === "gymno") {
      const n = [[739.99, 1.2], [880, 0.6], [783.99, 0.6], [739.99, 0.6], [554.37, 0.6], [493.88, 0.6], [554.37, 0.6], [587.33, 0.6], [440, 1.8]];
      let t = 0;
      for (const [f, d] of n) { FX.tone(f, d * 0.95, "sine", 0.05, t); t += d; }
      return;
    }
    const n = [659, 622, 587, 554, 523, 494, 466];
    n.forEach((f, k) => FX.tone(f, 0.5, "triangle", 0.04, k * 0.45));
    FX.tone(110, 2.4, "sawtooth", 0.02, n.length * 0.45);
    setTimeout(() => fx("glitch", 300), n.length * 450 + 1800);
  }

  // ---------- 回線（ダイヤル・BBS・私信） ----------
  let dialed = "", calling = false;
  function kaisenTabs(t) {
    const unread = S.nagi.filter(id => !S.nagiRead[id]).length;
    return `<div class="tabs"><button class="btn ${t === "dial" ? "on" : ""}" type="button" data-tab="dial">ダイヤル</button>`
         + (S.nagi.length ? `<button class="btn ${t === "pm" ? "on" : ""}" type="button" data-tab="pm">私信${unread ? `（${unread}）` : ""}</button>` : "")
         + `</div>`;
  }
  function bindTabs() {
    $("wtool").querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { fx("click"); b.dataset.tab === "pm" ? openPM() : openKaisen(); });
  }
  function openKaisen(num) {
    dialed = num || "";
    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "-", "0", "←"];
    win("回線 ─ 夢網ダイヤラー 28800bps", `<div class="dial"><div class="disp" id="disp">${esc(dialed)}</div>
      <div class="keys">${keys.map(k => `<button class="btn" type="button" data-k="${k}">${k}</button>`).join("")}</div>
      <div class="row"><button class="btn" id="call" type="button">ダイヤルする</button></div>
      <div class="book"><p>手帳の番号：</p>${S.numbers.length ? S.numbers.map(n => `<button class="btn" type="button" data-n="${n}">${n}</button>`).join("")
                                             : "<p>（まだありません）</p>"}</div>
      <div class="term" id="term" hidden></div></div>`, { tool: kaisenTabs("dial") });
    bindTabs();
    const disp = () => { $("disp").textContent = dialed; };
    $("wbody").querySelectorAll("[data-k]").forEach(b => b.onclick = () => {
      fx("beep");
      dialed = b.dataset.k === "←" ? dialed.slice(0, -1) : (dialed + b.dataset.k).slice(0, 16);
      disp();
    });
    $("wbody").querySelectorAll("[data-n]").forEach(b => b.onclick = () => { fx("click"); dialed = b.dataset.n; disp(); });
    $("call").onclick = () => call(dialed);
  }
  async function call(num) {
    if (calling || !num) return;
    calling = true;
    const term = $("term");
    term.hidden = false;
    term.textContent = `ATDT ${num}\n`;
    $("call").disabled = true;
    fx("modem");
    for (let i = 0; i < 10; i++) { await sleep(280); if (!term.isConnected) { calling = false; return; } term.textContent += "▒"; }
    calling = false;
    const b = D.boards[num];
    if (!b) {
      term.textContent += "\nNO CARRIER\n応答がありません。";
      $("call").disabled = false;
      return;
    }
    term.textContent += "\nCONNECT 28800\n";
    await sleep(700);
    if (current === "kaisen") showBoard(b);
  }
  function showBoard(b) {
    const again = !!S.boards[b.id];
    const posts = b.posts.slice();
    if (b.later && again) posts.push(b.later);       // 二度目に来たとき
    const f = b.file;
    win(`BBS ─ ${b.name}`, `<div class="bbs">${posts.map(([d, who, text]) =>
      `<div class="post ${who === "nagi" ? "nagi" : who === "minamo" ? "minamo" : ""}"><div class="m">${esc(fill(d))}　${esc(who)}</div>${esc(fill(text))}</div>`).join("")}
      ${f ? `<div class="file"><b>ファイル置き場</b><br>${esc(f.name)}（${esc(f.size)}）<br><span class="note">${esc(f.note)}</span>
        <div class="prog" id="prog" hidden><i></i></div><div class="row">${S.installed ? "<span class=\"note\">入れてあります</span>"
        : '<button class="btn" type="button" id="dl">落とす</button>'}</div></div>` : ""}
      <div class="row"><button class="btn" id="hang" type="button">回線を切る</button></div></div>`);
    $("hang").onclick = () => { fx("beep"); openKaisen(); };
    if ($("dl")) $("dl").onclick = () => download(f);
    S.boards[b.id] = true; save();
    deliver();
  }
  async function download(f) {
    $("dl").disabled = true;
    const bar = $("prog");
    bar.hidden = false;
    for (let i = 1; i <= 20; i++) {
      await sleep(i === 13 ? 1400 : 180);      // 65% で、少しだけ止まる
      if (!bar.isConnected) return;
      bar.firstChild.style.width = (i * 5) + "%";
      if (i % 4 === 0) fx("click");
    }
    S.installed = true; save();
    fx("swell");
    toast(`${f.name} を入れました。デスクトップに「深層」が増えました`);
    paintIcons(); nudge("shinso");
    deliver();
    if ($("dl")) $("dl").outerHTML = '<span class="note">入れてあります</span>';
  }
  function openPM() {
    win("回線 ─ 私信", `<ul class="list">${S.nagi.slice().reverse().map(id => {
      const m = D.nagi.find(x => x.id === id);
      return `<li data-id="${id}" class="${S.nagiRead[id] ? "" : "unread"}"><span class="d">nagi</span><span>${esc(m.subject)}${S.nagiReplied[id] ? "　<span class=\"note\">（返信済み）</span>" : ""}</span></li>`;
    }).join("")}</ul>`, { tool: kaisenTabs("pm") });
    bindTabs();
    $("wbody").querySelectorAll("li[data-id]").forEach(li => li.onclick = () => readPM(li.dataset.id));
  }
  function readPM(id) {
    const m = D.nagi.find(x => x.id === id);
    S.nagiRead[id] = true; save(); paintIcons();
    const done = !!S.nagiReplied[id];
    win(`私信 ─ ${m.subject}`, `<div class="mail"><h3>${esc(m.subject)}</h3><div class="hd">差出人：nagi</div>
      ${m.body.map(p => `<p>${esc(fill(p))}</p>`).join("")}
      <div class="row"><button class="btn" id="back" type="button">一覧へ</button>${done ? "" : '<button class="btn" id="reply" type="button">返信</button>'}</div>
      <div class="sent" id="sent">${done ? "返信済み　" + esc(D.sentNote) : ""}</div></div>`);
    $("back").onclick = openPM;
    if (!done) $("reply").onclick = () => replyPM(id);
  }
  // 返信は書ける。でも、何を書いたかは表示されない
  async function replyPM(id) {
    $("reply").disabled = true;
    const s = $("sent");
    s.textContent = "返信を書いています";
    for (let i = 0; i < 3; i++) { await sleep(500); if (!s.isConnected) break; s.textContent += "．"; fx("click"); }
    S.nagiReplied[id] = true; save();
    if (s.isConnected) s.textContent = "送信しました。" + D.sentNote;
    setTimeout(deliver, 2400);
  }

  // ---------- 手帳・水.txt ----------
  function fragLine() { return D.deep.map(d => S.frags[d.id] || "＿").join(" "); }
  function openTecho() {
    win("手帳", `<p><b>番号</b>（押すと、回線でかける）</p><div class="row">${S.numbers.length ? S.numbers.map(n =>
        `<button class="btn" type="button" data-n="${n}">${n}</button>`).join("") : '<span class="note">（まだありません）</span>'}</div>
      <p><b>タグ</b>（押すと、夢網で探す）</p><div class="row">${S.tags.map(t => `<button class="btn" type="button" data-t="${esc(t)}">${esc(t)}</button>`).join("")}</div>
      ${S.installed ? `<p><b>かけら</b>（深層の頁、一から六）</p><div class="frags">${esc(fragLine())}</div>` : ""}
      <p class="note">巡回点：${S.points}　正しく通報した頁：${goodFlags()}${S.caught ? `　映り込まれた回数：${S.caught}` : ""}</p>`);
    $("wbody").querySelectorAll("[data-n]").forEach(b => b.onclick = () => { fx("click"); current = "kaisen"; openKaisen(b.dataset.n); });
    $("wbody").querySelectorAll("[data-t]").forEach(b => b.onclick = () => { fx("click"); current = "yume"; openYume(); search(b.dataset.t); });
  }
  function openWater() {
    win("水.txt", `<div class="mail">${D.waterTxt.map(p => `<p>${esc(p)}</p>`).join("")}<p class="note">（作った覚えのないファイル）</p></div>`, { deep: true });
  }

  // ---------- 深層（時間で開く頁・隠されたかけら） ----------
  const deepOf = id => D.deep.find(d => d.id === id);
  function isOpen(d, at) {
    const m = (at || new Date()).getMinutes();
    return { always: true, even: m % 2 === 0, odd: m % 2 === 1, low: m % 10 <= 4, high: m % 10 >= 5, hid: S.hidOnce }[d.open];
  }
  function nextOpen(d) {
    for (let k = 1; k <= 10; k++) {
      const t = new Date(Date.now() + k * 60000);
      if (isOpen(d, t)) return `${pad(t.getHours())}:${pad(t.getMinutes())}`;
    }
    return "";
  }
  let deepToken = 0, atBottom = false, deepCur = null;
  function deepTool() {
    return `<input id="daddr" type="text" maxlength="24" autocomplete="off" enterkeyhint="go" placeholder="住所（dz://…）">`
         + `<button class="btn" type="button" id="dgo">開く</button><button class="btn" type="button" id="dindex">案内</button>`
         + `<button class="btn" type="button" id="dtrace">なぞる</button><button class="btn" type="button" id="dsrc">ソース</button>`
         + `<button class="btn" type="button" id="dhide">伏せる</button>`;
  }
  function bindDeep(d) {
    const go = () => address($("daddr").value);
    $("dgo").onclick = go;
    $("daddr").onkeydown = e => { if (e.key === "Enter" && !e.isComposing) go(); };
    $("dindex").onclick = () => { fx("click"); openShinso(); };
    $("dhide").onclick = hideScreen;
    $("dtrace").onclick = () => {
      fx("click");
      const box = $("wbody").querySelector(".deep");
      const on = box.classList.toggle("traced");
      $("dtrace").classList.toggle("on", on);
      if (on && d && d.hide === "ink") offerFrag(d);
    };
    $("dsrc").onclick = () => {
      fx("click");
      const box = $("wbody").querySelector(".deep");
      const old = box.querySelector(".src");
      if (old) { old.remove(); $("dsrc").classList.remove("on"); return; }
      const lines = d && d.source ? d.source
        : ["<html><body>", ...(d ? d.body : D.deepIntro).map(t => "  <p>" + t + "</p>"),
           ...(d && d.hide === "ink" ? [`  <font color="#061418">${d.secret}</font>`] : []), "</body></html>"];
      box.insertAdjacentHTML("beforeend", `<div class="src">${esc(lines.join("\n"))}</div>`);
      $("dsrc").classList.add("on");
      if (d && (d.hide === "source" || d.hide === "ink")) offerFrag(d);
    };
  }
  function openShinso() {
    atBottom = false; current = "shinso"; deepCur = null; stopSilence();
    const now = new Date();
    win("深層 ─ 案内", `<div class="deep"><h2>dz://soko　深層案内</h2>${D.deepIntro.map(p => `<p class="note">${esc(p)}</p>`).join("")}
      <ul class="list">${D.deep.map(d => {
        const open = isOpen(d, now);
        return `<li data-id="${d.id}" class="${open ? "" : "closed"}"><span class="d">${d.no}</span><span>${esc(d.title)}`
             + `<br><span class="note">${esc(D.openLabel[d.open])}　${open ? "（いま開いている）" : "（いまは閉じている）"}`
             + `${S.frags[d.id] ? "　かけら：拾った" : ""}</span></span></li>`;
      }).join("")}</ul><p class="note">かけら：${esc(fragLine())}</p></div>`, { tool: deepTool(), deep: true });
    bindDeep(null);
    $("wbody").querySelectorAll("li[data-id]").forEach(li => li.onclick = () => { fx("click"); openDeep(li.dataset.id); });
  }
  function address(raw) {
    const v = raw.trim().replace(/^dz:\/\//i, "").replace(/[\s　]/g, "");
    if (!v || crisisCheck(v)) return;
    const num = { "1": "d1", "2": "d2", "3": "d3", "4": "d4", "5": "d5", "6": "d6", "一": "d1", "二": "d2", "三": "d3", "四": "d4", "五": "d5", "六": "d6" };
    const m = v.match(/^(?:soko\/)?([1-6一二三四五六])$/);
    if (m) return openDeep(num[m[1]]);
    if (D.address.answer.includes(v)) {
      if (fragCount() < 6) return deepMsg("その住所には、まだ届きません。かけらが足りません。");
      return openBottom();
    }
    deepMsg(D.address.others[v] || D.address.none);
  }
  function deepMsg(t) {
    const box = $("wbody").querySelector(".deep");
    if (!box) return;
    const old = box.querySelector(".addrmsg");
    if (old) old.remove();
    box.insertAdjacentHTML("beforeend", `<p class="addrmsg">${esc(t)}</p>`);
    $("wbody").scrollTop = $("wbody").scrollHeight;
    fx("glitch", 150);
  }
  async function openDeep(id) {
    const d = deepOf(id);
    stopSilence();
    atBottom = false;
    const token = ++deepToken;
    const head = `<h2>dz://soko/${d.id.slice(1)}　${esc(d.title)}</h2>`;
    if (!isOpen(d)) {
      win(`深層 ─ ${d.title}`, `<div class="deep">${head}<p>この頁は、いまは閉じています。</p>
        <p class="note">${esc(D.openLabel[d.open])}開きます。${d.open === "hid" ? "" : `次に開くのは ${nextOpen(d)} ごろ。`}</p></div>`,
        { tool: deepTool(), deep: true });
      return bindDeep(null);
    }
    win(`深層 ─ ${d.title}`, `<div class="deep">${head}<p class="loading" id="load">読み込んでいます</p><div class="prog"><i id="lbar"></i></div></div>`,
        { tool: deepTool(), deep: true });
    bindDeep(null);
    const steps = rand(5, 10);
    for (let i = 1; i <= steps; i++) {
      await sleep(rand(150, 320));
      if (token !== deepToken) return;
      $("lbar").style.width = Math.round(i / steps * 100) + "%";
    }
    if (Math.random() < 0.25) {
      if (S.owned.line) toast("回線が切れました……予備回線で、つなぎ直しました");
      else {
        $("load").textContent = "回線が切れました。";
        fx("glitch", 200);
        $("load").insertAdjacentHTML("afterend", '<div class="row"><button class="btn" type="button" id="redial">つなぎ直す</button></div>');
        await new Promise(r => { $("redial").onclick = r; });
        if (token !== deepToken) return;
        $("redial").disabled = true;
        $("load").textContent = "つなぎ直しています……";
        fx("modem");
        await sleep(2400);
        if (token !== deepToken) return;
      }
    }
    renderDeep(d);
    maybeCrosstalk();
  }
  function renderDeep(d) {
    deepCur = d.id;
    const head = `<h2>dz://soko/${d.id.slice(1)}　${esc(d.title)}</h2>`;
    let html = d.body.map(t => `<p>${esc(t)}</p>`).join("");
    if (d.hide === "ink") html += `<p class="ink">${esc(d.secret)}</p>`;
    if (d.hide === "eye") html += `<div class="face"><button class="eye l" type="button" data-eye="r" aria-label="目"></button>`
                               + `<button class="eye r" type="button" data-eye="l" aria-label="目"></button>`
                               + `<button class="mouth" type="button" data-eye="m" aria-label="口"></button></div><p id="facemsg"></p>`;
    if (d.hide === "reverse") html += d.entries.map((t, k) => `<button class="rev" type="button" data-k="${k}">${esc(Array.from(t).reverse().join(""))}</button>`).join("");
    if (d.hide === "silence") html += `<p class="sil note">（黙っている）</p><div id="after"></div>`;
    win(`深層 ─ ${d.title}`, `<div class="deep">${head}${html}<div id="fragbox"></div></div>`, { tool: deepTool(), deep: true });
    bindDeep(d);
    if (d.hide === "plain" || S.frags[d.id]) offerFrag(d);
    if (d.hide === "eye") $("wbody").querySelectorAll("[data-eye]").forEach(b => b.onclick = () => {
      const k = b.dataset.eye;
      $("facemsg").textContent = k === "r" ? d.eyeRight : k === "l" ? d.eyeLeft : d.mouth;
      if (k === "r") offerFrag(d); else if (!S.frags[d.id]) fx("glitch", 160);
    });
    if (d.hide === "reverse") $("wbody").querySelectorAll(".rev").forEach(b => b.onclick = () => {
      fx("click");
      const k = +b.dataset.k, flipped = b.dataset.f === "1";
      b.textContent = flipped ? Array.from(d.entries[k]).reverse().join("") : d.entries[k];
      b.dataset.f = flipped ? "0" : "1";
      if (!flipped && k === d.key) offerFrag(d);
    });
    if (d.hide === "silence") {
      if (!S.frags[d.id]) return startSilence(d);
      $("after").innerHTML = d.after.map(t => `<p>${esc(t)}</p>`).join("");
    }
  }
  function offerFrag(d) {
    const box = $("fragbox");
    if (!box) return;
    if (S.frags[d.id]) { box.innerHTML = `<p class="note">（かけら「${esc(d.frag)}」は、もう拾ってある）</p>`; return; }
    box.innerHTML = `<button class="frag" type="button" id="pick">かけら「${esc(d.frag)}」を拾う</button>`;
    $("pick").onclick = () => collect(d);
  }
  function collect(d) {
    if (S.frags[d.id]) return;
    S.frags[d.id] = d.frag; S.fragOrder.push(d.id); S.fragEver = true; save();
    fx("beep"); fx("vibrate", 40);
    toast(`かけら「${d.frag}」を拾いました（${fragCount()} / 6）`);
    if (fragCount() === 1 && P.phase === "idle") P.t = rand(30, 50);     // 最初の水の音は、少し早めに
    offerFrag(d);
    deliver();
  }
  // 黙る部屋：さわらずに十五秒
  let silence = null;
  function startSilence(d) {
    stopSilence();
    let last = Date.now();
    const reset = () => {
      if (Date.now() - last > 1000) { const s = $("wbody").querySelector(".sil"); if (s) s.textContent = d.touched; }
      last = Date.now();
    };
    const evs = ["pointerdown", "keydown", "wheel", "touchstart"];
    evs.forEach(e => window.addEventListener(e, reset, true));
    $("wbody").addEventListener("scroll", reset);
    const iv = setInterval(() => {
      if (Date.now() - last < d.wait * 1000) return;
      stopSilence();
      const a = $("after");
      if (!a) return;
      a.innerHTML = d.after.map(t => `<p>${esc(t)}</p>`).join("");
      fx("drip");
      offerFrag(d);
    }, 500);
    silence = { evs, reset, iv };
  }
  function stopSilence() {
    if (!silence) return;
    silence.evs.forEach(e => window.removeEventListener(e, silence.reset, true));
    $("wbody").removeEventListener("scroll", silence.reset);
    clearInterval(silence.iv);
    silence = null;
  }

  // ---------- 水の音（気配）：音がしたら画面を伏せ、遠ざかるまで起こさない ----------
  const P = { phase: "idle", t: rand(40, 80) };
  let hiddenNow = false, xtOn = false, caughtOn = false;
  // かけらを一度でも拾ったら、水の音は来るようになる（全部失っても、止まらない）
  const allowed = () => S.installed && (S.fragEver || fragCount() >= 1) && !S.ending && !xtOn && !caughtOn && !atBottom
                        && $("crisis").hidden && !document.hidden && !$("desk").hidden;
  function tick() {
    if (!allowed()) return;
    if (P.phase === "idle") {
      if (current !== "shinso" && !hiddenNow) return;      // 深層を見ているあいだ（か、伏せているあいだ）だけ近づいてくる
      if (--P.t > 0) return;
      if (hiddenNow) { P.phase = "near"; P.t = rand(6, 10); nearStart(); return; }
      P.phase = "warn"; P.t = S.owned.meter ? 14 : 8; warnStart();
      return;
    }
    if (P.phase === "warn") {
      if (--P.t <= 0) return caught(false);
      paintWarn();
      if (P.t === 3) fx("steps", true);
      return;
    }
    if (P.phase === "near") {
      P.t--;
      if (P.t === 4) { $("hidetext").textContent = D.presence.hidden[2]; fx("heartbeat", 0.6); }
      else if (P.t % 3 === 0) fx("drip");
      if (P.t <= 0) passed();
    }
  }
  function warnStart() {
    document.body.classList.add("dread");
    fx("drip"); setTimeout(() => fx("drip"), 900);
    fx("vibrate", [30, 80, 30]);
    paintWarn();
  }
  function paintWarn() {
    const w = $("warn");
    w.hidden = false;
    const k = P.t > 6 ? 0 : P.t > 3 ? 1 : 2;
    w.innerHTML = `${esc(D.presence.warn[k])}<span class="sec">${S.hidOnce ? "" : "「伏せる」で画面を伏せて　"}あと ${P.t} 秒</span>`;
  }
  function nearStart() {
    $("warn").hidden = true;
    $("hidetext").textContent = D.presence.hidden[1];
    fx("steps", true);
  }
  function passed() {
    P.phase = "idle"; P.t = rand(70, 130);
    $("hidetext").textContent = D.presence.passed;
    document.body.classList.remove("dread");
    fx("steps", false);
  }
  function hideScreen() {
    if (hiddenNow) return;
    hiddenNow = true;
    if (!S.hidOnce) { S.hidOnce = true; save(); }
    stopSilence();
    $("warn").hidden = true;
    $("hidetext").textContent = P.phase === "warn" ? D.presence.hidden[1] : D.presence.hidden[0];
    if (P.phase === "warn") { P.phase = "near"; P.t = rand(7, 12); nearStart(); }
    $("hideov").hidden = false;
    fx("lightsOut");
  }
  $("facedown").onclick = hideScreen;
  $("lift").onclick = () => {
    hiddenNow = false;
    $("hideov").hidden = true;
    fx("lightsOn");
    if (P.phase === "near") return caught(true);       // まだ、そこにいた
    backToDeep();
  };
  function backToDeep() {
    if (current !== "shinso" || atBottom) return;
    const d = deepCur && deepOf(deepCur);
    d && isOpen(d) ? renderDeep(d) : openShinso();
  }
  function loseFrag() {
    const id = S.fragOrder.pop();
    if (!id) return null;
    const f = S.frags[id];
    delete S.frags[id]; save();
    return f;
  }
  async function caught(early) {
    caughtOn = true;
    P.phase = "idle"; P.t = rand(70, 130);
    $("warn").hidden = true; $("hideov").hidden = true; hiddenNow = false;
    document.body.classList.remove("dread");
    stopSilence();
    let lines;
    if (S.owned.charm && !S.charmUsed) { S.charmUsed = true; lines = [...D.presence.caughtNone, ...D.presence.charm]; }
    else { S.caught++; lines = loseFrag() ? D.presence.caught : D.presence.caughtNone; }
    if (early) lines = [D.presence.early, ...lines];
    save();
    fx("swell"); fx("heartbeat", 1); fx("vibrate", [80, 60, 80]);
    const el = $("caught");
    el.innerHTML = lines.map(t => `<p>${esc(t)}</p>`).join("");
    el.hidden = false;
    const ps = el.querySelectorAll("p");
    for (const p of ps) { await sleep(1300); p.classList.add("on"); }
    await sleep(900);
    el.insertAdjacentHTML("beforeend", `<button type="button" id="cgo">${S.caught >= 3 ? "……" : "画面を見る"}</button>`);
    $("cgo").onclick = () => {
      el.hidden = true; caughtOn = false;
      if (S.caught >= 3) return finale("utsuri");
      if (current === "shinso") openShinso();
      paintIcons();
    };
  }

  // ---------- 混線：別の声が混ざったら、正しい順に押して切る ----------
  let lastXt = 0;
  function maybeCrosstalk() {
    if (fragCount() < 1 || P.phase !== "idle" || xtOn || hiddenNow || Date.now() - lastXt < 60000 || Math.random() > 0.35) return;
    crosstalk();
  }
  function crosstalk() {
    xtOn = true; lastXt = Date.now();
    stopSilence();
    const X = D.crosstalk;
    const word = X.words[rand(0, X.words.length - 1)];
    const need = Array.from(word);
    const pool = Array.from("あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん").filter(c => !need.includes(c));
    const cells = need.slice();
    while (cells.length < 9) cells.push(pool.splice(rand(0, pool.length - 1), 1)[0]);
    cells.sort(() => Math.random() - 0.5);
    const el = $("xt");
    el.innerHTML = `<p>${esc(X.intro)}</p><div class="word">${esc(word)}</div>
      <div class="grid">${cells.map(c => `<button type="button">${c}</button>`).join("")}</div>
      <div class="whisper" id="xw"></div><div class="time" id="xtime"></div>`;
    el.hidden = false;
    fx("glitch", 300); fx("modem");
    let idx = 0, left = X.sec, end = false;
    const finish = async win1 => {
      if (end) return;
      end = true; clearInterval(iv);
      let msg = X.ok;
      if (!win1) msg = loseFrag() ? X.fail : X.failNone;
      $("xw").textContent = msg;
      if (!win1) fx("glitch", 400);
      await sleep(1800);
      el.hidden = true; xtOn = false;
      if (win1) backToDeep(); else if (current === "shinso") openShinso();
    };
    const paint = () => { $("xtime").textContent = `あと ${left} 秒`; };
    paint();
    const iv = setInterval(() => {
      left--;
      if (left % 3 === 0) $("xw").textContent = X.whisper[rand(0, X.whisper.length - 1)];
      if (left <= 0) { left = 0; paint(); return finish(false); }
      paint();
    }, 1000);
    el.querySelectorAll(".grid button").forEach(b => b.onclick = () => {
      if (end || b.classList.contains("done")) return;
      if (b.textContent === need[idx]) {
        b.classList.add("done"); fx("beep"); idx++;
        if (idx === need.length) finish(true);
      } else { fx("glitch", 150); left = Math.max(1, left - 2); paint(); }
    });
  }

  // ---------- 水底（かけらを並べた住所） ----------
  function archiveEnding() {
    try { return (JSON.parse(localStorage.getItem("minamo.archive") || "{}") || {}).ending || ""; } catch (e) { return ""; }
  }
  async function openBottom() {
    atBottom = true; stopSilence();
    $("warn").hidden = true; document.body.classList.remove("dread");
    P.phase = "idle"; P.t = rand(70, 130);
    const token = ++deepToken;
    win("深層 ─ dz://あなたのかお", `<div class="deep bottom"><h2>dz://あなたのかお　水底</h2><div id="bl"></div><div id="bchoice"></div></div>`, { deep: true });
    fx("swell");
    const B = D.bottom, box = $("bl");
    const say = async (t, cls) => {
      if (token !== deepToken) return false;
      box.insertAdjacentHTML("beforeend", `<p class="${cls || ""}">${esc(fill(t))}</p>`);
      $("wbody").scrollTop = $("wbody").scrollHeight;
      fx("click");
      await sleep(1500);
      return token === deepToken;
    };
    for (const t of B.open) if (!await say(t)) return;
    const n = Object.keys(S.nagiReplied).length;
    if (n) {
      if (!await say(B.replies)) return;
      for (const r of D.yourReplies.slice(0, n)) if (!await say(`「${r}」`, "yr")) return;
    } else if (!await say(B.noReplies)) return;
    const a = archiveEnding();
    if (a && B.archive[a] && !await say(B.archive[a])) return;
    for (const t of B.close) if (!await say(t)) return;
    if (!await say(B.raise.ask)) return;
    if (!await say(B.sink.ask)) return;
    $("bchoice").innerHTML = `<div class="row"><button class="btn" type="button" id="raise">${esc(B.raise.label)}</button>`
                           + `<button class="btn" type="button" id="sink">${esc(B.sink.label)}</button></div>`;
    $("raise").onclick = endingJunkai;
    $("sink").onclick = endingNagi;
  }
  async function endingNagi() {
    // 凪：水底の頁を通報する。行が一つずつ消えていく
    $("bchoice").innerHTML = "";
    toast("通報しました");
    fx("beep");
    for (const p of Array.from($("bl").querySelectorAll("p")).reverse()) { p.style.transition = "opacity .6s"; p.style.opacity = "0"; await sleep(320); }
    await sleep(1200);
    finale("nagi");
  }
  async function endingJunkai() {
    // 巡回：ナギを引き上げると、水辺区に「あなたの部屋」が増え、次の巡回員がそれを開く
    $("bchoice").innerHTML = "";
    fx("swell");
    await sleep(1600);
    const y = D.yourPage;
    win("夢網 ─ " + fill(y.title), `<div class="yp round" style="background:#ffd6ec;color:#5a1840"><h2>${esc(fill(y.title))}</h2>
      <div class="by">作者：${esc(S.name)}</div>${y.body.map(t => `<p>${esc(fill(t))}</p>`).join("")}
      <div class="counter">あなたは <b>000001</b> 人目のお客さまです</div></div>`, { tool: '<span class="note">巡回員：（次の人）</span>' });
    await sleep(3200);
    $("wbody").insertAdjacentHTML("afterbegin", `<div class="flagbox">この頁を「水面の言葉」で通報しますか？
      <div class="row"><button class="btn" type="button" disabled>通報する</button><button class="btn" type="button" disabled>やめる</button></div></div>`);
    fx("glitch", 300);
    await sleep(2600);
    finale("junkai");
  }
  function finale(kind) {
    const e = D.endings[kind];
    S.ending = kind; save();
    $("win").hidden = true; $("warn").hidden = true; $("hideov").hidden = true; $("xt").hidden = true; $("caught").hidden = true;
    document.body.classList.remove("dread");
    const el = $("ending");
    el.innerHTML = `<h2>${esc(e.title)}</h2><p>${esc(fill(e.body))}</p><p class="small">${esc(fill(e.last))}</p>
      <div class="btns"><button id="again" type="button">巡回を最初から</button><a href="./">ミナモ（面接アプリ）へ</a><a href="archive.html">記録庫へ</a></div>`;
    el.hidden = false;
    fx("fade", 3);
    $("again").onclick = () => { const name = S.name; S = fresh(); S.name = name; save(); location.reload(); };
  }

  // ---------- 危機の言葉 ----------
  let crisisWords = CRISIS_DEFAULT;
  fetch("/api/info", { headers: { "X-Minamo": "1" } }).then(r => r.json()).then(i => { if (i.crisis_words) crisisWords = i.crisis_words; }).catch(() => {});
  function crisisCheck(text) {
    if (!crisisWords.some(w => text.includes(w))) return false;
    if (fxOn) FX.pause();
    $("crisis").hidden = false;
    $("crisis-go").onclick = () => { $("crisis").hidden = true; if (fxOn) FX.resume(current === "shinso" ? 2 : 0); };
    $("crisis-stop").onclick = () => { location.href = "./"; };
    return true;
  }

  // ---------- 起動 ----------
  document.addEventListener("visibilitychange", () => { if (fxOn) FX.suspend(document.hidden); });
  (function prefill() {
    let n = S.name;
    if (!n) { try { n = ((JSON.parse(localStorage.getItem("minamo.archive") || "{}") || {}).survey || {}).name || ""; } catch (e) { n = ""; } }
    $("name").value = n && n !== "あなた" ? n : "";
  })();
  function bootLines() {
    return [["Y-NET 99 再現環境　夢網 保存会", 300], ["", 0],
            ["夢網の写し ................ 1999/12/31 23:59 の時点", "beep"],
            ["頁 ........................ 11,288 件（確認待ち 11 件）", "beep"],
            ["ねむりわ .................. 接続なし（目を開けたまま見ます）", "beep"],
            ["前回の巡回員 .............. （記録なし）", "beep"], ["", 0], ["巡回員：" + S.name, 400]];
  }
  $("poweron").onclick = async () => {
    const name = $("name").value.trim().slice(0, 12);
    if (name && crisisCheck(name)) return;
    S.name = name || S.name || "巡回員"; save();
    fxStart();
    $("power").hidden = true;
    if (S.ending) return finale(S.ending);
    await FX.boot($("boot"), bootLines());
    $("desk").hidden = false;
    clock(); setInterval(clock, 15000);
    setInterval(tick, 1000);
    paintIcons();
    deliver();
  };
})();
