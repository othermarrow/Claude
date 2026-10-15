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
  // 救いのない版：層は終わらない。5つの層をくり返すたびに、暗く・多く・少なくなる
  const base = depth % LEVELS.length, cyc = Math.floor(depth / LEVELS.length);
  const c = cloneCfg(LEVELS[base]), k = cyc + base * 0.2;
  c.n = `第${depth}層`; c.calm = 0; c.hard = 1;
  c.amb = c.amb * Math.max(0.3, 1 - 0.22 * k);
  c.lamps.on = Math.max(0.05, c.lamps.on * (1 - 0.12 * k));
  c.lamps.flick = Math.min(0.4, c.lamps.flick + 0.05 * k);
  c.lamps.darkBlock = Math.min(0.5, c.lamps.darkBlock + 0.06 * k);
  if (base === 4) { c.lamps.on = Math.min(c.lamps.on, 0.6); c.lamps.flick = Math.max(c.lamps.flick, 0.3); c.amb = Math.min(c.amb, 0.35); c.lampK = 0.6; }
  c.items = { water: (c.items.water || 0.3) * 0.5, battery: (c.items.battery || 0.2) * 0.6, map: 0, note: 0.18 };
  const w = LEVELS[base].ents.wander || { first: 120, every: 150, max: 1 };
  c.ents = { wander: { first: Math.max(20, w.first * 0.5 / (1 + cyc * 0.4)), every: Math.max(25, w.every * 0.6 / (1 + cyc * 0.4)), max: Math.min(4, w.max + cyc) } };
  if (base === 3 || cyc >= 1) c.ents.grin = { first: 30, every: Math.max(25, 45 / (1 + cyc * 0.3)), max: Math.min(3, 1 + cyc) };
  c.exitD = Math.min(90, c.exitD + cyc * 10);
  c.beaconRange = Math.max(14, 38 - cyc * 6 - base * 1.5);
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
      { name: '物語の終わりと始まり', src: '物語の終わりと始まり', exitName: '最後のページ', exitVerb: '最後のページをめくる', wall: 'wp_genko',
        flavor: '「これで、全ての物語が幕を閉じた」',
        notes: [['文章を書けない日々は辛い。コメントすら返せない。だからせめて、常に文章の傍らに。とにかく書くだけの場所を。', '推敲も校正も修正もしない。ソースもエビデンスもない。'], ['それでは　また明日。', 'あくるひ']] },
    ],
  },
};
// 版ごとのメモ：{ t: 本文, src: 出どころ }
function themeNotes(mode, lv) {
  const L = THEMES[mode].levels[lv];
  return L.notes.map(n => Array.isArray(n) ? { t: n[0], src: `『${n[1]}』` } : { t: n, src: L.src });
}
const _baseLevelCfg = levelCfg;
levelCfg = function (depth, mode) {
  if (!THEMES[mode]) return _baseLevelCfg(depth, mode);
  const T = THEMES[mode], L = T.levels[depth], c = cloneCfg(LEVELS[depth]);
  c.name = L.name; c.exitName = L.exitName; c.exitVerb = L.exitVerb;
  if (L.wall) c.tex.wall = L.wall;
  c.theme = mode; c.itemSpr = 'sp_claude'; c.entSpr = T.spr;
  return c;
};
