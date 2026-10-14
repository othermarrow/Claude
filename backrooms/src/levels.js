// ===== 小道具 =====
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// 座標から決まる乱数（0〜1）
function hash3(s, x, y) {
  let h = (s ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function hashInt(s, x, y) { return (hash3(s, x, y) * 4294967296) >>> 0; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }

// ===== 層 =====
// tex: 壁・床・天井・出口の絵, light: 蛍光灯の色, amb: 灯りがなくても見える明るさ
// fog: 霧の色と濃さ, lamps: 灯りの並び方と、点く・ちらつく・消えている割合
// ents: 出てくるもの, exitD: 出口までのおよその距離（マス）
const LEVELS = [
  {
    n: '第0層', name: '黄色い部屋', gen: 'office',
    tex: { wall: 'wp0', floor: 'cp0', ceil: 'ct0', exit: 'ex0' },
    light: [255, 247, 214], amb: 0.16, fog: [92, 82, 40], fogK: 0.11,
    lamps: { every: 3, on: 0.88, flick: 0.08, darkBlock: 0.06 },
    ents: { wander: { first: 150, every: 170, max: 1 } },
    exitD: 42, exitName: '非常口', exitVerb: '非常口の扉を開ける', step: 'carpet',
    items: { water: 0.32, battery: 0.18, map: 0.06, note: 0.14 },
    hum: 1.0, reverb: 2.2, beacon: 'musicbox',
    walls: { segs: [7, 11], pillars: [2, 6], rooms: 0.35 },
  },
  {
    n: '第1層', name: '灰色の倉庫', gen: 'warehouse',
    tex: { wall: 'cn1', floor: 'cf1', ceil: 'cc1', exit: 'ex1' },
    light: [222, 236, 255], amb: 0.07, fog: [14, 16, 20], fogK: 0.12,
    lamps: { every: 4, on: 0.66, flick: 0.16, darkBlock: 0.22 },
    ents: { wander: { first: 50, every: 80, max: 2 } },
    exitD: 50, exitName: '階段室の扉', exitVerb: '階段室へ入る', step: 'concrete',
    items: { water: 0.36, battery: 0.3, map: 0.08, note: 0.14 },
    hum: 0.6, reverb: 3.0, beacon: 'radio',
  },
  {
    n: '第2層', name: '配管の通路', gen: 'maze',
    tex: { wall: 'pp2', floor: 'gr2', ceil: 'pc2', exit: 'ex2' },
    light: [255, 128, 72], amb: 0.05, fog: [12, 4, 2], fogK: 0.16,
    lamps: { every: 4, on: 0.6, flick: 0.2, darkBlock: 0.12 },
    ents: { wander: { first: 40, every: 65, max: 2 } },
    exitD: 46, exitName: '点検口', exitVerb: '点検口をくぐる', step: 'metal',
    items: { water: 0.45, battery: 0.3, map: 0.1, note: 0.14 },
    hum: 0.4, reverb: 1.2, beacon: 'wind',
  },
  {
    n: '第3層', name: '消灯した事務所', gen: 'office',
    tex: { wall: 'wp3', floor: 'cp3', ceil: 'ct3', exit: 'ex3' },
    light: [226, 236, 255], amb: 0.025, fog: [0, 0, 0], fogK: 0.13,
    lamps: { every: 3, on: 0.08, flick: 0.12, darkBlock: 0.0 },
    ents: { grin: { first: 25, every: 45, max: 2 }, wander: { first: 200, every: 200, max: 1 } },
    exitD: 46, exitName: 'エレベーター', exitVerb: 'エレベーターに乗る', step: 'carpet',
    items: { water: 0.32, battery: 0.45, map: 0.08, note: 0.14 },
    hum: 0.25, reverb: 1.8, beacon: 'ding',
    walls: { segs: [8, 12], pillars: [2, 5], rooms: 0.45 },
  },
  {
    n: '第4層', name: '白いタイルの部屋', gen: 'pool',
    tex: { wall: 'tl4', floor: 'tf4', ceil: 'tc4', exit: 'ex4' },
    light: [255, 252, 240], amb: 0.62, fog: [206, 222, 226], fogK: 0.06, lampK: 0.3,
    lamps: { every: 4, on: 0.97, flick: 0.02, darkBlock: 0 },
    ents: {},
    exitD: 30, exitName: '光の漏れる扉', exitVerb: '光の中へ出る', step: 'tile',
    items: { water: 0.1, battery: 0, map: 0, note: 0.2 },
    hum: 0.0, reverb: 3.5, beacon: 'chord', calm: 1,
  },
];

// 拾えるメモ（層ごと）
const NOTES = [
  [0, 'ここに来たばかりなら、まず水を探せ。喉の渇きは、怖さより先にお前を殺す。'],
  [0, '三日目。いや、四日目かもしれない。蛍光灯の音で眠れない。音は止まらない。'],
  [0, '同じ部屋を何度も通った気がする。壁のしみの形を覚えろ。……しみも増えている。'],
  [0, '緑の灯りを見た者は、出られたらしい。オルゴールの音がする方へ行け、と誰かが書いていた。'],
  [1, '倉庫には何もない。箱も棚も空っぽだ。誰が、何のために並べたのか。'],
  [1, '走るな。走る足音を、あれは聞いている。'],
  [1, '暗い場所では明かりを切らすな。電池は思っているより早く減る。'],
  [1, 'ラジオの音を追った。階段の扉があった。下へ行くほど、静かになるらしい。'],
  [2, '配管が鳴っている。ときどき、配管の中から返事がある。'],
  [2, '右手を壁につけて歩け。それで戻れなくなっても、私のせいではない。'],
  [2, '暑い。水が足りない。ここで倒れた者のメモを、いくつも拾った。'],
  [2, '点検口の向こうから、風が来る。風の音のする方へ。'],
  [3, '明かりの消えた部屋で、笑い声がした。ライトを向けたら、止まった。'],
  [3, 'あれは光が嫌いだ。でも電池は永遠じゃない。'],
  [3, 'エレベーターは動いていた。チンという音がした。ボタンは一つしかなかった。'],
  [3, '暗闇で目を閉じるな。開けていても、暗さは同じなのに。'],
  [4, 'ここは静かだ。水の音しかしない。ずっとここにいてもいい気がする。'],
  [4, '扉の隙間から、本物の日の光がこぼれていた。私は、怖くて開けられなかった。'],
];

// 出てくるもの
const ENTS = {
  wander: { n: '徘徊者', spr: 'sp_wander', h: 1.05, speed: [1.0, 1.7, 2.45], hear: 13, see: 12 },
  grin: { n: '笑う闇', spr: 'sp_grin', h: 0.9, speed: [0.8, 2.9, 2.9], see: 14 },
};
