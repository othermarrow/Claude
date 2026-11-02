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

  // 階層ごとのネオン2色と、背景の描き方と、環境音
  const LV = {
    0: { a: "#ffe66d", b: "#ff2a85", bg: "tags", bed: "fluoro" },
    1: { a: "#00f5d4", b: "#ff007f", bg: "scope", bed: "warehouse" },
    2: { a: "#ff9e00", b: "#ff0055", bg: "scope", bed: "pipes" },
    3: { a: "#00e5ff", b: "#ff2a85", bg: "spark", bed: "electric" },
    4: { a: "#00f0ff", b: "#ff2a85", bg: "wire", bed: "office" },
    5: { a: "#ffaa44", b: "#ff2255", bg: "scope", bed: "hotel" },
    6: { a: "#00ffcc", b: "#ff1e56", bg: "dark", bed: "dark" },
    7: { a: "#3fa9ff", b: "#00ffd0", bg: "sea", bed: "sea" },
    8: { a: "#d8a24a", b: "#7dff6a", bg: "drip", bed: "cave" },
    9: { a: "#b38cff", b: "#ff8a3d", bg: "stars", bed: "night" },
    10: { a: "#ffd23f", b: "#9dff3f", bg: "field", bed: "field" },
    11: { a: "#00f0ff", b: "#ff00c8", bg: "grid", bed: "city" },
    37: { a: "#7ff7ff", b: "#ffffff", bg: "water", bed: "pool" },
    fun: { a: "#ff4fd8", b: "#ffe600", bg: "confetti", bed: "party" },
    run: { a: "#ff2a2a", b: "#ffffff", bg: "rain", bed: "electric" },
    white: { a: "#c8f6ff", b: "#ff6bb0", bg: "tags", bed: "silence" },
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
#fx-tube{position:fixed;top:0;left:8%;right:8%;height:2px;pointer-events:none;z-index:9;background:#fffbe6;opacity:0;
 box-shadow:0 0 10px 2px rgba(255,250,215,.6),0 0 42px 10px rgba(255,240,170,.16);transition:opacity .25s}
body.fx-tube-on #fx-tube{opacity:.85}
body.fx-flick #fx-tube{opacity:.05;transition:none}
body.fx-flick #app{opacity:.42;transition:none}
body.fx-flick #fx-bg{opacity:.08}
body.fx-flick2 #app{opacity:.75;filter:brightness(1.35);transition:none}
body.fx-still.fx-flick #app,body.fx-still.fx-flick2 #app{opacity:1;filter:none}
body.fx-still.fx-shock #app,body.fx-still.fx-shock2 #app,body.fx-still.fx-jitter #app{animation:none}`;

  let bg, ctx, crt, tru, flash, vhs, tube, vhsTimer = 0, W = 360, H = 640, tick = 0, last = 0;
  // 黄道の12とへびつかい座。色つきの絵文字にならないよう、異体字セレクタ（U+FE0E）で線画にする
  const ZODIAC = ["♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "⛎", "♐", "♑", "♒", "♓"].map(c => c + "\uFE0E");
  let aligned = false;
  let cur = { key: 0, a: "#ffe66d", b: "#ff2a85", mode: "tags", bed: "fluoro" }, stress = 0, tags = TAGS.slice(), truisms = TRUISMS.slice();
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
    tube = document.createElement("div"); tube.id = "fx-tube"; tube.setAttribute("aria-hidden", "true");
    document.body.append(crt, tru, flash, vhs, tube);
    ctx = bg.getContext("2d");
    resize();
    window.addEventListener("resize", resize);
    document.body.classList.toggle("fx-still", !moving());
    apply();
    requestAnimationFrame(draw);
    // 音は、最初に触ったときにしか鳴らせない
    const unlock = () => { A.init(); A.bed(cur.bed); };
    window.addEventListener("pointerdown", unlock, { once: true, capture: true });
    window.addEventListener("keydown", unlock, { once: true, capture: true });
    document.addEventListener("visibilitychange", () => { if (A.ctx) { if (document.hidden) A.ctx.suspend(); else if (settings.sound) A.ctx.resume(); } });
  }
  function tubeState() {
    const m = BEDS[cur.bed] || {};
    if (document.body) document.body.classList.toggle("fx-tube-on", (m.hum || 0) >= 0.05);
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
    if (stress > 0.3) {
      ctx.fillStyle = "rgba(255,255,255," + (0.05 + stress * 0.12) + ")";
      for (let i = 0, n = 60 + stress * 260; i < n; i++) ctx.fillRect(Math.random() * W, Math.random() * H, 1, 1);
    }
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
  // ずっと鳴る層（うなり・じりじり・高い鳴き・ノイズの帯・機械・風・海）を音量だけで混ぜ、
  // ときどき鳴る音（ちらつき・金属・雫・虫・囁き・ピアノ・警笛）を 250ms ごとのくじで鳴らす
  const BEDS = {
    fluoro: { hum: 0.24, buzz: 0.06, whine: 0.004, hiss: 0.03, flick: 0.035, crackle: 0.05 },
    warehouse: { hum: 0.12, buzz: 0.02, rumble: 0.09, hiss: 0.012, flick: 0.012, clang: 0.006 },
    pipes: { rumble: 0.24, hiss: 0.06, hum: 0.04, mach: 0.03, clang: 0.025, steam: 0.012 },
    electric: { hum: 0.16, buzz: 0.07, mach: 0.1, hiss: 0.045, whine: 0.003, spark: 0.05, flick: 0.025 },
    office: { hum: 0.07, buzz: 0.015, rumble: 0.035, flick: 0.01, drip: 0.012 },
    hotel: { rumble: 0.16, hum: 0.03, piano: 0.07 },
    dark: { rumble: 0.05, whisper: 0.012 },
    sea: { sea: 1.0, rumble: 0.1 },
    cave: { wind: 0.4, rumble: 0.1, drip: 0.14 },
    night: { wind: 0.12, cricket: 0.55 },
    field: { wind: 0.6, cricket: 0.04 },
    city: { rumble: 0.15, hum: 0.05, buzz: 0.02, mach: 0.035, horn: 0.012 },
    pool: { sea: 0.25, drip: 0.09, hum: 0.03 },
    party: { party: 1, hum: 0.04 },
    silence: {},
  };
  const LAYERS = ["hum", "buzz", "whine", "hiss", "rumble", "sea", "wind", "mach"];
  const SCALE = [261.6, 293.7, 329.6, 392.0, 440.0, 523.3, 587.3];
  const A = {
    ctx: null, master: null, G: {}, mix: {}, name: "silence", spike: 0, beatAt: 0, partyAt: 0,
    init() {
      if (this.ctx || !settings.sound) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const c = this.ctx = new AC();
        this.master = c.createGain(); this.master.gain.value = 0.6; this.master.connect(c.destination);
        const layer = n => { const g = c.createGain(); g.gain.value = 0; g.connect(this.master); this.G[n] = g; return g; };
        // 蛍光灯：100Hz ののこぎり波と、少しずれた倍音
        const lp = this.filt("lowpass", 900); lp.connect(layer("hum"));
        const g1 = c.createGain(); g1.gain.value = 0.6; this.osc("sawtooth", 100).connect(g1); g1.connect(lp);
        const g2 = c.createGain(); g2.gain.value = 0.14; this.osc("square", 200.6).connect(g2); g2.connect(lp);
        const g3 = c.createGain(); g3.gain.value = 0.2; this.osc("sine", 50).connect(g3); g3.connect(lp);
        // 安定器のじりじり：100Hz の矩形波を帯域で切り、揺らす
        const bz = this.filt("bandpass", 2400, 2); this.osc("square", 100).connect(bz);
        const am = c.createGain(); am.gain.value = 0.6; bz.connect(am); am.connect(layer("buzz"));
        const lfo = c.createGain(); lfo.gain.value = 0.4; this.osc("sine", 7.3).connect(lfo); lfo.connect(am.gain);
        // 管の高い鳴き
        this.osc("sine", 7800).connect(layer("whine"));
        // ノイズを一本鳴らしつづけ、じりじり・ごうごう・波・風に分ける
        const n = c.createBufferSource(); n.buffer = this.noise(2); n.loop = true; n.start();
        const hp = this.filt("bandpass", 3200, 0.8); n.connect(hp); hp.connect(layer("hiss"));
        const lr = this.filt("lowpass", 320); n.connect(lr); lr.connect(layer("rumble"));
        const ls = this.filt("lowpass", 700); const sw = c.createGain(); sw.gain.value = 0.5; n.connect(ls); ls.connect(sw); sw.connect(layer("sea"));
        const sl = c.createGain(); sl.gain.value = 0.5; this.osc("sine", 0.09).connect(sl); sl.connect(sw.gain);
        const wb = this.filt("bandpass", 520, 0.6); const ww = c.createGain(); ww.gain.value = 0.6; n.connect(wb); wb.connect(ww); ww.connect(layer("wind"));
        const wl = c.createGain(); wl.gain.value = 260; this.osc("sine", 0.07).connect(wl); wl.connect(wb.frequency);
        const wg = c.createGain(); wg.gain.value = 0.4; this.osc("sine", 0.13).connect(wg); wg.connect(ww.gain);
        // 機械の低いうなり
        const m = this.osc("triangle", 55); m.connect(layer("mach"));
        const ml = c.createGain(); ml.gain.value = 2; this.osc("sine", 0.3).connect(ml); ml.connect(m.frequency);
        setInterval(() => this.random(), 250);
      } catch (e) { this.ctx = null; }
    },
    live() { if (!this.ctx || !settings.sound) return false; if (this.ctx.state === "suspended") this.ctx.resume(); return this.ctx.state !== "closed"; },
    osc(type, f) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; o.start(); return o; },
    filt(type, f, q) { const n = this.ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; if (q) n.Q.value = q; return n; },
    noise(sec) {
      const b = this.ctx.createBuffer(1, Math.max(1, Math.floor(this.ctx.sampleRate * sec)), this.ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return b;
    },
    // 環境音を切り替える（名前か、層ごとの音量の表）
    bed(name, fast) {
      this.name = typeof name === "string" ? name : "custom";
      this.mix = typeof name === "string" ? (BEDS[name] || {}) : (name || {});
      if (!this.live()) return;
      const t = this.ctx.currentTime;
      for (const k of LAYERS) {
        let v = this.mix[k] || 0;
        if (k === "hum" || k === "buzz") v *= 1 + stress * 0.8 + this.spike * 2.2;
        this.G[k].gain.cancelScheduledValues(t);
        this.G[k].gain.setTargetAtTime(v, t, fast ? 0.03 : 0.4);
      }
    },
    env(node, peak, a, d, at) {
      const g = this.ctx.createGain(), t = at || this.ctx.currentTime;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
      node.connect(g); g.connect(this.master);
      return t + a + d;
    },
    nz(f, q, peak, dur, delay, type) {
      const at = this.ctx.currentTime + (delay || 0);
      const s = this.ctx.createBufferSource(); s.buffer = this.noise(dur + 0.05);
      const b = this.filt(type || "bandpass", f, q); s.connect(b);
      const end = this.env(b, peak, 0.004, dur, at);
      s.start(at); s.stop(end + 0.05);
    },
    tn(f, type, peak, dur, o) {
      o = o || {};
      const at = this.ctx.currentTime + (o.delay || 0);
      const v = this.ctx.createOscillator(); v.type = type; v.frequency.setValueAtTime(f, at);
      if (o.drop) v.frequency.exponentialRampToValueAtTime(f * o.drop, at + dur);
      let node = v;
      if (o.lp) { const l = this.filt("lowpass", o.lp); v.connect(l); node = l; }
      const end = this.env(node, peak, o.a || 0.006, dur, at);
      v.start(at); v.stop(end + 0.05);
    },
    // うなりが一瞬とぎれる（蛍光灯のちらつき）
    stutter() {
      const t = this.ctx.currentTime;
      for (const k of ["hum", "buzz", "whine"]) {
        const g = this.G[k].gain, v = (this.mix[k] || 0) * (k === "whine" ? 1 : 1 + stress * 0.8);
        g.cancelScheduledValues(t);
        g.setValueAtTime(0, t); g.setValueAtTime(v * 1.6, t + 0.06); g.setValueAtTime(0, t + 0.13); g.setValueAtTime(v * 1.3, t + 0.2); g.setTargetAtTime(v, t + 0.3, 0.06);
      }
      this.nz(5200, 1, 0.08, 0.02); this.nz(4800, 1, 0.06, 0.02, 0.13);
    },
    beat(v) { this.tn(62, "sine", v, 0.16, { drop: 0.6 }); this.tn(56, "sine", v * 0.7, 0.14, { drop: 0.6, delay: 0.24 }); },
    random() {
      if (!this.ctx || !settings.sound || this.ctx.state !== "running") return;
      const M = this.mix, r = () => Math.random(), now = this.ctx.currentTime;
      if (M.flick && r() < M.flick) { this.stutter(); FX._flickVisual(1); }
      if (M.crackle && r() < M.crackle) this.nz(6000 + r() * 3000, 2, 0.025, 0.015);
      if (M.clang && r() < M.clang) this.tn(300 + r() * 450, "triangle", 0.08, 0.9, { drop: 0.7, lp: 1800 });
      if (M.steam && r() < M.steam) this.nz(3500, 0.5, 0.06, 1.2);
      if (M.spark && r() < M.spark) { for (let i = 0; i < 4; i++) this.nz(4000 + r() * 4000, 3, 0.05, 0.012, i * 0.03); }
      if (M.drip && r() < M.drip) this.tn(1100 + r() * 900, "sine", 0.06, 0.12, { drop: 0.45 });
      if (M.piano && r() < M.piano) { const f = SCALE[r() * SCALE.length | 0] * (r() < 0.3 ? 0.5 : 1); this.tn(f, "sine", 0.09, 1.8, { lp: 650 }); this.tn(f * 2, "sine", 0.02, 1.0, { lp: 650 }); }
      if (M.whisper && r() < M.whisper) this.sfx("whisper");
      if (M.cricket && r() < M.cricket) { const f = 4300 + r() * 600; for (let i = 0; i < 3; i++) this.tn(f, "sine", 0.03, 0.03, { delay: i * 0.06 }); }
      if (M.horn && r() < M.horn) { const f = 300 + r() * 120; this.tn(f, "sawtooth", 0.025, 0.9, { lp: 600, a: 0.08 }); this.tn(f * 1.26, "sawtooth", 0.02, 0.9, { lp: 600, a: 0.08 }); }
      if (M.party && now >= this.partyAt) {
        // こもった四つ打ちと和音（Level Fun）
        for (let i = 0; i < 4; i++) { this.tn(110, "sine", 0.12, 0.12, { drop: 0.4, delay: i * 0.5 }); }
        const ch = [261.6, 329.6, 392][r() * 3 | 0];
        this.tn(ch, "square", 0.012, 1.6, { lp: 420 }); this.tn(ch * 1.5, "square", 0.01, 1.6, { lp: 420 });
        this.partyAt = now + 2;
      }
      // 正気が削れているときの鼓動
      if (stress >= 0.5 && now >= this.beatAt) {
        this.beat(0.12 + (stress - 0.5) * 0.36);
        this.beatAt = now + 1.05 - (stress - 0.5) * 0.9;
      }
    },
    sfx(name) {
      if (!this.live()) return;
      const r = Math.random;
      switch (name) {
        case "step": this.nz(180, 0.7, 0.45, 0.09, 0, "lowpass"); this.nz(2500, 1, 0.05, 0.03); this.nz(180, 0.7, 0.38, 0.09, 0.42, "lowpass"); this.nz(2500, 1, 0.04, 0.03, 0.42); break;
        case "door": {
          const at = this.ctx.currentTime, v = this.ctx.createOscillator(); v.type = "sawtooth";
          v.frequency.setValueAtTime(190, at); v.frequency.linearRampToValueAtTime(130, at + 0.7); v.frequency.linearRampToValueAtTime(160, at + 0.9);
          const l = this.filt("bandpass", 900, 4); v.connect(l); const end = this.env(l, 0.16, 0.08, 0.85, at); v.start(at); v.stop(end + 0.05);
          this.nz(140, 0.8, 0.6, 0.2, 0.9, "lowpass"); break;
        }
        case "knock": for (let i = 0; i < 3; i++) { this.nz(240, 1.5, 0.8, 0.07, i * 0.2); this.tn(110, "sine", 0.2, 0.08, { drop: 0.5, delay: i * 0.2 }); } break;
        case "clang": this.tn(320 + r() * 400, "triangle", 0.12, 1.2, { drop: 0.7, lp: 2200 }); this.tn(1210, "sine", 0.03, 0.8, { drop: 0.9 }); break;
        case "drip": this.tn(1400, "sine", 0.09, 0.14, { drop: 0.42 }); break;
        case "splash": this.nz(1600, 0.5, 0.18, 0.6, 0, "lowpass"); this.nz(3500, 1, 0.05, 0.3, 0.05); break;
        case "scratch": this.nz(4200, 3, 0.2, 0.05); this.nz(3800, 3, 0.16, 0.04, 0.07); this.nz(4500, 3, 0.16, 0.06, 0.13); break;
        case "chime": this.tn(880, "sine", 0.1, 1.2); this.tn(1318.5, "sine", 0.08, 1.5, { delay: 0.14 }); break;
        case "bell": for (let i = 0; i < 3; i++) { this.tn(1568, "sine", 0.08, 0.5, { delay: i * 0.12 }); this.tn(3920, "sine", 0.02, 0.3, { delay: i * 0.12 }); } break;
        case "stinger":
          [196, 207.7, 277.2, 415.3].forEach((f, i) => this.tn(f, "sawtooth", 0.05, 1.8, { lp: 1400 - i * 150, a: 0.01 }));
          this.nz(900, 0.4, 0.2, 0.7); this.burst(2, 0.6); FX._flickVisual(2); break;
        case "whisper": {
          const at = this.ctx.currentTime, s = this.ctx.createBufferSource(); s.buffer = this.noise(1.4);
          const b = this.filt("bandpass", 900, 6); b.frequency.setValueAtTime(800 + r() * 400, at); b.frequency.linearRampToValueAtTime(2200 + r() * 600, at + 1.2);
          s.connect(b); const end = this.env(b, 0.25, 0.3, 0.9, at); s.start(at); s.stop(end + 0.05); break;
        }
        case "static": this.nz(2000, 0.3, 0.12, 0.7, 0, "highpass"); break;
        case "thud": this.tn(90, "sine", 0.35, 0.35, { drop: 0.45 }); this.nz(200, 0.7, 0.2, 0.2, 0, "lowpass"); break;
        case "glass": for (let i = 0; i < 7; i++) this.tn(2500 + r() * 3000, "sine", 0.03, 0.25, { delay: r() * 0.25 }); this.nz(6000, 1, 0.08, 0.2, 0, "highpass"); break;
        case "beep": this.tn(1000, "square", 0.06, 0.12); break;
        case "phone":
          for (let k = 0; k < 2; k++) for (let i = 0; i < 12; i++) { const d = k * 1.5 + i * 0.08; this.tn(440, "square", 0.06, 0.04, { delay: d, lp: 2500 }); this.tn(480, "square", 0.06, 0.04, { delay: d + 0.04, lp: 2500 }); }
          break;
        case "breath": {
          const at = this.ctx.currentTime, s = this.ctx.createBufferSource(); s.buffer = this.noise(1.6);
          const b = this.filt("bandpass", 700, 1); s.connect(b); const end = this.env(b, 0.16, 0.6, 0.9, at); s.start(at); s.stop(end + 0.05); break;
        }
        case "heart": this.beat(0.3); break;
        case "spark": for (let i = 0; i < 6; i++) this.nz(4000 + r() * 4000, 3, 0.2, 0.014, i * 0.025); FX._flickVisual(1); break;
        case "hum":
          this.spike = 1; this.bed(this.mix === BEDS[this.name] ? this.name : this.mix, true);
          setTimeout(() => { this.spike = 0; this.bed(BEDS[this.name] ? this.name : this.mix); }, 1200); break;
        default: break;
      }
    },
    tone(freq, dur, type, vol) { if (!this.live()) return; this.tn(freq, type || "triangle", vol || 0.03, dur); },
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
        d[i] = ((v / 128) - 1) * 0.08 * (1 - i / len);
      }
      const s = this.ctx.createBufferSource(); s.buffer = buf; s.connect(this.master); s.start();
    },
  };

  // ---- 公開する道具 ----
  const FX = {
    get settings() { return Object.assign({}, settings); },
    set(k, v) {
      settings[k] = v;
      try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch (e) { /* 残らなくてもよい */ }
      if (k === "sound") {
        if (v) { A.init(); if (A.ctx) { A.master.gain.setTargetAtTime(0.6, A.ctx.currentTime, 0.1); A.bed(cur.bed); } }
        else if (A.ctx) A.master.gain.setTargetAtTime(0, A.ctx.currentTime, 0.1);
      }
      if (k === "motion" && document.body) document.body.classList.toggle("fx-still", !moving());
    },
    // 階層を変える。key は 0〜11 の数か "37" "fun" "run" "white"。opt で色・背景・環境音を上書きできる
    // （opt.bed がなく opt.hum が 0 なら無音。ゲームが自分の環境音を鳴らすとき用）
    level(key, opt) {
      mount();
      const base = LV[key] || LV[String(key)] || LV[0];
      opt = opt || {};
      const bed = opt.bed || (opt.hum === 0 ? "silence" : base.bed);
      cur = Object.assign({ key }, { a: base.a, b: base.b, mode: base.bg }, opt, { bed });
      apply();
      A.bed(bed);
      tubeState();
    },
    bed(name) { cur.bed = name; A.bed(name); tubeState(); },
    sfx(name) { A.sfx(name); },
    // 蛍光灯のちらつき（音＋画面）
    flicker(n) {
      mount();
      n = Math.max(1, Math.min(6, n || 1));
      for (let i = 0; i < n; i++) setTimeout(() => { if (A.live()) A.stutter(); FX._flickVisual(1); }, i * 340 + Math.random() * 120);
    },
    _flickVisual(power) {
      if (!document.body || !moving()) return;
      const cls = power === 2 ? "fx-flick" : (Math.random() < 0.5 ? "fx-flick" : "fx-flick2");
      document.body.classList.add(cls);
      setTimeout(() => document.body.classList.remove(cls), 60);
      setTimeout(() => document.body.classList.add(cls), 130);
      setTimeout(() => document.body.classList.remove(cls), 200);
      if (power === 2) { setTimeout(() => document.body.classList.add("fx-flick"), 300); setTimeout(() => document.body.classList.remove("fx-flick"), 420); }
    },
    stress(x) {
      stress = Math.max(0, Math.min(1, +x || 0));
      if (document.body) document.body.classList.toggle("fx-thermal", stress >= 0.6);
      A.bed(BEDS[cur.bed] ? cur.bed : A.mix);
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
      // 音は鳴らさない（タップした直後に鳴ると、タップの音に聞こえるため）
    },
    // 強さ 1：揺れと短いノイズ。2：反転まじりの大きな乱れ
    // sound に false を渡すと、揺れと振動だけで音は鳴らさない（タップの直後に呼ぶとき用）
    shock(power, sound) {
      mount();
      const loud = sound !== false;
      if (power === 2) { pulse("fx-shock2", 950); if (loud) { A.burst(2, 0.9); if (A.live()) A.sfx("thud"); } FX._flickVisual(2); FX.vibrate([60, 40, 120, 40, 200]); }
      else { pulse("fx-shock", 480); if (loud) A.burst(1); FX.vibrate([30, 30, 60]); }
    },
    // 画面を一瞬乱す。sound に false を渡すと音なし（タップの直後に呼ぶとき用）
    glitch(sound) { jitter(); if (sound !== false) A.burst(0, 0.18); },
    flash() { mount(); if (!moving()) return; flash.classList.remove("on"); void flash.offsetWidth; flash.classList.add("on"); },
    blackout(ms) {
      mount(); document.body.classList.add("fx-black");
      if (A.live()) { A.stutter(); const keep = A.mix; A.bed("silence", true); setTimeout(() => A.bed(BEDS[cur.bed] ? cur.bed : keep), ms || 700); }
      setTimeout(() => document.body.classList.remove("fx-black"), ms || 700);
    },
    burst(mode, dur) { A.burst(mode, dur); },
    tone(freq, dur, type, vol) { A.tone(freq, dur, type, vol); },
    click() { /* タップの音は鳴らさない（利用者の希望）。呼ばれても何もしない */ },
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
