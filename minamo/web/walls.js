/* ミナモ：過剰（Backrooms）の壁を、階層ごとにキャンバスで描く（画像ファイルなし）。
   WALLS.paint(id, w, h) → 画像の URL（data:）。同じ階層・同じ大きさなら、描き直さずに使い回す。
   壁紙の模様・しみ・ざらつき・蛍光灯・パイプ・家並み・麦畑など。乱数は階層ごとに固定（毎回同じ絵）。 */
(function () {
  "use strict";
  const cache = new Map();

  function rng(seed) {                     // mulberry32
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  // なめらかな雑音（格子の値を補間。オクターブを重ねる）
  function valueNoise(R, gw, gh) {
    const g = Array.from({ length: (gw + 1) * (gh + 1) }, R);
    const sm = t => t * t * (3 - 2 * t);
    return (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = sm(x - xi), yf = sm(y - yi);
      const i = (yi % gh) * (gw + 1) + (xi % gw);
      const a = g[i], b = g[i + 1], c = g[i + gw + 1], d = g[i + gw + 2];
      return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
    };
  }
  // ざらつき・しみ：明るさを、なめらかな雑音と細かい雑音でゆらす
  function grime(ctx, w, h, R, { amount = 0.18, grain = 0.06, scale = 90, tint = [0, 0, 0] } = {}) {
    const n1 = valueNoise(R, Math.ceil(w / scale) + 2, Math.ceil(h / scale) + 2);
    const n2 = valueNoise(R, Math.ceil(w / (scale / 4)) + 2, Math.ceil(h / (scale / 4)) + 2);
    const img = ctx.getImageData(0, 0, w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4;
      const v = (n1(x / scale, y / scale) * 0.7 + n2(x / scale * 4, y / scale * 4) * 0.3 - 0.5) * 2 * amount + (R() - 0.5) * grain;
      const m = 1 + v;
      d[k] = Math.max(0, Math.min(255, d[k] * m + tint[0] * -v * 40));
      d[k + 1] = Math.max(0, Math.min(255, d[k + 1] * m + tint[1] * -v * 40));
      d[k + 2] = Math.max(0, Math.min(255, d[k + 2] * m + tint[2] * -v * 40));
    }
    ctx.putImageData(img, 0, 0);
  }
  function stains(ctx, w, h, R, n, color) {
    for (let i = 0; i < n; i++) {
      const x = R() * w, y = R() * h, r = 20 + R() * Math.max(w, h) * 0.18;
      const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
      g.addColorStop(0, color.replace("A", (0.08 + R() * 0.12).toFixed(2))); g.addColorStop(0.8, color.replace("A", "0.04")); g.addColorStop(1, color.replace("A", "0"));
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, r, r * (0.6 + R() * 0.8), R() * 3, 0, Math.PI * 2); ctx.fill();
    }
  }
  function vignette(ctx, w, h, a) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(0,0,0,${a})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
  function lightPanel(ctx, x, y, pw, ph, glow) {
    const g = ctx.createRadialGradient(x + pw / 2, y + ph / 2, 2, x + pw / 2, y + ph / 2, pw * 1.6);
    g.addColorStop(0, `rgba(255,252,220,${glow})`); g.addColorStop(1, "rgba(255,252,220,0)");
    ctx.fillStyle = g; ctx.fillRect(x - pw * 1.6, y - pw * 1.6, pw * 4.2, pw * 4.2);
    ctx.fillStyle = "#f6f3d8"; ctx.fillRect(x, y, pw, ph);
    ctx.strokeStyle = "rgba(120,110,80,.6)"; ctx.lineWidth = 2; ctx.strokeRect(x, y, pw, ph);
    ctx.fillStyle = "rgba(200,195,160,.5)"; for (let i = 1; i < 4; i++) ctx.fillRect(x + (pw / 4) * i - 1, y + 2, 2, ph - 4);
  }
  const fill = (ctx, c, x, y, w, h) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  const lin = (ctx, x0, y0, x1, y1, stops) => { const g = ctx.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, c]) => g.addColorStop(o, c)); return g; };

  const PAINT = {
    // Level 0：黄ばんだ壁紙（縦の帯と菱形の小さな模様）・天井の蛍光灯・湿ったカーペット
    "0"(ctx, w, h, R) {
      fill(ctx, "#c4ae63", 0, 0, w, h);
      for (let x = 0; x < w; x += 36) { fill(ctx, "rgba(150,128,60,.35)", x, 0, 2, h); fill(ctx, "rgba(230,215,150,.25)", x + 3, 0, 1, h); }
      ctx.fillStyle = "rgba(140,118,55,.35)";
      for (let y = 10; y < h; y += 28) for (let x = 18; x < w; x += 36) {
        const yy = y + ((x / 36) % 2) * 14;
        ctx.beginPath(); ctx.moveTo(x, yy - 5); ctx.lineTo(x + 4, yy); ctx.lineTo(x, yy + 5); ctx.lineTo(x - 4, yy); ctx.closePath(); ctx.fill();
      }
      const ceil = h * 0.12;
      fill(ctx, lin(ctx, 0, 0, 0, ceil, [[0, "#d9cf9f"], [1, "#bcae72"]]), 0, 0, w, ceil);
      for (let x = 0; x < w; x += 70) fill(ctx, "rgba(120,110,70,.35)", x, 0, 2, ceil);
      for (let i = 0; i < Math.max(2, w / 220); i++) lightPanel(ctx, 30 + i * (w / Math.max(2, w / 220)), ceil * 0.3, Math.min(120, w * 0.22), ceil * 0.35, 0.35);
      fill(ctx, "#8a7a45", 0, h * 0.86, w, 6);
      fill(ctx, lin(ctx, 0, h * 0.86 + 6, 0, h, [[0, "#7a6c3c"], [1, "#5e5230"]]), 0, h * 0.86 + 6, w, h);
      stains(ctx, w, h, R, 9, "rgba(110,80,20,A)");
      grime(ctx, w, h, R, { amount: 0.16, grain: 0.07, scale: 110, tint: [0.2, 0.1, -0.2] });
      vignette(ctx, w, h, 0.45);
    },
    // Level 1：コンクリートの柱と床・霧
    "1"(ctx, w, h, R) {
      fill(ctx, lin(ctx, 0, 0, 0, h, [[0, "#6f7376"], [0.62, "#5a5e61"], [0.62, "#47494b"], [1, "#2e3032"]]), 0, 0, w, h);
      for (let x = R() * 60; x < w; x += 150 + R() * 60) {
        const pw = 34 + R() * 18;
        fill(ctx, lin(ctx, x, 0, x + pw, 0, [[0, "#55585a"], [0.3, "#7a7e80"], [1, "#3e4143"]]), x, 0, pw, h * 0.62);
        fill(ctx, "rgba(0,0,0,.25)", x + pw, h * 0.62, pw * 0.8, h * 0.06);
      }
      ctx.strokeStyle = "rgba(20,20,20,.45)"; ctx.lineWidth = 1;
      for (let i = 0; i < 7; i++) { let x = R() * w, y = R() * h; ctx.beginPath(); ctx.moveTo(x, y); for (let k = 0; k < 8; k++) { x += (R() - 0.5) * 40; y += R() * 26; ctx.lineTo(x, y); } ctx.stroke(); }
      for (let y = h * 0.62; y < h; y += 40) fill(ctx, "rgba(0,0,0,.15)", 0, y, w, 1);
      fill(ctx, lin(ctx, 0, h * 0.35, 0, h * 0.75, [[0, "rgba(200,205,210,0)"], [0.5, "rgba(200,205,210,.18)"], [1, "rgba(200,205,210,0)"]]), 0, 0, w, h);
      grime(ctx, w, h, R, { amount: 0.22, grain: 0.1, scale: 70 });
      vignette(ctx, w, h, 0.55);
    },
    // Level 2：横に這うパイプ（光の筋・継ぎ目・さび）
    "2"(ctx, w, h, R) {
      fill(ctx, "#1a120e", 0, 0, w, h);
      let y = 6;
      while (y < h) {
        const r = 8 + R() * 22;
        fill(ctx, lin(ctx, 0, y, 0, y + r * 2, [[0, "#2b1d15"], [0.25, "#8a5a3a"], [0.4, "#b07a50"], [0.7, "#4a2f20"], [1, "#1e140e"]]), 0, y, w, r * 2);
        for (let x = R() * 120; x < w; x += 110 + R() * 160) { fill(ctx, "rgba(0,0,0,.45)", x, y - 2, 8, r * 2 + 4); fill(ctx, "rgba(200,150,100,.25)", x + 1, y, 2, r * 2); }
        y += r * 2 + 4 + R() * 26;
      }
      stains(ctx, w, h, R, 14, "rgba(120,50,10,A)");
      ctx.strokeStyle = "rgba(90,60,40,.35)";
      for (let i = 0; i < 12; i++) { const x = R() * w, y0 = R() * h; ctx.lineWidth = 1 + R() * 2; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x + (R() - 0.5) * 6, y0 + 30 + R() * 90); ctx.stroke(); }
      grime(ctx, w, h, R, { amount: 0.25, grain: 0.08, scale: 60, tint: [0.3, 0.1, -0.2] });
      vignette(ctx, w, h, 0.65);
    },
    // Level 3：配電盤・配線の束・火花の明かり・小さな表示灯
    "3"(ctx, w, h, R) {
      fill(ctx, "#121314", 0, 0, w, h);
      for (let i = 0; i < 9; i++) {
        const x = R() * w, y = R() * h, bw = 60 + R() * 120, bh = 80 + R() * 140;
        fill(ctx, lin(ctx, x, y, x + bw, y + bh, [[0, "#2d3032"], [1, "#1c1e1f"]]), x, y, bw, bh);
        ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = 2; ctx.strokeRect(x, y, bw, bh);
        ctx.fillStyle = "#555"; [[6, 6], [bw - 8, 6], [6, bh - 8], [bw - 8, bh - 8]].forEach(([a, b]) => { ctx.beginPath(); ctx.arc(x + a, y + b, 2, 0, 7); ctx.fill(); });
        for (let k = 0; k < 3; k++) { ctx.fillStyle = R() < 0.5 ? "#3f6" : "#f63"; ctx.beginPath(); ctx.arc(x + 14 + k * 10, y + 16, 2.2, 0, 7); ctx.fill(); }
      }
      for (let i = 0; i < 14; i++) {
        ctx.strokeStyle = ["#202020", "#2a1f12", "#141a20"][i % 3]; ctx.lineWidth = 3 + R() * 6;
        ctx.beginPath(); ctx.moveTo(R() * w, -10); ctx.bezierCurveTo(R() * w, h * 0.3, R() * w, h * 0.7, R() * w, h + 10); ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,.06)"; ctx.lineWidth = 1; ctx.stroke();
      }
      const sx = w * (0.55 + R() * 0.3), sy = h * (0.2 + R() * 0.3), g = ctx.createRadialGradient(sx, sy, 2, sx, sy, Math.max(w, h) * 0.4);
      g.addColorStop(0, "rgba(255,170,60,.45)"); g.addColorStop(0.2, "rgba(255,120,30,.15)"); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      grime(ctx, w, h, R, { amount: 0.2, grain: 0.09, scale: 50 });
      vignette(ctx, w, h, 0.6);
    },
    // Level 4：吸音の天井板・蛍光灯・布張りの間仕切り
    "4"(ctx, w, h, R) {
      const ceil = h * 0.4;
      fill(ctx, "#b9b6ab", 0, 0, w, ceil);
      ctx.fillStyle = "rgba(90,88,80,.35)";
      for (let i = 0; i < w * ceil / 90; i++) ctx.fillRect(R() * w, R() * ceil, 1.4, 1.4);
      for (let x = 0; x < w; x += 64) fill(ctx, "#8e8b82", x, 0, 3, ceil);
      for (let y = 0; y < ceil; y += 64) fill(ctx, "#8e8b82", 0, y, w, 3);
      lightPanel(ctx, w * 0.2, ceil * 0.35, 61, 26, 0.3); lightPanel(ctx, w * 0.62, ceil * 0.35, 61, 26, 0.3);
      fill(ctx, lin(ctx, 0, ceil, 0, h, [[0, "#6f7177"], [1, "#4a4c51"]]), 0, ceil, w, h - ceil);
      for (let x = 0; x < w; x += 120) { fill(ctx, "#3a3c40", x, ceil, 6, h - ceil); fill(ctx, "rgba(255,255,255,.05)", x + 6, ceil, 2, h - ceil); }
      fill(ctx, "#2f3034", 0, h * 0.9, w, h * 0.1);
      grime(ctx, w, h, R, { amount: 0.12, grain: 0.08, scale: 90 });
      vignette(ctx, w, h, 0.5);
    },
    // Level 5：ホテルの廊下（赤と金の絨毯の模様・腰板・ぼんやりした壁灯）
    "5"(ctx, w, h, R) {
      const wall = h * 0.55;
      fill(ctx, "#3a0c10", 0, 0, w, wall);
      for (let x = 0; x < w; x += 22) fill(ctx, "rgba(0,0,0,.25)", x, 0, 10, wall);
      fill(ctx, "#2a1608", 0, wall - 40, w, 40); fill(ctx, "#a07a30", 0, wall - 42, w, 3);
      for (let x = w * 0.15; x < w; x += w * 0.35) {
        const g = ctx.createRadialGradient(x, wall * 0.35, 2, x, wall * 0.35, 120); g.addColorStop(0, "rgba(255,200,120,.45)"); g.addColorStop(1, "rgba(255,200,120,0)");
        ctx.fillStyle = g; ctx.fillRect(x - 120, wall * 0.35 - 120, 240, 240); fill(ctx, "#d9b56a", x - 6, wall * 0.35 - 10, 12, 20);
      }
      fill(ctx, "#4a0f12", 0, wall, w, h - wall);
      for (let y = wall + 12; y < h; y += 34) for (let x = ((y / 34) % 2) * 17; x < w; x += 34) {
        ctx.strokeStyle = "rgba(190,150,70,.55)"; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(x, y - 9); ctx.lineTo(x + 9, y); ctx.lineTo(x, y + 9); ctx.lineTo(x - 9, y); ctx.closePath(); ctx.stroke();
        ctx.fillStyle = "rgba(130,30,30,.9)"; ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill();
      }
      grime(ctx, w, h, R, { amount: 0.18, grain: 0.07, scale: 80, tint: [0.2, 0, 0] });
      vignette(ctx, w, h, 0.6);
    },
    // Level 6：ほとんど何も見えない闇（かすかなざらつきだけ）
    "6"(ctx, w, h, R) {
      fill(ctx, "#050505", 0, 0, w, h);
      grime(ctx, w, h, R, { amount: 0.5, grain: 0.5, scale: 40 });
      vignette(ctx, w, h, 0.8);
    },
    // Level 7：扉の向こうの夜の海（水平線・波頭・遠い光）。水面は上がらない
    "7"(ctx, w, h, R) {
      const hz = h * 0.42;
      fill(ctx, lin(ctx, 0, 0, 0, hz, [[0, "#020409"], [1, "#0b1422"]]), 0, 0, w, hz);
      fill(ctx, lin(ctx, 0, hz, 0, h, [[0, "#0c1a28"], [1, "#03070c"]]), 0, hz, w, h - hz);
      for (let y = hz + 4; y < h; y += 6 + (y - hz) * 0.05) {
        ctx.strokeStyle = `rgba(150,180,210,${0.05 + R() * 0.07})`; ctx.lineWidth = 1;
        ctx.beginPath(); for (let x = 0; x <= w; x += 12) ctx.lineTo(x, y + Math.sin(x * 0.03 + y) * (1 + (y - hz) * 0.02)); ctx.stroke();
      }
      const lx = w * (0.2 + R() * 0.6); const g = ctx.createRadialGradient(lx, hz - 2, 1, lx, hz - 2, 40); g.addColorStop(0, "rgba(255,240,200,.5)"); g.addColorStop(1, "rgba(255,240,200,0)"); ctx.fillStyle = g; ctx.fillRect(lx - 40, hz - 42, 80, 80);
      ctx.fillStyle = "#020202"; ctx.fillRect(0, 0, w * 0.08, h); ctx.fillRect(w * 0.92, 0, w * 0.08, h); ctx.fillRect(0, 0, w, h * 0.05);
      grime(ctx, w, h, R, { amount: 0.12, grain: 0.08, scale: 120 });
      vignette(ctx, w, h, 0.6);
    },
    // Level 8：岩の洞窟（重ねた雑音で岩肌、奥ほど暗い）
    "8"(ctx, w, h, R) {
      fill(ctx, "#3b3329", 0, 0, w, h);
      grime(ctx, w, h, R, { amount: 0.55, grain: 0.12, scale: 70, tint: [0.1, 0.05, -0.1] });
      grime(ctx, w, h, R, { amount: 0.3, grain: 0.05, scale: 22 });
      const g = ctx.createRadialGradient(w / 2, h * 0.55, 10, w / 2, h * 0.55, Math.max(w, h) * 0.35); g.addColorStop(0, "rgba(0,0,0,.85)"); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      vignette(ctx, w, h, 0.7);
    },
    // Level 9：夜の住宅街（家並み・暗い窓・ひとつだけ灯る窓・街灯）
    "9"(ctx, w, h, R) {
      fill(ctx, lin(ctx, 0, 0, 0, h, [[0, "#05070f"], [0.6, "#0c1222"], [1, "#07080c"]]), 0, 0, w, h);
      for (let i = 0; i < 80; i++) fill(ctx, `rgba(255,255,255,${R() * 0.25})`, R() * w, R() * h * 0.4, 1, 1);
      const base = h * 0.68;
      let x = -20, lit = Math.floor(R() * 6);
      for (let k = 0; x < w; k++) {
        const hw = 90 + R() * 70, hh = 60 + R() * 50;
        ctx.fillStyle = "#0a0b10"; ctx.fillRect(x, base - hh, hw, hh);
        ctx.beginPath(); ctx.moveTo(x - 8, base - hh); ctx.lineTo(x + hw / 2, base - hh - 30 - R() * 20); ctx.lineTo(x + hw + 8, base - hh); ctx.fill();
        for (let j = 0; j < 2; j++) fill(ctx, k === lit && j === 0 ? "rgba(255,200,120,.55)" : "#14161d", x + 14 + j * (hw / 2), base - hh + 16, 18, 16);
        x += hw + 20 + R() * 30;
      }
      fill(ctx, "#060608", 0, base, w, h - base);
      const lx = w * 0.78;
      fill(ctx, "#1a1a1a", lx, base - 160, 4, 160);
      const g = ctx.createRadialGradient(lx, base - 160, 4, lx, base - 60, 180); g.addColorStop(0, "rgba(255,170,70,.5)"); g.addColorStop(1, "rgba(255,170,70,0)");
      ctx.fillStyle = g; ctx.fillRect(lx - 200, base - 340, 400, 400);
      grime(ctx, w, h, R, { amount: 0.1, grain: 0.07, scale: 120 });
      vignette(ctx, w, h, 0.55);
    },
    // Level 10：曇り空と麦畑（一本ずつの穂）・遠い納屋
    "10"(ctx, w, h, R) {
      const hz = h * 0.42;
      fill(ctx, lin(ctx, 0, 0, 0, hz, [[0, "#6c6e6a"], [1, "#9a9b92"]]), 0, 0, w, hz);
      grime(ctx, w, Math.ceil(hz), R, { amount: 0.18, grain: 0.02, scale: 140 });
      ctx.fillStyle = "#2a2622"; const bx = w * (0.15 + R() * 0.6);
      ctx.fillRect(bx, hz - 30, 44, 30); ctx.beginPath(); ctx.moveTo(bx - 6, hz - 30); ctx.lineTo(bx + 22, hz - 52); ctx.lineTo(bx + 50, hz - 30); ctx.fill();
      fill(ctx, lin(ctx, 0, hz, 0, h, [[0, "#8a7436"], [1, "#5e4c20"]]), 0, hz, w, h - hz);
      for (let i = 0; i < w * 3; i++) {
        const x = R() * w, y = hz + Math.pow(R(), 0.7) * (h - hz), len = 6 + (y - hz) * 0.12;
        ctx.strokeStyle = `rgba(${180 + R() * 50},${150 + R() * 40},${70 + R() * 30},${0.5 + R() * 0.4})`; ctx.lineWidth = 0.6 + (y - hz) / h * 1.6;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (R() - 0.3) * 4, y - len); ctx.stroke();
      }
      vignette(ctx, w, h, 0.45);
    },
    // Level 11：眠らない街（ビルの影・ともった窓・霧）
    "11"(ctx, w, h, R) {
      fill(ctx, lin(ctx, 0, 0, 0, h, [[0, "#0a0c16"], [1, "#151826"]]), 0, 0, w, h);
      for (let layer = 0; layer < 2; layer++) {
        let x = -10;
        while (x < w) {
          const bw = 50 + R() * 80, bh = h * (0.35 + R() * 0.5) * (layer ? 1 : 0.8), top = h - bh;
          ctx.fillStyle = layer ? "#07080d" : "#0d0f18"; ctx.fillRect(x, top, bw, bh);
          for (let y = top + 8; y < h - 8; y += 12) for (let xx = x + 6; xx < x + bw - 8; xx += 10) if (R() < (layer ? 0.28 : 0.15)) fill(ctx, `rgba(255,${200 + R() * 40},${120 + R() * 60},${0.35 + R() * 0.4})`, xx, y, 5, 6);
          x += bw + (layer ? 4 : 18);
        }
      }
      fill(ctx, lin(ctx, 0, h * 0.5, 0, h, [[0, "rgba(120,130,160,0)"], [1, "rgba(120,130,160,.15)"]]), 0, 0, w, h);
      grime(ctx, w, h, R, { amount: 0.08, grain: 0.06, scale: 100 });
      vignette(ctx, w, h, 0.5);
    },
    // Level !：赤い非常灯の廊下（奥へ続く線・遠くの非常口の札）
    "!"(ctx, w, h, R) {
      fill(ctx, "#140303", 0, 0, w, h);
      const vx = w / 2, vy = h * 0.45;
      for (let i = 0; i < 18; i++) {
        const t = i / 18, x = vx + (i % 2 ? 1 : -1) * w * (0.6 - t * 0.55);
        ctx.strokeStyle = `rgba(150,20,20,${0.15 + t * 0.2})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(vx, vy); ctx.lineTo(x, i % 4 < 2 ? 0 : h); ctx.stroke();
      }
      for (let k = 1; k < 7; k++) {
        const s = 1 / k, rw = w * s, rh = h * s;
        ctx.strokeStyle = `rgba(120,10,10,${0.5 * s})`; ctx.lineWidth = 2 * s + 0.5; ctx.strokeRect(vx - rw / 2, vy - rh * 0.45, rw, rh);
        const g = ctx.createRadialGradient(vx, vy - rh * 0.45, 1, vx, vy - rh * 0.45, 60 * s + 10); g.addColorStop(0, `rgba(255,40,30,${0.55 * s + 0.1})`); g.addColorStop(1, "rgba(255,40,30,0)");
        ctx.fillStyle = g; ctx.fillRect(vx - 80, vy - rh * 0.45 - 80, 160, 160);
      }
      fill(ctx, "#0c7a35", vx - 10, vy - 4, 20, 8);
      grime(ctx, w, h, R, { amount: 0.18, grain: 0.1, scale: 60, tint: [0.4, -0.1, -0.1] });
      vignette(ctx, w, h, 0.75);
    },
    // Level Fun =)：誰もいないパーティー（風船・紙吹雪・壁の文字）
    "Fun =)"(ctx, w, h, R) {
      fill(ctx, lin(ctx, 0, 0, 0, h, [[0, "#3c2a3e"], [1, "#22182a"]]), 0, 0, w, h);
      const cols = ["#ff6fa8", "#ffd84d", "#6fd3ff", "#9dff8a", "#c58bff"];
      for (let i = 0; i < 260; i++) { ctx.save(); ctx.translate(R() * w, R() * h); ctx.rotate(R() * 6.3); ctx.fillStyle = cols[i % 5]; ctx.globalAlpha = 0.5 + R() * 0.4; ctx.fillRect(-3, -1.5, 6, 3); ctx.restore(); }
      for (let i = 0; i < 9; i++) {
        const x = R() * w, y = R() * h * 0.7, r = 18 + R() * 16, c = cols[i % 5];
        ctx.strokeStyle = "rgba(255,255,255,.3)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y + r * 1.2); ctx.quadraticCurveTo(x + 10, y + r * 3, x - 5, y + r * 5); ctx.stroke();
        const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, 2, x, y, r * 1.2); g.addColorStop(0, "rgba(255,255,255,.8)"); g.addColorStop(0.25, c); g.addColorStop(1, "rgba(0,0,0,.4)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, r, r * 1.2, 0, 0, 7); ctx.fill();
      }
      ctx.fillStyle = "rgba(255,180,210,.18)"; ctx.font = `${Math.round(w * 0.12)}px sans-serif`; ctx.textAlign = "center";
      ctx.fillText("=)", w / 2, h * 0.5);
      grime(ctx, w, h, R, { amount: 0.1, grain: 0.06, scale: 90 });
      vignette(ctx, w, h, 0.55);
    },
  };

  const SEED = { "0": 11, "1": 23, "2": 37, "3": 41, "4": 53, "5": 67, "6": 71, "7": 83, "8": 97, "9": 101, "10": 113, "11": 127, "!": 131, "Fun =)": 139 };

  window.WALLS = {
    paint(id, cw, ch) {
      if (!PAINT[id]) return "";
      // 画面の大きさに合わせる（細かすぎると重いので、長い辺は 1100px まで）
      const k = Math.min(1, 1100 / Math.max(cw, ch)) * Math.min(1.5, window.devicePixelRatio || 1);
      const w = Math.max(160, Math.round(cw * k)), h = Math.max(160, Math.round(ch * k));
      const key = `${id}:${w}x${h}`;
      if (cache.has(key)) return cache.get(key);
      try {
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        PAINT[id](ctx, w, h, rng(SEED[id] || 1));
        const url = c.toDataURL("image/jpeg", 0.82);
        cache.set(key, url);
        return url;
      } catch (e) { return ""; }            // 描けなければ、CSS の模様のまま
    },
    ids: () => Object.keys(PAINT),
  };
})();
