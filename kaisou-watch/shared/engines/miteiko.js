// 「未定稿」のゲーム本体。backrooms-pwa/games/miteiko.html の中身から、画面（DOM）に触る部分を抜いたもの。
// tools/build-miteiko.js で作る。直接は直さない。
// 画面側は createGame(io) で作り、submit() で命令を送り、status() / turn() / visible() で描く。
// io: { loadState(), saveState(obj), loadLoop(), saveLoop(obj) }（どれも失敗してよい）

export function createGame(io) {
  const VERSION = 1;
  // 結末。どれが正解なのかは、どこにも書いていない。どれも、救いにはならない
  const ENDINGS = { shuzo: "収蔵", nidone: "二度寝", toban: "当番", fujo: "浮上", kemono: "獣" };
  // 画面の演出（階層目録の FX）は、時計では使わない
  const fx = () => {};
  const sfx = () => {};
  function loadSaved() { try { return io.loadState(); } catch (e) { return null; } }
  function writeSaved(obj) { try { io.saveState(obj); } catch (e) { /* 残せなくても遊べる */ } }
  // 何周目か、何度消されたか、どこまで降りたかは、はじめからやり直しても残る
  function loadLoop() {
    const base = { n: 0, endings: [], runs: 0, deep: 0, deepLabel: "地上", erased: 0 };
    try {
      const v = io.loadLoop();
      if (v && typeof v === "object") {
        const out = Object.assign(base, v);
        if (!Array.isArray(out.endings)) out.endings = [];
        return out;
      }
    } catch (e) { /* 壊れていたら、はじめから */ }
    return base;
  }
  function saveLoop(v) { try { io.saveLoop(v); } catch (e) { /* 残らなくても遊べる */ } }
  function loopSet(patch) { LOOP = Object.assign({}, LOOP, patch); saveLoop(LOOP); }

  // ---- 物の置き場 ----
  const O = {};
  function thing(id, def) {
    O[id] = Object.assign({ id, loc: null, take: false, en: id.toLowerCase(), aliases: [def.name], on: {} }, def);
    if (!O[id].aliases.includes(def.name)) O[id].aliases.unshift(def.name);
  }
  const text = v => (typeof v === "function" ? v() : v);
  const held = id => O[id].loc === "player";
  const here = id => O[id].loc === S.loc;
  const near = id => held(id) || here(id);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const DIR_JA = { n: "北", s: "南", e: "東", w: "西", u: "上", d: "下" };

  // ---- 状態 ----
  let S = null;
  let LOOP = loadLoop();
  function newState() {
    initWorld();
    S = { loc: "gate", moves: 0, done: false, seen: {}, learn: {},
      // 灯り：名前の蝋燭。炎の長さが、残りの時間
      lit: false, fuel: 400, matches: 3, early: false, darkT: 0, sleptDark: false, power: false,
      // 家
      window: false, rugMoved: false, trap: false, barred: false, gateWait: 0, eggsGone: false,
      // 地下
      bell: false, door4: false, door4Open: false, r6Free: false, r6Try: 0, r7: [], r7Wait: 0, beetleOut: false,
      greenSaid: false, backstage: false, paneOut: false,
      // 箱
      seated: false, glass: false, stir: 0, drunk: false,
      // 層
      spray: false, panels: false, poly: false, pitT: 0, goldTaken: false, safe: [], safeOpen: false,
      burned: 0, path: false, beastAsked: 0, ritual: [], reported: false, wished: 0, polaris: false, trainWait: 0,
      phones: false, valves: [], listening: false, listenT: 0, flooded: 0,
      // 回収人（拾い読みをして、店に並ぶ前に持っていく者）
      th: { loc: "m5", gone: 0 },
      qi: 0, inCase: [], hist: [] };
  }
  const SAVED_FIELDS = ["loc", "closed", "scenery"];
  function snapshot() {
    const objs = {};
    for (const o of Object.values(O)) {
      objs[o.id] = {};
      for (const k of SAVED_FIELDS) if (k in o) objs[o.id][k] = o[k];
    }
    return { v: VERSION, S, objs, log: rows.slice(-300) };
  }
  function restore(data) {
    if (!data || data.v !== VERSION || !data.S || typeof data.S !== "object" || !ROOMS[data.S.loc]) return false;
    newState();
    const base = S;
    S = Object.assign(base, data.S);
    for (const k of ["seen", "learn", "th"]) if (!S[k] || typeof S[k] !== "object") S[k] = base[k];
    for (const k of ["r7", "safe", "ritual", "valves", "inCase", "hist"]) if (!Array.isArray(S[k])) S[k] = [];
    if (typeof S.fuel !== "number" || !isFinite(S.fuel)) S.fuel = 400;
    if (!ROOMS[S.th.loc] && S.th.loc !== "away") S.th.loc = "m5";
    for (const [id, st] of Object.entries(data.objs || {})) if (O[id] && st && typeof st === "object") Object.assign(O[id], st);
    return true;
  }

  // ---- 表示 ----
  let rows = [];
  let turnStart = 0;
  function push(r) {
    rows.push(r);
    if (rows.length > 700) { rows.splice(0, 200); turnStart = Math.max(0, turnStart - 200); }
  }
  // 灯りが尽きかけると、文章の字がところどころ欠ける
  function corrupt(t) {
    if (!S || t.length < 6 || !held("candle") || S.fuel > 40) return t;
    if (Math.random() > 0.35) return t;
    const i = 2 + Math.floor(Math.random() * (t.length - 3));
    return t.slice(0, i) + pick(["■", "＿", "□"]) + t.slice(i + 1);
  }
  function say(t, cls) { for (const part of String(t).split("\n")) push({ t: "out", ja: cls === "title" || cls === "win" ? part : corrupt(part), cls: cls || "" }); }
  function gap() { push({ t: "gap" }); }
  function scrollDown() {}
  function flicker() {}
  // 過去に打った命令の一つが、打っていない命令に書き換わる
  const HAUNTS = ["蝋燭を食べる", "「4」と言う", "名前を書く", "四番目の扉を開ける", "二度寝する", "報告する", "棚に入る", "鍵を確かめる", "「おかえり」と言う", "壁に入る"];
  function haunt() {
    const idx = [];
    rows.forEach((r, i) => { if (r.t === "cmd" && i < rows.length - 8) idx.push(i); });
    if (!idx.length) return;
    const i = pick(idx), t = pick(HAUNTS);
    rows[i] = { t: "cmd", ja: t, en: "", h: 1 };
  }

  // ---- 層 ----
  const LVINFO = {
    dusk: { fx: 10, opt: { a: "#ff9f5a", b: "#ffd23f", mode: "field" }, bed: "night", rank: 0, label: "地上" },
    house: { fx: 5, opt: { a: "#d9a86a", b: "#ff6a4a", mode: "dark" }, bed: "office", rank: 0, label: "地上" },
    cellar: { fx: 6, opt: { a: "#9fa7b5", b: "#ff6b6b", mode: "drip" }, bed: "cave", rank: 1, label: "地下" },
    maze: { fx: 0, opt: {}, bed: "fluoro", rank: 2, label: "黄色い部屋" },
    neon: { fx: "fun", opt: { a: "#ff4fd8", b: "#00f5d4", mode: "scope" }, bed: "party", rank: 3, label: "箱" },
    pale: { fx: "white", opt: { a: "#cfc8b3", b: "#e0002a", mode: "tags" }, bed: "silence", rank: 4, label: "淡い街" },
    pit: { fx: 2, opt: { a: "#ff9e00", b: "#ffd23f", mode: "spark" }, bed: "pipes", rank: 4, label: "ごみの穴" },
    forest: { fx: 6, opt: { a: "#6b7cff", b: "#ff5a7a", mode: "rain" }, bed: "dark", rank: 4, label: "札の森" },
    shrine: { fx: 10, opt: { a: "#c6ff5a", b: "#ff7a45", mode: "field" }, bed: "field", rank: 4, label: "参道" },
    night: { fx: 9, opt: { a: "#b38cff", b: "#ffd166", mode: "wire" }, bed: "night", rank: 5, label: "吊り橋" },
    lair: { fx: 5, opt: { a: "#c98a5e", b: "#ff6f61", mode: "dark" }, bed: "hotel", rank: 5, label: "古本の部屋" },
    sea: { fx: 7, opt: { a: "#3fa9ff", b: "#00ffd0", mode: "sea" }, bed: "sea", rank: 6, label: "海の底" },
  };
  const LV_TAGS = {
    dusk: ["[門：半開]", "[呼出：不通]", "単3×6", "[築57年]", "[卵 0]", "[巣：頼りない]", "[05:10 二度寝]"],
    house: ["[収蔵品：0]", "[適量]", "[塩：残り2粒]", "[鏡／森]", "[鍵：88]", "[弦：230]", "[窪み 9]"],
    cellar: ["[1]", "[2]", "[3]", "[5]", "[6]", "[7]", "[8]", "[10]", "[4：欠番]", "[9：欠番]", "[強く押す]", "[立入禁止]"],
    maze: ["Lv.0", "[同上]", "[同上]", "[同上]", "[ここはどこ？]", "[回収済]", "[未定稿]", "[no-clip]"],
    neon: ["[R]", "[G]", "[B]", "[×3]", "[1m 移動]", "[紫：製造中止]", "=)"],
    pale: ["[静粛に]", "[原色禁止]", "[赤 8/8]", "[淡]", "[淡]", "[淡]"],
    pit: ["[監視中]", "[金粉]", "[割符 0/2]", "[来世便：1箱]", "[茶]"],
    forest: ["[札]", "[重量超過]", "[正負：不均衡]", "[燃焼]", "[椿]"],
    shrine: ["[礼]", "[拍手 2]", "[礼]", "[願：不可]", "[報告：未]", "[14年9か月]"],
    night: ["☽", "[北極星：在]", "[往復6h]", "13 星座", "[橋：深夜]"],
    lair: ["[買取]", "[線香]", "[手垢]", "[百円]", "[全巻同著者]"],
    sea: ["[聴]", "[操]", "[打電]", "[休]", "[異常なし]", "[異常なし]", "[異常なし]", "[弁 2]"],
  };
  const LV_TRUISM = {
    cellar: ["FOUR IS STILL THE FOURTH", "抜かれても、四番目は四番目だ", "番号の廊下"],
    maze: ["EVERY ROOM HERE IS THE SAME ROOM", "ここの部屋は、どれも同じ部屋だ", "Level 0"],
    neon: ["MOVE ONE METER AND THE WORLD IS REPLACED", "一メートルずれれば、世界は入れ替わる", "箱"],
    pale: ["NOISE IS A KIND OF COLOR", "音もまた、色の一種だ", "淡い街"],
    pit: ["ONLY ONE SAFE GOES TO THE NEXT LIFE", "来世へ送れるのは、金庫ひとつ分だけ", "倉庫"],
    forest: ["EVERY WORD HAS ITS WEIGHT", "どの言葉にも、重さがある", "札の森"],
    shrine: ["REPORT. DO NOT WISH", "報告せよ。願うな", "参道"],
    night: ["THE STILL STAR IS STILL THERE", "動かない星は、まだそこにある", "吊り橋"],
    lair: ["BOUGHT BEFORE IT COULD BE SHELVED", "棚に並ぶ前に、買い取られた", "回収人"],
    sea: ["THE LISTENER MUST NOT SLEEP", "聴く番の者は、目を閉じるな", "艇"],
  };
  const TRUISMS = [
    ["THE AMOUNT IS ALWAYS 'ENOUGH'", "分量は、いつも適量だ", "献立表"],
    ["NO TWO KEYS SOUND THE SAME", "同じ音は、二度と鳴らない", "居間"],
    ["YOU CANNOT PROVE WHAT YOU DID NOT DO", "していないことは、証明できない", "?"],
    ["AN UNCHECKED KEY FITS ANY DOOR", "確かめない鍵は、どの扉にも合う", "?"],
    ["BEYOND 'NO ENTRY' NOTHING WAS BUILT", "立入禁止の先は、作られていない", "10"],
    ["TWENTY MINUTES AWAY AND IT IS ALL CARRIED OFF", "二十分よそを向けば、全部運び出されている", "門"],
    ["NO ONE HAS WRITTEN WHY YOU ARE HERE", "あなたがここにいる理由は、誰も書いていない", "?"],
    ["WHAT HAS NO NAME TAKES A SHAPE", "名のないものは、姿をとる", "?"],
    ["IT WAS ALL DECIDED FROM THE START", "何もかも、はじめから決めてあった", "?"],
    ["THE FLAME IS THE TIME YOU HAVE LEFT", "炎の長さが、残りの時間だ", "蝋燭"],
    ["THE SCORE HAS NO UPPER LIMIT WRITTEN", "点数には、上限が書かれていない", "棚"],
    ["SEE YOU TOMORROW", "では、また明日", "?"],
  ];

  // ---- 部屋の手当て ----
  const MAZE = ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"];
  const POWERED = ["cellar", "stair4", "r1", ...MAZE];
  const THIEF_ROOMS = [...MAZE, "box", "cellar", "corr1", "corr2"];
  const TREASURES = ["idol", "beetle", "poly", "gold", "ring", "tsubaki", "planis", "bottle"];
  const lvOf = loc => (ROOMS[loc] || {}).lv || "dusk";
  const candleHere = () => S.lit && S.fuel > 0 && (held("candle") || here("candle"));
  function lit(loc) {
    loc = loc || S.loc;
    const r = ROOMS[loc];
    if (!r) return true;
    if (!text(r.dark)) return true;
    if (S.power && POWERED.includes(loc)) return true;
    return candleHere();
  }
  function exitsOf(loc) {
    const r = ROOMS[loc], out = {};
    for (const [d, t] of Object.entries(r.exits || {})) {
      const v = text(t);
      if (v && ROOMS[v]) out[d] = v;
    }
    return out;
  }

  // ---- 状態行と演出 ----
  function setStatus() { syncFx(); }
  function status() {
    const ex = lit() ? exitsOf(S.loc) : {};
    const have = O.candle.loc === "player" || O.candle.loc === S.loc
    return { room: lit() ? ROOMS[S.loc].name : "暗闇",
      lamp: have ? (S.fuel > 0 ? S.fuel + (S.lit ? "" : "（消）") : "尽") : "—", low: S.fuel <= 40 && held("candle"),
      score: score(), exits: Object.keys(ex).filter(k => ex[k]), stain: S.th.loc === S.loc && !S.done,
      lv: lvOf(S.loc), dark: !lit(), done: S.done };
  }
  const score = () => S.inCase.length * 10;
  let curLv = null, metaLoc = null, curBed = null;
  function roomBed(loc) {
    const r = ROOMS[loc];
    if (!lit(loc)) return "silence";
    if (r.bed) return text(r.bed);
    if (lvOf(loc) === "maze") return S.power ? "fluoro" : "dark";
    return (LVINFO[lvOf(loc)] || {}).bed || "silence";
  }
  function syncFx() {
    const lv = lvOf(S.loc), dark = !lit();
    const key = lv + (dark ? "/dark" : "");
    const bed = roomBed(S.loc);
    if (key !== curLv) {
      curLv = key; curBed = bed;
      const L = LVINFO[lv];
      fx("level", dark ? 6 : L.fx, Object.assign({}, dark ? { a: "#45423d", b: "#6d6a63", mode: "dark" } : L.opt, { bed }));
      fx("tags", dark ? ["[暗]", "[灯なし]", "[消去中]", "……", "[名前：＿＿]"] : LV_TAGS[lv]);
    } else if (bed !== curBed) { curBed = bed; fx("bed", bed); }
    fx("align", !!S.polaris);
    // 灯りが残り少なく、暗闇にいる時間が長いほど、鼓動が速くなる
    const lowLamp = held("candle") && S.lit ? Math.max(0, (60 - S.fuel) / 60) : 0;
    fx("stress", Math.max(0, Math.min(1, Math.max(lowLamp * 0.8, S.darkT * 0.35))));
    if (metaLoc !== S.loc) { metaLoc = S.loc; writeMeta(); }
  }
  let metaData = null;
  function writeMeta() {
    metaData = { endings: (LOOP.endings || []).slice(), total: Object.keys(ENDINGS).length, deepest: LOOP.deepLabel || "地上", runs: LOOP.runs || 1 };
  }
  function reach(id) {
    const endings = (LOOP.endings || []).slice();
    if (!endings.includes(id)) endings.push(id);
    loopSet({ endings });
    writeMeta();
  }

  // ---- 見えるもの ----
  function visible() {
    const out = [];
    const seeRoom = lit();
    const walk = parent => {
      for (const o of Object.values(O)) {
        if (o.loc !== parent && !(parent === S.loc && o.where && o.where(parent))) continue;
        if (o.when && !o.when()) continue;
        out.push(o);
        if (o.container && !o.closed) walk(o.id);
      }
    };
    if (seeRoom) walk(S.loc);
    walk("player");
    return out;
  }
  function describe(full) {
    const r = ROOMS[S.loc];
    if (!lit()) {
      say("暗闇", "title");
      say(S.darkT ? "真っ暗だ。何も見えない。" : "真っ暗で、何も見えない。暗がりのどこかで、誰かが紙をめくっている。");
      return;
    }
    say(r.name, "title");
    if (full || !S.seen[S.loc]) say(text(r.desc));
    S.seen[S.loc] = true;
    const loose = Object.values(O).filter(o => o.loc === S.loc && !o.scenery && (!o.when || o.when()));
    for (const o of loose) say(o.lie ? text(o.lie) : `ここに${o.name}がある。`);
    for (const c of Object.values(O).filter(o => o.loc === S.loc && o.container && !o.closed && (!o.when || o.when()))) {
      const inside = Object.values(O).filter(o => o.loc === c.id && !o.hideIn);
      if (inside.length) say(`${c.name}の中に、${inside.map(o => o.name).join("、")}。`);
    }
    if (S.th.loc === S.loc) say("古本の匂いがする。手垢と、香水と、線香と、煙草の混じった匂い。……すぐそばに、背の高い誰かが立っている。", "warn");
  }

  // ---- 部屋 ----
  // 物語の像は、一つの物語を一つの部屋に当てず、いくつもの物語の像を混ぜて部屋にしている
  const QUESTIONS = ["ここは、どこ？", "わたしは、だれ？", "何が起きたの？", "この音は、何？", "あなたは、だれ？", "どこへ行くの？",
    "前にも、ここに来た？", "わたしは、もう死んでる？", "この傷は、何をされてできたの？"];
  const SCRIBBLES = [
    "壁紙の継ぎ目に、鉛筆で：「分量は、すべて適量」",
    "壁に小さく：「四番目なのに、札には五と書いてある」",
    "床の隅に：「立入禁止の先は、作った者も入れないので、作られていない」",
    "壁に：「同じ強さで二度押しても、同じ音は返ってこない」",
    "壁紙の染みが、字のように読める。「暗くて見えない晩こそ、光をいちばん浴びている」",
    "壁に：「聴く番は、目を閉じるな」",
    "壁紙に爪で：「願うな。報告だけしろ」",
    "壁に：「名を名乗った相手は、その時点で、見知らぬ人の列から外れる」",
    "床に：「確かめないかぎり、その鍵は、その人の部屋の鍵のままだ」",
    "壁に：「目を離した二十分で、大事なものは一つ残らず、よそへ移されていた」",
    "壁に：「もう少し静かな曲を、と壁に頼むと、曲が変わる」",
    "壁一面に、同じ問いが百。「私は〔　〕です」。答えの欄は、途中から人ではない言葉になっている。",
    "壁に、二人ぶんの筆跡で。「髪、切った？」「……あ、そう」",
    "壁に：「それって、この飴より値打ちがあるの？」",
    "壁に、太い字で一言だけ。「寝ろ」",
    "壁に：「……で、あんた、誰？」",
    "壁に：「はじめから、何もかも決めてあった気がする」",
    "壁に、一字ずつ縦に。「で」「は」「ま」「た」「明」「日」「。」",
    "壁に：「五分前の、五分前の、五分前に動け」",
    "壁に：「孤独の反対って、何だと思う？」",
    "壁に：「予想と証明は、別物だよ」",
    "壁に：「この部屋は、向こうへの近道なんです」",
    "壁の向こうから、知らない声。「おかえり。ご飯、できてるよ」",
    "壁に、警告の文。「誰か、気づいて。■■が」……いちばん大事な一語だけが、読めない。",
    "壁に：「同じことをくり返して、ちがう結果を待つのは、おかしい」",
    "壁に：「返事は、夜明けまで待て。星は務めの最中だ」",
    "壁に：「決めた順番どおりに動けば、それでいい。いつもどおり。平気」",
    "壁に：「私は末端です」",
    "壁に：「次は、何だ」",
    "壁に：「やっていないことは、どうやっても証明できない」",
    "壁に：「九つあったよな」と、誰かの字。その下に、「訓示にはつっこまない」",
    "壁に、褪せた字で：「＿＿を捨てないで」",
    "壁に：「中が見えないときは、危ないぞ」",
    "壁に：「答えは頭のどこかで先に出ていて、意識はいつも一歩遅れて届く」",
  ];
  function mazeDesc() {
    const lines = [S.power ? "黄色い壁紙。湿ったカーペット。蛍光灯のうなり。どちらを向いても、同じような部屋が続いている。"
      : "蝋燭の光の届くところだけ、黄色い壁紙が見える。湿ったカーペット。天井の蛍光灯は、どれも消えている。どちらを向いても、同じような暗がりが続いている。"];
    if (Math.random() < 0.7) lines.push(pick(SCRIBBLES));
    if (Math.random() < 0.35) { lines.push("どこからか、自分の声で。「" + QUESTIONS[S.qi % QUESTIONS.length] + "」"); S.qi++; }
    return lines.join("\n");
  }
  const MAZE_ROOM = (exits, extra) => ({ name: "黄色い部屋", lv: "maze", dark: true, exits,
    desc: () => mazeDesc() + (extra ? "\n" + text(extra) : "") });

  const ROOMS = {
    // ---- 地上
    gate: { name: "門の前", lv: "dusk", exits: { n: "garden", e: "back" },
      desc: () => "家の前の小道に立っている。古い家だ。鉄の両開きの門は歪んでいて、最後まで開かない。崩れかけた石垣の上に、電池式のインターホンが一つ。\n日が暮れかけている。……ずっと、暮れかけている。\n北は荒れた庭。東は、家の裏へ回る細い道。" },
    garden: { name: "庭", lv: "dusk", exits: { s: "gate", e: "back" },
      desc: "手入れをしない庭。草が膝まで伸びている。家の壁ぎわに、前かごのついた古い自転車。\n虫の声と、見えない鳥の声が、何分かごとに入れ替わる。鳴く主が替わるたびに、庭の空気も替わる。\n南は門。東は家の裏。" },
    back: { name: "家の裏", lv: "dusk", exits: { n: "garden", s: "gate", w: () => S.window ? "kitchen" : null },
      desc: () => "家の裏。台所の小さな窓が、" + (S.window ? "体が通るくらいに開いている。" : "ほんの少しだけ開いている。") + "\n北は庭。南は門。" },
    kitchen: { name: "台所", lv: "house", exits: { e: "back", w: "living", u: "attic" },
      desc: "古い台所。壁に、献立表が貼ってある。流しのわきに、塩の容器。コンロの上には、何も載っていない。調理台の下に、引き出し。\n東は、入ってきた窓。西は居間。上に、屋根裏へ上がる梯子。" },
    living: { name: "居間", lv: "house", exits: { e: "kitchen", d: () => S.trap ? "cellar" : null },
      desc: () => "古い居間。正面の壁ぎわに、ガラスの扉の飾り棚。窓ぎわに、蓋の開いた縦型のピアノと、リモコンのない大きなテレビ。庭へ出る掃き出し窓。" +
        (S.rugMoved ? "\n色あせた敷物が、部屋の隅へずらしてある。その下の床に、跳ね上げ戸" + (S.trap ? "が開いて、下へ階段が続いている。" : "。") : "\n床の真ん中に、色あせた敷物。") + "\n東は台所。" },
    attic: { name: "屋根裏", lv: "house", dark: true, exits: { d: "kitchen" },
      desc: "屋根裏。低い梁に、頭をぶつけそうになる。配線が何本も、何かにかじられて千切れている。床に、段ボール箱が一つ。\n梯子は、下の台所へ。" },

    // ---- 地下
    cellar: { name: "地下室", lv: "cellar", dark: true, exits: { u: () => S.barred ? null : (S.trap ? "living" : null), n: "corr1", e: "m1", s: () => S.bell ? "next" : null },
      desc: () => "石の地下室。冷たい。頭の上に、跳ね上げ戸。\n北に、細長い廊下。東の壁の一か所だけ、黄色い壁紙が貼ってある。南に、呼び鈴のついた木の扉。" + (S.power ? "\n天井の裸電球が、灯っている。" : "") },
    corr1: { name: "番号の廊下", lv: "cellar", exits: { s: "cellar", n: "corr2" },
      desc: () => "白いコンクリートの廊下。非常灯だけが点いている。扉が並び、それぞれに番号の札。1、2、3、5。" +
        (S.door4 ? "\n……3と5のあいだに、さっきまでなかった「4」の扉がある。" : "") +
        "\n壁に、赤いボタンが一つ。「強く押す」とだけ書いてある。\n廊下は北へ続く。南は地下室。" },
    corr2: { name: "番号の廊下の奥", lv: "cellar", exits: { s: "corr1" },
      desc: "廊下の奥。扉の札は、6、7、8、10。9の札だけが、どこにもない。\n廊下はここで行き止まり。南へ戻る。" },
    r1: { name: "放送室", lv: "cellar", dark: true, exits: { s: "corr1" },
      desc: () => "機材がぎっしり並ぶ放送室。どの機械にも、番号のついた記憶棚がない。つまみの位置だけが音を決めていて、電源を切れば、その音は二度と戻らない。壁ぎわに、大きな元電源のレバー。回転スピーカーの切り替え。" +
        (S.power ? "\n機器が、端から順に灯っている。" : "") + "\n南の扉から、廊下へ戻れる。" },
    r2: { name: "調光室", lv: "cellar", exits: { s: "corr1", e: () => S.backstage ? "r2b" : null },
      desc: () => "調光卓の部屋。赤・青・緑・黄のボタンが並んでいる。窓の向こうは誰もいない舞台で、真ん中に、白っぽい皮の太鼓が一つ。" +
        (S.backstage ? "\n舞台袖の東に、楽屋への扉が開いている。" : "") + "\n南の扉から、廊下へ戻れる。" },
    r2b: { name: "楽屋", lv: "cellar", exits: { w: "r2" },
      desc: "五、六組がいっしょに待つ、大部屋の楽屋。誰もいない。鏡の列と、脱ぎっぱなしの上着。舞台袖の暗がりから、客席が少しだけ見える。……客席にも、誰もいない。\n西は調光室。" },
    r3: { name: "鏡写しの居間", lv: "house", exits: { s: "corr1" },
      desc: "居間だ。……上の居間と、左右が逆になっている。飾り棚も、ピアノも、テレビも、鏡に映したように反対の側にある。同じ造りなのに、どこへ行けばいいのか、体が迷う。\n南の扉から、廊下へ戻れる。" },
    r5: { name: "「5」の部屋", lv: "cellar", exits: { s: "corr1" },
      desc: "「5」の札のかかった部屋。中は、教室の後ろの物置ほどの狭さ。机の上に、出席簿が開いたまま置いてある。\n……ここは五番目ではない、と誰かが言った気がする。数えれば、四番目だ。\n南の扉から、廊下へ戻れる。" },
    r6: { name: "小部屋", lv: "cellar", exits: { s: () => S.r6Free ? "corr2" : null },
      desc: "図書室の奥にあるような、半透明の扉の小部屋。壁に向かった机の上に、鉛筆とノート。ノートには、偶数が延々と並んでいる。\n南に、入ってきた半透明の扉。" },
    r7: { name: "調べる部屋", lv: "house", exits: { s: "corr2" },
      desc: "誰かの寝室。ベッド、押し入れ、衣装ケースが六つ、引き出しのついた机。机の上に、筆箱。\n……何かが仕掛けられている気がする。そんなわけはないのに。\n南の扉から、廊下へ戻れる。" },
    r8: { name: "水槽の部屋", lv: "sea", exits: { s: "corr2" },
      desc: () => "撮影用の部屋。隅にパイプ椅子。台の上に、水槽が一つ。" +
        (S.paneOut ? "熱帯魚が一匹、こちらを向いて浮かんでいる。" : "中で熱帯魚が一匹、水槽の壁と仕込みのガラス板にはさまれて、横向きのまま動かない。") + "\n南の扉から、廊下へ戻れる。" },
    stair4: { name: "四番の階段", lv: "cellar", dark: true, exits: { u: "corr1", d: "sub" },
      desc: "下へ降りる階段。段を数えると、三の次が五になる。八の次が、十になる。降りるほど、空気が湿って、塩の匂いがする。\n上は廊下。下へ、まだ続く。" },
    sub: { name: "球の艇", lv: "sea", exits: { u: "stair4" },
      desc: "球の形をした、狭い艇の中。灯りは、計器の光と、天井の裸電球ひとつ。陸から伸びる電線と、それに沿わせた空気の管が二本。管を流れる空気の音だけが聞こえる。\n畳一枚ぶんの寝床。携行食の箱と、果実酒の樽。壁に当番表と、交信の記録帳。赤い弁と、青い弁。ヘッドホンが一つ、フックにかかっている。\n上に、来た階段。" },
    next: { name: "隣の部屋", lv: "cellar", exits: { n: "cellar", u: () => S.bell ? "attic" : null },
      desc: "何もない部屋。擦り切れた制服が一着、壁にかかっている。くたびれた鞄。壁に耳を当てても、何も聞こえない。\n天井に、持ち上がりそうな板。北は地下室。" },

    // ---- 黄色い部屋（どれも同じ）。つながりは、まっすぐではない
    m1: MAZE_ROOM({ w: "cellar", n: "m2", e: "m3", s: "m1" }),
    m2: MAZE_ROOM({ s: "m1", e: "m4", w: "m5", n: "m2" }),
    m3: MAZE_ROOM({ w: "m1", n: "m4", e: "m6", d: "m7" }),
    m4: MAZE_ROOM({ s: "m3", w: "m2", e: "m5", d: () => O.hatch.closed ? null : "lair" }),
    m5: MAZE_ROOM({ e: "m2", w: "m4", n: "m8", s: "m6" }),
    m6: MAZE_ROOM({ w: "m3", n: "m5", e: "box", s: "m7" }),
    m7: MAZE_ROOM({ u: "m3", n: "m6", w: "m8", e: "m7" }),
    m8: MAZE_ROOM({ s: "m5", e: "m7" }, "行き止まり。"),
    lair: { name: "古本の部屋", lv: "lair", exits: { u: "m4" },
      desc: "同じ作者の古本だけで、天井まで埋まった部屋。どれも、折り目と書き込みと線引きだらけの、百円の古本だ。手垢と香水と線香と煙草の混じった匂い。\n棚に並んだらすぐに買って、店の匂いに染まる前に、ここへ運んでくるのだろう。\n上に、跳ね上げ蓋。" },

    // ---- 箱
    box: { name: "箱", lv: "neon", exits: { w: "m6" },
      desc: "「箱」と呼ばれる部屋。機械からの光が、赤・緑・青をちかちか繰り返すだけ。音には規則があるのに、意味がつかめない。混じり合う匂いの中に、どこかで嗅いだ花の香りが一つだけ紛れている。\n石のカウンターに、座面の高い椅子が五つ。黒ずくめの店員が、グラスを拭いている。棚の瓶は、どれも春の果実と花のものばかり。\n西は黄色い部屋。" },

    // ---- 淡い街
    pale1: { name: "淡い通り", lv: "pale", exits: { w: "box", e: "pale2", n: "pale3" },
      desc: "淡い色だけで塗られた街。白地に、ごく淡い黄の文字の看板。道を行く人々は、誰も声を出さない。足音さえ、遠慮がちだ。\n東に、細い路地。北に、窓のない建物。西へ戻ると、カウンターの匂いがする。" },
    pale2: { name: "路地の画材屋", lv: "pale", exits: { w: "pale1" },
      desc: "路地裏の画材屋。店番はいない。壁に投函口があって、「代金はこちらへ」とだけ書いてある。その下に、品物の落ちてくる取り出し口。\n西は通り。" },
    pale3: { name: "色の部屋", lv: "pale", exits: { s: "pale1" },
      desc: () => "壁一面に、二センチ角の色のパネルがびっしり貼られた部屋。ここだけ、街の淡さが届いていない。" +
        (S.panels ? "\n壁の赤が、八か所とも戻っている。" : "\n壁の八か所の赤だけが、褪せて、桃色になっている。") + "\n天井に、ナトリウム灯。部屋の真ん中に、何も載っていない台座。\n南は通り。" },

    // ---- ごみの穴
    pit1: { name: "監視室", lv: "pit", exits: { w: "box", e: "pit2" },
      desc: "分厚いアクリル窓の監視室。窓の下は、何もかも茶色に染まった、巨大なごみの穴。鉤爪のクレーンが、窓の前を行き来しては、何かを掴み、また別の所へ放る。\n操作盤に、レバーが一本。窓の下に、受け皿。\n東に倉庫。西へ戻ると、カウンターの匂い。" },
    pit2: { name: "金庫の倉庫", lv: "pit", exits: { w: "pit1" },
      desc: "白い金庫が、壁一面に並ぶ倉庫。どれも同じ形をしている。ひとつだけが、点滅している。\n西は監視室。" },

    // ---- 札の森
    f1: { name: "札の森", lv: "forest", exits: { w: "box", n: "f2" },
      desc: "群青の空。黒い低木の森。霧の中に、濃い色の短冊が無数に揺れている。どの枝にも、誰かが口にした言葉の札が結ばれている。\n北へ、森の奥。西へ戻ると、カウンターの匂い。" },
    f2: { name: "森の奥", lv: "forest", exits: { s: "f1", n: () => S.path ? "f3" : null },
      desc: () => "森の奥。札が重く、枝が地面まで垂れ下がっている。ひときわ重い札が、道をふさぐように何重にも結ばれている。" +
        (S.path ? "\n燃えた札のあとから、北へ細い山道が開いている。" : "") + "\n南へ戻る。" },
    f3: { name: "椿の山道", lv: "forest", exits: { s: "f2" },
      desc: "夜の山道。椿の茂みの前で、人影が一つ、花を一つずつ摘んでは口に入れている。散った桜と、首ごと落ちた椿が、同じ季節に並んでいる。\n南へ戻る。" },

    // ---- 参道
    s1: { name: "参道", lv: "shrine", exits: { w: "box", n: "s2" },
      desc: "真夏の長い参道。額から汗がしたたる。蝉の声。立て札が一本。\n北に、二つ目の鳥居。西へ戻ると、カウンターの匂い。" },
    s2: { name: "二の鳥居", lv: "shrine", exits: { s: "s1", n: "s3" },
      desc: "二つ目の鳥居をくぐると、胸が重くなる。足が前へ出にくい。\n北に、中の門と本殿。南は参道。" },
    s3: { name: "本殿", lv: "shrine", exits: { s: "s2", n: () => S.reported ? "n1" : null },
      desc: () => "中の門を抜けた先の本殿。まっすぐ向き合えない。賽銭箱の前に立つと、蝉の声が、ぴたりと止んだ。" +
        (S.reported ? "\n本殿の脇から、北へ細い道が続いている。" : "") + "\n南は鳥居。" },

    // ---- 吊り橋
    n1: { name: "山の国道", lv: "night", exits: { s: "s3", n: "n2" },
      desc: "道幅が急に細くなる、くねった山の国道。ときどき、対向のトラックの光が、こちらを舐めていく。もう使われていない駐車場。\n北に、谷の吊り橋。南は、本殿の脇の道。" },
    n2: { name: "吊り橋", lv: "night", exits: { s: "n1", n: "n3" },
      desc: "深夜の長い吊り橋。聞こえるのは、川の音と谷の風だけ。山の向こうに、北の空。\n北の端に、明かりの消えた駅。南は国道。" },
    n3: { name: "終点の駅", lv: "night", exits: { s: "n2" },
      desc: "終点の駅のホーム。向かいのホームへ渡る橋が、どこにもない。誰もいない。白紙の時刻表だけが、白く光っている。\n南は吊り橋。" },
  };

  // 部屋に入るたびの扉の音
  const DOOR_ROOMS = ["r1", "r2", "r2b", "r3", "r5", "r6", "r7", "r8", "next", "kitchen", "lair"];

  // ---- 物 ----
  // on.動詞(もう一つの物) を持つ物は、その動詞を自分で受ける。false を返すと、ふつうの処理に戻る
  function initWorld() {
    for (const k of Object.keys(O)) delete O[k];

    // ---- 門の前
    thing("gatedoor", { name: "鉄の門", aliases: ["門", "鉄の門", "両開きの門", "gate"], en: "gate", loc: "gate", scenery: true,
      desc: "歪んで、最後まで開かない両開きの門。蝶番が錆びている。外の道へは、なぜか体が向かない。",
      on: { open: () => say("これ以上は開かない。……外へ出ようとすると、門のほうが、少しだけ閉じてくる。"), close: () => say("閉まらない。歪んでいる。") } });
    thing("stonewall", { name: "石垣", aliases: ["石垣", "石"], en: "stone wall", loc: "gate", scenery: true,
      desc: "崩れかけた石垣。石と石のすきまから、蟻が一列に出入りしている。" });
    thing("intercom", { name: "インターホン", aliases: ["インターホン", "呼び出し", "ボタン", "intercom", "mailbox"], en: "intercom", loc: "gate", scenery: true, container: true, closed: true,
      desc: () => O.intercom.closed ? "電池式のインターホン。いつ止まるか分からない。もう一つ、屋根裏につながっているほうは、配線をかじられて久しいらしい。本体の蓋は、外せそうだ。"
        : S.eggsGone ? "外した本体の中は、おがくずのような壁だけが残った枠。卵は、一つもない。通路だけが、きれいに残っている。"
        : "本体の中は、おがくずのような壁と、幅三ミリほどの通路。無数の卵が詰まっている。蟻の巣だ。",
      on: {
        press: () => { say("ボタンを押す。何も鳴らない。単三電池が六本。切れていることに、家の主は気づいていないのだろう。"); },
        open: () => {
          if (!O.intercom.closed) { say("もう開いている。"); return; }
          O.intercom.closed = false;
          say("本体の蓋を外す。");
          say(text(O.intercom.desc));
          if (O.leaflet.loc === "intercom") say("巣の手前に、四つに折った紙が一枚、挟まっている。");
        },
        close: () => { O.intercom.closed = true; say("蓋を戻した。蟻たちは、蓋のあるなしを気にしていない。"); },
      } });
    thing("eggs", { name: "蟻の卵", aliases: ["卵", "蟻", "蟻の巣", "巣", "ants", "eggs"], en: "eggs", loc: "intercom", scenery: true, hideIn: true, when: () => !S.eggsGone,
      desc: "無数の、白い粒。一つずつ、通路の奥へ運ばれていく。", on: { take: () => say("卵は、蟻たちのものだ。") } });
    thing("leaflet", { name: "注意書き", aliases: ["注意書き", "紙", "折った紙", "leaflet", "paper"], en: "leaflet", loc: "intercom", take: true, paper: true,
      desc: "四つに折った、薄い紙。印刷の字。",
      read: "「ようこそ。\nこの家には、■■があります。\n■■を見つけても、■■してはいけません。\n灯りが尽きる前に、■■へ戻ってください。」\n……肝心の語だけが、黒く塗りつぶされている。" });

    // ---- 庭
    thing("bike", { name: "自転車", aliases: ["自転車", "前かご", "かご", "bicycle"], en: "bicycle", loc: "garden", scenery: true,
      desc: () => "前かごのついた古い自転車。前かごの網目に、ふわふわと頼りない蜘蛛の巣が張られている。" + (S.moves > 120 ? "……巣の形が、前に見たときと変わっている。前より立派で、立体的だ。" : "主の姿は見えない。") });
    thing("web", { name: "蜘蛛の巣", aliases: ["蜘蛛の巣", "巣", "蜘蛛", "web", "spider"], en: "web", loc: "garden", scenery: true,
      desc: "頼りない巣。獲物はかかりそうにない。主は、真ん中の座布団のような所に、どうにか収まっているはずなのに、いない。",
      on: { take: () => say("壊したくない。……壊したところで、数日後には、別の場所で同じ巣が見つかる気がする。") } });
    thing("grass", { name: "草", aliases: ["草", "草むら", "grass"], en: "grass", loc: "garden", scenery: true,
      desc: "膝まで伸びた草。草むらの中は、無数の虫の声で満ちている。見上げた空は、音がしない。" });

    // ---- 家の裏
    thing("kwindow", { name: "台所の窓", aliases: ["窓", "台所の窓", "小さな窓", "window"], en: "window", loc: "back", scenery: true,
      desc: () => S.window ? "体が通るくらいに開いた窓。中は台所。" : "台所の小さな窓。ほんの少しだけ開いている。押し上げれば、通れそうだ。",
      on: {
        pull: () => VERB_DO.open(O.kwindow), press: () => VERB_DO.open(O.kwindow),
        open: () => { if (S.window) { if (S.loc === "back") { go("w"); return; } say("もう開いている。"); return; } S.window = true; say("窓を押し上げる。軋んで、体が通るくらいには開いた。"); },
        close: () => { if (!S.window) { say("もう閉まっている。"); return; } S.window = false; say("窓を下ろした。"); },
      } });

    // ---- 台所
    thing("menu", { name: "献立表", aliases: ["献立表", "献立", "レシピ", "menu", "recipe"], en: "menu", loc: "kitchen", scenery: true,
      desc: "壁の献立表。材料表の右側に、「適量」の文字だけが縦に並んでいる。",
      read: "献立がいくつも並び、どの材料の分量も「適量」。家ごとに調味料が違うので、自分の家の味に合わせよ、とある。\n最後の数品だけ、分量が書いてある。……読もうとすると、字がにじむ。\n欄外に、別の字で：「青菜に、塩を触れさせるな」" });
    thing("salt", { name: "塩の容器", aliases: ["塩の容器", "塩", "salt"], en: "salt", loc: "kitchen", scenery: true,
      desc: "振り出し式の、塩の容器。残りは、二粒。",
      on: { take: () => say("持っていっても、二粒だ。"), eat: () => say("一粒、舐めた。……容器の中は、まだ二粒ある。") } });
    thing("drawer", { name: "引き出し", aliases: ["引き出し", "drawer"], en: "drawer", loc: "kitchen", scenery: true, container: true, closed: true,
      desc: "調理台の下の引き出し。" });
    thing("matches", { name: "マッチ箱", aliases: ["マッチ箱", "マッチ", "matches", "match"], en: "matches", loc: "drawer", take: true,
      desc: () => "くしゃくしゃのマッチ箱。残りは " + S.matches + " 本。" });
    thing("candle", { name: "蝋燭", aliases: ["蝋燭", "ろうそく", "ロウソク", "灯り", "candle", "lamp", "light"], en: "candle", loc: "kitchen", take: true,
      lie: () => S.loc === "kitchen" ? "調理台の小皿に、太い蝋燭が一本。" : "ここに蝋燭がある。",
      desc: () => "太い蝋燭。名前を彫るはずの場所が、空いている。炎の長さが、残りの時間なのだという。" +
        (S.fuel <= 0 ? "芯は、もう尽きている。" : S.lit ? "炎が、小さく揺れている。" : "火は、点いていない。") });
    thing("stove", { name: "コンロ", aliases: ["コンロ", "ガスコンロ", "火", "stove"], en: "stove", loc: "kitchen", scenery: true,
      desc: "古いガスコンロ。つまみを回すと、青い炎が出る。",
      on: { lighton: () => lightFromStove(), press: () => lightFromStove() } });
    thing("ladder", { name: "梯子", aliases: ["梯子", "はしご", "ladder"], en: "ladder", loc: "kitchen", scenery: true, desc: "屋根裏へ上がる、木の梯子。" });

    // ---- 居間
    thing("case", { name: "飾り棚", aliases: ["飾り棚", "棚", "ガラスの棚", "ガラス", "窪み", "case", "trophy case"], en: "case", loc: "living", scenery: true, container: true, closed: true,
      desc: () => {
        const n = S.inCase.length;
        return "ガラスの扉の飾り棚。真鍮の札に「収蔵品」。中の段に、九つの窪み。" +
          (n >= TREASURES.length ? "八つの窪みが埋まった。残る一つは、人の形をしている。ちょうど、膝を抱えて座った大人ほどの大きさだ。"
            : (n ? "そのうち " + n + " つが、埋まっている。" : "") + "八つは、何か小さな物の形。残る一つは、人の形をしている。");
      },
      on: {
        open: () => {
          if (!O.case.closed && S.inCase.length >= TREASURES.length) { endShuzo(); return; }
          if (!O.case.closed) { say("もう開いている。"); return; }
          O.case.closed = false; sfx("glass"); say("ガラスの扉を開けた。古い木と、ガラス拭きの匂い。");
        },
        close: () => { O.case.closed = true; sfx("glass"); say("ガラスの扉を閉めた。"); },
      } });
    thing("rug", { name: "敷物", aliases: ["敷物", "絨毯", "じゅうたん", "rug", "carpet"], en: "rug", loc: "living", scenery: true,
      desc: () => S.rugMoved ? "部屋の隅へずらした、色あせた敷物。" : "色あせた敷物。真ん中のあたりだけ、床が少し盛り上がっている気がする。",
      on: { move: () => moveRug(), take: () => moveRug(), open: () => moveRug() } });
    thing("trapdoor", { name: "跳ね上げ戸", aliases: ["跳ね上げ戸", "戸", "床の戸", "trapdoor", "trap door"], en: "trapdoor", loc: "living", scenery: true, when: () => S.rugMoved,
      desc: () => S.trap ? "開いた跳ね上げ戸。下へ、石の階段が続いている。冷たい空気が上がってくる。" : "床の跳ね上げ戸。取っ手がついている。",
      on: {
        open: () => { if (S.trap) { say("もう開いている。"); return; } S.trap = true; S.barred = false; sfx("door"); say("取っ手を引く。重い戸が持ち上がり、下へ、石の階段が現れた。冷たい空気が上がってくる。"); },
        close: () => { if (!S.trap) { say("もう閉まっている。"); return; } S.trap = false; sfx("thud"); say("跳ね上げ戸を下ろした。"); },
      } });
    thing("piano", { name: "ピアノ", aliases: ["ピアノ", "縦型のピアノ", "鍵盤", "鍵", "シール", "piano", "key"], en: "piano", loc: "living", scenery: true,
      desc: "蓋が開いたままの、縦型のピアノ。真ん中の鍵の一つにだけ、シールが貼ってある。鍵は八十八。弦は、それよりずっと多い。",
      on: { press: () => playPiano(), play: () => playPiano() } });
    thing("tv", { name: "テレビ", aliases: ["テレビ", "大きなテレビ", "画面", "tv", "television"], en: "tv", loc: "living", scenery: true,
      desc: "リモコンをなくしたまま放ってある、大きなテレビ。黒い画面に、居間が暗く映っている。……映った居間には、自分がいない。",
      on: { press: () => say("電源のボタンが、どこにもない。"), lighton: () => say("電源のボタンが、どこにもない。") } });
    thing("lwindow", { name: "掃き出し窓", aliases: ["掃き出し窓", "窓", "鏡", "window"], en: "glass door", loc: "living", scenery: true,
      desc: () => candleHere() ? "灯りがあるあいだ、掃き出し窓は、部屋を映す暗い鏡になっている。蝋燭を持った誰かが、こちらを見ている。"
        : "灯りのないときに見ると、窓は、星の空と、墨のような森に入れ替わっていた。森の音は、ガラスで止まっている。",
      on: { open: () => say("掃き出し窓は、開かない。鍵ではなく、窓の向こうのほうが、開くことを許していない。") } });

    // ---- 屋根裏
    thing("wires", { name: "配線", aliases: ["配線", "線", "wires"], en: "wires", loc: "attic", scenery: true,
      desc: "かじられて千切れた配線。門のインターホンへつながっていたらしい。かじった誰かの姿は、ない。" });
    thing("abox", { name: "段ボール箱", aliases: ["段ボール箱", "段ボール", "箱", "box"], en: "box", loc: "attic", scenery: true, container: true, closed: true,
      desc: "ガムテープの剥がれかけた段ボール箱。",
      on: { open: () => { if (!O.abox.closed) { say("もう開いている。"); return; } O.abox.closed = false; say("箱を開ける。同じ封筒が、ぎっしり詰まっている。底のほうに、額に入らない大きさの絵が一枚。"); } } });
    thing("letters", { name: "落選通知の束", aliases: ["落選通知の束", "落選通知", "通知", "封筒", "手紙", "letters"], en: "letters", loc: "abox", take: true, paper: true,
      desc: "同じ封筒の束。宛名の欄だけが、どれも空いている。",
      read: "どれも同じ文面。「厳正なる選考の結果、今回は……」。部門の名前だけが、一通ごとに違う。ほめる部門と、けなす部門が、半々。\nいちばん下の一通は、「退屈な一生」部門。選外。" });
    thing("butterfly", { name: "黒い蝶の絵", aliases: ["黒い蝶の絵", "蝶の絵", "蝶", "絵", "butterfly", "picture"], en: "butterfly picture", loc: "abox", take: true,
      desc: "黒一色の蝶の絵。背景に、歪んだ方眼。……方眼の線は、どこかの鍵の溝の形に似ている。" });

    // ---- 地下室
    thing("trap2", { name: "跳ね上げ戸", aliases: ["跳ね上げ戸", "戸", "天井", "trapdoor"], en: "trapdoor", loc: "cellar", scenery: true,
      desc: () => S.barred ? "頭の上の跳ね上げ戸。上から押さえつけられていて、びくともしない。" : S.trap ? "頭の上の跳ね上げ戸が、開いている。上は居間。" : "頭の上の、閉じた跳ね上げ戸。",
      on: { open: () => { if (S.barred) { say("押し上げても、びくともしない。上から、何かが押さえつけている。"); return; } if (S.trap) { say("もう開いている。"); return; } S.trap = true; sfx("door"); say("押し上げる。上は、居間だ。"); } } });
    thing("yellow", { name: "黄色い壁紙", aliases: ["黄色い壁紙", "壁紙", "壁", "wallpaper", "wall"], en: "wallpaper", loc: "cellar", scenery: true,
      desc: "東の壁の一か所だけに貼られた、黄色い壁紙。湿っている。壁の向こうから、蛍光灯のうなりが聞こえる。……壁の向こう、というより、壁紙の向こうから。" });
    thing("belldoor", { name: "木の扉", aliases: ["木の扉", "扉", "南の扉", "door"], en: "wooden door", loc: "cellar", scenery: true,
      desc: "呼び鈴のついた木の扉。小さな札に「お通りの方は、呼び鈴を」。",
      on: { open: () => { if (!S.bell) { say("扉は開かない。……呼び鈴がある。"); return; } go("s"); } } });
    thing("bell", { name: "呼び鈴", aliases: ["呼び鈴", "ベル", "bell", "doorbell"], en: "doorbell", loc: "cellar", scenery: true,
      desc: "押すと鳴るだけの、古い呼び鈴。",
      on: { play: () => VERB_DO.press(O.bell), press: () => { S.bell = true; sfx("bell"); say("呼び鈴を押す。扉の向こうで、誰かが「どうぞ」と言った。……鍵の外れる音。"); } } });

    // ---- 番号の廊下
    const door = (id, no, room, loc, extra) => thing(id, Object.assign({ name: no + "の扉", aliases: [no + "の扉", no + "番の扉", no + "番", no, "扉" + no, "door " + no], en: "door " + no, loc, scenery: true,
      desc: "「" + no + "」の札のかかった扉。",
      on: { open: () => enterDoor(room) } }, extra || {}));
    door("d1", "1", "r1", "corr1");
    door("d2", "2", "r2", "corr1");
    door("d3", "3", "r3", "corr1");
    door("d5", "5", "r5", "corr1", { desc: "「5」の札のかかった扉。……数えれば、四つ目の扉だ。" });
    door("d4", "4", "stair4", "corr1", { when: () => S.door4,
      desc: () => S.door4Open ? "開いた「4」の扉。下へ、階段。" : "さっきまでなかった「4」の扉。飾りのない鍵穴がある。",
      on: { open: () => openDoor4() } });
    door("d6", "6", "r6", "corr2");
    door("d7", "7", "r7", "corr2");
    door("d8", "8", "r8", "corr2");
    door("d10", "10", null, "corr2", { desc: "「10」の札。その下に、もう一枚の札。「立入禁止」。",
      on: { open: () => noEntry() } });
    thing("redbtn", { name: "赤いボタン", aliases: ["赤いボタン", "ボタン", "button", "red button"], en: "red button", loc: "corr1", scenery: true,
      desc: "壁の赤いボタン。「強く押す」とだけ書いてある。何のためのボタンなのかは、どこにも書いていない。",
      on: { press: () => { sfx("beep"); fx("glitch"); say("強く押す。……どこかで、誰かに叱られた。押せと書いてあったのに。"); S.btn = (S.btn || 0) + 1; if (S.btn >= 3) { haunt(); say("叱る声は、三度目には、自分の声になっていた。", "note"); } } } });

    // ---- 1 放送室
    thing("lever", { name: "レバー", aliases: ["レバー", "主電源", "電源", "lever", "switch"], en: "lever", loc: "r1", scenery: true,
      desc: () => S.power ? "上がった主電源のレバー。" : "大きな元電源のレバー。下がっている。",
      on: { press: () => toggleLever(), pull: () => toggleLever(), lighton: () => { if (!S.power) toggleLever(); else say("もう上がっている。"); }, lightoff: () => { if (S.power) toggleLever(); else say("もう下がっている。"); } } });
    thing("speaker", { name: "回転スピーカー", aliases: ["回転スピーカー", "スピーカー", "切り替え", "speaker"], en: "speaker", loc: "r1", scenery: true,
      desc: "木の箱の中で、スピーカーが回る仕掛け。",
      on: { press: () => { if (!S.power) { say("電源が入っていない。"); return; } say("切り替える。入れた瞬間は揺れがゆるく、回転が上がりきるまで、少しずつ細かく震えていく。……機械が止まると、この音は二度と戻らない。"); sfx("hum"); } } });

    // ---- 2 調光室
    const btn = (id, ja, en) => thing(id, { name: ja + "のボタン", aliases: [ja + "のボタン", ja, en, en + " button"], en: en + " button", loc: "r2", scenery: true,
      desc: ja + "のボタン。", on: { press: () => pressColor(ja) } });
    btn("bR", "赤", "red"); btn("bB", "青", "blue"); btn("bG", "緑", "green"); btn("bY", "黄", "yellow");
    thing("drum", { name: "太鼓", aliases: ["太鼓", "皮", "drum"], en: "drum", loc: "r2", scenery: true,
      desc: () => S.backstage ? "白っぽい太鼓の皮が、ないはずの緑に、うっすら光っている。" : "舞台の真ん中の、白っぽい皮の太鼓。照明を浴びると、その色を映す。",
      on: { press: () => say("窓の向こうだ。手は届かない。"), play: () => say("窓の向こうだ。手は届かない。") } });
    thing("idol", { name: "象の頭の神像", aliases: ["象の頭の神像", "神像", "象", "像", "idol", "statue"], en: "idol", loc: "r2b", take: true, treasure: true,
      lie: () => S.loc === "r2b" ? "鏡の前の台に、象の頭の小さな神像が置いてある。" : "ここに象の頭の神像がある。",
      desc: "手のひらに載るほどの、象の頭の神像。どこかの税関を、すり抜けてきたらしい。" });

    // ---- 3 鏡写しの居間
    thing("mcase", { name: "鏡の飾り棚", aliases: ["鏡の飾り棚", "飾り棚", "棚", "case"], en: "mirror case", loc: "r3", scenery: true,
      desc: () => {
        const n = S.inCase.length;
        return "上の飾り棚と、左右が逆の飾り棚。九つの窪み。" + (n ? "上の棚に収めた " + n + " つが、こちらにも、左右逆に並んでいる。" : "どの窪みも空いている。") +
          "\n……人の形の窪みにだけ、もう誰かが入っている。膝を抱えて、こちらに背を向けている。";
      },
      on: { open: () => say("ガラスの扉には、内側から鍵がかかっている。中の誰かは、振り向かない。") } });
    thing("moon", { name: "三日月の絵", aliases: ["三日月の絵", "月の絵", "三日月", "絵", "moon", "picture"], en: "moon picture", loc: "r3", take: true,
      lie: () => S.loc === "r3" ? "壁に、三日月の絵が掛かっている。上の居間には、なかった絵だ。" : "ここに三日月の絵がある。",
      desc: "黒地に、三日月の絵。背景に、歪んだ方眼。方眼の線は、蝶の絵のものと続きそうに見える。" });

    // ---- 5（四番目）の部屋
    thing("roll", { name: "出席簿", aliases: ["出席簿", "名簿", "roll"], en: "roll book", loc: "r5", scenery: true, paper: true,
      desc: "開いたままの出席簿。",
      read: () => { S.learn.four = true; return "番号は、一、二、三、五、六、七、八、十……。四と九が抜けている。番号と並び順が、少しずつずれていく。\n四番目の欄の名前だけが、空いている。\n欄外に：「四番目なのは変わらないのに、避けられるほうが、よほど呪いみたいだ」"; } });

    // ---- 6 小部屋
    thing("notebook", { name: "ノート", aliases: ["ノート", "帳面", "notebook"], en: "notebook", loc: "r6", scenery: true, paper: true,
      desc: "偶数が延々と並んだノート。",
      read: () => { S.learn.kime = true; return "4以上の偶数は、どれも二つの素数の和になる。……それを、一つずつ確かめつづけたページ。反例は、まだ一つもない。\n欄外に、鉛筆で小さく：「1+1が2なのは、実のところ決めごとにすぎない。そうでないと困るのだ」\n最後のページに：「予想と証明は、別物だ」"; } });
    thing("pencil", { name: "鉛筆", aliases: ["鉛筆", "pencil"], en: "pencil", loc: "r6", take: true, desc: "短くなった鉛筆。先だけが、よく尖っている。" });
    thing("r6door", { name: "半透明の扉", aliases: ["半透明の扉", "扉", "door"], en: "door", loc: "r6", scenery: true,
      desc: () => S.r6Free ? "開いた半透明の扉。" : "半透明の扉。鉛筆の字で：「反例を一つ見つけたら、出てよい」",
      on: { open: () => { if (S.r6Free) { go("s"); return; } say("開かない。扉の字：「反例を一つ見つけたら、出てよい」"); } } });

    // ---- 7 調べる部屋。調べると、終わらない
    const spot = (id, ja, aliases, en) => thing(id, { name: ja, aliases, en, loc: "r7", scenery: true, on: { examine: () => r7Check(id, ja), open: () => r7Check(id, ja) } });
    spot("bedunder", "ベッドの下", ["ベッドの下", "ベッド", "bed"], "bed");
    spot("oshiire", "押し入れ", ["押し入れ", "押入れ", "closet"], "closet");
    spot("cases6", "衣装ケース", ["衣装ケース", "ケース", "cases"], "cases");
    spot("deskdr", "机の引き出し", ["机の引き出し", "引き出し", "机", "desk"], "desk");
    spot("tap", "電源タップ", ["電源タップ", "タップ", "コンセント", "tap"], "power strip");
    thing("pencase", { name: "筆箱", aliases: ["筆箱", "ペンケース", "pencil case"], en: "pencil case", loc: "r7", scenery: true, container: true, closed: true,
      desc: () => O.pencase.closed ? "机の上の筆箱。開けるのが、なぜか怖い。" : "ひとりでに開いた筆箱。",
      on: { open: () => say(O.pencase.closed ? "手を伸ばすと、指が止まる。……こんな所に何かあるわけないのに、開けられない。" : "もう開いている。"),
        examine: () => say(text(O.pencase.desc)) } });
    thing("beetle", { name: "金色の甲虫", aliases: ["金色の甲虫", "甲虫", "虫", "beetle"], en: "beetle", loc: "pencase", take: true, treasure: true,
      desc: () => "金色の甲虫。動かない。" + (held("beetle") && S.moves % 7 === 0 ? "……さっきより、一匹多い気がする。" : "一匹見つけると、どんどん増えて、ある日いっせいにいなくなる。そういう虫だ。") });

    // ---- 8 水槽
    thing("tank", { name: "水槽", aliases: ["水槽", "tank"], en: "tank", loc: "r8", scenery: true,
      desc: () => S.paneOut ? "水槽。熱帯魚が、こちらを向いている。" : "水槽。撮影のために、ガラス板が一枚、中に仕込んである。" });
    thing("fish", { name: "熱帯魚", aliases: ["熱帯魚", "魚", "fish"], en: "fish", loc: "r8", scenery: true,
      desc: () => S.paneOut ? "こちらを向いた魚。……雑誌の写真では、こちらを向いた魚は、一匹もいなかった。名前のない魚だ。" : "壁とガラス板にはさまれ、横向きのまま動けない魚。シャッターが切り終わるまで、泳いではいけない。",
      on: { take: () => say("水の中だ。") } });
    thing("pane", { name: "ガラス板", aliases: ["ガラス板", "ガラス", "板", "pane", "glass"], en: "pane", loc: "r8", scenery: true, take: true,
      desc: "水槽に仕込まれた、薄いガラス板。",
      on: { take: () => { if (S.paneOut) return false; S.paneOut = true; O.pane.loc = "player"; O.pane.scenery = false; sfx("splash");
        say("ガラス板を抜き取った。魚が、ゆっくりと体を回す。……こちらを向いた。"); say("「じゃあね、ガラスの板」と、誰かが言った。", "voice"); } } });

    // ---- 四番の階段と、球の艇
    thing("steps", { name: "段", aliases: ["段", "階段", "steps", "stairs"], en: "steps", loc: "stair4", scenery: true,
      desc: "数えながら降りると、四段目と九段目が、どこにもない。足は、確かにそこを踏んでいるのに。" });
    thing("board", { name: "当番表", aliases: ["当番表", "当番", "表", "board"], en: "board", loc: "sub", scenery: true, paper: true,
      desc: "壁の当番表。",
      read: "四つの役：聴く・操る・打電・休む。一定の時間ごとに回す。\n周期は、四時間 → 八時間 → 六時間と書き換えられ、最後の欄は二時間刻みになっている。……どの欄にも、自分の名前がない。\n下に、赤い字で：「聴く番の者は、目を閉じるな。ほかの者を起こすのは、聴く番の仕事だ」" });
    thing("slog", { name: "交信の記録帳", aliases: ["交信の記録帳", "記録帳", "記録", "log", "logbook"], en: "logbook", loc: "sub", scenery: true, paper: true,
      desc: "交信の記録帳。",
      read: "一時間ごとの定時の信号。「異常なし」「異常なし」「異常なし」……。何日も先の日付まで、もう「異常なし」と書きこまれている。\n最後のページに、走り書き：「海へ流す二つの弁。開ける順を、間違えるな。赤が先」" });
    thing("phones", { name: "ヘッドホン", aliases: ["ヘッドホン", "ヘッドフォン", "headphones"], en: "headphones", loc: "sub", take: true,
      desc: () => S.listening ? "耳に当てたヘッドホン。管を流れる空気の音の奥に、何かが聞こえる気がする。" : "聴く役のヘッドホン。フックにかかっている。",
      on: { wear: () => wearPhones() } });
    thing("bunk", { name: "寝床", aliases: ["寝床", "畳", "bunk"], en: "bunk", loc: "sub", scenery: true, desc: "畳一枚ぶんの寝床。休む番の者だけが、ここに横になれる。" });
    thing("food", { name: "携行食の箱", aliases: ["携行食の箱", "携行食", "食料", "food"], en: "rations", loc: "sub", scenery: true,
      desc: "穀物を砕いて固めた携行食の箱。休む番になるたびに、一箱。",
      on: { eat: () => say("一つかじる。乾いていて、口の中の水を、全部持っていく。"), take: () => say("休む番ではない。") } });
    thing("barrel", { name: "果実酒の樽", aliases: ["果実酒の樽", "樽", "果実酒", "酒", "barrel"], en: "barrel", loc: "sub", scenery: true,
      desc: "水の代わりに積まれた、果実酒の樽。", on: { drink: () => say("ひと口。ぬるくて、甘い。……水は、どこにも積まれていない。") } });
    const valve = (id, ja, en) => thing(id, { name: ja, aliases: [ja, ja.replace("の弁", ""), en], en, loc: "sub", scenery: true,
      desc: () => (S.valves.includes(id) ? "開いた" : "閉じた") + ja + "。海へ流す弁だという。",
      on: { open: () => openValve(id), press: () => openValve(id), pull: () => openValve(id) } });
    valve("vred", "赤い弁", "red valve"); valve("vblue", "青い弁", "blue valve");

    // ---- 隣の部屋
    thing("uniform", { name: "制服", aliases: ["制服", "uniform"], en: "uniform", loc: "next", scenery: true, desc: "擦り切れた制服。来るたびに、着ている人の顔が違うのだろう。" });
    thing("bag", { name: "鞄", aliases: ["鞄", "かばん", "bag"], en: "bag", loc: "next", scenery: true, desc: "くたびれた鞄。中は空っぽだ。", on: { open: () => say("空っぽだ。") } });
    thing("plank", { name: "天井の板", aliases: ["天井の板", "板", "天井", "plank"], en: "plank", loc: "next", scenery: true,
      desc: "持ち上がりそうな天井の板。「向こうへの近道なんです」と、誰かが言っていた。",
      on: { open: () => go("u"), press: () => go("u") } });

    // ---- 黄色い部屋
    thing("coin", { name: "小さな硬貨", aliases: ["小さな硬貨", "硬貨", "小銭", "お金", "coin"], en: "coin", loc: "m3", take: true,
      desc: "もう流通していない、いちばん小さな硬貨。手のひらの上で、「我々は、ちゃんとここにある」と言っている気がする。" });
    thing("kimono", { name: "抜けがらの着物", aliases: ["抜けがらの着物", "着物", "抜けがら", "kimono"], en: "kimono", loc: "m8", scenery: true, container: true, closed: false,
      lie: "床に、抜けがらの着物が一枚、人の形のまま落ちている。",
      desc: () => "人の形のまま落ちている、抜けがらの着物。" + (O.key.loc === "kimono" ? "袖の中に、何か硬いものがある。" : "中身のない重さだけが残っている。"),
      on: { take: () => say("持ち上げると、中身のない重さがした。……そのまま、置いておく。") } });
    thing("key", { name: "飾りのない鍵", aliases: ["飾りのない鍵", "鍵", "key"], en: "key", loc: "kimono", take: true,
      desc: "飾りの付いていない鍵が一本。どの扉の鍵なのか、確かめようがない。確かめないかぎり、どの扉の鍵にもなりうる。" });
    thing("hatch", { name: "跳ね上げ蓋", aliases: ["跳ね上げ蓋", "蓋", "床", "hatch"], en: "hatch", loc: "m4", scenery: true, closed: true,
      desc: () => O.hatch.closed ? "カーペットの継ぎ目に、四角い蓋の輪郭がある。" : "開いた床の蓋。下から、古本の匂い。",
      on: { open: () => { if (!O.hatch.closed) { say("もう開いている。"); return; } O.hatch.closed = false; sfx("door"); say("カーペットごと、蓋を持ち上げた。下から、古い紙の匂いが上がってくる。"); },
        close: () => { O.hatch.closed = true; say("蓋を閉めた。"); } } });
    thing("mwall", { name: "壁", aliases: ["壁", "黄色い壁紙", "壁紙", "wall", "wallpaper"], en: "wall", loc: null, scenery: true, where: loc => MAZE.includes(loc),
      desc: "湿った黄色い壁紙。継ぎ目が、まっすぐではない。押せば、少しだけ、たわむ。",
      on: { press: () => pushWall(), examine: () => { say("湿った黄色い壁紙。継ぎ目がまっすぐではない。手を当てると、少しだけ、たわむ。"); if (Math.random() < 0.6) say(pick(SCRIBBLES)); } } });
    thing("thief", { name: "背の高い誰か", aliases: ["背の高い誰か", "誰か", "回収人", "人影", "thief", "someone"], en: "someone", loc: null, scenery: true, where: loc => S.th.loc === loc,
      desc: "背の高い誰か。顔は、本の頁のように薄くて、読めない。手垢と香水と線香と煙草の匂い。……こちらの持ち物を、値踏みしている。",
      on: { take: () => say("手が、頁のあいだをすり抜けた。"), give: () => thiefGive() } });

    // ---- 古本の部屋
    thing("books", { name: "古本", aliases: ["古本", "本", "books"], en: "books", loc: "lair", scenery: true,
      desc: "同じ作者の本ばかり。どれも、店に並んだその日に買われたものだ。",
      read: "開くと、余白に誰かの書き込み。「昔愛した物語が、よそでどう愛されたのか、知りたくて」……それ以上は、線で消されている。" });

    // ---- 箱
    thing("counter", { name: "カウンター", aliases: ["カウンター", "counter"], en: "counter", loc: "box", scenery: true,
      desc: "冷たい石のカウンター。直線ばかりの部屋の中で、グラスと瓶の曲線だけが、懐かしく見える。", on: { sit: () => sitBar(null) } });
    for (let i = 1; i <= 5; i++) {
      const kan = "一二三四五"[i - 1];
      thing("c" + i, { name: kan + "番目の椅子", aliases: [kan + "番目の椅子", i + "番目の椅子", "椅子" + i, "椅子" + kan, "stool " + i], en: "stool " + i, loc: "box", scenery: true,
        desc: "座面の高い椅子。" + (i === 5 ? "いちばん端。" : ""), on: { sit: () => sitBar(i) } });
    }
    thing("clerk", { name: "店員", aliases: ["店員", "バーテン", "コウモリ", "clerk", "bartender"], en: "bartender", loc: "box", scenery: true,
      desc: "黒ずくめの店員。胸の内で、まがいもののコウモリ、とあだ名をつけた。",
      on: { give: () => say("店員は、何も受け取らない。グラスを拭きつづけている。") } });
    thing("glass", { name: "紫の酒のグラス", aliases: ["紫の酒のグラス", "グラス", "酒", "紫の酒", "glass", "drink"], en: "glass", loc: "box", scenery: true, when: () => S.glass && !S.drunk,
      desc: () => S.stir >= 3 ? "グラス全体が、紫の花の色に染まっている。" : "紫の酒が、氷のすきまを抜けて底に沈んでいる。上のほうは、水のようだ。",
      on: { stir: () => stirGlass(), drink: () => drinkGlass(), take: () => say("ここで飲むものだ。") } });
    thing("bottle", { name: "紫の酒の瓶", aliases: ["紫の酒の瓶", "瓶", "空き瓶", "bottle"], en: "bottle", loc: null, take: true, treasure: true,
      desc: "もう作られていない、紫の花の酒の、最後の一本。空になっている。底に、色だけが残っている。" });

    // ---- 淡い街
    thing("people", { name: "人々", aliases: ["人々", "人", "people"], en: "people", loc: "pale1", scenery: true,
      desc: "淡い服の人々。声を出さない。刺激を避けて暮らしているのだろう。目が合うと、そっと逸らされる。" });
    thing("signs", { name: "看板", aliases: ["看板", "sign"], en: "sign", loc: "pale1", scenery: true, paper: true,
      desc: "白地に、ごく淡い黄の文字。", read: "目を凝らして、やっと読める。「静粛に」「原色の持ちこみを禁ず」「赤は、八か所まで」" });
    thing("slot", { name: "投函口", aliases: ["投函口", "代金", "取り出し口", "slot"], en: "slot", loc: "pale2", scenery: true,
      desc: "「代金はこちらへ」の投函口。その下に、取り出し口。" });
    thing("spray", { name: "赤のスプレー缶", aliases: ["赤のスプレー缶", "スプレー缶", "スプレー", "缶", "赤", "spray", "can"], en: "spray can", loc: null, take: true,
      desc: "原色の赤のスプレー缶。この街で持っていると、目立ちすぎる。", on: { press: () => sprayPanels() } });
    thing("panels", { name: "色のパネル", aliases: ["色のパネル", "パネル", "壁", "panels"], en: "panels", loc: "pale3", scenery: true,
      desc: () => S.panels ? "八か所の赤が、戻っている。" : "二センチ角のパネル。八か所の赤だけが、褪せている。",
      on: { press: () => say("パネルは、押すものではない。……褪せた赤に、何かで色を戻せそうだ。") } });
    thing("sodium", { name: "ナトリウム灯", aliases: ["ナトリウム灯", "灯", "照明", "lamp"], en: "sodium lamp", loc: "pale3", scenery: true,
      desc: "天井のナトリウム灯。点けると、部屋じゅうが一色になる。",
      on: { press: () => sodiumLamp(), lighton: () => sodiumLamp() } });
    thing("pedestal", { name: "台座", aliases: ["台座", "pedestal"], en: "pedestal", loc: "pale3", scenery: true, desc: () => S.poly ? "何も載っていない台座。" : "何も載っていない台座。何かが載るのを、待っている。" });
    thing("poly", { name: "色付きの多面体", aliases: ["色付きの多面体", "多面体", "polyhedron"], en: "polyhedron", loc: null, take: true, treasure: true,
      desc: "どの面も、ちがう色の多面体。どの色も、少しずつ強すぎる。" });

    // ---- ごみの穴
    thing("acryl", { name: "アクリル窓", aliases: ["アクリル窓", "窓", "穴", "ごみ", "window", "pit"], en: "window", loc: "pit1", scenery: true,
      desc: () => (S.pitT % 3 === 2 ? "窓の下で、金色の粉が舞っている。爪が、茶色の中から、金の屏風のようなものを持ち上げかけている。" : "何もかも茶色の穴。爪が、掴んでは別の場所へ落とす。何も、変わらない。") + "\n金を眺めるより、ごみを眺めているほうが、気が休まる。" });
    thing("plever", { name: "クレーンのレバー", aliases: ["クレーンのレバー", "レバー", "操作盤", "クレーン", "lever", "crane"], en: "crane lever", loc: "pit1", scenery: true,
      desc: "クレーンの操作盤のレバー。", on: { press: () => craneGrab(), pull: () => craneGrab() } });
    thing("tray", { name: "受け皿", aliases: ["受け皿", "tray"], en: "tray", loc: "pit1", scenery: true, container: true, closed: false, desc: "窓の下の受け皿。" });
    thing("gold", { name: "金箔の切れ端", aliases: ["金箔の切れ端", "金箔", "切れ端", "屏風", "gold", "gold leaf"], en: "gold leaf", loc: null, take: true, treasure: true,
      desc: "金の屏風の、角の切れ端。ごみの中にあったのに、どこも汚れていない。" });
    thing("safes", { name: "白い金庫", aliases: ["白い金庫", "金庫", "safes"], en: "safes", loc: "pit2", scenery: true,
      desc: "どれも同じ形の、白い金庫。点滅しているのは、一つだけ。" });
    thing("bsafe", { name: "点滅する金庫", aliases: ["点滅する金庫", "金庫", "割符", "safe"], en: "blinking safe", loc: "pit2", scenery: true, container: true, closed: true,
      desc: () => S.safeOpen ? "開いた金庫。来世へ送れるのは、金庫ひとつ分だけ、と扉の裏に書いてある。"
        : "点滅している白い金庫。扉に、絵を嵌めこむ枠が二つ。" + (S.safe.length ? "片方には、もう絵が嵌まっている。" : "どちらも空いている。") + "二つの絵柄がそろわないと開かない、割符の金庫だ。",
      on: { open: () => say(S.safeOpen ? "もう開いている。" : "開かない。枠が二つ、空いている。") } });
    thing("ring", { name: "指輪の小箱", aliases: ["指輪の小箱", "小箱", "指輪", "ring", "ring box"], en: "ring box", loc: "bsafe", take: true, treasure: true,
      desc: "ありふれた指輪の入った、小さな箱。内側に、誰のものでもない頭文字が彫ってある。" });

    // ---- 札の森
    thing("tags", { name: "札", aliases: ["札", "短冊", "言葉", "tags", "tag"], en: "tags", loc: "f1", scenery: true,
      desc: "誰かが口にした、負の言葉の札。重い言葉ほど、札も重い。一見ほめ言葉なのに、ひどく重い札もある。",
      read: () => pick(TAG_WORDS), on: { burn: () => burnTag(false), lighton: () => burnTag(false) } });
    thing("heavy", { name: "重い札", aliases: ["重い札", "札", "短冊", "tags", "tag"], en: "heavy tags", loc: "f2", scenery: true,
      desc: () => S.path ? "燃え残りの紐だけが、枝に揺れている。" : "何重にも結ばれた重い札。枝が地面まで垂れている。燃やす指が、ただれそうな重さだ。",
      read: () => pick(TAG_WORDS), on: { burn: () => burnTag(true), lighton: () => burnTag(true) } });
    thing("beast", { name: "人影", aliases: ["人影", "男", "人", "figure", "man"], en: "figure", loc: "f3", scenery: true,
      desc: "椿の花を一つずつ摘んでは、口に入れている人影。着物の裾から、人のものではない足が見える気がする。",
      on: { give: () => say("人影は受け取らない。椿のほうがいい、と言いたげに。"), take: () => say("触れようとは、思えない。") } });
    thing("tsubaki", { name: "首ごと落ちた椿", aliases: ["首ごと落ちた椿", "椿", "花", "camellia"], en: "camellia", loc: "f3", take: true, treasure: true,
      lie: () => S.loc === "f3" ? "足もとに、首ごと落ちた椿が一つ。" : "ここに首ごと落ちた椿がある。",
      desc: "首ごと落ちた椿。まだ、少しも萎れていない。", on: { eat: () => say("口に入れかけて、やめた。……人の姿でいるうちは、やめておいたほうがいい気がする。") } });

    // ---- 参道
    thing("ssign", { name: "立て札", aliases: ["立て札", "札", "sign"], en: "sign", loc: "s1", scenery: true, paper: true,
      desc: "古い立て札。", read: () => { S.learn.report = true; return "「願いごとはせず、報告だけを。\n礼をひとつ、拍手をふたつ、礼をひとつ」"; } });
    thing("torii", { name: "鳥居", aliases: ["鳥居", "torii"], en: "torii", loc: "s2", scenery: true, desc: "二つ目の鳥居。くぐるたびに、胸が重くなる。報告していない出来事の数だけ、重くなる気がする。" });
    thing("saisen", { name: "賽銭箱", aliases: ["賽銭箱", "賽銭", "箱", "offering box"], en: "offering box", loc: "s3", scenery: true,
      desc: () => O.planis.loc === "s3" ? "賽銭箱の上に、星座盤が一枚、置いてある。" : "古い賽銭箱。",
      on: { open: () => say("開けるものではない。") } });
    thing("planis", { name: "星座盤", aliases: ["星座盤", "星座", "盤", "planisphere"], en: "planisphere", loc: null, take: true, treasure: true,
      desc: "子どものころにもらったような、紙の星座盤。結局、一度も使いこなせなかった。北の星座は、一年中、沈まない。" });

    // ---- 吊り橋
    thing("nsky", { name: "北の空", aliases: ["北の空", "空", "星", "北極星", "sky", "star"], en: "north sky", loc: "n2", scenery: true,
      desc: () => checkPolaris(), on: { examine: () => say(checkPolaris()) } });
    thing("truck", { name: "トラックの光", aliases: ["トラックの光", "トラック", "光", "truck"], en: "truck", loc: "n1", scenery: true,
      desc: "対向のトラックの光。近づいてくるのに、エンジンの音がしない。すれ違ったあとには、何も通っていない。" });
    thing("timetable", { name: "時刻表", aliases: ["時刻表", "timetable"], en: "timetable", loc: "n3", scenery: true, paper: true,
      desc: "白紙のまま、白く光る時刻表。", read: "何も書かれていない。……白い光の奥に、一行だけ、薄く。「来る時刻は、ばらばら。来る人も、毎回ちがう」" });
  }

  // 札に結ばれた言葉。どれも、誰かが口にした負の言葉（言い換えてある）
  const TAG_WORDS = ["「こっちのほうが、似合うんじゃない？」", "「で、あなたは何ができる人なの？」", "「正直、みんなそこまで、あんたに興味ないと思う」",
    "「みんなしてることだから、平気」", "「まあ、そのうち慣れるよ」", "「あなたはもう十分すごい」", "「長いし、気持ち悪い」", "「もう、無理よ」",
    "「その情報、要る？」", "「早く治るといいですね」", "「どこにでもある、ふつうのお宅ですよ」", "「はいはい、気をつけて」"];

  // ---- 移動 ----
  function go(dir) {
    if (S.loc === "gate" && (dir === "w" || dir === "s")) { say("門は歪んで、最後まで開かない。体を横にしても、外の道へは、なぜか体が向かない。"); return; }
    if (S.loc === "back" && dir === "w" && !S.window) { say("窓は、ほんの少ししか開いていない。押し上げれば、通れそうだ。"); return; }
    if (S.loc === "living" && dir === "d" && !S.trap) { say(S.rugMoved ? "跳ね上げ戸が閉まっている。" : "床だ。……敷物の真ん中が、少し盛り上がっている。"); return; }
    if (S.loc === "cellar" && dir === "u") {
      if (S.barred) { say("跳ね上げ戸は、上から押さえつけられていて、びくともしない。"); return; }
      if (!S.trap) { say("跳ね上げ戸が閉まっている。"); return; }
    }
    if (S.loc === "cellar" && dir === "s" && !S.bell) { say("木の扉は閉まっている。小さな札に「お通りの方は、呼び鈴を」。"); return; }
    if (S.loc === "next" && dir === "u" && !S.bell) { say("板は、持ち上がらない。……近道は、呼び鈴を押した者だけのものだ。"); return; }
    if (S.loc === "r6" && dir === "s" && !S.r6Free) {
      S.r6Try++;
      say("半透明の扉が、開かない。鉛筆の字：「反例を一つ見つけたら、出てよい」");
      if (S.r6Try >= 2) say("……ノートの偶数は、どこまで確かめても、二つの素数の和になる。反例は、見つかりそうにない。", "note");
      return;
    }
    if (S.loc === "sub" && dir === "u" && S.valves.length === 2) { endFujo(); return; }
    if (S.loc === "n3" && dir === "d") { say("ホームの端から、線路に降りる。……線路は、どちらへも続いていなかった。ホームに戻る。"); return; }
    if (S.loc === "box" && dir !== "w") { say(S.drunk ? "歩いても、景色は変わらない。席を、ずらさないと。" : "カウンターと、椅子と、明滅する光。出口は、西だけだ。"); return; }
    const to = exitsOf(S.loc)[dir];
    if (!to) {
      if (!lit()) { say("手探りで進もうとして、壁にぶつかった。"); sfx("thud"); return; }
      say(`${DIR_JA[dir] || "そちら"}へは行けない。`);
      return;
    }
    if (S.loc === "back" && to === "kitchen") say("窓から、台所へ入る。");
    if (S.loc === "kitchen" && to === "back") say("窓から、外へ出る。");
    if (S.loc === "next" && to === "attic") { say("天井の板を持ち上げて、上へ。……狭い隙間を這いのぼると、屋根裏だった。近道にしては、ずいぶん遠い。"); S.bell = false; }
    sfx(DOOR_ROOMS.includes(to) || DOOR_ROOMS.includes(S.loc) ? "door" : "step");
    enter(to);
  }
  function enter(to, full) {
    const from = S.loc;
    S.loc = to;
    if (from !== to) roomChange(from, to);
    describe(!!full);
    arrive(to, from);
  }
  function roomChange(from, to) {
    S.r7Wait = 0; S.trainWait = 0; S.pushW = 0;
    if (from === "s3") S.ritual = [];
    if (from === "box") S.seated = false;
    if (from === "sub" && S.listening) { S.listening = false; S.listenT = 0; }
    const a = lvOf(from), b = lvOf(to);
    if (a === b) return;
    const L = LVINFO[b];
    if (!S.seen["lv_" + b]) {
      S.seen["lv_" + b] = true;
      if (L.rank > 0) { fx("shock", 2); fx("flash"); }
      const t = LV_TRUISM[b];
      if (t) setTimeout(() => fx("truism", t[0], t[1], t[2]), 600);
      const enterSfx = { maze: "static", neon: "stinger", pale: "chime", pit: "clang", forest: "whisper", shrine: "chime", night: "chime", sea: "splash", lair: "whisper" }[b];
      if (enterSfx) sfx(enterSfx);
    } else if (L.rank > 0) fx("glitch");
    if (L.rank > (LOOP.deep || 0)) loopSet({ deep: L.rank, deepLabel: L.label });
  }
  function warp(to, lines) {
    for (const l of lines || []) say(l);
    gap();
    enter(to, true);
  }
  function arrive(to, from) {
    if (to === "cellar" && from === "living" && !S.seen.barred) {
      S.seen.barred = true; S.barred = true; S.trap = false;
      sfx("thud"); fx("shock", 1);
      say("頭の上で、跳ね上げ戸が勢いよく閉まった。……閂のかかる音。敷物を戻す音。", "warn");
      say("上には、誰もいなかったはずだ。", "note");
    }
    if (to === "living" && S.barred) {
      S.barred = false; S.trap = false;
      say("敷物の上に、古本の束が積まれていた。誰かが、跳ね上げ戸を上から押さえていたのだ。……束をどけた。どれも、同じ作者の本だった。", "note");
    }
    if (to === "f3") {
      S.beastAsked++;
      say(S.beastAsked === 1 ? "人影が、花を口に入れたまま、こちらを見ずに言う。" : "人影が、また言う。", "note");
      say("「お前は、俺のことを知っているのか」", "voice");
    }
    if (to === "box" && !S.seen.boxTalk) { S.seen.boxTalk = true; say("店員が、こちらを見ずに言う。「席を一つずらすと、景色が変わりますよ」", "voice"); }
    if (to === "pale1" && held("spray")) say("通りの誰かが、こちらの手の中の赤を見て、そっと目を逸らした。", "note");
    if (to === "sub" && !S.seen.subTalk) { S.seen.subTalk = true; say("空気の管の音。……このほかに、誰の気配もない。四人乗りの艇なのに。", "note"); }
  }
  function enterDoor(room) { sfx("door"); say("扉を開けて、中へ入る。"); gap(); enter(room); }
  function openDoor4() {
    if (!S.door4Open) {
      if (!held("key")) { say("鍵がかかっている。飾りのない鍵穴がある。"); return; }
      S.door4Open = true;
      sfx("clang");
      say("飾りのない鍵を差しこむ。……鍵が扉に合ったのではない。確かめないまま持ち歩いていた鍵に、扉のほうが合わせてきた。");
    }
    enterDoor("stair4");
  }
  function noEntry() {
    if (!S.ne) {
      S.ne = 1;
      sfx("door");
      say("扉を開ける。……向こう側には、床も壁も続いていない。白くもなく、黒くもない。作った者さえ入れない場所は、作られていなかった。");
      say("扉を閉めた。", "note");
      return;
    }
    S.ne = 0;
    fx("shock", 2); fx("glitch");
    warp(pick(MAZE), ["もう一度開けて、一歩、踏み出した。", "……床がない、ということは、落ちる、ということでもなかった。気がつくと、湿ったカーペットの上に立っていた。"]);
  }

  // ---- 灯り ----
  function lightCandle() {
    if (!near("candle")) { say("灯りになるものを、持っていない。"); return; }
    if (S.fuel <= 0) { say("芯が、もう尽きている。"); return; }
    if (S.lit) { say("もう点いている。"); return; }
    if (S.loc === "kitchen") { lightFromStove(); return; }
    if (!held("matches")) { say("火がない。マッチがあれば。"); return; }
    if (S.matches <= 0) { say("マッチ箱は、空っぽだ。"); return; }
    S.matches--;
    S.lit = true; S.darkT = 0;
    say("マッチを擦る。……蝋燭に、火が移った。" + (S.matches ? "" : "マッチは、これが最後だった。"));
  }
  function lightFromStove() {
    sfx("spark");
    if (near("candle") && S.fuel > 0 && !S.lit) { S.lit = true; S.darkT = 0; say("コンロのつまみを回す。青い炎。……蝋燭を近づけて、火を移した。コンロは消した。"); return; }
    say("コンロのつまみを回す。青い炎が出た。……すぐに消した。");
  }
  function douseCandle() {
    if (!near("candle")) { say("消すものがない。"); return; }
    if (!S.lit) { say("もう消えている。"); return; }
    S.lit = false;
    say("蝋燭を吹き消した。" + (lit() ? "" : "……真っ暗になった。"));
  }
  // 暗闇で三手。名前を消しにくる
  function erase(lines) {
    fx("blackout", 1800); fx("shock", 2); sfx("scratch");
    for (const l of lines || ["消しゴムが、あなたの名前のあった場所をこすっていく。……名前は、もともと書かれていなかった。それでも、こすられた。"]) say(l, "warn");
    const dropped = Object.values(O).filter(o => o.loc === "player" && o.id !== "candle");
    for (const o of dropped) { o.loc = S.loc; o.scenery = false; }
    S.lit = false; S.darkT = 0; S.listening = false; S.valves = []; S.sleptDark = false;
    loopSet({ erased: (LOOP.erased || 0) + 1 });
    gap();
    warp("garden", ["……草の匂い。", "庭に、横になっていた。日が、暮れかけている。" + (dropped.length ? "持っていたものは、どこかに置いてきてしまったらしい。" : "")]);
  }

  // ---- 回収人 ----
  function thiefTick() {
    const t = S.th;
    if (t.gone > 0) { t.gone--; if (t.gone === 0) t.loc = pick(THIEF_ROOMS.filter(r => r !== S.loc)); return; }
    if (t.loc !== S.loc && Math.random() < 0.4) {
      const ex = Object.values(exitsOf(t.loc)).filter(r => THIEF_ROOMS.includes(r));
      if (ex.length) t.loc = pick(ex);
      if (t.loc === S.loc) say("古本の匂いが、近づいてきた。手垢と、香水と、線香と、煙草。", "warn");
      return;
    }
    if (t.loc !== S.loc) return;
    if (candleHere() && Math.random() < 0.25) {
      say("蝋燭の光を向けると、背の高い誰かは、本の頁のように薄くなって、壁紙の継ぎ目に消えた。", "note");
      t.loc = "away"; t.gone = 4;
      return;
    }
    const cand = Object.values(O).filter(o => o.treasure && (o.loc === "player" || o.loc === S.loc));
    if (cand.length && Math.random() < 0.45) {
      const o = pick(cand);
      o.loc = "lair"; o.scenery = false;
      sfx("whisper"); fx("glitch");
      say(`背の高い誰かが、すっと手を伸ばした。……${o.name}が、なくなっている。棚に並ぶ前に買い取るように、持っていかれた。`, "warn");
      t.loc = "away"; t.gone = 5;
    } else if (Math.random() < 0.3) say("背の高い誰かが、こちらの持ち物を、値踏みするように眺めている。", "note");
  }
  function thiefGive() {
    const o = Object.values(O).find(x => x.loc === "player" && x.treasure);
    if (!o) { say("背の高い誰かは、何も受け取らない。こちらの持ち物には、値がつかないらしい。"); return; }
    o.loc = "lair";
    say(`${o.name}を差し出す。背の高い誰かは、店に並ぶ前の本を買うように、丁寧に受け取った。……代金は、払われなかった。`);
    S.th.loc = "away"; S.th.gone = 5;
  }

  // ---- 家の仕掛け ----
  function moveRug() {
    if (S.rugMoved) { say("もう、ずらしてある。"); return; }
    S.rugMoved = true;
    say("敷物を部屋の隅へずらす。……床に、跳ね上げ戸があった。");
  }
  const PIANO = [
    "シールの貼られた鍵を、人差し指で一つ沈める。家じゅうが、その一音で隙間なく埋まった。……同じ強さで、もう一度。返ってきたのは、別の音だった。",
    "鍵を一つ沈める。楽譜の玉は、音ではない。指をどこに置くかの印にすぎない。……指一本で、その人にしか出ない音が、勝手に出てしまう。",
    "鍵を一つ。一つの鍵が、二本、三本の弦を同時に打つ。鍵より、弦のほうが多い。響かせるためだけの部品が、その何倍もある。",
    "鍵を一つ。……音は鳴らなかった。鳴ったはずの音が、少し遅れて、地下のほうから聞こえた。",
  ];
  function playPiano() { sfx("chime"); say(PIANO[S.moves % PIANO.length]); }
  // 棚に収める。何の点数なのかは、どこにも書いていない
  function toCase(o) {
    if (O.case.closed) { say("ガラスの扉が閉まっている。"); return; }
    if (!o.treasure) { say(`${o.name}は、窪みのどれにも合わない。`); return; }
    o.loc = "case"; o.scenery = false;
    if (!S.inCase.includes(o.id)) S.inCase.push(o.id);
    sfx("chime"); fx("flash");
    say(`${o.name}を、窪みに収めた。……ぴたりと合った。`);
    if (S.inCase.length === 1) say("状態行の点数が、上がった。何の点数なのかは、どこにも書いていない。", "note");
    if (S.inCase.length >= TREASURES.length) {
      say("八つの窪みが、埋まった。残る一つは、人の形をしている。", "warn");
      fx("truism", "THERE IS ONE HOLLOW LEFT", "窪みが、一つ残っている", "収蔵品");
    }
  }

  // ---- 地下の仕掛け ----
  function toggleLever() {
    sfx("clang");
    if (S.power) {
      S.power = false;
      say("レバーを下げる。機器が、端から順に消えていく。……遠くで、蛍光灯のうなりが止んだ。");
      return;
    }
    S.power = true;
    fx("flicker", 3);
    say("レバーを上げる。機器が、端から順々に灯っていく。……壁の向こうの、ずっと遠くで、蛍光灯がいっせいにうなりはじめた。");
  }
  function pressColor(ja) {
    if (ja === "緑") {
      S.learn.green = true;
      fx("blackout", 900);
      say("緑のボタンだけ押すと、舞台は暗転した。……緑の灯りだけが、点かない。");
      return;
    }
    S.colors = S.colors || {};
    S.colors[ja] = true;
    say(`舞台が、${ja}に染まる。太鼓の白っぽい皮が、その色を映した。`);
    if (Object.keys(S.colors).length >= 3 && !S.learn.green) say("四色を順に呼んで点検する手順なのだろう。一色が欠けても、きっと誰も気づかない。", "note");
  }
  function r7Check(id, ja) {
    S.r7Wait = 0;
    if (S.r7.includes(id)) { say(`${ja}は、もう調べた。……いや、もう一度調べたほうがいい気がする。何もない。`); return; }
    S.r7.push(id);
    say(`こんな所にあるわけないけど、一応、見ておこう。……${ja}には、何もない。`);
    if (S.r7.length >= 5) {
      S.r7 = [];
      say("全部、調べ終えた。何もなかった。……最初の場所から、もう一度調べなければいけない気がする。", "warn");
      if (Math.random() < 0.5) haunt();
    }
  }
  function r7Wait() {
    S.r7Wait++;
    if (S.r7Wait === 1) { say("調べたい気持ちを、こらえる。……ベッドの下が、気になる。"); return; }
    if (O.pencase.closed) {
      O.pencase.closed = false;
      sfx("clang");
      say("……かたん、と音がして、机の上の筆箱が、ひとりでに開いた。中に、金色の甲虫が一匹。");
      return;
    }
    say("何も起きない。何も仕掛けられていない。……そのはずだ。");
  }
  function wearPhones() {
    if (S.loc !== "sub") { say("ここで聴くものは、何もない。"); return; }
    if (S.listening) { say("もう聴いている。"); return; }
    S.listening = true; S.listenT = 0;
    if (O.phones.loc !== "player") O.phones.loc = "sub";
    say("ヘッドホンを耳に当てる。聴く役になった。管を流れる空気の音の奥に、陸からの声が……聞こえない。");
  }
  function openValve(id) {
    if (S.valves.includes(id)) { say("もう開いている。"); return; }
    if (!S.valves.length && id === "vblue") {
      sfx("splash");
      erase(["青い弁を開ける。……順番が、違った。海が、球の中へ入ってくる。", "冷たい水が、計器の光を一つずつ消していく。"]);
      return;
    }
    S.valves.push(id);
    sfx("splash");
    if (S.valves.length === 1) { say("赤い弁を開ける。泡が、球の外へ流れていく。"); return; }
    fx("flash");
    say("青い弁を開ける。……球が、ゆっくり浮きはじめた。上の梯子のほうから、光が差す。");
  }
  function pushWall() {
    S.pushW = (S.pushW || 0) + 1;
    if (S.pushW < 3) { sfx("scratch"); say(S.pushW === 1 ? "壁紙を押す。少しだけ、たわんだ。" : "もっと強く押す。……指先が、壁紙の向こう側に、半分抜けた。"); return; }
    S.pushW = 0;
    fx("shock", 2); fx("glitch"); sfx("static");
    const dest = pick([...MAZE.filter(m => m !== S.loc), ...MAZE.filter(m => m !== S.loc), "lair", "r7", "corr2"]);
    warp(dest, ["体ごと、壁紙の向こうへすり抜けた。", "……どこかへ、出た。"]);
  }

  // ---- 箱 ----
  function sitBar(i) {
    if (S.loc !== "box") { say("座る。……何も変わらない。"); return; }
    if (i && S.drunk) {
      const dest = { 1: "pale1", 2: "pit1", 3: "f1", 4: "s1" }[i];
      if (!dest) { say("いちばん端の椅子に座る。……隣に誰もいないことが、よく分かるだけだった。"); return; }
      fx("glitch"); sfx("stinger");
      warp(dest, [`${"一二三四"[i - 1]}番目の椅子に、座りなおした。`, "席を一メートルずらしただけで、目の前の景色が、まるごと入れ替わる。"]);
      return;
    }
    S.seated = true;
    if (S.drunk) { say("カウンターに座る。……景色は、まだ変わらない。席を、一つずらしてみようか。"); return; }
    if (!S.glass) {
      S.glass = true; S.stir = 0;
      say((i ? `${"一二三四五"[i - 1]}番目の椅子に座る。` : "カウンターに座る。") + "店員が、何も訊かずにグラスを置いた。紫の花の酒が、氷のすきまを抜けて、底へ沈んでいく。");
      return;
    }
    say("座っている。目の前に、紫の酒のグラス。");
  }
  function stirGlass() {
    if (!S.glass || S.drunk) { say("混ぜるものがない。"); return; }
    if (S.stir >= 3) { say("もう、混ざりきっている。"); return; }
    S.stir++;
    say(S.stir < 3 ? "かき混ぜる。紫が、少しずつ上へ広がる。" : "三回かき混ぜると、グラス全体が、その色になった。");
  }
  function drinkGlass() {
    if (S.stir < 3) { say("飲もうとして、やめた。底だけが紫で、上は水のようだ。まだ、混ざりきっていない。"); return; }
    S.drunk = true; S.glass = false;
    O.bottle.loc = "box";
    fx("glitch"); sfx("chime");
    say("飲む。口に、香水をまいたような甘さ。……答えは頭のどこかで先に出ていて、意識が一歩遅れて届く。");
    say("立ち上がりかけた瞬間、線は曲がって、床は天井になった。……また、元に戻った。", "note");
    say("店員が、空いた瓶をカウンターの上に立てた。もう作られていない酒の、最後の一本だった。");
  }

  // ---- 淡い街 ----
  function feedSlot(o) {
    if (o.id !== "coin") { say(`投函口は、${o.name}を受け取らない。`); return; }
    o.loc = "gone";
    O.spray.loc = "pale2";
    sfx("clang");
    say("硬貨を投函口に入れる。……ガタン、と大きな音がして、取り出し口に、原色の赤のスプレー缶が落ちてきた。");
    say("表の通りで、何人かが、音のしたほうを振り向いた気がした。", "note");
  }
  function sprayPanels() {
    if (!held("spray")) { say("スプレー缶を持っていない。"); return; }
    if (S.loc !== "pale3") { say("ここで赤を出したら、街じゅうが振り向く。"); return; }
    if (S.panels) { say("赤は、もう戻っている。"); return; }
    S.panels = true;
    O.poly.loc = "pale3";
    sfx("static");
    say("褪せた八か所に、赤を吹きつける。外したパネルを見本と照らして、一か所ずつ、元の場所に戻す。");
    say("……雑音の奥から、声がした。");
    say("「帰ってきたんだね、兄さん」", "voice");
    say("「兄さんが見ている世界を、一度、見てみたかったんだ」", "voice");
    say("あなたは、兄さんではない。声は、それに気づかないまま、話しつづける。", "note");
    say("台座の上に、いつのまにか、色付きの多面体が載っていた。");
  }
  function sodiumLamp() {
    fx("flicker", 1);
    if (S.panels && !S.voiceGone) {
      S.voiceGone = true;
      say("ナトリウム灯を点ける。部屋じゅうが、橙一色になった。……声が、消えた。色の戻った赤のところだけが、変に光っている。");
      say("灯りを消しても、声は、もう戻ってこなかった。", "note");
      return;
    }
    say("ナトリウム灯を点ける。部屋じゅうが、橙一色になった。" + (S.panels ? "赤のところだけが、変に光る。" : "褪せた赤のところだけが、変に光る。") + "……消した。");
  }

  // ---- ごみの穴 ----
  function craneGrab() {
    sfx("clang");
    if (S.pitT % 3 === 2 && !S.goldTaken) {
      S.goldTaken = true;
      O.gold.loc = "tray";
      fx("flash");
      say("レバーを引く。爪が、金の屏風を掴んだ。……持ち上げた拍子に、角が千切れて、窓の下の受け皿に落ちてきた。屏風の残りは、また茶色の中へ沈んでいく。");
      return;
    }
    say("レバーを引く。爪が茶色のごみを掴んで、別の場所に落とした。何も、変わらない。" + (S.goldTaken ? "" : "……金色の粉が舞うときを、待てばいいのかもしれない。"));
  }
  function toSafe(o) {
    if (S.safeOpen) { say("金庫は、もう開いている。"); return; }
    if (o.id !== "butterfly" && o.id !== "moon") { say(`${o.name}は、枠に合わない。`); return; }
    o.loc = "gone";
    S.safe.push(o.id);
    sfx("clang");
    if (S.safe.length < 2) { say(`${o.name}を、枠に嵌めこんだ。もう一つの枠が、空いている。`); return; }
    S.safeOpen = true; O.bsafe.closed = false;
    fx("flash");
    say(`${o.name}を、もう一つの枠に嵌めこんだ。蝶の背景の方眼と、三日月の背景の方眼が、一本の鍵の溝になる。……金庫の扉が開いた。`);
    say("扉の裏に、小さな字で：「来世へ送れるのは、金庫ひとつ分だけ」", "note");
  }

  // ---- 札の森 ----
  const BURN_SCENES = ["……騒がしい宴席の個室で、誰かが笑いながら言った場面。", "……夜の台所で、皿を洗う背中に向けて言われた場面。", "……改札の前で、振り向きもせずに言われた場面。",
    "……会議室のいちばん後ろの席で、聞こえるように言われた場面。", "……電話の向こうで、言ったあとに沈黙が続いた場面。", "……言った本人が、もう覚えていない場面。"];
  function burnTag(heavy) {
    if (!candleHere()) { say("火がない。"); return; }
    if (heavy && S.path) { say("もう、燃やす札は残っていない。"); return; }
    S.fuel = Math.max(1, S.fuel - (heavy ? 15 : 10));
    fx("flicker", 1);
    say((heavy ? "重い札を一枚、" : "札を一枚、") + "蝋燭の炎にかざす。煙が立ち、灰になる寸前に、その言葉が口にされた場面が、一瞬だけ浮かんだ。");
    say(pick(TAG_WORDS), "voice");
    say(pick(BURN_SCENES), "note");
    if (heavy) {
      S.burned++;
      say("指先が熱い。炎が、ずいぶん短くなった。", "note");
      if (S.burned >= 3 && !S.path) {
        S.path = true;
        fx("flash");
        say("いちばん重い札が燃え落ちた。垂れていた枝が、ゆっくり持ち上がる。……北へ、細い山道が開いた。");
      }
    }
  }

  // ---- 参道と吊り橋 ----
  function ritual(kind) {
    if (S.loc !== "s3") { say(kind === "礼" ? "礼をする。誰も見ていない。" : "手を叩く。音は、どこにも届かない。"); return; }
    S.ritual.push(kind);
    if (S.ritual.length > 4) S.ritual = S.ritual.slice(-4);
    sfx(kind === "拍" ? "knock" : "step");
    say(kind === "礼" ? "礼をする。" : "手を叩く。手が震えて、薄い音しか出ない。");
    if (S.ritual.join("") === "礼拍拍礼") { S.ritualOk = true; say("礼をひとつ、拍手をふたつ、礼をひとつ。……本殿の奥の暗がりが、こちらを向いた気がした。", "note"); }
  }
  function checkPolaris() {
    const first = !S.polaris;
    S.polaris = true;
    if (first) { sfx("chime"); setTimeout(() => fx("truism", "THE STILL STAR IS STILL THERE", "動かない星は、まだそこにある", "北の空"), 400); }
    return "山の向こうの北の空に、弱々しいけれど、動かない星が一つ。……まだ、ちゃんと同じところにいた。\n確かめるのは、それだけでいい。満天の星には、目もくれずに帰る人もいる。\n何万年か経てば、北を示す星は、別の星に代わるのだという。";
  }
  function trainWait() {
    S.trainWait++;
    if (S.trainWait === 1) { say("待つ。時刻表は、白く光ったまま。"); return; }
    if (S.trainWait === 2) { say("遠くで、錆びたレールの鳴る音。"); return; }
    S.trainWait = 0;
    sfx("bell");
    warp("gate", ["誰も乗っていない電車が、ホームに入ってきた。扉が開く。……乗る。", "電車は、どの駅にも止まらない。窓の外を、黄色い部屋と、淡い街と、茶色の穴と、群青の森が流れていく。",
      "扉が開くと、家の前の小道だった。電車は、もうどこにもない。"]);
  }

  // ---- 結末 ----
  function finish(id) {
    S.done = true;
    reach(id);
    gap();
    say("【" + ENDINGS[id] + "】", "win");
    say("結末 " + (LOOP.endings || []).length + " / " + Object.keys(ENDINGS).length + "。どれが正解なのかは、どこにも書いていない。", "note");
    say("いちばん下の「はじめから」で、最初から。", "note");
    setTimeout(() => fx("truism", "SEE YOU TOMORROW", "では、また明日", ENDINGS[id]), 900);
  }
  function endShuzo() {
    fx("flash"); sfx("glass");
    say("人の形の窪みを見る。ちょうど、膝を抱えて座った大人ほどの大きさ。");
    say("棚に入る。窪みは、あなたの形をしていた。……背中で、ガラスの扉が閉まる。");
    say("真鍮の札の「収蔵品」の下に、九つ目の名前は書かれない。");
    say("しばらくして、門の前で、誰かがインターホンを押した。何も鳴らなかった。");
    say("鏡写しの居間の棚では、膝を抱えた誰かが、こちらに背を向けている。……向こうの誰かも、きっと同じだ。", "note");
    finish("shuzo");
  }
  function endNidone() {
    fx("blackout", 2400);
    say("……もう一度、目を閉じる。");
    say("夜明けの観測の記録の、最後の行。「二度寝」。");
    say("その下に、三度目の行は、書かれなかった。目を覚ます者がいなければ、夜明けを記録する者もいない。");
    finish("nidone");
  }
  function endToban() {
    sfx("hum");
    say("ヘッドホンの奥で、空気が流れる。聴く番の者は、目を閉じてはいけない。ほかの者を起こすのは、聴く番の仕事だ。");
    say("……ほかの者は、いない。交代の時刻が過ぎても、誰も起きてこない。");
    say("記録帳の何日も先まで、「異常なし」と書かれている。よく見ると、その字は、あなたの字だった。");
    finish("toban");
  }
  function endFujo() {
    fx("flash"); sfx("splash");
    say("梯子を上る。蓋を押し開けると、潮の匂いと、白い空。");
    say("艇は、沿岸の海に浮かんでいた。陸から伸びる電線の先に、小さな基地がある。");
    say("……陸には、誰もいなかった。");
    say("送り先の誰もいないところへ、一時間ごとに定時の信号を送る。その理由だけが、残った。");
    finish("fujo");
  }
  function endKemono() {
    fx("shock", 2); sfx("whisper");
    say("「知っている」と答えた。");
    say("人影が、花を噛むのをやめた。「なら、本当の名前を呼べるか」", "voice");
    say("……呼べない。名前は、どこにも書かれていなかった。");
    say("それでも、着物が波打った。地面に、すとんと着流しが落ちる。中から一匹、森へ走っていく。");
    say("走っているのが自分だと気づいたときには、もう、人の言葉を思い出せなかった。");
    finish("kemono");
  }

  // ---- 「わからない」と言ったときの、小さな答え ----
  function hintText() {
    if (!lit()) return "灯りがなければ、消される。蝋燭を点けるか、明るい所へ。";
    const l = S.loc;
    if (l === "gate" || l === "garden" || l === "back") return O.intercom.closed ? "門のインターホンは、蓋が外れる。家には、窓から。" : "家には、裏の窓から。";
    if (l === "kitchen") return "灯りは、名前のない蝋燭。火は、コンロにも、マッチにもある。";
    if (l === "living") return !S.rugMoved ? "敷物の真ん中が、盛り上がっている。" : S.inCase.length >= TREASURES.length ? "人の形の窪みが、空いている。" : "棚の窪みは、何を待っているのだろう。";
    if (l === "attic") return "箱の底に、絵が一枚。";
    if (l === "cellar") return "東は黄色い部屋。北は番号。南は、呼び鈴を押した者だけの近道。上は、上から開けるもの。";
    if (l === "corr1" || l === "corr2") {
      if (!S.door4) return S.learn.four ? "抜けている番号を、口にしてみる。" : "数えれば、四つ目の扉には「5」と書いてある。";
      if (!S.door4Open && !held("key")) return "4の扉の鍵は、確かめないまま持ち歩く鍵。黄色い部屋の、行き止まりに。";
      return "10の先は、作られていない。";
    }
    if (l === "r1") return S.power ? "黄色い部屋に、灯りが来ている。" : "レバーを上げれば、黄色い部屋に灯りが来る。";
    if (l === "r2" || l === "r2b") return S.backstage ? "楽屋の鏡の前。" : "点かない色を、言い当てる。";
    if (l === "r3") return "上の棚と、同じ数だけ並ぶ。壁の絵は、持っていける。";
    if (l === "r5") return "出席簿を読む。";
    if (l === "r6") return S.learn.kime ? "1+1が2なのは、何だと書いてあった？" : "ノートの欄外を読む。";
    if (l === "r7") return "調べるのを、やめてみる。";
    if (l === "r8") return "ガラス板を抜けば、魚がこちらを向く。それだけだ。";
    if (MAZE.includes(l)) return "どの部屋も同じ。物を置いて、しるしにする。壁は、押せばたわむ。床の継ぎ目にも、気をつける。";
    if (l === "lair") return "持っていかれたものは、ここにある。";
    if (l === "box") return !S.drunk ? "座れば、出てくる。三回かき混ぜてから。" : "席を一つずらすと、景色が入れ替わる。一番目から四番目まで。";
    if (lvOf(l) === "pale") return !held("spray") && !S.panels ? "投函口に、代金を。小さな硬貨は、黄色い部屋に。" : !S.panels ? "褪せた赤に、赤を。" : "台座の上。";
    if (l === "pit1") return S.goldTaken ? "東の倉庫。" : "金色の粉が舞っているときに、レバーを。";
    if (l === "pit2") return S.safeOpen ? "金庫の中。" : "割符の絵は二枚。一枚は屋根裏の箱、一枚は鏡の向こうの壁。";
    if (l === "f1" || l === "f2") return S.path ? "北へ。" : "重い札を、炎で。三枚。";
    if (l === "f3") return "訊かれたことに、答えてもいい。答えなくてもいい。";
    if (lvOf(l) === "shrine") return S.reported ? "北へ。" : "立て札のとおりに。願わずに、報告する。";
    if (l === "n1" || l === "n2") return S.polaris ? "北の端の駅。" : "北の空を見る。";
    if (l === "n3") return "待つ。来る時刻は、ばらばら。";
    if (l === "sub" || l === "stair4") return "当番表と記録帳を読む。弁は、赤が先。聴く役は、眠らない。";
    if (l === "next") return "上へ。近道は、呼び鈴のあとで。";
    return "誰も、答えない。";
  }
  function hint() {
    if (held("candle") && S.lit && S.fuel > 5) { S.fuel -= 5; say("どこかで、誰かが小さく答える。答えるたびに、炎が少し短くなる。", "note"); }
    else say("どこかで、誰かが小さく答える。", "note");
    say(hintText(), "voice");
  }

  // ---- ことば ----
  const WORDS = [
    { id: "four", ja: "4", alt: ["四", "よん", "4番", "四番", "４"], en: "4", show: "4", when: () => S.learn.four || S.door4 },
    { id: "green", ja: "緑", alt: ["みどり", "緑の光", "緑色", "緑が灯らない"], en: "green", when: () => S.learn.green },
    { id: "kime", ja: "決めごと", alt: ["決め事", "きめごと", "決めごとにすぎない", "決まりごと"], en: "convention", when: () => S.learn.kime },
    { id: "report", ja: "報告します", alt: ["報告", "ほうこく", "報告する"], en: "report", when: () => S.learn.report || lvOf(S.loc) === "shrine" },
    { id: "wish", ja: "お願いします", alt: ["お願い", "願い", "おねがい", "願います"], en: "wish", when: () => S.learn.report || lvOf(S.loc) === "shrine" },
    { id: "know", ja: "知っている", alt: ["知ってる", "しっている", "知っています"], en: "i know you", when: () => S.beastAsked > 0 },
    { id: "dunknow", ja: "知らない", alt: ["しらない", "知りません", "知らん"], en: "i do not know you", when: () => S.beastAsked > 0 },
    { id: "allclear", ja: "異常なし", alt: ["いじょうなし"], en: "all clear", when: () => !!S.seen.sub },
    { id: "goodnight", ja: "おやすみ", alt: ["おやすみなさい"], en: "good night", when: () => true },
    { id: "sleepnow", ja: "寝ろ", alt: ["ねろ"], en: "sleep now", when: () => true },
    { id: "sesame", ja: "ひらけ、ごま", alt: ["ひらけごま", "開けゴマ", "開けごま"], en: "open sesame", when: () => true },
  ];
  const W = id => WORDS.find(w => w.id === id);
  function sayWord(w) {
    if (!w) { say("そのことばは、ここでは誰にも届かない。"); return; }
    say(`「${w.show || w.ja}」`, "voice");
    switch (w.id) {
      case "four":
        if (S.loc === "corr1" || S.loc === "corr2") {
          if (S.door4) { say("「4」の扉は、もうそこにある。"); return; }
          S.door4 = true; S.learn.four = true;
          sfx("door"); fx("glitch");
          say("……3と5の扉のあいだの壁に、さっきまでなかった「4」の扉が現れた。" + (S.loc === "corr2" ? "廊下の手前のほうだ。" : ""));
          return;
        }
        say("四、と口にした。何も起きない。……四番目は、どこにいても四番目だ。"); return;
      case "green":
        if (S.loc !== "r2") { say("緑、と口にしても、何も起きない。"); return; }
        if (S.backstage) { say("太鼓の皮は、もう緑に光っている。"); return; }
        S.backstage = true;
        sfx("door"); fx("flash");
        say("「今夜は、緑だけ灯らなかったな」……そう口にした途端、窓の向こうの太鼓の皮が、ないはずの緑に、うっすら光った。");
        say("舞台袖の東で、扉の開く音がした。", "note");
        return;
      case "kime":
        if (S.loc !== "r6") { say("決めごとだ、と言った。誰も、反論しない。"); return; }
        if (S.r6Free) { say("扉は、もう開いている。"); return; }
        S.r6Free = true;
        sfx("door");
        say("「1+1が2なのは、決めごとだ」と言った。……半透明の扉が、音もなく開いた。反例は、見つからないままだ。");
        return;
      case "report":
        if (S.loc !== "s3") { say("報告したいことなら、山ほどある。でも、ここではない。"); return; }
        if (S.reported) { say("もう報告した。……報告することは、また溜まりはじめている。"); return; }
        if (!S.ritualOk) { say("報告の前に、作法があったはずだ。立て札に、書いてあった。"); return; }
        S.reported = true;
        O.planis.loc = "s3";
        fx("flash"); sfx("chime");
        say("願いごとではなく、報告をする。門のこと。窓のこと。黄色い部屋のこと。蝋燭が、少しずつ短くなっていること。");
        say("……頭を上げたとき、何かと目が合った。そこにいたのは、ありとあらゆる顔つきの、自分だった。");
        say("賽銭箱の上に、紙の星座盤が一枚、置かれていた。本殿の脇に、北へ続く細い道が見える。");
        say("やっぱり怖いな、ここは。", "note");
        return;
      case "wish":
        if (lvOf(S.loc) !== "shrine") { say("願いを口にした。……どこにも届かない。"); return; }
        S.wished++;
        fx("shock", 1);
        warp("s1", ["願いを口にしかけた。……胸の重さが、背中を押し返す。願いごとをしに来たのではない。", "気がつくと、参道の入口に立っていた。汗が、額から落ちる。"]);
        return;
      case "know":
        if (S.loc !== "f3") { say("誰に向かって言ったのか、自分でも分からない。"); return; }
        endKemono(); return;
      case "dunknow":
        if (S.loc !== "f3") { say("誰のことも、知らない。"); return; }
        say("「そうか」人影は、また花を一つ摘む。……「昔、火の中から逃げてきたな」", "voice");
        say("「年をとらない、とずいぶん噂されたろう」", "voice");
        return;
      case "allclear":
        if (S.loc === "sub") { sfx("beep"); say("「異常なし」と打電した。……送り先には、もう誰もいない。それでも、一時間後に、また打たなければならない。"); return; }
        say("異常なし、と言った。……本当に？", "note"); return;
      case "goodnight":
        say("自分に向かって言った。心と体が、眠る支度を始める。……誰か別の人に言おうとすると、喉につかえて出てこない。"); return;
      case "sleepnow":
        say("どこかで、大きな犬が、言われたとおりに眠った気がする。"); return;
      case "sesame":
        say("手がかりがまったくないとき、扉は、決まり文句で開くことがある。……ここは、そうではなかった。"); return;
    }
  }
  function wordsHere() { return WORDS.filter(w => w.when()); }

  // ---- 動詞 ----
  function need(o, label) {
    if (!o) { say(`何を${label}？`); return false; }
    if (o.missing) { say(lit() ? `ここに「${o.missing}」は見当たらない。` : "暗くて、何も見えない。"); return false; }
    return true;
  }
  const hand = (o, v, b) => o && o.on && typeof o.on[v] === "function" && o.on[v](b) !== false;
  const ROOM_LISTEN = {
    gate: "インターホンの中で、蟻の足音……は、聞こえるはずがない。遠くで、カラスが四声、間をおいて、また四声。",
    garden: "鳴く主が、また入れ替わった。今は小鳥の交信。……雀は、誰もいないときにしか来ない。",
    back: "台所の窓の中から、ガスの匂いのような、気配。",
    kitchen: "冷蔵庫はない。なのに、低いうなりがする。",
    living: "ピアノの弦が、勝手に、かすかに鳴っている。押されていない鍵の音。",
    attic: "梁の上を、何かが走る。かじる音。",
    cellar: "東の壁紙の向こうから、蛍光灯のうなり。上の居間を、誰かが歩いている。",
    corr1: "非常灯のうなり。どの扉の向こうも、静かだ。3と5のあいだの壁の中だけ、少しだけ、空洞の音がする。",
    corr2: "非常灯のうなり。10の扉の向こうからは、何の音もしない。音がしない、という音もしない。",
    r1: () => S.power ? "機械が、端から順に唸っている。保存枠のない音。" : "何も聞こえない。",
    r2: "舞台から、客の咳。……客席には、誰もいないのに。",
    r2b: "楽屋の隅で、誰かが小さな声で「ありがとう」と言った。肩を叩かれたあとの、照れた声。",
    r3: "上の居間と、同じ音。左右だけが、逆に聞こえる。",
    r5: "どこかで、番号が読み上げられている。一、二、三、五、六……。",
    r6: "鉛筆が、ノートの上を往復する音。誰も、書いていないのに。",
    r7: "「まさかね」と、誰かが言う声。何度も。",
    r8: "水の音。ガラスに、ひれの当たる音。",
    stair4: "下のほうから、空気の管を流れる音。",
    sub: () => S.listening ? "陸からの声は、ない。空気の音だけ。……聴く番は、目を閉じてはいけない。" : "管を流れる空気の音。それだけ。",
    next: "壁に耳を当てても、何も聞こえない。……壁の向こうでも、誰かが、こちらに耳を当てている気がする。",
    lair: "頁をめくる音。誰もいないのに。",
    box: "規則のある音。意味は、つかめない。",
    pit1: "クレーンの唸り。爪が、ごみの中で閉じる音。",
    pit2: "点滅する金庫の、小さな電子音。",
    f1: "札が風に揺れて、紙のこすれる音。言葉の聞こえない、ひそひそ声のような。",
    f2: "重い札が、枝ごと軋む音。",
    f3: "花を噛む音。",
    s1: "蝉。", s2: "蝉。……少し、遠くなった。", s3: "蝉が、止んでいる。自分の心臓の音。",
    n1: "エンジンの音のしない光が、通りすぎる。",
    n2: "川の音と、谷の風。それだけ。",
    n3: "遠くで、レールが鳴った気がした。",
  };
  const ROOM_WAIT = {
    gate: () => {
      S.gateWait++;
      if (S.gateWait >= 3 && !S.eggsGone) {
        S.eggsGone = true;
        say("二十分ほど、よそを向いていた。" + (O.intercom.closed ? "" : "……インターホンの中の卵が、一つもなくなっている。おがくずの壁だけが、残った枠。"));
        return;
      }
      say("門の外の道を、誰も通らない。日が、暮れかけたまま。");
    },
    garden: () => say("待つ。雀は、誰もいないときにしか来ない。……こちらがいるかぎり、来ない。"),
    r7: () => r7Wait(),
    n3: () => trainWait(),
    sub: () => {
      if (!S.listening) { say("空気の管の音。誰も、交代に来ない。"); return; }
      S.listenT++;
      if (S.listenT >= 3) { endToban(); return; }
      say(S.listenT === 1 ? "聴く。陸からは、何も来ない。" : "聴く。……交代の時刻を、少し過ぎた。");
    },
    f3: () => say("人影は、花を一つずつ口に入れる。散った桜を踏む音。"),
    box: () => say("光が、赤・緑・青をくり返す。何度くり返しても、意味がつかめない。"),
    pale1: () => say("人々が、音を立てずに通りすぎる。誰も、こちらを見ない。"),
    s3: () => say("蝉は、鳴かない。"),
    pit1: () => say("待つ。" + (S.pitT % 3 === 2 ? "窓の下で、金色の粉が舞っている。" : "茶色の穴を、爪が行ったり来たりする。")),
  };
  const VERB_DO = {
    look: () => describe(true),
    inventory: () => {
      const h = Object.values(O).filter(o => o.loc === "player");
      if (!h.length) { say("何も持っていない。"); return; }
      say("持ち物：");
      for (const o of h) say(o.name + (o.id === "candle" ? (S.fuel <= 0 ? "（尽きた）" : S.lit ? "（灯 " + S.fuel + "）" : "（消えている）") : ""), "indent");
    },
    wait: () => {
      if (ROOM_WAIT[S.loc]) { ROOM_WAIT[S.loc](); return; }
      if (!lit()) { say("暗闇で、じっとする。"); return; }
      if (MAZE.includes(S.loc)) { say("蛍光灯の" + (S.power ? "うなり" : "沈黙") + "。……どこかの部屋で、誰かが紙をめくる音。"); return; }
      say("時間が過ぎる。" + (lvOf(S.loc) === "dusk" ? "日は、暮れかけたままだ。" : ""));
    },
    listen: () => {
      if (!lit()) { say("暗闇の奥で、紙をめくる音。消しゴムが、何かをこする音。"); return; }
      if (MAZE.includes(S.loc)) { say((S.power ? "蛍光灯のうなり。" : "何も聞こえない。") + (S.loc === "m6" ? "東の壁の向こうから、規則のある音楽。" : "") + (S.th.loc === S.loc ? "……すぐそばで、古本をめくる音。" : "")); return; }
      say(text(ROOM_LISTEN[S.loc]) || "何も聞こえない。");
    },
    help: () => say("遊び方：方角のボタンで移動し、「上」「下」で上下に動く。「命令を作る」で、動詞 → 物（「言う」なら、ことば）の順にタップする。入力欄に、日本語や短い英語で書いてもいい。「わからない」と言うと、どこかで誰かが小さく答える。", "note"),
    hint: () => hint(),
    dunno: () => { say("「わからない」", "voice"); hint(); },
    xyzzy: () => say("空っぽの声が言う。「ばか」"),
    sleep: () => {
      if (!lit()) {
        if (S.sleptDark) { endNidone(); return; }
        S.sleptDark = true;
        say("暗闇で、目を閉じる。暗闇は、目を閉じているより暗い。……遠くで、鳴く主が、何分かごとに入れ替わる。");
        say("記録の行が、一つ増えた。「二度寝」とは、まだ書かれていない。", "note");
        return;
      }
      if (S.loc === "sub") { say("寝床に横になりかけて、やめた。休む番ではない。……起こすのは、聴く番の仕事だ。誰が、聴く番なのだろう。"); return; }
      if (lvOf(S.loc) === "dusk") { say("草の上に横になる。……眠れない。日が、暮れかけたままだ。"); return; }
      say("ここでは、眠れない。灯りがあるうちは、眠れない。");
    },
    run: () => {
      if (MAZE.includes(S.loc)) { say("走る。どの部屋も同じなので、どこまで走ったのか、分からない。"); return; }
      if (lvOf(S.loc) === "pale") { fx("glitch"); say("走ると、通りじゅうの人が、いっせいにこちらを向いた。……足音は、ここでは、赤と同じくらい目立つ。歩く速さに戻した。"); return; }
      if (lvOf(S.loc) === "shrine") { say("走ると、汗がもっと落ちる。参道は、少しも短くならない。"); return; }
      if (S.loc === "box") { say("走るほどの広さがない。"); return; }
      say("走る理由が、見つからない。");
    },
    lookback: () => {
      if (S.th.loc === S.loc) { say("振り向く。背の高い誰かが、すぐ後ろにいた。顔は、頁のように薄くて読めない。", "warn"); return; }
      if (MAZE.includes(S.loc)) { say("振り向く。来た部屋と、同じ部屋がある。"); return; }
      say("振り向く。誰もいない。……振り向く前は、いた気がする。");
    },
    bow: () => ritual("礼"),
    clap: () => ritual("拍"),
    examine: o => {
      if (!need(o, "調べる")) return;
      if (hand(o, "examine")) return;
      say(text(o.desc) || `${o.name}に、特に変わったところはない。`);
    },
    read: o => {
      if (!need(o, "読む")) return;
      if (hand(o, "read")) return;
      if (!o.read) { VERB_DO.examine(o); return; }
      say(text(o.read));
    },
    take: o => {
      if (!need(o, "取る")) return;
      if (o.loc === "player") { say("もう持っている。"); return; }
      if (hand(o, "take")) return;
      if (!o.take) { say(`${o.name}は取れない。`); return; }
      if (o.loc === "case") {
        if (O.case.closed) { say("ガラスの扉が閉まっている。"); return; }
        S.inCase = S.inCase.filter(x => x !== o.id);
        say("窪みから取り出すと、点数が下がった。", "note");
      }
      o.loc = "player"; o.scenery = false;
      say(`${o.name}を取った。`);
      if (o.id === "idol") { sfx("chime"); say("手に取ると、神像が光った。「この世のいいことも悪いことも、全部の意味を、よく噛みしめなさい」……少し間をおいて、同じことを、もう一度。届かなかったと思ったのだろう。", "voice"); }
      if (o.id === "beetle") say("金色の甲虫は、手の中で動かない。……一匹見つけると、増える種類の虫だ。", "note");
      if (o.id === "ring") say("来世へ送れるのは、金庫ひとつ分だけ。……その一つを、こんなふうに持ち出していいのだろうか。", "note");
      if (o.id === "tsubaki" && S.loc === "f3") say("人影が、こちらの手の中の椿を見て、少し笑った。", "note");
      const takeSfx = { coin: "clang", key: "clang", gold: "glass", spray: "clang", bottle: "glass", pane: "glass" }[o.id];
      if (takeSfx) sfx(takeSfx);
    },
    drop: o => {
      if (!need(o, "置く")) return;
      if (o.loc !== "player") { say(`${o.name}は持っていない。`); return; }
      if (hand(o, "drop")) return;
      o.loc = S.loc; o.scenery = false;
      say(`${o.name}を置いた。`);
      if (MAZE.includes(S.loc)) say("……これで、この部屋を見分けられる。回収人に持っていかれなければ。", "note");
    },
    put: (o, w) => {
      if (!need(o, "入れる")) return;
      if (w && w.missing) { need(w, ""); return; }
      if (o.id === "spray" && (!w || w.id === "panels")) { sprayPanels(); return; }
      if (o.id === "candle" && w && w.id === "stove") { lightFromStove(); return; }
      if (o.id === "key" && w && w.id === "d4") { openDoor4(); return; }
      if (o.loc !== "player") { say(`${o.name}を持っていない。`); return; }
      if (!w) {
        if (S.loc === "living" && o.treasure) { toCase(o); return; }
        if (S.loc === "pale2") { feedSlot(o); return; }
        if (S.loc === "pit2") { toSafe(o); return; }
        say("どこに入れる？"); return;
      }
      if (w.id === "case") { toCase(o); return; }
      if (w.id === "slot") { feedSlot(o); return; }
      if (w.id === "bsafe" || w.id === "safes") { toSafe(o); return; }
      if (w.id === "mcase") { say("鏡の棚の扉は、内側から閉ざされている。"); return; }
      if (w.container && !w.closed) { o.loc = w.id; say(`${o.name}を、${w.name}に入れた。`); return; }
      say(`${o.name}は、${w.name}には入れられない。`);
    },
    give: (o, w) => {
      if (w && hand(w, "give", o)) return;
      if (o && hand(o, "give", w)) return;
      if (!o) { say("何をあげる？"); return; }
      if (o.missing) { need(o, ""); return; }
      say(w ? `${w.name}は、受け取らない。` : "誰にあげる？");
    },
    open: o => {
      if (!need(o, "開ける")) return;
      if (hand(o, "open")) return;
      if (!o.container) { say(`${o.name}は、開けるものではない。`); return; }
      if (!o.closed) { say("もう開いている。"); return; }
      o.closed = false;
      const inside = Object.values(O).filter(x => x.loc === o.id && !x.hideIn);
      say(`${o.name}を開けた。` + (inside.length ? `中に、${inside.map(x => x.name).join("、")}。` : "中は、空っぽだ。"));
    },
    close: o => {
      if (!need(o, "閉める")) return;
      if (hand(o, "close")) return;
      if (!o.container) { say("閉めるものではない。"); return; }
      if (o.closed) { say("もう閉まっている。"); return; }
      o.closed = true; say(`${o.name}を閉めた。`);
    },
    press: o => { if (!need(o, "押す")) return; if (hand(o, "press")) return; say(`${o.name}を押す。何も起きない。`); },
    pull: o => { if (!need(o, "引く")) return; if (hand(o, "pull")) return; say(`${o.name}を引く。何も起きない。`); },
    lighton: o => {
      if (!o || o.id === "candle" || o.id === "matches") { lightCandle(); return; }
      if (o.missing) { need(o, ""); return; }
      if (hand(o, "lighton")) return;
      say(`${o.name}は、点けるものではない。`);
    },
    lightoff: o => {
      if (!o || o.id === "candle") { douseCandle(); return; }
      if (o.missing) { need(o, ""); return; }
      if (hand(o, "lightoff")) return;
      say(`${o.name}は、消すものではない。`);
    },
    burn: o => {
      if (!need(o, "燃やす")) return;
      if (hand(o, "burn")) return;
      if (o.id === "letters") { say("燃やしても、落選は取り消されない。"); return; }
      say("燃やす理由が、見つからない。");
    },
    move: o => { if (!need(o, "どける")) return; if (hand(o, "move")) return; say(`${o.name}は、動かせない。`); },
    stir: o => { if (o && o.missing) { need(o, ""); return; } if (S.loc === "box") { stirGlass(); return; } say("混ぜるものがない。"); },
    drink: o => {
      if (!o && S.loc === "box" && S.glass) { drinkGlass(); return; }
      if (!need(o, "飲む")) return;
      if (hand(o, "drink")) return;
      say(`${o.name}は、飲めない。`);
    },
    eat: o => {
      if (!need(o, "食べる")) return;
      if (hand(o, "eat")) return;
      if (o.paper) { say("紙を、少しだけ噛んだ。……味がしない。染めた紙か、手書きの紙なら、味がしたのかもしれない。"); return; }
      say(`${o.name}は、食べられない。`);
    },
    wear: o => {
      if (!need(o, "身につける")) return;
      if (hand(o, "wear")) return;
      say(`${o.name}は、身につけるものではない。`);
    },
    play: o => { if (!o && S.loc === "living") { playPiano(); return; } if (!need(o, "弾く")) return; if (hand(o, "play")) return; say(`${o.name}は、弾けない。`); },
    listenTo: o => { if (!o) { VERB_DO.listen(); return; } if (o.missing) { need(o, ""); return; } if (hand(o, "listenTo")) return; VERB_DO.listen(); },
    sit: o => {
      if (o && o.missing) { need(o, ""); return; }
      if (o && hand(o, "sit")) return;
      if (S.loc === "box") { sitBar(null); return; }
      if (S.loc === "f3") { say("人影の隣に座る。人影は、椿を一つ、こちらに差し出しかけて、自分で食べた。"); return; }
      if (S.loc === "sub") { say("寝床に座る。休む番ではない。"); return; }
      say("座る。……何も変わらない。立ち上がる。");
    },
    write: () => say("名前を彫る場所に、何か書こうとした。……書くべき名前が、思い出せない。"),
    say: w => sayWord(w),
  };
  // 動詞に、物を渡す仕事をする物（ヘッドホンを「つける」と、身につける）
  function remap(v, a) {
    if (v === "lighton" && a && a.id === "phones") return "wear";
    if (v === "open" && a && a.id === "glass") return "drink";
    return v;
  }

  // ---- 一手ごとの空気 ----
  const META = ["hint", "help", "inventory", "look", "dunno", "xyzzy"];
  function world(v, before) {
    if (S.done || META.includes(v)) return;
    if (v !== "sleep") S.sleptDark = false;
    // 炎は、一手ごとに短くなる
    if (S.lit && near("candle") && S.fuel > 0) {
      S.fuel--;
      if (!S.early && S.fuel < 200 && S.fuel > 80 && Math.random() < 0.03) {
        S.early = true; S.fuel = Math.max(20, S.fuel - 40);
        say("どこからか、とぼけた声。「こちらの手違いで、少し前倒しになりました。ままあることです」", "voice");
        say("炎が、ひと息に短くなった。", "warn");
      }
      if (S.fuel === 40) say("炎が、小さくなってきた。", "warn");
      if (S.fuel === 10) say("炎が、芯の根元で震えている。", "warn");
      if (S.fuel <= 0) { S.fuel = 0; S.lit = false; fx("blackout", 900); say("蝋燭の芯が、尽きた。", "warn"); }
    }
    if (S.done) return;
    // 暗闇では、三手で消される
    if (!lit()) {
      if (v === "sleep") return;
      S.darkT++;
      if (S.darkT === 2) { sfx("scratch"); say("暗闇の奥で、紙をめくる音が、近づいてくる。", "warn"); }
      else if (S.darkT === 3) { sfx("scratch"); fx("glitch"); say("すぐそばで、消しゴムが紙をこする音。……自分の輪郭の、端のほうが薄い。", "warn"); }
      else if (S.darkT >= 4) { erase(); return; }
    } else S.darkT = 0;
    if (S.loc === "pit1" || S.loc === "pit2") {
      S.pitT++;
      if (S.loc === "pit1" && S.pitT % 3 === 2 && !S.goldTaken) say("窓の下で、金色の粉が舞いはじめた。", "note");
    }
    if (THIEF_ROOMS.includes(S.loc) || THIEF_ROOMS.includes(S.th.loc) || S.th.loc === "away") thiefTick();
    if (S.done) return;
    if (MAZE.includes(S.loc) && S.power && Math.random() < 0.1) { say("蛍光灯が、一本だけまたたいた。暗くなった一瞬、隣の部屋に、誰かが立っていた気がする。", "note"); fx("flicker", 2); }
    if (held("beetle") && S.moves % 23 === 0) say("ポケットの中で、甲虫が増えた気がする。数えると、一匹だ。", "note");
    if (["maze", "lair", "sea"].includes(lvOf(S.loc)) && Math.random() < 0.03) haunt();
    if (S.loc === "box" && Math.random() < 0.15) fx("glitch", false);
  }
  function act(input, label) {
    if (S.done) { say("ここで、終わっている。いちばん下の「はじめから」で、最初から。", "note"); return; }
    const ascii = /^[\x20-\x7e]*$/.test(input);
    const p = ascii ? parseEn(input) : parseJa(input);
    if (!p) { say("その言い方はわからない。「命令を作る」を使うと確実だ。"); return; }
    S.moves++;
    if (label && !META.includes(p.v)) { S.hist.push(label); if (S.hist.length > 30) S.hist.shift(); }
    const before = S.loc;
    if (p.v === "go") { go(p.dir); world("go", before); return; }
    if (p.v === "say") { VERB_DO.say(p.w); world("say", before); return; }
    let a = p.ao, b = p.bo;
    if (!p.raw) { a = p.a ? findObj(p.a) : null; b = p.b ? findObj(p.b) : null; }
    for (const x of [a, b]) if (x && x.missing) { say(lit() ? `ここに「${x.missing}」は見当たらない。` : "暗くて、何も見えない。"); world("look", before); return; }
    const v = remap(p.v, a);
    VERB_DO[v](a, b);
    world(v, before);
  }

  // ---- 命令を読む ----
  const EN_SIMPLE = [
    ["look", /^(look|l)$/], ["inventory", /^(inventory|i)$/], ["wait", /^(wait|z)$/], ["hint", /^hint$/], ["help", /^help$/],
    ["listen", /^listen$/], ["dunno", /^(dunno|i don'?t know)$/], ["sleep", /^sleep$/], ["run", /^run$/], ["sit", /^sit( down)?$/],
    ["lookback", /^look back$/], ["bow", /^bow$/], ["clap", /^clap( hands)?$/], ["xyzzy", /^(xyzzy|plugh)$/], ["stir", /^(stir|mix)$/],
    ["lighton", /^light$/], ["lightoff", /^(douse|blow out)$/], ["drink", /^drink$/], ["play", /^play$/],
  ];
  const DIR_WORDS = { n: "n", north: "n", s: "s", south: "s", e: "e", east: "e", w: "w", west: "w", u: "u", up: "u", d: "d", down: "d" };
  function findObj(s) {
    s = String(s || "").trim().toLowerCase().replace(/^the /, "");
    if (!s) return null;
    const vis = visible();
    for (const o of vis) if (o.aliases.some(a => a.toLowerCase() === s) || o.en === s) return o;
    for (const o of vis) if (o.aliases.some(a => a.length > 1 && s.includes(a.toLowerCase()))) return o;
    return { missing: s };
  }
  function findWord(s) {
    s = String(s || "").trim().toLowerCase().replace(/[、。！？!?\s「」]/g, "");
    return WORDS.find(w => w.en.replace(/\s/g, "") === s || w.ja.replace(/[、]/g, "").toLowerCase() === s || (w.alt || []).some(a => a.toLowerCase() === s)) || null;
  }
  function findWordIn(s) {
    let best = null, len = 0;
    for (const w of WORDS) for (const a of [w.ja, ...(w.alt || [])]) { const k = a.replace(/[、？]/g, ""); if (k && k.length > len && s.includes(k)) { best = w; len = k.length; } }
    return best;
  }
  function parseEn(cmd) {
    cmd = cmd.toLowerCase().replace(/\s+/g, " ").trim();
    for (const [v, rx] of EN_SIMPLE) if (rx.test(cmd)) return { v };
    const g = cmd.replace(/^go /, "");
    if (DIR_WORDS[g]) return { v: "go", dir: DIR_WORDS[g] };
    const sm = cmd.match(/^(?:say|answer|tell) (.+)$/);
    if (sm) return { v: "say", w: findWord(sm[1]) };
    if (/^\d+$/.test(cmd)) return { v: "say", w: findWord(cmd) };
    const pats = [
      ["give", /^(?:give|offer) (.+) to (.+)$/], ["put", /^(?:put|insert|place|drop) (.+) (?:in|into|on|onto|to) (.+)$/], ["put", /^(?:put|insert) (.+)$/],
      ["give", /^(?:give|offer) (.+)$/], ["eat", /^eat (.+)$/], ["drink", /^drink (.+)$/],
      ["open", /^(?:open|unlock|enter) (.+)$/], ["close", /^(?:close|shut) (.+)$/], ["lighton", /^(?:light|turn on|switch on) (.+)$/],
      ["lightoff", /^(?:douse|turn off|switch off|blow out|extinguish) (.+)$/], ["press", /^(?:press|push|touch|ring) (.+)$/], ["pull", /^pull (.+)$/],
      ["move", /^(?:move|lift|raise) (.+)$/], ["stir", /^(?:stir|mix) (.+)$/], ["burn", /^burn (.+)$/],
      ["play", /^play (.+)$/], ["wear", /^(?:wear|put on) (.+)$/], ["listenTo", /^listen (?:to )?(.+)$/],
      ["examine", /^(?:examine|x|look at|look in|search) (.+)$/], ["read", /^read (.+)$/],
      ["take", /^(?:take|get|pick up) (.+)$/], ["drop", /^drop (.+)$/], ["sit", /^sit (?:on|at) (.+)$/],
    ];
    for (const [v, rx] of pats) { const m = cmd.match(rx); if (m) return { v, a: m[1], b: m[2] }; }
    return null;
  }
  const JA_VERBS = [
    ["dunno", /わからな|分からな/],
    ["say", /と言う|って言う|と言って|と答え|を言う|と叫ぶ|と呟く|と口にする|と唱え|言う$/],
    ["write", /書く|書いて|書き|彫る|記入/],
    ["lookback", /振り向|振り返|ふりむ|ふりかえ|後ろを見/],
    ["sleep", /寝る|眠る|寝て|眠って|^ねる$|二度寝/], ["run", /走る|走って|駆け/],
    ["up", /上る|登る|上がる|のぼる/], ["down", /降りる|おりる|下りる|降りて/],
    ["bow", /礼を|礼する|^礼$|お辞儀|おじぎ/], ["clap", /拍手|手を叩|手をたた|柏手/],
    ["stir", /混ぜ|まぜ|かき混/], ["burn", /燃や|もやす|焼く|炙る|かざす/],
    ["move", /どけ|どかす|めくる|ずらす|動かす|持ち上げ/],
    ["give", /あげる|あげて|与え|渡す|渡して|差し出|払う/], ["eat", /食べる|食べて|食べ|食う|かじ|噛む/],
    ["play", /弾く|弾いて|演奏|鳴らす/], ["wear", /身につけ|かぶる|耳に当て|当てる|着ける|着る/],
    ["lighton", /点ける|つける|点灯|点けて|擦る|灯す|火を/], ["lightoff", /消す|消して|吹き消/],
    ["sit", /座る|すわる|座って|腰を下ろ|腰掛け/],
    ["drink", /飲む|飲んで|飲み|飲ん/], ["pull", /引く|引いて|引っ張|下げる|上げる/], ["press", /押す|押して|押した|押し|触れる|触る|鳴らす/],
    ["listenTo", /聞く|聴く|聞いて|耳をすま|耳を澄ま/], ["close", /閉める|閉じる|閉めて|しめる|戻す/],
    ["open", /開け|開く|入る|はいる|外す|抜ける/], ["put", /入れ|嵌め|はめ|差す|差し|挿す|吹きつけ|吹き付け|かける|乗せ|載せ|収め/],
    ["read", /読/], ["examine", /調べ|見る|眺め|見つめ|覗|確かめ/],
    ["take", /取|拾|持つ|抜き/], ["drop", /置/],
  ];
  const JA_DIRS = { "北": "n", "南": "s", "東": "e", "西": "w", "上": "u", "下": "d" };
  const OBJLESS = ["dunno", "sleep", "run", "lookback", "up", "down", "bow", "clap"];
  const SIMPLE = { "見る": "look", "周りを見る": "look", "見回す": "look", "持ち物": "inventory", "待つ": "wait", "ヒント": "hint", "遊び方": "help", "ヘルプ": "help",
    "耳をすます": "listen", "耳を澄ます": "listen", "聞く": "listen", "わからない": "dunno", "分からない": "dunno",
    "寝る": "sleep", "眠る": "sleep", "二度寝": "sleep", "二度寝する": "sleep", "走る": "run", "振り向く": "lookback", "振り返る": "lookback", "座る": "sit",
    "礼": "bow", "礼をする": "bow", "お辞儀する": "bow", "拍手": "clap", "拍手する": "clap", "手を叩く": "clap",
    "混ぜる": "stir", "かき混ぜる": "stir", "飲む": "drink", "弾く": "play", "点ける": "lighton", "火を点ける": "lighton", "マッチを擦る": "lighton", "消す": "lightoff",
    "じっとする": "wait", "動かない": "wait", "黙る": "wait", "聴く": "listen" };
  function parseJa(t) {
    const s = t.replace(/[\s　。！？!?、「」『』]/g, "");
    if (!s) return null;
    const dm = s.match(/^(北|南|東|西|上|下)(へ|に)?(行く|進む|いく|移動|行って|進んで|出る|降りる|おりる|登る|上がる|上る|る)?(ください)?$/);
    if (dm) return { v: "go", dir: JA_DIRS[dm[1]] };
    if (SIMPLE[s]) return { v: SIMPLE[s] };
    const exact = findWord(s);
    if (exact) return { v: "say", w: exact, raw: true };
    const vis = visible();
    const als = [];
    for (const o of vis) for (const a of o.aliases) if (a) als.push(a);
    als.sort((x, y) => y.length - x.length);
    let masked = s;
    for (const a of als) {
      let i = masked.indexOf(a);
      while (i >= 0) { masked = masked.slice(0, i) + "□".repeat(a.length) + masked.slice(i + a.length); i = masked.indexOf(a, i + a.length); }
    }
    let verb = null, vm = null;
    for (const [v, rx] of JA_VERBS) { const m = masked.match(rx); if (m) { verb = v; vm = m; break; } }
    if (!verb) return null;
    if (verb === "up") return { v: "go", dir: "u" };
    if (verb === "down") return { v: "go", dir: "d" };
    if (OBJLESS.includes(verb)) return { v: verb, raw: true };
    const objPart = s.slice(0, vm.index);
    if (verb === "say" || verb === "write") return { v: verb, w: findWordIn(objPart), raw: true };
    const edge = i => i === 0 || /[をのにでとへがは]/.test(objPart[i - 1]);
    const hits = [];
    for (const o of vis) {
      let best = -1, len = 0;
      for (const a of o.aliases) {
        let i = objPart.indexOf(a);
        while (i >= 0 && !edge(i)) i = objPart.indexOf(a, i + 1);
        if (i >= 0 && a.length > len) { best = i; len = a.length; }
      }
      if (best >= 0) hits.push({ o, i: best, end: best + len });
    }
    if (!hits.length && objPart && !["sit", "listenTo", "lighton", "lightoff", "stir", "drink", "play"].includes(verb)) {
      const m = objPart.match(/^(.+?)(を|に|へ|で|の|と)/);
      return { v: verb, ao: { missing: m ? m[1] : objPart }, bo: null, raw: true };
    }
    const uniq = hits.filter(h => !hits.some(k => k !== h && k.i <= h.i && k.end >= h.end && (k.end - k.i) > (h.end - h.i)));
    uniq.sort((x, y) => x.i - y.i);
    const after = h => objPart.slice(h.end, h.end + 1);
    const a = uniq.find(h => after(h) === "を") || uniq.find(h => after(h) === "の") || uniq[0];
    const b = uniq.find(h => h !== a);
    return { v: verb, ao: a ? a.o : null, bo: b ? b.o : null, raw: true };
  }

  function submit(label, en) {
    label = String(label || "").trim();
    const cmd = en || label;
    if (!cmd) return;
    if (rows.length > 400) { const d = rows.length - 300; rows = rows.slice(-300); turnStart = Math.max(0, turnStart - d); }
    turnStart = rows.length;
    gap();
    push({ t: "cmd", ja: label || cmd, en: en && en !== label ? en : "" });
    act(cmd, label || cmd);
    setStatus();
    writeSaved(snapshot());
  }

  const VERBS = [
    ["調べる", "examine %", "%を調べる"], ["読む", "read %", "%を読む"], ["取る", "take %", "%を取る"],
    ["置く", "drop %", "%を置く"], ["入れる", "put % in #", "%を#に入れる"], ["あげる", "give % to #", "%を#にあげる"],
    ["開ける", "open %", "%を開ける"], ["閉める", "close %", "%を閉める"], ["押す", "press %", "%を押す"],
    ["引く", "pull %", "%を引く"], ["点ける", "light %", "%を点ける"], ["消す", "douse %", "%を消す"],
    ["燃やす", "burn %", "%を燃やす"], ["どける", "move %", "%をどける"], ["混ぜる", "stir", "かき混ぜる"],
    ["飲む", "drink %", "%を飲む"], ["食べる", "eat %", "%を食べる"], ["身につける", "wear %", "%を身につける"],
    ["弾く", "play %", "%を弾く"], ["座る", "sit on %", "%に座る"], ["言う", "say %", "「%」と言う"],
    ["礼をする", "bow", "礼をする"], ["拍手する", "clap", "拍手する"], ["寝る", "sleep", "寝る"],
    ["走る", "run", "走る"], ["振り向く", "look back", "振り向く"],
  ];

  function intro() {
    say("未定稿", "title");
    gap();
    say("気がつくと、古い家の前に立っていた。");
    say("どうしてここに来たのか。どこへ行けばいいのか。どこにも、書かれていない。");
    if ((LOOP.runs || 0) > 1 || (LOOP.erased || 0) > 0) say("……前にも、同じ小道に立っていた気がする。", "note");
    gap();
    describe(true);
  }
  function start(fresh) {
    rows = [];
    LOOP = loadLoop();
    const saved = fresh ? null : loadSaved();
    if (saved && restore(saved)) {
      rows = (saved.log || []).slice();
      gap();
      say("（前回の続きから）", "note");
      turnStart = rows.length - 1;
    } else {
      newState();
      loopSet({ runs: (LOOP.runs || 0) + 1, n: (LOOP.n || 0) + 1 });
      turnStart = 0;
      intro();
      writeSaved(snapshot());
    }
    curLv = null; metaLoc = null;
    setStatus();
  }

  return {
    VERBS,
    start,
    submit,
    status,
    // 今の手で出た行（命令の行を含む）
    turn: () => rows.slice(turnStart),
    // 直前までの命令（古い順）。ときどき書き換わる
    pastCommands: n => rows.slice(0, turnStart).filter(r => r.t === "cmd").slice(-n).map(r => r.ja),
    meta: () => metaData,
    visible: () => visible().map(o => ({ id: o.id, name: o.name, en: o.en, held: o.loc === "player" })),
    wordsHere: () => wordsHere().map(w => ({ ja: w.ja, show: w.show || w.ja, en: w.en })),
  };
}
