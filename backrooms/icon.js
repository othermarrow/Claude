// アプリのアイコン（黄色い廊下の奥に暗い戸口）をプログラムで描いて、PNG にする
const zlib = require('zlib');

const B = 0.24;   // 奥の壁の半分の大きさ（画面の半分を1とする）
const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const frac = x => x - Math.floor(x);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const WALL = [204, 184, 92], STRIPE = [186, 166, 78], BASE = [120, 100, 48], CARPET = [146, 126, 64], CEIL = [214, 206, 160], GRID = [168, 160, 118], LAMP = [255, 251, 226], DOOR = [10, 9, 6];

// u, v は -1〜1（右・下が正）。消える点は真ん中
function shade(u, v, px, py) {
  let c, z;
  const au = Math.abs(u), av = Math.abs(v);
  if (au <= B && av <= B) {
    z = 1 / B;
    c = WALL;
    if (au < 0.075 && v > -0.07) { c = mix(DOOR, [40, 34, 16], Math.max(0, (v + 0.07) / 0.31) * 0.25); z = 0; }
    else if (v > B - 0.03) c = BASE;
  } else if (au >= av) {
    z = 1 / au;
    const h = v / au;
    c = frac(z * 4) < 0.5 ? WALL : STRIPE;
    if (h > 0.86) c = BASE;
    c = c.map(x => x * (1.06 - 0.1 * (h + 1)));
  } else if (v > 0) {
    z = 1 / av;
    c = CARPET.map(x => x * (0.88 + 0.08 * Math.floor(hash(px >> 1, py >> 1) * 4)));
  } else {
    z = 1 / av;
    const x = u / av;
    const gz = frac(z * 2), gx = frac((x + 1) * 1.5);
    c = (gz < 0.05 || gx < 0.05) ? GRID : CEIL;
    if (((z > 1.5 && z < 1.95) || (z > 2.8 && z < 3.05)) && Math.abs(x) < 0.32) c = LAMP;
  }
  // 遠いほど暗く、まわりも少し暗く。奥の灯りの下はほんのり明るい
  let k = z ? Math.max(0.35, 1.08 - 0.15 * (z - 1)) : 1;
  k *= 1 - 0.3 * Math.min(1, (u * u + v * v) / 2);
  k += 0.12 * Math.exp(-((u * u) / 0.08 + ((v + 0.12) * (v + 0.12)) / 0.05));
  return c.map(x => Math.min(255, x * k));
}

function draw(size) {
  const ss = size >= 384 ? 2 : 3, px = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) {
      const sx = x + (i + 0.5) / ss, sy = y + (j + 0.5) / ss;
      const c = shade(sx / size * 2 - 1, sy / size * 2 - 1, Math.floor(sx * 512 / size), Math.floor(sy * 512 / size));
      r += c[0]; g += c[1]; b += c[2];
    }
    const o = (y * size + x) * 3, n = ss * ss;
    px[o] = Math.round(r / n); px[o + 1] = Math.round(g / n); px[o + 2] = Math.round(b / n);
  }
  return png(size, size, px);
}

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4), crc = Buffer.alloc(4), td = Buffer.concat([Buffer.from(type), data]);
  len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;   // 8bit RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
module.exports = { draw };
