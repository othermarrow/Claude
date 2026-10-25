/* ミナモ（PWA 版）の画面。
   会話の進め方は minamo.py の Session と同じ。API へはサーバー（server.py）を通して送る。
   画面版だけの観測：書きかけて消した文字数、画面を離れていた時間。 */
(function () {
  "use strict";

  const AI = "ミナモ", YOU = "あなた";
  const $ = id => document.getElementById(id);
  const lines = $("lines"), log = $("log"), input = $("input"), send = $("send"),
        label = $("label"), form = $("form");

  let cfg = null;               // /api/info
  let S = null;                 // 面接の状態

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
  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  const toBottom = () => { log.scrollTop = log.scrollHeight; };

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

  async function typeOut(text, phase, cls, who) {
    const body = addLine(cls || "ai", who === undefined ? AI : who, "");
    body.classList.add("cursor");
    const delay = phase.delay * 1000;
    const late = cfg.phases.indexOf(phase) >= 2;
    for (const part of text.split(/(\[間\])/)) {
      if (part === "[間]") {
        if (late && navigator.vibrate) navigator.vibrate(30);
        await sleep(rand(2000, 3500));
        continue;
      }
      for (const ch of part) {
        const stick = nearBottom();
        body.textContent += ch;
        if (stick) toBottom();
        if ("。？！?!".includes(ch)) await sleep(delay * 8);
        else if ("、…".includes(ch)) await sleep(delay * 4);
        else await sleep(delay * rand(0.6, 1.4));
        if ("、。".includes(ch) && Math.random() < phase.stall) await sleep(rand(1200, 3000));
      }
    }
    body.classList.remove("cursor");
  }

  // ---------- 面接 ----------
  function newSession() {
    return {
      contents: [], log: [], latencies: [], turn: 0, exitTries: 0,
      started: new Date(), unprompted: 0, busy: false, done: false,
      t0: 0, erased: 0, lastLen: 0, lastInput: 0, away: 0, hiddenAt: 0, silenceTimer: 0,
    };
  }

  function phase() {
    let p = cfg.phases[0];
    for (const ph of cfg.phases) if (S.turn >= ph.turn) p = ph;
    return p;
  }

  const pad = n => String(n).padStart(2, "0");

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

  async function speak(userText, findings) {
    S.busy = true; setInput(false);
    if (userText) S.contents.push({ role: "user", parts: [{ text: userText }] });
    const rec = document.createElement("div");
    rec.className = "recording"; rec.textContent = "（記録中）";
    lines.appendChild(rec); toBottom();
    let reply;
    try {
      reply = (await api("/api/ask", { contents: S.contents, findings: !!findings })).text;
    } catch (e) {
      rec.remove();
      if (userText) S.contents.pop();
      sysLine("[通信の不調] " + e.message + "\nTermux でサーバー（serve.sh）が動いているか確かめてください。");
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
    const last = cfg.phases[cfg.phases.length - 1];
    if (phase() === last && Math.random() < 0.3) return Math.random() < 0.5 ? AI : "わたしたち";
    return YOU;
  }

  function setInput(on) {
    input.disabled = !on; send.disabled = !on;
    if (on) {
      label.textContent = promptLabel() + "：";
      S.t0 = performance.now(); S.erased = 0; S.lastLen = input.value.length;
      S.lastInput = performance.now(); S.away = 0;
      armSilence();
      input.focus({ preventScroll: true });
    } else {
      clearTimeout(S.silenceTimer);
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
    S.unprompted++;
    const waited = (performance.now() - S.t0) / 1000;
    const half = input.value.trim()
      ? "入力欄に何か書きかけたまま、送らずにいる。"
      : (S.erased ? "何かを書きかけて、消した。" : "");
    const keepT0 = S.t0, keepErased = S.erased;
    await speak(memo({ extra: "相手は" + Math.round(waited) + "秒間、何も送っていない。" + half +
                              "沈黙について、あなたのほうから話しかけること。" }));
    // 返答までの時間は、最初に入力を促したときから数え続ける
    S.t0 = keepT0; S.erased = keepErased;
  }

  input.addEventListener("input", () => {
    const len = input.value.length;
    if (len < S.lastLen) S.erased += S.lastLen - len;
    S.lastLen = len;
    S.lastInput = performance.now();
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
    if (!S || S.done) return;
    if (document.hidden) {
      S.hiddenAt = performance.now();
      clearTimeout(S.silenceTimer);
    } else if (S.hiddenAt) {
      const gone = performance.now() - S.hiddenAt;
      S.away += gone / 1000;
      S.lastInput += gone;              // 離れていた分は沈黙に数えない
      S.hiddenAt = 0;
      if (!S.busy) armSilence();
    }
  });

  const hasAny = (text, words) => words.some(w => text.toLowerCase().includes(w.toLowerCase()));

  function crisisAsk() {
    return new Promise(resolve => {
      const box = $("crisis");
      box.hidden = false;
      $("crisis-go").onclick = () => { box.hidden = true; resolve(true); };
      $("crisis-stop").onclick = () => { box.hidden = true; resolve(false); };
    });
  }

  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (S.busy || S.done) return;
    const text = input.value.trim();
    if (!text) return;
    const latency = (performance.now() - S.t0) / 1000;
    const erased = S.erased, away = S.away;
    input.value = ""; input.style.height = "auto"; S.lastLen = 0;
    setInput(false);
    if (text === "/quit") return finish(true);
    S.unprompted = 0;
    S.turn++;
    S.latencies.push(latency);
    S.log.push([YOU, text]);
    addLine("you", label.textContent.replace(/：$/, ""), text);

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
    }
    await speak(text + "\n\n" + memo({ latency, chars: text.length, erased, away, extra }));
  });

  // ---------- 終わり ----------
  async function finish(quiet) {
    S.done = true; setInput(false);
    $("quit").hidden = true;
    let findings = "";
    if (!quiet && S.turn > 1) {
      findings = await speak(null, true) || "";
      if (findings) {
        sysLine("―― 面接記録 ――");
        await typeOut(findings, cfg.phases[0], "note", "");
      }
    }
    if (S.log.length) {
      try {
        const r = await api("/api/record", { markdown: toMarkdown(findings) });
        sysLine("記録を保存しました: " + r.path);
      } catch (e) {
        sysLine("記録を保存できませんでした: " + e.message);
      }
    }
    const again = document.createElement("button");
    again.className = "btn"; again.type = "button"; again.textContent = "もう一度、面接を受ける";
    again.style.cssText = "background:none;border:1px solid var(--line);border-radius:4px;padding:.4em 1em;margin:.5em 0 2em;cursor:pointer";
    again.onclick = () => begin();
    lines.appendChild(again); toBottom();
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
  async function begin() {
    $("start").hidden = true;
    lines.textContent = "";
    S = newSession();
    $("quit").hidden = false;
    sysLine("SOMA 対話支援システム ver.0.9.7  (c)1996\n終わるときは「終わり」。演出なしですぐ抜けるときは右上の「面接をやめる」か /quit。");
    S.turn = 1;
    await speak(memo({ extra: "面接が始まった。最初のあいさつをすること。" }));
  }

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
                     (cfg.karte ? "　紹介状: あり" : "　紹介状: なし");
    btn.textContent = "面接を始める"; btn.disabled = false;
    btn.onclick = () => begin();
  }

  connect();
})();
