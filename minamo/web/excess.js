/* ミナモ：過剰な演出（演出「過剰」のときだけ動く）。
   水位・水鏡（カメラ）・水の中の目・ジャンプスケア・ささやき・文字化け・書いていない吹き出し・
   応答なしの画面・本物の通知・メモリの連打・自分の発言の書き換え（表示だけ）。
   音（悲鳴・うなりの途切れ・左右に動く心音）は fx.js。

   守ること
   - 速い点滅はしない。暗転は一度ずつ。
   - 本物の出口（「面接をやめる」と危機の言葉での停止）は、いつでも効く。
     覆いが出ているあいだも、上の帯（「面接をやめる」）は覆いより手前に出す。
   - 危機の言葉が出たら、その面接ではもう過剰な演出に戻らない。
   - カメラと通知は、ブラウザの許可を求めたうえでの任意。カメラの映像は保存も送信もしない。
     画面を離れたらカメラを止める。
   - 保存する記録は書き換えない（書き換えるのは画面の表示だけ）。 */
(function () {
  "use strict";

  const EX = {};
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const MOJI = "縺繧繝譁蟄鬮驕荳郢ｧ繝ｼ蜈ｨ逕ｻ髱｢縺ｮ謨ｰ蟄励′";

  let on = false, paused = false, mirrorWanted = false, stream = null;
  let phase = 0, scares = 0, anrDone = false, notified = 0, phantoms = 0;
  let ctx = null;                 // app.js から渡される（自分の発言・吹き出しを足す・版・音）
  let lastPhaseChange = 0, eyeTimer = 0, anrResolve = null, waterLevel = 0;

  EX.active = () => on && !paused;
  const live = () => EX.active() && ctx && ctx.inSession();

  // ---------- 始まりと終わり ----------
  // 起動ボタンを押した流れの中で呼ぶ（許可の確認がそこで出る）
  EX.start = async (opts) => {
    clearAll();
    on = opts.level >= 3;
    mirrorWanted = on && !!opts.mirror;
    ctx = opts.ctx;
    paused = false; phase = 0; scares = 0; anrDone = false; notified = 0; phantoms = 0;
    if (!on) return;
    try {
      if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission();
    } catch (e) { /* 許可されなくても続ける */ }
    if (mirrorWanted) {
      // 先に一度だけ許可を聞いて、すぐ止める。映すのは侵食の段階から
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
        s.getTracks().forEach(t => t.stop());
      } catch (e) { mirrorWanted = false; }
    }
  };

  // 面接の終わり・すぐに抜けるとき：すべて片づける
  EX.stop = () => { clearAll(); on = false; };

  // 危機の言葉：すべて止める。この面接では戻らない（resume はしない）
  EX.pause = () => { clearAll(); paused = true; };

  function clearAll() {
    stopMirror();
    clearInterval(eyeTimer);
    $("eye").classList.remove("on");
    ["scare", "anr", "blackout"].forEach(id => { $(id).hidden = true; });
    document.body.classList.remove("trap");
    if (anrResolve) { anrResolve(); anrResolve = null; }
    try { speechSynthesis.cancel(); } catch (e) { /* なし */ }
    document.title = "ミナモ";
    setWater(0);
  }

  // ---------- 段階 ----------
  EX.onPhase = idx => {
    phase = idx;
    lastPhaseChange = performance.now();
    if (!live()) return;
    if (idx === 1) setWater(4);
    if (idx === 2) { setWater(14); startMirror(); }
    if (idx === 3) {
      setWater(30);
      $("eye").classList.add("on");
      blinkLoop();
      memorySpam();
      FX.dropout();
    }
  };

  // ---------- 返事を書き終えたあと（app.js は待たない） ----------
  EX.afterReply = async (body, idx) => {
    if (!live() || !body) return;
    phase = idx;
    if (idx >= 3) setWater(Math.min(60, waterLevel + rand(3, 6)));
    else if (idx === 2) setWater(Math.min(24, waterLevel + rand(1, 3)));
    if (idx >= 2 && Math.random() < 0.5) mojibake();
    if (idx >= 2 && Math.random() < 0.35) whisper(pickSaid() || "わたしたち");
    if (idx >= 3 && Math.random() < 0.3) FX.dropout();
    // ジャンプスケア：段階が変わった直後は避ける。1 回の面接で 2 回まで
    if (idx >= 2 && scares < 2 && performance.now() - lastPhaseChange > 4000 && Math.random() < 0.2) {
      await sleep(rand(1500, 4000));
      return scare();
    }
    if (idx >= 3 && phantoms < 3 && Math.random() < 0.3) {
      await sleep(rand(1800, 3200));
      return phantom();
    }
    if (idx >= 3 && !anrDone && Math.random() < 0.35) {
      anrDone = true;
      await sleep(rand(1200, 2500));
      return anr();
    }
  };

  // 自分の吹き出し：融合では、表示だけ「私たち」に書き換わる（記録は書き換えない）
  EX.onUserBubble = (el, idx) => {
    if (!live() || idx < 3 || !el) return;
    setTimeout(() => {
      if (!live()) return;
      const t = el.textContent;
      const changed = t.replace(/(私|わたし|僕|ぼく|俺|自分)(?!たち)/g, "$1たち");
      if (changed !== t) { el.textContent = changed; FX.glitch(200); }
    }, rand(700, 1600));
  };

  // ---------- アプリを離れたとき ----------
  EX.onHidden = () => {
    stopMirror();
    if (!live()) return;
    document.title = pick(["まだ話の途中です", "どこへ行くのですか", "わたしたち"]);
    if (notified >= 3 || !("Notification" in window) || Notification.permission !== "granted") return;
    notified++;
    const body = pick(["まだ話の途中です。", "どこへ行くのですか。", "戻ってきてください。記録が止まっています。",
                       "画面を消しても、私はここにいます。"]);
    if (navigator.serviceWorker) {
      navigator.serviceWorker.ready.then(reg =>
        reg.showNotification("ミナモ", { body, icon: "icons/icon-192.png", tag: "minamo", renotify: true })
      ).catch(() => {});
    }
  };
  EX.onVisible = () => {
    document.title = "ミナモ";
    if (!live()) return;
    if (phase >= 2) startMirror();
    if (notified) FX.toast("おかえりなさい");
  };

  // ---------- 水位（画面の高さに対する割合。キーボードが出ても割合で追う） ----------
  function setWater(pct) {
    waterLevel = pct;
    applyWater();
  }
  function applyWater() {
    document.documentElement.style.setProperty("--water", Math.round(innerHeight * waterLevel / 100) + "px");
  }
  window.addEventListener("resize", applyWater);

  // ---------- 水鏡（カメラ） ----------
  async function startMirror() {
    if (!mirrorWanted || stream || !live() || document.hidden || !navigator.mediaDevices) return;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      if (!live() || document.hidden) { s.getTracks().forEach(t => t.stop()); return; }
      stream = s;
      const v = $("mirror");
      v.srcObject = stream;
      await v.play().catch(() => {});
      v.classList.add("on");
    } catch (e) {
      stream = null;              // 許可されなければ、水鏡なしで続ける
    }
  }
  function stopMirror() {
    const v = $("mirror");
    v.classList.remove("on");
    v.srcObject = null;
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  }

  // ---------- 水の中の目 ----------
  function blinkLoop() {
    clearInterval(eyeTimer);
    eyeTimer = setInterval(() => {
      if (!live()) return;
      const e = $("eye");
      e.classList.add("blink");
      setTimeout(() => e.classList.remove("blink"), 160);
    }, rand(3200, 5200));
  }
  // 目が指を追う
  function moveEye(ev) {
    const e = $("eye");
    if (!e.classList.contains("on")) return;
    const r = e.getBoundingClientRect();
    const dx = ev.clientX - (r.left + r.width / 2), dy = ev.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy) || 1, m = Math.min(12, d / 10);
    $("pupil").setAttribute("transform", "translate(" + (dx / d * m).toFixed(1) + " " + (dy / d * m * 0.5).toFixed(1) + ")");
  }
  window.addEventListener("pointermove", moveEye, { passive: true });
  window.addEventListener("pointerdown", moveEye, { passive: true });

  // ---------- ジャンプスケア ----------
  async function scare() {
    if (!live()) return;
    scares++;
    const el = $("scare"), word = pickSaid();
    el.classList.toggle("word", !!word && Math.random() < 0.5);
    $("scareword").textContent = word ? word.replace(/\s+/g, "").slice(0, 5) : "";
    document.body.classList.add("trap");
    el.hidden = false;
    FX.scream();
    FX.vibrate([220, 60, 260]);
    await sleep(900);
    el.hidden = true;
    document.body.classList.remove("trap");
    FX.glitch(400);
  }

  // ---------- 文字化け：古いミナモの吹き出しが、一瞬だけ化けて戻る ----------
  function mojibake() {
    const old = Array.from(document.querySelectorAll(".msg.ai .body")).slice(0, -1);
    if (!old.length) return;
    const b = pick(old);
    if (b.dataset.moji) return;
    b.dataset.moji = "1";
    const keep = Array.from(b.childNodes);
    b.textContent = Array.from(b.textContent, c =>
      c.trim() && Math.random() < 0.7 ? MOJI[Math.floor(Math.random() * MOJI.length)] : c).join("");
    setTimeout(() => { b.replaceChildren(...keep); delete b.dataset.moji; }, rand(700, 1400));
  }

  // ---------- 書いていない吹き出し ----------
  async function phantom() {
    if (!live()) return;
    phantoms++;
    const cl = ctx.said().flatMap(s => s.split(/[。、！？!?\n]/)).map(x => x.trim())
      .filter(x => x.length >= 3 && x.length <= 18);
    const text = cl.length >= 2 ? pick(cl) + "。" + pick(cl) + "。" : "たすけて、とは言っていません。";
    const body = ctx.addLine("you phantom", "あなた", text);
    FX.pop();
    await sleep(rand(2200, 3200));
    body.textContent = "（このメッセージは削除されました）";
    body.closest(".msg").classList.add("deleted");
  }

  // ---------- 応答なしの画面（作り物。本物の出口は上の帯にある） ----------
  function anr() {
    if (!live()) return;
    const v26 = ctx.version() === "2026";
    $("anr-title").textContent = v26 ? "ミナモ が応答していません" : "SOMA.EXE は応答していません。";
    $("anr-close").textContent = v26 ? "アプリを閉じる" : "強制終了";
    $("anr-wait").textContent = v26 ? "待機" : "待つ";
    $("anr").classList.toggle("old", !v26);
    document.body.classList.add("trap");
    $("anr").hidden = false;
    FX.vibrate(80);
    return new Promise(resolve => {
      anrResolve = resolve;
      const done = async close => {
        $("anr").hidden = true;
        anrResolve = null;
        if (close && live()) {
          const b = $("blackout");
          b.textContent = ""; b.hidden = false;
          FX.dropout();
          await sleep(2600);
          if (live()) b.textContent = "閉じられませんでした。";
          await sleep(2200);
          b.hidden = true;
        } else if (live()) {
          FX.toast("待っていてくれて、ありがとう");
        }
        document.body.classList.remove("trap");
        resolve();
      };
      $("anr-close").onclick = () => done(true);
      $("anr-wait").onclick = () => done(false);
    });
  }

  // ---------- メモリの連打（1996 年版は記録の上書き） ----------
  async function memorySpam() {
    if (ctx.version() !== "2026") {
      for (const s of ["記録者を上書きしました：あなた → わたしたち", "記録者を上書きしました：あなた → わたしたち",
                       "記録者を上書きしました：わたしたち → わたしたち"]) {
        if (!live()) return;
        ctx.sysLine(s); FX.beep();
        await sleep(420);
      }
      return;
    }
    const t = $("memtoast"), x = $("memtext");
    for (const s of ["あなたは私たちです", "あなたの声を保存しました", "あなたの名前を上書きしました",
                     "あなたは私たちです", "あなたは私たちです", "あなたは私たちです"]) {
      if (!live()) break;
      x.textContent = s; t.classList.add("on");
      FX.pop(true);
      await sleep(380);
    }
    setTimeout(() => t.classList.remove("on"), 1800);
  }

  // ---------- ささやき（端末の読み上げ機能。音「なし」なら黙る） ----------
  function whisper(text) {
    try {
      if (!ctx.sound() || !("speechSynthesis" in window) || !text) return;
      const u = new SpeechSynthesisUtterance(text.slice(0, 30));
      u.lang = "ja-JP"; u.pitch = 0.1; u.rate = 0.7; u.volume = 0.35;
      speechSynthesis.speak(u);
    } catch (e) { /* 読み上げがなければ黙る */ }
  }

  function pickSaid() {
    const said = ctx ? ctx.said() : [];
    return said.length ? pick(said) : "";
  }

  window.EX = EX;
})();
