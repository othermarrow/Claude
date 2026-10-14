// ===== 絵（壁・床・天井・出口・拾う物・怪物）を canvas で描いて、ピクセルにする =====
const TEX = {};
function makeTex(name, w, h, draw, post) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  const ecv = document.createElement('canvas'); ecv.width = w; ecv.height = h;
  const eg = ecv.getContext('2d');            // ここに白く描いた所が「自分で光る」
  let seed = 0; for (const ch of name) seed = (seed * 31 + ch.charCodeAt(0)) | 0;
  const R = mulberry32(seed);
  draw(g, w, h, R, eg);
  const img = g.getImageData(0, 0, w, h);
  if (post) post(img.data, w, h, R);
  const ed = eg.getImageData(0, 0, w, h).data, em = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) em[i] = ed[i * 4 + 3] > 100 ? 1 : 0;
  TEX[name] = { w, h, d: img.data, em };
  return TEX[name];
}
// なめらかなノイズ（つなぎ目なく並べられる）
function tileNoise(w, h, cell, R) {
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell), g = [];
  for (let i = 0; i < gw * gh; i++) g.push(R());
  const out = new Float32Array(w * h);
  const sm = t => t * t * (3 - 2 * t);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = x / cell, gy = y / cell, x0 = Math.floor(gx), y0 = Math.floor(gy);
    const tx = sm(gx - x0), ty = sm(gy - y0);
    const v = (a, b) => g[((b % gh + gh) % gh) * gw + ((a % gw + gw) % gw)];
    out[y * w + x] = lerp(lerp(v(x0, y0), v(x0 + 1, y0), tx), lerp(v(x0, y0 + 1), v(x0 + 1, y0 + 1), tx), ty);
  }
  return out;
}
function noisePix(d, amt, R) { for (let i = 0; i < d.length; i += 4) { const n = (R() - 0.5) * 2 * amt; d[i] += n; d[i + 1] += n; d[i + 2] += n; } }
function mulRegion(d, w, h, f) {  // f(x,y) -> 掛ける値
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const m = f(x, y); if (m === 1) continue;
    const i = (y * w + x) * 4; d[i] *= m; d[i + 1] *= m; d[i + 2] *= m;
  }
}
function stains(d, w, h, R, cell, thr, k) {
  const n = tileNoise(w, h, cell, R);
  mulRegion(d, w, h, (x, y) => { const v = n[y * w + x]; return v > thr ? 1 - (v - thr) / (1 - thr) * k : 1; });
}
function copyTex(g, name) {
  const t = TEX[name], img = g.createImageData(t.w, t.h);
  img.data.set(t.d); g.putImageData(img, 0, 0);
}

function buildTextures() {
  // ---- 第0層：黄色い壁紙・カーペット・天井 ----
  makeTex('wp0', 64, 64, (g, w, h) => {
    g.fillStyle = '#c9b35c'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 8) {
      g.fillStyle = '#b39d4a'; g.fillRect(x, 0, 1, h);
      g.fillStyle = '#d8c470'; g.fillRect(x + 4, 0, 1, h);
    }
    g.fillStyle = '#bba553';
    for (let y = 4; y < h; y += 8) for (let x = 2; x < w; x += 8) { g.fillRect(x, y + ((x >> 3) & 1) * 4, 2, 2); }
    const gr = g.createLinearGradient(0, 0, 0, 12); gr.addColorStop(0, 'rgba(60,45,10,0.35)'); gr.addColorStop(1, 'rgba(60,45,10,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, 12);
    g.fillStyle = '#6f5c35'; g.fillRect(0, h - 5, w, 5);
    g.fillStyle = '#8c7848'; g.fillRect(0, h - 5, w, 1);
  }, (d, w, h, R) => {
    noisePix(d, 6, R); stains(d, w, h, R, 16, 0.62, 0.35);
    for (let k = 0; k < 3; k++) {  // 雨じみ
      const x0 = Math.floor(R() * w), len = 10 + R() * 30;
      mulRegion(d, w, h, (x, y) => (Math.abs(x - x0) < 2 && y < len) ? 0.86 + y / len * 0.12 : 1);
    }
  });
  makeTex('cp0', 64, 64, (g, w, h) => { g.fillStyle = '#8e783c'; g.fillRect(0, 0, w, h); },
    (d, w, h, R) => { noisePix(d, 16, R); stains(d, w, h, R, 16, 0.55, 0.4); });
  makeTex('ct0', 64, 64, (g, w, h, R) => {
    g.fillStyle = '#d6cda6'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#a49c7c'; g.fillRect(0, 0, w, 1); g.fillRect(0, 32, w, 1); g.fillRect(0, 0, 1, h); g.fillRect(32, 0, 1, h);
    g.fillStyle = '#bfb690'; for (let i = 0; i < 120; i++) g.fillRect(Math.floor(R() * w), Math.floor(R() * h), 1, 1);
  }, (d, w, h, R) => { noisePix(d, 4, R); stains(d, w, h, R, 32, 0.75, 0.25); });
  // 非常口
  makeTex('ex0', 64, 64, (g, w, h, R, eg) => {
    copyTex(g, 'wp0');
    g.fillStyle = '#56544e'; g.fillRect(13, 15, 38, 49);
    g.fillStyle = '#8f8d86'; g.fillRect(15, 17, 34, 47);
    g.fillStyle = '#7a7871'; g.fillRect(15, 38, 34, 2);
    g.fillStyle = '#c8c4b8'; g.fillRect(42, 40, 5, 2);
    g.fillStyle = '#0b9a57'; g.fillRect(19, 3, 26, 10); eg.fillStyle = '#fff'; eg.fillRect(19, 3, 26, 10);
    g.fillStyle = '#f2fff6';
    g.beginPath(); g.arc(26, 6, 1.6, 0, 7); g.fill();
    g.fillRect(25, 8, 2, 3); g.fillRect(23, 9, 6, 1); g.fillRect(24, 11, 1, 2); g.fillRect(27, 11, 2, 1);
    g.fillRect(32, 5, 10, 6); g.fillStyle = '#0b9a57'; g.fillRect(34, 6, 6, 4);
  });
  // ---- 第1層：コンクリート ----
  makeTex('cn1', 64, 64, (g, w, h, R) => {
    g.fillStyle = '#86857f'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) { g.fillStyle = '#76756f'; g.fillRect(0, y, w, 1); g.fillStyle = '#93928b'; g.fillRect(0, y + 1, w, 1); }
    g.fillStyle = '#4f4e4a'; for (let y = 8; y < h; y += 16) for (let x = 8; x < w; x += 24) { g.beginPath(); g.arc(x, y, 1.3, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(40,40,38,0.6)'; g.lineWidth = 1;
    for (let k = 0; k < 2; k++) { let x = R() * w, y = R() * h; g.beginPath(); g.moveTo(x, y); for (let i = 0; i < 8; i++) { x += (R() - 0.5) * 8; y += R() * 5; g.lineTo(x, y); } g.stroke(); }
  }, (d, w, h, R) => { noisePix(d, 9, R); stains(d, w, h, R, 16, 0.6, 0.3); mulRegion(d, w, h, (x, y) => y > 50 ? 1 - (y - 50) / 14 * 0.35 : 1); });
  makeTex('cf1', 64, 64, (g, w, h) => { g.fillStyle = '#4f4e4a'; g.fillRect(0, 0, w, h); },
    (d, w, h, R) => {
      noisePix(d, 10, R);
      stains(d, w, h, R, 16, 0.5, 0.35);
      const n = tileNoise(w, h, 32, R);
      for (let i = 0; i < w * h; i++) if (n[i] > 0.74) { const k = i * 4, m = 0.55 - (n[i] - 0.74) * 0.8; d[k] *= m; d[k + 1] *= m * 1.05; d[k + 2] *= m * 1.2; }
    });
  makeTex('cc1', 64, 64, (g, w, h) => {
    g.fillStyle = '#3e3f43'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2b2c2f'; g.fillRect(0, 28, w, 8); g.fillStyle = '#4b4c50'; g.fillRect(0, 28, w, 1);
  }, (d, w, h, R) => noisePix(d, 6, R));
  makeTex('ex1', 64, 64, (g, w, h, R, eg) => {
    copyTex(g, 'cn1');
    g.fillStyle = '#3a4045'; g.fillRect(14, 14, 36, 50);
    g.fillStyle = '#66727a'; g.fillRect(16, 16, 32, 48);
    g.fillStyle = '#20262b'; g.fillRect(28, 22, 9, 12);
    g.fillStyle = '#b8c0c4'; g.fillRect(41, 40, 4, 2);
    g.fillStyle = '#0b9a57'; g.fillRect(24, 4, 16, 8); eg.fillStyle = '#fff'; eg.fillRect(24, 4, 16, 8);
    g.fillStyle = '#efffef'; g.fillRect(31, 5, 2, 4); g.fillRect(29, 8, 6, 1); g.fillRect(30, 9, 4, 1); g.fillRect(31, 10, 2, 1);
  });
  // ---- 第2層：配管 ----
  makeTex('pp2', 64, 64, (g, w, h) => {
    g.fillStyle = '#2a1b16'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 8) for (let x = -((y >> 3) & 1) * 8; x < w; x += 16) { g.fillStyle = '#5b3a2f'; g.fillRect(x + 1, y + 1, 14, 6); }
    const pipe = (y, r, c1, c2) => { g.fillStyle = c1; g.fillRect(0, y - r, w, r * 2); g.fillStyle = c2; g.fillRect(0, y - r + 1, w, 1); g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, y + r - 1, w, 1); };
    pipe(12, 4, '#56655a', '#8fa293'); pipe(33, 2, '#7a4b2a', '#c0835a');
    g.fillStyle = '#56655a'; g.fillRect(50, 0, 6, h); g.fillStyle = '#8fa293'; g.fillRect(51, 0, 1, h);
    g.fillStyle = '#3c473f'; for (let x = 4; x < w; x += 20) g.fillRect(x, 7, 3, 10);
  }, (d, w, h, R) => { noisePix(d, 8, R); stains(d, w, h, R, 16, 0.58, 0.4); });
  makeTex('gr2', 64, 64, (g, w, h) => {
    g.fillStyle = '#121110'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#4b4840'; for (let i = 0; i < w; i += 8) { g.fillRect(i, 0, 2, h); g.fillRect(0, i, w, 2); }
  }, (d, w, h, R) => noisePix(d, 8, R));
  makeTex('pc2', 64, 64, (g, w, h) => {
    g.fillStyle = '#181311'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#3d4740'; g.fillRect(0, 20, w, 6); g.fillRect(0, 44, w, 3);
    g.fillStyle = '#5b675e'; g.fillRect(0, 20, w, 1);
  }, (d, w, h, R) => noisePix(d, 6, R));
  makeTex('ex2', 64, 64, (g, w, h, R, eg) => {
    copyTex(g, 'pp2');
    for (let i = 0; i < 40; i += 4) { g.fillStyle = (i >> 2) & 1 ? '#111' : '#d6ad08'; g.fillRect(12 + i, 22, 4, 4); g.fillRect(12 + i, 58, 4, 4); }
    for (let i = 0; i < 36; i += 4) { g.fillStyle = (i >> 2) & 1 ? '#111' : '#d6ad08'; g.fillRect(12, 22 + i, 4, 4); g.fillRect(48, 22 + i, 4, 4); }
    g.fillStyle = '#6b6b60'; g.fillRect(16, 26, 32, 32);
    g.fillStyle = '#4a4a42'; g.fillRect(16, 41, 32, 2);
    g.fillStyle = '#9a9a8c'; [[19, 29], [44, 29], [19, 54], [44, 54]].forEach(([x, y]) => g.fillRect(x, y, 2, 2));
    g.fillStyle = '#ff4a2a'; g.beginPath(); g.arc(32, 15, 3, 0, 7); g.fill(); eg.fillStyle = '#fff'; eg.beginPath(); eg.arc(32, 15, 3, 0, 7); eg.fill();
  });
  // ---- 第3層：暗い事務所 ----
  makeTex('wp3', 64, 64, (g, w, h) => {
    g.fillStyle = '#727886'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 6) { g.fillStyle = '#666c79'; g.fillRect(x, 0, 1, h); }
    g.fillStyle = '#3f424a'; g.fillRect(0, h - 5, w, 5);
  }, (d, w, h, R) => { noisePix(d, 6, R); stains(d, w, h, R, 16, 0.55, 0.45); });
  makeTex('cp3', 64, 64, (g, w, h) => { g.fillStyle = '#4a5062'; g.fillRect(0, 0, w, h); }, (d, w, h, R) => { noisePix(d, 14, R); stains(d, w, h, R, 16, 0.6, 0.35); });
  makeTex('ct3', 64, 64, (g, w, h) => {
    g.fillStyle = '#9b9d9f'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#76787a'; g.fillRect(0, 0, w, 1); g.fillRect(0, 32, w, 1); g.fillRect(0, 0, 1, h); g.fillRect(32, 0, 1, h);
  }, (d, w, h, R) => { noisePix(d, 5, R); stains(d, w, h, R, 32, 0.7, 0.35); });
  makeTex('ex3', 64, 64, (g, w, h, R, eg) => {
    copyTex(g, 'wp3');
    g.fillStyle = '#4b5056'; g.fillRect(9, 12, 46, 52);
    g.fillStyle = '#a3abb0'; g.fillRect(11, 14, 42, 50);
    g.fillStyle = '#5e6469'; g.fillRect(31, 14, 2, 50);
    g.fillStyle = '#c9d0d4'; g.fillRect(11, 14, 1, 50); g.fillRect(33, 14, 1, 50);
    g.fillStyle = '#111'; g.fillRect(24, 3, 16, 7);
    g.fillStyle = '#ffb300'; g.fillRect(30, 4, 4, 1); g.fillRect(31, 5, 2, 1); g.fillRect(31, 6, 2, 3);
    eg.fillStyle = '#fff'; eg.fillRect(30, 4, 4, 5);
  });
  // ---- 第4層：白いタイル ----
  const tiles = (g, w, h, s, c1, c2) => { g.fillStyle = c1; g.fillRect(0, 0, w, h); g.fillStyle = c2; for (let i = 0; i < w; i += s) { g.fillRect(i, 0, 1, h); g.fillRect(0, i, w, 1); } };
  makeTex('tl4', 64, 64, (g, w, h) => tiles(g, w, h, 16, '#e3eceb', '#a6c2c9'), (d, w, h, R) => { noisePix(d, 3, R); stains(d, w, h, R, 16, 0.85, 0.15); });
  makeTex('tf4', 64, 64, (g, w, h) => tiles(g, w, h, 16, '#d3e6eb', '#93b8c2'), (d, w, h, R) => noisePix(d, 3, R));
  makeTex('tc4', 64, 64, (g, w, h) => tiles(g, w, h, 32, '#eef2ef', '#c2cfcf'), (d, w, h, R) => noisePix(d, 2, R));
  makeTex('ex4', 64, 64, (g, w, h, R, eg) => {
    copyTex(g, 'tl4');
    g.fillStyle = '#c9c5b8'; g.fillRect(15, 9, 34, 55);
    g.fillStyle = '#f3f0e6'; g.fillRect(17, 11, 30, 53);
    g.fillStyle = '#fffbe6'; g.fillRect(45, 11, 3, 53); g.fillRect(17, 9, 31, 2);
    eg.fillStyle = '#fff'; eg.fillRect(45, 11, 3, 53); eg.fillRect(17, 9, 31, 2);
    g.fillStyle = '#b9b29a'; g.fillRect(40, 38, 3, 3);
  });

  // ---- 拾う物（下が床） ----
  makeTex('sp_water', 32, 32, (g) => {
    g.fillStyle = 'rgba(185,220,240,0.95)'; g.fillRect(12, 13, 8, 18);
    g.fillStyle = '#e8f4fb'; g.fillRect(12, 19, 8, 5);
    g.fillStyle = '#2a6fd6'; g.fillRect(14, 9, 4, 4);
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(13, 14, 1, 14);
  });
  makeTex('sp_battery', 32, 32, (g) => {
    g.fillStyle = '#262626'; g.fillRect(8, 24, 15, 7);
    g.fillStyle = '#d4b030'; g.fillRect(8, 26, 15, 2);
    g.fillStyle = '#c8892f'; g.fillRect(23, 26, 2, 3);
  });
  makeTex('sp_map', 32, 32, (g) => {
    g.fillStyle = '#d9cfae'; g.beginPath(); g.moveTo(5, 31); g.lineTo(8, 24); g.lineTo(18, 25); g.lineTo(27, 23); g.lineTo(26, 31); g.closePath(); g.fill();
    g.strokeStyle = '#a3322a'; g.lineWidth = 1; g.beginPath(); g.moveTo(9, 29); g.lineTo(15, 27); g.lineTo(22, 28); g.stroke();
  });
  makeTex('sp_note', 32, 32, (g) => {
    g.fillStyle = '#ebe6d8'; g.fillRect(7, 26, 18, 6);
    g.fillStyle = '#7d786c'; g.fillRect(9, 27, 13, 1); g.fillRect(9, 29, 10, 1);
  });
  // 徘徊者：顔のない、細長い黒い影
  makeTex('sp_wander', 64, 128, (g) => {
    g.fillStyle = '#0b0a08';
    g.beginPath(); g.ellipse(32, 15, 7, 10, 0, 0, 7); g.fill();
    g.fillRect(30, 24, 4, 6);
    g.beginPath(); g.moveTo(22, 30); g.lineTo(42, 30); g.lineTo(39, 82); g.lineTo(25, 82); g.closePath(); g.fill();
    g.lineWidth = 3; g.strokeStyle = '#0b0a08';
    g.beginPath(); g.moveTo(23, 32); g.quadraticCurveTo(14, 60, 12, 100); g.stroke();
    g.beginPath(); g.moveTo(41, 32); g.quadraticCurveTo(51, 62, 53, 98); g.stroke();
    g.lineWidth = 4;
    g.beginPath(); g.moveTo(28, 80); g.lineTo(26, 128); g.stroke();
    g.beginPath(); g.moveTo(36, 80); g.lineTo(39, 128); g.stroke();
  });
  // 笑う闇：暗がりに浮かぶ目と歯
  makeTex('sp_grin', 64, 64, (g, w, h, R, eg) => {
    g.fillStyle = '#050403';
    for (let i = 0; i < 46; i++) {                 // ぼろぼろの影
      const a = R() * Math.PI * 2, r = R() * 22;
      g.beginPath(); g.ellipse(32 + Math.cos(a) * r * 0.8, 32 + Math.sin(a) * r, 3 + R() * 7, 3 + R() * 9, R() * 3, 0, 7); g.fill();
    }
    for (let i = 0; i < 6; i++) { g.lineWidth = 1.5; g.strokeStyle = '#050403'; g.beginPath(); g.moveTo(32, 40); g.lineTo(32 + (R() - 0.5) * 64, 52 + R() * 12); g.stroke(); }
    const eye = (c) => { c.beginPath(); c.ellipse(23, 24, 4.5, 2.2, 0.3, 0, 7); c.fill(); c.beginPath(); c.ellipse(41, 24, 4.5, 2.2, -0.3, 0, 7); c.fill(); };
    g.fillStyle = '#fbf6e2'; eye(g); eg.fillStyle = '#fff'; eye(eg);
    const grin = (c) => { c.beginPath(); c.moveTo(13, 34); c.quadraticCurveTo(32, 54, 51, 34); c.quadraticCurveTo(32, 45, 13, 34); c.fill(); };
    g.fillStyle = '#f1ead2'; grin(g); eg.fillStyle = '#fff'; grin(eg);
    g.fillStyle = '#050403'; for (let x = 15; x < 50; x += 2.5) g.fillRect(x, 36, 1, 8);
    g.fillStyle = '#050403'; g.fillRect(22, 24, 2, 2); g.fillRect(40, 24, 2, 2);
  });
}
