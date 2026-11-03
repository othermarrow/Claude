// 「空欄_2」のゲーム本体。backrooms-pwa/games/kuuran2.html の中身から、画面（DOM）に触る部分を抜いたもの。
// tools/build-engine.js で作る。直接は直さない。
// 画面側は createGame(io) で作り、submit() で命令を送り、status() / turn() / visible() で描く。
// io: { loadState(), saveState(obj), loadLoop(), saveLoop(obj) }（どれも失敗してよい）

export function createGame(io) {
  const VERSION = 1;
  // 画面の演出（階層目録の FX）は、時計では使わない
  const fx = () => {};
  const sfx = () => {};
  function loadSaved() { try { return io.loadState(); } catch (e) { return null; } }
  function writeSaved(obj) { try { io.saveState(obj); } catch (e) { /* 残せなくても遊べる */ } }
  // 何回目か、前のあなたが何をしたかは、はじめからやり直しても残る
  function loadLoop() { try { return io.loadLoop() || { n: 0, echo: [] }; } catch (e) { return { n: 0, echo: [] }; } }
  function saveLoop(v) { try { io.saveLoop(v); } catch (e) { /* 残らなくても遊べる */ } }
  function loopSet(patch) { LOOP = Object.assign({}, LOOP, patch); saveLoop(LOOP); }

  // ---- 物の置き場 ----
  const O = {};
  function thing(id, def) {
    O[id] = Object.assign({ id, loc: null, take: false, en: id.toLowerCase(), aliases: [def.name] }, def);
  }
  const text = v => (typeof v === "function" ? v() : v);
  const held = id => O[id].loc === "player";
  const near = id => O[id].loc === "player" || O[id].loc === S.loc || (O[id].locs && O[id].locs.includes(S.loc));
  const pick = a => a[Math.floor(Math.random() * a.length)];

  const DIR_JA = { n: "北", s: "南", e: "東", w: "西", u: "上", d: "下" };
  // 日曜は、来ない
  const DAYS = ["水", "月", "金", "土", "火", "木"];
  const SCHOOL = ["hall", "shall", "sroom", "hoken", "bcast", "gym", "yougu"];
  // 土曜に白衣が歩きまわる場所
  const REC_ROOMS = ["corr", "corr2", "station"];
  const QUESTIONS = ["ここ、どこ？", "わたし、だれ？", "この音は？", "あなた、だれ？", "いつ、帰れるの？"];
  // 入所記録の五つの欄。名前の欄は、ここには入っていない
  const FIELDS = [["like", "好きなもの"], ["hard", "苦手なもの"], ["calm", "落ち着く場所"], ["sign", "伝え方"], ["wish", "本人の希望"]];
  const FK = FIELDS.map(f => f[0]);
  // 記録係が、空いた欄に書くこと
  const REC = { like: "特になし", hard: "特になし", calm: "自室", sign: "発語あり。意思疎通は良好", wish: "特になし（本人からの聞き取りは困難）" };
  const WISHES = ["外を歩きたい", "名前で呼ばれたい", "ここにいたい", "まだ、わからない"];

  // ---- 建物の裏側 ----
  // 白い建物の「裏」には、Backrooms の階層がある。すり抜ける場所と条件は、どこにも書いていない
  // 表の建物も、場所ごとに配色と背景が変わる。環境音は部屋ごと（ROOM_BED）
  const LVINFO = {
    white: { fx: "white", opt: { a: "#4f8a9c", b: "#d0528c", mode: "tags" }, rank: 0, label: "白い部屋" },
    ward: { fx: "white", opt: { a: "#8cf0ff", b: "#ff6bb0", mode: "tags" }, rank: 0 },
    bath: { fx: "white", opt: { a: "#9ff0e0", b: "#ffd1e8", mode: "water" }, rank: 0 },
    linen: { fx: "white", opt: { a: "#ffe9c2", b: "#ff9ec4", mode: "scope" }, rank: 0 },
    court: { fx: "white", opt: { a: "#b8c4ff", b: "#ffe08a", mode: "stars" }, rank: 0 },
    school: { fx: "white", opt: { a: "#e9ff70", b: "#ff5fa2", mode: "tags" }, rank: 0 },
    hoken: { fx: "white", opt: { a: "#bff5d6", b: "#ff8fb1", mode: "scope" }, rank: 0 },
    bcast: { fx: "white", opt: { a: "#ffb347", b: "#ff4a6e", mode: "scope" }, rank: 0 },
    gym: { fx: "white", opt: { a: "#ffcf8a", b: "#7fd1ff", mode: "grid" }, rank: 0 },
    yougu: { fx: "white", opt: { a: "#8a7a5c", b: "#ffcf5a", mode: "dark" }, rank: 0 },
    river: { fx: "white", opt: { a: "#ffb35c", b: "#9fd3ff", mode: "stars" }, rank: 0 },
    "1": { fx: 1, rank: 1, label: "Level 1", heat: 0.5, back: true },
    "7": { fx: 7, rank: 2, label: "Level 7", heat: -0.5, back: true },
  };
  const LV_TAGS = {
    white: ["[613]", "[記入なし]", "36.5℃", "[特変なし]", "名前：＿＿", "[日曜欠番]", "[検温済]", "[空欄]"],
    ward: ["[613]", "[614 欠番]", "[申し送り]", "[巡回]", "[特変なし]", "[記録係]", "[面会：月]", "[配達：水・土]"],
    bath: ["[湯温 37℃]", "[栓]", "[615]", "[あふれ注意]", "[曇り]"],
    linen: ["[616]", "[乾燥中]", "[613]", "[613]", "[613]", "[温]"],
    court: ["[中庭]", "[銀杏]", "☆ 1", "[613：点灯]", "[夜風]"],
    school: ["[やくそく]", "[チャイム]", "[出席]", "[挙手]", "[6-13]", "[当番]", "[8:59]"],
    hoken: ["[保健室]", "[耳当て]", "[ゆっくりでいいよ]", "[検温]", "[調査票]"],
    bcast: ["[ON AIR]", "[病棟]", "[台本]", "[不要]", "[本人に聞く]"],
    gym: ["[体育館]", "[用具室]", "[半灯]", "[ボール 1]"],
    yougu: ["[暗]", "[マット]", "[跳び箱 8段]", "[静]"],
    river: ["[宛名：空欄]", "[日曜]", "[国道]", "[差出人：空欄]", "[613？]"],
    "1": ["Lv.1", "M.E.G.", "[記録　保管]", "A.W. 500ml", "[搬入口]", "[灯り：不安定]", "[616]"],
    "7": ["Lv.7", "[水平線なし]", "[水温 低]", "[日曜：漂着]", "[711]", "[見つめるな]"],
  };
  const LV_TRUISM = {
    "1": ["THE WAREHOUSE KEEPS EVERY RECORD", "倉庫は、どの記録も捨てない", "Level 1"],
    "7": ["THE SEA DOES NOT KNOW YOUR TEMPERATURE", "海は、あなたの体温を知らない", "Level 7"],
  };
  // 表の建物でも、はじめて足を踏み入れたときに出る格言
  const PLACE_TRUISM = {
    hoken: ["LOUD THINGS ARE LOUDER FOR SOME", "大きな音は、ある人にはもっと大きい", "保健室"],
    yougu: ["A SMALL DARK ROOM CAN BE A KIND ROOM", "せまくて暗い部屋が、やさしいこともある", "用具室"],
    bcast: ["ASK THE PERSON", "本人に聞け", "放送室"],
    visit: ["TWO KNOCKS ALSO MEAN YES", "二回たたくのも、はいの意味だ", "面会室"],
  };
  const TRUISMS = [
    ["A BLANK IS NOT AN ABSENCE", "空欄は、不在ではない", "613"],
    ["NO CHANGES NOTED", "特に変わりなし", "申し送り"],
    ["THE RECORD WAS WRITTEN BEFORE THE DAY", "記録は、その日より先に書かれていた", "申し送り"],
    ["SUNDAY IS THE RECORDER'S DAY OFF", "日曜は、記録係の休みの日", "M.E.G."],
    ["SOMEONE ELSE'S HANDWRITING IS STILL HANDWRITING", "他人の字でも、字は字だ", "?"],
    ["ASK THE PERSON", "本人に聞け", "放送室"],
    ["BEHAVIOR IS TRYING TO SAY SOMETHING", "ふるまいは、何かを伝えようとしている", "?"],
    ["LOOK FIRST. DECIDE LATER", "まず見よ。決めるのは、そのあとだ", "?"],
    ["NO ONE HAS WRITTEN WHY YOU ARE HERE", "あなたがここにいる理由は、誰も書いていない", "?"],
    ["EVERY BUILDING HAS A BACK SIDE", "どの建物にも、裏側がある", "?"],
  ];
  // 入るときに扉の音がする部屋
  const DOOR_ROOMS = ["bed", "station", "visit", "bath", "linen", "court", "sroom", "hoken", "bcast", "gym"];

  function initWorld() {
    for (const k of Object.keys(O)) delete O[k];

    // ---- 白い部屋（613）
    thing("ceiling", { name: "白い天井", aliases: ["白い天井", "天井", "ceiling"], loc: "bed", scenery: true,
      desc: "ずっと見上げていた気がする天井。小さな染みがいくつもある。数えるたびに、数が合わない。" });
    thing("lamp", { name: "蛍光灯", aliases: ["蛍光灯", "明かり", "電気", "灯り", "lamp"], en: "lamp", loc: "bed", scenery: true,
      desc: () => S.dark.bed ? "消えた蛍光灯。カバーの中の羽虫の影だけが、窓明かりで黒く浮いている。" :
        "カバーの中に、羽虫の影がいくつも溜まっている。全部、同じ向きを向いて死んでいる。うなりの高さは、一度も変わらない。" });
    thing("speaker", { name: "スピーカー", aliases: ["スピーカー", "天井のスピーカー", "声", "speaker"], en: "speaker", loc: "bed", scenery: true,
      desc: () => "天井の隅の、丸いスピーカー。網の目の奥は、暗い。毎朝、ここから声がする。" +
        (S.wishAsk ? "\n今は、ぷつぷつと小さな音を立てて、こちらの返事を待っている。" : "") });
    thing("bedd", { name: "ベッド", aliases: ["ベッド", "枕", "シーツ", "bed"], en: "bed", loc: "bed", scenery: true,
      desc: () => {
        if (!S.noteFound) { S.noteFound = true; O.note.loc = "bed"; return "白いシーツ。枕をどけると、下に、四つに折ったわら半紙が一枚。"; }
        return "白いシーツに、自分の形のくぼみが残っている。シーツの隅に、小さく「613」の刺繍。";
      } });
    thing("note", { name: "わら半紙", aliases: ["わら半紙", "紙", "メモ", "note"], en: "rough paper", take: true,
      desc: "四つに折った、ざらざらのわら半紙。",
      read: "鉛筆で、一行だけ。「日曜まで、名前を言わないで」\n……自分の字に、似ている。" });
    thing("call", { name: "ナースコール", aliases: ["ナースコール", "呼び出しボタン", "ボタン", "nurse call"], en: "nurse call", loc: "bed", scenery: true,
      desc: "枕元の白いボタン。押せば、誰かが来るのだろう。" });
    thing("tag", { name: "名札", aliases: ["名札", "札", "name tag"], en: "name tag", loc: "bed", scenery: true,
      desc: () => "ベッドの柵の名札。「613」。" + (LOOP.n ? `その横に、鉛筆で小さく「${LOOP.n + 1}」。` : "") + "名前を書くところは、空いている。" });
    thing("window", { name: "窓", aliases: ["窓", "カーテン", "window"], en: "window", loc: "bed", scenery: true,
      desc: () => S.dark.bed ? "明かりを消すと、窓は鏡であることをやめた。真下に、小さな中庭。銀杏の木と、ベンチ。その向こうに、国道と、川の土手。" :
        "カーテンを開けても、窓は暗い鏡になっている。白い部屋と、ベッドの横に立つ自分が映る。……顔のところだけ、反射が薄い。" });

    // ---- 病棟の廊下
    thing("d611", { name: "611の扉", aliases: ["611の扉", "611", "面会室の扉", "面会室"], en: "door 611", loc: "corr", scenery: true,
      desc: "611の扉。「面会室」の札。その下に小さく、「ご面会は月曜日のみ」。" });
    thing("d612", { name: "612の扉", aliases: ["612の扉", "612"], en: "door 612", loc: "corr", scenery: true,
      desc: "612の扉。札も、取っ手もない。耳を当てると、中から、寝息のような音がする。" });
    thing("d613", { name: "613の扉", aliases: ["613の扉", "613号室", "自分の部屋"], en: "door 613", loc: "corr", scenery: true, desc: "613の扉。自分の部屋だ。たぶん。" });
    thing("tracks", { name: "カートの跡", aliases: ["カートの跡", "跡", "車輪の跡", "床", "tracks"], en: "tracks", loc: "corr", scenery: true,
      desc: "リノリウムの床に、カートの車輪の跡。詰所と613のあいだを、何往復もしている。ほかの部屋の前には、一本もない。" });
    thing("d615", { name: "615の扉", aliases: ["615の扉", "615", "浴室の扉"], en: "door 615", loc: "corr2", scenery: true,
      desc: () => "615の扉。「浴室」の札。" + (S.faucet && S.plug && S.tub >= 4 ? "扉の下から、湯が廊下へ流れ出している。" : "隙間から、湯気の匂いがする。") });
    thing("d616", { name: "616の扉", aliases: ["616の扉", "616", "リネン室の扉"], en: "door 616", loc: "corr2", scenery: true,
      desc: () => S.carrierIn ? "616の扉。「リネン室」の札。扉の下に、濡れた自転車の轍が吸いこまれている。……中から、乾燥機の音がしない。" : "616の扉。「リネン室」の札。中から、乾燥機の回る音。" });
    thing("mark", { name: "614の印", aliases: ["614の印", "614", "印", "チョーク", "壁", "mark"], en: "mark 614", loc: "corr2", scenery: true,
      desc: "壁に、チョークで「614」。扉一枚ぶんの形に、壁の色が少しだけ新しい。塗りこめた跡のようだ。" });
    thing("recorder", { name: "白衣の誰か", aliases: ["白衣の誰か", "白衣", "記録係", "クリップボード", "看護師", "recorder"], en: "recorder", loc: "corr", locs: REC_ROOMS, scenery: true,
      when: () => isSat(),
      desc: "白衣の誰か。クリップボードを顔の前に掲げたまま歩いている。顔のかわりのように、クリップボードの裏に記入用紙が一枚。……用紙の名前の欄も、空いている。" });

    // ---- 詰所
    thing("form", { name: "613のファイル", aliases: ["613のファイル", "ファイル", "入所記録", "記録", "file 613"], en: "file 613", loc: "station", scenery: true,
      desc: () => formText(), read: () => formText() });
    thing("handover", { name: "申し送りノート", aliases: ["申し送りノート", "申し送り", "ノート", "handover notes"], en: "handover notes", loc: "station", scenery: true,
      desc: "大学ノート。表紙に「申し送り」。", read: () => handoverText() });
    thing("cal", { name: "カレンダー", aliases: ["カレンダー", "calendar"], en: "calendar", loc: "station", scenery: true,
      desc: () => S.calFixed ? "カレンダー。日曜の列が、白いテープで、もとの場所に貼ってある。紙は少しだけ波打っている。……日曜の欄は、どれも空いている。" :
        "壁のカレンダー。どの月も、日曜の列だけが、定規でまっすぐ切り取られている。月曜の左に、細い隙間。" });
    thing("inko", { name: "インコ", aliases: ["インコ", "鳥かご", "鳥", "parrot"], en: "parrot", loc: "station", scenery: true,
      desc: "鳥かごのインコ。黄色と緑。羽をふくらませて、こちらを横目で見ている。……ここで交わされた言葉を、全部覚えている顔だ。" });
    thing("sphone", { name: "内線電話", aliases: ["内線電話", "内線", "受話器"], en: "extension phone", loc: "station", scenery: true,
      desc: "内線電話。番号のボタンが一つだけ、すり減っている。「6」。" });

    // ---- 面会室（611）
    thing("partition", { name: "すりガラス", aliases: ["すりガラス", "仕切り", "ガラス", "向こう側", "partition"], en: "partition", loc: "visit", scenery: true,
      desc: () => "すりガラスの仕切り。向こう側の椅子の輪郭だけが、ぼんやり見える。" + (S.visitOn ? "\n椅子に、小さな輪郭が座っている。少しだけ、こちらへ身を乗り出している。" : "") });
    thing("vbook", { name: "面会簿", aliases: ["面会簿", "帳面", "visitor book"], en: "visitor book", loc: "visit", scenery: true,
      desc: "テーブルの端の面会簿。",
      read: "面会簿。「613」の行だけが、毎週続いている。\n面会者の欄は、どれも空欄。続柄の欄も、空欄。時刻だけが、どの週も「月曜　14:00」。\nいちばん新しい行の備考に、鉛筆で小さく。「声は通らない。こん、こん」" });
    thing("vase", { name: "花瓶", aliases: ["花瓶", "花", "vase"], en: "vase", loc: "visit", scenery: true,
      desc: "乾いた花。何の花だったのか、もう分からない。花瓶の水だけが、なぜか新しい。" });
    thing("vchair", { name: "椅子", aliases: ["椅子", "こちら側の椅子", "chair"], en: "chair", loc: "visit", scenery: true,
      desc: "こちら側の椅子。座面が、少しだけ温かい。" });
    thing("charm", { name: "お守り", aliases: ["お守り", "おまもり", "charm"], en: "charm", take: true,
      desc: "小さなお守り。布の袋に、何も書いていない。中で、紙のようなものがかさりと鳴る。",
      read: "袋の口は、固く縫いとめてある。……開けないほうがいい気がする。" });

    // ---- 浴室（615）
    thing("tub", { name: "湯船", aliases: ["湯船", "浴槽", "風呂", "お風呂", "tub"], en: "tub", loc: "bath", scenery: true,
      desc: () => S.tub >= 4 ? "湯船から、湯があふれている。白い湯気。水面が、ゆっくり揺れている。底が、思ったより深く見える。" :
        S.tub >= 3 ? "湯船いっぱいの湯。白い湯気。手を入れると、ちょうど体温くらい。底が、思ったより深く見える。" :
        S.tub >= 1 ? "湯船に、湯が半分ほど。" : "空の湯船。底の穴から、ひんやりした空気が上がってくる。" });
    thing("faucet", { name: "蛇口", aliases: ["蛇口", "お湯", "湯", "水", "faucet"], en: "faucet", loc: "bath", scenery: true,
      desc: () => "真鍮の蛇口。" + (S.faucet ? "湯が、どうどうと出ている。" : "閉まっている。") });
    thing("plug", { name: "栓", aliases: ["栓", "ゴムの栓", "鎖", "plug"], en: "plug", loc: "bath", scenery: true,
      desc: () => "鎖つきの、ゴムの栓。" + (S.plug ? "湯船の底の穴に、はめてある。" : "鎖の先で、ぶらぶらしている。") });
    thing("bmirror", { name: "鏡", aliases: ["鏡", "曇った鏡", "mirror"], en: "mirror", loc: "bath", scenery: true,
      desc: "湯気で曇った鏡。指でなぞると、なぞった跡にだけ、613の白い部屋が映る。浴室ではなく。" });

    // ---- リネン室（616）
    thing("dryer", { name: "乾燥機", aliases: ["乾燥機", "乾燥機の扉", "丸い窓", "dryer"], en: "dryer", loc: "linen", scenery: true, container: true, closed: true,
      desc: () => S.dryRun ? "業務用の乾燥機。丸い窓の中で、白いものが、ごうん、ごうん、と回っている。扉は、回っているあいだは開かない。" :
        "止まった乾燥機。" + (O.dryer.closed ? "丸い窓が、内側から湯気で曇っている。横に、大きなスイッチ。" : "扉が開いていて、中から乾いた熱が出てくる。") });
    thing("towel", { name: "バスタオル", aliases: ["バスタオル", "タオル", "towel"], en: "towel", loc: "dryer", take: true,
      desc: () => S.warmUntil >= S.moves ? "乾燥機から出したばかりのバスタオル。まだ、ふっくらと温かい。隅に、613の刺繍。" : "バスタオル。もう冷めている。隅に、613の刺繍。" });
    thing("sheets", { name: "シーツ", aliases: ["シーツ", "棚", "タオルの山", "sheets"], en: "sheets", loc: "linen", scenery: true,
      desc: "同じ形に畳まれた、白いシーツとタオルの山。どの隅にも、613の刺繍。……ほかの番号のものは、一枚もない。" });

    // ---- 正面玄関
    thing("glass", { name: "ガラス扉", aliases: ["ガラス扉", "自動扉", "ガラス", "glass door"], en: "glass door", loc: "front", scenery: true,
      desc: () => "大きなガラスの自動扉。" + (S.sunday ? "扉の上のセンサーのランプが、緑。" : "扉の上のセンサーのランプは、消えている。") });
    thing("notice", { name: "貼り紙", aliases: ["貼り紙", "張り紙", "notice"], en: "notice", loc: "front", scenery: true,
      desc: "ガラス扉の横の貼り紙。",
      read: "「ご面会は、月曜日のみ。日曜日は、配達のみ受け付けます。　事務局」\nその下に、手書きで小さく。「日曜日は、ありません」" });
    thing("outside", { name: "外", aliases: ["外", "国道", "土手", "川", "outside"], en: "outside", loc: "front", scenery: true,
      desc: "ガラスの向こうに、夜の国道。車が行き交う。その向こうの川の土手を、自転車の灯りが一つ、ゆっくり動いている。" });

    // ---- 中庭
    thing("bench", { name: "ベンチ", aliases: ["ベンチ", "bench"], en: "bench", loc: "court", scenery: true,
      desc: "木のベンチ。座面に、銀杏の葉が一枚だけ。" });
    thing("ginkgo", { name: "銀杏", aliases: ["銀杏", "銀杏の木", "木", "葉", "ginkgo"], en: "ginkgo", loc: "court", scenery: true,
      desc: "銀杏の木。葉はすっかり黄色いのに、一枚も落ちてこない。地面にも、ベンチの一枚しかない。" });
    thing("wardwin", { name: "病棟の窓", aliases: ["病棟の窓", "613の窓", "窓", "病棟", "ward windows"], en: "ward windows", loc: "court", scenery: true,
      desc: () => isSat() ? "見上げると、六階の端、613の窓辺に、白衣の誰かが立っている。クリップボードに、何か書きこんでいる。……こちらを見下ろしながら。" :
        "見上げると、病棟の窓が三方から見下ろしている。どれも暗い。六階の端、613の窓にだけ、明かりが点いている。……自分は、ここにいるのに。" });
    thing("csky", { name: "夜空", aliases: ["夜空", "空", "星", "sky"], en: "sky", loc: "court", scenery: true,
      desc: "四角く切り取られた夜空。星が、一つだけ。いつ見ても、同じ場所にある。" });

    // ---- 渡り廊下
    thing("booth", { name: "公衆電話", aliases: ["公衆電話", "電話ボックス", "電話", "受話器", "pay phone"], en: "pay phone", loc: "passage", scenery: true,
      desc: () => "公衆電話のボックス。緑の電話機。" + (S.ring ? "鳴っている。" : S.call === 1 ? "受話器を、耳に当てている。" : "受話器は、静かだ。") });

    // ---- 昇降口
    thing("shoebox", { name: "613の下駄箱", aliases: ["613の下駄箱", "下駄箱", "shoebox"], en: "shoebox", loc: "hall", scenery: true, container: true, closed: true,
      desc: "蓋つきの下駄箱。一つだけ、「613」の番号が貼ってある。" });
    thing("uwabaki", { name: "上履き", aliases: ["上履き", "上靴", "うわばき", "shoes"], en: "indoor shoes", loc: "shoebox", take: true,
      desc: "上履き。つま先が青い。かかとの名前の欄は、空いている。" });
    thing("hposter", { name: "ひらがなの貼り紙", aliases: ["ひらがなの貼り紙", "貼り紙", "張り紙", "poster"], en: "poster", loc: "hall", scenery: true,
      desc: "ひらがなの貼り紙。",
      read: "「やくそく\nチャイムが なったら、せきに つく。\nなまえを よばれたら、へんじを する。\nわからない ときは、てを あげる。」\n子どもの字と大人の字で、二重に書いてある。" });

    // ---- 校舎
    thing("clocks", { name: "時計", aliases: ["時計", "秒針", "clock"], en: "clock", loc: "shall", scenery: true,
      desc: "どの時計も、八時五十九分。秒針だけが、何周も、何周も。" });
    thing("toban", { name: "腕章の影", aliases: ["腕章の影", "影", "腕章", "当番", "名札", "monitor"], en: "monitor", loc: "shall", locs: SCHOOL, scenery: true,
      when: () => S.breakDay === S.day && S.breaks > 0 && !S.sunday,
      desc: "腕章をつけた、背の高い影。腕章に「当番」。顔のところに、名札が一枚、貼りついている。名札も、空欄だ。" });
    thing("board", { name: "黒板", aliases: ["黒板", "やくそく", "blackboard"], en: "blackboard", loc: "sroom", scenery: true,
      desc: "黒板。白い字で「やくそく」。",
      read: "「やくそく」\n一、チャイムが鳴ったら、席につく。\n二、名前を呼ばれたら、返事をする。\n三、わからないときは、手をあげる。\n黒板の右の端に、日直の欄。名前は、空欄。" });
    thing("desk", { name: "613の机", aliases: ["613の机", "机", "名前のシール", "シール", "desk"], en: "desk", loc: "sroom", scenery: true, container: true, closed: true,
      desc: "窓ぎわの、前から六番目の机。名前のシールに、「613」とだけ。天板が、蓋になっている。" });
    thing("pencil", { name: "鉛筆", aliases: ["鉛筆", "えんぴつ", "pencil"], en: "pencil", loc: "desk", take: true, desc: "短い鉛筆。噛んだ跡がある。" });
    thing("eraser", { name: "消しゴム", aliases: ["消しゴム", "けしごむ", "eraser"], en: "eraser", loc: "desk", take: true,
      desc: "角の丸くなった消しゴム。カバーの裏に、小さく『けせるのは、じぶんの字だけじゃない』。" });
    thing("essay", { name: "作文", aliases: ["作文", "作文用紙", "essay"], en: "essay", loc: "desk", take: true,
      desc: "作文用紙。", read: "作文用紙。題は「わたしの名前」。\n本文は、一行もない。消しゴムで何度も消した跡で、紙が薄くなっている。" });
    thing("seats", { name: "席", aliases: ["席", "いす", "椅子", "自分の席", "seat"], en: "seat", loc: "sroom", scenery: true,
      desc: "どの椅子も、少しだけ引いてある。誰かが、いつでも座れるように。" });
    thing("hbed", { name: "保健室のベッド", aliases: ["保健室のベッド", "ベッド", "カーテン", "school bed"], en: "school bed", loc: "hoken", scenery: true,
      desc: "白いカーテンの中の、狭いベッド。枕カバーに、613ではない、別の番号。……かすれて読めない。" });
    thing("earmuff", { name: "耳当て", aliases: ["耳当て", "イヤーマフ", "みみあて", "earmuffs"], en: "earmuffs", loc: "hoken", take: true,
      desc: () => "子ども用の耳当て。黄色。バンドの内側に、マジックで『かえしてね』。" + (S.earOn ? "今、耳につけている。" : "") });
    thing("drawer", { name: "引き出し", aliases: ["引き出し", "机の引き出し", "drawer"], en: "drawer", loc: "hoken", scenery: true, container: true, closed: true,
      desc: "保健の先生の机の、引き出し。" });
    thing("tape", { name: "テープ", aliases: ["テープ", "サージカルテープ", "tape"], en: "tape", loc: "drawer", take: true,
      desc: "白いサージカルテープ。紙にも、肌にも貼れる。" });
    thing("hcard", { name: "保健調査票", aliases: ["保健調査票", "調査票", "health card"], en: "health card", loc: "hoken", scenery: true,
      desc: "壁に画鋲でとめた、保健調査票。",
      read: "保健調査票　6年13組　613\nすきなもの：\nにがてなもの：\nおちつくところ：\nつたえかた：\nしょうらい：\n全部、空欄。いちばん下に、先生の赤ペン。『ゆっくりでいいよ』" });
    thing("meter", { name: "身長計", aliases: ["身長計", "体重計", "meter"], en: "height meter", loc: "hoken", scenery: true,
      desc: "身長計。目盛りの、ちょうど自分の頭の高さに、鉛筆の線が何本も重なっている。日付は、どれにもない。" });
    thing("mic", { name: "マイク", aliases: ["マイク", "mic"], en: "mic", loc: "bcast", scenery: true,
      desc: () => S.micOn ? "マイクの赤いランプが点いている。何か言えば、どこかで鳴る。" : "マイク。スイッチは切れている。" });
    thing("mixer", { name: "つまみ", aliases: ["つまみ", "ミキサー", "卓", "mixer"], en: "mixer", loc: "bcast", scenery: true,
      desc: "つまみは「病棟」に合わせてある。「校舎」と「全館」のほうは、テープで固定されて動かない。" });
    thing("script", { name: "台本", aliases: ["台本", "バインダー", "朝の放送", "script"], en: "script", loc: "bcast", scenery: true,
      desc: "台本のバインダー。背に「朝の放送（病棟）」。", read: () => scriptText() });
    thing("ball", { name: "ボール", aliases: ["ボール", "バスケットボール", "ball"], en: "ball", loc: "gym", scenery: true,
      desc: "バスケットボール。用具室の引き戸の前で、止まった。……少しして、また転がりはじめる。" });
    thing("stage", { name: "幕", aliases: ["幕", "舞台", "stage"], en: "stage", loc: "gym", scenery: true,
      desc: "舞台の幕。下りたまま。幕の向こうで、パイプ椅子を並べる音がする。並べ終わる音は、しない。" });
    thing("ydoor", { name: "用具室の引き戸", aliases: ["用具室の引き戸", "引き戸", "用具室", "戸", "sliding door"], en: "sliding door", loc: "gym", locs: ["gym", "yougu"], scenery: true,
      desc: () => S.loc === "yougu" ? (S.yClosed ? "閉めた引き戸。隙間から、体育館の灯りが一本の線になって入ってくる。" : "開いた引き戸。体育館の灯りが、四角く差しこんでいる。") :
        S.yOpen ? "用具室の引き戸。開いている。中は暗い。" : "重い鉄の引き戸。「用具室」の札。閉まっている。" });
    thing("mats", { name: "マット", aliases: ["マット", "mats"], en: "mats", loc: "yougu", scenery: true,
      desc: "体育のマットが、何枚も積み重なっている。いちばん上に、ちょうど人一人ぶんのくぼみ。" });
    thing("tobibako", { name: "跳び箱", aliases: ["跳び箱", "とびばこ", "vault box"], en: "vault box", loc: "yougu", scenery: true,
      desc: "跳び箱。八段。いちばん上の白い布に、小さな手の跡。" });

    // ---- 土手（日曜）
    thing("courier", { name: "配達員", aliases: ["配達員", "郵便配達員", "自転車", "courier"], en: "courier", loc: "river", scenery: true,
      desc: "自転車を押した郵便配達員。帽子のつばの下から、こちらの顔をうかがっている。" });
    thing("letter", { name: "封筒", aliases: ["封筒", "手紙", "宛名", "letter"], en: "letter", loc: "river", scenery: true,
      desc: "配達員の手の中の、白い封筒。宛名の欄は空欄。差出人の欄も、空欄。消印だけが、日曜の日付。" });

    // ==== 裏側：Level 1 ====
    thing("crates", { name: "木箱", aliases: ["木箱", "箱", "crates"], en: "crates", loc: "l1a", scenery: true,
      desc: "木箱。ステンシルで「記録　保管」。釘で打ちつけてあって、開かない。隙間から、紙の匂い。" });
    thing("arrow", { name: "矢印", aliases: ["矢印", "ペンキ", "arrow"], en: "arrow", loc: "l1a", scenery: true,
      desc: "壁のペンキの矢印。「→ M.E.G.」。北を指している。" });
    thing("d616b", { name: "616の扉", aliases: ["616の扉", "616", "扉"], en: "door 616", loc: "l1a", scenery: true,
      desc: "内側から見た、616の扉。リネン室の扉と、同じところに同じ傷がある。" });
    thing("radio", { name: "無線機", aliases: ["無線機", "無線", "radio"], en: "radio", loc: "l1b", scenery: true,
      desc: () => S.radioAsk ? "無線機のランプが、赤く点滅している。こちらの返事を、待っている。" : "無線機。ランプが緑。雑音の奥で、誰かが番号を読み上げている。601、602、603……612で、止まる。" });
    thing("cork", { name: "コルクボード", aliases: ["コルクボード", "メモ", "ボード", "corkboard"], en: "corkboard", loc: "l1b", scenery: true,
      desc: "コルクボード。メモが何枚も、画鋲でとめてある。", read: () => corkText() });
    thing("vest", { name: "反射ベスト", aliases: ["反射ベスト", "ベスト", "vest"], en: "vest", loc: "l1b", take: true,
      desc: () => "反射材の入った、白いベスト。背中に、黒い字で「記録係」。" + (S.vestOn ? "今、着ている。" : "") });
    thing("clip", { name: "クリップボード", aliases: ["クリップボード", "記入用紙", "用紙", "clipboard"], en: "clipboard", loc: "l1b", take: true,
      desc: "クリップボード。記入用紙が何十枚も挟んである。",
      read: "記入用紙。番号の欄だけが一枚ずつ違って、ほかの欄は、どの紙にも同じ四角い字で『特に変わりなし』。\nいちばん上の一枚だけ、番号の欄も、ほかの欄も、空いている。" });
    thing("shutter", { name: "シャッター", aliases: ["シャッター", "暗がり", "shutter"], en: "shutter", loc: "l1c", scenery: true,
      desc: "腰の高さまで上がったシャッター。その下は、真っ暗だ。暗がりの中で、何かがこちらと同じ高さに、しゃがんでいる気がする。" });
    thing("crate1", { name: "蓋のずれた木箱", aliases: ["蓋のずれた木箱", "木箱", "箱", "crate"], en: "crate", loc: "l1c", scenery: true, container: true, closed: true,
      desc: "木箱。蓋が、少しだけずれている。" });
    thing("almond", { name: "アーモンド水", aliases: ["アーモンド水", "水", "ペットボトル", "almond water"], en: "almond water", loc: "crate1", take: true, drink: true,
      desc: "ペットボトルの水。ラベルに手書きで『A.W.』。蓋の隙間から、アーモンドの甘い匂い。" });

    // ==== 裏側：Level 7 ====
    thing("fbed", { name: "浮いたベッド", aliases: ["浮いたベッド", "ベッド", "floating bed"], en: "floating bed", loc: "l7a", scenery: true,
      desc: "シーツごと、ゆっくり浮いているベッド。シーツの隅に、613の刺繍。枕は、もうどこにもない。" });
    thing("sea", { name: "窓", aliases: ["窓", "海", "外", "影", "window"], en: "sea window", loc: "l7a", scenery: true, desc: "" });
    thing("cal7", { name: "壁のカレンダー", aliases: ["壁のカレンダー", "カレンダー", "calendar"], en: "wet calendar", loc: "l7a", scenery: true,
      desc: () => "壁のカレンダー。半分、水に浸かっている。" + (O.strip.loc === "l7a" ? "どの月も、日曜の列だけが、ほかの紙から剥がれかけて、ひらひらと水に揺れている。……ここに、流れついたらしい。" : "日曜の列は、もうない。") });
    thing("strip", { name: "日曜の列", aliases: ["日曜の列", "日曜", "紙の列", "strip"], en: "sunday strip", loc: "l7a", scenery: true, take: true,
      desc: () => S.stripWet ? "カレンダーの、日曜の列。海の水を吸って、ふやけている。今にも破れそうだ。" : "カレンダーの、日曜の列。ぱりぱりに乾いている。日付だけがあって、何の予定も書いていない。" });
    thing("doors7", { name: "扉", aliases: ["扉", "711", "712", "713", "doors"], en: "doors", loc: "l7b", scenery: true,
      desc: "711、712、713、715、716。714がない。どの扉も、水圧で開かない。" });
    thing("page", { name: "浮いた紙", aliases: ["浮いた紙", "紙", "page"], en: "floating page", loc: "l7b", scenery: true,
      desc: "水に浮いた記入用紙。",
      read: "記入用紙。番号が縦に並んで、どれも同じ四角い字で『特に変わりなし』。601、602、603……612。\n613の行だけが、空欄のまま。そこだけ、水ににじんでいない。" });
    thing("deep", { name: "突き当たりの海", aliases: ["突き当たりの海", "突き当たり", "海", "深み", "deep"], en: "deep water", loc: "l7b", scenery: true,
      desc: "廊下の突き当たりから先は、海だ。水の色が、そこから急に濃くなる。底は、見えない。" });

    thing("tekkyu", { name: "鉄の球", aliases: ["鉄の球", "球", "iron ball"], en: "iron ball", scenery: true,
      desc: "頭の右上に浮かぶ、鉄の球。熱があるときにだけ見える。ゆっくり揺れている。" });
  }

  // ---- 部屋 ----
  const ROOMS = {
    bed: { name: "白い部屋", exits: { n: "corr" },
      desc: () => (S.dark.bed ? "明かりを消した白い部屋。窓が、外の夜を映している。" : "白い天井。蛍光灯のカバーの中に、羽虫の影がいくつも溜まっている。") +
        "ベッド、枕元のナースコール、窓。ベッドの柵に名札。天井の隅に、丸いスピーカー。" + (S.sunday ? "\n今日は、廊下にカートの音がしない。" : "") + "\n北の扉から、廊下へ出られる。" },
    corr: { name: "病棟の廊下", exits: { s: "bed", w: "station", e: "visit", n: "corr2" },
      desc: () => "長い廊下の、南の端。613の向かいに612、その隣に611。611の扉には「面会室」の札。612の扉には、札がない。\n蛍光灯が、等間隔に。誰ともすれ違わない。床のリノリウムに、カートの車輪の跡だけが、何本も。" +
        (isSat() ? "\n廊下の先で、白衣の背中が、ゆっくり行き来している。" : "") +
        "\n南に自分の部屋（613）。西に詰所。東が面会室（611）。廊下は、北へ続いている。" },
    corr2: { name: "病棟の廊下（北）", exits: { s: "corr", w: "bath", e: "linen", n: "front" },
      desc: () => "廊下の北の半分。西に615（「浴室」）、東に616（「リネン室」）。そのあいだの壁に、614の番号だけが、チョークで書いてある。扉はない。" +
        (isSat() ? "\nクリップボードを顔の前に掲げた白衣が、扉の番号を一つずつ確かめながら歩いている。" : "") +
        "\n北の突き当たりが正面玄関。南へ戻れば、613のほう。" },
    station: { name: "詰所", exits: { e: "corr" },
      desc: () => "ナースステーション。" + (isSat() ? "カウンターの中で、白衣の誰かがクリップボードに何か書いている。顔は、クリップボードの陰。" : "誰もいない。") +
        "ファイル立てに、ファイルが一冊。その下に、申し送りノート。壁にカレンダー。内線電話。棚の上に、鳥かご。\n東の扉から廊下へ。" },
    visit: { name: "面会室", exits: { w: "corr" },
      desc: () => "小さな面会室。テーブルを、すりガラスの仕切りが真ん中で二つに分けている。こちら側に椅子が一脚。向こう側にも一脚。" +
        (S.visitOn ? "向こうの椅子に、小さな輪郭が座っている。" : "") + "テーブルの端に、面会簿と、乾いた花の挿さった花瓶。\n西の扉から廊下へ。" },
    bath: { name: "浴室", exits: { e: "corr2" },
      desc: () => "タイル張りの浴室。古い湯船と、真鍮の蛇口。洗い場に、湯気で曇った鏡。湯船の栓が、鎖でぶら下がっている。" +
        (S.tub >= 4 ? "\n湯船から湯があふれて、タイルの床を流れている。" : S.tub >= 3 ? "\n湯船は、湯でいっぱいだ。" : S.tub >= 1 ? "\n湯船に、湯が半分。" : "") +
        (S.faucet ? "蛇口から、湯がどうどうと出ている。" : "") + "\n東の扉から廊下へ。" },
    linen: { name: "リネン室", exits: { w: "corr2" },
      desc: () => "リネン室。棚に、白いシーツとタオルが、同じ形に畳まれて積まれている。奥で、業務用の乾燥機が" +
        (S.dryRun ? "ごうん、ごうん、と回っている。" : "止まっている。") + "\n西の扉から廊下へ。" },
    front: { name: "正面玄関", exits: () => S.sunday ? { s: "corr2", e: "court", w: "passage", n: "river" } : { s: "corr2", e: "court", w: "passage" },
      desc: () => "正面玄関。大きなガラスの自動扉。向こうに、夜の国道と、川の土手が見える。" +
        (S.sunday ? "扉の上のセンサーのランプが、緑に灯っている。" : "扉の横に、貼り紙。センサーのランプは消えている。") +
        "\n南へ戻れば廊下。東に、中庭へ出る扉。西に、校舎への渡り廊下。" },
    court: { name: "中庭", exits: { w: "front" },
      desc: "病棟に囲まれた、小さな中庭。銀杏の木が一本と、木のベンチ。見上げると、四角く切り取られた夜空。病棟の窓が、三方から見下ろしている。\n西の扉から正面玄関へ。" },
    passage: { name: "渡り廊下", exits: { e: "front", w: "hall" },
      desc: () => "病棟と校舎をつなぐ渡り廊下。窓の外は暗い。角に、公衆電話のボックス。" + (S.ring ? "電話が鳴っている。" : "") + "\n東に病棟の正面玄関。西に、校舎の昇降口。" },
    hall: { name: "昇降口", exits: { e: "passage", n: "shall" },
      desc: "校舎の昇降口。蓋つきの下駄箱が並ぶ。すのこ。壁に、ひらがなの貼り紙。校舎の中は、夜なのに、蛍光灯が全部点いている。\n北に校舎の廊下。東へ戻れば渡り廊下。" },
    shall: { name: "校舎の廊下", exits: { s: "hall", e: "sroom", w: "hoken", n: "gym", u: "bcast" },
      desc: () => "校舎の廊下。壁の時計は、どれも同じ時刻のまま、秒針だけが進んでいる。東に「6年13組」。西に「保健室」。北の突き当たりに、体育館の扉。階段が、上の放送室へ。" +
        (S.breakDay === S.day && S.breaks > 0 ? "\n廊下の端に、腕章をつけた背の高い影が立っている。" : "") + "\n南へ戻れば昇降口。" },
    sroom: { name: "6年13組", exits: { w: "shall" },
      desc: "6年13組。机が、きっちり並んでいる。誰もいないのに、椅子はどれも少しだけ引いてある。黒板に、白い字で「やくそく」。窓ぎわの、前から六番目の机にだけ、名前のシールが貼ってある。番号だけの。\n西の扉から廊下へ。" },
    hoken: { name: "保健室", exits: { e: "shall" },
      desc: "保健室。カーテンで仕切られたベッドが一つ。身長計と、体重計。棚に、包帯と、黄色い耳当て。保健の先生の机と、その引き出し。壁に、保健調査票が一枚。\n東の扉から廊下へ。" },
    bcast: { name: "放送室", exits: { d: "shall" },
      desc: () => "放送室。窓のない、小さな部屋。ミキサーの卓に、マイクが一本。つまみには「病棟」「校舎」「全館」と手書きのラベル。卓の上に、台本のバインダー。" +
        (S.micOn ? "マイクの赤いランプが点いている。" : "") + "\n下へ、階段で廊下に戻れる。" },
    gym: { name: "体育館", exits: () => S.yOpen ? { s: "shall", n: "yougu" } : { s: "shall" },
      desc: () => "夜の体育館。天井の灯りが半分だけ点いていて、床のラインが、途中から暗がりに沈んでいる。舞台の幕は下りている。ボールが一つ、誰も触れていないのに、ゆっくり転がっている。" +
        (S.yOpen ? "奥の「用具室」の引き戸が、開いている。" : "奥の壁に、「用具室」の重い引き戸。") + "\n南へ戻れば校舎の廊下。" },
    yougu: { name: "用具室", exits: { s: "gym" },
      desc: () => (S.yClosed ? "まっくらな用具室。引き戸の隙間から、灯りが一本の線になって入ってくる。マットの古いゴムの匂い。跳び箱の、木の匂い。" :
        "体育館の用具室。せまい。積み上げたマット、跳び箱、ボールのかご。開いた引き戸から、体育館の灯りが四角く差しこむ。") + "\n南の引き戸から、体育館へ。" },
    river: { name: "土手", exits: {},
      desc: "土手の上。国道を車が行き交い、川面に街灯が揺れている。ガラス越しではない夜の音。どの方向にも、道が続いている。\n自転車を押した郵便配達員が、こちらへ来る。" },

    // ==== 裏側 ====
    l1a: { name: "倉庫", lv: "1", exits: { n: "l1b", w: "l1c", e: "corr2" },
      desc: "コンクリートの、がらんとした倉庫。天井の蛍光灯は、半分が点いていない。床に水たまり。壁に、ペンキの矢印。木箱がいくつか、積まれたまま。\n背中の扉に、ステンシルで「616」。北に、明かりの点いた区画。西に、シャッターの半分開いた搬入口。" },
    l1b: { name: "前哨基地", lv: "1", exits: { s: "l1a" },
      desc: "仕切り板で囲った、小さな前哨基地。折りたたみの机に、無線機。コルクボードに、メモが何枚も。椅子の背に、反射ベストが一枚。机の上に、クリップボード。\n南へ戻れば倉庫。" },
    l1c: { name: "搬入口", lv: "1", exits: { e: "l1a" },
      desc: () => (S.l1dark ? "真っ暗だ。何も見えない。……すぐ近くで、コンクリートを擦る音。" :
        "搬入口。シャッターが腰の高さまで上がっていて、その向こうは真っ暗だ。天井の蛍光灯が、ときどき、全部いっしょに消える。壁ぎわに、蓋のずれた木箱が一つ。") + "\n東へ戻れば倉庫。" },
    l7a: { name: "水没した病室", lv: "7", exits: { e: "l7b", u: "bath" },
      desc: "水没した病室。胸まで水がある。ベッドが、シーツごとゆっくり浮いている。蛍光灯は、水の中で点いたままだ。大きな窓の外は、どこまでも海。水平線がない。壁に、カレンダーが一枚。\n東の扉の外に、廊下。上へ浮かべば、たぶん、戻れる。" },
    l7b: { name: "水没した廊下", lv: "7", exits: { w: "l7a" },
      desc: "水没した廊下。扉の番号は、711、712、713……どの扉も、開かない。紙が一枚、水面に浮いている。廊下の突き当たりには壁がなく、そのまま海につながっている。\n西へ戻れば病室。" },
  };
  const exitsOf = loc => text(ROOMS[loc].exits);
  // 表の建物の配色の区分
  const AREA = { bed: "white", corr: "ward", corr2: "ward", station: "ward", visit: "ward", front: "ward", passage: "ward",
    bath: "bath", linen: "linen", court: "court",
    hall: "school", shall: "school", sroom: "school", hoken: "hoken", bcast: "bcast", gym: "gym", yougu: "yougu", river: "river" };
  const lvOf = loc => (ROOMS[loc] && ROOMS[loc].lv) || AREA[loc] || "white";
  const isBack = loc => !!(LVINFO[lvOf(loc)] || {}).back;
  const heatRate = loc => (LVINFO[lvOf(loc)] || {}).heat || 0;

  // ---- 状態 ----
  let S = null;
  let LOOP = loadLoop();
  function newState() {
    initWorld();
    S = { loc: "bed", moves: 0, done: false, seen: {}, t: 36.5, di: 0, day: 0, sunday: false,
      // 欄の中身（f）、誰の字か（by：me / rec）、自分で見つけたもの（mine。他人の字に先を越されても残る）
      f: { like: null, hard: null, calm: null, sign: null, wish: null }, by: {}, mine: {},
      dark: { bed: false }, noteFound: false, wishAsk: false,
      // 浴室・リネン室
      faucet: false, plug: false, tub: 0, inTub: false, dryRun: true, dryT: 0, warmUntil: -1,
      // 電話と面会
      ring: false, ringDay: -1, call: 0, callT: 0, visitPromise: false, visited: false, visitOn: false, visitWait: 0, visitT: 0,
      // 配達員と、土曜の白衣
      mailDay: -1, carrierIn: false, recT: 0,
      // 校舎の約束
      chimeT: 0, chimeDue: 0, chimeAt: -9, rollDay: -1, rollDue: 0, rollMiss: false, handUp: -9, breaks: 0, breakDay: -1, earOn: false,
      // 放送室・用具室
      scriptFixed: false, micOn: false, yOpen: false, yClosed: false, yWait: 0,
      // 日曜の列
      stripWet: true, calFixed: false,
      // 裏側
      lvSeen: {}, bt: 0, l1dark: false, l1w: 0, seaLook: 0, deepWarn: false, vestOn: false, radioAsk: false,
      dk: 0, dkDay: -1, fails: 0, benchDay: -1, restDay: -1,
      hist: [] };
  }
  const SAVED_FIELDS = ["loc", "closed", "scenery"];
  function snapshot() {
    const objs = {};
    for (const o of Object.values(O)) {
      objs[o.id] = {};
      for (const k of SAVED_FIELDS) if (k in o) objs[o.id][k] = o[k];
    }
    return { v: VERSION, S, objs, log: rows.slice(-120) };
  }
  // 版の違う保存は、続きにしない。はじめから
  function restore(data) {
    if (!data || data.v !== VERSION || !data.S || typeof data.S !== "object" || !ROOMS[data.S.loc]) return false;
    newState();
    const base = S;
    S = Object.assign(base, data.S);
    for (const k of ["seen", "f", "by", "mine", "dark", "lvSeen"]) if (!S[k] || typeof S[k] !== "object") S[k] = base[k];
    if (!Array.isArray(S.hist)) S.hist = [];
    if (typeof S.t !== "number" || !isFinite(S.t)) S.t = 36.5;
    for (const [id, st] of Object.entries(data.objs || {})) if (O[id] && st && typeof st === "object") Object.assign(O[id], st);
    return true;
  }

  // ---- 表示 ----
  let rows = [];
  let turnStart = 0;
  let flashed = false;
  function push(r) { rows.push(r); }
  // 熱が上がってくると、文章の字がところどころ欠ける
  function corrupt(t) {
    if (!S || S.t < 37.6 || t.length < 6) return t;
    const p = Math.min(0.85, (S.t - 37.4) * 0.9);
    if (Math.random() > p) return t;
    const k = S.t >= 37.8 ? 3 : 1;
    for (let j = 0; j < k; j++) {
      const i = 2 + Math.floor(Math.random() * (t.length - 3));
      t = t.slice(0, i) + pick(["■", "？", "□", "▒"]) + t.slice(i + 1);
    }
    return t;
  }
  function say(t, cls) { for (const part of String(t).split("\n")) push({ t: "out", ja: cls === "title" || cls === "win" ? part : corrupt(part), cls: cls || "" }); }
  function gap() { push({ t: "gap" }); }
  function flicker() { flashed = true; }
  // 過去に打った命令の一つが、打っていない命令に書き換わる（前のあなたの命令がまじることもある）
  function haunt(t) {
    const idx = [];
    rows.forEach((r, i) => { if (r.t === "cmd" && i < rows.length - 8) idx.push(i); });
    if (!idx.length) return;
    const i = idx[Math.floor(Math.random() * idx.length)];
    rows[i] = { t: "cmd", ja: t, en: "", h: 1 };
  }
  const hauntText = () => (LOOP.echo && LOOP.echo.length && Math.random() < 0.4) ? pick(LOOP.echo) : pick(QUESTIONS);
  const isDay = d => !!S && !S.sunday && DAYS[S.di] === d;
  const isSat = () => isDay("土");
  const dayName = () => S.sunday ? "日" : isBack(S.loc) ? "？" : DAYS[S.di];
  const hot = () => S.t >= 37.5 && !S.done;
  const mine = k => !!S.f[k] && S.by[k] === "me";
  const allMine = () => FK.every(mine);
  const allRec = () => FK.every(k => S.f[k] && S.by[k] === "rec");
  const anyRec = () => FK.some(k => S.f[k] && S.by[k] === "rec");
  function status() {
    const ex = exitsOf(S.loc);
    return { room: ROOMS[S.loc].name, day: dayName() + "曜", temp: S.t.toFixed(1) + "℃", hot: S.t >= 37.5, ball: hot(),
      exits: Object.keys(ex).filter(k => ex[k]), done: S.done, theme: S.loc === "ura" ? "ura" : S.loc === "sky" ? "sky" : "" };
  }

  // ---- 世界のしくみ ----
  function visible() {
    const out = [];
    const walk = parent => {
      for (const o of Object.values(O)) {
        if (o.loc !== parent && !(parent === S.loc && o.locs && o.locs.includes(parent))) continue;
        if (o.when && !o.when()) continue;
        out.push(o);
        if (o.container && !o.closed) walk(o.id);
      }
    };
    walk(S.loc);
    walk("player");
    if (hot()) out.push(O.tekkyu);
    return out;
  }
  function describe(full) {
    const r = ROOMS[S.loc];
    say(r.name, "title");
    if (full || !S.seen[S.loc]) say(text(r.desc));
    S.seen[S.loc] = true;
    const loose = Object.values(O).filter(o => o.loc === S.loc && !o.scenery);
    for (const o of loose) say(`ここに${o.name}がある。`);
    for (const c of Object.values(O).filter(o => o.loc === S.loc && o.container && !o.closed)) {
      const inside = Object.values(O).filter(o => o.loc === c.id);
      if (inside.length) say(`${c.name}の中に、${inside.map(o => o.name).join("、")}。`);
    }
    if (hot() && full) say("頭の右上に、鉄の球が浮かんでいる。", "note");
  }
  function go(dir) {
    if (S.loc === "river") { say("どちらへ行こうとしても、配達員が「あの」と呼び止める。封筒の宛名が、まだ空欄だ。"); return; }
    if (S.loc === "front" && dir === "n" && !S.sunday) {
      S.bump = (S.bump || 0) + 1;
      sfx("thud");
      say("ガラス扉に、額をぶつけた。扉は開かない。");
      say("「日曜日以外は、お出になれません」", "voice");
      say(S.bump >= 3 ? "どこからか、表情のない声。……日曜日は、ないのに。" : "どこからか、表情のない声がした。");
      addT(0.1, "");
      return;
    }
    if (S.loc === "front" && dir === "n") { toRiver(); return; }
    if (S.loc === "corr2" && dir === "e" && S.carrierIn) { toLevel1(); return; }
    if (S.loc === "gym" && dir === "n" && !S.yOpen) { say("用具室の引き戸は、閉まっている。重そうだ。"); return; }
    if (S.loc === "yougu" && dir === "s" && S.yClosed) { S.yClosed = false; say("引き戸を開けて、体育館へ出る。灯りが、まぶしい。"); }
    if (S.loc === "bath" && dir === "d") { dive(); return; }
    if (S.loc === "l7a" && dir === "u") { surface(); return; }
    if (S.loc === "l7a" && dir === "d") { say("床まで、足が届いている。下には、もう病室の床しかない。"); return; }
    if (S.loc === "l7b" && dir === "d") { deepWater(); return; }
    if (S.loc === "l7b" && dir === "e") { say("突き当たりの先は、海だ。泳いでいくには、暗すぎる。"); return; }
    if (S.loc === "l1c" && S.l1dark) { darkMove(); return; }
    if (S.loc === "l1a" && dir === "e") {
      sfx("door");
      say("「616」の扉を開ける。……リネン室ではなかった。病棟の廊下の、北の半分に出た。振り向くと、616の扉が、静かに閉まった。");
      enter("corr2");
      return;
    }
    const to = exitsOf(S.loc)[dir];
    if (!to) { say(`${DIR_JA[dir] || "そちら"}へは行けない。`); return; }
    if (S.inTub) { S.inTub = false; say("湯船から上がる。"); }
    if (S.loc === "corr" && dir === "s") say("613の扉を開けて、中に入る。");
    if (S.loc === "shall" && dir === "u") say("階段を上る。踊り場の窓の外は、まだ夜だ。");
    if (S.loc === "bcast" && dir === "d") say("階段を降りる。");
    sfx(DOOR_ROOMS.includes(to) || DOOR_ROOMS.includes(S.loc) ? "door" : "step");
    enter(to);
  }
  function enter(to, full) {
    const from = S.loc;
    S.loc = to;
    if (from !== to) roomChange(from, to);
    describe(!!full);
    arrive(to);
  }
  // 部屋を出ると、その部屋だけの緊張はほどける。階層が変わると、裏側の勘定もやり直し
  function roomChange(from, to) {
    S.recT = 0; S.seaLook = 0; S.l1w = 0; S.l1dark = false; S.yWait = 0; S.deepWarn = false; S.radioAsk = false;
    if (from === "bed" && S.wishAsk) { S.wishAsk = false; say("背後で、スピーカーがしばらく黙って待ってから、ぷつりと切れた。", "note"); }
    if (from === "passage" && (S.ring || S.call)) { S.ring = false; S.call = 0; say("背後で、公衆電話の受話器が、ゆっくり揺れている。", "note"); }
    if (from === "visit" && S.visitOn) { S.visitOn = false; say("背後で、すりガラスの向こうの椅子が、きしんだ。", "note"); }
    if (from === "visit") S.visitWait = 0;
    if (from === "bath") S.inTub = false;
    if (from === "yougu") S.yClosed = false;
    if (from === "sroom" && S.rollDue) { S.rollDue = 0; S.rollMiss = true; }
    if (!SCHOOL.includes(to)) { S.chimeDue = 0; S.rollMiss = false; }
    if (from === "corr2" && to !== "linen") S.carrierIn = false;
    const a = lvOf(from), b = lvOf(to);
    if (a === b) return;
    S.bt = 0;
    if (!isBack(to)) return;
    if (!S.lvSeen[b]) {
      S.lvSeen[b] = true;
      fx("shock", 2);
      fx("flash");
      sfx(b === "7" ? "splash" : "static");
      if (b === "1") fx("flicker", 3);
      const t = LV_TRUISM[b];
      if (t) setTimeout(() => fx("truism", t[0], t[1], t[2]), 500);
    } else fx("glitch");
    const rank = (LVINFO[b] || {}).rank || 0;
    if (rank > (LOOP.deep || 0)) loopSet({ deep: rank });
  }
  // 別の場所へ移される
  function warp(to, lines) {
    for (const l of lines || []) say(l);
    gap();
    enter(to, true);
  }
  // 部屋に入ったときの出来事
  function arrive(to) {
    if (PLACE_TRUISM[to] && !S.seen["tru_" + to]) { S.seen["tru_" + to] = true; const t = PLACE_TRUISM[to]; setTimeout(() => fx("truism", t[0], t[1], t[2]), 700); }
    // 土曜は、白衣が歩きまわっている。入るのは見逃してくれる
    if (isSat() && REC_ROOMS.includes(to)) {
      say("白衣の誰かが、クリップボードの陰から、こちらのほうへ顔を向けた。……顔は見えない。用紙だけが見える。", "warn");
      sfx("breath");
    }
    // 配達員は、水曜と土曜に、616を近道にしていく
    if (to === "corr2" && (isDay("水") || isDay("土")) && S.mailDay !== S.day) {
      S.mailDay = S.day;
      sfx("bell");
      say("自転車を押した郵便配達員が、廊下を来た。616の扉の前で止まり、扉を開けて、自転車ごと入っていく。すれ違いざま、こちらに言う。", "note");
      say("「ここ、近道なんですよ。ほんとは、通っちゃいけないんですけど」", "voice");
      S.carrierIn = true;
      say("扉が閉まる。濡れた轍が、616の扉の下に吸いこまれている。……乾燥機の音が、しない。", "note");
    }
    if (to === "passage" && !S.sunday && S.ringDay !== S.day && S.moves > 4 && (!mine("sign") || Math.random() < 0.3)) {
      S.ringDay = S.day; S.ring = true;
      say("公衆電話が鳴っている。", "warn");
      sfx("phone");
    }
    if (to === "visit" && isDay("月") && S.visitPromise && !S.visited) say("すりガラスの向こうの椅子は、まだ空いている。……誰かを待つための椅子だ。", "note");
    if (to === "linen" && S.dryRun) say("乾燥機の丸い窓の中で、白いものが回っている。止まるまで、もう少しかかりそうだ。", "note");
    if (to === "sroom" && !S.sunday && S.rollDay !== S.day) {
      S.rollDay = S.day;
      sfx("beep");
      say("教室のスピーカーが鳴った。", "note");
      say("「出席をとります」", "voice");
      say("名簿をめくる音。誰の名前も呼ばれないまま、何行も飛ばされていく。", "note");
      say("「……613番」", "voice");
      S.rollDue = S.moves + 2;
    }
    if (to === "gym" && !S.seen.ballStop) { S.seen.ballStop = true; say("転がってきたボールが、用具室の引き戸の前で、ぴたりと止まった。", "note"); }
    if (to === "l1b" && S.vestOn && held("clip")) radioCall();
    if (to === "l1c") { say("天井の蛍光灯が、いっせいに一度またたいた。", "note"); fx("flicker", 2); }
    if (to === "l7a" && !S.seen.l7cold) { S.seen.l7cold = true; say("水は、思ったより冷たい。体温が、少しずつ水に取られていく。", "warn"); }
  }
  function addT(n, why) {
    if (S.done) return;
    const was = S.t;
    S.t = Math.round(Math.max(35.5, Math.min(39, S.t + n)) * 10) / 10;
    if (why) say(why, n > 0 ? "warn" : "note");
    // 37.5℃ を越えた瞬間、鼓動が一つ大きく鳴る
    if (was < 37.5 && S.t >= 37.5 && S.t < 38.0) { sfx("heart"); fx("glitch"); }
    if (S.t >= 38.0) collapse(isBack(S.loc) ? ["体の中の熱が、白い光になって、目の裏からあふれてくる……"] : null);
    else if (S.t <= 35.8) collapse(["指の先から、感覚がなくなっていく。", "海の冷たさが、体の芯まで届いた……"], ["THE SEA DOES NOT KNOW YOUR TEMPERATURE", "海は、あなたの体温を知らない", "Level 7"]);
  }
  // 欄が埋まる。他人の字が先に入っていたら、自分のぶんは書けずに取っておかれる
  function setField(k, v) {
    S.mine[k] = v;
    if (S.f[k] && S.by[k] === "rec") {
      say("どこかで、ペン先が紙の上を走りかけて……止まった。その欄は、もう誰かの字で埋まっているらしい。", "note");
      return;
    }
    if (S.f[k]) return;
    S.f[k] = v; S.by[k] = "me";
    say("どこかで、ペン先が紙の上を走る音がした。", "note");
    sfx("chime");
    if (allMine()) {
      say("……遠くで、カレンダーが一枚、風にめくれる音。", "note");
      fx("truism", "EVERY FIELD IS FILLED EXCEPT ONE", "欄は、一つを残して埋まった", "613");
    }
  }
  // 倒れているあいだに、記録係が空いた欄を一つ埋める
  function recFill() {
    const empty = FK.filter(k => !S.f[k]);
    if (!empty.length) return null;
    const k = pick(empty);
    S.f[k] = REC[k]; S.by[k] = "rec";
    return k;
  }
  // 朝が来る。曜日は順番どおりに来ない
  function nextDay(fever) {
    S.day++;
    if (!S.sunday && allMine() && S.calFixed) S.sunday = true;
    else if (!S.sunday) S.di = (S.di + 1) % DAYS.length;
    S.t = fever ? 37.2 : 36.5;
    S.dark.bed = false; S.wishAsk = false;
    S.ring = false; S.call = 0; S.visitOn = false; S.visitWait = 0; S.visitT = 0;
    S.carrierIn = false; S.recT = 0; S.chimeT = 0; S.chimeDue = 0; S.rollDue = 0; S.rollMiss = false;
    // 浴室の湯は抜け、乾燥機は朝にまた回りだす
    S.faucet = false; S.plug = false; S.tub = 0; S.inTub = false;
    S.dryRun = true; S.dryT = 0; S.warmUntil = -1; O.dryer.closed = true;
    S.micOn = false; S.yClosed = false;
  }
  function morning() {
    if (S.sunday) {
      say("目を覚ます。……検温の声が、来ない。");
      say("天井のスピーカーが、しんとしている。今日は、日曜らしい。");
      return;
    }
    fx("flicker", 2);
    // 土曜だけは、天井からではなく、本人が来る
    if (isSat()) {
      sfx("knock");
      say("扉を叩く音。返事をする前に、扉が開いた。");
      say("白衣の誰かが、クリップボードを顔の前に掲げたまま入ってくる。", "warn");
      say("「おはようございます。お熱、はかりますね」", "voice");
      sfx("beep");
      say(`冷たい指が、体温計を脇の下に差しこんだ。${S.t.toFixed(1)}℃。クリップボードの陰で、ペンが走る。`);
      say("「はい、特に変わりなしですね」", "voice");
      say("……声は、天井のスピーカーの声と、同じだった。白衣は、廊下へ戻っていった。今日は一日、廊下を歩きまわるらしい。", "note");
      return;
    }
    say("「おはようございます。お熱、はかりますね」", "voice");
    sfx("beep");
    say(`天井のスピーカーから声がして、脇の下で体温計が鳴った。${S.t.toFixed(1)}℃。`);
    if (S.scriptFixed && !mine("wish")) {
      say("……少し、間があった。台本をめくる音。", "note");
      say("「613さん。……きょうは、どうしたいですか」", "voice");
      say("スピーカーが、ぷつぷつと鳴りながら、返事を待っている。", "note");
      S.wishAsk = true;
      return;
    }
    say("「はい、特に変わりなしですね」", "voice");
  }
  // 熱が上がりきる、冷えきる、何かに捕まる。白い部屋で、次の朝に目を覚ます。そのあいだに、記録係が来る
  function collapse(lines, tru) {
    if (S.done) return;
    gap();
    for (const l of (lines || ["頭の中が、熱で白く塗りつぶされていく……"])) say(l, "warn");
    sfx(tru ? "stinger" : "heart");
    fx("shock", 2);
    fx("flash");
    fx("blackout", 1100);
    if (tru) setTimeout(() => fx("truism", tru[0], tru[1], tru[2]), 400);
    haunt(hauntText());
    S.fails = (S.fails || 0) + 1;
    const guarded = held("charm");
    const filled = guarded ? null : recFill();
    nextDay(true);
    const from = S.loc;
    S.loc = "bed";
    roomChange(from, "bed");
    gap();
    say("……白い天井。");
    if (filled) say("眠っているあいだに、誰かが枕元で、紙に何か書きこむ音を聞いた気がする。四角い字の音。", "note");
    else if (guarded) say("手の中で、お守りが汗で湿っている。……眠っているあいだ、枕元で誰かがペンを止めて、去っていった気がする。", "note");
    if (allRec()) { endNoChange(); return; }
    morning();
    describe(true);
  }

  // ==== いろいろな出来事 ====
  function toRiver() {
    sfx("chime");
    say("ガラスの扉が、音もなく左右に開いた。");
    say("夜の空気。車の音。川の匂い。ガラス一枚ぶん遠かったものが、全部、近い。");
    gap();
    enter("river", true);
    say("配達員が、自転車を止めた。", "note");
    say("「あ、613号室の方ですよね。……お手紙です」", "voice");
    say("「それが、宛名が空欄なんです。お名前、うかがってもいいですか」", "voice");
  }
  function toLevel1() {
    S.carrierIn = false;
    sfx("door");
    warp("l1a", ["配達員のすぐあとに、616の扉を開ける。", "……シーツの棚も、乾燥機もない。濡れたコンクリートの床に、自転車の轍が続いて、途中で消えている。", "背中で、扉が閉まった。"]);
  }
  // 湯船から、底のない下へ
  function dive() {
    if (!S.inTub) { say(S.tub >= 3 ? "湯船の外からでは、潜れない。" : "床の排水口は、指一本も入らない。"); return; }
    if (S.tub < 3) { say("湯が、まだ足りない。顔まで沈められない。"); return; }
    sfx("splash");
    warp("l7a", ["息を吸って、頭まで湯に沈む。", "……目を開けると、湯船の底がない。白いタイルが、ずっと下まで続いている。", "沈んでいく。湯が、ゆっくり冷たい水に変わる。塩の味。", "足が、どこかの床に着いた。顔を上げると、水面の上に出た。"]);
  }
  function surface() {
    sfx("splash");
    S.tub = 0; S.plug = false; S.faucet = false; S.inTub = false;
    const lines = ["足で床を蹴って、上へ浮かぶ。水が、だんだんぬるくなる。", "……湯船の中で、顔を上げた。湯は抜けていて、栓が外れている。"];
    if (held("towel")) lines.push("持ってきたバスタオルで、体を拭いた。少しだけ、温かさが戻る。");
    else lines.push("髪から、まだ海の水が滴っている。");
    warp("bath", lines);
    if (!held("towel")) addT(-0.1, "");
    else if (S.t < 36.5) addT(Math.min(0.4, 36.5 - S.t), "");
  }
  function deepWater() {
    if (!S.deepWarn) {
      S.deepWarn = true;
      say("突き当たりのほうへ、潜りかける。足もとの水が、急に深く、冷たくなる。下に、底がない。", "warn");
      say("……何かが、ずっと下のほうで、ゆっくり向きを変えた。", "note");
      sfx("whisper"); fx("glitch");
      return;
    }
    collapse(["深いほうへ、潜る。光が、上へ遠ざかっていく。", "下から上がってきた影が、廊下の幅いっぱいに広がった。"], ["DO NOT STARE INTO THE DEEP", "深みを、見つめるな", "Level 7"]);
  }
  function seaLook() {
    S.seaLook++;
    if (S.seaLook === 1) { say("窓の外は、どこまでも海。水平線がない。ずっと下のほうに、何か大きなものの影が、ゆっくり動いている。"); return; }
    if (S.seaLook === 2) {
      say("影が、少しずつ上がってくる。窓いっぱいに、黒いものが広がっていく。……目を、離せない。", "warn");
      sfx("whisper"); fx("glitch"); fx("shock", 1);
      return;
    }
    collapse(["窓の外の影の中で、目が、ひらいた。", "窓より大きな目だった。"], ["DO NOT STARE INTO THE DEEP", "深みを、見つめるな", "Level 7"]);
  }
  // 搬入口の暗がり：灯りが消えているあいだは、動かない
  function darkMove() {
    S.l1w++;
    if (S.l1w >= 2) {
      collapse(["暗闇で、もう一歩。", "すぐ後ろで、何かが、同じ一歩を踏み出した。冷たい指が、肩に置かれる。"], ["IF THE LIGHTS GO OUT, DO NOT MOVE", "灯りが消えたら、動くな", "Level 1"]);
      return;
    }
    say("暗闇で一歩踏み出したとたん、すぐ後ろで、何かが同じ一歩を踏み出した。……足を止める。", "warn");
    sfx("scratch"); fx("shock", 1);
  }
  function l1Tick(v) {
    if (S.loc !== "l1c") return;
    if (S.l1dark) {
      if (v === "wait") return;
      return;
    }
    if (Math.random() < 0.3) {
      S.l1dark = true; S.l1w = 0;
      fx("blackout", 900); sfx("spark");
      say("天井の蛍光灯が、全部いっしょに消えた。真っ暗だ。", "warn");
      say("シャッターの下の暗がりから、コンクリートを擦る音が、こちらへ。", "note");
    }
  }
  // 公衆電話
  function answerPhone() {
    if (S.loc !== "passage") { say("内線電話の受話器を取る。ツーという音のかわりに、遠くで乾燥機の回るような音がした。……戻す。"); return; }
    if (S.call === 1) { say("受話器は、もう耳に当てている。"); return; }
    if (!S.ring) { say("受話器を耳に当てる。何も聞こえない。ツー、という音もしない。……戻した。"); return; }
    S.ring = false; S.call = 1; S.callT = 0;
    sfx("static");
    say("受話器を取る。");
    say("「……もしもし。もしもし？」", "voice");
    say("年をとった女の人の声。少し遠い。");
    if (!mine("sign")) {
      say("「聞こえる？……そっちの声が、こっちに来ないのよ。この電話、いつもそうなの」", "voice");
      say("「聞こえてるなら、受話器を、こん、こん、って。二回、たたいて」", "voice");
    } else {
      say("「こん、こん、で、いいからね。……ちゃんと、ごはん食べてる？」", "voice");
    }
  }
  function phoneKnock() {
    sfx("knock");
    say("受話器を、指の関節で、こん、こん、と二回たたいた。");
    S.call = 0;
    if (!mine("sign")) {
      say("……少し間があって、向こうで、息を吐く音。", "note");
      say("「ああ。聞こえてるのね。よかった。……それでいいの。むかしから、そうだったものね」", "voice");
      setField("sign", "声が届かないときは、二回たたく");
      say("「あのね。名前は、まだ言わなくていいからね。日曜までは」", "voice");
      say("「月曜に、会いに行くから。仕切りのある部屋で」", "voice");
      S.visitPromise = true;
      say("ぷつり、と切れた。受話器の中で、遠くの川の音がしていた気がする。", "note");
      return;
    }
    say("「……うん。うん。それなら、いいの」", "voice");
    say("ぷつり、と切れた。", "note");
  }
  // 月曜の面会
  function visitStart() {
    S.visitOn = true; S.visitT = 0;
    sfx("door");
    say("すりガラスの向こうで、扉の開く音。", "note");
    say("誰かが、向こうの椅子に、ゆっくり腰を下ろした。小さな輪郭。");
    say("「……来たわよ。そこに、いる？」", "voice");
    say("電話の、あの声だ。", "note");
  }
  function visitKnock() {
    sfx("knock");
    say("すりガラスを、こん、こん、と二回たたいた。");
    say("「……ああ。いるのね」", "voice");
    say("仕切りの向こうの輪郭が、少しだけ前へ傾いた。顔は、すりガラスの中で、ぼやけたままだ。");
    say("「顔、見えないわね。……いいの。見えなくても」", "voice");
    say("テーブルと仕切りのあいだの隙間から、小さな布の袋が、こちらへ押し出されてきた。お守りだ。");
    say("「これ、持ってなさい。誰かに勝手に書かれそうになったら、握ってなさい。あなたの欄を、他人の字で埋めさせないように」", "voice");
    say("「日曜には、手紙を出しておくから。……名前は、そのとき、あなたが決めればいいの」", "voice");
    say("椅子のきしむ音。扉の閉まる音。仕切りの向こうは、また空になった。", "note");
    O.charm.loc = "visit"; O.charm.scenery = false;
    S.visitOn = false; S.visited = true;
    sfx("chime");
  }
  // 校舎のチャイム。耳当てか、閉めた用具室なら、遠い
  function chime() {
    sfx("chime");
    const muffled = S.earOn || (S.loc === "yougu" && S.yClosed);
    if (muffled) {
      say(S.earOn ? "耳当ての向こうで、チャイムが小さく鳴った。" : "引き戸の向こうで、チャイムが遠く鳴った。", "note");
      if (!S.mine.hard) {
        say("……胸の奥が、少しも跳ねない。音が遠いだけで、こんなに楽なのか。");
        say("ずっと、これが苦手だったのだ。急に鳴る、大きな音が。");
        setField("hard", "急に鳴る、大きな音");
      }
    } else {
      say("頭の真上で、チャイムが割れるように鳴った。キーン、コーン。", "warn");
      fx("glitch");
      S.chimeAt = S.moves;
      addT(0.1, "耳の奥が、熱い。");
    }
    if (S.done) return;
    say("……どこかで、椅子を引く音が、いっせいに鳴った。", "note");
    S.chimeDue = S.moves + 2;
  }
  const TOBAN = {
    chime: ["廊下の端の暗がりから、腕章をつけた背の高い影が、首だけをこちらへ曲げた。", "「チャイムが鳴ったら、席につく」"],
    roll: ["教室の後ろの戸口に、腕章をつけた背の高い影が立っていた。名簿を、胸に抱えている。", "「名前を呼ばれたら、返事をする」"],
    hand: ["天井の近くから、腕章をつけた背の高い影が、こちらを覗きこんでいた。", "「わからないときは、手をあげる」"],
  };
  function ruleBreak(kind) {
    if (S.breakDay !== S.day) { S.breakDay = S.day; S.breaks = 0; }
    S.breaks++;
    sfx("whisper"); fx("glitch"); fx("shock", 1);
    say(TOBAN[kind][0], "warn");
    say(TOBAN[kind][1], "voice");
    if (S.breaks >= 3) {
      collapse(["腕章の影が、目の前まで来た。", "顔のところの名札に、ペン先が近づいてくる。空欄に、何かを書かれる――"], ["RULES ARE KEPT BY SOMEONE", "約束は、誰かが守らせている", "当番"]);
      return true;
    }
    addT(0.3, S.breaks === 2 ? "影が、近い。次は、ない気がする。" : "頭の奥が、かっと熱くなる。");
    return true;
  }
  // 土曜の白衣に、長く見られる
  function recCatch() {
    if (held("charm")) {
      S.recT = 0;
      say("クリップボードが、顔の前まで来た。……ポケットの中で、お守りを握りしめる。", "warn");
      say("ペン先が、用紙の上で止まった。白衣は首をかしげて、そのまま通りすぎていった。", "note");
      return;
    }
    collapse(["クリップボードが、顔の前まで来た。ペン先が、こちらの輪郭をなぞるように動く。", "「特に、変わりなし」"], ["NO CHANGES NOTED", "特に変わりなし", "記録係"]);
  }
  // 無線：ベストを着て、クリップボードを持っていると、呼ばれる
  function radioCall() {
    if (!S.vestOn || !held("clip")) { say("無線機は、番号を読み上げつづけている。601、602……612で止まって、また601から。"); return; }
    S.radioAsk = true;
    sfx("static");
    say("無線機のランプが、赤に変わった。", "warn");
    say("「……記録係。こちら、本部。六階に、空きがある。配置につけるか」", "voice");
    say("無線機が、こちらの返事を待っている。", "note");
  }
  function paste() {
    if (!held("strip")) { say("日曜の列を持っていない。"); return; }
    if (S.loc !== "station") { say("ここには、貼るところがない。"); return; }
    if (S.stripWet) { say("切り口に当ててみる。……濡れた紙は、ぐにゃりと垂れて、端から破れかけた。あわてて離す。乾かさないと。"); return; }
    if (!held("tape")) { say("切り口に紙を当ててみる。……手を離すと、ひらりと落ちた。貼るものがあれば。"); return; }
    O.strip.loc = "gone";
    S.calFixed = true;
    sfx("chime");
    say("白いテープを、切り口に沿って貼っていく。日曜の列が、もとの場所に戻った。");
    say("カレンダーの日付の並びが、ようやくつながった。……日曜の欄は、どれも空いている。");
    fx("flash");
    fx("truism", "SUNDAY IS THE RECORDER'S DAY OFF", "日曜は、記録係の休みの日", "詰所");
  }
  function erase() {
    if (!held("eraser")) { say("消すものを持っていない。"); return; }
    if (S.loc !== "station") { say("ここに、消すものはない。"); return; }
    const recs = FK.filter(k => S.f[k] && S.by[k] === "rec");
    if (!recs.length) { say("ファイルを見る。……消したい字は、どこにもない。自分の字は、残しておく。"); return; }
    sfx("scratch");
    say("消しゴムで、四角い字をこする。力を入れなくても、字はすぐに薄くなった。強く書いたぶん、紙だけがへこんで残る。");
    for (const k of recs) {
      S.f[k] = null; S.by[k] = null;
      const ja = FIELDS.find(f => f[0] === k)[1];
      if (S.mine[k]) {
        S.f[k] = S.mine[k]; S.by[k] = "me";
        say(`「${ja}」の欄。消した跡に、前に見つけたことが、自分の字で浮かんできた。「${S.mine[k]}」`, "note");
      } else say(`「${ja}」の欄が、また空いた。`, "note");
    }
    if (allMine()) say("……遠くで、カレンダーが一枚、風にめくれる音。", "note");
  }
  function answerWish(w) {
    S.wishAsk = false;
    say("スピーカーの向こうで、鉛筆の音がした。", "note");
    say("「……はい。書いておきますね」", "voice");
    S.wishSaid = w;
    setField("wish", w);
  }

  // ---- 読むもの ----
  function formText() {
    S.seen.form = true;
    const lines = ["入所記録　613", "名前：＿＿＿＿"];
    for (const [k, ja] of FIELDS) {
      const v = S.f[k];
      lines.push(`${ja}：` + (!v ? "＿＿＿＿" : S.by[k] === "rec" ? `${v}　（四角い、他人の字）` : `${v}　（自分の字に、似ている）`));
    }
    if (anyRec()) lines.push("他人の字のところだけ、紙が少しへこむほど、強く書いてある。");
    else if (FK.every(k => !S.f[k])) lines.push("名前の欄も、ほかの五つの欄も、全部空いている。");
    return lines.join("\n");
  }
  function handoverText() {
    S.seen.handover = true;
    return ["申し送りノート。", "（水）613、終日臥床。特変なし。",
      "（月）613、面会。面会者は記入なし。返事は、こん、こん。特変なし。",
      "（金）613、チャイムのたびに耳をふさぐ。保健室より借用品あり。特変なし。",
      "（土）巡回。613のファイル、未記入の欄は記録係が補記のこと。",
      "（火）613、用具室にて発見。戸は内側から閉めてあった。特変なし。",
      "（木）613、616にて発見。乾燥機の前から動かず。特変なし。",
      "（水）613、放送の台本について質問あり。回答せず。",
      "（日）――　この行だけ、切り取られている。",
      "どの日付も、まだ来ていない日のぶんまで、同じ字で書いてある。"].join("\n");
  }
  function scriptText() {
    S.seen.script = true;
    const l = ["「朝の放送（病棟）」", "一、「おはようございます。お熱、はかりますね」", "二、（体温を読み上げる）",
      "三、（本人に、きょうどうしたいかを聞く）", "四、「はい、特に変わりなしですね」"];
    if (S.scriptFixed) l.push("三の行の赤い二重線の横に、鉛筆で「本人に聞く」と書き足してある。赤い「不要」の上から。");
    else l.push("三の行にだけ、赤ペンで二重線。余白に、赤い字で「不要」。");
    return l.join("\n");
  }
  function corkText() {
    return ["コルクボードのメモ。",
      "「記録係　募集。資格：一度でも、記録されたことのある者」",
      "「613の部屋は、毎朝『特変なし』。そう書く者がいるかぎり」",
      "「記録係にも、休みの日は要る。日曜がそうだった。……日曜があると、記録が途切れる。だから誰かが、日曜を切り取って、海に流した」",
      "「616は、配達員のすぐあとにだけ、ここにつながる」",
      "「搬入口で灯りが消えたら、動くな」",
      "「海の階では、窓を見つめるな」"].join("\n");
  }
  // インコは、ここで交わされた言葉を覚えている
  function parrot() {
    const c = ["とくへん、なし。とくへん、なし"];
    if (!mine("sign")) c.push("ろくいちさん、でんわ。でんわ、なってる");
    if (!mine("like")) c.push("ろくいちろく、かんそうき、とまるまで、まってて");
    if (!mine("hard")) c.push("ほけんしつの、みみあて、かえしてね");
    if (!mine("calm")) c.push("ようぐしつ。また、ようぐしつ");
    if (!mine("wish")) c.push(S.scriptFixed ? "あさ、きいてあげて。あさ" : "だいほん、そのまま。さんばん、ふよう");
    if (!S.calFixed) c.push("にちようは、ない。うみに、ながした");
    if (anyRec()) c.push("ほかのひとの、じ。けしゴム、けしゴム");
    return pick(c);
  }

  // ---- 結末 ----
  function finish(id, tru) {
    reach(id);
    fx("flash");
    fx("shock", 1);
    ({ number: ["bell", "chime"], blank: ["chime"], unknown: ["bell"], reply: ["knock", "chime"], nochange: ["beep"], assign: ["static"] }[id] || []).forEach((n, i) => setTimeout(() => sfx(n), i * 900));
    setTimeout(() => fx("bed", id === "assign" ? "fluoro" : id === "nochange" ? "office" : "silence"), 1600);
    if (tru) setTimeout(() => fx("truism", tru[0], tru[1], tru[2]), 700);
  }
  const movesNote = () => say(`（手 ${S.moves}。いちばん下の「はじめから」で、最初から）`, "note");
  function endNumber() {
    S.done = true;
    say("配達員は、宛名の空欄にボールペンで「613」と書きこんだ。「はい、確かに」");
    say("封筒を受け取る。中には、入所記録が一枚。五つの欄は、自分の字で埋まっている。名前の欄に、配達員の字で、613。");
    gap();
    say("……白い天井。", "win");
    say("「おはようございます。お熱、はかりますね」", "win");
    say("36.5℃。", "win");
    say("「はい、特に変わりなしですね」", "win");
    say("記録は、ちゃんと届いた。宛名のとおりに。", "win");
    say("****  番号  ****", "win");
    movesNote();
    loopSet({ n: LOOP.n + 1, echo: S.hist.slice(-12) });
    finish("number", ["YOU ARE WHAT IS WRITTEN ABOUT YOU", "書かれたものが、あなたになる", "613"]);
  }
  function endBlank() {
    S.done = true;
    say("何も言わなかった。何も言わない、ということを、言った。");
    say("配達員は、空欄のままの宛名をしばらく見て、うなずいた。「ああ、それなら合ってます」");
    say("封筒の中の紙には、五つの欄が、自分の字で書いてあった。好きなもの。苦手なもの。落ち着く場所。伝え方。本人の希望。");
    say("名前の欄だけが、空いている。");
    gap();
    say("空いたままでいい、と思った。", "win");
    say("配達員が、自転車を押して去っていく。国道の車の音が、ガラス越しではなく聞こえる。", "win");
    say("日曜日だ。", "win");
    say("どちらへ歩いてもいい。", "win");
    say("****  空欄  ****", "win");
    movesNote();
    loopSet({ n: 0, echo: [] });
    finish("blank", ["A BLANK IS NOT AN ABSENCE", "空欄は、不在ではない", "　"]);
  }
  function endUnknown() {
    S.done = true;
    say("配達員は、困ったように宛名の空欄を見て、それから鞄から判子を出した。");
    say("封筒に、赤い判が押される。「あて所に尋ねあたりません」。");
    say("「じゃあ、差出人の方に、お返ししますね」", "voice");
    say("差出人の欄も、空欄だった。住所だけが書いてある。川の上流の、知らない町。");
    say("「……一緒に、来ますか」", "voice");
    gap();
    say("配達員の自転車のあとを、歩いてついていく。", "win");
    say("土手の道は、上流のほうへ、ずっと続いている。街灯が、一本ずつ後ろへ流れていく。", "win");
    say("わからないまま、歩いていい。", "win");
    say("****  宛先不明  ****", "win");
    movesNote();
    loopSet({ n: LOOP.n + 1, echo: S.hist.slice(-12) });
    finish("unknown", ["RETURN TO SENDER", "差出人に、戻す", "郵便"]);
  }
  function endReply() {
    S.done = true;
    sfx("knock");
    say("配達員の手の中の封筒を、こん、こん、と二回たたいた。");
    say("配達員は、少し驚いた顔をして、それから笑った。");
    say("「ああ……差出人の方が、言ってました。声が出なかったら、二回たたく人だからって」", "voice");
    say("封筒を受け取る。中に、便箋が一枚。電話の、あの声の字だと思った。");
    say("「名前は、あなたが決めていいのよ。決まったら、ここに書いて。決まらなかったら、こん、こん、でいいから」");
    say("便箋の下半分が、空いている。");
    gap();
    say("空欄は、こちらで埋めていいらしい。埋めなくても、いいらしい。", "win");
    say("配達員が、自転車を押して去っていく。土手の街灯が、川面に揺れている。", "win");
    say(held("pencil") ? "便箋をたたんで、ポケットにしまった。短い鉛筆と、一緒に。" : "便箋をたたんで、ポケットにしまった。書くものは、あとで探せばいい。", "win");
    say("日曜日だ。", "win");
    say("****  返事  ****", "win");
    movesNote();
    loopSet({ n: 0, echo: [] });
    finish("reply", ["TWO KNOCKS ALSO MEAN YES", "二回たたくのも、はいの意味だ", "面会"]);
  }
  function endNoChange() {
    S.done = true;
    say("「おはようございます。お熱、はかりますね」", "voice");
    say("36.5℃。");
    say("「はい、特に変わりなしですね」", "voice");
    say("スピーカーの向こうで、ファイルを閉じる音がした。");
    gap();
    say("入所記録の五つの欄は、全部、埋まっている。", "win");
    say("四角い、他人の字で。", "win");
    say("好きなもの、特になし。苦手なもの、特になし。落ち着く場所、自室。……読み上げると、そのとおりの人になっていく気がした。", "win");
    say("名前の欄だけが、まだ空いている。もう、誰も気にしない。", "win");
    say("****  特変なし  ****", "win");
    movesNote();
    loopSet({ n: LOOP.n + 1, echo: S.hist.slice(-12) });
    finish("nochange", ["NO CHANGES NOTED", "特に変わりなし", "申し送り"]);
  }
  function endAssign() {
    S.done = true;
    say("無線の向こうで、誰かが短く息を吐いた。「了解。記録係、配置につけ。担当は、六階」", "voice");
    say("クリップボードの、いちばん上の紙。番号の欄が空いている。……ペンが、いつの間にか手の中にある。");
    say("番号の欄に、613と書く。その下の欄に、迷わず書く。");
    gap();
    say("「特に、変わりなし」", "win");
    say("四角い字だった。", "win");
    say("ベストは、いつの間にか白衣になっている。クリップボードを、顔の前に掲げる。そうすると、誰の顔も見なくていい。", "win");
    say("六階の廊下を、行ったり来たりする。今日も、どの部屋も、特に変わりなし。", "win");
    say("****  配属  ****", "win");
    movesNote();
    loopSet({ n: LOOP.n + 1, echo: S.hist.slice(-12) });
    finish("assign", ["SOMEONE HAS TO KEEP THE RECORD", "誰かが、記録をつけなければならない", "M.E.G."]);
  }

  // ---- ヒント ----
  // 「わからない」と言うと、誰かが遠回しに答える。一日三回まで。そのたびに熱が上がる
  function vague() {
    if (S.sunday) return "ガラスの扉は、日曜にだけ開く。";
    if (anyRec()) return held("eraser") ? "他人の字は、消しゴムで消える。消したあとには、あなたが前に見つけたものが残る。" : "他人の字を消すものが、教室の、番号だけの机に。";
    if (!mine("sign")) return "鳴っている電話には、出ること。声が届かなくても、伝え方はある。";
    if (!mine("like")) return "616の乾燥機は、待てば止まる。止まってすぐの、温かいうちに。";
    if (!mine("hard")) return "校舎のチャイムは、うるさすぎる。保健室に、耳を守るもの。";
    if (!mine("calm")) return "体育館の奥の、せまい部屋。戸を、内側から閉めて。";
    if (!mine("wish")) return S.scriptFixed ? "朝の声が、あなたに訊く。答えるのは、白い部屋で。" : "朝の放送の台本に、消された一行がある。書き足すなら、鉛筆で。";
    if (!S.calFixed) {
      if (!held("strip")) return O.strip.loc === "l7a" ? "日曜は、切り取られて、海に流された。湯船を、いっぱいに。" : "日曜の列を、どこかに置いてきた。";
      if (S.stripWet) return "濡れた紙は、貼れない。乾かすものが、616に。";
      if (!held("tape")) return "貼るものが、保健室の引き出しに。";
      return "切り取られた列に、テープで。";
    }
    return "白い部屋で、眠ること。";
  }
  function hintText() {
    // 危ないときは、まずそれを
    if (isSat() && REC_ROOMS.includes(S.loc)) return "白衣に、長く見られないこと。用が済んだら、すぐ離れる。";
    if (S.loc === "l1c" && S.l1dark) return "暗いあいだは、動かないこと。待てば、灯りは戻る。";
    if (S.t >= 37.6) return isBack(S.loc) ? "熱いね。帰り道か、アーモンドの匂いの水を。" : "熱いね。保健室のベッドか、中庭の夜風。白い部屋で眠ってもいい。";
    if (S.t <= 36.0 && lvOf(S.loc) === "7") return "冷えてきた。上へ、浮かぶこと。";
    switch (S.loc) {
      case "bed":
        if (!S.noteFound) return "枕の下。";
        if (S.wishAsk) return "スピーカーは、返事を待っている。言いたいことを、そのまま。";
        break;
      case "station":
        if (!S.seen.form) return "ファイルを、読むこと。";
        if (!S.seen.handover) return "申し送りノートには、まだ来ていない日のぶんまで書いてある。";
        if (held("strip") && !S.calFixed) return S.stripWet ? "濡れたままでは、貼れない。" : held("tape") ? "カレンダーに、テープで。" : "貼るものがない。";
        if (anyRec() && held("eraser")) return "ファイルの、他人の字を。";
        return "インコは、ここで交わされた言葉を覚えている。耳をすませば。";
      case "passage":
        if (S.call === 1) return "声は届かない。受話器を、二回。";
        if (S.ring) return "電話に、出ること。";
        break;
      case "visit":
        if (S.visitOn) return "仕切りの向こうに、二回。";
        if (S.visitPromise && !S.visited) return isDay("月") ? "座って、待つこと。" : "面会は、月曜だけ。";
        break;
      case "bath":
        if (S.inTub && S.tub >= 3) return "そのまま、潜ること。";
        if (S.tub >= 3) return "湯船に、入ること。";
        if (!S.plug) return "栓をしないと、湯はたまらない。";
        if (!S.faucet) return "蛇口を。";
        return "待てば、たまる。";
      case "linen":
        if (held("strip") && S.stripWet) return "濡れた紙も、乾燥機に入れて回せば乾く。";
        if (O.strip.loc === "dryer" && !S.dryRun) return "乾燥機の中に、乾いたもの。";
        if (!mine("like")) return S.dryRun ? "止まるまで、待つこと。" : S.warmUntil >= S.moves ? (O.towel.loc === "dryer" && O.dryer.closed ? "扉を開けて。温かいうちに。" : "温かいうちに、顔をうずめて。") : "冷めてしまったら、扉を閉めて、もう一度回せばいい。";
        break;
      case "corr2": if (S.carrierIn) return "配達員のすぐあとなら、616の向こうは、別の場所だ。"; break;
      case "front": return S.sunday ? "北へ。" : "ガラスの扉は、日曜にだけ開く。";
      case "court": return "ベンチに座ると、夜風で熱が少し下がる。";
      case "hall": case "shall": return "校舎の約束は、三つ。貼り紙のとおりに。";
      case "sroom":
        if (S.rollDue) return "呼ばれたら、返事を。声でも、手でも、二回でも。";
        if (O.desk.closed) return "番号だけの机の中。";
        break;
      case "hoken":
        if (!mine("hard")) return held("earmuff") ? (S.earOn ? "そのまま、チャイムを待つこと。" : "耳当ては、つけるもの。") : "棚の、黄色いもの。";
        if (!held("tape") && !S.calFixed) return "引き出しの中に、貼るもの。";
        return "熱があるなら、ここのベッドで少し休める。一日一回。";
      case "bcast":
        if (!S.scriptFixed) return held("pencil") ? "消された一行を、書き足すこと。" : "書くものを持ってくること。台本の、消された一行。";
        break;
      case "gym": if (!mine("calm")) return S.yOpen ? "奥へ。" : "重い引き戸の向こう。"; break;
      case "yougu": if (!mine("calm")) return S.yClosed ? "そのまま、じっとしていること。" : "戸を、内側から閉めること。"; break;
      case "l1a": return "矢印のほうへ。帰り道は、背中の616。";
      case "l1b": return "ここには、記録係の道具がそろっている。使うかどうかは、あなたが決める。";
      case "l1c": return "灯りが消えたら、動かないこと。木箱の中に、水。";
      case "l7a": return O.strip.loc === "l7a" ? "壁のカレンダーの、日曜の列。" : "窓の外を、見つめすぎないこと。上へ浮かべば、戻れる。";
      case "l7b": return "突き当たりの先へは、潜らないこと。";
      case "river": return "名前を訊かれている。答え方は、一つではない。";
    }
    return vague();
  }
  function hint() {
    if (S.dkDay !== S.day) { S.dkDay = S.day; S.dk = 0; }
    if (S.dk >= 3) { say("……今日は、もう誰も答えない。", "note"); return; }
    S.dk++;
    say("どこかで、誰かが、質問ではない声で小さく答えた。", "note");
    say("「" + hintText() + "」", "voice");
    addT(isBack(S.loc) ? 0.3 : 0.2, "答えを聞いたぶん、頭が熱くなる。");
  }

  // ---- 動作 ----
  function need(o, verbJa) { if (!o) { say(`何を${verbJa}？`); return false; } return true; }
  const WORDS = [
    { ja: "ここ、どこ？", en: "where", q: true, alt: ["ここどこ", "ここはどこ", "どこ"] },
    { ja: "わたし、だれ？", en: "who am i", q: true, alt: ["わたしだれ", "私誰", "私だれ", "わたしはだれ", "私は誰"] },
    { ja: "この音は？", en: "what sound", q: true, alt: ["この音は", "なんの音", "何の音"] },
    { ja: "あなた、だれ？", en: "who are you", q: true, alt: ["あなただれ", "あなた誰", "誰", "だれ"] },
    { ja: "いつ、帰れるの？", en: "when can i go home", q: true, alt: ["いつ帰れるの", "いつ帰れる", "帰りたい"] },
    { ja: "はい", en: "yes", alt: ["はーい", "返事", "へんじ"] },
    { ja: "613", en: "613", alt: ["６１３", "613番"] },
    { ja: "　", show: "　", en: "space", alt: ["スペース", "空白", "何も言わない", "なにも言わない"] },
    { ja: "わからない", en: "i dont know", alt: ["分からない"] },
    { ja: "本人に聞く", en: "ask the person", alt: ["本人にきく", "本人に訊く", "本人に聞く"] },
    { ja: "外を歩きたい", en: "walk outside", alt: ["外を歩く", "そとをあるきたい", "外に出たい"] },
    { ja: "名前で呼ばれたい", en: "call me by name", alt: ["名前で呼んで", "なまえでよばれたい"] },
    { ja: "ここにいたい", en: "stay here", alt: ["ここにいる"] },
    { ja: "まだ、わからない", en: "not sure yet", alt: ["まだわからない", "まだ分からない"] },
  ];
  const W = ja => WORDS.find(w => w.ja === ja);
  function wordsHere(kind) {
    const out = [];
    if (kind === "write") {
      if (S.loc === "bcast" && !S.scriptFixed) out.push(W("本人に聞く"));
      return out;
    }
    if (S.loc === "bed" && S.wishAsk) for (const w of WISHES) out.push(W(w));
    if (S.loc === "river") { out.push(W("613"), W("　"), W("わからない")); }
    out.push(W("はい"));
    for (const q of QUESTIONS) out.push(W(q));
    return out;
  }
  // 声が届かない場所
  function unheard() {
    if (S.loc === "passage" && S.call === 1) {
      say("声は、受話器の穴に吸いこまれて、向こうへは行かない。", "note");
      say("「もしもし？……やっぱり、聞こえないのね。聞こえてたら、こん、こん、って。二回」", "voice");
      return true;
    }
    if (S.loc === "visit" && S.visitOn) {
      say("声は、すりガラスの手前で、ぽとりと落ちた。向こうには届かないらしい。", "note");
      say("「……いるなら、こん、こん、ってして」", "voice");
      return true;
    }
    return false;
  }
  function sitDown() {
    if (SCHOOL.includes(S.loc) && S.chimeDue) {
      S.chimeDue = 0;
      say(S.loc === "sroom" ? "自分の席に、座る。……チャイムの残響が、ゆっくり消える。廊下の影が、ふっと引いた。" : "その場に、腰を下ろす。……チャイムの残響が、ゆっくり消える。どこかで、影が引いていく気配。");
      return true;
    }
    return false;
  }
  function calmHere() {
    S.yWait++;
    if (S.yWait < 2) { say("暗がりで、じっとする。引き戸の隙間の光の線だけを見ている。自分の呼吸の音が、ゆっくりになっていく。"); return; }
    if (!S.mine.calm) {
      say("……誰にも見られていない。誰にも、何も訊かれない。マットの匂い。");
      say("熱が、すうっと引いていく。ここなら、ずっといられる気がした。");
      if (S.t > 36.5) S.t = 36.5;
      setField("calm", "体育館の用具室（せまくて、暗いところ）");
      return;
    }
    say("暗がりで、じっとする。落ち着いている。");
    if (S.t > 36.5) addT(-0.1, "");
  }
  const VERB_DO = {
    look: () => describe(true),
    inventory: () => {
      const h = Object.values(O).filter(o => o.loc === "player");
      if (!h.length) { say("何も持っていない。"); return; }
      say("持ち物：");
      for (const o of h) say(o.name + (o.id === "earmuff" && S.earOn || o.id === "vest" && S.vestOn ? "（身につけている）" : ""), "indent");
    },
    wait: () => {
      if (sitDown()) return;
      switch (S.loc) {
        case "bed": say(S.wishAsk ? "スピーカーが、ぷつぷつと鳴りつづけている。返事を待っている。" : S.sunday ? "静かだ。廊下に、誰もいない。" : "白い天井の染みを数える。数えるたびに、数が合わない。"); return;
        case "linen": if (S.dryRun) { say("乾燥機の前で、待つ。ごうん、ごうん。丸い窓の中で、白いものが回る。"); return; } break;
        case "visit":
          if (S.visitOn) { say("すりガラスの向こうの輪郭も、じっと待っている。"); return; }
          if (isDay("月") && S.visitPromise && !S.visited) { S.visitWait++; if (S.visitWait >= 2) visitStart(); else say("待つ。廊下の時計の音が、ここまで届く。"); return; }
          say("誰も来ない。花瓶の水が、ひとりでに少し減った気がした。"); return;
        case "yougu": if (S.yClosed) { calmHere(); return; } break;
        case "passage": if (S.call === 1) { say("受話器の向こうでも、相手が待っている。息の音。"); return; } break;
        case "l1c": if (S.l1dark) { S.l1dark = false; S.l1w = 0; fx("flicker", 3); say("息を止めて、じっとする。……灯りが、何度かまたたいてから戻った。"); say("さっきより、シャッターの下の暗がりが、近い。", "note"); return; } break;
        case "l1b": if (S.radioAsk) { say("無線機の赤いランプが、点滅しつづけている。"); return; } break;
        case "l7a": case "l7b": say("水が、ゆっくり揺れる。体の熱が、少しずつ水に溶けていく。"); return;
        case "river": say("配達員は、封筒を持ったまま待っている。「あの、お名前は……」"); return;
        case "bath": if (S.faucet) { say("湯気の中で、待つ。"); return; } break;
        case "court": say("夜風。銀杏の葉は、やっぱり一枚も落ちてこない。"); return;
      }
      say("時間が過ぎる。" + (hot() ? "頭の右上で、鉄の球がゆっくり揺れている。" : ""));
    },
    hint: () => hint(),
    dunno: () => {
      if (S.loc === "river") { say("「わからない」", "voice"); endUnknown(); return; }
      if (S.loc === "bed" && S.wishAsk) { say("「……まだ、わからない」", "voice"); answerWish("まだ、わからない"); return; }
      if (unheard()) return;
      if (SCHOOL.includes(S.loc) && !S.sunday && S.handUp !== S.moves - 1) {
        say("「わからない」", "voice");
        ruleBreak("hand");
        return;
      }
      if (S.loc === "l1c" && S.l1dark) { darkMove(); return; }
      say(SCHOOL.includes(S.loc) ? "手をあげたまま、「わからない」と言った。" : "「わからない」", SCHOOL.includes(S.loc) ? "" : "voice");
      hint();
    },
    raise: () => {
      S.handUp = S.moves;
      if (S.loc === "sroom" && S.rollDue) { S.rollDue = 0; say("手をあげる。「……はい、613番、出席」名簿に、丸のつく音。"); return; }
      if (SCHOOL.includes(S.loc)) { say("手をあげる。……どこかで、チョークが黒板に当たる音。当てられるのを、待っている。"); return; }
      if (S.loc === "l1b" && S.radioAsk) { say("手をあげる。……無線機には、見えない。"); return; }
      say("手をあげた。誰も、当てない。");
    },
    cover: () => {
      if (SCHOOL.includes(S.loc) && S.chimeAt >= S.moves - 1) {
        say("両手で、耳をふさぐ。チャイムの残りが、手のひらの向こうで遠くなる。……少し、楽になった。");
        if (!S.mine.hard) { say("ずっと、これが苦手だったのだ。急に鳴る、大きな音が。"); setField("hard", "急に鳴る、大きな音"); }
        return;
      }
      if (held("earmuff") && !S.earOn) { VERB_DO.wear(O.earmuff); return; }
      say("両手で、耳をふさぐ。自分の血の流れる音だけが、残った。");
    },
    listen: () => {
      switch (S.loc) {
        case "bed": say(S.dark.bed ? "明かりを消すと、うなりも消えた。自分の呼吸だけ。" : "蛍光灯のうなり。廊下の遠くで、カートの車輪が鳴っている。"); return;
        case "corr": say("どの扉の向こうからも、物音がしない。612の中からだけ、寝息のような音。"); return;
        case "corr2": say(S.carrierIn ? "616の中から、何の音もしない。乾燥機も、止まっている。" : "616の中で、乾燥機の回る音。615の中で、水の垂れる音。614の壁の中は、しんとしている。"); return;
        case "station":
          if (isSat()) { say("ペンが紙の上を走る音。一度も、止まらない。", "warn"); return; }
          say("インコが、羽をふくらませて、ぼそりと言った。");
          say("「" + parrot() + "」", "voice");
          return;
        case "visit": say(S.visitOn ? "すりガラスの向こうで、小さな咳払い。" : "時計の音。誰かを待つための、静かな部屋の音。"); return;
        case "bath": say(S.faucet ? "湯の落ちる音が、タイルに反響している。" : "蛇口から、一滴ずつ。湯船の底の穴から、遠い波のような音。"); return;
        case "linen": say(S.dryRun ? "ごうん、ごうん。乾燥機の中で、ボタンが一つ、ドラムに当たる音。" : "乾燥機の、冷めていく金属の音。"); return;
        case "front": say("ガラスの向こうで、車の音。ガラス一枚ぶん、遠い。"); return;
        case "court": say("夜風。遠くの国道。中庭を囲む窓のどこかで、ナースコールのチャイムが鳴って、すぐ止んだ。"); return;
        case "passage": say(S.ring ? "公衆電話が鳴っている。" : S.call === 1 ? "受話器の向こうで、年をとった女の人の息の音。その後ろで、川の音。" : "風が、渡り廊下の窓を鳴らす。"); return;
        case "hall": say("下駄箱の蓋が、どこかで一つ、ぱたんと閉まった。"); return;
        case "shall": say("秒針の音。どの時計も、同じ秒を刻んでいる。……一つだけ、半拍遅れている。"); return;
        case "sroom": say("誰もいないのに、鉛筆が紙をこする音がする。どの机からかは、分からない。"); return;
        case "hoken": say("カーテンの向こうのベッドで、誰かが寝返りを打つ音。……カーテンを開けても、誰もいないのだろう。"); return;
        case "bcast": say(S.micOn ? "マイクが、自分の呼吸を拾っている。遠くの病棟のどこかで、その呼吸が鳴っている。" : "機械の、小さなうなり。"); return;
        case "gym": say("ボールの転がる音。舞台の幕の向こうで、パイプ椅子を並べる音。"); return;
        case "yougu": say(S.yClosed ? "何も聞こえない。……自分の心臓の音だけが、ゆっくり。" : "体育館の、ボールの転がる音。"); return;
        case "river": say("川の音。車の音。どれも、ガラス越しではない。"); return;
        case "l1a": say("蛍光灯のうなり。どこかで、水たまりに水滴の落ちる音。遠くで、無線の声。"); return;
        case "l1b": VERB_DO.listenTo(O.radio); return;
        case "l1c": say(S.l1dark ? "暗闇で、コンクリートを擦る音。こちらの呼吸に合わせて、止まる。" : "シャッターの下の暗がりから、ときどき、何かが床を擦る音。"); return;
        case "l7a": say("水の音。窓の外の海から、低い、長い音。鯨の声に似ているが、もっと大きい。"); return;
        case "l7b": say("突き当たりの海から、泡の上がってくる音。"); return;
      }
      say("何も聞こえない。");
    },
    help: () => say("遊び方：「命令を作る」で、動詞 → 物（「言う」「書く」ならことば）の順にタップする。方角のボタンで移動し、「上」「下」で上下に動く。「わからない」と言うと、誰かが小さく答えることがある。そのたびに、熱が少し上がる。≡ のメニューに、もとにした記事の名前がある。", "note"),
    sleep: () => {
      if (S.loc === "hoken") {
        if (S.restDay === S.day) { say("もう、眠れない。カーテンの外の秒針が、うるさい。"); return; }
        S.restDay = S.day;
        say("保健室のベッドで、少し横になる。カーテンの外で、時計の秒針。……熱が、少し引いた。");
        if (S.t > 36.6) S.t = 36.6;
        return;
      }
      if (S.loc === "yougu") { if (S.yClosed) { say("マットに横になる。眠りはしない。でも、目を閉じていられる。"); calmHere(); return; } say("戸が開いていると、眠れない。"); return; }
      if (isBack(S.loc)) { say("目を閉じても、ここでは眠れない。眠ったら、戻れない気がする。"); return; }
      if (S.loc !== "bed") { say("ここでは、眠れない。"); return; }
      say("ベッドに横になり、目を閉じる。羽虫の影が、まぶたの裏に残る。");
      say("……眠る。夢は見ない。");
      gap();
      nextDay(false);
      morning();
      describe(true);
    },
    run: () => {
      if (S.loc === "l1c" && S.l1dark) { darkMove(); darkMove(); return; }
      if (S.loc === "l7a" || S.loc === "l7b") { say("水の中では、走れない。水が、足を引きとめる。"); return; }
      if (SCHOOL.includes(S.loc)) { say("走りかけて、やめた。廊下は走らない。……そんな約束は、なかったはずなのに。"); return; }
      if (S.loc === "corr" || S.loc === "corr2") { say("廊下を走る。614の印の前を、通りすぎた。振り返っても、壁しかない。"); return; }
      say("走る理由が、見つからない。");
    },
    examine: (o) => {
      if (!need(o, "調べる")) return;
      if (o.id === "sea") { seaLook(); return; }
      if (o.id === "booth" && S.ring) { say(text(o.desc)); say("出るなら、受話器を取る。", "note"); return; }
      say(text(o.desc) || `${o.name}に、特に変わったところはない。`);
    },
    read: (o) => {
      if (!need(o, "読む")) return;
      if (!o.read) { VERB_DO.examine(o); return; }
      say(text(o.read));
    },
    take: (o) => {
      if (!need(o, "取る")) return;
      if (o.loc === "player") { say("もう持っている。"); return; }
      if (o.id === "booth" || o.id === "sphone") { answerPhone(); return; }
      if (o.id === "tekkyu") { say("手を伸ばしても、触れない。触れられるのは、本物だけだ。"); return; }
      if (o.id === "inko") { say("インコは、籠から出ようとしない。くちばしで、指をつついた。"); return; }
      if (["recorder", "toban", "courier"].includes(o.id)) { say("触れようとは、思えない。"); return; }
      if (o.id === "letter") { say("配達員は、封筒を渡そうとしない。「お名前を、うかがってから」"); return; }
      if (o.id === "form") { say("ファイルは、ファイル立てに鎖でつないである。ここで読むものらしい。"); return; }
      if (o.id === "towel" && S.dryRun) { say("乾燥機は、回っている。"); return; }
      if (o.id === "strip" && O.strip.loc === "l7a") {
        o.loc = "player"; o.scenery = false;
        say("日曜の列を、壁のカレンダーからそっと剥がした。濡れて、指の形に破れそうだ。");
        sfx("splash");
        return;
      }
      if (o.id === "strip" && O.strip.loc === "dryer" && S.dryRun) { say("乾燥機は、回っている。"); return; }
      if (!o.take) { say(`${o.name}は取れない。`); return; }
      o.loc = "player"; o.scenery = false;
      say(`${o.name}を取った。`);
      if (o.id === "charm") say("小さいのに、少し重い。", "note");
      if (o.id === "clip" && S.vestOn && S.loc === "l1b") radioCall();
      if (o.id === "earmuff") say("つけるなら、身につける。", "note");
    },
    drop: (o) => {
      if (!need(o, "置く")) return;
      if (o.loc !== "player") { say(`${o.name}は持っていない。`); return; }
      if (S.loc === "river") { say("ここに置いたら、もう取りに来られない気がする。"); return; }
      if (S.loc === "l7a" || S.loc === "l7b") { say("ここに置いたら、水に流されてしまう。"); return; }
      o.loc = S.loc; o.scenery = false;
      if (o.id === "earmuff") S.earOn = false;
      if (o.id === "vest") S.vestOn = false;
      say(`${o.name}を置いた。`);
    },
    put: (o, w) => {
      if (!need(o, "入れる")) return;
      const pl = [o, w].find(x => x && x.id === "plug");
      if (pl) {
        if (S.loc !== "bath") { say("ここに、はめるところはない。"); return; }
        if (S.plug) { say("栓は、もうはめてある。"); return; }
        if (S.inTub) { say("湯船の中からでは、うまくはまらない。"); return; }
        S.plug = true; sfx("clang");
        say("鎖を引いて、ゴムの栓を、湯船の底の穴にはめた。");
        return;
      }
      if (o.id === "strip" && (!w || ["cal", "tape"].includes(w.id))) { paste(); return; }
      if (w && w.id === "dryer") {
        if (o.loc !== "player") { say(`${o.name}を持っていない。`); return; }
        if (S.dryRun) { say("乾燥機は、回っている。"); return; }
        if (O.dryer.closed) { say("乾燥機の扉が、閉まっている。"); return; }
        o.loc = "dryer";
        say(`${o.name}を、乾燥機の中に入れた。`);
        return;
      }
      if (o.id === "earmuff" || o.id === "vest" || o.id === "uwabaki") { VERB_DO.wear(o); return; }
      if (!w && ["dryer", "mic", "faucet", "radio"].includes(o.id)) { VERB_DO.lighton(o); return; }
      if (w && w.id === "cal") { say("カレンダーに貼れるのは、カレンダーの紙だけだ。"); return; }
      say("そうしても、何も起きない。");
    },
    open: (o) => {
      if (!need(o, "開ける")) return;
      switch (o.id) {
        case "d611": if (S.loc === "corr") { go("e"); return; } break;
        case "d613": if (S.loc === "corr") { go("s"); return; } break;
        case "d615": if (S.loc === "corr2") { go("w"); return; } break;
        case "d616": if (S.loc === "corr2") { go("e"); return; } break;
        case "d616b": go("e"); return;
        case "d612": say("612の扉には、取っ手がない。押しても、びくともしない。"); return;
        case "glass": go("n"); return;
        case "tub": VERB_DO.sit(o); return;
        case "faucet": VERB_DO.lighton(o); return;
        case "window": say("窓は、はめ殺しだ。開かない。"); return;
        case "sea": say("窓を開けたら、海が全部、部屋に入ってくる。"); return;
        case "ydoor":
          if (S.loc === "yougu") { if (!S.yClosed) { say("もう開いている。"); return; } S.yClosed = false; say("引き戸を開ける。体育館の灯りが、四角く差しこんだ。"); return; }
          if (S.yOpen) { go("n"); return; }
          S.yOpen = true; sfx("clang");
          say("重い引き戸に両手をかけて、横へ引いた。……ごろごろと、レールの鳴る音。中は暗い。マットの匂い。");
          return;
        case "dryer":
          if (S.dryRun) { say("回っているあいだは、扉が開かない。"); return; }
          if (!O.dryer.closed) { say("もう開いている。"); return; }
          O.dryer.closed = false;
          say("乾燥機の扉を開ける。乾いた熱が、顔にふわりと当たった。");
          { const inside = Object.values(O).filter(x => x.loc === "dryer"); say(inside.length ? `中に、${inside.map(x => x.name).join("、")}。` : "中は、空だ。"); }
          if (S.warmUntil >= S.moves && O.towel.loc === "dryer") say("タオルは、まだ温かい。", "note");
          return;
        case "crates": say("釘で打ちつけてあって、素手では開かない。"); return;
        case "charm": say(O.charm.read); return;
        case "doors7": say("水圧で、どの扉も開かない。"); return;
      }
      if (o.container) {
        if (!o.closed) { say("もう開いている。"); return; }
        o.closed = false;
        const inside = Object.values(O).filter(x => x.loc === o.id);
        say(`${o.name}を開けた。` + (inside.length ? `中に、${inside.map(x => x.name).join("、")}。` : "中は、空だ。"));
        if (o.id === "shoebox") say("上履きのつま先が、きちんとそろえてある。", "note");
        return;
      }
      say(`${o.name}は、開けるものではない。`);
    },
    close: (o) => {
      if (!need(o, "閉める")) return;
      if (o.id === "faucet") { VERB_DO.lightoff(o); return; }
      if (o.id === "ydoor") {
        if (S.loc === "yougu") {
          if (S.yClosed) { say("もう閉まっている。"); return; }
          S.yClosed = true; S.yWait = 0; sfx("clang");
          say("内側から、引き戸を閉めた。……まっくらになった。");
          say("隙間から、体育館の灯りが一本の線になって入ってくる。マットの古いゴムの匂い。跳び箱の、木の匂い。");
          return;
        }
        if (!S.yOpen) { say("もう閉まっている。"); return; }
        S.yOpen = false; say("引き戸を閉めた。");
        return;
      }
      if (o.container) {
        if (o.closed) { say("もう閉まっている。"); return; }
        o.closed = true;
        say(`${o.name}を閉めた。`);
        return;
      }
      say(`${o.name}は、閉めるものではない。`);
    },
    press: (o) => {
      if (!need(o, "押す")) return;
      switch (o.id) {
        case "call":
          sfx("beep");
          say("ナースコールを押す。……天井のスピーカーが、ぷつ、と鳴った。");
          say("「613さん、どうしましたか？」", "voice");
          say("答えようとして、言葉が見つからない。");
          say("「……はい、特に変わりなしですね」ぷつり。", "voice");
          return;
        case "booth": case "sphone": answerPhone(); return;
        case "dryer": case "faucet": case "mic": VERB_DO.lighton(o); return;
        case "radio": radioCall(); return;
        case "ball": say("ボールを押さえる。……手を離すと、また用具室の引き戸のほうへ転がっていく。"); return;
        case "d612": VERB_DO.knock(o); return;
        case "partition": if (S.visitOn) { visitKnock(); return; } say("すりガラスは、ひんやりしている。"); return;
      }
      say(`${o.name}に触れた。何も起きない。`);
    },
    lighton: (o) => {
      if (!need(o, "点ける")) return;
      if (o.id === "lamp") {
        if (!S.dark.bed) { say("もう点いている。"); return; }
        S.dark.bed = false; fx("flicker", 3);
        say("蛍光灯を点けた。何度かまたたいてから、白い光が戻る。窓が、また鏡に戻った。");
        return;
      }
      if (o.id === "faucet") {
        if (S.faucet) { say("湯は、もう出ている。"); return; }
        S.faucet = true; sfx("drip");
        say("蛇口をひねる。湯が、どうどうと出はじめた。" + (S.plug ? "" : "……栓をしていない湯船の底の穴に、湯が吸いこまれていく。"));
        return;
      }
      if (o.id === "dryer") {
        if (S.dryRun) { say("乾燥機は、もう回っている。"); return; }
        if (!O.dryer.closed) { say("扉が開いていると、回らない。"); return; }
        S.dryRun = true; S.dryT = 0; sfx("hum");
        say("大きなスイッチを押す。乾燥機が、ごうん、と回りはじめた。");
        return;
      }
      if (o.id === "mic") {
        if (S.micOn) { say("もう入っている。"); return; }
        S.micOn = true; sfx("beep");
        say("マイクのスイッチを入れる。赤いランプ。……つまみは「病棟」になっている。何か言えば、613の天井から聞こえるのだろうか。");
        return;
      }
      if (o.id === "radio") { radioCall(); return; }
      if (["earmuff", "vest", "uwabaki"].includes(o.id)) { VERB_DO.wear(o); return; }
      say("点けるものではない。");
    },
    lightoff: (o) => {
      if (!need(o, "消す")) return;
      if (o.id === "form") { erase(); return; }
      if (o.id === "lamp") {
        if (S.dark.bed) { say("もう消えている。"); return; }
        S.dark.bed = true; fx("flicker", 1);
        say("蛍光灯を消した。うなりが止む。窓が、鏡であることをやめた。外は、思ったより明るい。");
        return;
      }
      if (o.id === "faucet") {
        if (!S.faucet) { say("もう閉まっている。"); return; }
        S.faucet = false;
        say("蛇口を閉めた。湯の音が止んで、浴室が急に広くなった気がする。");
        return;
      }
      if (o.id === "mic") { if (!S.micOn) { say("もう切れている。"); return; } S.micOn = false; say("マイクのスイッチを切った。赤いランプが消える。"); return; }
      if (o.id === "dryer") { if (!S.dryRun) { say("もう止まっている。"); return; } say("止めるスイッチは、見当たらない。止まるまで、待つしかない。"); return; }
      if (o.id === "ydoor") { VERB_DO.close(o); return; }
      say("消すものではない。");
    },
    erase: (o) => {
      if (o && o.id !== "form" && o.id !== "eraser") { say(`${o.name}は、消しゴムでは消えない。`); return; }
      erase();
    },
    drink: (o) => {
      if (!need(o, "飲む")) return;
      if (o.id === "almond") {
        if (o.loc !== "player" && o.loc !== S.loc) { say("ここにはない。"); return; }
        o.loc = "gone";
        say("アーモンド水を飲む。ほんのり甘い。喉の奥から、熱がすうっと引いていく。");
        if (S.t > 36.5) addT(-Math.min(0.6, S.t - 36.5), "");
        return;
      }
      if (o.id === "faucet" || o.id === "tub") { say("飲む水ではない。"); return; }
      if (o.id === "sea" || o.id === "deep") { say("塩辛い。……飲むものではない。"); return; }
      say("飲めるものではない。");
    },
    knock: (o) => {
      if (S.loc === "passage" && S.call === 1) { phoneKnock(); return; }
      if (S.loc === "visit" && S.visitOn) { visitKnock(); return; }
      if (S.loc === "river") { endReply(); return; }
      if (S.loc === "sroom" && S.rollDue) {
        S.rollDue = 0; sfx("knock");
        say("机を、こん、こん、と二回たたいた。");
        say("……少し間があって。「613番は……出席」名簿に、丸のつく音がした。", "voice");
        return;
      }
      if (S.loc === "bed" && S.wishAsk) { sfx("knock"); say("ベッドの柵を、こん、こん。……スピーカーは、ぷつぷつと鳴りながら、言葉を待っている。"); return; }
      if (S.loc === "l1b" && S.radioAsk) { sfx("knock"); say("無線機を、こん、こん。「……応答が聞き取れない。もう一度、声で」", "voice"); return; }
      sfx("knock");
      if (o && o.id === "d612") { say("612の扉を、こん、こん、と叩く。……中から、こん、こん、と二回、叩き返された。"); fx("glitch"); return; }
      if (o && o.id === "booth") { say("受話器を叩いても、ツーという音もしない。今は、誰ともつながっていない。"); return; }
      if (o && o.id === "partition") { say("すりガラスを、こん、こん。……向こうの椅子は、空いている。"); return; }
      if (o && o.id === "mark") { say("614の印の壁を、こん、こん。……壁の中が、少しだけ空洞の音をした。"); return; }
      say(o ? `${o.name}を、こん、こん、と二回たたいた。` : "こん、こん。二回たたいた。");
    },
    smell: (o) => {
      if (!need(o, "嗅ぐ")) return;
      if (o.id === "sheets") { say("シーツに顔を近づける。洗剤と、棚の木の匂い。冷たい。"); return; }
      if (o.id === "towel") {
        const t = O.towel;
        if (S.warmUntil >= S.moves) {
          say("温かいバスタオルに、顔をうずめる。乾燥機の熱と、洗剤と、日なたのような匂い。");
          say("……息が、深くなる。肩から、力が抜けていく。");
          if (!S.mine.like) { say("ずっと、これが好きだったのだ。"); setField("like", "乾燥機から出したばかりのタオルの匂い"); }
          if (S.t > 36.5) addT(-0.1, "");
          t.loc = t.loc === "dryer" ? "player" : t.loc;
          return;
        }
        say("タオルに顔をうずめる。……もう冷めている。洗剤の匂いだけ。温かいうちなら、と思う。");
        return;
      }
      if (o.id === "mats") { say("古いゴムの匂い。たくさんの子どもの、汗の匂い。……嫌いではない。"); return; }
      if (o.id === "almond") { say("アーモンドの、甘い匂い。"); return; }
      if (o.id === "faucet" || o.id === "tub") { say("湯気の匂い。少しだけ、塩の匂いがまじっている。"); return; }
      if (o.id === "charm") { say("古い布と、線香のような匂い。"); return; }
      say(`${o.name}の匂いを嗅ぐ。特に、何の匂いもしない。`);
    },
    wear: (o) => {
      if (!need(o, "身につける")) return;
      if (o.id === "earmuff") {
        if (S.earOn) { say("もう、つけている。"); return; }
        if (!near("earmuff")) { say("ここにはない。"); return; }
        O.earmuff.loc = "player"; O.earmuff.scenery = false; S.earOn = true;
        say("耳当てを、つける。世界の音が、一枚ぶん遠くなった。自分の呼吸が、近い。");
        return;
      }
      if (o.id === "uwabaki") {
        if (!near("uwabaki")) { say("ここにはない。"); return; }
        O.uwabaki.loc = "player"; O.uwabaki.scenery = false;
        say("上履きを履く。……つま先まで、ぴったりだ。かかとの名前の欄が、空いたまま。");
        return;
      }
      if (o.id === "vest") {
        if (S.vestOn) { say("もう、着ている。"); return; }
        if (!near("vest")) { say("ここにはない。"); return; }
        O.vest.loc = "player"; O.vest.scenery = false; S.vestOn = true;
        say("反射ベストを着る。背中に、「記録係」の文字。……驚くほど、体に合う。");
        if (S.loc === "l1b" && held("clip")) radioCall();
        return;
      }
      say("身につけるものではない。");
    },
    listenTo: (o) => {
      if (!o) { VERB_DO.listen(); return; }
      if (o.id === "booth" || o.id === "sphone") { if (S.loc === "passage" && S.ring) { answerPhone(); return; } VERB_DO.listen(); return; }
      if (o.id === "inko") { if (isSat()) { say("インコは、白衣のほうを見たまま、黙っている。"); return; } say("インコに、耳を近づける。"); say("「" + parrot() + "」", "voice"); return; }
      if (o.id === "radio") { if (S.radioAsk) { say("「……記録係。応答せよ」", "voice"); return; } radioCall(); return; }
      if (o.id === "speaker") { say(S.wishAsk ? "スピーカーは、ぷつぷつと鳴りながら、返事を待っている。" : "網の目の奥で、遠くの紙をめくる音がする。"); return; }
      if (o.id === "d612") { say("612の扉に、耳を当てる。寝息。……自分の寝息と、同じ間隔だ。"); return; }
      if (o.id === "sea") { say("窓に耳を当てる。低い、長い音。ずっと下から。"); return; }
      VERB_DO.listen();
    },
    say: (w) => {
      if (!w) { say("何と言う？　「命令を作る」の「言う」から選べる。"); return; }
      const sh = w.show || w.ja;
      say(`「${sh}」`, "voice");
      if (S.loc === "river") {
        if (w.ja === "613") { endNumber(); return; }
        if (w.ja === "　") { endBlank(); return; }
        if (w.ja === "わからない") { endUnknown(); return; }
        say("配達員は、首をかしげた。「……ええと、お名前は？」");
        return;
      }
      if (S.loc === "bed" && S.wishAsk && WISHES.includes(w.ja)) { answerWish(w.ja); return; }
      if (S.loc === "l1b" && S.radioAsk) {
        if (w.ja === "はい") { endAssign(); return; }
        S.radioAsk = false;
        say("「……応答、不明瞭。空きは、ほかで埋める」ランプが、緑に戻った。", "voice");
        return;
      }
      if (unheard()) return;
      if (S.loc === "sroom" && S.rollDue && w.ja === "はい") { S.rollDue = 0; say("「613番、出席」……名簿に、丸のつく音。", "voice"); return; }
      if (w.ja === "わからない") { VERB_DO.dunno(); return; }
      if (S.loc === "bcast" && S.micOn) { say("自分の声が、スピーカーを通って、遠くの病棟の廊下で鳴った。……誰も、返事をしない。", "note"); return; }
      if (S.loc === "station" && !isSat()) { say(`インコが首をかしげて、まねをした。「${sh === "　" ? "……" : sh}」`, "voice"); return; }
      if (S.loc === "bed" && S.wishAsk) { say("スピーカーは黙って、まだ待っている。……訊かれたのは、どうしたいか、だ。", "note"); return; }
      if (w.ja === "はい") { say("誰も、何も訊いていない。"); return; }
      if (w.ja === "　") { say("何も言わなかった。誰も、気づかない。"); return; }
      if (w.ja === "613") { say("自分の番号を言ってみた。廊下の向こうで、カートの車輪が一度だけ鳴った。"); return; }
      if (w.q) {
        if (SCHOOL.includes(S.loc)) { say("質問は、天井の近くへ吸いこまれていった。答えは来ない。"); return; }
        if (isBack(S.loc)) { say("声は、すぐに水か、コンクリートに吸われた。"); return; }
        say(pick(["誰も答えない。蛍光灯のうなりだけ。", "答えのかわりに、遠くでカートの車輪が鳴った。", "どこかのスピーカーが、ぷつ、と鳴って、何も言わなかった。"]));
        return;
      }
      say("誰も、答えない。");
    },
    write: (w) => {
      if (S.loc !== "bcast") { say("ここには、書くところがない。"); return; }
      if (!held("pencil")) { say("書くものを持っていない。"); return; }
      if (S.scriptFixed) { say("もう、書き足してある。"); return; }
      if (!w || w.ja !== "本人に聞く") { say("台本の余白に、何を書けばいいのか、分からない。消された一行を、もう一度読んでみる。"); return; }
      S.scriptFixed = true;
      sfx("scratch");
      say("台本の三の行。赤い二重線の横に、短い鉛筆で、一文字ずつ書き足した。「本人に聞く」");
      say("赤い「不要」の字が、鉛筆の字の下で、少しだけ薄くなった気がした。", "note");
      fx("truism", "ASK THE PERSON", "本人に聞け", "放送室");
    },
    sit: (o) => {
      if (o && ["ydoor", "d611", "d613", "d615", "d616", "d616b", "glass"].includes(o.id)) { VERB_DO.open(o); return; }
      if (sitDown()) return;
      if (S.loc === "bath" || o && o.id === "tub") {
        if (S.loc !== "bath") { say("ここに、湯船はない。"); return; }
        if (S.inTub) { say("もう、湯船の中にいる。"); return; }
        if (S.tub < 3) { say(S.tub ? "湯が、まだ半分しかない。" : "湯船は、空だ。"); return; }
        S.inTub = true; sfx("splash");
        say("湯船に、肩まで体を沈める。湯は、ちょうど体温くらいだ。……底に、足が届かない。");
        return;
      }
      switch (S.loc) {
        case "court":
          if (S.benchDay === S.day) { say("ベンチに座る。夜風。"); return; }
          S.benchDay = S.day;
          say("ベンチに座る。夜風が、首すじを通っていく。四角い夜空に、星が一つ。");
          if (S.t > 36.5) addT(-Math.min(0.3, S.t - 36.5), "熱が、少しだけ夜風に取られていく。");
          return;
        case "visit":
          if (S.visitOn) { say("もう座っている。すりガラスの向こうの輪郭と、向かい合って。"); return; }
          if (isDay("月") && S.visitPromise && !S.visited) { S.visitWait++; say("こちら側の椅子に座る。座面が、少し温かい。"); if (S.visitWait >= 2) visitStart(); return; }
          say("こちら側の椅子に座る。向こうの椅子は、空いたまま。"); return;
        case "yougu": if (S.yClosed) { say("マットの上に、膝を抱えて座る。"); calmHere(); return; } say("マットに座る。開いた戸から、灯りが差しこむ。"); return;
        case "sroom": say("自分の席に座る。机の天板に、誰かが彫った細い線。「ここにいる」"); return;
        case "river": say("土手の草に座る。配達員も、封筒を持ったまま待っている。"); return;
      }
      say("その場に座る。……何も起きない。");
    },
    lookback: () => {
      if (S.loc === "l1c" && S.l1dark) { say("振り向く。暗闇が、こちらを向いた気がした。……動いてはいない。たぶん。", "warn"); return; }
      if (S.loc === "l7a") { say("振り向く。窓の外の影が、さっきより大きい。", "note"); return; }
      if (isSat() && REC_ROOMS.includes(S.loc)) { say("振り向くと、クリップボードの用紙が、こちらを向いていた。", "warn"); return; }
      say(pick(["振り向く。誰もいない。", "振り向く。……さっきまで誰かがいた場所の空気だけが、少し温かい。", "振り向く。自分の影が、半拍遅れてついてきた。"]));
    },
    down: () => go("d"),
    up: () => go("u"),
  };

  // ---- 命令を読む ----
  const EN_SIMPLE = [
    ["look", /^(look|l)$/], ["inventory", /^(inventory|i)$/], ["wait", /^(wait|z)$/], ["hint", /^hint$/], ["help", /^help$/],
    ["listen", /^listen$/], ["dunno", /^(dunno|i don'?t know)$/], ["sleep", /^sleep$/], ["run", /^run$/],
    ["sit", /^sit( down)?$/], ["lookback", /^look back$/], ["down", /^(descend|dive|swim down)$/], ["up", /^(ascend|float|swim up)$/],
    ["raise", /^raise( hand| hands)?$/], ["cover", /^cover( ears)?$/], ["knock", /^(knock|knock twice|tap)$/],
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
    s = String(s || "").trim().toLowerCase();
    return WORDS.find(w => w.en === s || w.ja.toLowerCase() === s || (w.alt || []).some(a => a.toLowerCase() === s)) || null;
  }
  function findWordIn(s) {
    let best = null, len = 0;
    for (const w of WORDS) for (const a of [w.ja, ...(w.alt || [])]) if (a.trim() && a.length > len && s.includes(a.replace(/[、？]/g, ""))) { best = w; len = a.length; }
    return best;
  }
  function parseEn(cmd) {
    cmd = cmd.toLowerCase().replace(/\s+/g, " ").trim();
    for (const [v, rx] of EN_SIMPLE) if (rx.test(cmd)) return { v };
    const g = cmd.replace(/^go /, "");
    if (DIR_WORDS[g]) return { v: "go", dir: DIR_WORDS[g] };
    const sm = cmd.match(/^say (.+)$/);
    if (sm) return { v: "say", w: findWord(sm[1]) };
    const wm = cmd.match(/^write (.+)$/);
    if (wm) return { v: "write", w: findWord(wm[1]) };
    if (cmd === "write") return { v: "write", w: null };
    const pats = [
      ["put", /^(?:put|insert|place|glue|stick|paste|tape) (.+) (?:in|into|on|onto|to) (.+)$/], ["put", /^(?:put|insert|glue|stick|paste|plug) (.+)$/],
      ["open", /^open (.+)$/], ["close", /^(?:close|shut) (.+)$/], ["lighton", /^(?:light|turn on|switch on|start) (.+)$/],
      ["lightoff", /^(?:douse|turn off|switch off|stop) (.+)$/], ["erase", /^(?:erase|rub out|rub) (.+)$/], ["drink", /^drink (.+)$/],
      ["press", /^(?:press|push|touch) (.+)$/], ["knock", /^(?:knock|tap)(?: on)? (.+)$/], ["smell", /^(?:smell|sniff|hug) (.+)$/],
      ["wear", /^(?:wear|put on) (.+)$/], ["listenTo", /^listen (?:to )?(.+)$/],
      ["examine", /^(?:examine|x|look at|look out) (.+)$/], ["read", /^read (.+)$/],
      ["take", /^(?:take|get|pick up|answer) (.+)$/], ["drop", /^drop (.+)$/], ["sit", /^(?:sit|get) (?:on|at|in|into) (.+)$/],
    ];
    for (const [v, rx] of pats) { const m = cmd.match(rx); if (m) return { v, a: m[1], b: m[2] }; }
    return null;
  }
  // 先に当たったものを動詞にする。物の名前の部分は伏せてから探すので、名前の中の字は動詞にならない
  const JA_VERBS = [
    ["dunno", /わからな|分からな/],
    ["say", /と言う|って言う|と言って|と答え|を言う|と叫ぶ|と呟く|と口にする|と訊く|と聞く|言う$/],
    ["write", /書く|書いて|書き|書こう|記入/],
    ["raise", /手をあげ|手を上げ|手を挙げ|挙手/],
    ["cover", /耳をふさ|耳を塞/],
    ["erase", /消しゴム|こする|こすって|擦る/],
    ["knock", /叩く|叩いて|叩き|たたく|たたいて|ノック|こんこん/],
    ["smell", /嗅ぐ|嗅いで|匂いを|においを|うずめ|埋め|抱きしめ|抱く/],
    ["lookback", /振り向|振り返|ふりむ|ふりかえ|後ろを見/],
    ["sleep", /寝る|眠る|寝て|眠って|休む|横にな|^ねる$/], ["run", /走る|走って|駆け/],
    ["up", /上る|登る|上がる|のぼる|浮かぶ|浮かび|浮く/], ["down", /降りる|おりる|下りる|降りて|潜る|もぐる|潜って|沈む/],
    ["wear", /身につけ|着る|着て|履く|はく|かぶる|耳に当て|つけてみ/],
    ["lighton", /点ける|つける|点灯|点けて|ひねる|出す|回す|動かす/],
    ["lightoff", /消す|消して|消灯|切る|切って|止める|とめる/],
    ["sit", /座る|すわる|座って|腰を下ろ|腰掛け|浸か|つかる|入る$|はいる$/],
    ["drink", /飲む|飲んで|飲み/], ["press", /押す|押して|触れる|触る/],
    ["listenTo", /聞く|聴く|聞いて|耳をすま|耳を澄ま|出る/], ["close", /閉める|閉めて|しめる|閉じる|閉じて/],
    ["open", /開け|開く|ひらく/], ["put", /入れ|差す|差し|挿す|はめ|貼る|貼って|貼り|をする/], ["read", /読/], ["examine", /調べ|見る|眺め|見つめ|覗|のぞ/],
    ["take", /取|拾|持つ/], ["drop", /置/],
  ];
  const JA_DIRS = { "北": "n", "南": "s", "東": "e", "西": "w", "上": "u", "下": "d" };
  const OBJLESS = ["dunno", "sleep", "run", "lookback", "down", "up", "raise", "cover"];
  const SIMPLE = { "見る": "look", "周りを見る": "look", "見回す": "look", "持ち物": "inventory", "待つ": "wait", "ヒント": "hint", "遊び方": "help", "ヘルプ": "help",
    "耳をすます": "listen", "耳を澄ます": "listen", "聞く": "listen", "わからない": "dunno", "分からない": "dunno",
    "寝る": "sleep", "眠る": "sleep", "走る": "run", "振り向く": "lookback", "振り返る": "lookback", "座る": "sit", "降りる": "down", "上る": "up", "登る": "up",
    "潜る": "down", "もぐる": "down", "浮かぶ": "up", "じっとする": "wait", "動かない": "wait", "黙る": "wait",
    "手をあげる": "raise", "手を上げる": "raise", "手を挙げる": "raise", "挙手": "raise", "耳をふさぐ": "cover", "耳を塞ぐ": "cover",
    "二回叩く": "knock", "二回たたく": "knock", "こんこん": "knock", "叩く": "knock", "たたく": "knock", "ノック": "knock" };
  function parseJa(t) {
    const br = t.match(/[「『]([\s　]*)[」』]/);
    if (br) return { v: "say", w: W("　"), raw: true };
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
    if (OBJLESS.includes(verb)) return { v: verb, raw: true };
    const objPart = s.slice(0, vm.index);
    if (verb === "say" || verb === "write") return { v: verb, w: findWordIn(objPart), raw: true };
    // 名前の頭は、文の頭か助詞のすぐあとにあるものだけを数える（「貼り紙」の「紙」を拾わない）
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
    if (!hits.length && objPart && !["sit", "listenTo", "lighton", "lightoff", "knock", "erase"].includes(verb)) {
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

  // その場所の空気。説明を読むだけのときは動かない
  const META = ["hint", "help", "inventory", "look", "dunno"];
  function tick(v) {
    if (S.done || META.includes(v)) return;
    if (S.loc === "passage" && S.ring && v !== "take" && v !== "press" && Math.random() < 0.5) { say("公衆電話が、鳴りつづけている。", "note"); sfx("phone"); }
    if (hot() && Math.random() < 0.15) say("頭の右上で、鉄の球が、ごとりと鳴った。", "note");
    if (hot() && Math.random() < 0.25) fx("glitch");
    if ((S.loc === "corr" || S.loc === "corr2") && !isSat() && Math.random() < 0.1) {
      say("廊下の蛍光灯が、一本だけまたたいた。暗くなった一瞬、614の印の前に、誰かが立っていた気がする。", "note");
      fx("flicker", 2);
    }
    if (S.loc === "gym" && Math.random() < 0.15) say("ボールが、用具室の引き戸の前で、また止まった。", "note");
  }
  // 一手ごとに進むもの：浴室の湯、乾燥機、電話、面会、校舎の約束、土曜の白衣、裏側の熱
  function world(v, before) {
    if (S.done || META.includes(v)) return;
    if (S.loc === before) tick(v);
    if (S.done) return;
    // 浴室の湯
    if (S.faucet) {
      if (!S.plug) { if (S.loc === "bath" && Math.random() < 0.3) say("湯は、栓のない穴に、ごぼごぼと吸いこまれていく。", "note"); }
      else if (S.tub < 5) {
        S.tub++;
        if (S.loc === "bath") say(["", "湯船の底に、湯がたまりはじめた。", "湯が、湯船の半分まで来た。", "湯船が、いっぱいになった。湯気が、鏡を真っ白にする。", "湯が、湯船の縁を越えて、タイルの床に広がっていく。", "あふれた湯が、排水口でごぼごぼと鳴っている。"][S.tub], "note");
      }
    }
    // 乾燥機（リネン室にいるあいだだけ進む）
    if (S.loc === "linen" && before === "linen" && S.dryRun) {
      S.dryT++;
      if (S.dryT >= 3) {
        S.dryRun = false; S.warmUntil = S.moves + 6;
        sfx("beep");
        say("ブー、とブザーが鳴って、乾燥機が止まった。丸い窓の中で、白いものが、ふわりと落ちる。", "note");
        if (O.strip.loc === "dryer" && S.stripWet) { S.stripWet = false; say("……中の紙の列が、からからに乾いた音を立てた。", "note"); }
      }
    }
    // 電話
    if (S.loc === "passage" && S.call === 1 && before === "passage") {
      S.callT++;
      if (S.callT >= 4) { S.call = 0; say("「……もしもし？……切れちゃったのかしら」ぷつり。", "note"); }
    }
    // 面会
    if (S.loc === "visit" && S.visitOn && before === "visit" && v !== "knock") {
      S.visitT++;
      if (S.visitT >= 4) { S.visitOn = false; say("「……今日は、来てないのかしらね」椅子のきしむ音。扉の閉まる音。仕切りの向こうは、また空になった。", "note"); }
    }
    // 校舎の約束
    if (SCHOOL.includes(S.loc) && !S.sunday) {
      if (S.rollMiss) { S.rollMiss = false; if (ruleBreak("roll") && S.done) return; }
      if (S.rollDue && S.moves > S.rollDue) { S.rollDue = 0; ruleBreak("roll"); if (S.done || !SCHOOL.includes(S.loc)) return; }
      if (S.chimeDue && S.moves > S.chimeDue) { S.chimeDue = 0; ruleBreak("chime"); if (S.done || !SCHOOL.includes(S.loc)) return; }
      S.chimeT++;
      if (S.chimeT >= 9) { S.chimeT = 0; chime(); if (S.done) return; }
    }
    // 土曜の白衣：入った手は見逃す。同じ場所で何かするたびに、近づいてくる
    if (isSat() && REC_ROOMS.includes(S.loc) && S.loc === before) {
      S.recT++;
      if (S.recT === 1) { say("白衣の誰かが、クリップボードの陰から、こちらへ一歩。ペン先が、用紙の上で構えられた。", "warn"); sfx("breath"); }
      else { recCatch(); return; }
    }
    // 搬入口の灯り
    if (S.loc === before) l1Tick(v);
    if (S.done) return;
    // 裏側の熱：Level 1 は熱がたまり、Level 7 は熱を取られる
    const lv = lvOf(S.loc);
    if (lv !== lvOf(before) || !isBack(S.loc)) return;
    const r = heatRate(S.loc);
    if (r) {
      S.bt = (S.bt || 0) + Math.abs(r);
      while (S.bt >= 1 && !S.done && lvOf(S.loc) === lv) { S.bt -= 1; addT(r > 0 ? 0.1 : -0.1, ""); }
      if (S.done || lvOf(S.loc) !== lv) return;
      if (r > 0 && S.t >= 37.5 && Math.random() < 0.25) say("ここにいるだけで、体の奥に熱がたまっていく。", "note");
      if (r < 0 && S.t <= 36.1 && Math.random() < 0.4) say("指先が、白くなってきた。体温が、海に取られていく。", "warn");
    }
  }
  function act(input, label) {
    if (S.done) { say("ここで、終わっている。いちばん下の「はじめから」で、最初から。", "note"); return; }
    const ascii = /^[\x20-\x7e]*$/.test(input);
    const p = ascii ? parseEn(input) : parseJa(input);
    if (!p) { say("その言い方はわからない。「命令を作る」を使う。"); return; }
    S.moves++;
    if (label && !META.includes(p.v)) { S.hist.push(label); if (S.hist.length > 30) S.hist.shift(); }
    const before = S.loc;
    if (p.v === "go") { go(p.dir); world("go", before); return; }
    if (p.v === "say") { VERB_DO.say(p.w); world("say", before); return; }
    if (p.v === "write") { VERB_DO.write(p.w); world("write", before); return; }
    let a = p.ao, b = p.bo;
    if (!p.raw) { a = p.a ? findObj(p.a) : null; b = p.b ? findObj(p.b) : null; }
    for (const x of [a, b]) if (x && x.missing) { say(`ここに「${x.missing}」は見当たらない。`); return; }
    VERB_DO[p.v](a, b);
    world(p.v, before);
  }

  function submit(label, en) {
    label = String(label || "").trim();
    const cmd = en || label;
    if (!cmd) return;
    if (rows.length > 400) rows = rows.slice(-300);
    turnStart = rows.length;
    flashed = false;
    push({ t: "cmd", ja: label || cmd, en: en && en !== label ? en : "" });
    act(cmd, label || cmd);
    writeSaved(snapshot());
  }

  // ---- 命令を作る ----
  // [ボタンの文字, 英語の型, 日本語の型]。% は1つ目の物、# は2つ目の物。% がなければ物を選ばずにそのまま送る。「言う」「書く」はことばを選ぶ
  const VERBS = [
    ["調べる", "examine %", "%を調べる"], ["読む", "read %", "%を読む"], ["取る", "take %", "%を取る"],
    ["置く", "drop %", "%を置く"], ["入れる", "put % in #", "%を#に入れる"], ["貼る", "put % on #", "%を#に貼る"],
    ["開ける", "open %", "%を開ける"], ["閉める", "close %", "%を閉める"], ["押す", "press %", "%を押す"],
    ["点ける", "light %", "%を点ける"], ["消す", "douse %", "%を消す"], ["叩く", "knock %", "%を二回叩く"],
    ["嗅ぐ", "smell %", "%の匂いを嗅ぐ"], ["身につける", "wear %", "%を身につける"], ["飲む", "drink %", "%を飲む"],
    ["聞く", "listen to %", "%に耳をすます"], ["言う", "say %", "「%」と言う"], ["書く", "write %", "「%」と書く"],
    ["座る", "sit", "座る"], ["寝る", "sleep", "寝る"], ["手をあげる", "raise hand", "手をあげる"],
    ["耳をふさぐ", "cover ears", "耳をふさぐ"], ["二回叩く", "knock", "二回叩く"], ["振り向く", "look back", "振り向く"],
  ];
  // ---- 起動 ----
  function intro() {
    say("空欄_2", "title");
    gap();
    say(LOOP.n ? "「ここ、どこ？」……前にも、同じことを訊いた気がする。" : "「ここ、どこ？」", "voice");
    say("白い天井。蛍光灯のカバーの中に、羽虫の影がいくつも溜まっている。");
    say("「わたし、だれ？」", "voice");
    say("ベッドの柵に、名札。「613」。名前を書くところは、空いている。");
    say("天井の隅の丸いスピーカーが、ぷつ、と鳴った。");
    gap();
    morning();
    gap();
    describe(true);
  }
  function start(fresh) {
    rows = [];
    LOOP = loadLoop();
    const saved = fresh ? null : loadSaved();
    if (saved && restore(saved)) {
      rows = (saved.log || []).slice();
      turnStart = rows.length;
      say("（前回の続きから）", "note");
      describe(false);
    } else {
      newState();
      turnStart = 0;
      intro();
      writeSaved(snapshot());
    }
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
    flashed: () => flashed,
    visible: () => visible().map(o => ({ id: o.id, name: o.name, en: o.en, held: o.loc === "player" })),
    wordsHere: kind => wordsHere(kind).map(w => ({ ja: w.ja, show: w.show || w.ja, en: w.en })),
  };
}
