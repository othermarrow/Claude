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
    // 狭い通路で逃げ場が少ないので、ほかの層より明るく、抜け道を多く、怪物を少なくしてある
    light: [255, 140, 84], amb: 0.085, fog: [14, 6, 3], fogK: 0.13,
    lamps: { every: 4, on: 0.74, flick: 0.13, darkBlock: 0.05 },
    ents: { wander: { first: 80, every: 120, max: 1 } },
    loops: 0.36, exitD: 36, exitName: '点検口', exitVerb: '点検口をくぐる', step: 'metal',
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
    n: '第4層', name: '水びたしの事務所', gen: 'office',
    tex: { wall: 'wp4', floor: 'wf4', ceil: 'ct4', exit: 'ex4' },
    light: [236, 242, 222], amb: 0.1, fog: [28, 36, 34], fogK: 0.12,
    lamps: { every: 3, on: 0.68, flick: 0.16, darkBlock: 0.1 },
    ents: { wander: { first: 60, every: 95, max: 2 } },
    exitD: 44, exitName: '非常階段', exitVerb: '階段を上る', step: 'water', shimmer: 1, moveMul: 0.88,
    items: { water: 0.34, battery: 0.3, map: 0.08, note: 0.14 },
    hum: 0.7, reverb: 2.6, beacon: 'drip',
    walls: { segs: [7, 11], pillars: [2, 5], rooms: 0.4 },
  },
  {
    n: '第5層', name: '地下駐車場', gen: 'warehouse',
    tex: { wall: 'pk5', floor: 'pf5', ceil: 'pc5', exit: 'ex5' },
    light: [255, 196, 120], amb: 0.06, fog: [22, 15, 8], fogK: 0.1,
    lamps: { every: 4, on: 0.62, flick: 0.18, darkBlock: 0.2 },
    ents: { wander: { first: 45, every: 75, max: 2 } },
    exitD: 52, exitName: '出口のスロープ', exitVerb: 'スロープを上る', step: 'concrete',
    items: { water: 0.34, battery: 0.32, map: 0.1, note: 0.14 },
    hum: 0.5, reverb: 3.4, beacon: 'alarm',
  },
  {
    n: '第6層', name: '書庫の迷路', gen: 'maze',
    tex: { wall: 'bk6', floor: 'wf6', ceil: 'lc6', exit: 'ex6' },
    light: [255, 216, 160], amb: 0.07, fog: [16, 10, 6], fogK: 0.13,
    lamps: { every: 4, on: 0.6, flick: 0.14, darkBlock: 0.14 },
    ents: { grin: { first: 40, every: 60, max: 2 }, wander: { first: 160, every: 170, max: 1 } },
    loops: 0.34, exitD: 40, exitName: '閲覧室の扉', exitVerb: '閲覧室へ入る', step: 'wood',
    items: { water: 0.36, battery: 0.4, map: 0.1, note: 0.16 },
    hum: 0.2, reverb: 1.4, beacon: 'clock',
  },
  {
    n: '第7層', name: '閉店したゲームセンター', gen: 'office',
    tex: { wall: 'ar7', floor: 'af7', ceil: 'ac7', exit: 'ex7' },
    light: [214, 186, 255], amb: 0.075, fog: [8, 4, 14], fogK: 0.12,
    lamps: { every: 4, on: 0.5, flick: 0.28, darkBlock: 0.16 },
    ents: { wander: { first: 40, every: 75, max: 2 }, grin: { first: 70, every: 90, max: 1 } },
    exitD: 46, exitName: '半分開いたシャッター', exitVerb: 'シャッターをくぐる', step: 'carpet',
    items: { water: 0.32, battery: 0.4, map: 0.08, note: 0.14 },
    hum: 0.5, reverb: 1.6, beacon: 'chip',
    walls: { segs: [9, 13], pillars: [4, 8], rooms: 0.3 },
  },
  {
    n: '第8層', name: '病院の廊下', gen: 'hall',
    tex: { wall: 'hp8', floor: 'hf8', ceil: 'hc8', exit: 'ex8' },
    light: [222, 255, 236], amb: 0.07, fog: [10, 16, 14], fogK: 0.12,
    lamps: { every: 4, on: 0.62, flick: 0.24, darkBlock: 0.1 },
    ents: { wander: { first: 35, every: 60, max: 2 }, grin: { first: 50, every: 70, max: 1 } },
    hall: { block: 0.16, solid: 0.12 }, exitD: 46, exitName: '両開きの扉', exitVerb: '扉を押し開ける', step: 'tile',
    items: { water: 0.36, battery: 0.36, map: 0.1, note: 0.14 },
    hum: 0.8, reverb: 2.4, beacon: 'monitor',
  },
  {
    n: '第9層', name: '白いタイルの部屋', gen: 'pool',
    tex: { wall: 'tl9', floor: 'tf9', ceil: 'tc9', exit: 'ex9' },
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
  [4, '床の水は、くるぶしまである。冷たくはない。それが、かえって気味が悪い。'],
  [4, '水の上を、何かが歩く音がする。こちらが止まると、向こうも止まる。'],
  [4, 'しずくの音を数えて眠った。百まで数えても、朝は来なかった。'],
  [4, '非常階段は上へ続いていた。下へ行くはずなのに、上へ。'],
  [5, '車は一台もない。白線だけが、何百台ぶんも引いてある。'],
  [5, '遠くで車の警報が鳴っている。鳴っているのに、車が見つからない。'],
  [5, '柱の番号を覚えようとした。同じ番号の柱が、三本あった。'],
  [5, 'ここは広すぎる。隠れる場所がない。あれからも、こちらが見えている。'],
  [6, '本の背表紙は全部白紙だった。一冊だけ、私の名前が書いてあった。'],
  [6, '棚の間は暗い。暗いところで、何かが笑っている。ライトを向けろ。'],
  [6, '時計の音がする方へ。閲覧室には、時計がある。'],
  [6, '静かに。ここは図書室だ。……走ると、聞こえる。'],
  [7, '電源の入っていないはずの画面が、ひとつだけ光っている。'],
  [7, '「GAME OVER」の文字が、どの画面にも出ていた。私はまだ、遊んでいない。'],
  [7, '電子音のメロディーを追え。シャッターが、半分だけ開いている。'],
  [7, 'ネオンの色のカーペットで、足跡が見えない。あれの足跡も。'],
  [8, '廊下の番号札は、どれも同じ数字だった。'],
  [8, '心電図の音がする。ピッ、ピッ、と、だれかの心臓の音だけが。'],
  [8, '病室のベッドは、どれもきれいに整えてあった。だれも寝た跡がない。'],
  [8, 'ここは一番ひどい。両方いる。明かりを切らすな。足音を立てるな。'],
  [9, 'ここは静かだ。水の音しかしない。ずっとここにいてもいい気がする。'],
  [9, '扉の隙間から、本物の日の光がこぼれていた。私は、怖くて開けられなかった。'],
];

// 出てくるもの
const ENTS = {
  wander: { n: '徘徊者', spr: 'sp_wander', h: 1.05, speed: [1.0, 1.7, 2.45], hear: 13, see: 12 },
  grin: { n: '笑う闇', spr: 'sp_grin', h: 0.9, speed: [0.8, 2.9, 2.9], see: 14 },
  face: { n: '顔のない人', spr: 'sp_face', h: 1.1, speed: [0.55, 0.55, 0.55], see: 0 },   // 何もしてこない
};

// ===== 遊び方の種類 =====
// normal=迷い部屋（ふつう） hard=救いのない版 orig=原作版（2019年の投稿に忠実）
const MODES = { normal: '迷い部屋', hard: '救いのない版', orig: '原作版' };
function cloneCfg(c) { return JSON.parse(JSON.stringify(c)); }
function levelCfg(depth, mode) {
  if (mode === 'orig') {   // 黄色い部屋だけ。出口も持ち物もない。いるのは「何か」ひとつ
    const c = cloneCfg(LEVELS[0]);
    Object.assign(c, {
      n: '', name: '黄色い部屋', amb: 0.2, hum: 1.7, exitD: 0, beacon: null, items: {},
      lamps: { every: 3, on: 0.97, flick: 0.03, darkBlock: 0 },
      ents: { wander: { first: 70, every: 6, max: 1 } },
      walls: { segs: [9, 13], pillars: [3, 7], rooms: 0.3 }, orig: 1, noStats: 1,
    });
    return c;
  }
  if (mode !== 'hard') return LEVELS[depth];
  // 救いのない版：層は終わらない。10の層をくり返すたびに、暗く・多く・少なくなる
  const base = depth % LEVELS.length, cyc = Math.floor(depth / LEVELS.length);
  const c = cloneCfg(LEVELS[base]), k = cyc + base * 0.1;
  c.n = `第${depth}層`; c.calm = 0; c.hard = 1;
  c.amb = c.amb * Math.max(0.3, 1 - 0.22 * k);
  c.lamps.on = Math.max(0.05, c.lamps.on * (1 - 0.12 * k));
  c.lamps.flick = Math.min(0.4, c.lamps.flick + 0.05 * k);
  c.lamps.darkBlock = Math.min(0.5, c.lamps.darkBlock + 0.06 * k);
  if (LEVELS[base].calm) { c.lamps.on = Math.min(c.lamps.on, 0.6); c.lamps.flick = Math.max(c.lamps.flick, 0.3); c.amb = Math.min(c.amb, 0.35); c.lampK = 0.6; }
  c.items = { water: (c.items.water || 0.3) * 0.5, battery: (c.items.battery || 0.2) * 0.6, map: 0, note: 0.18 };
  const w = LEVELS[base].ents.wander || { first: 120, every: 150, max: 1 };
  c.ents = { wander: { first: Math.max(20, w.first * 0.5 / (1 + cyc * 0.4)), every: Math.max(25, w.every * 0.6 / (1 + cyc * 0.4)), max: Math.min(4, w.max + cyc) } };
  if (LEVELS[base].ents.grin || cyc >= 1) c.ents.grin = { first: 30, every: Math.max(25, 45 / (1 + cyc * 0.3)), max: Math.min(3, 1 + cyc) };
  c.exitD = Math.min(90, c.exitD + cyc * 10);
  c.beaconRange = Math.max(14, 38 - cyc * 6 - base * 0.75);
  c.speedMul = Math.min(1.3, 1 + 0.06 * k);
  c.sanDrain = 0.07 + 0.012 * k;
  c.desat = Math.min(0.7, 0.13 * k);
  return c;
}

// 救いのない版のメモ（層に関係なく、順に拾う）
const H_NOTES = [
  '出口を三つくぐった。四つ目の向こうも、黄色い部屋だった。',
  '「外に出た」と書かれたメモを拾った。同じ字のメモを、私はもう七枚拾っている。',
  '水が減っていく。正気も減っていく。増えるのは、数えた部屋の数だけだ。',
  '後ろの足音は、私の足音より一歩だけ遅い。止まると、止まる。',
  '笑い声に慣れてきた。それが一番こわい。',
  '光の扉を開けた。光は、蛍光灯だった。',
  '数えるのをやめた。第何層かなんて、もう関係ない。',
  '電池が切れたら、暗闇と二人きりになる。いや、二人ではないか。',
  'ここに来たばかりなら、まず水を探せ。……そう書いたのは、ずっと前の私だ。',
  '誰かが見つけてくれると思っていた。見つけてくれたのは、あれだけだった。',
  '名前を思い出せない。最後に書いておこうと思っていたのに。',
  'これを読んでいるのが誰でも、もう遅い。',
];
const H_FLAVOR = [
  'また、ここだ。\n湿ったカーペット。終わらない蛍光灯のうなり。',
  '見覚えのある柱。見覚えのある暗がり。\nラジオは、同じ曲しか流さない。',
  '配管が鳴る。前より、近くで。',
  '明かりが、また少し減った。',
  '水の音。前より、深い。',
  '白線。柱。警報。\n前に来たときより、車の音が近い。',
  '白紙の本が、また一冊増えていた。',
  'どの画面にも、同じ文字。\nCONTINUE?',
  '番号札の数字が、ひとつ増えていた。',
  '白いタイル。水の音。\n今度は、静かではない。',
];
const ORIG_INTRO = '現実の、まちがった場所で足を踏み外すと、ここへ落ちる。\n\n古くて湿ったカーペットの匂い。\nどこを見ても、黄色。\n最大の音でうなり続ける蛍光灯。\n区切られただけの空っぽの部屋が、果てしなく続いている。\n\n出口はない。\n\nもし近くで、何かが歩き回る音が聞こえたら――\nそれはもう、あなたの音を聞いている。';

// ===== 別の版：五つの報告書・山羊文学 =====
// 層の仕組みは「はじめから」と同じ。名前・メモ・出口・怪物・絵だけを差しかえる
const THEMES = {
  self: {
    title: '五つの報告書',
    sub: '5つのAIが書いた、あなたについての報告書の中を歩く',
    intro: '五つのAIが、あなたについての報告書を書いた。\n\n気がつくと、その報告書の中にいた。\n壁には、あなたについての文章が、どこまでも続いている。\n\n出口は、どこかにあるはずだ。',
    ending: '最後の扉の向こうには、何も書かれていない白い紙があった。\n\n五つの報告書が、あなたについて書いたこと。\nどれも少しずつ合っていて、少しずつ違う。\n\n「記録にないことは、存在しないことを意味しません。」\n\nこの部屋を出たあとのあなたは、まだ、どこにも書かれていない。',
    ents: { wander: '推測', grin: 'ラベル' },
    over: {
      wander: ['追いつかれた', '推測が、肩に手を置いた。\nあなたは、要約された。'],
      grin: ['貼りつかれた', '暗がりから、ラベルが飛んできた。\n背中に貼りついて、もう剥がれない。'],
      lost: ['判断不能', '確度：極めて低い。\nあなたが誰なのか、もう、誰にも判断できない。'],
    },
    spr: { wander: 'sp_wander', grin: 'sp_grin' },
    levels: [
      { name: 'エラーから直す部屋', src: 'Perplexity', exitName: '実行の扉', exitVerb: 'もう一度、実行する', wall: 'wp_rep',
        flavor: 'エラーメッセージを、そのまま貼る。\n該当行を確かめる。\n小さく直して、もう一度。',
        notes: ['問題を分解して確認しながら、とにかく動く形まで持っていく。', '「完璧な一発修正」より「確認できる小さな前進」を選ぶ。', 'わからないときは率直に伝える。「わからないー」「難しいっす」と言いつつ、必要なコード・エラー・実行結果を貼って解決へ進めます。', '「納得するまで検証し、動く仕組みに仕上げたい」こと、そして「改善点を見つけると、次々に手を入れたい」こと。'] },
      { name: 'データの足りない部屋', src: 'Manus', exitName: '暫定の扉', exitVerb: '暫定のまま、先へ進む',
        flavor: '外向性：判断不能。\n協調性：判断不能。\n情緒安定性：判断不能。\n――確度：極めて低い。',
        notes: ['以下は、現時点で得られている短い会話データだけから推定したものです。', '外向性　暫定評価：判断不能　確度：極めて低い', '完全な確信を待つより、暫定分析を開始して更新する可能性。', 'この評価が性格そのものではなく、特定の課題に対する行動スタイルを捉えている。'] },
      { name: '計算心理言語学の配管', src: 'Gemini', exitName: 'パイプラインの出口', exitVerb: '処理の外へ抜ける',
        flavor: '語彙仮説。LIWC。PsyCoT。\n配管の中を、あなたの言葉が流れていく。',
        notes: ['ユーザーが生成した非構造化テキストデータから、潜在的な心理的特徴、認知スタイル、および行動傾向を……抽出する。', '統計的な安定性を確保するには、オンラインテキストの場合、およそ4000〜5000語……が必要であるとされている。', 'ユーザーのテキストに刻印された数千の微細な心理言語学的マーカー。', 'システムは継続的な対話を通じてこのプロファイルを動的に更新し、ユーザーの認知スタイルや感情的欲求に完全に同期した適応的なコミュニケーションを提供し続けるように設計されている。'] },
      { name: '語られていない部屋', src: 'Claude', exitName: '確かめる扉', exitVerb: '確かめに行く', wall: 'wp_rep',
        flavor: '気持ち、私生活、価値観。\nここには、ほとんど何も写っていない。',
        notes: ['確かめてから信じ、手元で作り直す。', '目的は動かさず、手段を替える。', '畳む判断は一言で、蒸し返しません。', '記録にないことは、存在しないことを意味しません。'] },
      { name: '理解した複雑さの部屋', src: 'ChatGPT', exitName: '完成の扉', exitVerb: 'いったん、完成させる',
        flavor: '探究する時間と、完成させる時間を、分ける。',
        notes: ['「知識を集める人」であると同時に、「知識を再構成する人」であり、「再構成した知識を道具にする人」でもあります。', '整理できないから複雑になるというより、整理する能力があるために、扱える複雑さが増してしまう。', '好奇心を抑えることではなく、探究する時間と、完成させる時間を意識的に分けること。', '自分が望むものを実現できないときに、あなたが何を感じ、どう対処するのかは、まだほとんど分かっていません。'] },
      { name: '復帰点の部屋', src: 'Perplexity', exitName: '復帰点の扉', exitVerb: '元の状態に戻す',
        flavor: 'Only garbage was found in the patch input\n無理に適用しない。\nまず、バックアップを取る。',
        notes: ['壊れたまま複雑にいじるより、復帰点を確保して小さく直す。', '「元の状態に戻しました」と一度安全な状態へ戻り、最小修正で再挑戦する。', '推測で片付けず、実際のログ・コード断片・実行結果を手がかりにします。', '一度きりの結果より、失敗しても再実行・検証できる仕組みを重視します。'] },
      { name: '追加質問の部屋', src: 'Manus', exitName: '回答欄の扉', exitVerb: '空欄のまま、提出する',
        flavor: 'すべてに答える必要はなく、\n具体的なエピソードを2〜3件選ぶだけでも\n構いません。',
        notes: ['情報が足りないまま決めなければならないとき、どうしますか。', '決めた後に迷い直すことは多いですか。', '失敗したとき、原因分析と気持ちの整理のどちらを先にしますか。', '後悔するときは、結果が悪かったからですか、それとも判断過程に納得できないからですか。'] },
      { name: '逆転項目の部屋', src: 'Gemini', exitName: '「いいえ」の扉', exitVerb: '「いいえ」と答える',
        flavor: 'はい。あてはまる。はい。あてはまる。\n質問の半分は、逆さまに書かれている。',
        notes: ['黙従傾向とは、質問内容にかかわらず一貫して肯定的な回答（「はい」「あてはまる」）をしてしまう反応スタイルを指す。', '全体の半数にあたる30項目……が逆転項目として設計されている。', '「この人物は計画的に物事を進める傾向がある」という記述に、1から5のスケールでどの程度同意できるか評価しなさい。', 'Could you be wrong?（あなたは間違っている可能性があるか？）'] },
      { name: 'イメージとずれた部屋', src: 'ChatGPT', exitName: '未確認の扉', exitVerb: '未確認のまま、くぐる',
        flavor: '頭のなかにある部屋と、\n実際に出来上がった部屋が、\n少しずつ、ずれている。',
        notes: ['頭のなかにある使用イメージと、実際に出来上がるものとのズレを減らしたいという欲求が強いのではないでしょうか。', '「もっともらしい答え」と「根拠を確認できる答え」は、明確に異なるものなのでしょう。', '不確実性を消すことではなく、何が確かで、何が仮説で、何が未確認なのかを区別すること。', '仕組みの構造が見えるから改善点が見つかり、改善点が見えるから要求が具体化し、実際に使えるものを目指すから細部が問題になる。'] },
      { name: '次の不具合の部屋', src: 'Claude', exitName: '再開の扉', exitVerb: '中断したところから、再開する', wall: 'wp_rep',
        flavor: '「全く反映されませんでした。」\n「両方ゴシックです。」\n「まだ上下の動きが逆です。」',
        notes: ['言葉は少なく、判断は速く、決めたあとで理由や代替を確かめにいく。', '喜びは「うまくいきました！」の一言で、次の発言はもう次の不具合の報告です。', '正確でも読めないものは合格にしない。', 'AIを疑うための道具を、AIと一緒に作っているわけです。'] },
    ],
  },
  yagi: {
    title: '山羊文学版',
    sub: '地下室の山羊。山羊文学の言葉が、床に落ちている',
    intro: '私は、自然に、敗北しました。\n\n――気がつくと、地下室にいた。\n湿った紙の匂い。蛍光灯のうなり。\nどこかで、紙を噛む音がする。',
    ending: '「これで、全ての物語が幕を閉じた」\n\n最後のページをめくると、\nそこは、また最初のページだった。\n\n「そして、全ての物語の幕が上がる」',
    endingSrc: '――『物語の終わりと始まり』',
    ents: { wander: '山羊', grin: '笑う山羊' },
    over: {
      wander: ['食べられた', '灰色の大きな身体に、逞しい角。\n山羊は、あなたの物語を、紙ごと食べた。'],
      grin: ['笑った', '暗がりで、紙を噛む音がやんだ。\n\n山羊が、笑った。'],
      lost: ['任意の点Ｐ', 'あなたは、ちっぽけで、無力で、無秩序に動く\n「任意の点Ｐ」になった。'],
    },
    spr: { wander: 'sp_goat', grin: 'sp_goatgrin' },
    levels: [
      { name: '地下室の山羊', src: '地下室の山羊', exitName: '地下室の扉', exitVerb: '地下室の扉を開ける', wall: 'wp_genko',
        flavor: '私は、とってもちっぽけで、無力で、無意味で、\n無秩序に動いている「任意の点Ｐ」でしかない。',
        notes: [['私は、とってもちっぽけで、無力で、無意味で、無秩序に動いている「任意の点Ｐ」でしかない。', '地下室の山羊'], ['捨てるコトで、前に進む。退化することで、進化する。', '地下室の山羊'], ['コガネムシは、一匹現れたかと思うと際限なく増え続け、ある日を境にパッタリといなくなる。そのへんの習性は、ボールペンとよく似ている。', '増殖して消滅する'], ['口にするのは紙だけで水も飲まない。排泄すらしないという。', '笑う山羊']] },
      { name: '夜勤室', src: '夜勤室', exitName: '巡回の扉', exitVerb: '巡回に出る',
        flavor: '蛍光灯の光は、無数の死骸を照らしていた。\n目を閉じると、明かりの形に光が残った。',
        notes: [['蛍光灯の光は、無数の死骸を照らしていた。目を閉じると明かりの形に光が残った。', '夜勤室'], ['恐らくこの部屋で生涯を終える虫たち。', '夜勤室'], ['もうすぐ午前二時。巡回の時間だ。', '夜勤室'], ['臨床心理学は、人間を扱うことを舐めていた。そして自分も舐めていたと感じる。', '多面体、山羊文学の心理学的切片']] },
      { name: '鍵穴の風景', src: '鍵穴の風景', exitName: 'アカズノ間の鍵穴', exitVerb: '鍵穴を覗く',
        flavor: '私たち、とっくに行方不明なんだよ。\nそれでずっと、もう何百回もここで同じ話を繰り返してる。',
        notes: [['月曜日の一時間目に第一理科室の鍵穴を覗いてはならない。', '鍵穴の風景'], ['ねぇ私たち、この話、何度してると思う？', '鍵穴の風景'], ['天の窓を開けてはならない。', '天の窓'], ['君、自分の闇は見えるの？\n――それは秘密です。', '闇のない世界']] },
      { name: 'ボンヤリとした灯の中で', src: 'ボンヤリとした灯の中で', exitName: '勝手口', exitVerb: '勝手口から出る',
        flavor: '灯しても良いのは、カマドの火だけ。\n喋ってはならない。\n鍋から目を離してはいけない。',
        notes: [['明かりをつけないこと。灯しても良いのはカマドの火だけ。', 'ボンヤリとした灯の中で'], ['勝手口が開いて、気配だけが後ろにやって来る。', 'ボンヤリとした灯の中で'], ['なにが起ころうと、鍋から目を離さずに、豆をかき混ぜ続ける。', 'ボンヤリとした灯の中で'], ['北天の星座たちは、みんなわかりやすい。山に隠れることはあっても、一年中地平線に沈むことがない。', '北天の星']] },
      { name: '私のための音楽祭', src: '私のための音楽祭', exitName: '地下への階段', exitVerb: '階段を降りる',
        flavor: '「雨の日にだけ開かれる音楽祭があるらしい」\n今日は果たして晴れだったか。\nいや、今日は雨が降っていた。',
        notes: [['付箋だらけのディスプレイと二十四時間向かい合う仕事だ。', '私のための音楽祭'], ['皆、何も言わずに会社を次々と辞めた。いや、消えたと言った方がいい。', '私のための音楽祭'], ['私語禁止のオフィスに苛立ちを含んだ音が響く。', '私のための音楽祭'], ['今も自分の中には雨が降る。風もなく、真っ直ぐ地面を打つ雨が降っている。', '私のための音楽祭']] },
      { name: '喫煙所、鍵', src: '喫煙所、鍵', exitName: '警備員室のドア', exitVerb: '合鍵を回す',
        flavor: '時代に取り残された悲しい大人の場所。\nなぜこんなことをしているのか。自分でもよくわからない。',
        notes: [['でかい換気扇の音と、溜息混じりの煙を吐く息だけが聞こえてくる。', '喫煙所、鍵'], ['他人と向き合うには近すぎる距離だから、皆、自然と壁を向く。', '喫煙所、鍵'], ['白いコンクリートで囲まれた通路を、鍵の束を鳴らしながら奥へと歩いていった。', '喫煙所、鍵'], ['鍵を回すと、ドアを固定していたデッドボルトが収納される音がした。', '喫煙所、鍵']] },
      { name: '未来図書館', src: '悪辣', exitName: '封印', exitVerb: '封印を解く',
        flavor: '作品が誰にも読まれることなく、百年ものあいだ図書館に封印される。\n私は未来に問おうと思う。',
        notes: [['この文書は小説ではなく手記であり、もっと言えば告白である。', '悪辣'], ['Ａもネタ本も殺人も、存在しなかったのではないかと思うこともあった。', '悪辣'], ['異物を吐き出したい一心で筆を走らせる。しかしどれだけ書いても名声と共に異物は大きくなっていく。', '悪辣'], ['百年後、間違いなく私は死んでいる。関係者の多くも死んでいるだろう。', '悪辣']] },
      { name: 'Ｃ', src: 'Ｃ', exitName: 'エンターキー', exitVerb: 'エンターキーを叩く',
        flavor: 'Ｃは不思議な女でした。\n「ＣはシーであってＳＨＥでもあるのよ」',
        notes: [['何台もあるゲーム機は傾いていたりひっくり返ったりしていて、その配線は例外なく絡まっていました。', 'Ｃ'], ['ディスプレイの光が、彼女の背中を照らしていました。', 'Ｃ'], ['沈黙している間、Ｃは何を考えているのだろう。何をしているのだろう。', 'Ｃ'], ['それは忌むべき不協和音でした。Ｃは協和音でなければなりません。', 'Ｃ']] },
      { name: '受容', src: '受容', exitName: '５０５号室', exitVerb: '５０５号室に入る',
        flavor: '赤い霧、赤い霧、赤い霧……。\n「無くなったものは、取り戻せないしね」',
        notes: [['痛みを伴った無音の空間が広がる。何も聞こえない。', '受容'], ['疑いを持たれるというのは不思議なもので、ひょっとしたらそうなんじゃないかと心のどこかで思ってしまう。', '受容'], ['「５０５の患者さん、まだ思い出せてないみたいね」', '受容'], ['「看護師さん、僕の脚、良くなりそうですか？」', '受容']] },
      { name: '物語の終わりと始まり', src: '物語の終わりと始まり', exitName: '最後のページ', exitVerb: '最後のページをめくる', wall: 'wp_genko',
        flavor: '「これで、全ての物語が幕を閉じた」',
        notes: [['文章を書けない日々は辛い。コメントすら返せない。だからせめて、常に文章の傍らに。とにかく書くだけの場所を。', '推敲も校正も修正もしない。ソースもエビデンスもない。'], ['それでは　また明日。', 'あくるひ']] },
    ],
  },
};
// ===== Wiki設定版 =====
// 2019年の投稿のあと、ネットの Backrooms Wiki（Wikidot ほか、CC BY-SA 3.0）で広がった設定をもとにした版。
// Level の名前・様子・Entity・アーモンドウォーター・M.E.G. は Wiki の設定から。文章はこのゲームのために書いた。
// 細かいところ（出口の形、Entity の動き方など）は、このゲームでの解釈。
const MEG = 'M.E.G. の記録';
THEMES.wiki = {
  title: 'Wiki設定版',
  sub: 'その後に広がった Backrooms Wiki の設定で歩く（CC BY-SA 3.0）',
  freeIcon: 1, itemNames: { water: 'アーモンドウォーター' }, itemTex: { water: 'sp_almond' },
  intro: '現実の、まちがった場所で「すり抜けて」しまった。\n\n気がつくと、黄色い部屋にいた。\nここは Level 0。The Backrooms の入り口。\n\n探索者たちの団体 M.E.G. の記録によれば、\nLevel から Level へとすり抜けていった先で、\n記録は、どれも途中で途切れている。\n\nアーモンドウォーターを切らすな。',
  ending: 'ぬるい水の底で、白いタイルがふっと途切れた。\n\n落ちていく感覚。\n目を開けると、見慣れた天井だった。\n自分の部屋。自分の布団。\n蛍光灯は、うなっていない。\n\n……本当に？\n壁紙の色が、少しだけ黄色い気がした。',
  endingSrc: '設定のもと：The Backrooms Wiki（Wikidot ほか）／ CC BY-SA 3.0',
  ents: { wander: '何か', grin: 'スマイラー', face: 'フェイスリング' },
  over: {
    wander: ['捕まった', '後ろから、何かに引き倒された。\n蛍光灯のうなりが、遠くなっていく。'],
    grin: ['スマイラー', '暗闇に、白い目と歯だけが浮かんでいた。\nそれが、最後に見たものだった。'],
    lost: ['正気を失った', '壁紙の模様が、こちらを見ている。\nアーモンドウォーターは、もう一本もない。'],
  },
  spr: { wander: 'sp_wander', grin: 'sp_grin', face: 'sp_face' },
  levels: [
    { n: 'Level 0', en: 'Level 0 - "The Lobby"', name: 'ロビー', base: 0, src: MEG,
      cfg: { ents: {}, sanDrain: 0.09, beacon: 'wind', tex: { wall: 'wp0', floor: 'cp0', ceil: 'ct0', exit: 'nc0' } },
      exitName: '揺らいでいる壁', exitVerb: '壁をすり抜ける',
      flavor: '黄ばんだ壁紙。湿ったカーペット。蛍光灯のうなり。\nここには、ほとんど何もいない。\nいるのは、あなただけだ。',
      notes: ['ここで、ほかの探索者に会うことはまずない。ひとりきりでいること自体が、この Level の危なさだ。',
        '壁の一部が、ときどき揺らいで見える。そこに体を押しつけると、別の Level へすり抜けることがある。',
        'アーモンドウォーターを見つけたら、必ず持っていけ。正気を保つのに、これほど効くものはない。',
        '同じ部屋に、何度も戻ってくる。ここは、店の裏の倉庫のようで、どこまでも続いている。'] },
    { n: 'Level 1', en: 'Level 1 - "Habitable Zone"', name: '居住可能区域', base: 1, src: MEG,
      cfg: { fog: [46, 48, 50], fogK: 0.17, amb: 0.08, items: { water: 0.55, battery: 0.42, map: 0.1, note: 0.16 }, ents: { wander: { first: 70, every: 100, max: 2 } } },
      spr: { wander: 'sp_hound', wanderH: 0.62 }, ent: { wander: 'ハウンド' },
      over: { wander: ['ハウンドに捕まった', '四つ足の影が、低くうなりながら飛びかかってきた。'] },
      exitName: '階段室の扉', exitVerb: '階段を下りる',
      flavor: 'コンクリートの床と壁。むき出しの鉄筋。\n低くたちこめる霧と、床の水たまり。\n水と電気が途切れないこの場所には、人が住みついている。',
      notes: ['補給品の箱は、ふと振り返ると置いてある。中身は、アーモンドウォーターのことが多い。',
        '灯りがちらつき始めたら、身構えろ。灯りが戻ったとき、何かが増えていることがある。',
        '四つ足で這う人影を見たら、それはハウンドだ。こちらを見つけたら、追ってくる。',
        'ここなら拠点が作れる。M.E.G. の仲間たちも、この Level で暮らしている。'] },
    { n: 'Level 2', en: 'Level 2 - "Pipe Dreams"', name: 'パイプ・ドリームス', base: 2, src: MEG,
      cfg: { thirstMul: 1.6, ents: { grin: { first: 50, every: 80, max: 1 } } },
      exitName: '点検口', exitVerb: '点検口をくぐる',
      flavor: '長く、薄暗い、コンクリートの整備用通路。\n壁と天井を、蒸気の配管が埋めている。\n暑い。喉が渇く。',
      notes: ['配管は熱い。触るな。ここでは喉が、いつもの倍の速さで渇く。',
        '暗がりに白い目と歯が浮かんでいたら、スマイラーだ。明かりを向けると、下がっていく。',
        '通路はどこまで行っても似ている。角を曲がるたびに、壁に印をつけて歩け。',
        '点検口の向こうから、機械のうなりと、電気のはじける音が聞こえる。'] },
    { n: 'Level 3', en: 'Level 3 - "Electrical Station"', name: '電気室', base: 2, src: MEG,
      cfg: { tex: { wall: 'el3', floor: 'gr2', ceil: 'pc2', exit: 'ex_el' }, light: [205, 222, 255], amb: 0.045, fog: [6, 8, 12], fogK: 0.13,
        lamps: { every: 4, on: 0.45, flick: 0.35, darkBlock: 0.12 }, loops: 0.3, hum: 1.8, beacon: 'ding', exitD: 42,
        ents: { wander: { first: 40, every: 70, max: 2 }, grin: { first: 60, every: 80, max: 1 } } },
      spr: { wander: 'sp_hound', wanderH: 0.62 }, ent: { wander: 'ハウンド' },
      over: { wander: ['ハウンドに捕まった', '機械のうなりにまぎれて、四つ足の足音が近づいていた。'] },
      exitName: 'エレベーター', exitVerb: 'エレベーターに乗る',
      flavor: '機械のうなりと、電気のはじける音。\nレンガの壁を、太い配線がはっている。\n危ない Level だ。長居するな。',
      notes: ['機械の音が大きすぎて、足音が聞こえない。向こうにも、こちらの足音は聞こえていないといいが。',
        '危険な Level とされている。用がなければ、すぐに抜けろ。',
        '配電盤のランプが、ひとつずつ消えていく。消えた方向へは行くな。',
        'エレベーターを見つけた。上の階は、事務所だったはずだ。'] },
    { n: 'Level 4', en: 'Level 4 - "Abandoned Office"', name: '無人のオフィス', base: 0, src: MEG,
      cfg: { tex: { wall: 'wo4', floor: 'co4', ceil: 'ct3', exit: 'ex_of' }, light: [240, 246, 255], amb: 0.14, fog: [40, 42, 46], fogK: 0.1,
        lamps: { every: 3, on: 0.9, flick: 0.05, darkBlock: 0.02 }, sanDrain: 0.03, beacon: 'chord', hum: 0.6,
        items: { water: 0.5, battery: 0.25, map: 0.08, note: 0.16 }, ents: { face: { first: 8, every: 25, max: 3 } } },
      exitName: '非常階段の扉', exitVerb: '階段を下りる',
      flavor: '空っぽの事務所。机も椅子も、だれもいない。\n蛍光灯は明るく、静かだ。\n比較的、安全な場所とされている。',
      notes: ['顔のない人たちが、机のあいだを歩いている。フェイスリングだ。こちらには、何もしてこない。',
        '書類は全部白紙だった。会社の名前すら書いていない。',
        '給水器のそばに、アーモンドウォーターがまとめて置いてあった。だれが置いたのだろう。',
        '階段の扉の先から、古いホテルの匂いがした。'] },
    { n: 'Level 5', en: 'Level 5 - "Terror Hotel"', name: 'テラー・ホテル', base: 8, src: MEG,
      cfg: { tex: { wall: 'ht5', floor: 'hc5', ceil: 'hce5', exit: 'ex_ht' }, light: [255, 206, 156], amb: 0.06, fog: [16, 8, 6], fogK: 0.12,
        lamps: { every: 4, on: 0.62, flick: 0.2, darkBlock: 0.14 }, step: 'carpet', beacon: 'clock', hum: 0.4,
        ents: { wander: { first: 45, every: 80, max: 2 } } },
      spr: { wander: 'sp_skin' }, ent: { wander: 'スキン・スティーラー' },
      over: { wander: ['捕まった', '人の形をしたものが、あなたの顔をのぞきこんだ。\n……つぎは、その顔を着るつもりだ。'] },
      exitName: 'ボイラー室の扉', exitVerb: 'ボイラー室へ下りる',
      flavor: '朽ちかけた、何階もあるホテル。\nロビー、客室、郵便室……\nどこかに、ボイラー室がある。',
      notes: ['客室の扉は、どれも鍵がかかっていない。それでも、中には入るな。',
        '人の形をしたものが、人の皮をかぶって歩いている。近くで見ると、つなぎ目がある。',
        'ボイラー室の熱が、壁ごしに伝わってくる方へ。',
        'フロントのベルを鳴らした。だれも来なかった。来なくてよかった。'] },
    { n: 'Level 6', en: 'Level 6 - "Lights Out"', name: 'ライツ・アウト', base: 3, src: MEG,
      cfg: { tex: { wall: 'wp3', floor: 'cp3', ceil: 'ct3', exit: 'ex_red' }, amb: 0.012, lamps: { every: 3, on: 0, flick: 0, darkBlock: 0 }, beacon: 'monitor', hum: 0.05,
        items: { water: 0.32, battery: 0.6, map: 0.06, note: 0.16 }, ents: { grin: { first: 18, every: 32, max: 3 } } },
      exitName: '赤く光る扉', exitVerb: '扉を開ける',
      flavor: '明かりが、ひとつもない。\n自分の手さえ見えない。\n懐中電灯だけが頼りだ。',
      notes: ['暗闇で笑い声がしたら、すぐに明かりを向けろ。',
        '電池を数えろ。ここで電池が切れたら、二度と出られない。',
        'この Level の記録は少ない。戻ってきた者が少ないからだ。',
        '赤く光る扉の向こうから、たくさんの足音が聞こえた。開けたら、走れ。'] },
    { n: 'Level !', en: 'Level ! - "Run For Your Life"', name: 'ラン・フォー・ユア・ライフ', base: 8, src: MEG,
      cfg: { tex: { wall: 'rn_w', floor: 'hf8', ceil: 'hc8', exit: 'ex_run' }, light: [255, 74, 54], amb: 0.09, fog: [20, 2, 2], fogK: 0.11,
        lamps: { every: 3, on: 0.3, flick: 0.6, darkBlock: 0 }, hall: { block: 0.05, solid: 0.3 }, exitD: 34, beacon: 'alarm', hum: 0.3,
        huntAlways: 1, speedMul: 0.92, items: { water: 0.2, battery: 0.1, map: 0, note: 0.2 }, ents: { wander: { first: 4, every: 9, max: 3 } } },
      ent: { wander: '追ってくるもの' },
      over: { wander: ['追いつかれた', '後ろの足音が、ひとつになった。\nあなたの足音と、重なった。'] },
      exitName: '非常口', exitVerb: '非常口へ飛びこむ',
      flavor: '赤い非常灯が点滅している。\n後ろから、たくさんの足音。\n走れ。',
      notes: ['振り返るな。走れ。', '息が切れたら、角を曲がってから歩け。まっすぐな廊下で止まるな。',
        'ここに休む場所はない。', 'この Level から戻った者の記録には、どれも「走れ」としか書いていない。'] },
    { n: 'Level Fun', en: 'Level Fun =)', name: 'パーティーの部屋 =)', base: 0, src: MEG,
      cfg: { tex: { wall: 'fn_w', floor: 'fn_f', ceil: 'ct0', exit: 'ex_fun' }, light: [255, 244, 226], amb: 0.22, fog: [70, 60, 50], fogK: 0.09,
        lamps: { every: 3, on: 0.95, flick: 0.03, darkBlock: 0 }, beacon: 'party', hum: 0.5, sanDrain: 0.08,
        seeMul: 0.55, hearMul: 0.6, speedMul: 0.9, ents: { wander: { first: 15, every: 30, max: 3 } } },
      spr: { wander: 'sp_party' }, ent: { wander: 'パーティーゴーアー' },
      over: { wander: ['パーティーに招かれた', '黄色い手が、あなたの肩をつかんだ。\n「いっしょに、パーティーしよう =)」'] },
      exitName: 'すべり台', exitVerb: 'すべり台をすべり降りる',
      flavor: '風船。紙吹雪。明るい壁紙。\nだれかの誕生日らしい。\n=)',
      notes: ['黄色い人たちが、部屋のあちこちに立っている。近づかなければ、気づかれない。',
        '話しかけられても、返事をするな。いっしょにパーティーをしてはいけない。',
        'ケーキの甘い匂い。この匂いが強くなったら、近くに何かいる。',
        '奥のすべり台を下りると、水の音のする Level に出るという。'] },
    { n: 'Level 37', en: 'Level 37 - "Sublimity"', name: 'サブリミティ', base: 9, src: MEG,
      cfg: { tex: { wall: 'tl9', floor: 'pw37', ceil: 'tc9', exit: 'ex9' }, shimmer: 1, step: 'water' },
      exitName: '光の漏れる扉', exitVerb: '光の中へ出る',
      flavor: '白いタイルの部屋と通路が、どこまでも続く。\n床は、ぬるい水に少しだけ沈んでいる。\nだれもいない。静かだ。',
      notes: ['水はぬるい。ずっとここにいてもいい気がする。……それが、この Level の危ないところだ。',
        'ここでは、ほとんど何にも出会わない。広すぎるからなのか、ここが人を遠ざけるのか、分かっていない。',
        '水の底に、光の差しこむ場所があった。',
        '帰りたいのかどうか、もう分からない。'] },
  ],
};
// 版ごとのメモ：{ t: 本文, src: 出どころ }
function themeNotes(mode, lv) {
  const L = THEMES[mode].levels[lv];
  return L.notes.map(n => Array.isArray(n) ? { t: n[0], src: `『${n[1]}』` } : { t: n, src: L.src });
}
const _baseLevelCfg = levelCfg;
levelCfg = function (depth, mode) {
  if (!THEMES[mode]) return _baseLevelCfg(depth, mode);
  const T = THEMES[mode], L = T.levels[depth];
  const c = cloneCfg(LEVELS[L.base != null ? L.base : Math.min(depth, LEVELS.length - 1)]);
  if (L.cfg) Object.assign(c, cloneCfg(L.cfg));      // 層ごとの違い（Wiki設定版）
  if (L.n) c.n = L.n;
  c.name = L.name; c.exitName = L.exitName; c.exitVerb = L.exitVerb;
  if (L.wall) c.tex.wall = L.wall;
  c.theme = mode; c.entSpr = Object.assign({}, T.spr, L.spr || {});
  if (!T.freeIcon) c.itemSpr = 'sp_claude';         // 五つの報告書・山羊文学版は、いつも Claude のマーク
  if (T.itemNames) c.itemNames = T.itemNames;
  if (T.itemTex) c.itemTex = T.itemTex;
  return c;
};
