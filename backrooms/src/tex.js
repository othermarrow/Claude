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
  // ---- 第4層：水びたしの事務所 ----
  makeTex('wp4', 64, 64, (g, w, h) => {
    g.fillStyle = '#a7a68c'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 10) { g.fillStyle = '#9a997f'; g.fillRect(x, 0, 2, h); }
    const gr = g.createLinearGradient(0, 40, 0, 64); gr.addColorStop(0, 'rgba(40,52,44,0)'); gr.addColorStop(0.35, 'rgba(40,52,44,0.55)'); gr.addColorStop(1, 'rgba(20,30,26,0.8)');
    g.fillStyle = gr; g.fillRect(0, 40, w, 24);
    g.fillStyle = 'rgba(70,80,60,0.6)'; g.fillRect(0, 47, w, 1);
  }, (d, w, h, R) => {
    noisePix(d, 7, R); stains(d, w, h, R, 16, 0.5, 0.45);
    for (let k = 0; k < 5; k++) { const x0 = Math.floor(R() * w), len = 14 + R() * 34; mulRegion(d, w, h, (x, y) => (Math.abs(x - x0) < 2 && y < len) ? 0.8 + y / len * 0.15 : 1); }
  });
  makeTex('wf4', 64, 64, (g, w, h) => {
    g.fillStyle = '#2f4a48'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(160,200,190,0.25)'; g.lineWidth = 1;
    for (let k = 0; k < 7; k++) { g.beginPath(); g.ellipse(9 * k % 64, (k * 23) % 64, 6 + k, 3 + k * 0.4, 0, 0, 7); g.stroke(); }
  }, (d, w, h, R) => { noisePix(d, 6, R); stains(d, w, h, R, 16, 0.55, 0.3); });
  makeTex('ct4', 64, 64, (g, w, h, R) => {
    g.fillStyle = '#b9b49a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#8f8a72'; g.fillRect(0, 0, w, 1); g.fillRect(0, 32, w, 1); g.fillRect(0, 0, 1, h); g.fillRect(32, 0, 1, h);
  }, (d, w, h, R) => { noisePix(d, 5, R); stains(d, w, h, R, 16, 0.45, 0.55); });
  makeTex('ex4', 64, 64, (g, w, h, R, eg) => {
    copyTex(g, 'wp4');
    g.fillStyle = '#4c5248'; g.fillRect(14, 14, 36, 50);
    g.fillStyle = '#7e8676'; g.fillRect(16, 16, 32, 48);
    g.fillStyle = '#5d6458'; g.fillRect(16, 38, 32, 2);
    g.fillStyle = '#c8c4b8'; g.fillRect(42, 40, 4, 2);
    g.fillStyle = '#0b9a57'; g.fillRect(22, 3, 20, 9); eg.fillStyle = '#fff'; eg.fillRect(22, 3, 20, 9);
    g.fillStyle = '#efffef'; g.fillRect(31, 4, 2, 7); g.fillRect(29, 6, 6, 1); g.fillRect(30, 5, 4, 1);
  });
  // ---- 第5層：地下駐車場 ----
  makeTex('pk5', 64, 64, (g, w, h) => {
    g.fillStyle = '#8a857a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#7a756b'; g.fillRect(0, 20, w, 1);
    for (let x = 0; x < w; x += 8) { g.fillStyle = ((x >> 3) & 1) ? '#1d1b18' : '#d8b21c'; g.beginPath(); g.moveTo(x, 64); g.lineTo(x + 8, 64); g.lineTo(x + 16, 52); g.lineTo(x + 8, 52); g.closePath(); g.fill(); }
    g.fillStyle = '#2b4f8c'; g.fillRect(22, 26, 20, 14);
    g.fillStyle = '#e8eef8'; g.font = 'bold 11px sans-serif'; g.fillText('B3', 25, 37);
  }, (d, w, h, R) => { noisePix(d, 8, R); stains(d, w, h, R, 16, 0.55, 0.35); });
  makeTex('pf5', 64, 64, (g, w, h) => {
    g.fillStyle = '#3b3a38'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#d8d6cc'; g.fillRect(0, 2, 3, h - 4); g.fillRect(0, 2, 24, 2);
  }, (d, w, h, R) => { noisePix(d, 12, R); stains(d, w, h, R, 16, 0.55, 0.35); });
  makeTex('pc5', 64, 64, (g, w, h) => {
    g.fillStyle = '#6d6a64'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#5a5751'; g.fillRect(0, 26, w, 12); g.fillStyle = '#807d76'; g.fillRect(0, 26, w, 1);
    g.fillStyle = '#9a4a3a'; g.fillRect(0, 50, w, 3);
  }, (d, w, h, R) => { noisePix(d, 6, R); stains(d, w, h, R, 16, 0.6, 0.3); });
  makeTex('ex5', 64, 64, (g, w, h, R, eg) => {
    copyTex(g, 'pk5');
    g.fillStyle = '#25231f'; g.fillRect(10, 18, 44, 46);
    const gr = g.createLinearGradient(0, 18, 0, 64); gr.addColorStop(0, '#5a5650'); gr.addColorStop(1, '#2a2824');
    g.fillStyle = gr; g.fillRect(12, 20, 40, 44);
    g.fillStyle = '#0b9a57'; g.fillRect(18, 4, 28, 10); eg.fillStyle = '#fff'; eg.fillRect(18, 4, 28, 10);
    g.fillStyle = '#efffef'; g.font = 'bold 8px sans-serif'; g.fillText('EXIT', 21, 12); g.fillRect(41, 6, 2, 6); g.fillRect(39, 8, 6, 1);
  });
  // ---- 第6層：書庫 ----
  makeTex('bk6', 64, 64, (g, w, h, R) => {
    g.fillStyle = '#3b2716'; g.fillRect(0, 0, w, h);
    const cols = ['#7a2e24', '#2f4f6a', '#4f6a35', '#8a6a2a', '#5a3a5f', '#2a2a2a', '#9a8f78'];
    for (let row = 0; row < 4; row++) {
      const y0 = row * 16 + 2;
      g.fillStyle = '#1e140b'; g.fillRect(0, y0 - 2, w, 2);
      let x = 1;
      while (x < w - 1) { const bw = 2 + Math.floor(R() * 3), bh = 9 + Math.floor(R() * 5); g.fillStyle = cols[Math.floor(R() * cols.length)]; g.fillRect(x, y0 + 14 - bh, bw, bh); g.fillStyle = 'rgba(255,240,200,0.18)'; g.fillRect(x, y0 + 16 - bh, bw, 1); x += bw + (R() < 0.15 ? 2 : 0); }
    }
    g.fillStyle = '#4d331d'; g.fillRect(0, 0, 2, h); g.fillRect(w - 2, 0, 2, h);
  }, (d, w, h, R) => noisePix(d, 6, R));
  makeTex('wf6', 64, 64, (g, w, h) => {
    g.fillStyle = '#5a3a20'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 8) { g.fillStyle = '#3e2714'; g.fillRect(0, y, w, 1); g.fillRect(((y * 7) % 48) + 8, y, 1, 8); }
  }, (d, w, h, R) => { noisePix(d, 8, R); stains(d, w, h, R, 16, 0.6, 0.25); });
  makeTex('lc6', 64, 64, (g, w, h) => {
    g.fillStyle = '#3a2817'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2a1c0f'; for (let i = 0; i < w; i += 16) { g.fillRect(i, 0, 2, h); g.fillRect(0, i, w, 2); }
  }, (d, w, h, R) => noisePix(d, 5, R));
  makeTex('ex6', 64, 64, (g, w, h, R, eg) => {
    copyTex(g, 'bk6');
    g.fillStyle = '#24170c'; g.fillRect(12, 12, 40, 52);
    g.fillStyle = '#6b4526'; g.fillRect(14, 14, 36, 50);
    g.fillStyle = '#5a391e'; g.fillRect(18, 18, 12, 20); g.fillRect(34, 18, 12, 20); g.fillRect(18, 42, 12, 18); g.fillRect(34, 42, 12, 18);
    g.fillStyle = '#d8b24a'; g.fillRect(25, 5, 14, 5); eg.fillStyle = '#fff'; eg.fillRect(25, 5, 14, 5);
    g.fillStyle = '#e8c860'; g.fillRect(44, 38, 3, 3);
  });
  // ---- 第7層：ゲームセンター ----
  makeTex('ar7', 64, 64, (g, w, h, R, eg) => {
    g.fillStyle = '#1c1726'; g.fillRect(0, 0, w, h);
    const scr = ['#2a8cff', '#ff3a8c', '#36e07a', '#ffcc33'];
    for (let i = 0; i < 2; i++) {
      const x0 = i * 32 + 3;
      g.fillStyle = '#3d3356'; g.fillRect(x0, 6, 26, 58);
      g.fillStyle = '#5a4c7e'; g.fillRect(x0, 6, 26, 2); g.fillStyle = '#2c2540'; g.fillRect(x0 + 24, 6, 2, 58);
      const c = scr[(i + 1) % 4]; g.fillStyle = c; g.fillRect(x0 + 3, 4, 20, 5); eg.fillStyle = '#fff'; eg.fillRect(x0 + 3, 4, 20, 5);
      g.fillStyle = '#05050a'; g.fillRect(x0 + 3, 14, 20, 16);
      if (R() < 0.6) { g.fillStyle = scr[i * 2]; g.fillRect(x0 + 6, 19, 14, 2); g.fillRect(x0 + 9, 24, 8, 2); eg.fillRect(x0 + 6, 19, 14, 2); eg.fillRect(x0 + 9, 24, 8, 2); }
      g.fillStyle = '#4a4060'; g.fillRect(x0 + 1, 34, 24, 6);
      g.fillStyle = '#d33'; g.beginPath(); g.arc(x0 + 7, 36, 1.6, 0, 7); g.fill(); g.fillStyle = '#ddd'; g.fillRect(x0 + 14, 35, 2, 2); g.fillRect(x0 + 18, 35, 2, 2);
    }
  }, (d, w, h, R) => noisePix(d, 4, R));
  makeTex('af7', 64, 64, (g, w, h, R) => {
    g.fillStyle = '#1a0f2a'; g.fillRect(0, 0, w, h);
    const c = ['#a8306a', '#2a68b8', '#b8962a', '#2c9a5a'];
    for (let k = 0; k < 14; k++) { g.strokeStyle = c[k % 4]; g.lineWidth = 1.2; const x = R() * w, y = R() * h; g.beginPath(); if (k % 3 === 0) g.arc(x, y, 3, 0, 7); else { g.moveTo(x - 3, y + 2); g.lineTo(x, y - 3); g.lineTo(x + 3, y + 2); g.closePath(); } g.stroke(); }
  }, (d, w, h, R) => noisePix(d, 6, R));
  makeTex('ac7', 64, 64, (g, w, h) => { g.fillStyle = '#0a090d'; g.fillRect(0, 0, w, h); g.fillStyle = '#16141c'; g.fillRect(0, 30, w, 4); }, (d, w, h, R) => noisePix(d, 4, R));
  makeTex('ex7', 64, 64, (g, w, h, R, eg) => {
    g.fillStyle = '#0d0b14'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#6a6a72'; g.fillRect(8, 12, 48, 30);
    for (let y = 12; y < 42; y += 3) { g.fillStyle = '#4c4c54'; g.fillRect(8, y, 48, 1); }
    g.fillStyle = '#000'; g.fillRect(8, 42, 48, 22);
    g.fillStyle = '#ff3a8c'; g.font = 'bold 9px sans-serif'; g.fillText('EXIT', 21, 9);
    eg.fillStyle = '#fff'; eg.font = 'bold 9px sans-serif'; eg.fillText('EXIT', 21, 9);
  });
  // ---- 第8層：病院 ----
  makeTex('hp8', 64, 64, (g, w, h) => {
    g.fillStyle = '#e2e2cf'; g.fillRect(0, 0, w, 30);
    g.fillStyle = '#9fc4b2'; g.fillRect(0, 30, w, 34);
    g.fillStyle = '#86ac9a'; for (let i = 0; i < w; i += 8) { g.fillRect(i, 30, 1, 34); } for (let y = 30; y < h; y += 8) g.fillRect(0, y, w, 1);
    g.fillStyle = '#b7b7a6'; g.fillRect(0, 26, w, 4); g.fillStyle = '#d6d6c6'; g.fillRect(0, 26, w, 1);
  }, (d, w, h, R) => { noisePix(d, 5, R); stains(d, w, h, R, 16, 0.6, 0.35); });
  makeTex('hf8', 64, 64, (g, w, h, R) => {
    g.fillStyle = '#b8beb4'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#9aa196'; g.fillRect(0, 0, w, 1); g.fillRect(0, 0, 1, h);
    for (let i = 0; i < 90; i++) { g.fillStyle = R() < 0.5 ? '#8e958a' : '#cfd4cb'; g.fillRect(Math.floor(R() * w), Math.floor(R() * h), 1, 1); }
  }, (d, w, h, R) => { noisePix(d, 4, R); stains(d, w, h, R, 16, 0.6, 0.3); });
  makeTex('hc8', 64, 64, (g, w, h) => {
    g.fillStyle = '#e8ebe6'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#bfc3bd'; g.fillRect(0, 0, w, 1); g.fillRect(0, 32, w, 1); g.fillRect(0, 0, 1, h); g.fillRect(32, 0, 1, h);
  }, (d, w, h, R) => { noisePix(d, 3, R); stains(d, w, h, R, 32, 0.7, 0.3); });
  makeTex('ex8', 64, 64, (g, w, h, R, eg) => {
    copyTex(g, 'hp8');
    g.fillStyle = '#6e7c74'; g.fillRect(8, 12, 48, 52);
    g.fillStyle = '#c9d2cc'; g.fillRect(10, 14, 21, 50); g.fillRect(33, 14, 21, 50);
    g.fillStyle = '#7d9aa6'; g.beginPath(); g.arc(20, 28, 5, 0, 7); g.fill(); g.beginPath(); g.arc(44, 28, 5, 0, 7); g.fill();
    g.fillStyle = '#8a948e'; g.fillRect(26, 40, 4, 2); g.fillRect(34, 40, 4, 2);
    g.fillStyle = '#0b9a57'; g.fillRect(22, 3, 20, 8); eg.fillStyle = '#fff'; eg.fillRect(22, 3, 20, 8);
    g.fillStyle = '#efffef'; g.fillRect(26, 5, 3, 4); g.fillRect(32, 6, 7, 1);
  });
  // ---- 第9層：白いタイル ----
  const tiles = (g, w, h, s, c1, c2) => { g.fillStyle = c1; g.fillRect(0, 0, w, h); g.fillStyle = c2; for (let i = 0; i < w; i += s) { g.fillRect(i, 0, 1, h); g.fillRect(0, i, w, 1); } };
  makeTex('tl9', 64, 64, (g, w, h) => tiles(g, w, h, 16, '#e3eceb', '#a6c2c9'), (d, w, h, R) => { noisePix(d, 3, R); stains(d, w, h, R, 16, 0.85, 0.15); });
  makeTex('tf9', 64, 64, (g, w, h) => tiles(g, w, h, 16, '#d3e6eb', '#93b8c2'), (d, w, h, R) => noisePix(d, 3, R));
  makeTex('tc9', 64, 64, (g, w, h) => tiles(g, w, h, 32, '#eef2ef', '#c2cfcf'), (d, w, h, R) => noisePix(d, 2, R));
  makeTex('ex9', 64, 64, (g, w, h, R, eg) => {
    copyTex(g, 'tl9');
    g.fillStyle = '#c9c5b8'; g.fillRect(15, 9, 34, 55);
    g.fillStyle = '#f3f0e6'; g.fillRect(17, 11, 30, 53);
    g.fillStyle = '#fffbe6'; g.fillRect(45, 11, 3, 53); g.fillRect(17, 9, 31, 2);
    eg.fillStyle = '#fff'; eg.fillRect(45, 11, 3, 53); eg.fillRect(17, 9, 31, 2);
    g.fillStyle = '#b9b29a'; g.fillRect(40, 38, 3, 3);
  });

  // ==== Wiki設定版 ====
  // Level 0 の出口：揺らいで見える壁（すり抜けられる）
  makeTex('nc0', 64, 64, (g, w, h, R, eg) => {
    copyTex(g, 'wp0');
    for (let k = 0; k < 9; k++) {
      const y = Math.floor(R() * 58), hh = 1 + Math.floor(R() * 4), sh = Math.floor((R() - 0.5) * 18);
      const img = g.getImageData(0, y, w, hh); g.putImageData(img, sh, y);
      g.fillStyle = ['rgba(255,60,60,0.35)', 'rgba(60,255,200,0.35)', 'rgba(120,120,255,0.35)'][k % 3]; g.fillRect(0, y, w, 1);
      eg.fillStyle = 'rgba(255,255,255,0.55)'; if (k % 2) eg.fillRect(0, y, w, 1);
    }
  });
  // Level 3：レンガと配線
  makeTex('el3', 64, 64, (g, w, h, R, eg) => {
    g.fillStyle = '#2a1a16'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 6) for (let x = -((y / 6) & 1) * 6; x < w; x += 12) { g.fillStyle = R() < 0.5 ? '#5a3328' : '#4d2b22'; g.fillRect(x + 1, y + 1, 10, 4); }
    g.fillStyle = '#121212'; g.fillRect(0, 10, w, 4); g.fillRect(0, 17, w, 2); g.fillRect(44, 0, 3, h);
    g.fillStyle = '#3c3f44'; g.fillRect(8, 26, 18, 22); g.fillStyle = '#55595f'; g.fillRect(8, 26, 18, 1);
    g.fillStyle = '#d33'; g.fillRect(11, 30, 2, 2); eg.fillStyle = '#fff'; eg.fillRect(11, 30, 2, 2);
    g.fillStyle = '#3d3'; g.fillRect(15, 30, 2, 2); eg.fillRect(15, 30, 2, 2);
    g.fillStyle = '#e8c21a'; g.beginPath(); g.moveTo(17, 38); g.lineTo(21, 44); g.lineTo(13, 44); g.closePath(); g.fill();
  }, (d, w, h, R) => { noisePix(d, 6, R); stains(d, w, h, R, 16, 0.6, 0.3); });
  makeTex('ex_el', 64, 64, (g, w, h, R, eg) => {
    copyTex(g, 'el3');
    g.fillStyle = '#4b5056'; g.fillRect(9, 12, 46, 52);
    g.fillStyle = '#8f979c'; g.fillRect(11, 14, 42, 50);
    g.fillStyle = '#5e6469'; g.fillRect(31, 14, 2, 50);
    g.fillStyle = '#111'; g.fillRect(24, 3, 16, 7);
    g.fillStyle = '#ffb300'; g.fillRect(30, 4, 4, 1); g.fillRect(31, 5, 2, 1); g.fillRect(31, 6, 2, 3); eg.fillStyle = '#fff'; eg.fillRect(30, 4, 4, 5);
  });
  // Level 4：無人のオフィス
  makeTex('wo4', 64, 64, (g, w, h) => {
    g.fillStyle = '#d9d8d0'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#cfcec5'; for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 1, h);
    g.fillStyle = '#7d7f84'; g.fillRect(0, h - 5, w, 5); g.fillStyle = '#9a9ca1'; g.fillRect(0, h - 5, w, 1);
  }, (d, w, h, R) => { noisePix(d, 4, R); stains(d, w, h, R, 32, 0.75, 0.2); });
  makeTex('co4', 64, 64, (g, w, h) => { g.fillStyle = '#5d6672'; g.fillRect(0, 0, w, h); }, (d, w, h, R) => { noisePix(d, 12, R); stains(d, w, h, R, 16, 0.7, 0.2); });
  makeTex('ex_of', 64, 64, (g, w, h, R, eg) => {
    copyTex(g, 'wo4');
    g.fillStyle = '#5a5e64'; g.fillRect(14, 14, 36, 50);
    g.fillStyle = '#9aa1a8'; g.fillRect(16, 16, 32, 48);
    g.fillStyle = '#c8ccd0'; g.fillRect(42, 40, 4, 2);
    g.fillStyle = '#0b9a57'; g.fillRect(22, 3, 20, 9); eg.fillStyle = '#fff'; eg.fillRect(22, 3, 20, 9);
    g.fillStyle = '#efffef'; g.fillRect(31, 4, 2, 7); g.fillRect(29, 9, 6, 1); g.fillRect(30, 10, 4, 1);
  });
  // Level 5：朽ちたホテル
  makeTex('ht5', 64, 64, (g, w, h) => {
    g.fillStyle = '#5a1a1c'; g.fillRect(0, 0, w, 44);
    g.fillStyle = '#6e2a26';
    for (let y = 2; y < 44; y += 14) for (let x = ((y / 14) & 1) * 8; x < w; x += 16) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + 4, y + 6); g.lineTo(x, y + 12); g.lineTo(x - 4, y + 6); g.closePath(); g.fill(); }
    g.fillStyle = '#3a2216'; g.fillRect(0, 44, w, 20);
    g.fillStyle = '#5a3a24'; g.fillRect(0, 44, w, 2); for (let x = 4; x < w; x += 16) g.fillRect(x, 49, 10, 12);
  }, (d, w, h, R) => { noisePix(d, 6, R); stains(d, w, h, R, 16, 0.5, 0.45); });
  makeTex('hc5', 64, 64, (g, w, h) => {
    g.fillStyle = '#5c1316'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#a07a2e'; g.lineWidth = 1.5;
    for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) { g.beginPath(); g.moveTo(x + 8, y + 2); g.lineTo(x + 14, y + 8); g.lineTo(x + 8, y + 14); g.lineTo(x + 2, y + 8); g.closePath(); g.stroke(); }
  }, (d, w, h, R) => { noisePix(d, 10, R); stains(d, w, h, R, 16, 0.55, 0.4); });
  makeTex('hce5', 64, 64, (g, w, h) => {
    g.fillStyle = '#b7a888'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#8f8266'; g.fillRect(0, 0, w, 2); g.fillRect(0, 0, 2, h); g.fillRect(0, 31, w, 1); g.fillRect(31, 0, 1, h);
  }, (d, w, h, R) => { noisePix(d, 5, R); stains(d, w, h, R, 16, 0.45, 0.5); });
  makeTex('ex_ht', 64, 64, (g, w, h, R, eg) => {
    copyTex(g, 'ht5');
    g.fillStyle = '#2b2a28'; g.fillRect(14, 12, 36, 52);
    g.fillStyle = '#56524c'; g.fillRect(16, 14, 32, 50);
    g.fillStyle = '#3d3a35'; for (let y = 20; y < 60; y += 8) g.fillRect(16, y, 32, 1);
    g.fillStyle = '#ff7a2a'; g.fillRect(16, 62, 32, 2); eg.fillStyle = '#fff'; eg.fillRect(16, 62, 32, 2);
    g.fillStyle = '#d8c070'; g.fillRect(21, 4, 22, 6); g.fillStyle = '#2a2215'; g.font = 'bold 5px sans-serif'; g.fillText('BOILER', 23, 9);
    eg.fillStyle = '#fff'; eg.fillRect(21, 4, 22, 6);
  });
  // Level 6 の出口：赤く光る扉
  makeTex('ex_red', 64, 64, (g, w, h, R, eg) => {
    copyTex(g, 'wp3');
    g.fillStyle = '#ff2a1a'; g.fillRect(12, 10, 40, 54); eg.fillStyle = '#fff'; eg.fillRect(12, 10, 40, 54);
    g.fillStyle = '#3a1210'; g.fillRect(15, 13, 34, 51); eg.clearRect(15, 13, 34, 51);
    g.fillStyle = '#5a1c18'; g.fillRect(17, 15, 30, 49);
    g.fillStyle = '#c8a0a0'; g.fillRect(41, 40, 4, 2);
  });
  // Level !：赤い線の通路
  makeTex('rn_w', 64, 64, (g, w, h) => {
    g.fillStyle = '#9a9a96'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#8a8a86'; for (let y = 0; y < h; y += 16) g.fillRect(0, y, w, 1);
    g.fillStyle = '#b3201a'; g.fillRect(0, 34, w, 6);
    g.fillStyle = '#e8e8e2'; for (let x = 6; x < w; x += 22) { g.beginPath(); g.moveTo(x, 35); g.lineTo(x + 7, 37); g.lineTo(x, 39); g.closePath(); g.fill(); }
    g.fillStyle = '#4a4a46'; g.fillRect(0, h - 4, w, 4);
  }, (d, w, h, R) => { noisePix(d, 6, R); stains(d, w, h, R, 16, 0.6, 0.35); });
  makeTex('ex_run', 64, 64, (g, w, h, R, eg) => {
    copyTex(g, 'rn_w');
    g.fillStyle = '#3a3a38'; g.fillRect(14, 14, 36, 50);
    g.fillStyle = '#6a6a66'; g.fillRect(16, 16, 32, 48);
    g.fillStyle = '#c8c8c0'; g.fillRect(16, 38, 32, 3);
    g.fillStyle = '#e8221a'; g.fillRect(18, 3, 28, 10); eg.fillStyle = '#fff'; eg.fillRect(18, 3, 28, 10);
    g.fillStyle = '#fff2f0'; g.font = 'bold 8px sans-serif'; g.fillText('EXIT', 23, 11);
  });
  // Level Fun =)
  makeTex('fn_w', 64, 64, (g, w, h, R) => {
    g.fillStyle = '#f2e7b8'; g.fillRect(0, 0, w, h);
    const c = ['#e8483f', '#3f8fe8', '#5ec95a', '#f0b72f', '#c35fd1'];
    for (let k = 0; k < 4; k++) {
      const x = 8 + k * 15 + (R() - 0.5) * 4, y = 10 + R() * 18;
      g.strokeStyle = '#8a8270'; g.lineWidth = 0.6; g.beginPath(); g.moveTo(x, y + 6); g.quadraticCurveTo(x + 3, y + 16, x, y + 26); g.stroke();
      g.fillStyle = c[k % 5]; g.beginPath(); g.ellipse(x, y, 4.2, 5.4, 0, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(x - 2, y - 3, 1, 2);
    }
    g.fillStyle = '#6b5a2a'; g.font = 'bold 7px sans-serif'; g.fillText('=)', 26, 54);
    g.fillStyle = '#c9b87a'; g.fillRect(0, h - 4, w, 4);
  }, (d, w, h, R) => { noisePix(d, 4, R); stains(d, w, h, R, 32, 0.8, 0.15); });
  makeTex('fn_f', 64, 64, (g, w, h, R) => {
    g.fillStyle = '#d9cfa6'; g.fillRect(0, 0, w, h);
    const c = ['#e8483f', '#3f8fe8', '#5ec95a', '#f0b72f', '#c35fd1'];
    for (let k = 0; k < 40; k++) { g.fillStyle = c[k % 5]; g.fillRect(Math.floor(R() * w), Math.floor(R() * h), 2, 1 + (k & 1)); }
  }, (d, w, h, R) => noisePix(d, 6, R));
  makeTex('ex_fun', 64, 64, (g, w, h, R, eg) => {
    copyTex(g, 'fn_w');
    const c = ['#e8483f', '#f2f2f2'];
    for (let i = 0; i < 12; i++) { g.fillStyle = c[i & 1]; g.fillRect(10 + i * 3.7, 16, 4, 48); }
    g.fillStyle = '#0a0a0a'; g.beginPath(); g.ellipse(32, 46, 15, 16, 0, Math.PI, 0); g.fill(); g.fillRect(17, 46, 30, 18);
    g.fillStyle = '#f0b72f'; g.font = 'bold 9px sans-serif'; g.fillText('=)', 26, 11); eg.fillStyle = '#fff'; eg.font = 'bold 9px sans-serif'; eg.fillText('=)', 26, 11);
  });
  // Level 37：ぬるい水に沈んだタイル
  makeTex('pw37', 64, 64, (g, w, h) => {
    g.fillStyle = '#9cc9cf'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#7fb0b8'; for (let i = 0; i < w; i += 16) { g.fillRect(i, 0, 1, h); g.fillRect(0, i, w, 1); }
    g.strokeStyle = 'rgba(235,255,255,0.5)'; g.lineWidth = 1;
    for (let k = 0; k < 5; k++) { g.beginPath(); for (let x = 0; x <= w; x += 4) g.lineTo(x, k * 13 + 4 + Math.sin(x / 7 + k) * 2); g.stroke(); }
  }, (d, w, h, R) => noisePix(d, 3, R));

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

  // ハウンド：四つ足で這う人影
  makeTex('sp_hound', 64, 64, (g, w, h, R, eg) => {
    g.fillStyle = '#1b1915';
    g.beginPath(); g.ellipse(32, 30, 15, 9, 0, 0, 7); g.fill();                 // 丸めた背中
    g.beginPath(); g.ellipse(32, 38, 7, 6, 0, 0, 7); g.fill();                  // 頭（低い）
    g.lineWidth = 3.5; g.strokeStyle = '#1b1915'; g.lineCap = 'round';
    g.beginPath(); g.moveTo(20, 32); g.lineTo(12, 46); g.lineTo(9, 62); g.stroke();   // 腕
    g.beginPath(); g.moveTo(44, 32); g.lineTo(52, 46); g.lineTo(55, 62); g.stroke();
    g.lineWidth = 3; g.beginPath(); g.moveTo(24, 36); g.lineTo(22, 50); g.lineTo(26, 63); g.stroke();
    g.beginPath(); g.moveTo(40, 36); g.lineTo(42, 50); g.lineTo(38, 63); g.stroke();
    for (let i = 0; i < 14; i++) { g.lineWidth = 1; g.beginPath(); const x = 22 + R() * 20; g.moveTo(x, 34); g.lineTo(x + (R() - 0.5) * 6, 46 + R() * 6); g.stroke(); }  // 髪
    g.fillStyle = '#e8d8a0'; g.fillRect(28, 38, 2, 1); g.fillRect(34, 38, 2, 1); eg.fillStyle = '#fff'; eg.fillRect(28, 38, 2, 1); eg.fillRect(34, 38, 2, 1);
  });
  // スキン・スティーラー：人の皮をかぶった、背の高いもの
  makeTex('sp_skin', 64, 128, (g, w, h, R, eg) => {
    g.fillStyle = '#c9a48c';
    g.beginPath(); g.ellipse(32, 14, 7, 10, 0, 0, 7); g.fill();
    g.fillRect(29, 23, 6, 6);
    g.beginPath(); g.moveTo(21, 29); g.lineTo(43, 29); g.lineTo(40, 80); g.lineTo(24, 80); g.closePath(); g.fill();
    g.lineWidth = 3.5; g.strokeStyle = '#c9a48c'; g.lineCap = 'round';
    g.beginPath(); g.moveTo(22, 31); g.quadraticCurveTo(14, 62, 13, 104); g.stroke();
    g.beginPath(); g.moveTo(42, 31); g.quadraticCurveTo(51, 62, 52, 104); g.stroke();
    g.lineWidth = 4.5; g.beginPath(); g.moveTo(28, 78); g.lineTo(26, 127); g.stroke(); g.beginPath(); g.moveTo(36, 78); g.lineTo(39, 127); g.stroke();
    g.strokeStyle = '#6e4a3a'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(32, 30); g.lineTo(32, 78); g.stroke();
    for (let y = 34; y < 78; y += 5) { g.beginPath(); g.moveTo(30, y); g.lineTo(34, y + 1); g.stroke(); }   // 縫い目
    g.beginPath(); g.moveTo(25, 6); g.quadraticCurveTo(32, 20, 39, 6); g.stroke();
    g.fillStyle = '#120c0a'; g.beginPath(); g.ellipse(28, 13, 2.2, 3, 0, 0, 7); g.fill(); g.beginPath(); g.ellipse(36, 13, 2.2, 3, 0, 0, 7); g.fill();
    g.fillRect(29, 19, 6, 1);
  });
  // フェイスリング：顔のない人（何もしてこない）
  makeTex('sp_face', 64, 128, (g) => {
    g.fillStyle = '#d8cfc4'; g.beginPath(); g.ellipse(32, 15, 8, 10, 0, 0, 7); g.fill();
    g.fillStyle = '#b8afa4'; g.fillRect(29, 24, 6, 5);
    g.fillStyle = '#5c616b'; g.beginPath(); g.moveTo(20, 29); g.lineTo(44, 29); g.lineTo(42, 76); g.lineTo(22, 76); g.closePath(); g.fill();
    g.fillStyle = '#f0f0ec'; g.beginPath(); g.moveTo(29, 29); g.lineTo(35, 29); g.lineTo(32, 40); g.closePath(); g.fill();
    g.lineWidth = 4; g.strokeStyle = '#5c616b'; g.lineCap = 'round';
    g.beginPath(); g.moveTo(21, 31); g.lineTo(17, 74); g.stroke(); g.beginPath(); g.moveTo(43, 31); g.lineTo(47, 74); g.stroke();
    g.strokeStyle = '#2e3138'; g.lineWidth = 5; g.beginPath(); g.moveTo(27, 76); g.lineTo(27, 126); g.stroke(); g.beginPath(); g.moveTo(37, 76); g.lineTo(37, 126); g.stroke();
    g.fillStyle = '#d8cfc4'; g.beginPath(); g.arc(17, 76, 2.4, 0, 7); g.fill(); g.beginPath(); g.arc(47, 76, 2.4, 0, 7); g.fill();
  });
  // パーティーゴーアー：黄色い体と、大きな笑顔
  makeTex('sp_party', 64, 128, (g, w, h, R, eg) => {
    g.fillStyle = '#e8c52a';
    g.beginPath(); g.arc(32, 16, 11, 0, 7); g.fill();
    g.beginPath(); g.moveTo(20, 28); g.lineTo(44, 28); g.lineTo(42, 78); g.lineTo(22, 78); g.closePath(); g.fill();
    g.lineWidth = 4; g.strokeStyle = '#e8c52a'; g.lineCap = 'round';
    g.beginPath(); g.moveTo(21, 31); g.lineTo(15, 72); g.stroke(); g.beginPath(); g.moveTo(43, 31); g.lineTo(49, 72); g.stroke();
    g.lineWidth = 5; g.beginPath(); g.moveTo(27, 78); g.lineTo(27, 126); g.stroke(); g.beginPath(); g.moveTo(37, 78); g.lineTo(37, 126); g.stroke();
    g.fillStyle = '#111'; g.beginPath(); g.arc(28, 13, 1.8, 0, 7); g.fill(); g.beginPath(); g.arc(36, 13, 1.8, 0, 7); g.fill();
    g.strokeStyle = '#111'; g.lineWidth = 1.6; g.beginPath(); g.arc(32, 15, 7, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
    g.fillStyle = '#e8483f'; g.beginPath(); g.moveTo(26, 6); g.lineTo(32, -8); g.lineTo(38, 6); g.closePath(); g.fill();   // 三角帽子
  });
  // アーモンドウォーター（拾う物の絵を「ふつう」にしたとき）
  makeTex('sp_almond', 32, 32, (g) => {
    g.fillStyle = 'rgba(236,228,206,0.95)'; g.fillRect(12, 13, 8, 18);
    g.fillStyle = '#c99a5a'; g.fillRect(12, 19, 8, 6);
    g.fillStyle = '#f6efe0'; g.fillRect(13, 21, 6, 2);
    g.fillStyle = '#7a5a30'; g.fillRect(14, 9, 4, 4);
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(13, 14, 1, 14);
  });

  // ---- 別の版の絵 ----
  // 拾う物はすべて、Claude のアイコン風の印（橙色の放射）
  makeTex('sp_claude', 32, 32, (g, w, h, R, eg) => {
    const ray = (c) => {
      c.save(); c.translate(16, 21);
      const n = 11;
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2 + 0.2, len = 6.5 + (i * 7 % 5) * 0.7;
        c.rotate(Math.PI * 2 / n);
        c.beginPath(); c.moveTo(-1.1, 0); c.lineTo(-0.7, -len); c.arc(0, -len, 0.8, Math.PI, 0); c.lineTo(1.1, 0); c.closePath(); c.fill();
      }
      c.beginPath(); c.arc(0, 0, 2.2, 0, 7); c.fill();
      c.restore();
    };
    g.fillStyle = '#d97757'; ray(g); eg.fillStyle = '#fff'; ray(eg);
  });
  // 報告書の壁紙：紙に、灰色の文字の行が並ぶ
  makeTex('wp_rep', 64, 64, (g, w, h, R) => {
    g.fillStyle = '#d9d3bd'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#bdb6a0'; g.fillRect(0, 0, 1, h); g.fillRect(32, 0, 1, h);
    for (let col = 0; col < 2; col++) for (let y = 6; y < h - 8; y += 4) {
      if (R() < 0.12) continue;
      let x = col * 32 + 4 + (R() < 0.15 ? 3 : 0);
      const end = col * 32 + 29 - (R() < 0.3 ? Math.floor(R() * 14) : 0);
      while (x < end) { const lw = 1 + Math.floor(R() * 3); g.fillStyle = R() < 0.08 ? '#8a5a4a' : '#8f897a'; g.fillRect(x, y, Math.min(lw, end - x), 1); x += lw + (R() < 0.15 ? 2 : 0); }
    }
    g.fillStyle = '#6f6857'; g.fillRect(0, h - 5, w, 5);
  }, (d, w, h, R) => { noisePix(d, 5, R); stains(d, w, h, R, 16, 0.6, 0.3); });
  // 原稿用紙の壁紙
  makeTex('wp_genko', 64, 64, (g, w, h, R) => {
    g.fillStyle = '#e4d9bb'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#b0603e'; g.lineWidth = 1;
    for (let x = 4; x <= 60; x += 7) { g.beginPath(); g.moveTo(x + 0.5, 4); g.lineTo(x + 0.5, 58); g.stroke(); }
    for (let y = 4; y <= 58; y += 6) { g.beginPath(); g.moveTo(4, y + 0.5); g.lineTo(60, y + 0.5); g.stroke(); }
    g.fillStyle = '#3d342b';   // ところどころに、書きかけの字の跡
    for (let i = 0; i < 14; i++) { const cx = 4 + Math.floor(R() * 8) * 7, cy = 4 + Math.floor(R() * 9) * 6; g.fillRect(cx + 2, cy + 2, 3, 1); if (R() < 0.6) g.fillRect(cx + 3, cy + 1, 1, 4); }
    g.fillStyle = '#6a5838'; g.fillRect(0, h - 5, w, 5);
  }, (d, w, h, R) => { noisePix(d, 5, R); stains(d, w, h, R, 16, 0.55, 0.35); });
  // 山羊：灰色の大きな身体に、逞しい角
  makeTex('sp_goat', 64, 128, (g, w, h, R, eg) => {
    g.fillStyle = '#2b2925'; g.strokeStyle = '#2b2925';
    g.lineWidth = 4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(27, 12); g.bezierCurveTo(14, 0, 6, 14, 13, 24); g.stroke();   // 角
    g.beginPath(); g.moveTo(37, 12); g.bezierCurveTo(50, 0, 58, 14, 51, 24); g.stroke();
    g.beginPath(); g.ellipse(32, 20, 7, 11, 0, 0, 7); g.fill();                              // 頭
    g.beginPath(); g.moveTo(26, 26); g.lineTo(38, 26); g.lineTo(35, 40); g.lineTo(29, 40); g.closePath(); g.fill();   // 鼻づら
    g.beginPath(); g.moveTo(30, 40); g.lineTo(34, 40); g.lineTo(32, 47); g.closePath(); g.fill();  // ひげ
    g.beginPath(); g.ellipse(21, 20, 6, 2.5, -0.4, 0, 7); g.fill(); g.beginPath(); g.ellipse(43, 20, 6, 2.5, 0.4, 0, 7); g.fill();  // 耳
    g.beginPath(); g.moveTo(19, 44); g.lineTo(45, 44); g.lineTo(41, 90); g.lineTo(23, 90); g.closePath(); g.fill();   // 胴
    g.lineWidth = 4;
    g.beginPath(); g.moveTo(20, 46); g.quadraticCurveTo(12, 70, 13, 96); g.stroke();
    g.beginPath(); g.moveTo(44, 46); g.quadraticCurveTo(52, 70, 51, 96); g.stroke();
    g.lineWidth = 5;
    g.beginPath(); g.moveTo(27, 88); g.lineTo(25, 126); g.stroke(); g.beginPath(); g.moveTo(37, 88); g.lineTo(39, 126); g.stroke();
    const eyes = (c) => { c.fillRect(26, 18, 4, 2); c.fillRect(34, 18, 4, 2); };                   // 横長の瞳
    g.fillStyle = '#c9a23c'; eyes(g); eg.fillStyle = '#fff'; eyes(eg);
    g.fillStyle = '#111'; g.fillRect(27, 18, 2, 1); g.fillRect(35, 18, 2, 1);
  });
  // 笑う山羊：暗がりに、横長の瞳と笑った口
  makeTex('sp_goatgrin', 64, 64, (g, w, h, R, eg) => {
    g.fillStyle = '#060504'; g.strokeStyle = '#060504'; g.lineWidth = 3;
    for (let i = 0; i < 40; i++) { const a = R() * Math.PI * 2, r = R() * 20; g.beginPath(); g.ellipse(32 + Math.cos(a) * r * 0.7, 36 + Math.sin(a) * r, 3 + R() * 6, 3 + R() * 8, R() * 3, 0, 7); g.fill(); }
    g.beginPath(); g.moveTo(24, 16); g.bezierCurveTo(14, 2, 4, 10, 8, 22); g.stroke();
    g.beginPath(); g.moveTo(40, 16); g.bezierCurveTo(50, 2, 60, 10, 56, 22); g.stroke();
    const eye = (c) => { c.beginPath(); c.ellipse(23, 27, 5, 3, 0.2, 0, 7); c.fill(); c.beginPath(); c.ellipse(41, 27, 5, 3, -0.2, 0, 7); c.fill(); };
    g.fillStyle = '#e8c45a'; eye(g); eg.fillStyle = '#fff'; eye(eg);
    g.fillStyle = '#060504'; g.fillRect(20, 26, 6, 2); g.fillRect(38, 26, 6, 2);
    const grin = (c) => { c.beginPath(); c.moveTo(17, 40); c.quadraticCurveTo(32, 56, 47, 40); c.quadraticCurveTo(32, 48, 17, 40); c.fill(); };
    g.fillStyle = '#efe6cc'; grin(g); eg.fillStyle = '#fff'; grin(eg);
    g.fillStyle = '#060504'; for (let x = 19; x < 46; x += 3) g.fillRect(x, 41, 1, 6);
  });
}
