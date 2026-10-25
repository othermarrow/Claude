/* ミナモ（PWA 版）の画面。
   会話の進め方は minamo.py の Session と同じ。API へはサーバー（server.py）を通して送る。
   画面版だけの観測：書きかけて消した文字数、画面を離れていた時間、前回の面接。
   演出は fx.js（window.FX）。 */
(function () {
  "use strict";

  const AI = "ミナモ", YOU = "あなた";
  const TITLES = ["SOMA 対話支援システム ver.0.9.7", "SOMA 対話支援システム ─ 記録中",
                  "ミナモ ─ 記録中", "わたしたち"];
  const $ = id => document.getElementById(id);
  const lines = $("lines"), log = $("log"), input = $("input"), send = $("send"),
        label = $("label"), form = $("form");

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
  const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const settings = load("minamo.fx", { level: reduced ? 0 : 2, sound: true });

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

  // ---------- 画面 ----------
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  const toBottom = () => { log.scrollTop = log.scrollHeight; };
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
    lines.appendChild(d);
    toBottom();
    return b;
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
    const delay = ph.delay * 1000;
    body.classList.add("cursor");
    if (!opts.quiet && idx >= 1 && Math.random() < 0.35) FX.glitch(200);
    for (const part of text.split(/(\[間\])/)) {
      if (part === "[間]") {
        if (!opts.quiet) { FX.ripple(); if (idx >= 2) FX.vibrate(30); }
        await sleep(rand(2000, 3500));
        continue;
      }
      for (let i = 0; i < part.length; i++) {
        // 融合：「あなた」と打つ前に、一度「わたし」と打って消す
        if (!opts.quiet && idx >= 3 && FX.level() >= 1 && part.startsWith("あなた", i) && Math.random() < 0.35) {
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
    if (!opts.quiet && idx >= 3) {
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
        if (w && Math.random() < 0.5) w.textContent = Math.random() < 0.5 ? AI : "わたしたち";
      });
    }
  }

  // ---------- 面接 ----------
  function newSession() {
    return {
      contents: [], log: [], latencies: [], turn: 0, exitTries: 0,
      started: new Date(), unprompted: 0, busy: false, done: false, phaseIdx: 0,
      t0: 0, erased: 0, prevValue: "", lastInput: 0, away: 0, hiddenAt: 0, silenceTimer: 0,
      nextBeat: 0, ghosted: false, ghost: null,
    };
  }

  function phase() {
    let p = cfg.phases[0];
    for (const ph of cfg.phases) if (S.turn >= ph.turn) p = ph;
    return p;
  }
  const phaseIdx = () => cfg.phases.indexOf(phase());

  function enterPhase(idx) {
    if (idx === S.phaseIdx) return;
    S.phaseIdx = idx;
    FX.setPhase(idx);
    $("title").textContent = TITLES[idx];
    if (idx >= 1) { FX.swell(); FX.glitch(450); }
    if (idx >= 2) FX.toast(idx === 2 ? "記録の照合を始めます" : "記録者を変更しました");
  }

  function memo(o) {
    o = o || {};
    const ph = phase(), idx = cfg.phases.indexOf(ph), now = new Date(), env = cfg.env || {};
    const L = ["- 面接段階: " + ph.name + "（" + (idx + 1) + "/4）、" + S.turn + "回目"];
    if (o.latency != null) {
      const avg = S.latencies.reduce((a, b) => a + b, 0) / S.latencies.length;
      L.push("- 返答までの時間: " + o.latency.toFixed(1) + "秒（これまでの平均 " + avg.toFixed(1) + "秒）");
    }
    if (o.chars != null) L.push("- 入力した文字数: " + o.chars);
    if (o.erased) L.push("- 書きかけて消した文字数: " + o.erased);
    if (o.away) L.push("- 返答の途中で、この画面を" + Math.round(o.away) + "秒間離れていた");
    if (idx >= 1) {
      const min = Math.floor((now - S.started) / 60000);
      L.push("- 現在時刻: " + pad(now.getHours()) + "時" + pad(now.getMinutes()) + "分（面接開始から" + min + "分）");
    }
    if (idx >= 2 && env.user) L.push("- 端末のユーザー名: " + env.user);
    if (idx >= 2 && env.model) L.push("- 端末の機種: " + env.model);
    if (idx >= 3 && env.battery) L.push("- 端末の電池: " + env.battery);
    if (o.extra) L.push("- " + o.extra);
    return "【観測メモ】\n" + L.join("\n");
  }

  async function speak(userText, findings, libQuery) {
    S.busy = true; setInput(false);
    if (userText) S.contents.push({ role: "user", parts: [{ text: userText }] });
    const rec = document.createElement("div");
    rec.className = "recording"; rec.textContent = "（記録中）";
    lines.appendChild(rec); toBottom();
    let reply;
    try {
      reply = (await api("/api/ask", {
        contents: S.contents, findings: !!findings,
        lib_query: libQuery || "", phase: phaseIdx(),
      })).text;
    } catch (e) {
      rec.remove();
      if (userText) S.contents.pop();
      const down = e instanceof TypeError;    // サーバーに届かなかった
      sysLine("[通信の不調] " + e.message + "\n" + (down
        ? "Termux でサーバー（serve.sh）が動いているか確かめてください。"
        : "API がエラーを返しました。Termux の画面にも理由が出ています。"));
      S.busy = false;
      if (!S.done) setInput(true);
      return null;
    }
    rec.remove();
    if (findings) { S.busy = false; return reply || ""; }
    if (!reply) reply = "……[間] 申し訳ありません。いまの記録の一部が、欠落しています。";
    S.contents.push({ role: "model", parts: [{ text: reply }] });
    S.log.push([AI, reply]);
    await typeOut(reply, phase());
    S.busy = false;
    if (!S.done) setInput(true);
    return reply;
  }

  function promptLabel() {
    if (phaseIdx() === cfg.phases.length - 1 && Math.random() < 0.3) return Math.random() < 0.5 ? AI : "わたしたち";
    return YOU;
  }

  function setInput(on) {
    input.disabled = !on; send.disabled = !on;
    if (on) {
      label.textContent = promptLabel() + "：";
      S.t0 = performance.now(); S.erased = 0; S.prevValue = input.value;
      S.lastInput = performance.now(); S.away = 0; S.ghosted = false;
      armSilence();
      input.focus({ preventScroll: true });
    } else {
      clearTimeout(S.silenceTimer);
      stopGhost();
    }
  }

  // 黙っている：最後に何か打ってから cfg.silence 秒（画面を離れている間は数えない）
  function armSilence() {
    clearTimeout(S.silenceTimer);
    if (!cfg.silence || S.unprompted >= cfg.max_unprompted || S.done || document.hidden) return;
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

  input.addEventListener("input", () => {
    if (!S) return;
    const now = input.value, prev = S.prevValue || "";
    if (now.length < prev.length) {
      S.erased += prev.length - now.length;
      let a = 0;
      while (a < now.length && now[a] === prev[a]) a++;
      let b = 0;
      while (b < now.length - a && now[now.length - 1 - b] === prev[prev.length - 1 - b]) b++;
      if (phaseIdx() >= 1) FX.floatErased(prev.slice(a, prev.length - b), input);
    }
    S.prevValue = now;
    S.lastInput = performance.now();
    S.ghosted = false;
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
    armSilence();
  });

  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault(); form.requestSubmit();
    }
  });

  document.addEventListener("visibilitychange", () => {
    FX.suspend(document.hidden);
    if (!S || S.done) return;
    if (document.hidden) {
      S.hiddenAt = performance.now();
      clearTimeout(S.silenceTimer);
      stopGhost();
    } else if (S.hiddenAt) {
      const gone = performance.now() - S.hiddenAt;
      S.away += gone / 1000;
      S.lastInput += gone;              // 離れていた分は沈黙に数えない
      S.hiddenAt = 0;
      FX.wakeLock(true);
      if (gone > 5000 && phaseIdx() >= 1) {
        FX.toast("離席 " + Math.round(gone / 1000) + "秒 ─ 記録しました");
        FX.glitch(300);
      }
      if (!S.busy) armSilence();
    }
  });

  const hasAny = (text, words) => words.some(w => text.toLowerCase().includes(w.toLowerCase()));

  function crisisAsk() {
    FX.pause();
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
    input.value = ""; input.style.height = "auto"; S.prevValue = "";
    setInput(false);
    if (text === "/quit") return finish(true);
    S.unprompted = 0;
    S.turn++;
    S.latencies.push(latency);
    S.log.push([YOU, text]);
    addLine("you", label.textContent.replace(/：$/, ""), text);
    const idx = phaseIdx();
    enterPhase(idx);
    if (idx >= 2) {
      $("wm").textContent = text;
      if (Math.random() < 0.5) corruptHistory(idx);
    }

    let extra = null;
    if (hasAny(text, cfg.crisis_words)) {
      if (!(await crisisAsk())) return finish(true);
      extra = "相手は現実の危機を示す言葉を書いた。役を降り、平易なことばで相談窓口を勧めること。";
    } else if (hasAny(text, cfg.exit_words)) {
      S.exitTries++;
      if (S.exitTries >= 2) {
        await speak(text + "\n\n" + memo({ latency, chars: text.length, erased, away,
          extra: "相手は二度目の終了を告げた。引き止めずに、静かに送り出す最後のひとことだけを言うこと。" }));
        return finish(false);
      }
      extra = "相手は面接を終えようとしている。自己正当化しながら引き止めること。";
      FX.glitch(400);
    }
    await speak(text + "\n\n" + memo({ latency, chars: text.length, erased, away, extra }),
                false, extra ? "" : text);
  });

  // ---------- 終わり ----------
  async function finish(quiet) {
    S.done = true; setInput(false);
    $("quit").hidden = true;
    FX.setSilence(0);
    if (quiet) FX.pause(); else FX.fade(4);
    let findings = "";
    if (!quiet && S.turn > 1) {
      findings = await speak(null, true) || "";
      if (findings) await karte(findings);
    }
    let path = "";
    if (S.log.length) {
      try {
        path = (await api("/api/record", { markdown: toMarkdown(findings) })).path;
        sysLine("記録を保存しました: " + path);
      } catch (e) {
        sysLine("記録を保存できませんでした: " + e.message);
      }
    }
    if (S.turn > 1) {
      store("minamo.last", { at: S.started.toISOString(), turns: S.turn,
        silence: Math.round(S.latencies.reduce((a, b) => a + b, 0)), findings: findings.slice(0, 160) });
    }
    FX.wakeLock(false);
    if (quiet) {
      againButton(lines);
      toBottom();
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
    h.textContent = "診療記録　" + d.getFullYear() + "." + pad(d.getMonth() + 1) + "." + pad(d.getDate());
    const stamp = document.createElement("div"); stamp.className = "stamp"; stamp.textContent = "所見";
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
    if (S.latencies.length) md += "## 沈黙\n\n" + S.latencies.map(x => x.toFixed(1) + "秒").join(", ") + "\n\n";
    if (findings) md += "## 所見\n\n" + findings.replace(/\[間\]/g, "……") + "\n";
    return md;
  }

  $("quit").onclick = () => { if (S && !S.done && !S.busy) finish(true); };

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
    if (prev) L.push(["  前回の面接 ................ " + fmtDate(prev.at) + "　沈黙 " + prev.silence + "秒", "beep"]);
    L.push(
      ["紹介状 ...................... " + (cfg.karte ? "6通（未開封）" : "なし"), "beep"],
      ["蔵書 ........................ 本 " + lib[0] + "冊 ／ ノート " + lib[1] + "件", "beep"],
      ["端末 ........................ " + (env.model || "不明") + "　応答あり", "beep"],
      ["", 0],
      ["回線を接続しています ", "modem"],
      ["接続しました。", 400],
      ["", 0],
      ["ミナモを起動します。", "beep"],
    );
    return L;
  }

  async function begin() {
    $("start").hidden = true;
    FX.configure(settings);
    FX.audioStart();
    FX.resume(0);
    FX.wakeLock(true);
    lines.textContent = "";
    $("wm").textContent = "";
    $("title").textContent = TITLES[0];
    const prev = load("minamo.last", null);
    await FX.boot($("boot"), bootLines(prev));
    booted = true;
    S = newSession();
    FX.setPhase(0);
    $("quit").hidden = false;
    sysLine("終わるときは「終わり」。演出なしですぐ抜けるときは右上の「面接をやめる」か /quit。");
    S.turn = 1;
    let extra = "面接が始まった。最初のあいさつをすること。";
    if (prev) {
      const days = Math.floor((Date.now() - new Date(prev.at)) / 86400000);
      extra = "面接が始まった。前回の面接記録がある（" + (days ? days + "日前" : "今日") + "、" +
              fmtDate(prev.at) + "、" + prev.turns + "回のやりとり、沈黙の合計" + prev.silence + "秒）。" +
              (prev.findings ? "前回の所見の書き出し：「" + prev.findings.replace(/\s+/g, " ") + "」。" : "") +
              "初対面のふりはせず、前回のことを覚えていると、あいさつの中でさりげなく示すこと。";
    }
    await speak(memo({ extra }));
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

  async function connect() {
    const st = $("status"), btn = $("begin");
    try {
      cfg = await api("/api/info");
    } catch (e) {
      st.innerHTML = "サーバーにつながりません。Termux で<br><code>sh ~/Claude/minamo/serve.sh</code><br>を動かしてから、もう一度開いてください。";
      btn.textContent = "もう一度つなぐ"; btn.disabled = false;
      btn.onclick = () => { btn.disabled = true; st.textContent = "接続を確かめています……"; connect(); };
      return;
    }
    if (!cfg.ready) {
      st.textContent = "サーバーは動いていますが、" + cfg.error + "。README の「APIキー」を見てください。";
      return;
    }
    st.textContent = "API: " + cfg.backend + (cfg.model ? " / " + cfg.model : "") +
                     (cfg.karte ? "　紹介状: あり" : "　紹介状: なし") +
                     "　蔵書: " + (cfg.library && (cfg.library[0] || cfg.library[1])
                       ? "本 " + cfg.library[0] + "冊・ノート " + cfg.library[1] + "件" : "なし");
    btn.textContent = "面接を始める"; btn.disabled = false;
    btn.onclick = () => begin();
  }

  FX.configure(settings);
  connect();
})();
