/* 階層目録：共通の演出（背景キャンバス・走査線・ネオンの格言・揺れ・bytebeat・振動）
   各ゲームは <script src="../fx.js"></script> で読みこみ、FX.level() などを呼ぶ。
   設定は起動画面と共有する（localStorage の bpwa.settings）。読めなくてもゲームは遊べる。 */
(function () {
  "use strict";
  const SKEY = "bpwa.settings";
  const DEF = { sound: true, vibe: true, motion: true };
  let settings = Object.assign({}, DEF);
  try { Object.assign(settings, JSON.parse(localStorage.getItem(SKEY) || "{}")); } catch (e) { /* 既定のまま */ }
  const reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const moving = () => settings.motion && !reduced;

  // 階層ごとのネオン2色と、背景の描き方
  const LV = {
    0: { a: "#ffe66d", b: "#ff2a85", bg: "tags", hum: 60 },
    1: { a: "#00f5d4", b: "#ff007f", bg: "scope", hum: 55 },
    2: { a: "#ff9e00", b: "#ff0055", bg: "scope", hum: 42 },
    3: { a: "#00e5ff", b: "#ff2a85", bg: "spark", hum: 62.5 },
    4: { a: "#00f0ff", b: "#ff2a85", bg: "wire", hum: 48 },
    5: { a: "#ffaa44", b: "#ff2255", bg: "scope", hum: 36 },
    6: { a: "#00ffcc", b: "#ff1e56", bg: "dark", hum: 0 },
    7: { a: "#3fa9ff", b: "#00ffd0", bg: "sea", hum: 30 },
    8: { a: "#d8a24a", b: "#7dff6a", bg: "drip", hum: 33 },
    9: { a: "#b38cff", b: "#ff8a3d", bg: "stars", hum: 0 },
    10: { a: "#ffd23f", b: "#9dff3f", bg: "field", hum: 0 },
    11: { a: "#00f0ff", b: "#ff00c8", bg: "grid", hum: 50 },
    37: { a: "#7ff7ff", b: "#ffffff", bg: "water", hum: 0 },
    fun: { a: "#ff4fd8", b: "#ffe600", bg: "confetti", hum: 72 },
    run: { a: "#ff2a2a", b: "#ffffff", bg: "rain", hum: 90 },
    white: { a: "#c8f6ff", b: "#ff6bb0", bg: "tags", hum: 0 },
  };
  // 流れる文字。標本の仕分け（core/related/off）、照合の一致率、bytebeat の式、ドラムの名前もまぜる
  const TAGS = ["[クラス ?]", "[未判定]", "M.E.G.", "[記録欠損]", "Lv.?", "[no-clip]", "[core]", "[related]", "[off]", "[年不明]",
    "一致率 98.8%", "取りこぼし 2", "t&(t>>4|t>>9)", "bd sd hh", "chr(10)", "[要再判定]", "[到達者 0]", "[座標不明]", "A.W. 500ml", "[通信途絶]", "☽ +90°", "13 星座"];
  const TRUISMS = [
    ["IF YOU ARE NOT CAREFUL YOU WILL NOCLIP", "気をつけなければ、すり抜ける"],
    ["A ROOM WITH NO PURPOSE STILL HAS A DOOR", "目的のない部屋にも、扉はある"],
    ["THE HUM IS NOT FOR YOU", "あの唸りは、あなたに向けたものではない"],
    ["DO NOT TRUST WHAT SMILES IN THE DARK", "暗闇で笑うものを信じるな"],
    ["COUNTING IS A WAY OF STAYING", "数えることは、留まる方法のひとつだ"],
    ["NO ONE HAS WRITTEN WHY YOU ARE HERE", "あなたがここにいる理由は、誰も書いていない"],
    ["WATER THAT TASTES OF ALMONDS IS STILL WATER", "アーモンドの味がしても、水は水だ"],
    ["THE MAP IS NEVER THE SAME TWICE", "地図は、二度と同じにならない"],
    ["CHECK BEFORE YOU BELIEVE", "信じる前に、確かめよ"],
    ["WHAT IS NOT WRITTEN SHOULD NOT BE FILLED IN", "書かれていないことを、埋めてはならない"],
    ["KEEP THE PURPOSE, CHANGE THE MEANS", "目的は動かさず、手段を替えよ"],
    ["EVERY BEHAVIOR IS TRYING TO SAY SOMETHING", "どの行動も、何かを伝えようとしている"],
    ["ONE JUDGMENT IS NEVER ENOUGH", "ひとつの判定では、足りない"],
    ["A SUMMARY CAN OVERWRITE A MEMORY", "要約は、記憶を上書きすることがある"],
  ];

  const css = `
#fx-bg{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;opacity:.34}
#fx-crt{position:fixed;inset:0;pointer-events:none;z-index:8;
 background:linear-gradient(rgba(18,16,16,0) 50%,rgba(0,0,0,.26) 50%),radial-gradient(circle at center,transparent 58%,rgba(0,0,0,.62) 100%);
 background-size:100% 3px,100% 100%}
body.fx-thermal #fx-crt{background:linear-gradient(rgba(30,0,8,0) 50%,rgba(0,0,0,.34) 50%),radial-gradient(circle at center,transparent 40%,rgba(255,30,70,.28) 85%,rgba(0,0,0,.82) 100%);background-size:100% 3px,100% 100%}
#app{position:relative;z-index:2}
#fx-truism{position:fixed;top:2.35em;left:12px;right:12px;pointer-events:none;z-index:6;padding:.35em .65em;
 background:rgba(5,5,10,.86);border-left:3px solid var(--fx-b,#ff2a85);
 box-shadow:0 0 18px color-mix(in srgb,var(--fx-b,#ff2a85) 30%,transparent),inset 0 0 12px color-mix(in srgb,var(--fx-a,#00f0ff) 14%,transparent);
 opacity:0;transform:translateY(-6px);transition:opacity .35s ease,transform .35s ease}
#fx-truism.show{opacity:1;transform:none}
#fx-truism .en{display:block;font-family:"DotGothic16",monospace;font-size:.72em;letter-spacing:.12em;color:var(--fx-a,#00f0ff);text-shadow:0 0 8px var(--fx-a,#00f0ff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#fx-truism .ja{display:block;font-family:"Shippori Mincho","Hiragino Mincho ProN","Yu Mincho",serif;font-size:.95em;color:#fff;text-shadow:0 0 10px var(--fx-b,#ff2a85),0 0 20px var(--fx-b,#ff2a85);margin-top:.05em}
#fx-truism .src{display:block;font-size:.62em;opacity:.6;text-align:right;color:#fff}
#fx-flash{position:fixed;inset:0;pointer-events:none;z-index:9;background:#fff;opacity:0}
#fx-flash.on{animation:fxflash .5s ease-out 1}
@keyframes fxflash{0%{opacity:.85}100%{opacity:0}}
body.fx-black #app{opacity:.04;transition:opacity .08s}
@media (prefers-reduced-motion:no-preference){
 body.fx-shock #app{animation:fxshock .42s cubic-bezier(.36,.07,.19,.97) both}
 @keyframes fxshock{0%{transform:none;filter:none}20%{transform:translate(-4px,2px);filter:drop-shadow(-3px 0 #ff0055) drop-shadow(3px 0 #00f5d4)}40%{transform:translate(4px,-2px)}60%{transform:translate(-3px,-1px);filter:drop-shadow(2px 0 #ff0055) drop-shadow(-2px 0 #00f5d4)}80%{transform:translate(2px,2px)}100%{transform:none;filter:none}}
 body.fx-shock2 #app{animation:fxshock2 .9s steps(8,end) both}
 @keyframes fxshock2{0%{transform:none}10%{transform:translate(-8px,0) skewX(4deg);filter:invert(1) drop-shadow(4px 0 #f05)}25%{transform:translate(6px,3px);filter:none}40%{transform:translate(-3px,-4px) scale(1.02);filter:hue-rotate(160deg)}60%{transform:translate(5px,1px);filter:drop-shadow(-4px 0 #0fd)}80%{transform:translate(-2px,2px);filter:none}100%{transform:none}}
 body.fx-jitter #app{animation:fxjit .18s steps(3,end) 1}
 @keyframes fxjit{0%{transform:none}50%{transform:translate(2px,-1px);filter:drop-shadow(-2px 0 #f05)}100%{transform:none}}
}
#fx-vhs{position:fixed;inset:0;pointer-events:none;z-index:7;display:none;font-family:"DotGothic16",monospace;color:#fff;text-shadow:0 0 4px #000,1px 0 #f05,-1px 0 #0fd}
body.fx-vhs-on #fx-vhs{display:block}
#fx-vhs .rec{position:absolute;top:calc(2.6em + env(safe-area-inset-top,0px));left:14px;font-size:.8em;letter-spacing:.1em}
#fx-vhs .rec::before{content:"●";color:#ff2a2a;margin-right:.35em}
#fx-vhs .tc{position:absolute;bottom:calc(.6em + env(safe-area-inset-bottom,0px));right:14px;font-size:.72em;letter-spacing:.08em;opacity:.85}
#fx-vhs .band{position:absolute;left:0;right:0;height:14px;top:-20px;background:linear-gradient(transparent,rgba(255,255,255,.18),transparent);mix-blend-mode:screen}
@media (prefers-reduced-motion:no-preference){
 body:not(.fx-still) #fx-vhs .rec::before{animation:fxrec 1s steps(1) infinite}
 @keyframes fxrec{50%{opacity:0}}
 body:not(.fx-still) #fx-vhs .band{animation:fxband 7s linear infinite}
 @keyframes fxband{0%,70%{top:-20px}100%{top:110%}}
}
body.fx-still.fx-shock #app,body.fx-still.fx-shock2 #app,body.fx-still.fx-jitter #app{animation:none}`;

  let bg, ctx, crt, tru, flash, vhs, vhsTimer = 0, W = 360, H = 640, tick = 0, last = 0;
  // 黄道の12とへびつかい座。色つきの絵文字にならないよう、異体字セレクタ（U+FE0E）で線画にする
  const ZODIAC = ["♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "⛎", "♐", "♑", "♒", "♓"].map(c => c + "\uFE0E");
  let aligned = false;
  let cur = { key: 0, a: "#ffe66d", b: "#ff2a85", mode: "tags", hum: 60 }, stress = 0, tags = TAGS.slice(), truisms = TRUISMS.slice();
  let ready = false;

  function mount() {
    if (ready || !document.body) return;
    ready = true;
    const st = document.createElement("style");
    st.textContent = css;
    document.head.appendChild(st);
    bg = document.createElement("canvas"); bg.id = "fx-bg"; bg.setAttribute("aria-hidden", "true");
    crt = document.createElement("div"); crt.id = "fx-crt"; crt.setAttribute("aria-hidden", "true");
    tru = document.createElement("div"); tru.id = "fx-truism"; tru.setAttribute("aria-hidden", "true");
    tru.innerHTML = '<span class="en"></span><span class="ja"></span><span class="src"></span>';
    flash = document.createElement("div"); flash.id = "fx-flash"; flash.setAttribute("aria-hidden", "true");
    document.body.prepend(bg);
    vhs = document.createElement("div"); vhs.id = "fx-vhs"; vhs.setAttribute("aria-hidden", "true");
    vhs.innerHTML = '<span class="rec">REC</span><span class="tc"></span><span class="band"></span>';
    document.body.append(crt, tru, flash, vhs);
    ctx = bg.getContext("2d");
    resize();
    window.addEventListener("resize", resize);
    document.body.classList.toggle("fx-still", !moving());
    apply();
    requestAnimationFrame(draw);
    // 音は、最初に触ったときにしか鳴らせない
    const unlock = () => { A.init(); A.hum(cur.hum); };
    // ボタンやキーを押したら、乾いた小さな音
    document.addEventListener("pointerdown", e => {
      const b = e.target.closest && e.target.closest("button, .key, .pk, .bk, [role=button]");
      if (b) A.tone(700 + Math.random() * 500, 0.022, "triangle", 0.025);
    }, true);
    window.addEventListener("pointerdown", unlock, { once: true, capture: true });
    window.addEventListener("keydown", unlock, { once: true, capture: true });
    document.addEventListener("visibilitychange", () => { if (A.ctx) { if (document.hidden) A.ctx.suspend(); else if (settings.sound) A.ctx.resume(); } });
  }
  function resize() { if (!bg) return; W = bg.width = window.innerWidth || 360; H = bg.height = window.innerHeight || 640; }
  function apply() {
    const r = document.documentElement.style;
    r.setProperty("--fx-a", cur.a);
    r.setProperty("--fx-b", cur.b);
    if (document.body) document.body.dataset.fxlv = String(cur.key);
  }

  // ---- 背景 ----
  const P = {
    tags() {
      ctx.font = "11px monospace";
      ctx.fillStyle = hexA(cur.a, 0.5);
      for (let i = 0; i < 8; i++) {
        const x = (i * 97 + tick * 0.3) % Math.max(60, W - 60);
        const y = ((i * 131 + tick * 0.5) % Math.max(120, H - 120)) + 40;
        ctx.fillText(tags[(i + (tick >> 9)) % tags.length], x, y);
      }
    },
    scope() {
      ctx.strokeStyle = hexA(cur.a, 0.55); ctx.lineWidth = 1.4; ctx.beginPath();
      const by = H * 0.72, k = 1.35 + stress * 1.5;
      for (let x = 0; x < W; x += 3) {
        const t = x * 2 + tick * 4;
        const v = (t & (t >> 4 | t >> 9)) & 63;
        const y = by + (v - 32) * k;
        x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
      P.tags();
    },
    spark() {
      P.scope();
      if (Math.random() < 0.06 + stress * 0.2) {
        ctx.strokeStyle = hexA(cur.b, 0.9); ctx.lineWidth = 1; ctx.beginPath();
        let x = Math.random() * W, y = 0; ctx.moveTo(x, y);
        while (y < H * 0.5) { x += (Math.random() - 0.5) * 40; y += 12 + Math.random() * 20; ctx.lineTo(x, y); }
        ctx.stroke();
      }
    },
    wire() {
      const cx = W * 0.5, cy = H * 0.38, r = Math.min(W, H) * 0.32, rot = tick * 0.0015;
      ctx.strokeStyle = hexA(cur.a, 0.4); ctx.fillStyle = hexA(cur.b, 0.6); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.68, 0, 7); ctx.stroke();
      const pts = [];
      for (let i = 0; i < 13; i++) { const a = i / 13 * Math.PI * 2 + rot; pts.push([cx + Math.cos(a) * r * 0.84, cy + Math.sin(a) * r * 0.84]); }
      ctx.beginPath();
      pts.forEach((p, i) => { const q = pts[(i + 4) % 13]; ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); });
      ctx.stroke();
      ctx.font = "15px monospace";
      pts.forEach((p, i) => ctx.fillText(ZODIAC[i], p[0] - 7, p[1] + 5));
      // 月。そろうまでは 90 度右にずれて見える
      const ma = rot + (aligned ? 0 : Math.PI / 2);
      ctx.font = "11px monospace";
      ctx.fillStyle = aligned ? hexA(cur.a, 0.9) : "rgba(255,56,100,.85)";
      ctx.fillText(aligned ? "☽ [ALIGNED 13]" : "☽ [+90° ERR]", cx + Math.cos(ma) * r * 0.45 - 34, cy + Math.sin(ma) * r * 0.45);
    },
    dark() {
      // ほとんど何も見えない。ときどき、二つの白い点
      if ((tick % 600) < 40 || stress > 0.6 && Math.random() < 0.02) {
        const x = W * (0.2 + 0.6 * ((tick / 600 | 0) * 0.37 % 1)), y = H * 0.4;
        ctx.fillStyle = "rgba(255,255,255,.8)";
        ctx.fillRect(x, y, 3, 2); ctx.fillRect(x + 16, y, 3, 2);
      }
      ctx.fillStyle = "rgba(255,255,255,.05)";
      for (let i = 0; i < 40; i++) ctx.fillRect(Math.random() * W, Math.random() * H, 1, 1);
    },
    sea() {
      for (let j = 0; j < 4; j++) {
        ctx.strokeStyle = hexA(j % 2 ? cur.b : cur.a, 0.25 + j * 0.08); ctx.lineWidth = 1; ctx.beginPath();
        const by = H * (0.55 + j * 0.1);
        for (let x = 0; x <= W; x += 6) {
          const y = by + Math.sin(x * 0.02 + tick * 0.02 * (j + 1)) * (6 + j * 4) + Math.sin(x * 0.005 - tick * 0.01) * 10;
          x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
      // 下を通る、大きな影
      const sx = ((tick * 0.4) % (W + 400)) - 200;
      ctx.fillStyle = "rgba(0,0,0,.35)";
      ctx.beginPath(); ctx.ellipse(sx, H * 0.86, 160, 26, 0, 0, 7); ctx.fill();
    },
    drip() {
      ctx.fillStyle = hexA(cur.a, 0.55);
      for (let i = 0; i < 18; i++) {
        const x = (i * 53.3) % W, sp = 1 + (i % 5) * 0.6;
        const y = (tick * sp + i * 97) % (H + 40) - 20;
        ctx.fillRect(x, y, 1.5, 6);
      }
      ctx.strokeStyle = hexA(cur.b, 0.25); ctx.beginPath();
      for (let x = 0; x <= W; x += 10) { const y = 30 + Math.abs(Math.sin(x * 0.07)) * 26; x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
    },
    stars() {
      for (let i = 0; i < 60; i++) {
        const x = (i * 71.7) % W, y = (i * 37.3) % (H * 0.55);
        ctx.fillStyle = hexA(i % 7 ? "#ffffff" : cur.a, 0.25 + 0.5 * Math.abs(Math.sin(tick * 0.01 + i)));
        ctx.fillRect(x, y, 1.5, 1.5);
      }
      ctx.fillStyle = "rgba(0,0,0,.55)";
      for (let i = 0; i < 6; i++) {
        const x = i * W / 6, w = W / 7, h = 40 + (i * 29 % 50);
        ctx.fillRect(x, H * 0.78 - h, w, h + H);
        ctx.beginPath(); ctx.moveTo(x - 6, H * 0.78 - h); ctx.lineTo(x + w / 2, H * 0.78 - h - 28); ctx.lineTo(x + w + 6, H * 0.78 - h); ctx.fill();
        if ((i + (tick >> 7)) % 3 === 0) { ctx.fillStyle = hexA(cur.b, 0.7); ctx.fillRect(x + w * 0.4, H * 0.78 - h + 14, 8, 10); ctx.fillStyle = "rgba(0,0,0,.55)"; }
      }
    },
    field() {
      ctx.strokeStyle = hexA(cur.a, 0.4); ctx.lineWidth = 1;
      for (let i = 0; i < 70; i++) {
        const x = (i * 13.7) % W, base = H * 0.95, h = 60 + (i * 17 % 70);
        const sway = Math.sin(tick * 0.02 + i * 0.4) * 10;
        ctx.beginPath(); ctx.moveTo(x, base); ctx.quadraticCurveTo(x + sway * 0.4, base - h * 0.6, x + sway, base - h); ctx.stroke();
      }
    },
    grid() {
      const hz = H * 0.42;
      ctx.strokeStyle = hexA(cur.b, 0.35); ctx.lineWidth = 1;
      for (let i = -12; i <= 12; i++) { ctx.beginPath(); ctx.moveTo(W / 2 + i * 8, hz); ctx.lineTo(W / 2 + i * W * 0.18, H); ctx.stroke(); }
      for (let j = 0; j < 14; j++) {
        const t = ((j + (tick * 0.01) % 1) / 14); const y = hz + (H - hz) * t * t;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      ctx.fillStyle = hexA(cur.a, 0.45);
      for (let i = 0; i < 12; i++) { const w = 14 + (i * 7 % 18), h = 30 + (i * 37 % 120); ctx.fillRect((i * W / 12), hz - h, w, h); }
    },
    water() {
      ctx.strokeStyle = hexA(cur.a, 0.35); ctx.lineWidth = 1;
      for (let i = 0; i < 9; i++) {
        const r = ((tick * 0.6 + i * 60) % 540);
        ctx.beginPath(); ctx.arc(W * ((i * 0.31) % 1), H * ((i * 0.53) % 1), r, 0, 7); ctx.stroke();
      }
    },
    confetti() {
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = i % 2 ? hexA(cur.a, 0.7) : hexA(cur.b, 0.7);
        const x = (i * 41.3 + Math.sin(tick * 0.03 + i) * 20) % W, y = (tick * (1 + i % 3) + i * 61) % H;
        ctx.save(); ctx.translate(x, y); ctx.rotate(tick * 0.05 + i); ctx.fillRect(-3, -1.5, 6, 3); ctx.restore();
      }
      if ((tick % 240) < 120) { ctx.font = "28px monospace"; ctx.fillStyle = hexA(cur.a, 0.35); ctx.fillText("=)", W * 0.7, H * 0.3); }
    },
    rain() {
      ctx.font = "13px monospace"; ctx.fillStyle = hexA(cur.a, 0.7);
      for (let i = 0; i < 26; i++) {
        const x = (i * 29) % W, y = (tick * (6 + i % 4) + i * 83) % (H + 20);
        ctx.fillText("!", x, y);
      }
    },
  };
  function draw(ts) {
    requestAnimationFrame(draw);
    if (document.hidden || !ctx) return;
    // 30fps でじゅうぶん。動きを減らす設定なら、ゆっくり描く
    const step = moving() ? 33 : 1000;
    if (ts - last < step) return;
    last = ts;
    tick += moving() ? 1 : 30;
    ctx.clearRect(0, 0, W, H);
    try { (P[cur.mode] || P.tags)(); } catch (e) { /* 描けなくてもよい */ }
    if (stress > 0.5 && moving() && Math.random() < (stress - 0.5) * 0.08) jitter();
  }
  function hexA(hex, a) {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
  }
  function pulse(cls, ms) {
    if (!document.body) return;
    document.body.classList.remove(cls);
    void document.body.offsetWidth;
    document.body.classList.add(cls);
    setTimeout(() => document.body.classList.remove(cls), ms);
  }
  function jitter() { pulse("fx-jitter", 200); }

  // ---- 音 ----
  const A = {
    ctx: null, osc: null, gain: null, filt: null,
    init() {
      if (this.ctx || !settings.sound) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.osc = this.ctx.createOscillator(); this.osc.type = "sawtooth"; this.osc.frequency.value = 60;
        this.filt = this.ctx.createBiquadFilter(); this.filt.type = "lowpass"; this.filt.frequency.value = 160;
        this.gain = this.ctx.createGain(); this.gain.gain.value = 0.0001;
        this.osc.connect(this.filt); this.filt.connect(this.gain); this.gain.connect(this.ctx.destination);
        this.osc.start();
      } catch (e) { this.ctx = null; }
    },
    live() { if (!this.ctx || !settings.sound) return false; if (this.ctx.state === "suspended") this.ctx.resume(); return true; },
    hum(f) {
      if (!this.live() || !this.gain) return;
      const now = this.ctx.currentTime;
      if (!f) { this.gain.gain.setTargetAtTime(0.0001, now, 0.2); return; }
      this.osc.frequency.setTargetAtTime(f * (1 - stress * 0.06), now, 0.3);
      this.gain.gain.setTargetAtTime(0.012 + stress * 0.01, now, 0.3);
    },
    tone(freq, dur, type, vol) {
      if (!this.live()) return;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain(), t = this.ctx.currentTime;
      o.type = type || "triangle"; o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.03, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t + dur + 0.02);
    },
    burst(mode, dur) {
      if (!this.live()) return;
      const sr = 8000, len = Math.floor(sr * (dur || 0.55));
      const buf = this.ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
      const off = (Math.random() * 4096 | 0) * 64;
      for (let i = 0; i < len; i++) {
        const t = i + off;
        const v = mode === 1 ? (t * (t >> 5 | t >> 8)) & 255
          : mode === 2 ? (t * 5 & t >> 7 | t * 3 & t >> 10) & 255
          : ((t & (t >> 4 | t >> 9)) * 4) & 255;
        d[i] = ((v / 128) - 1) * 0.07 * (1 - i / len);
      }
      const s = this.ctx.createBufferSource(); s.buffer = buf; s.connect(this.ctx.destination); s.start();
    },
  };

  // ---- 公開する道具 ----
  const FX = {
    get settings() { return Object.assign({}, settings); },
    set(k, v) {
      settings[k] = v;
      try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch (e) { /* 残らなくてもよい */ }
      if (k === "sound") { if (v) { A.init(); A.hum(cur.hum); } else if (A.ctx) A.hum(0); }
      if (k === "motion" && document.body) document.body.classList.toggle("fx-still", !moving());
    },
    // 階層を変える。key は 0〜11 の数か "37" "fun" "run" "white"。opt で色・背景・唸りを上書きできる
    level(key, opt) {
      mount();
      const base = LV[key] || LV[String(key)] || LV[0];
      cur = Object.assign({ key }, { a: base.a, b: base.b, mode: base.bg, hum: base.hum }, opt || {});
      apply();
      A.hum(cur.hum);
    },
    stress(x) {
      stress = Math.max(0, Math.min(1, +x || 0));
      if (document.body) document.body.classList.toggle("fx-thermal", stress >= 0.6);
      A.hum(cur.hum);
    },
    // 月と星座がそろう（true）か、ずれる（false）
    align(v) { aligned = !!v; },
    tags(list) { if (Array.isArray(list) && list.length) tags = list.slice(); },
    truisms(list) { if (Array.isArray(list) && list.length) truisms = list.slice(); },
    truism(en, ja, src) {
      mount();
      if (en == null) { const t = truisms[Math.random() * truisms.length | 0]; en = t[0]; ja = t[1]; src = src || t[2]; }
      tru.querySelector(".en").textContent = en || "";
      tru.querySelector(".ja").textContent = ja || "";
      tru.querySelector(".src").textContent = src ? "—— [" + src + "]" : "";
      tru.classList.add("show");
      clearTimeout(FX._tt);
      FX._tt = setTimeout(() => tru.classList.remove("show"), 4200);
      A.tone(1320, 0.08, "square", 0.012);
    },
    // 強さ 1：揺れと短いノイズ。2：反転まじりの大きな乱れ
    shock(power) {
      mount();
      if (power === 2) { pulse("fx-shock2", 950); A.burst(2, 0.9); FX.vibrate([60, 40, 120, 40, 200]); }
      else { pulse("fx-shock", 480); A.burst(1); FX.vibrate([30, 30, 60]); }
    },
    glitch() { jitter(); A.burst(0, 0.18); },
    flash() { mount(); if (!moving()) return; flash.classList.remove("on"); void flash.offsetWidth; flash.classList.add("on"); },
    blackout(ms) { mount(); document.body.classList.add("fx-black"); setTimeout(() => document.body.classList.remove("fx-black"), ms || 700); },
    burst(mode, dur) { A.burst(mode, dur); },
    tone(freq, dur, type, vol) { A.tone(freq, dur, type, vol); },
    click() { A.tone(880, 0.025, "triangle", 0.03); },
    vibrate(p) {
      if (!settings.vibe) return;
      try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* 振動できない端末 */ }
    },
    // 記録映像の見た目（● REC・時刻・トラッキングの帯）。stamp を渡すと、その時刻から数える
    vhs(on, stamp) {
      mount();
      clearInterval(vhsTimer);
      document.body.classList.toggle("fx-vhs-on", !!on);
      if (!on) return;
      const t0 = Date.now(), base = stamp ? new Date(stamp).getTime() : t0;
      const pad = n => String(n).padStart(2, "0");
      const tick = () => {
        const d = new Date(base + (Date.now() - t0));
        vhs.querySelector(".tc").textContent = "PLAY  " + d.getFullYear() + "." + pad(d.getMonth() + 1) + "." + pad(d.getDate()) + "  " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
      };
      tick();
      vhsTimer = setInterval(tick, 1000);
    },
    home() { location.href = "../index.html"; },
    get audio() { return A.ctx; },
  };
  window.FX = FX;
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);
})();
