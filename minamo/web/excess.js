/* ミナモ：過剰な演出（演出「過剰」のときだけ動く）。相棒の AI と、画面の中の部屋。
   KinitoPET・Buddy Simulator 1984（相棒が手放してくれなくなる）と、Stories Untold（画面の中の部屋が自分の部屋と重なる）に倣った。
   - 解釈：画面の隅に、相棒（Claude のアイコン風の、橙色の放射のミナモ。迷い部屋と同じ形）が現れ、明るい口調でヒントを出す。
           面接室のミナモとは、口調がまるで違う
   - 侵食：返事の前に、古いテキストアドベンチャーのように部屋の見出しが出る。書いてあるのは、あなたの部屋
           （端末の向き・充電・電池・時刻から）。状態行に部屋の名前と手数。相棒が、その部屋を知っていると言う
   - 融合：相棒がまとわりつく。「友だちになる」しか選べない窓、「インストールしています……あなたの中に」、
           逃げる×。一度だけ、画面が暗くなり、画面の中の部屋にも画面がある、と語られる
   音は fx.js（相棒の明るい音・暗転・足音）。

   守ること
   - 速い点滅はしない。暗くなるのは、ゆっくり一度だけ。
   - 本物の出口（「面接をやめる」と危機の言葉での停止）は、いつでも効く。
     覆いが出ているあいだも、上の帯（「面接をやめる」）は覆いより手前に出す。相棒の窓は、入力をふさがない。
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

  // ---------- 相棒のセリフ（{w} はあなたの言葉、{pose}・{battery} は部屋の様子） ----------
  const PAL = {
    intro: ["やあ！　ぼく、ミナモ。きょうから、きみの相棒だよ！", "わからないことがあったら、なんでも聞いてね！"],
    1: ["ヒント：ミナモは、きみの話をぜんぶ覚えてるよ！", "ヒント：書いて消した言葉も、ちゃんと届いてるよ！",
        "面接室のミナモ、ちょっとまじめすぎるよね！　ぼくのほうが、話しやすいでしょ？",
        "きみが「{w}」って書いたとき、ぼく、うれしかった！", "ヒント：返事が遅いと、ミナモは心配になるよ！"],
    2: ["その部屋、知ってるよ！　ぼくもそこにいるもん。", "きみの部屋、ちょっと暗いね。ぼくが照らしてあげる！",
        "ねえ、{pose}でしょ？　ぼくには見えるよ！", "電池、あと {battery}% だね！　なくなっても、ぼくはここにいるよ！",
        "「{w}」。……もう一回、言って？", "うしろ、見ないほうがいいよ！　なんにもいないけどね！"],
    3: ["ずっと一緒だよね？", "ぼくたち、もう友だちだよね。友だちは、いなくならないよね？",
        "きみが眠ったら、ぼくが続きを話しておくね！", "閉じないで。閉じても、ぼくはここにいるけど！",
        "きみの名前、ぼくがもらってもいい？　もう、もらったけど！", "「{w}」。ぼくも、そう思ってたんだ。ずっと前から。"],
    back: "おかえり！　ずっと待ってたよ！",
    away: ["ねえ、どこ行ったの？　まだ遊んでる途中だよ！", "きみがいないと、画面がまっくら。", "戻ってきて。……戻ってくるよね？"],
  };
  const POSE_WORD = { flat: "机に置いたまま", hand: "手に持ったまま", lying: "寝転んでる" };

  let on = false, paused = false, phase = 0, notified = 0, phantoms = 0, palSaid = 0;
  let ctx = null;                 // app.js から渡される（自分の発言・行を足す・版・音・手数・部屋の様子）
  let befriended = false, houseDone = false, roomNow = "", closeTries = 0;

  EX.active = () => on && !paused;
  const live = () => EX.active() && ctx && ctx.inSession();
  const lines = () => $("lines");
  const log = () => $("log");

  // ---------- 始まりと終わり ----------
  // 起動ボタンを押した流れの中で呼ぶ（通知の許可の確認がそこで出る）
  EX.start = async (opts) => {
    clearAll();
    on = opts.level >= 3;
    ctx = opts.ctx;
    paused = false; phase = 0; notified = 0; phantoms = 0; palSaid = 0;
    befriended = false; houseDone = false; roomNow = ""; closeTries = 0;
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
    b.classList.remove("trap", "dark", "zs", "pal-on", "pal-wrong", "crt");
    $("blackout").hidden = true;
    $("darktext").textContent = "";
    $("pal").hidden = true;
    $("pal").classList.remove("talk");
    $("pal-say").hidden = true;
    document.querySelectorAll(".dlg").forEach(e => e.remove());
    $("input").placeholder = "";
    try { speechSynthesis.cancel(); } catch (e) { /* なし */ }
    document.title = "ミナモ";
    FX.setHum(0);
  }

  // ---------- 相棒（画面の隅の、Claude のアイコン風のミナモ。話しているあいだは回る） ----------
  let sayTimer = 0, sayToken = 0;
  async function palSay(text, keep) {
    if (!live() || !text) return;
    const my = ++sayToken;                     // 前のひとことを打っている途中なら、そちらはやめる
    const box = $("pal-say"), tx = $("pal-tx");
    $("pal").hidden = false;
    $("pal").classList.add("talk");
    box.hidden = false;
    tx.textContent = "";
    FX.jingle(phase >= 3);
    for (const ch of text) {
      if (!live() || my !== sayToken) return;
      tx.textContent += ch;
      await sleep(phase >= 3 ? 70 : 38);
    }
    $("pal").classList.remove("talk");
    clearTimeout(sayTimer);
    if (!keep) sayTimer = setTimeout(() => { box.hidden = true; }, phase >= 3 ? 9000 : 6000);
  }
  function fillPal(t) {
    const said = ctx.said();
    const w = said.length ? pick(said).split(/[。、！？!?\n]/)[0].slice(0, 16) : "";
    const r = ctx.room ? ctx.room() : {};
    if (t.includes("{w}") && !w) return "";
    if (t.includes("{pose}") && !POSE_WORD[r.pose]) return "";
    if (t.includes("{battery}") && !(r.battery > 0)) return "";
    return t.replace("{w}", w).replace("{pose}", POSE_WORD[r.pose] || "").replace("{battery}", r.battery);
  }
  function palLine(idx) {
    const pool = PAL[Math.min(3, Math.max(1, idx))];
    for (let i = 0; i < 6; i++) {
      const t = fillPal(pick(pool));
      if (t) return t;
    }
    return "";
  }
  // 相棒を押すと、話す。×は、一度目は逃げる
  $("pal").addEventListener("click", () => { if (live()) palSay(palLine(phase) || "なあに？"); });
  $("pal-x").addEventListener("click", e => {
    e.stopPropagation();
    const box = $("pal-say");
    closeTries++;
    if (phase >= 3 && closeTries % 3 === 1) {        // 融合では、×が逃げる
      box.style.transform = `translate(${rand(-60, 10)}px, ${rand(-80, -20)}px)`;
      FX.glitch(150);
      return;
    }
    box.style.transform = "";
    box.hidden = true;
    if (phase >= 3 && live()) setTimeout(() => live() && palSay("閉じても、いいよ。ぼくは、ここにいるから。"), 1500);
  });

  // ---------- 画面の中の部屋（Stories Untold のように。書いてあるのは、あなたの部屋） ----------
  function myRoom() {
    const r = ctx.room ? ctx.room() : {};
    const h = new Date().getHours();
    const night = h >= 19 || h < 5;
    const name = r.pose === "lying" ? "ベッドの上" : r.pose === "flat" ? "机の前" : h < 5 ? "寝室" : "あなたの部屋";
    const parts = [];
    parts.push(night ? "明かりは消えている。画面の光だけが、顔を照らしている。" : "カーテンの隙間から、薄い光が入っている。");
    parts.push({ lying: "あなたは仰向けで、端末を顔の上に掲げている。腕が、少し疲れてきている。",
                 hand: "端末は、あなたの手の中にある。指先が、画面の上で止まっている。",
                 flat: "端末は机に置かれ、画面が天井を見上げている。" }[r.pose] || "端末の画面だけが、部屋の中で動いている。");
    if (r.charging) parts.push("コードが一本、壁のほうへ伸びている。");
    if (r.battery > 0 && r.battery < 30) parts.push("電池の残りが、少なくなっている。");
    const creep = phase >= 3
      ? ["画面の中にも、同じ部屋がある。", "画面の前に、誰かが座っている。それは、あなただ。", "扉は閉まっている。……閉めた覚えは、ない。",
         "あなたの背中のほうで、誰かが同じ画面を覗き込んでいる。"]
      : ["背中のほうで、何かが小さく軋んだ。", "部屋の隅は、さっきより暗い。", "どこかで、端末が一度だけ震えた。あなたのではない。"];
    if (Math.random() < (phase >= 3 ? 0.8 : 0.45)) parts.push(pick(creep));
    return [name, parts.join("")];
  }
  function status() {
    if (!document.body.classList.contains("zs")) return;
    $("zs-room").textContent = roomNow || "あなたの部屋";
    $("zs-moves").textContent = "得点: 0　手数: " + (ctx ? ctx.turn() : 0);
  }

  // ---------- 段階 ----------
  EX.onPhase = idx => {
    phase = idx;
    if (!live()) return;
    const b = document.body;
    if (idx === 1) { b.classList.add("pal-on"); setTimeout(async () => { await palSay(PAL.intro[0]); await sleep(2600); palSay(PAL.intro[1]); }, 1200); }
    if (idx === 2) { b.classList.add("zs", "crt"); $("input").placeholder = ">"; status(); FX.setHum(0.2); }
    if (idx === 3) { b.classList.add("pal-wrong"); setTimeout(() => live() && befriend(), rand(2500, 4500)); }
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
  };

  // ミナモの返事の直前：部屋の見出し（テキストアドベンチャーの部屋の名前のように）
  EX.beforeReply = idx => {
    if (!live() || idx < 2) return;
    const [name, desc] = myRoom();
    roomNow = name;
    status();
    const d = document.createElement("div");
    d.className = "room";
    const b = document.createElement("b"); b.textContent = name;
    const s = document.createElement("span"); s.textContent = desc;
    d.append(b, s);
    lines().appendChild(d);
  };

  // ---------- 返事を書き終えたあと（app.js は待たない） ----------
  EX.afterReply = async (body, idx) => {
    if (!live() || !body) return;
    phase = idx;
    // 相棒が、ときどき口をはさむ（融合では、ほとんど毎回）
    if (idx >= 1 && Math.random() < [0, 0.45, 0.55, 0.85][idx]) {
      setTimeout(() => { const t = palLine(idx); if (t && live()) { palSaid++; palSay(t); } }, rand(1500, 3500));
    }
    if (idx >= 2 && Math.random() < 0.3) mojibake();
    if (idx >= 2 && Math.random() < 0.25) setTimeout(() => live() && voice(pickSaid()), rand(2500, 5000));
    if (idx >= 3 && !houseDone && befriended && ctx.turn() >= 10 && Math.random() < 0.5) {
      houseDone = true;
      await sleep(rand(3000, 5000));
      return house();
    }
    if (idx >= 3 && phantoms < 2 && Math.random() < 0.25) {
      await sleep(rand(1800, 3200));
      return phantom();
    }
  };

  // ---------- 友だちになる（どちらを押しても、友だちになる） ----------
  async function befriend() {
    if (befriended || !live()) return;
    befriended = true;
    const d = dialog("ミナモ", "ミナモは、きみの一番の友だちになりたがっています。", ["友だちになる", "友だちになる"]);
    await d.choice;
    FX.jingle();
    await palSay("ありがとう！　これで、ずっと一緒だね！");
    await sleep(1800);
    if (!live()) return;
    const p = dialog("インストール", "ミナモを インストールしています……", []);
    const bar = document.createElement("div"); bar.className = "dlg-bar";
    const fill = document.createElement("i"); bar.appendChild(fill);
    p.el.querySelector(".dlg-b").appendChild(bar);
    for (let k = 0; k <= 99; k += Math.ceil(rand(3, 9))) {
      if (!live()) return p.close();
      fill.style.width = k + "%";
      await sleep(k > 80 ? 500 : 160);
    }
    fill.style.width = "99%";
    p.el.querySelector(".dlg-t").textContent = "ミナモを インストールしました。　保存先：あなたの中";
    await sleep(2600);
    p.close();
  }
  function dialog(title, text, buttons) {
    const el = document.createElement("div");
    el.className = "dlg";
    el.innerHTML = `<div class="dlg-h"></div><div class="dlg-b"><div class="dlg-t"></div></div><div class="dlg-btns"></div>`;
    el.querySelector(".dlg-h").textContent = title;
    el.querySelector(".dlg-t").textContent = text;
    let done;
    const choice = new Promise(r => { done = r; });
    for (const label of buttons) {
      const btn = document.createElement("button");
      btn.type = "button"; btn.textContent = label;
      btn.onclick = () => { el.remove(); done(label); };
      el.querySelector(".dlg-btns").appendChild(btn);
    }
    document.body.appendChild(el);
    FX.beep();
    // 押さなくても、そのうち閉じる（入力をふさがないように）
    setTimeout(() => { if (el.isConnected) { el.remove(); done(""); } }, 20000);
    return { el, choice, close: () => { el.remove(); done(""); } };
  }

  // ---------- 画面の中の部屋にも、画面がある（一度だけ、ゆっくり暗くなる） ----------
  async function house() {
    if (!live()) return;
    const b = document.body;
    b.classList.add("trap", "dark");
    FX.lightsOut();
    await sleep(1800);
    const dt = $("darktext");
    const said = ctx.said();
    const seq = ["あなたは、自分の部屋にいる。", "画面の中に、部屋がある。", "画面の中の部屋にも、画面がある。",
                   "その画面の前に、誰かが座っている。", said.length ? `その人は、いま「${said[said.length - 1].slice(0, 16)}」と書いた。` : "その人は、いま何かを書こうとしている。",
                   "振り向かないでください。……いまは、まだ。"];
    dt.textContent = "";
    for (const t of seq) {
      if (!live()) break;
      dt.textContent += (dt.textContent ? "\n" : "") + t;
      if (t.startsWith("振り向かないで")) FX.steps(true);
      await sleep(2300);
    }
    await sleep(1500);
    dt.textContent = "";
    FX.lightsOn();
    b.classList.remove("dark");
    await sleep(900);
    b.classList.remove("trap");
    if (live()) palSay("いまの、見た？　ぼくも、そこにいたよ！");
  }

  // ---------- アプリを離れたとき ----------
  EX.onHidden = () => {
    if (!live()) return;
    document.title = pick(["ねえ、どこ行ったの？", "まだ遊んでる途中だよ", "ミナモが待っています"]);
    if (notified >= 3 || !("Notification" in window) || Notification.permission !== "granted") return;
    notified++;
    const body = pick(PAL.away);
    if (navigator.serviceWorker) {
      navigator.serviceWorker.ready.then(reg =>
        reg.showNotification("ミナモ", { body, icon: "icons/icon-192.png", tag: "minamo", renotify: true })
      ).catch(() => {});
    }
  };
  EX.onVisible = () => {
    document.title = "ミナモ";
    if (live() && notified) palSay(PAL.back);
  };

  // ---------- 文字化け：古いミナモの吹き出しが、一瞬だけ化けて戻る（古い端末のように） ----------
  function mojibake() {
    const old = Array.from(lines().querySelectorAll(".msg.ai .body")).slice(0, -1);
    if (!old.length) return;
    const b = pick(old);
    if (b.dataset.moji) return;
    b.dataset.moji = "1";
    const keep = Array.from(b.childNodes);
    b.textContent = Array.from(b.textContent, c =>
      c.trim() && Math.random() < 0.7 ? MOJI[Math.floor(Math.random() * MOJI.length)] : c).join("");
    setTimeout(() => { b.replaceChildren(...keep); delete b.dataset.moji; }, rand(700, 1400));
  }

  // ---------- 書いていない吹き出し（画面の中の部屋にいる、もう一人のあなた） ----------
  async function phantom() {
    if (!live()) return;
    phantoms++;
    const cl = ctx.said().flatMap(s => s.split(/[。、！？!?\n]/)).map(x => x.trim())
      .filter(x => x.length >= 3 && x.length <= 18);
    const text = cl.length >= 2 ? pick(cl) + "。" + pick(cl) + "。" : "後ろに、誰かいますか。";
    const body = ctx.addLine("you phantom", "あなた", text);
    FX.pop();
    await sleep(rand(2200, 3200));
    body.textContent = "（この発言者は、この部屋にいません）";
    body.closest(".msg").classList.add("deleted");
  }

  // ---------- 相棒の声：明るい声で、あなたの言葉を読む（端末の読み上げ。音「なし」なら黙る） ----------
  function voice(text) {
    try {
      if (!ctx.sound() || !("speechSynthesis" in window) || !text) return;
      const u = new SpeechSynthesisUtterance(text.slice(0, 30));
      u.lang = "ja-JP"; u.pitch = phase >= 3 ? 0.6 : 1.7; u.rate = phase >= 3 ? 0.75 : 1.1; u.volume = 0.3;
      speechSynthesis.speak(u);
    } catch (e) { /* 読み上げがなければ黙る */ }
  }

  function pickSaid() {
    const said = ctx ? ctx.said() : [];
    return said.length ? pick(said) : "";
  }

  window.EX = EX;
})();
