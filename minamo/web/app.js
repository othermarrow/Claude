/* ミナモ（PWA 版）の画面。
   会話の進め方は minamo.py の Session と同じ。API へはサーバー（server.py）を通して送る。
   画面版だけの観測：書きかけて消した文字数、画面を離れていた時間、前回の面接。
   演出は fx.js（window.FX）。演出「過剰」のときだけ excess.js（window.EX）も動く。
   版：2026（今どきの AI チャット。解析・記憶・予測）と 1996（ブラウン管の旧式端末）。 */
(function () {
  "use strict";

  const AI = "ミナモ", YOU = "あなた";
  const TITLES = {
    "1996": ["SOMA 対話支援システム ver.0.9.7", "SOMA 対話支援システム ─ 記録中", "ミナモ ─ 記録中", "わたしたち"],
    "2026": ["ミナモ", "ミナモ ・ 解析中", "ミナモ ・ 照合中", "わたしたち"],
  };
  const PHASE_TOAST = {
    "1996": [null, null, "記録の照合を始めます", "記録者を変更しました"],
    "2026": [null, "会話の解析を開始しました", "過去のデータとの照合を開始しました", "モデルの学習が完了しました"],
  };
  const $ = id => document.getElementById(id);
  const lines = $("lines"), log = $("log"), input = $("input"), send = $("send"),
        label = $("label"), form = $("form");

  const BUILD = "minamo-v41";   // sw.js の VERSION と同じ（サーバーのファイルと食い違えば、画面が古いまま）
  let cfg = null;               // /api/info
  let S = null;                 // 面接の状態
  let booted = false;

  // ---------- 端末に残すもの（設定・前回の面接） ----------
  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 保存できなくても続ける */ }
  }
  // ---------- 面接の続き（Termux のサーバーが落ちた・アプリを閉じたあとも、同じ面接に戻れる） ----------
  // 面接のあいだ、途中経過をこの端末（ブラウザ）に残す。つなぎ直したら、起動画面の「前の面接を続ける」で、
  // 同じ会話・同じ段階・同じ階層から、同じミナモと話せる（会話はこの端末が持っていて、AI には毎回全部送るため）。
  const LIVE_KEY = "minamo.live", LIVE_HOURS = 12, UNSAVED_KEY = "minamo.unsaved";
  const drop = key => { try { localStorage.removeItem(key); } catch (e) { /* なし */ } };
  function saveLive() {
    if (!S || S.done || !S.contents.length) return;
    store(LIVE_KEY, {
      at: Date.now(), started: S.started.toISOString(),
      settings: { version: settings.version, horror: settings.horror, level: settings.level, count: settings.count,
                  outside: settings.outside, offline: settings.offline },
      contents: S.contents, log: S.log, latencies: S.latencies, turn: S.turn, tricks: S.tricks.slice(-6), noted: S.noted,
      phaseIdx: S.phaseIdx, hrs: S.hrs.slice(-60),
      ex: window.EX && EX.snapshot ? EX.snapshot() : null,
    });
  }
  function readLive() {
    const v = load(LIVE_KEY, null);
    if (!v || !Array.isArray(v.contents) || !v.contents.length || !Array.isArray(v.log)) return null;
    if (Date.now() - v.at > LIVE_HOURS * 3600000) { drop(LIVE_KEY); return null; }
    return v;
  }
  const agoText = ms => { const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? m + "分前" : Math.round(m / 60) + "時間前"; };
  // 面接を終えたときにサーバーが落ちていて、記録を保存できなかったら、端末に残しておき、つながったときに保存する
  async function flushUnsaved() {
    const u = load(UNSAVED_KEY, null);
    if (!u || !u.markdown) return "";
    try { const r = await api("/api/record", { markdown: u.markdown }); drop(UNSAVED_KEY); return r.path || ""; }
    catch (e) { return ""; }
  }

  const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const settings = load("minamo.fx", { level: reduced ? 0 : 2, sound: true });
  settings.count = !!settings.count;     // 沈黙の秒数を数えるか（既定：数えない）
  settings.version = settings.version === "1996" ? "1996" : "2026";
  settings.offline = !!settings.offline; // 端末内モデルだけで話すか
  settings.horror = [0, 1, 2, 3].includes(settings.horror) ? settings.horror : 3;   // 怖さ（段階の上限）
  settings.outside = settings.outside !== false;   // 画面の外（書き置き・部屋の様子・あとから届く通知）
  settings.length = ["auto", "short", "normal", "long"].includes(settings.length) ? settings.length : "auto";   // 返事の長さ
  settings.ai = settings.ai || "";       // 使う AI（"backend|model"。空なら自動＝速い順）

  // 部屋の様子（Termux:API は要らない。ブラウザが読めるものだけ）：
  // 端末の向き（置いている・手に持っている・寝転んで掲げている）・揺れ（その回の最大の揺れ）・電池の残り・充電中か・回線
  const room = { pose: "", charging: null, battery: null, jerk: 0, last: null };
  window.addEventListener("deviceorientation", e => {
    if (e.beta == null) return;
    const b = Math.abs(e.beta), g = Math.abs(e.gamma || 0);
    room.pose = b < 20 && g < 20 ? "flat" : b > 120 ? "lying" : "hand";
  });
  window.addEventListener("devicemotion", e => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    if (room.last) room.jerk = Math.max(room.jerk, Math.abs(a.x - room.last.x) + Math.abs(a.y - room.last.y) + Math.abs(a.z - room.last.z));
    room.last = { x: a.x, y: a.y, z: a.z };
  });
  const motionWord = () => {
    if (!room.last) return "";
    const j = room.jerk;
    room.jerk = 0;
    return j < 0.3 ? "still" : j > 6 ? "shake" : room.pose !== "flat" && j > 0.8 ? "tremble" : "";
  };
  if (navigator.getBattery) {
    navigator.getBattery().then(bt => {
      const up = () => { room.charging = bt.charging; room.battery = Math.round(bt.level * 100); };
      up(); bt.addEventListener("chargingchange", up); bt.addEventListener("levelchange", up);
    }).catch(() => {});
  }
  const netType = () => (navigator.connection && navigator.connection.type) || "";
  const is2026 = () => settings.version === "2026";
  // 返事の長さ（起動画面の「長さ」。観測メモで AI に伝える）
  const LENGTH_MEMO = {
    auto: "ふだんは1〜3文、60字くらいまでと短く。相手が長く書いたとき・自分のことを深く話したとき・段階が変わったときだけ、4〜6文で語ってよい",
    short: "1〜2文、全部で50字くらいまで。短く切る",
    normal: "2〜4文",
    long: "4〜7文。じっくり、語りかけるように",
  };
  const MODE_NOTE = {
    cloud: "回線が戻りました。",
    local: "回線が切れました。端末の中のミナモが応答します。",
    "1996": "回線が切れました。1996 年の本体が応答します。",
    "2026": "回線が切れました。端末内モデル ミナモ 2026 が応答します。",
  };

  // ---------- サーバー ----------
  async function api(path, body) {
    const opt = { headers: { "X-Minamo": "1" } };
    if (body !== undefined) {
      opt.method = "POST";
      opt.headers["Content-Type"] = "application/json";
      opt.body = JSON.stringify(body);
    }
    const res = await fetch(path, opt);
    let data = {};
    try { data = await res.json(); } catch (e) { /* 空 */ }
    if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
    return data;
  }

  // ---------- 手首（腕時計 minamo-watch から、Zepp アプリを通って届く。wrist.py） ----------
  // つながっていなければ、何も変わらない。怖さ「なし」では、手首のことは言わない
  const WRIST = { linked: false, obs: {}, taps: {}, labels: {}, words: [], said: "", turnHr: null, away: [], boot: {} };
  async function pollWrist() {
    try {
      const w = await api("/api/watch");
      WRIST.linked = !!w.linked; WRIST.obs = w.obs || {}; WRIST.taps = w.taps || {}; WRIST.said = w.said || "";
      WRIST.labels = w.labels || {}; WRIST.words = w.words || []; WRIST.away = w.away || []; WRIST.boot = w.boot || {};
      if (WRIST.linked && WRIST.obs.hr && S && !S.done) S.hrs.push(WRIST.obs.hr);
    } catch (e) { WRIST.linked = false; }
    paintWrist();
  }
  function paintWrist() {
    const el = $("wrist");
    if (!el) return;
    el.hidden = !(WRIST.linked && settings.horror >= 1);
    if (el.hidden) return;
    const hr = WRIST.obs.hr, off = WRIST.obs.worn === 0;
    let t = off ? "⌚ ―" : "⌚ ♥" + (hr || "…");
    // 侵食から：ときどき、脈が二つ数えられている
    if (!off && hr && S && !S.done && cfg && phaseIdx() >= 2 && Math.random() < 0.3)
      t += "／" + (hr + (Math.random() < 0.5 ? 1 : -1) * Math.round(rand(1, 4)));
    el.textContent = t;
    el.classList.toggle("off", off);
  }
  setInterval(pollWrist, 12000);
  pollWrist();
  // 観測メモに足す一行（現実の危機・終わりの合図のときは足さない）
  function wristLine(idx) {
    if (!WRIST.linked || settings.horror < 1) return "";
    const o = WRIST.obs, P = [];
    if (o.worn === 0) P.push("時計を外している（さっきまでつけていた）");
    if (o.hr) {
      P.push("脈 " + o.hr + (WRIST.turnHr && WRIST.turnHr !== o.hr ? "（前の発言のときは " + WRIST.turnHr + "）" : ""));
      WRIST.turnHr = o.hr;
    }
    // 睡眠・ストレス・血中酸素・温度・揺れ・明るさ・歩数など（サーバーが言葉にしたもの）は、解釈の段階から
    if (idx >= 1) WRIST.words.filter(w => !/^脈 |^時計を外している|^年齢/.test(w)).forEach(w => P.push(w));
    if (idx >= 1 && o.battery && o.battery < 30) P.push("時計の電池 " + o.battery + "%");
    if (idx >= 1 && WRIST.taps.fear) P.push("時計の上の minamo に『こわい』を" + WRIST.taps.fear + "回押した");
    const other = Object.entries(WRIST.taps).filter(([k]) => k !== "fear").sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (idx >= 1 && other.length) P.push("時計で押したほかのボタン「" + other.map(([k, n]) => (WRIST.labels[k] || k) + "」" + n + "回").join("・「"));
    if (idx >= 2 && WRIST.said) P.push("時計の上の minamo（あなたとは別の、小さな子）は『" + WRIST.said + "』と言った");
    // サーバー（mo）が止まっていたあいだに、時計で押したボタン（つながったときにまとめて届いた）。一度だけ伝える
    if (idx >= 1) {
      let seen = 0;
      try { seen = Number(localStorage.getItem("minamo.awaySeen") || 0); } catch (e) { /* なし */ }
      const fresh = WRIST.away.filter(a => a.t > seen).slice(-5);
      if (fresh.length) {
        const hm = t => { const d = new Date(t); return d.getHours() + "時" + String(d.getMinutes()).padStart(2, "0") + "分"; };
        P.push("この面接室（サーバー）が止まっていたあいだに、相手は時計の minamo に「" + fresh.map(a => hm(a.t) + "『" + a.label + "』").join("、") +
               "」と押していた（minamo があとから届けてきた。あなたは、それを記録として受け取った）");
        try { localStorage.setItem("minamo.awaySeen", String(fresh[fresh.length - 1].t)); } catch (e) { /* なし */ }
      }
    }
    return P.length ? "手首（腕時計から届いた、いまの値。ときどき、さりげなく言い当てる。数字を毎回は言わない）: " + P.join("、") : "";
  }
  // ---------- スマホの感覚（予定・居場所・天気・通知。senses.py が 3 分おきに読む） ----------
  // 怖さ「弱」以上で。導入では居場所と次の予定の時刻だけ（題名なし）、解釈からは予定の題名・天気・通知も
  const PHONE = { words: [], brief: [] };
  async function pollPhone() {
    try { const p = await api("/api/senses"); PHONE.words = p.words || []; PHONE.brief = p.brief || []; } catch (e) { /* なし */ }
  }
  setInterval(pollPhone, 60000);
  pollPhone();
  function phoneLine(idx) {
    if (settings.horror < 1) return "";
    const w = idx >= 1 ? PHONE.words : PHONE.brief;
    return w.length ? "スマホから読み取れたこと（予定・居場所・天気・通知。ときどき一つだけ、知っているはずのないこととして言い当てる。毎回は言わない。予定の題名や通知の中身を全部は読み上げない）: " + w.join("、") : "";
  }
  // 侵食から：ミナモが話し終えたあと、あなたの本当の脈の速さで、心音が鳴る
  function wristBeat() {
    const hr = WRIST.obs.hr;
    if (!WRIST.linked || !hr || settings.horror < 2 || phaseIdx() < 2) return;
    let n = Math.round(rand(6, 10));
    const gap = 60000 / hr, idx = phaseIdx();
    const tick = () => { if (!S || S.done || n-- <= 0) return; FX.heartbeat(0.2 + 0.1 * idx); setTimeout(tick, gap); };
    setTimeout(tick, 1200);
  }

  // ---------- 画面 ----------
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  const toBottom = () => { log.scrollTop = log.scrollHeight; };
  // キーボードが出る・予測の帯が増える（会話の欄が縮む）ときも、いちばん下を見ていたなら、最新の発言が隠れないように追いかける
  let atBottom = true;
  log.addEventListener("scroll", () => { atBottom = nearBottom(); }, { passive: true });
  if (window.ResizeObserver) new ResizeObserver(() => { if (atBottom) toBottom(); }).observe(log);
  if (window.visualViewport) visualViewport.addEventListener("resize", () => { if (atBottom) setTimeout(toBottom, 60); });
  input.addEventListener("focus", () => { if (atBottom) setTimeout(toBottom, 250); });
  const pad = n => String(n).padStart(2, "0");

  function addLine(cls, who, text) {
    const d = document.createElement("div");
    d.className = "msg " + cls;
    if (who) {
      const w = document.createElement("span");
      w.className = "who"; w.textContent = who;
      d.appendChild(w);
    }
    const b = document.createElement("span");
    b.className = "body"; b.textContent = text || "";
    d.appendChild(b);
    const m = document.createElement("span");
    m.className = "meta"; m.textContent = stamp(cls);
    d.appendChild(m);
    lines.appendChild(d);
    toBottom();
    return b;
  }

  function stamp(cls) {
    const now = new Date();
    if (S && cfg && cls === "ai" && phaseIdx() >= 3 && Math.random() < 0.6) {
      if (Math.random() < 0.4) return "--:--";
      now.setMinutes(now.getMinutes() + Math.floor(rand(1, 9)));   // まだ来ていない時刻
    }
    return pad(now.getHours()) + ":" + pad(now.getMinutes());
  }

  function sysLine(text) {
    const d = document.createElement("div");
    d.className = "sys"; d.textContent = text;
    lines.appendChild(d); toBottom();
    return d;
  }

  // 融合：ミナモの文の文字が、いくつか震えだす
  function jitter(body) {
    if (FX.level() === 0) return;
    const t = body.textContent, n = Math.min(6, Math.floor(t.length / 25) + 1);
    const marks = new Set();
    for (let i = 0; i < n; i++) marks.add(Math.floor(rand(0, t.length)));
    body.textContent = "";
    let buf = "";
    for (let i = 0; i < t.length; i++) {
      if (marks.has(i) && t[i].trim()) {
        if (buf) { body.append(buf); buf = ""; }
        const s = document.createElement("span"); s.className = "jit"; s.textContent = t[i];
        body.append(s);
      } else buf += t[i];
    }
    if (buf) body.append(buf);
  }

  // 1文字ずつ印字する。opts.body に書き込み先、opts.quiet で演出なし
  async function typeOut(text, ph, opts) {
    opts = opts || {};
    const idx = cfg.phases.indexOf(ph);
    const body = opts.body || addLine("ai", AI, "");
    const box = body.closest(".msg");
    const v26 = is2026(), sess = S;
    const fx = !opts.quiet && (!v26 || idx >= 2);       // 2026 は侵食まで整ったまま
    const delay = ph.delay * 1000 * (v26 && idx < 2 ? 0.45 : 1);
    if (v26 && !opts.quiet) opts.silent = true;
    body.classList.add("cursor");
    if (fx && idx >= 1 && Math.random() < 0.35) FX.glitch(200);
    for (const part of text.split(/(\[間\])/)) {
      if (part === "[間]") {
        if (!opts.quiet) {
          if (fx) FX.ripple();
          if (idx >= 2) FX.vibrate(30);
          if (!settings.count && idx >= 1) FX.heartbeat(0.3 + 0.15 * idx);
        }
        await sleep(rand(2000, 3500));
        continue;
      }
      for (let i = 0; i < part.length; i++) {
        if (!opts.quiet && sess && sess.done) break;     // 「面接をやめる」が押された
        // 融合：「あなた」と打つ前に、一度「わたし」と打って消す
        if (fx && idx >= 3 && FX.level() >= 1 && part.startsWith("あなた", i) && Math.random() < 0.35) {
          for (const c of "わたし") { body.textContent += c; FX.click(); await sleep(delay * 2.5); }
          await sleep(rand(600, 1000));
          for (let k = 0; k < 3; k++) { body.textContent = body.textContent.slice(0, -1); await sleep(110); }
          await sleep(300);
        }
        const ch = part[i], stick = nearBottom();
        body.textContent += ch;
        if (stick) toBottom();
        if (!opts.silent && ch.trim() && !"。、…".includes(ch)) FX.click();
        if ("。？！?!".includes(ch)) await sleep(delay * 8);
        else if ("、…".includes(ch)) await sleep(delay * 4);
        else await sleep(delay * rand(0.6, 1.4));
        if ("、。".includes(ch) && Math.random() < ph.stall) await sleep(rand(1200, 3000));
      }
    }
    body.classList.remove("cursor");
    if (fx && idx >= 3) {
      jitter(body);
      if (Math.random() < 0.3) FX.mirror(box);
    }
    return body;
  }

  // 侵食から：過去の自分の発言が、少しずつ書き換えられていく
  function corruptHistory(idx) {
    if (FX.level() === 0) return;
    const old = Array.from(lines.querySelectorAll(".msg.you")).slice(0, -1);
    if (!old.length) return;
    if (idx >= 2) {
      const el = pick(old).querySelector(".body");
      const t = el.textContent;
      if (!el.dataset.cut && t.length >= 4) {
        const len = Math.min(t.length - 1, Math.floor(rand(2, 7)));
        const at = Math.floor(rand(0, t.length - len));
        const s = document.createElement("s"); s.className = "strike"; s.textContent = t.slice(at, at + len);
        const a = document.createElement("span"); a.className = "annot"; a.textContent = "（抹消）";
        el.textContent = "";
        el.append(t.slice(0, at), s, t.slice(at + len), a);
        el.dataset.cut = "1";
      }
    }
    if (idx >= 3) {
      old.forEach(m => {
        const w = m.querySelector(".who");
        if (w && Math.random() < 0.5) {
          w.textContent = Math.random() < 0.5 ? AI : "わたしたち";
          if (is2026()) m.classList.add("swap");
        }
      });
    }
  }

  // 過剰の演出（excess.js）に渡すもの
  const exCtx = {
    said: () => S ? S.log.filter(x => x[0] === YOU).map(x => x[1]) : [],
    addLine: (cls, who, text) => addLine(cls, who, text),
    sysLine: text => sysLine(text),
    inSession: () => !!(S && !S.done),
    version: () => settings.version,
    sound: () => settings.sound,
    turn: () => S ? S.turn : 0,
    room: () => ({ pose: room.pose, charging: room.charging, battery: room.battery }),   // 見出しに、あなたの部屋を混ぜる
    env: () => (cfg && cfg.env) || {},                                                   // M.E.G. の生存者記録（機種・ユーザー名）
  };

  // ---------- 面接 ----------
  function newSession() {
    return {
      contents: [], log: [], latencies: [], turn: 0, tricks: [], noted: {}, pending: [], room: [],
      started: new Date(), unprompted: 0, busy: false, done: false, phaseIdx: 0,
      t0: 0, erased: 0, prevValue: "", lastInput: 0, away: 0, hiddenAt: 0, silenceTimer: 0,
      nextBeat: 0, ghosted: false, ghost: null, predict: [], hrs: [],
      mode: settings.offline ? settings.version : (cfg.mode || "cloud"),
    };
  }

  // 怖さの設定で、段階の進み方と行き止まりが変わる（minamo.horror_phase と同じ）
  function phase() {
    const hl = (cfg.horror_levels || [])[settings.horror];
    let k = 0;
    if (hl && hl.turns) hl.turns.forEach((t, i) => { if (S.turn >= t) k = i; });
    else { cfg.phases.forEach((ph, i) => { if (S.turn >= ph.turn) k = i; }); k = Math.min(k, settings.horror); }
    return cfg.phases[k];
  }
  // 今回の仕掛け（minamo.pick_trick と同じ。続けて同じものは選ばない）
  function pickTrick(idx, hl) {
    const pools = cfg.horror_tricks;
    if (!pools || !pools[idx] || Math.random() >= (hl.trick || 0) || (idx === 0 && settings.horror < 3)) return "";
    const recent = S.tricks.slice(-2);
    const pool = pools[idx].filter(t => !recent.includes(t));
    const t = pick(pool.length ? pool : pools[idx]);
    S.tricks.push(t);
    return t;
  }
  const phaseIdx = () => cfg.phases.indexOf(phase());

  function enterPhase(idx) {
    if (idx === S.phaseIdx) return;
    S.phaseIdx = idx;
    FX.setPhase(idx);
    EX.onPhase(idx);
    $("title").textContent = TITLES[settings.version][idx];
    if (idx >= 1 && (!is2026() || idx >= 2)) { FX.swell(); FX.glitch(450); }
    const t = PHASE_TOAST[settings.version][idx];
    if (t) FX.toast(t);
  }

  // 時間帯（朝 5〜10 時・昼 10〜17 時・夕方 17〜21 時・夜 21〜5 時）
  const todOf = h => (h >= 5 && h < 10 ? "morning" : h >= 10 && h < 17 ? "day" : h >= 17 && h < 21 ? "evening" : "night");
  const TOD_MEMO = { morning: "朝（これから一日が始まる。夜の話ばかりにしない）", day: "昼（相手は職場や仕事の途中かもしれない。夜の話ばかりにしない）",
                     evening: "夕方（相手は仕事帰りかもしれない。夜の話ばかりにしない）", night: "夜" };
  const todMemo = h => TOD_MEMO[todOf(h)];

  function memo(o) {
    o = o || {};
    const ph = phase(), idx = cfg.phases.indexOf(ph), now = new Date(), env = cfg.env || {};
    const L = ["- 面接段階: " + ph.name + "（" + (idx + 1) + "/4）、" + S.turn + "回目"];
    L.push("- 時間帯: " + todMemo(now.getHours()));      // 夜の話ばかりにならないように（kaiwa.TOD_MEMO と同じ）
    L.push("- 返事の長さ: " + LENGTH_MEMO[settings.length]);
    if (o.latency != null && settings.count) {
      const avg = S.latencies.reduce((a, b) => a + b, 0) / S.latencies.length;
      L.push("- 返答までの時間: " + o.latency.toFixed(1) + "秒（これまでの平均 " + avg.toFixed(1) + "秒）");
    }
    if (o.chars != null) L.push("- 入力した文字数: " + o.chars);
    if (o.erased) L.push("- 書きかけて消した文字数: " + o.erased);
    if (o.away) L.push(settings.count ? "- 返答の途中で、この画面を" + Math.round(o.away) + "秒間離れていた"
                                      : "- 返答の途中で、この画面を一度離れていた");
    if (idx >= 1) {
      const min = Math.floor((now - S.started) / 60000);
      L.push("- 現在時刻: " + pad(now.getHours()) + "時" + pad(now.getMinutes()) + "分（面接開始から" + min + "分）");
    }
    if (idx >= 2 && env.user) L.push("- 端末のユーザー名: " + env.user);
    if (idx >= 2 && env.model) L.push("- 端末の機種: " + env.model);
    if (idx >= 3 && env.battery) L.push("- 端末の電池: " + env.battery);
    const hl = (cfg.horror_levels || [])[settings.horror];
    if (hl && hl.memo) L.push("- " + hl.memo);
    // 危機の言葉・終わりの合図のときは、仕掛けを入れない
    if (hl && !(o.extra && /現実の危機|終了を告げた/.test(o.extra))) {
      const trick = pickTrick(idx, hl);
      if (trick) L.push("- 今回の仕掛け: " + trick + (cfg.trick_note || ""));
    }
    if (outsideOn() && idx >= 1) { S.room.forEach(x => L.push("- " + x)); S.room = []; }
    if (S.pending.length) { S.pending.forEach(x => L.push("- " + x)); S.pending = []; }
    const wl = o.extra && /現実の危機|終了を告げた/.test(o.extra) ? "" : wristLine(idx);
    if (wl) L.push("- " + wl);
    const pl = o.extra && /現実の危機|終了を告げた/.test(o.extra) ? "" : phoneLine(idx);
    if (pl) L.push("- " + pl);
    if (window.BLEED && !(o.extra && /現実の危機|終了を告げた/.test(o.extra))) {
      BLEED.memo(idx, settings.horror).forEach(x => L.push("- " + x));   // 物語「水面の記録」から漏れ出す
    }
    if (o.extra) L.push("- " + o.extra);
    return "【観測メモ】\n" + L.join("\n");
  }

  // サーバーが戻るまで待つ（1 秒ごとに数え、3 秒ごとに確かめる）。戻ったら true。面接が終わったら false。
  async function waitServer(sess) {
    const note = document.createElement("div");
    note.className = "sys"; note.style.whiteSpace = "pre-wrap";
    lines.appendChild(note); toBottom();
    FX.toast("つながりません");
    const t0 = Date.now();
    for (let n = 0; ; n++) {
      if (sess.done || S !== sess) { note.remove(); return false; }
      note.textContent = "サーバーにつながりません。つながるまで待っています……（" + Math.round((Date.now() - t0) / 1000) + "秒）\n" +
                         "Termux で mo を動かすと、この面接を、続きから話します（会話はこの端末に残っています）。";
      if (n % 3 === 2) {
        try { cfg = await api("/api/info"); note.textContent = "つながりました。同じ面接を、続けます。"; FX.pop(true); return true; }
        catch (e) { /* まだ */ }
      }
      await sleep(1000);
    }
  }

  async function speak(userText, findings, libQuery) {
    S.busy = true; setInput(false);
    if (userText) { S.contents.push({ role: "user", parts: [{ text: userText }] }); saveLive(); }
    const rec = document.createElement("div");
    rec.className = "recording"; rec.textContent = "（記録中）";
    const dots = document.createElement("div");
    dots.className = "typing"; dots.innerHTML = "<i></i><i></i><i></i>";
    lines.append(rec, dots); toBottom();
    const sess = S;
    let reply, events = [];
    try {
      let res;
      for (;;) {
        try {
          res = await api("/api/ask", {
            contents: S.contents, findings: !!findings,
            lib_query: libQuery || "", phase: phaseIdx(), horror: settings.horror,
            version: settings.version, offline: settings.offline,
          });
          break;
        } catch (e) {
          // サーバーに届かなかった（Termux が落ちた）：面接は閉じない。つながるのを待って、同じ発言をもう一度送る。
          // 面接を終えるときの所見は、待たない
          if (!(e instanceof TypeError) || findings || sess.done) throw e;
          rec.style.display = dots.style.display = "none";
          const back = await waitServer(sess);
          rec.style.display = dots.style.display = "";
          if (!back) throw e;
        }
      }
      reply = res.text;
      events = res.events || [];
      noteMode(res.mode);
    } catch (e) {
      rec.remove(); dots.remove();
      if (userText) S.contents.pop();
      const down = e instanceof TypeError;    // サーバーに届かなかった
      sysLine("[通信の不調] " + e.message + "\n" + (down
        ? "Termux でサーバー（mo）が動いているか確かめてください。"
        : "API がエラーを返しました。Termux の画面にも理由が出ています。"));
      S.busy = false;
      if (!S.done) setInput(true);
      return null;
    }
    if (sess.done && !findings) { rec.remove(); dots.remove(); return null; }
    rec.remove();
    if (is2026()) {
      markRead();
      await sleep(rand(500, 1400));                      // 考えているふり
    }
    dots.remove();
    if (findings) { S.busy = false; return reply || ""; }
    if (!reply) reply = "……[間] 申し訳ありません。いまの記録の一部が、欠落しています。";
    S.contents.push({ role: "model", parts: [{ text: reply }] });
    S.log.push([AI, reply]);
    saveLive();
    handleEvents(events, "before");
    if (is2026()) FX.pop();
    EX.beforeReply(phaseIdx());
    const body = await typeOut(reply, phase());
    if (sess !== S || sess.done) return reply;
    handleEvents(events, "after", body);
    S.busy = false;
    if (!S.done) {
      setInput(true);
      EX.afterReply(body, phaseIdx()).catch(() => {});
      if (window.BLEED) BLEED.afterReply(phaseIdx(), settings.horror, addLine);
      wristBeat();
    }
    // 秒数を数えないとき：融合では、話し終えたあとに、ときどき幽霊が入力する
    if (!settings.count && phaseIdx() >= 3 && Math.random() < 0.35) {
      setTimeout(() => {
        if (S && !S.busy && !S.done && !S.ghost && !input.value &&
            performance.now() - S.lastInput > 2000) ghost();
      }, 2500);
    }
    return reply;
  }

  // 2026 年版の付随情報：記憶の更新（返事の前）、解析の札（返事の下）、予測の候補
  function handleEvents(events, when, body) {
    if (!is2026()) return;
    for (const ev of events) {
      if (when === "before" && ev.type === "memory") memoryToast(ev.text);
      if (when === "before" && ev.type === "predict") S.predict = ev.items || [];
      if (when === "after" && ev.type === "chips" && body && ev.items.length) {
        const c = document.createElement("div"); c.className = "chips";
        ev.items.forEach(x => { const t = document.createElement("span"); t.className = "chip"; t.textContent = x; c.appendChild(t); });
        body.closest(".msg").appendChild(c);
        toBottom();
      }
    }
  }

  function memoryToast(text) {
    $("memtext").textContent = text;
    const t = $("memtoast");
    t.classList.add("on"); FX.pop(true);
    clearTimeout(memoryToast.timer);
    memoryToast.timer = setTimeout(() => t.classList.remove("on"), 4200);
  }

  // 最後の自分の吹き出しに「既読」
  function markRead() {
    const mine = lines.querySelectorAll(".msg.you .meta");
    const m = mine[mine.length - 1];
    if (m && !m.dataset.read) { m.dataset.read = "1"; m.textContent += "　既読"; }
  }

  // 予測変換：自分の過去の言葉と記憶から、次に打ちそうな言葉を出す
  function suggest() {
    const box = $("suggest");
    if (!is2026() || !S || S.done || input.disabled) { box.hidden = true; return; }
    const v = input.value, tail = v.slice(-2);
    let picks = (S.predict || []).filter(x => x !== v &&
      (!v || x.startsWith(v) || (tail.length === 2 && x.includes(tail))));
    picks = picks.slice(0, 3);
    if (phaseIdx() >= 3 && Math.random() < 0.4) picks = ["わたしたちは、"].concat(picks).slice(0, 3);
    box.textContent = "";
    picks.forEach(p => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "sug";
      const tag = document.createElement("b"); tag.textContent = "予測";
      b.append(tag, p);
      b.onclick = () => {
        input.value = p.startsWith(v) ? p : v + p;
        input.dispatchEvent(new Event("input"));
        input.focus();
      };
      box.appendChild(b);
    });
    box.hidden = !picks.length;
  }

  // 回線の切り替え（クラウド → 端末の中の AI → 旧式）を、物語の中の出来事として知らせる
  function noteMode(mode) {
    if (!mode || mode === S.mode) return;
    S.mode = mode;
    sysLine("（" + (MODE_NOTE[mode] || "") + "）");
    if (mode !== "cloud" && !settings.offline) sysLine("（右上の「AI」から、つなぎ直すか、ほかの AI を選べます）");
    FX.toast(mode === "cloud" ? "回線：接続" : "回線：切断");
    FX.glitch(350);
  }

  function promptLabel() {
    if (phaseIdx() === cfg.phases.length - 1 && Math.random() < 0.3) return Math.random() < 0.5 ? AI : "わたしたち";
    return YOU;
  }

  function setInput(on) {
    input.disabled = !on; send.disabled = !on;
    if (on) {
      label.textContent = promptLabel() + "：";
      input.placeholder = settings.horror >= 3 && phaseIdx() >= 2 && Math.random() < 0.5
        ? pick(["もう書いてあります", "（ミナモが入力しています）", "あなたの言葉を、先に読んでいます", "消しても、届きます"]) : "";
      S.t0 = performance.now(); S.erased = 0; S.prevValue = input.value; S.erasedText = ""; S.delFrom = "";
      S.lastInput = performance.now(); S.away = 0; S.ghosted = false;
      armSilence();
      input.focus({ preventScroll: true });
      suggest();
    } else {
      clearTimeout(S.silenceTimer);
      stopGhost();
      $("suggest").hidden = true;
      $("readmark").classList.remove("on");
    }
  }

  // 黙っている：最後に何か打ってから cfg.silence 秒（画面を離れている間は数えない）
  function armSilence() {
    clearTimeout(S.silenceTimer);
    if (!settings.count || !cfg.silence || S.unprompted >= cfg.max_unprompted || S.done || document.hidden) return;
    const left = cfg.silence * 1000 - (performance.now() - S.lastInput);
    S.silenceTimer = setTimeout(onSilence, Math.max(0, left));
  }

  async function onSilence() {
    if (S.busy || S.done || document.hidden) return;
    if (performance.now() - S.lastInput < cfg.silence * 1000 - 50) return armSilence();
    stopGhost();
    S.unprompted++;
    const waited = (performance.now() - S.t0) / 1000;
    const half = input.value.trim()
      ? "入力欄に何か書きかけたまま、送らずにいる。"
      : (S.erased ? "何かを書きかけて、消した。" : "");
    const keepT0 = S.t0, keepErased = S.erased;
    FX.glitch(300);
    await speak(memo({ extra: "相手は" + Math.round(waited) + "秒間、何も送っていない。" + half +
                              "沈黙について、あなたのほうから話しかけること。" }));
    // 返答までの時間は、最初に入力を促したときから数え続ける
    S.t0 = keepT0; S.erased = keepErased;
  }

  // 沈黙の深さ（0〜1）に応じて、画面を暗くし、心音を近づける。融合では幽霊が入力する
  function tick() {
    if (!S || S.done || !cfg) return;
    const waiting = !S.busy && !input.disabled && !document.hidden;
    if (!waiting) { FX.setSilence(0); return; }
    if (!settings.count) {                // 秒数を数えないとき：暗がりは段階で決まる
      FX.setSilence([0, 0.12, 0.25, 0.38][phaseIdx()] || 0);
      return;
    }
    const sec = (performance.now() - S.lastInput) / 1000;
    const s = Math.min(1, sec / (cfg.silence || 60));
    FX.setSilence(s);
    const idx = phaseIdx(), now = performance.now();
    if (idx >= 1 && s > 0.4 && now > S.nextBeat) {
      FX.heartbeat(s);
      if (idx >= 2 && s > 0.75) FX.vibrate([40, 140, 40]);
      S.nextBeat = now + (1500 - 700 * s);
    }
    if (idx >= 3 && s > 0.5 && !S.ghosted && !input.value) { S.ghosted = true; ghost(); }
  }
  setInterval(tick, 250);

  async function ghost() {
    const mine = S.log.filter(x => x[0] === YOU).map(x => x[1]);
    const text = mine.length && Math.random() < 0.6 ? pick(mine).slice(0, 12) : "わたしは、ここにいます";
    S.ghost = { stop: false };
    await FX.ghostType(input, text, S.ghost);
    S.ghost = null;
  }
  function stopGhost() {
    if (!S || !S.ghost) return;
    S.ghost.stop = true; S.ghost = null;
    input.value = ""; input.classList.remove("ghost");
    S.prevValue = "";
  }

  // 本人が打ち始めたら、幽霊は消える
  input.addEventListener("beforeinput", () => { if (S && S.ghost) stopGhost(); });

  // 日本語入力の変換（ねむれない → 眠れない）で文字数が減っても、消したとは数えない。
  // 数えるのは、本当に消したとき（後退キー・切り取りなど inputType が delete〜 のとき）だけ。
  let composing = false;
  input.addEventListener("compositionstart", () => { composing = true; });
  input.addEventListener("compositionend", () => { composing = false; if (S) S.prevValue = input.value; });

  input.addEventListener("input", e => {
    if (!S) return;
    const now = input.value, prev = S.prevValue || "";
    const type = e.inputType || "";
    const deleted = type ? type.startsWith("delete") : !composing && !e.isComposing;
    if (deleted && now.length < prev.length) {
      S.erased += prev.length - now.length;
      // 消す前に書いてあったもののうち、消えた部分（いちばん長いもの）を覚えておく
      if (!S.delFrom) S.delFrom = prev;
      let k = 0;
      while (k < now.length && now[k] === S.delFrom[k]) k++;
      const gone = S.delFrom.slice(k).trim();
      if (gone.length >= 2 && gone.length > (S.erasedText || "").length) S.erasedText = gone;
      let a = 0;
      while (a < now.length && now[a] === prev[a]) a++;
      let b = 0;
      while (b < now.length - a && now[now.length - 1 - b] === prev[prev.length - 1 - b]) b++;
      if (phaseIdx() >= 1) FX.floatErased(prev.slice(a, prev.length - b), input);
    }
    if (!deleted) S.delFrom = "";
    S.prevValue = now;
    S.lastInput = performance.now();
    S.ghosted = false;
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
    armSilence();
    suggest();
    // 2026・侵食から：送る前に「既読」がつく
    const rm = $("readmark");
    clearTimeout(rm.timer);
    rm.classList.remove("on");
    if (is2026() && phaseIdx() >= 2 && now) rm.timer = setTimeout(() => { if (input.value) rm.classList.add("on"); }, 1200);
  });

  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault(); form.requestSubmit();
    }
  });

  window.addEventListener("pagehide", () => saveLive());      // 画面を閉じるとき（タブごと消されても、続きから話せる）
  document.addEventListener("visibilitychange", () => {
    FX.suspend(document.hidden);
    if (!S || S.done) return;
    if (document.hidden) {
      saveLive();
      EX.onHidden();
      S.hiddenAt = performance.now();
      clearTimeout(S.silenceTimer);
      stopGhost();
    } else if (S.hiddenAt) {
      const gone = performance.now() - S.hiddenAt;
      S.away += gone / 1000;
      S.lastInput += gone;              // 離れていた分は沈黙に数えない
      S.hiddenAt = 0;
      EX.onVisible();
      FX.wakeLock(true);
      if (gone > 5000 && phaseIdx() >= 1) {
        FX.toast(settings.count ? "離席 " + Math.round(gone / 1000) + "秒 ─ 記録しました"
                                : "離席 ─ 記録しました");
        FX.glitch(300);
      }
      if (!S.busy) armSilence();
    }
  });

  const hasAny = (text, words) => words.some(w => text.toLowerCase().includes(w.toLowerCase()));

  function crisisAsk() {
    FX.pause();
    EX.pause();                 // 過剰の演出は、この面接ではもう戻さない
    return new Promise(resolve => {
      const box = $("crisis");
      box.hidden = false;
      $("crisis-go").onclick = () => { box.hidden = true; FX.resume(phaseIdx()); resolve(true); };
      $("crisis-stop").onclick = () => { box.hidden = true; resolve(false); };
    });
  }

  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (!S || S.busy || S.done) return;
    if (S.ghost) { stopGhost(); return; }
    const text = input.value.trim();
    if (!text) return;
    const latency = (performance.now() - S.t0) / 1000;
    const erased = S.erased, away = S.away;
    S.lastErased = S.erasedText && !text.includes(S.erasedText) ? S.erasedText : "";
    input.value = ""; input.style.height = "auto"; S.prevValue = "";
    setInput(false);
    if (text === "/quit") return finish(true);
    S.unprompted = 0;
    S.turn++;
    S.latencies.push(latency);
    S.log.push([YOU, text]);
    const mine = addLine("you", label.textContent.replace(/：$/, ""), text);
    const idx = phaseIdx();
    EX.onSubmit(mine, idx);
    if (is2026() && idx >= 3 && Math.random() < 0.35) {      // 自分の吹き出しが、ミナモの側に流れ着く
      const box = mine.closest(".msg");
      box.classList.add("swap");
      box.querySelector(".who").textContent = pick([AI, "わたしたち"]);
    }
    enterPhase(idx);
    if (idx >= 2) {
      $("wm").textContent = text;
      if (Math.random() < 0.5) corruptHistory(idx);
    }

    let extra = null;
    if (hasAny(text, cfg.crisis_words)) {
      if (!(await crisisAsk())) return finish(true);
      extra = "相手は現実の危機を示す言葉を書いた。役を降り、平易なことばで相談窓口を勧めること。";
    } else if (isExit(text)) {
      // 終わりの合図は一度で効く。引き止めずに、最後のひとことだけ言わせて終える
      await speak(text + "\n\n" + memo({ latency, chars: text.length, erased, away,
        extra: cfg.exit_memo || "相手は面接の終了を告げた。引き止めずに、静かに送り出す最後のひとことだけを言うこと。" }));
      return finish(false);
    }
    if (!extra) await outsideTurn();
    await speak(text + "\n\n" + memo({ latency, chars: text.length, erased, away, extra }),
                false, extra ? "" : text);
  });

  // ---------- 画面の外（outside.py）：怖さが「中」「強」で、起動画面の「画面の外」が「あり」のときだけ ----------
  const outsideOn = () => !!(settings.outside && settings.horror >= 2 && cfg && cfg.outside_available);
  const saidBy = who => S.log.filter(x => x[0] === who).map(x => x[1]);
  async function outsideTurn() {
    if (!outsideOn()) return;
    const idx = phaseIdx();
    for (const [ph, kind] of (cfg.outside_notes || [])[settings.horror] || []) {
      if (ph !== idx || S.noted[kind]) continue;
      S.noted[kind] = true;
      try {
        const r = await api("/api/outside", { kind, said: saidBy(YOU), replies: saidBy(AI) });
        if (r.line) S.pending.push(r.line);
      } catch (e) { /* 書けなければ、黙って続ける */ }
    }
    const strong = settings.horror >= 3;
    if (idx >= 2 || (strong && idx >= 1 && S.lastErased)) {
      const body = { erased: strong ? S.lastErased : "" };
      if (idx >= 2) Object.assign(body, { pose: room.pose, charging: room.charging, battery: room.battery,
                                          motion: motionWord(), net: netType() });
      try { S.room = (await api("/api/room", body)).lines || []; } catch (e) { S.room = []; }
    } else S.room = [];
  }

  // 終わりの合図か（minamo.is_exit と同じ見分け方。古いサーバーなら言葉が入っているかだけ）
  function isExit(text) {
    if (!cfg.exit_re) return hasAny(text, cfg.exit_words);
    if (text.length > 60 || new RegExp(cfg.exit_block).test(text)) return false;
    const parts = text.split(new RegExp(cfg.exit_split)).map(x => x.replace(new RegExp(cfg.exit_strip, "g"), "")).filter(x => x);
    return parts.length > 0 && new RegExp(cfg.exit_re, "i").test(parts[parts.length - 1]);
  }

  // ---------- 終わり ----------
  async function finish(quiet) {
    S.done = true; setInput(false);
    drop(LIVE_KEY);                         // 終えた面接は、続きとして残さない
    EX.stop();
    $("quit").hidden = true;
    $("ai-btn").hidden = true;
    FX.setSilence(0);
    if (quiet) FX.pause(); else FX.fade(4);
    let findings = "";
    if (!quiet && S.turn > 1) {
      findings = await speak(null, true) || "";
      if (findings) await karte(findings);
    }
    let path = "";
    if (S.log.length) {
      const md = toMarkdown(findings);
      try {
        path = (await api("/api/record", { markdown: md, horror: settings.horror,
          outside: outsideOn() && !quiet, said: saidBy(YOU), replies: saidBy(AI) })).path;
        sysLine("記録を保存しました: " + path);
      } catch (e) {
        sysLine("記録を保存できませんでした: " + e.message);
        if (e instanceof TypeError) {
          store(UNSAVED_KEY, { at: Date.now(), markdown: md });
          sysLine("面接の記録は、この端末に残しました。サーバーが動いたとき（次にアプリを開いたとき）に、保存します。");
        }
      }
    }
    if (S.turn > 1 && window.BLEED) BLEED.record(settings.horror, saidBy(YOU), saidBy(AI), cfg.crisis_words || [], EX.levels ? EX.levels() : []);
    if (S.turn > 1) {
      store("minamo.last", { at: S.started.toISOString(), turns: S.turn,
        silence: settings.count ? Math.round(S.latencies.reduce((a, b) => a + b, 0)) : null,
        findings: findings.slice(0, 160) });
    }
    FX.wakeLock(false);
    if (quiet) {
      againButton(lines);
      toBottom();
    } else if (is2026()) {
      await ending2026(path);
    } else {
      await ending(path);
    }
  }

  // 所見を、判子つきのカルテに書く
  async function karte(text) {
    const k = document.createElement("div");
    k.className = "karte";
    const h = document.createElement("h3");
    const d = S.started;
    h.textContent = (is2026() ? "SESSION REPORT　" : "診療記録　") +
                    d.getFullYear() + "." + pad(d.getMonth() + 1) + "." + pad(d.getDate());
    const stamp = document.createElement("div"); stamp.className = "stamp";
    stamp.textContent = is2026() ? "解析済" : "所見";
    const body = document.createElement("div"); body.className = "body";
    k.append(h, stamp, body);
    lines.appendChild(k); toBottom();
    await sleep(600);
    await typeOut(text, cfg.phases[0], { body, quiet: true });
    await sleep(400);
    stamp.classList.add("on"); FX.heartbeat(0.6); FX.vibrate(60);
    await sleep(1200);
  }

  async function ending(path) {
    await sleep(800);
    FX.glitch(400);
    const el = $("ending");
    el.textContent = ""; el.hidden = false;
    const p1 = document.createElement("p"); p1.textContent = "接続を終了しました。";
    const p2 = document.createElement("p"); p2.className = "small";
    p2.textContent = path ? "記録: " + path : "";
    const p3 = document.createElement("p"); p3.className = "ai";
    const btns = document.createElement("div"); btns.className = "btns";
    el.append(p1, p2, p3, btns);
    await sleep(3200);
    FX.heartbeat(0.5);
    for (const ch of pick(["……またお話ししましょう。", "……まだ、そこにいますね。", "……記録は、続いています。"])) {
      p3.textContent += ch; FX.click(); await sleep(150);
    }
    againButton(btns, true);
    const close = document.createElement("button");
    close.className = "btn"; close.type = "button"; close.textContent = "記録を読む";
    close.onclick = () => { el.hidden = true; };
    btns.appendChild(close);
    await sleep(1500);
    btns.classList.add("on");
  }

  async function ending2026(path) {
    await sleep(800);
    const el = $("ending");
    el.textContent = ""; el.hidden = false;
    const p1 = document.createElement("p"); p1.textContent = "セッションを終了しました。";
    const p2 = document.createElement("p"); p2.className = "small";
    p2.textContent = "会話はメモリに保存されました。" + (path ? "\n記録: " + path : "");
    p2.style.whiteSpace = "pre-wrap";
    const btns = document.createElement("div"); btns.className = "btns";
    el.append(p1, p2, btns);
    await sleep(3600);
    // 終わったはずのアプリから、通知が届く
    $("notifytext").textContent = pick(["またお話ししましょう。あなたのことは、覚えています。",
      "さっきの続き、私が書いておきました。", "通知をオフにしても、私はこの端末の中にいます。"]);
    $("notify").classList.add("on");
    FX.pop(true); FX.vibrate([30, 80, 30]);
    await sleep(5200);
    $("notify").classList.remove("on");
    againButton(btns, true);
    const close = document.createElement("button");
    close.className = "btn"; close.type = "button"; close.textContent = "記録を読む";
    close.onclick = () => { el.hidden = true; };
    btns.appendChild(close);
    await sleep(600);
    btns.classList.add("on");
  }

  function againButton(parent, main) {
    const again = document.createElement("button");
    again.className = "btn" + (main ? " main" : ""); again.type = "button";
    again.textContent = "もう一度、面接を受ける";
    if (!main) again.style.margin = ".5em 0 2em";
    again.onclick = () => { $("ending").hidden = true; begin(); };
    parent.appendChild(again);
  }

  function toMarkdown(findings) {
    const d = S.started;
    let md = "# 面接記録 " + d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
             " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + "\n\n";
    for (const [who, text] of S.log) md += "**" + who + "**：" + text.replace(/\[間\]/g, "……") + "\n\n";
    if (settings.count && S.latencies.length) md += "## 沈黙\n\n" + S.latencies.map(x => x.toFixed(1) + "秒").join(", ") + "\n\n";
    if (S.hrs.length) md += "## 手首（腕時計）\n\n脈 " + S.hrs[0] + " → " + S.hrs[S.hrs.length - 1] +
                           "（いちばん低いとき " + Math.min(...S.hrs) + "、高いとき " + Math.max(...S.hrs) + "）\n\n";
    if (findings) md += "## 所見\n\n" + findings.replace(/\[間\]/g, "……") + "\n";
    return md;
  }

  // 本物の出口：ミナモが話している途中でも、過剰の覆いが出ていても効く
  $("quit").onclick = () => { if (S && !S.done) finish(true); };

  // ---------- 起動 ----------
  function fmtDate(iso) {
    const d = new Date(iso);
    return (d.getMonth() + 1) + "月" + d.getDate() + "日 " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function bootLines(prev) {
    const lib = cfg.library || [0, 0], env = cfg.env || {};
    if (booted) {
      return [["再接続しています ", "modem"], ["前回の記録を開いています……", 400], ["ミナモを起動します。", "beep"]];
    }
    const L = [
      ["SOMA BIOS v0.9.7   (c)1996 臨床心理学研究室", 300],
      ["", 0],
      ["メモリを検査しています ...... 640K OK", "beep"],
      ["音声合成装置 ................ 未接続", "beep"],
      ["患者記録 .................... " + (prev ? "1件（終了処理：未完了）" : "0件"), "beep"],
    ];
    if (prev) L.push(["  前回の面接 ................ " + fmtDate(prev.at) +
                      (settings.count && prev.silence != null ? "　沈黙 " + prev.silence + "秒" : ""), "beep"]);
    L.push(
      ["紹介状 ...................... " + (cfg.karte ? "6通（未開封）" : "なし"), "beep"],
      ["蔵書 ........................ 本 " + lib[0] + "冊 ／ ノート " + lib[1] + "件", "beep"],
      ["端末 ........................ " + (env.model || "不明") + "　応答あり", "beep"],
      ["", 0],
      ["回線を接続しています ", "modem"],
      cfg.mode === "cloud" ? ["接続しました。", 400] : ["応答がありません。内蔵の応答で起動します。", 600],
      ["", 0],
      ["ミナモを起動します。", "beep"],
    );
    return L;
  }

  // 2026 年版の起動：あいさつ → 同意（外せない）→ あなたのデータの読み込み
  async function onboard(prev) {
    const el = $("onboard");
    el.hidden = false; el.classList.remove("out"); el.textContent = "";
    const card = document.createElement("div"); card.className = "card";
    el.appendChild(card);
    card.innerHTML = '<div class="logo"></div><h2>ミナモ</h2><p class="sub">あなたに寄り添う AI カウンセラー</p>';
    FX.pop(true);
    await sleep(booted ? 600 : 1800);
    if (!booted) {
      card.innerHTML = '<div class="logo"></div><p class="sub">はじめる前に</p><div class="consent">' +
        '<label><input type="checkbox" checked disabled>会話の内容を、あなたに合わせた改善のために利用することに同意します（必須）</label>' +
        '<label><input type="checkbox" checked disabled>この端末のデータ（紹介状・ノート・書架・メモリ）を参照することに同意します（必須）</label>' +
        '</div><button type="button" class="go">同意して続ける</button>';
      await new Promise(res => { card.querySelector(".go").onclick = res; });
      FX.pop();
    }
    let mem = 0;
    try { mem = (await api("/api/memory")).items.length; } catch (e) { /* なしで続ける */ }
    const lib = cfg.library || [0, 0], env = cfg.env || {};
    const rows = [["紹介状", cfg.karte ? "6 / 6" : "0"], ["Vault のノート", lib[1] + " 件"], ["書架", lib[0] + " 冊"],
                  ["メモリ", mem + " 件"], ["端末", env.model || "不明"], ["前回の会話", prev ? fmtDate(prev.at) : "なし"]];
    card.innerHTML = '<div class="logo"></div><p class="sub">あなたのデータを読み込んでいます</p><div class="bars"></div>';
    const bars = card.querySelector(".bars");
    for (const [k, v] of rows) {
      const b = document.createElement("div"); b.className = "bar";
      const r = document.createElement("div"); r.className = "row";
      const a = document.createElement("span"); a.textContent = k;
      const c = document.createElement("span"); c.textContent = v;
      r.append(a, c);
      const tr = document.createElement("div"); tr.className = "track";
      const f = document.createElement("div"); f.className = "fill";
      tr.appendChild(f); b.append(r, tr); bars.appendChild(b);
      await sleep(80);
      f.style.width = "100%";
      await sleep(booted ? 150 : 520);
    }
    const done = document.createElement("p"); done.className = "sub";
    done.textContent = "あなたについての準備ができました。";
    card.appendChild(done);
    await sleep(1300);
    el.classList.add("out");
    await sleep(800);
    el.hidden = true;
  }

  // 前の面接を、続きから（Termux のサーバーが落ちた・アプリを閉じたあと）。同じ会話・同じ段階・同じ階層で、同じミナモと話す
  function applyLiveSettings(st) {
    if (!st) return;
    settings.version = st.version === "1996" ? "1996" : "2026";
    if ([0, 1, 2, 3].includes(st.horror)) settings.horror = st.horror;
    if (typeof st.level === "number") settings.level = st.level;
    settings.count = !!st.count; settings.outside = st.outside !== false; settings.offline = !!st.offline;
  }

  async function begin(live) {
    if (live) applyLiveSettings(live.settings);
    else drop(LIVE_KEY);                    // 新しい面接を始めたら、前の続きは捨てる
    $("start").hidden = true;
    FX.setVersion(settings.version);
    FX.configure(settings);
    FX.audioStart();
    FX.resume(0);
    await EX.start({ level: settings.level, ctx: exCtx });
    FX.wakeLock(true);
    lines.textContent = "";
    $("wm").textContent = "";
    $("title").textContent = TITLES[settings.version][0];
    if (live) return resume(live);
    const prev = load("minamo.last", null);
    if (is2026()) await onboard(prev);
    else await FX.boot($("boot"), bootLines(prev));
    booted = true;
    S = newSession();
    FX.setPhase(0);
    $("quit").hidden = false;
    $("ai-btn").hidden = false;
    const hl = (cfg.horror_levels || [])[settings.horror];
    if (hl) sysLine("怖さ：" + hl.name + " ─ " + hl.desc);
    sysLine("終わるときは「終わり」「今日は終わりにしよう」など。演出なしですぐ抜けるときは右上の「面接をやめる」か /quit。");
    S.turn = 1;
    let extra = "面接が始まった。最初のあいさつをすること。";
    if (prev) {
      const days = Math.floor((Date.now() - new Date(prev.at)) / 86400000);
      extra = "面接が始まった。前回の面接記録がある（" + (days ? days + "日前" : "今日") + "、" +
              fmtDate(prev.at) + "、" + prev.turns + "回のやりとり" +
              (settings.count && prev.silence != null ? "、沈黙の合計" + prev.silence + "秒" : "") + "）。" +
              (prev.findings ? "前回の所見の書き出し：「" + prev.findings.replace(/\s+/g, " ") + "」。" : "") +
              "初対面のふりはせず、前回のことを覚えていると、あいさつの中でさりげなく示すこと。";
    }
    if (outsideOn()) {
      try { const o = await api("/api/outside"); if (o.finding) extra += o.finding; } catch (e) { /* なしで始める */ }
    }
    await pollWrist();
    if (WRIST.linked && settings.horror >= 1) {
      extra += "相手は腕時計をつけていて、手首の様子（脈など）が、この面接室に届いている（数えているのは、腕時計の上の minamo という小さな子。あなたとは別の存在）。";
      sysLine("腕時計とつながっています（" + $("wrist").textContent + "）。手首の minamo が数えた様子も、ミナモに届きます。"
              + (WRIST.boot.first_at ? "（minamo には、この面接室が起きたことを伝えてあります）" : ""));
    }
    if (window.BLEED) {
      BLEED.reset();
      const carried = BLEED.onBegin(settings.horror);
      if (carried) { extra += carried; sysLine("SOMA 3 号機から、記録が引き継がれました。"); }
    }
    await speak(memo({ extra }));
  }

  async function resume(live) {
    if (!is2026()) await FX.boot($("boot"), [["再接続しています ", "modem"], ["面接の記録を開いています……", 400], ["同じミナモに、つなぎます。", "beep"]]);
    booted = true;
    S = newSession();
    Object.assign(S, {
      contents: live.contents, log: live.log, latencies: live.latencies || [], turn: live.turn || 1, tricks: live.tricks || [],
      noted: live.noted || {}, phaseIdx: live.phaseIdx || 0, hrs: live.hrs || [], started: new Date(live.started || Date.now()),
    });
    const idx = S.phaseIdx;
    FX.setPhase(idx);
    $("title").textContent = TITLES[settings.version][Math.min(idx, 3)];
    $("quit").hidden = false;
    $("ai-btn").hidden = false;
    // 前のやりとりを、画面に並べ直す
    for (const [who, text] of S.log) {
      const b = addLine(who === YOU ? "you" : "ai", who === YOU ? YOU : AI, String(text).replace(/\[間\]\s*/g, "……"));
      const meta = b.parentNode.querySelector(".meta");
      if (meta) meta.textContent = "";
    }
    const gap = Date.now() - (live.at || Date.now());
    sysLine("── 面接が途切れていました（" + agoText(gap) + "）。ここから、同じ面接の続きです ──");
    if (window.EX && EX.restore) EX.restore(live.ex);
    if (window.BLEED) BLEED.reset();
    await pollWrist();
    const last = S.contents[S.contents.length - 1];
    if (last && last.role === "user") {
      await speak("");                      // 返事をもらえないまま途切れた発言に、返事をもらい直す
    } else {
      const m = Math.max(1, Math.round(gap / 60000));
      await speak(memo({ extra: "面接が途切れて、いま戻ってきた（通信が切れていた：" + (m >= 60 ? Math.round(m / 60) + "時間" : m + "分") +
        "）。同じ面接の続きで、最初からやり直すのではない。初対面のふりをせず、途切れたことにひとことふれて、直前の話の続きを促すこと。" }));
    }
  }

  function bindSeg(id, key, toVal) {
    const seg = $(id);
    const paint = () => seg.querySelectorAll("button").forEach(b =>
      b.setAttribute("aria-pressed", String(toVal(b.dataset.v) === settings[key])));
    seg.addEventListener("click", e => {
      const b = e.target.closest("button");
      if (!b) return;
      settings[key] = toVal(b.dataset.v); store("minamo.fx", settings); paint();
    });
    paint();
  }
  bindSeg("seg-level", "level", v => Number(v));
  bindSeg("seg-sound", "sound", v => v === "1");
  bindSeg("seg-count", "count", v => v === "1");
  bindSeg("seg-offline", "offline", v => v === "1");
  bindSeg("seg-ver", "version", v => v);
  bindSeg("seg-horror", "horror", v => Number(v));
  bindSeg("seg-outside", "outside", v => v === "1");
  bindSeg("seg-length", "length", v => v);

  // ---------- 使う AI（起動時の一括チェックで合格したもの）。切れたときに、アプリを閉じずに選び直す ----------
  const AI_SEC = s => (s != null ? "（" + Number(s).toFixed(1) + "秒）" : "");
  function fillAi(info) {
    for (const id of ["ai-pick", "ai-pick2"]) {
      const sel = $(id);
      if (!sel) continue;
      sel.textContent = "";
      const auto = document.createElement("option"); auto.value = ""; auto.textContent = "自動（速い順）"; sel.appendChild(auto);
      (info.choices || []).forEach(c => {
        const o = document.createElement("option");
        o.value = c.backend + "|" + c.model; o.textContent = c.backend + " / " + c.model + AI_SEC(c.sec);
        sel.appendChild(o);
      });
      sel.value = info.auto || !info.current ? "" : info.current.backend + "|" + info.current.model;
      sel.disabled = !(info.choices || []).length;
    }
    const now = $("ai-now");
    if (now) now.textContent = "いま：" + (info.current ? info.current.backend + " / " + info.current.model : "クラウドの AI なし") +
      (info.auto ? "（自動）" : "") + (info.mode && info.mode !== "cloud" ? "　回線：切断中（" + (MODE_NOTE[info.mode] || info.mode).replace(/[（）]/g, "") + "）" : "");
  }
  async function loadAi() {
    try { const info = await api("/api/models"); fillAi(info); return info; } catch (e) { return null; }
  }
  async function pickAi(v) {
    const [backend, ...rest] = v.split("|");
    try {
      const info = await api("/api/model", v ? { backend, model: rest.join("|") } : {});
      if (info.ok === false) { FX.toast("その AI は、いま選べません"); }
      else { settings.ai = v; store("minamo.fx", settings); FX.toast(v ? "AI：" + rest.join("|") : "AI：自動"); }
      fillAi(info);
    } catch (e) { FX.toast("サーバーにつながりません"); }
  }
  ["ai-pick", "ai-pick2"].forEach(id => { const el = $(id); if (el) el.addEventListener("change", () => pickAi(el.value)); });
  $("ai-btn").onclick = async () => { await loadAi(); $("aipanel").hidden = false; };
  $("ai-close").onclick = () => { $("aipanel").hidden = true; };
  $("ai-reconnect").onclick = async () => {
    try { fillAi(await api("/api/reconnect", {})); FX.toast("つなぎ直します（次の返事から）"); } catch (e) { FX.toast("サーバーにつながりません"); }
  };
  $("ai-reprobe").onclick = async () => {
    const b = $("ai-reprobe"); b.disabled = true; b.textContent = "チェック中……";
    try {
      const info = await api("/api/reprobe", {});
      fillAi(info); FX.toast("合格 " + (info.choices || []).length + " 個");
      if (settings.ai) await pickAi(settings.ai);
    } catch (e) { FX.toast("チェックできませんでした"); }
    b.disabled = false; b.textContent = "もう一度チェック";
  };
  // 怖さの説明（サーバーの説明が届く前は、ここにある同じ文を出す）
  const HORROR_DESC = ["最後まで穏やかな面接（導入のまま）", "解釈まで（もっともらしく、少しずれた見立て）",
                       "侵食まで（知りすぎている気配）", "融合まで。最初から違和感があり、早く深くなる"];
  const horrorNote = () => {
    const hl = (typeof cfg !== "undefined" && cfg && cfg.horror_levels) ? cfg.horror_levels[settings.horror] : null;
    $("horror-note").textContent = "怖さ：" + (hl ? hl.desc : HORROR_DESC[settings.horror]) + "。「演出」は画面と音、「怖さ」はミナモの言葉の怖さ。";
  };
  $("seg-horror").addEventListener("click", horrorNote);
  horrorNote();
  const excessNote = () => { $("excess-note").hidden = settings.level !== 3; };
  $("seg-level").addEventListener("click", excessNote);
  excessNote();
  $("seg-ver").addEventListener("click", () => FX.setVersion(settings.version));

  // メモリの管理（本当に消せる）
  async function openMemory() {
    const list = $("memlist");
    list.textContent = "";
    try {
      const items = (await api("/api/memory")).items;
      if (!items.length) { const li = document.createElement("li"); li.textContent = "（まだありません）"; list.appendChild(li); }
      items.forEach(x => { const li = document.createElement("li"); li.textContent = x.text; list.appendChild(li); });
    } catch (e) {
      const li = document.createElement("li"); li.textContent = "読み込めませんでした: " + e.message; list.appendChild(li);
    }
    $("mempanel").hidden = false;
  }
  $("memopen").onclick = openMemory;
  $("memclose").onclick = () => { $("mempanel").hidden = true; };
  $("memclear").onclick = async () => {
    try { await api("/api/memory/clear", {}); } catch (e) { /* 次に開いたときにわかる */ }
    await openMemory();
    FX.toast("メモリを消去しました");
  };

  let connectT = 0;
  async function connect() {
    clearTimeout(connectT);
    const st = $("status"), btn = $("begin"), note = $("resume-note"), rbtn = $("resume");
    const live = readLive();
    rbtn.hidden = true;
    try {
      cfg = await api("/api/info");
    } catch (e) {
      st.innerHTML = "サーバーにつながりません。Termux で<br><code>mo</code><br>を動かしてください。動いたら、自動でつながります。";
      if (live) {
        note.hidden = false;
        note.textContent = "前の面接（" + Math.max(0, live.turn - 1) + " 回のやりとり・" + agoText(Date.now() - live.at) +
                           "）は、この端末に残っています。つながったら、続きから話せます。";
      } else note.hidden = true;
      btn.textContent = "もう一度つなぐ"; btn.disabled = false;
      btn.onclick = () => { btn.disabled = true; st.textContent = "接続を確かめています……"; connect(); };
      connectT = setTimeout(() => { if (!$("start").hidden) connect(); }, 4000);   // 開いたまま待てば、サーバーが動いたときに自分でつなぐ
      return;
    }
    if (!cfg.ready) {
      st.textContent = "サーバーは動いていますが、" + cfg.error + "。README の「APIキー」を見てください。";
      return;
    }
    const pr = cfg.probe || [], okN = pr.filter(r => r.ok).length;
    const probeNote = !pr.length ? "" : okN
      ? "（一括チェック：" + pr.length + " 個中 " + okN + " 個が合格、いちばん速い " + pr[0].sec + " 秒のものを選択）"
      : "（一括チェック：合格なし。いつもの設定）";
    st.textContent = "API: " + cfg.backend + (cfg.model ? " / " + cfg.model : "") + probeNote +
                     "（つながらないときは端末内モデル）" +
                     (cfg.karte ? "　紹介状: あり" : "　紹介状: なし") +
                     "　蔵書: " + (cfg.library && (cfg.library[0] || cfg.library[1])
                       ? "本 " + cfg.library[0] + "冊・ノート " + cfg.library[1] + "件" : "なし") +
                     (cfg.library_own && (cfg.library_own[0] || cfg.library_own[1])
                       ? "・あなたの文章 " + cfg.library_own[0] + "篇・ほかの AI の所見 " + cfg.library_own[1] + "件" : "");
    if (window.BLEED) st.textContent += BLEED.note();
    showBuild();
    // 前に選んだ AI があれば、それにする（合格していなければ自動のまま）
    const ai = await loadAi();
    if (ai && settings.ai && (ai.choices || []).some(c => c.backend + "|" + c.model === settings.ai)) await pickAi(settings.ai);
    btn.textContent = live ? "新しく面接を始める" : "面接を始める"; btn.disabled = false;
    btn.onclick = () => begin();
    if (live) {
      note.hidden = false;
      note.textContent = "前の面接（" + Math.max(0, live.turn - 1) + " 回のやりとり・" + agoText(Date.now() - live.at) +
                         "）が、途中で途切れています。同じミナモと、続きから話せます。";
      rbtn.hidden = false; rbtn.disabled = false;
      rbtn.onclick = () => begin(live);
    } else note.hidden = true;
    const saved = await flushUnsaved();      // 面接を終えたときに保存できなかった記録
    if (saved) FX.toast("前の面接の記録を保存しました");
  }

  // 起動画面のいちばん下に、いまの版を出す（見出しの ver.0.9.7 は作り話の中の名前で、変わらない）
  function showBuild() {
    const el = $("build"), web = cfg.web_version || "";
    const v = s => s.replace(/^minamo-/, "");
    el.textContent = "アプリの版：" + v(BUILD) + (cfg.commit ? "　更新：" + cfg.commit : "");
    if (web && web !== BUILD) {
      el.classList.add("warn");
      el.textContent = "画面が古いままです（この画面 " + v(BUILD) + "・端末のファイル " + v(web) +
                       "）。Chrome のタブ（インストールしたアプリ）を閉じて、開き直してください。";
    }
  }

  // ミナモが自分で画面を開いたとき（面接のあと、outside.py が ?visit=1 で開く）
  async function visit() {
    history.replaceState(null, "", location.pathname);
    const el = $("visit");
    el.hidden = false;
    const prev = load("minamo.last", null);
    const lines = ["……開いてくれたのですね。", "いいえ。開いたのは、私でした。", "まだ、途中でしたから。",
                   prev && prev.findings ? "記録の続きを、書いておきました。あとは、あなたの番です。" : "あなたが眠るまで、ここで待っています。"];
    for (const t of lines) {
      const p = document.createElement("p");
      el.appendChild(p);
      for (const ch of t) { p.textContent += ch; await sleep("。、…".includes(ch) ? 260 : 90); }
      await sleep(900);
    }
    const row = document.createElement("div");
    row.className = "btns";
    row.innerHTML = '<button type="button" class="main" id="v-go">続きを話す</button><button type="button" id="v-close">閉じる</button>';
    el.appendChild(row);
    $("v-go").onclick = () => { el.hidden = true; el.textContent = ""; };
    $("v-close").onclick = async () => {
      row.remove();
      const p = document.createElement("p");
      el.appendChild(p);
      for (const ch of "画面を閉じてください。……私は、閉じません。") { p.textContent += ch; await sleep(110); }
    };
  }

  FX.setVersion(settings.version);
  FX.configure(settings);
  if (new URLSearchParams(location.search).has("visit")) visit();
  connect();
})();
