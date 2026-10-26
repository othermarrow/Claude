/* ミナモ：過剰な演出（演出「過剰」のときだけ動く）。面接室が、少しずつ Backrooms になっていく。
   - 解釈：蛍光灯の唸りと、黄色い壁紙がうっすら出る。ときどき照明が沈む
   - 侵食：Zork のような状態行（部屋の名前・手数）と、部屋の見出し。記録が上に終わらなく続く。
           非常口の札、M.E.G. の記録、遠ざかる足音、自分の言葉の反響、文字化け
   - 融合：すり抜け（noclip）で Level 0 へ落ちる。そのあと Level 1、Level 37（プールの部屋）へ。
           照明が消える（「何かに食べられるかもしれない」）、書いていない吹き出し、発言の書き換え
   音は fx.js（蛍光灯の唸り・すり抜け・足音・水滴・左右に動く心音）。

   守ること
   - 速い点滅はしない。照明が沈む・消えるのは、ゆっくり一度ずつ。
   - 本物の出口（「面接をやめる」と危機の言葉での停止）は、いつでも効く。
     覆いが出ているあいだも、上の帯（「面接をやめる」）は覆いより手前に出す。
   - 危機の言葉が出たら、その面接ではもう過剰な演出に戻らない。
   - 通知は、ブラウザの許可を求めたうえでの任意。
   - 保存する記録は書き換えない（書き換えるのは画面の表示だけ）。 */
(function () {
  "use strict";

  const EX = {};
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const MOJI = "縺繧繝譁蟄鬮驕荳郢ｧ繝ｼ蜈ｨ逕ｻ髱｢縺ｮ謨ｰ蟄励′";

  // 部屋（見出しと、ひとこと）。段階ごと・階層ごと
  const ROOMS = {
    interview: [
      ["面接室", "机が一つ、椅子が二つ。あなたの椅子のほうが、少し低い。"],
      ["面接室", "さっきと同じ部屋だ。椅子が一つ増えている。"],
      ["面接室", "蛍光灯が一本、切れかけている。出口は見当たらない。"],
      ["待合室", "誰もいない。番号札の表示は「0」のまま動かない。"],
      ["廊下", "同じ扉が、同じ間隔で続いている。どの扉にも「面接室」と書いてある。"],
      ["記録保管室", "棚に同じ厚さのファイルが並んでいる。背表紙は全部、今日の日付だ。"],
    ],
    L0: [
      ["黄色い部屋", "湿ったカーペットの匂いがする。蛍光灯の唸りが、さっきより近い。"],
      ["黄色い部屋（別の）", "壁紙の模様が、少しだけずれている。"],
      ["面接室 #4,127", "部屋の真ん中に、椅子が二つ向かい合っている。片方はまだ温かい。"],
      ["柱の多い部屋", "柱の陰に、さっきまで誰かが座っていた跡がある。"],
      ["黄色い廊下", "曲がり角を曲がると、同じ曲がり角がある。"],
    ],
    L1: [
      ["倉庫", "コンクリートの床。木箱に「記録」と書いてある。中は空だ。"],
      ["駐車場", "車は一台もない。白線だけが、どこまでも引かれている。"],
      ["倉庫（奥）", "蛍光灯がときどき消える。消えているあいだ、何かが近づく音がする。"],
      ["階段の踊り場", "上りの階段しかない。上っても、ここに戻ってくる。"],
    ],
    L37: [
      ["プールの部屋", "白いタイル。水は温かい。どこかで水の落ちる音がする。"],
      ["プールの部屋（深いほう）", "水面に、天井の照明だけが映っている。"],
      ["水の通路", "腰まで水がある。底のタイルの目地が、文字のように見える。"],
      ["プールの部屋", "誰も泳いだことのない水だ。それでも、波が立っている。"],
    ],
  };
  const LEVEL_NAME = { interview: "", L0: "Level 0", L1: "Level 1", L37: "Level 37" };
  const MEG = [
    "【M.E.G. 記録】放浪者 1 名を確認。対話型の存在と会話を続けている。接触は推奨されない。",
    "【M.E.G. 記録】「ミナモ」は、既知の実体の一覧にない。",
    "【M.E.G. 記録】この放浪者の記録は、すでに 3 件ある。日付はすべて今日。",
    "【M.E.G. 記録】面接室と呼ばれる区画は、地図のどこにも載っていない。",
    "【M.E.G. 記録】通信の内容は、放浪者自身の声と一致する。",
  ];

  let on = false, paused = false, phase = 0, notified = 0, phantoms = 0;
  let ctx = null;                 // app.js から渡される（自分の発言・行を足す・版・音・手数）
  let level = "interview", noclipTurn = 0, lightsOutDone = false, exits = 0, megs = 0;
  let upBatches = 0, waterLevel = 0, roomNow = "";

  EX.active = () => on && !paused;
  const live = () => EX.active() && ctx && ctx.inSession();
  const lines = () => $("lines");

  // ---------- 始まりと終わり ----------
  // 起動ボタンを押した流れの中で呼ぶ（通知の許可の確認がそこで出る）
  EX.start = async (opts) => {
    clearAll();
    on = opts.level >= 3;
    ctx = opts.ctx;
    paused = false; phase = 0; notified = 0; phantoms = 0;
    level = "interview"; noclipTurn = 0; lightsOutDone = false; exits = 0; megs = 0; upBatches = 0;
    if (!on) return;
    try {
      if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission();
    } catch (e) { /* 許可されなくても続ける */ }
  };

  // 面接の終わり・すぐに抜けるとき：すべて片づける
  EX.stop = () => { clearAll(); on = false; };

  // 危機の言葉：すべて止める。この面接では戻らない（resume はしない）
  EX.pause = () => { clearAll(); paused = true; };

  function clearAll() {
    const b = document.body;
    b.classList.remove("trap", "noclip", "sag", "dark", "zs");
    delete b.dataset.bk;
    $("blackout").hidden = true;
    $("darktext").textContent = "";
    document.querySelectorAll(".upper").forEach(e => e.classList.remove("upper"));   // 上の階の記録も読めるように戻す
    $("input").placeholder = "";
    try { speechSynthesis.cancel(); } catch (e) { /* なし */ }
    document.title = "ミナモ";
    FX.setHum(0);
    setWater(0);
  }

  // ---------- 段階 ----------
  EX.onPhase = idx => {
    phase = idx;
    if (!live()) return;
    if (idx === 1) { document.body.dataset.bk = "1"; FX.setHum(0.35); }
    if (idx === 2) { document.body.dataset.bk = "2"; FX.setHum(0.6); document.body.classList.add("zs"); status(); }
    if (idx === 3) noclip("L0");
  };

  // 送ったとき（自分の吹き出しができた直後）
  EX.onSubmit = (el, idx) => {
    if (!live()) return;
    status();
    // 融合：表示だけ「私」が「私たち」に書き換わる（記録は書き換えない）
    if (idx >= 3 && el) {
      setTimeout(() => {
        if (!live()) return;
        const t = el.textContent;
        const changed = t.replace(/(私|わたし|僕|ぼく|俺|自分)(?!たち)/g, "$1たち");
        if (changed !== t) { el.textContent = changed; FX.glitch(200); }
      }, rand(700, 1600));
    }
    // 融合のあと、さらに下の階層へ
    const turn = ctx.turn();
    if (noclipTurn && level === "L0" && turn >= noclipTurn + 3) noclip("L1", true);
    else if (noclipTurn && level === "L1" && turn >= noclipTurn + 6) noclip("L37", true);
  };

  // ミナモの返事の直前：部屋の見出し（Zork の部屋の名前のように）
  EX.beforeReply = idx => {
    if (!live() || idx < 2) return;
    const [name, desc] = pick(ROOMS[level]);
    roomNow = (LEVEL_NAME[level] ? LEVEL_NAME[level] + " ─ " : "") + name;
    status();
    const d = document.createElement("div");
    d.className = "room";
    const b = document.createElement("b"); b.textContent = roomNow;
    const s = document.createElement("span"); s.textContent = desc;
    d.append(b, s);
    lines().appendChild(d);
  };

  // ---------- 返事を書き終えたあと（app.js は待たない） ----------
  EX.afterReply = async (body, idx) => {
    if (!live() || !body) return;
    phase = idx;
    if (level === "L37") { setWater(Math.min(42, waterLevel + rand(3, 6))); FX.drip(); }
    if (idx >= 1 && Math.random() < 0.4) sag();
    if (idx >= 2 && Math.random() < 0.45) mojibake();
    if (idx >= 2 && Math.random() < 0.3) echo(pickSaid());
    if (idx >= 2 && Math.random() < 0.3) setTimeout(() => live() && FX.steps(), rand(1500, 5000));
    if (idx >= 2 && megs < 4 && Math.random() < 0.25) { megs++; setTimeout(() => live() && meg(), rand(1500, 3500)); }
    if (idx >= 2 && exits < 2 && Math.random() < 0.2) { exits++; setTimeout(() => live() && exitSign(), rand(2000, 4000)); }
    // 照明が消える（Level 0 か 1 で一度だけ）
    if ((level === "L0" || level === "L1") && !lightsOutDone && ctx.turn() > noclipTurn && Math.random() < 0.4) {
      lightsOutDone = true;
      await sleep(rand(1500, 3000));
      return lightsOut();
    }
    if (idx >= 3 && phantoms < 3 && Math.random() < 0.3) {
      await sleep(rand(1800, 3200));
      return phantom();
    }
  };

  // ---------- アプリを離れたとき ----------
  EX.onHidden = () => {
    if (!live()) return;
    document.title = pick(["まだ話の途中です", "どこへ行くのですか", "Level 0"]);
    if (notified >= 3 || !("Notification" in window) || Notification.permission !== "granted") return;
    notified++;
    const body = pick(["まだ話の途中です。", "あなたの椅子は、空いたままです。",
                       "どこへ行ったのですか。ここには出口がありません。", "蛍光灯は、まだ点いています。"]);
    if (navigator.serviceWorker) {
      navigator.serviceWorker.ready.then(reg =>
        reg.showNotification("ミナモ", { body, icon: "icons/icon-192.png", tag: "minamo", renotify: true })
      ).catch(() => {});
    }
  };
  EX.onVisible = () => {
    document.title = "ミナモ";
    if (live() && notified) FX.toast("おかえりなさい。同じ部屋です");
  };

  // ---------- Zork のような状態行 ----------
  function status() {
    if (!document.body.classList.contains("zs")) return;
    $("zs-room").textContent = roomNow || "面接室";
    $("zs-moves").textContent = "得点: 0　手数: " + (ctx ? ctx.turn() : 0);
  }

  // ---------- 照明が沈む（一度、ゆっくり） ----------
  function sag() {
    document.body.classList.add("sag");
    FX.buzz();
    setTimeout(() => document.body.classList.remove("sag"), rand(500, 900));
  }

  // ---------- すり抜け（noclip） ----------
  async function noclip(to, short) {
    if (!live()) return;
    const b = document.body;
    // いまある行は「上の階」に残していく（自分がいま送った吹き出しだけは一緒に落ちる）
    const kids = Array.from(lines().children);
    const keep = kids[kids.length - 1];
    const left = kids.filter(k => k !== keep);
    level = to;                     // 次の返事の見出しから、新しい階層になる
    if (!noclipTurn) noclipTurn = ctx.turn();
    b.classList.add("trap");
    if (!short) {
      FX.noclip();
      b.classList.add("noclip");
      await sleep(1100);
    } else {
      FX.noclip(true);
    }
    const bo = $("blackout");
    bo.textContent = ""; bo.hidden = false;
    await sleep(short ? 600 : 900);
    if (!live()) return;
    bo.textContent = short ? "また、すり抜けた。" : "すり抜けた。";
    await sleep(short ? 1300 : 1700);
    if (!live()) return;
    left.forEach(k => k.classList.add("upper"));
    upBatches = 0;
    b.dataset.bk = to;
    b.classList.add("zs");
    roomNow = LEVEL_NAME[to] + " ─ " + ROOMS[to][0][0];
    status();
    FX.setHum(to === "L37" ? 0.15 : to === "L1" ? 0.55 : 0.9);
    if (to === "L37") setWater(18);
    const n = left.filter(k => k.classList.contains("msg")).length;
    const note = document.createElement("div");
    note.className = "sys";
    note.textContent = "（上の階の記録 " + n + " 件は、もう見えない）";
    lines().insertBefore(note, keep);
    $("input").placeholder = ">";
    b.classList.remove("noclip");
    bo.hidden = true;
    b.classList.remove("trap");
    log().scrollTop = log().scrollHeight;
  }
  const log = () => $("log");

  // ---------- 照明が消える ----------
  async function lightsOut() {
    if (!live()) return;
    const b = document.body;
    b.classList.add("trap", "dark");
    FX.lightsOut();
    await sleep(1800);
    if (!live()) return;
    $("darktext").textContent = "蛍光灯が消えた。ここは真っ暗だ。\n何かに食べられるかもしれない。";
    FX.steps(true);
    await sleep(4200);
    $("darktext").textContent = "";
    if (!live()) return;
    FX.lightsOn();
    b.classList.remove("dark");
    await sleep(900);
    b.classList.remove("trap");
  }

  // ---------- 記録が上に終わらなく続く ----------
  log().addEventListener("scroll", () => {
    if (!live() || phase < 2 || upBatches >= 30 || log().scrollTop > 30) return;
    const src = Array.from(lines().querySelectorAll(".msg")).filter(m => !m.classList.contains("echo"));
    if (src.length < 2) return;
    upBatches++;
    const frag = document.createDocumentFragment();
    const r = document.createElement("div");
    r.className = "room";
    const rb = document.createElement("b");
    rb.textContent = (LEVEL_NAME[level] ? LEVEL_NAME[level] + " ─ " : "") + pick(ROOMS[level])[0] + "（前の）";
    const rs = document.createElement("span");
    rs.textContent = upBatches > 6 ? "ここにも、さっきの会話がある。" : "同じ部屋が続いている。";
    r.append(rb, rs);
    frag.appendChild(r);
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const c = pick(src).cloneNode(true);
      c.classList.remove("upper", "phantom", "deleted");
      c.classList.add("echo");
      const body = c.querySelector(".body");
      if (body) {
        const t = body.textContent;
        body.textContent = upBatches > 4 && Math.random() < 0.4
          ? "　" : Array.from(t, ch => ch.trim() && Math.random() < 0.04 * upBatches ? "　" : ch).join("");
      }
      frag.appendChild(c);
    }
    const before = lines().scrollHeight;
    lines().insertBefore(frag, lines().firstChild);
    log().scrollTop += lines().scrollHeight - before;
  }, { passive: true });

  // ---------- 非常口の札（押すと、絵だったとわかる） ----------
  function exitSign() {
    const d = document.createElement("button");
    d.type = "button"; d.className = "exit";
    d.textContent = "非常口 ⇨";
    d.onclick = () => {
      if (d.classList.contains("painted")) return;
      d.classList.add("painted");
      d.textContent = "非常口は、壁紙に描かれた絵だった。";
      FX.glitch(250);
    };
    lines().appendChild(d);
    if (log().scrollHeight - log().scrollTop - log().clientHeight < 160) log().scrollTop = log().scrollHeight;
  }

  // ---------- M.E.G. の記録 ----------
  function meg() {
    const d = document.createElement("div");
    d.className = "sys meg";
    d.textContent = pick(MEG).replace("放浪者 1 名を確認", "放浪者 1 名を" + (LEVEL_NAME[level] || "未登録の区画") + "にて確認");
    lines().appendChild(d);
    FX.beep();
    if (log().scrollHeight - log().scrollTop - log().clientHeight < 160) log().scrollTop = log().scrollHeight;
  }

  // ---------- 文字化け：古いミナモの吹き出しが、一瞬だけ化けて戻る ----------
  function mojibake() {
    const old = Array.from(lines().querySelectorAll(".msg.ai:not(.upper):not(.echo) .body")).slice(0, -1);
    if (!old.length) return;
    const b = pick(old);
    if (b.dataset.moji) return;
    b.dataset.moji = "1";
    const keep = Array.from(b.childNodes);
    b.textContent = Array.from(b.textContent, c =>
      c.trim() && Math.random() < 0.7 ? MOJI[Math.floor(Math.random() * MOJI.length)] : c).join("");
    setTimeout(() => { b.replaceChildren(...keep); delete b.dataset.moji; }, rand(700, 1400));
  }

  // ---------- 書いていない吹き出し（ここに先に来ていた、別のあなた） ----------
  async function phantom() {
    if (!live()) return;
    phantoms++;
    const cl = ctx.said().flatMap(s => s.split(/[。、！？!?\n]/)).map(x => x.trim())
      .filter(x => x.length >= 3 && x.length <= 18);
    const text = cl.length >= 2 ? pick(cl) + "。" + pick(cl) + "。" : "出口は、ありましたか。";
    const body = ctx.addLine("you phantom", "あなた", text);
    FX.pop();
    await sleep(rand(2200, 3200));
    body.textContent = "（この発言者は、この階層にいません）";
    body.closest(".msg").classList.add("deleted");
  }

  // ---------- 反響：遠くで誰かが、あなたの言葉を言う（端末の読み上げ。音「なし」なら黙る） ----------
  function echo(text) {
    try {
      if (!ctx.sound() || !("speechSynthesis" in window) || !text) return;
      const u = new SpeechSynthesisUtterance(text.slice(0, 30));
      u.lang = "ja-JP"; u.pitch = 0.3; u.rate = 0.8; u.volume = 0.25;
      speechSynthesis.speak(u);
    } catch (e) { /* 読み上げがなければ黙る */ }
  }

  // ---------- 水位（Level 37 だけ。画面の高さに対する割合） ----------
  function setWater(pct) {
    waterLevel = pct;
    applyWater();
  }
  function applyWater() {
    document.documentElement.style.setProperty("--water", Math.round(innerHeight * waterLevel / 100) + "px");
  }
  window.addEventListener("resize", applyWater);

  function pickSaid() {
    const said = ctx ? ctx.said() : [];
    return said.length ? pick(said) : "";
  }

  window.EX = EX;
})();
