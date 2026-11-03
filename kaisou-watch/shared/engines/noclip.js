// 「ノークリップ」のゲーム本体。backrooms-pwa/games/noclip.html の ENGINE BEGIN〜END を抜き出し、言い回しを少し時計向けにしたもの。
// tools/build-engines.js で作る。直接は直さない。
// ==== ENGINE BEGIN ====
// ゲーム本体。画面（DOM）には触らない。時計版に移すときは、この区切りの中だけを使う。
// io: { loadState(), saveState(obj), loadLoop(), saveLoop(obj) }（どれも失敗してよい）
// 画面やブラウザの保存領域には触らない。演出のきっかけは fx() で返し、画面の側で鳴らす。
export function createGame(io) {
  const VERSION = 3;
  function loadSaved() { try { return io.loadState(); } catch (e) { return null; } }
  function writeSaved(obj) { try { io.saveState(obj); } catch (e) { /* 残せなくても遊べる */ } }
  function loadLoop() {
    let v = null;
    try { v = io.loadLoop(); } catch (e) { v = null; }
    v = v && typeof v === "object" ? v : {};
    return { n: +v.n || 0, echo: Array.isArray(v.echo) ? v.echo : [], last: v.last || "", ends: Array.isArray(v.ends) ? v.ends : [], deep: +v.deep || 0 };
  }
  function saveLoop(v) { try { io.saveLoop(v); } catch (e) { /* 残らなくても遊べる */ } }

  // ---- 物の置き場 ----
  const O = {};
  function thing(id, def) {
    // 英語の名前（「命令を作る」が内部で送る）は、英字の別名があればそれを使う
    const ascii = (def.aliases || []).find(a => /^[a-z][a-z0-9 ]*$/i.test(a));
    O[id] = Object.assign({ id, loc: null, take: false, en: (ascii || id).toLowerCase(), aliases: [def.name] }, def);
  }
  const text = v => (typeof v === "function" ? v() : v);
  const held = id => O[id].loc === "player";
  const near = id => O[id].loc === "player" || O[id].loc === S.loc;
  const rnd = n => Math.floor(Math.random() * n);
  const pick = a => a[rnd(a.length)];
  const DIR_JA = { n: "北", s: "南", e: "東", w: "西", u: "上", d: "下" };
  const NUM_JA = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  // 演出のきっかけ（画面の側が読み、fx.js などで鳴らす。時計版では振動などに置きかえる）
  let fxq = [];
  function emit(type, k) { fxq.push({ type, k }); }

  // ---- レベル ----
  const LEVEL_OF = { l0: "0", l1a: "1", l1b: "1", l1c: "1", l2a: "2", l2c: "2", l2j: "2", l2e: "2", l2v: "2", l3a: "3", l3b: "3", l3c: "3", l3d: "3", l3s: "3",
    l4a: "4", l4b: "4", l4c: "4", l5a: "5", l5b: "5", l5c: "5", l5d: "5", l5e: "5", l5h: "5", l6: "6", l7a: "7", l7b: "7", l7c: "7", l7d: "7", l7e: "7",
    l8a: "8", l8r: "8", l8z: "8", l9a: "9", l9h: "9", l9y: "9", l10a: "10", l10b: "10", l10c: "10", l10d: "10",
    l11a: "11", l11b: "11", l11c: "11", l11p: "11", l11x: "11",
    l37a: "37", l37b: "37", l37c: "37", lfun: "Fun", lrun: "!", l433: "433 N" };
  const LEVEL_START = { "0": "l0", "1": "l1a", "2": "l2a", "3": "l3a", "4": "l4a", "5": "l5a", "6": "l6", "7": "l7a",
    "8": "l8a", "9": "l9a", "10": "l10a", "11": "l11a", "37": "l37a", "Fun": "lfun", "!": "lrun", "433 N": "l433" };
  // どこまで深く行ったか（起動画面の要約に使う）
  const DEPTH = { "433 N": 0.5, "0": 0, "1": 1, "2": 2, "3": 3, "4": 4, "Fun": 4.5, "!": 4.6, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, "11": 11, "37": 12 };
  const ENDINGS = ["exit", "sublime", "party", "wretch", "harvest", "beta"];
  const LEVEL_INFO = {
    "0": ["しきい", "クラス1"], "1": ["居住区", "クラス1"], "2": ["放棄された整備通路", "クラス2"], "3": ["電気室", "クラス4"],
    "4": ["放棄されたオフィス", "クラス1"], "5": ["恐怖のホテル", "クラス2"], "6": ["消灯", "クラス未定"], "7": ["海洋恐怖症", "クラス4"],
    "8": ["洞窟", "クラス4"], "9": ["郊外", "クラス5"], "10": ["豊作", "クラス1"], "11": ["眠らない街", "クラス2"],
    "433 N": ["カプセルホテル", "クラス？"],
    "37": ["崇高", "クラス0"], "Fun": ["ファン =)", "クラス5"], "!": ["走れ", "クラス5"],
  };
  const LV = () => LEVEL_OF[S.loc];

  // M.E.G. の生存手引き。見たもの、出会ったものが、ここに増えていく
  const PAGES = {
    "0": "レベル0「しきい」\n生存難易度：クラス1（安全・安定・実体は確認されていない）\n黄ばんだ壁紙、湿ったカーペット、最大出力でうなる蛍光灯。目を離したすきに、通路の形が変わる（周辺移動）。同じ部屋に二度入ることは、まずない。\n孤立効果：ここでは、ほかの誰にも会えない。書き残したものも、届かない。\n・アーチの並ぶ部屋は、形を変えにくい。休むならそこで。\n・穴の並ぶ部屋では、下へ行かないこと。落ちて戻った者はいない。\n・カーペットが粘りつき、壁紙の下から赤がのぞいたら、引き返すこと（赤い部屋）。\n・うなりが急に大きくなったら、耳をふさいで歩きつづけること。\n出口：ちらついている壁を見つけて、体ごと投げこむ。",
    "1": "レベル1「居住区」\n生存難易度：クラス1（安全・安定・実体は少数）\n地下駐車場と倉庫を継ぎ合わせたような広間。見える距離は、あてにならない。目印を決めて、目を離さずに歩くこと。\n補給の木箱は、背中を向けたときに現れ、目を離すと消える。手を入れる前に、中身を確かめること（割れたガラス、薬品）。\n照明が消えたら（ちらつき）、灯りを点けないこと。緑の非常灯の扉へ、壁づたいに、ゆっくり。走らないこと。止まっているのもよい。\n配管と計器が増えていくほうへ歩くと、いつのまにかレベル2にいる。\nM.E.G. 基地アルファ（2012年〜）。新しく落ちてきた人の避難所。",
    "2": "レベル2「放棄された整備通路」（旧称「パイプの夢」）\n生存難易度：クラス2（ほぼ安全・安定・実体あり）\n45度ずつ折れ曲がる、狭い整備用トンネル。通路の長さは、どれも5メートルの倍数。照明は直列で、一本切れるとまとめて消える。大停電のあと、機械はほとんど止まった。\n分岐では管に触れること。冷たい管は、流れの止まった管。どこかへ続いている。\n窓の向こうが真っ黒な扉には、入らないこと。入った者は、戸口の光を見失う。\nレベル3への扉の多くは、警告とバリケードでふさがれている。\nウレッチが初めて記録されたのは、この階の野営地「生存者たち」。",
    "3": "レベル3「電気室」\n生存難易度：クラス4（危険・安定・実体多数）\nレンガの廊下、薄暗い蛍光灯、唸りと火花を上げる古い機械。どんな道具でも壊せない鉄格子が、通路の多くをふさいでいる。\n黒い泥の管には触れないこと（熱く、毒）。\nここの実体は賢い。群れで動き、背後から来る。爪の音がしたら、振り向いて目を合わせること。\n聖所（天使の像のある部屋）には、実体は近づかない。\n内側から人の声がする扉は、開けないこと。返事もしないこと。血が透明なら、近づくな。アーモンド水を嫌う。\n配電盤のスイッチを全部上げると、過負荷になる。\nエレベーターは、レベル4か5へ。",
    "4": "レベル4「放棄されたオフィス」\n生存難易度：クラス1（安全・安定・実体はほぼなし）\n家具のほとんどない、空のオフィス。窓はたいてい黒く塗りつぶされている。塗られていない窓は罠。近づかないこと。\n給水器や自動販売機から、アーモンド水が出る。ここで水をたくわえてから、先へ。\n階段はレベル5へ。風船のついた扉には入らないこと。\nM.E.G. 基地オメガ（記事の作成と保管）。",
    "5": "レベル5「恐怖のホテル」\n生存難易度：クラス2\n1930年代のホテル。汚れは、ひとりでに消える。どこからか、レコードのジャズ。壁の向こうのざわめき。誰もいないのに、肩を叩かれる。絵の目。\n大広間・ビバリールーム・ボイラー室。\nビバリールームの卓の麻雀は、終わらせられない。触れないこと。\nエレベーターの13より上の階へは、行かないこと。\n暗い客室には、デスモスの巣がある。\nボイラー室の奥から、レベル6へ（ひどく暑い）。\nM.E.G. 出張所「ハウスキーピング」。",
    "6": "レベル6「消灯」\n生存難易度：未定\nどんな光源も働かない。音もほとんどしない。手探りで進むしかない。息づかい、囁き、何かが這う音が聞こえることがある。\n「世界でいちばん静かな部屋」：明かりのスイッチを入れてくれと頼む人がいるという。入れないこと。\n「ものまね」：どんな声も、そっくりにまねる者たち。音を立てないこと。避けること。\n波のかすかな音をたどると、レベル7への階段。",
    "7": "レベル7「海洋恐怖症」\n生存難易度：クラス4\n入口の部屋は、横倒しに天井へ埋まっている。戸口の向こうは、4メートル半下の海。戸口の前に立つと、重さの向きが変わる。\n戸口から垂らしたロープだけが、部屋へ戻る手段。\nここの空気を吸ったあとは、驚くほど長く息が続く。\n昼・薄明・真夜中・深淵の層。浅い層の大きな影が通るときは、じっとしてやり過ごすこと。真夜中の層の何かは、光に弱い。\n入口の部屋の真下の山に、レベル8へ抜ける洞窟。",
    "8": "レベル8「洞窟」\n生存難易度：クラス4（危険・不安定・実体多数）\n冷たい鍾乳洞の迷路。同じ穴を二度くぐっても、同じ部屋に着くとは限らない。ここでは電池が早く減り、標識の塗料もすぐに剥げる。\nM.E.G. の標識が並ぶ「9番道路」から外れないこと。眠らないこと。水に浸からないこと。\n床の薄いところから、下へ落ちた者がいる。",
    "9": "レベル9「郊外」\n生存難易度：クラス5（極めて危険）\n真夜中の住宅街。家具はそろっているが、電気は来ていない。通りが、いちばん危ない。\n霧が出たら、すぐに通りから離れること。霧の中には、ねじれたものがいる。\n家に招く者の腕を、よく見ること。\n小道から外れて草原へ出た者は、別のレベルにいたという。",
    "10": "レベル10「豊作」\n生存難易度：クラス1（安全・安定・敵対的な実体なし）\n曇り空の下、麦畑がどこまでも続く。生け垣、納屋、湖。轍の残る土の道があるが、車を見た者はいない。\n道をたどると、街に出るという。\n麦は、腐らない。",
    "11": "レベル11「眠らない街」\n生存難易度：クラス2（安全・安定・実体あり）\n誰もいない大都市。窓は鏡のように黒い。見ていないあいだに、車や看板が動く。\nたいていのレベルが、ここにつながっている。出口はどれも目立たず、たいてい片道。\n住人は、安全な道にスプレーで印をつけ、出口の多い通りをバリケードでふさいでいる。\nここの実体は、あまり襲ってこない。こちらから手を出さないかぎり。",
    "37": "レベル37「崇高」\n生存難易度：クラス0（安全・安定・実体なし）\n白いタイルと、温かいプール。ひどく落ち着く。\n長く留まった者は、帰りたい理由を、ひとつずつ忘れていくと言われている。",
    "Fun": "レベル Fun =)\n生存難易度：クラス5（極めて危険）\n風船、紙吹雪、ケーキ。\n誘いに「はい」と言わないこと。何も食べないこと。留まらないこと。",
    "!": "レベル !「走れ」\n生存難易度：クラス5（極めて危険）\n赤い非常灯の廊下。後ろから何かが来る。\n止まらないこと。角では、曲がる方向を間違えないこと。",
    water: "物品「アーモンド水」（Object 1）\n金属の魔法瓶に、口もとまで満たされた透明な水。ほんのり甘い。一本で、まともな食事一回ぶん。\n色ちがいがある。灰はふつうのもの。青は眠気を誘い、ウレッチになりかけた者を引き戻すことがある。\n半分しか入っていない瓶は飲まないこと。誰かが手を加えたかもしれない。\nスキンスティーラーは、この水を嫌う。",
    wretch: "実体「ウレッチ」（Entity 15）\n食べ物と水と眠りが足りず、ひとりきりで長くいた人のなれの果て。\n初めは苛立ち。次に皮膚がただれ、ことばは「水」「食べ物」「助けて」だけになる。ここまでなら、食べ物とアーモンド水で引き返せることがある。\n正気を尽きさせないこと。",
    smiler: "実体「スマイラー」（Entity 3）\n暗闇に浮かぶ、白く光る目と歯の列。光に寄ってくる。\n灯りを消すこと。大きな音を立てないこと。目を逸らさずに、ゆっくり離れること。慌てて逃げないこと。しばらくすると、興味を失う。",
    hound: "実体「ハウンド」（Entity 8）\n四つ足で這う、長い髪の人に似たもの。恐れに反応する。\n走らないこと。目を逸らさずに見つめ返し、それからゆっくり離れること。唸り声が聞こえたら、姿を見せないこと。\n（書きこみ）唸りは、何かを伝えようとしている。「いつも襲う」とは書くな。まず見ること。",
    skin: "実体「スキンスティーラー」（Entity 10）\n人の皮をかぶり、人の声で話す。ことばの意味は分からず、聞いたことばを、そのまま返すだけ。\n扉の向こうから知り合いの声がしても、開けないこと。返事もしないこと。\n血が赤なら、生きている。血が透明なら、近づくな。",
    faceling: "実体「フェイスリング」（Entity 9）\n顔のない人。たいてい無害。意味も分からずに、人の暮らしをまねつづけている。小さなことで、ひどく取り乱す。",
    party: "実体「パーティーゴアー」（Entity 67）\n黄色い体に、描いたような笑顔。会えば、必ずパーティーに誘ってくる。=)\n風船と飾りつけは、たいてい罠の目印。",
    moth: "実体「デスモス」（Entity 4）\n人の頭ほどもある蛾。雄は水をあさり、雌は群れで狩りをする。\n明るい光に集まる。羽音が聞こえたら、灯りを消して、じっとすること。\n暗い部屋や、肉のような膜がかかった穴は、巣。近づかないこと。",
    wire: "実体（番号なし・記録は手書きのみ）「灰線」\n電線の束からぶら下がるように降りてくる、灰色の細い人の形。目はない。動くものと、音を聞きつける。\n近くの柱や壁に「うごくな」「しずかに」と引っかき傷があったら、その場で止まり、黙ること。しばらくすると、戻っていく。",
    balloon: "実体「人食い風船」（Entity 110）\nリボンのついた、ただの風船に見える。中に食べ物を詰め、その匂いで獲物を誘う。\nリボンに触れると、しびれて動けなくなる。\n食べ物の匂いのするほうへ行かないこと。風船に近づかないこと。",
    windows: "実体「窓」（Entity 2）\n塗りつぶされていない窓に化ける。向こうに、帰りたい場所を見せる。\n開けないこと。見つめつづけないこと。",
    mimic: "（手書き）「ものまね」\nレベル6の暗闇に慣れた、四人ほどの人。どんな音も、声も、そっくりにまねる。\n声を出すと、寄ってくる。黙って、波の音のほうへ。",
    tiny: "（手書き）レベル7の浅い層の「タイニー」\n小さくはない。船より、部屋より大きい影。耳がいい。\n影が通るあいだは、動かないこと。",
    thing: "（手書き）「レベル7の何か」\n真夜中の層にいる。暗闇に慣れすぎた目は、光に耐えられない。\n灯りを向けること。灯りがなければ、息を殺して、通りすぎるのを待つこと。",
  };
  const PAGE_ORDER = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "37", "Fun", "!", "water", "wretch", "smiler", "hound", "skin", "faceling", "party", "moth", "balloon", "wire", "windows", "mimic", "tiny", "thing"];
  const pageTitle = k => PAGES[k].split("\n")[0];

  function initWorld() {
    for (const k of Object.keys(O)) delete O[k];

    // ---- レベル0「しきい」
    thing("wallpaper", { name: "壁紙", aliases: ["壁紙", "壁", "wallpaper"], loc: "l0", scenery: true,
      desc: () => S.l0.seam ? "この部屋の東の壁だけ、蛍光灯の明滅と半拍ずれて、壁そのものがちらついている。ちらつきの奥は、黄色ではない。" :
        S.l0.redN >= 2 ? "壁紙がところどころめくれている。めくれた下は、赤い。乾いていない赤だ。" : "黄ばんだ壁紙。細い縦じまの模様。どの部屋も、同じ壁紙だ。" });
    thing("carpet", { name: "カーペット", aliases: ["カーペット", "床", "carpet"], loc: "l0", scenery: true,
      desc: () => S.l0.redN >= 1 ? "カーペットが、靴の裏に粘りつく。毛足が粗く、色が濃い。" : "湿ったカーペット。写真で見るより、茶色に近い。踏むと、古い水の匂いが上がってくる。" });
    thing("lights0", { name: "蛍光灯", aliases: ["蛍光灯", "明かり", "lights"], loc: "l0", scenery: true,
      desc: "天井の蛍光灯。うなりは、最大の音量で鳴りつづけている。一本だけ、ほんの少し遅れて明滅する。" });
    thing("seam", { name: "ちらつく壁", aliases: ["ちらつく壁", "ずれた継ぎ目", "継ぎ目", "flickering wall"], scenery: true,
      desc: "壁紙の継ぎ目がずれ、そこから先の壁が、明滅にあわせて薄くなったり濃くなったりしている。ちらつきの奥に、コンクリートの灰色と、冷気。……体ごと投げこめば、通れそうな気がする。" });
    thing("holes0", { name: "穴", aliases: ["穴", "黒い穴", "holes"], scenery: true,
      desc: "床に開いた四角い穴。格子のように、等間隔に並んでいる。懐中電灯を向けても、光は縁から先へ届かない。底の気配もない。" });
    thing("page0", { name: "濡れたページ", aliases: ["濡れたページ", "ページ", "紙", "wet page"], take: true,
      desc: "水を吸って波打った、バインダーの一枚。上に「M.E.G.」の印。",
      read: () => { note("0"); return PAGES["0"] + loopScrawl(); } });
    thing("table0", { name: "八角形のテーブル", aliases: ["八角形のテーブル", "テーブル", "octagonal table"], scenery: true,
      desc: "木の八角形のテーブル。椅子が二脚、向かい合わせに置いてある。片方の椅子だけ、少し引いてある。テーブルの下に、小さな戸棚。" });
    thing("cupboard0", { name: "戸棚", aliases: ["戸棚", "cupboard"], scenery: true, container: true, closed: true,
      desc: () => O.cupboard0.closed ? "テーブルの下の、小さな木の戸棚。" : "開いた戸棚。" });
    thing("water0", { name: "灰色の魔法瓶", aliases: ["灰色の魔法瓶", "魔法瓶", "アーモンド水", "grey thermos"], loc: "cupboard0", take: true, drink: true,
      desc: "へこみのある灰色の魔法瓶。口もとまで、透明な水が満ちている。ほのかにアーモンドの匂い。" });
    thing("docs0", { name: "書類", aliases: ["書類", "紙束", "documents"], loc: "cupboard0", take: true,
      desc: "紐で綴じた紙束。何人もの字。",
      read: () => "「ここに置いたものは、次の人のために。持っていけるだけ持っていけ。――ボランティア一同」\n「この部屋は動く。二度は来られない」\n「ここにいると、誰かがすぐ近くにいる気がする。気のせいではないと思う」\n「2019年に誰かが撮った黄色い廊下の写真を、ここで見た。写真のほうが、本物より黄色い」" +
        (LOOP.n ? "\nいちばん下に、自分の字で。「ここで休め。でも、ここに住むな」" : "\nいちばん下の行が、空いている。") });

    // ---- レベル1「居住区」
    thing("crate", { name: "木箱", aliases: ["補給の木箱", "木箱", "箱", "crate"], scenery: true, container: true, closed: true,
      desc: () => O.crate.closed ? "通路の真ん中に置かれた木箱。さっきまで、なかった。側面にステンシルで「補給」。" :
        "蓋の開いた木箱。おがくずが詰まっている。" + (S.l1.checked ? "割れたガラスの破片が混じっているのが見える。よけて取り出せる。" : "おがくずの奥で、何かが、きらりと光った。") });
    thing("water1", { name: "アーモンド水", aliases: ["アーモンド水", "ボトル", "水", "almond water"], loc: "crate", take: true, drink: true,
      desc: "灰色の金属の魔法瓶。手書きのラベルに「アーモンド水」。口もとまで満ちている。" });
    thing("battery1", { name: "電池", aliases: ["電池", "battery"], loc: "crate", take: true, battery: 40,
      desc: "単一の電池。まだ使えそうだ。" });
    thing("glass1", { name: "割れたガラス", aliases: ["割れたガラス", "ガラス", "glass"], loc: "crate", take: true,
      desc: "おがくずに埋もれた、板ガラスの破片。どれも刃物のように鋭い。" });
    thing("cloth1", { name: "黄緑の布", aliases: ["黄緑の布", "布", "目印", "cloth"], loc: "l1a", take: true,
      desc: "柱に結ばれた、黄緑色の布。鷲の印。布の結び目に、メモと銀色の包みがくくりつけてある。" });
    thing("note1", { name: "メモ", aliases: ["メモ", "紙", "note"], loc: "l1a", take: true,
      desc: "布にくくりつけてあったメモ。",
      read: () => "「新しく落ちてきた人へ。よくここまで来た。\n基地アルファの分所は、緑の非常灯の扉の奥（東）。\n灯りが消えたら、灯りを点けるな。緑の非常灯へ、壁づたいに。走るな。\n木箱は、目を離すと消える。手を入れる前に、中を見ろ。\n中身を取ったら、この布を床に置いてくれ。補充の合図になる。――M.E.G.」" });
    thing("ration1", { name: "ロイヤルレーション", aliases: ["ロイヤルレーション", "レーション", "royal ration"], loc: "l1a", take: true, food: true,
      desc: "銀色の包みの携帯食。「ロイヤル」と大きく書いてある。" });
    thing("puddle", { name: "水たまり", aliases: ["水たまり", "puddle"], loc: "l1a", scenery: true,
      desc: "浅い水たまり。天井の配管から漏れた水だ。飲めそうにはない。天井の照明が映っている。一つ、照明の数が合わない。" });
    thing("pipes1", { name: "天井の配管", aliases: ["天井の配管", "配管", "計器", "pipes"], loc: "l1a", scenery: true,
      desc: "天井を這う細い配管。北へ行くほど、数が増え、太くなっている。北の壁ぎわには、針の止まった計器がいくつも。" });
    thing("exitlight", { name: "緑の非常灯", aliases: ["緑の非常灯", "非常灯", "exit light"], loc: "l1a", scenery: true, feel: true,
      desc: "東の、金網の向こうの扉の上で、緑の非常灯が光っている。照明が消えても、これだけは消えない。" });
    thing("radio", { name: "無線機", aliases: ["無線機", "ラジオ", "radio"], loc: "l1b", scenery: true,
      desc: "机の上の無線機。電源は入っている。ノイズの奥で、ときどき声がする。" });
    // 装備の入ったロッカーは、ゲームごとに変わる（無線とホワイトボードが番号を言う）
    for (const k of [2, 5, 7]) {
      thing("lk" + k, { name: `${k}番のロッカー`, aliases: [`${k}番のロッカー`, `${k}番`, `locker ${k}`], en: `locker ${k}`, loc: "l1b", scenery: true, container: true, closed: true,
        desc: () => O["lk" + k].closed ? `${k}番のロッカー。` + (k === S.gear ? "名札の差しこみに、かすれた字で「装」。" : "")
          : `開いた${k}番のロッカー。` + (k === S.emptyLk ? "空っぽ。内側に、爪で「もどれない」。" : "") });
    }
    thing("hair", { name: "髪の束", aliases: ["髪の束", "髪"], loc: "lk2", scenery: true,
      desc: "長い髪の束。誰のものかは分からない。まだ、少し湿っている。" });
    thing("flashlight", { name: "懐中電灯", aliases: ["懐中電灯", "ライト", "flashlight"], loc: "lk7", take: true,
      desc: () => `黄色い懐中電灯。防水と書いてある。${S.light ? "点いている" : "消えている"}。電池は${S.bat}%。` });
    thing("book", { name: "生存手引き", aliases: ["生存手引き", "手引き", "バインダー", "handbook"], loc: "lk7", take: true,
      desc: "M.E.G. のバインダー。「生存手引き」。拾ったページを、ここに綴じておける。",
      read: () => bookText() });
    thing("board1", { name: "ホワイトボード", aliases: ["ホワイトボード", "ボード", "whiteboard"], loc: "l1b", scenery: true,
      desc: "分所のホワイトボード。",
      read: () => `「装備は${S.gear}番」\n「下へ：北。配管と計器が増えていくほう。最後の通路は灯りが死んでいる」\n「C.L.I.P.P.：確かめる・出口を探す・調べる・備える・周りを固める」\n「灯りが消えたら、緑の非常灯へ」\nいちばん下に、別の字で「全員、先に行く」。` });
    thing("log1", { name: "分所の日誌", aliases: ["分所の日誌", "日誌", "logbook"], loc: "l1b", scenery: true,
      desc: "表紙のふやけた日誌。",
      read: "「三日目。補給の木箱が、また増えた。誰が置いているのかは、誰も知らない」\n「九日目。無線のワンダラー用の周波数で、自分の声が聞こえると言う者がいる」\n「十日目。黄緑の布を床に置いておくと、次の日には、新しい水が結んである。誰が結ぶのかは、誰も見ていない」\n「十二日目。37という数字の話をする者がいる。行く者と、残る者に分かれた」\n「十三日目。」\nそこで終わっている。" });
    thing("fence", { name: "金網", aliases: ["金網", "フェンス", "基地"], loc: "l1b", scenery: true,
      desc: "通路の一室を、金網で仕切っただけの分所。簡易ベッドが六つ。全部、きれいに畳まれている。" });

    // ---- レベル2「放棄された整備通路」
    thing("graffiti", { name: "落書き", aliases: ["落書き", "graffiti"], loc: "l2a", scenery: true,
      desc: "壁の落書き。", read: "スプレーで、大きく。「冷たい管をたどれ」\nその下に、小さく。「熱い管は、まだ何かが流れている。どこにも行かない」\n壁のステンシル：「5m」「10m」「15m」……。" });
    for (const [d, ja] of [["n", "北"], ["e", "東"], ["w", "西"]]) {
      thing("pipe" + d, { name: `${ja}の管`, aliases: [`${ja}の管`, `${ja}の配管`], en: `${ja === "北" ? "north" : ja === "東" ? "east" : "west"} pipe`, loc: "l2j", scenery: true, feel: true,
        desc: `${ja}へ45度に折れていく太い管。触ってみないと、温度は分からない。` });
    }
    thing("hound", { name: "ハウンド", aliases: ["ハウンド", "四つ足の何か", "何か", "hound"], scenery: true, feel: true,
      desc: () => S.hound === 2 ? "それは低く唸ったまま、こちらを見ている。動かない。" : "管の陰で、四つ足の何かがこちらを見ている。長い黒髪が床まで垂れている。膝と肘の向きが逆だ。" });
    thing("wretch2", { name: "うずくまる人", aliases: ["うずくまる人", "人", "ウレッチ", "person"], loc: "l2c", scenery: true, feel: true,
      desc: () => S.l2.gave ? "毛布にくるまって、眠っている。息が、さっきより静かだ。" : "部屋の隅で、毛布をかぶってうずくまっている人。腕の皮膚が赤くただれ、ところどころ剥がれている。同じことばを、くり返している。「みず……たべもの……たすけて……」\n近づきすぎると、つかまれそうだ。" });
    thing("sign2", { name: "看板", aliases: ["看板", "sign"], loc: "l2c", scenery: true,
      desc: "段ボールの看板。", read: "マジックで「生存者たち　新しく来た人を歓迎します」\nその下に、別の字で「水を分けて。分けられなくなったら、出ていって」" });
    thing("door3", { name: "3の扉", aliases: ["3の扉", "鉄の扉", "バリケード", "steel door"], loc: "l2e", scenery: true, feel: true,
      desc: () => S.l2.planks ? "板の外れた、錆びた鉄の扉。下へ降りる階段の気配。" : "錆びた鉄の扉に、板が何枚も打ちつけてある。指でなぞると、引っかいた数字。「3」。板に、赤いスプレーで「行くな　4へ行け →」。" });
    thing("door4", { name: "4の扉", aliases: ["4の扉", "窓のある扉", "door 4"], loc: "l2e", scenery: true, feel: true,
      desc: () => "白く塗られた鉄の扉。ペンキで「4」。顔の高さに、小さな窓。" + (lightOn() || !isDark() ? "窓の向こうは、真っ黒だ。暗いのではない。何もない黒だ。灯りを当てても、ガラスの先で光が消える。" : "窓に触れると、ガラスがひどく冷たい。") +
        (LOOP.n ? "\n扉の縁に、自分の字で小さく。「窓をのぞいたか」" : "") });
    thing("batteryW", { name: "使いかけの電池", aliases: ["使いかけの電池", "電池", "used battery"], take: true, battery: 30,
      desc: "毛布の下から出てきた電池。少し温かい。" });
    thing("doorway2", { name: "戸口", aliases: ["戸口", "光", "doorway"], loc: "l2v", scenery: true, feel: true,
      desc: () => `背中のほうに、入ってきた戸口が、四角く光っている。${S.l2.void >= 1 ? "さっきより、小さい。" : ""}` });

    // ---- レベル3「電気室」
    thing("sdoor", { name: "鉄扉", aliases: ["鉄扉", "扉", "iron door"], loc: "l3a", scenery: true, feel: true,
      desc: () => S.ss === 2 ? "廊下の鉄扉。向こうは、静かだ。" : "廊下の途中の鉄扉。内側から、誰かが叩いている。扉の下の隙間から、指先が一本のぞいている。切り傷から垂れているのは、水のように透明なものだ。" });
    thing("sludge", { name: "黒い泥の管", aliases: ["黒い泥の管", "黒い管", "泥", "sludge pipe"], loc: "l3a", scenery: true,
      desc: "壁を這う太い管。継ぎ目から、黒い泥がゆっくりにじみ出ている。湯気が立ち、鼻の奥が痺れる匂い。" });
    thing("bars", { name: "鉄格子", aliases: ["鉄格子", "格子", "bars"], loc: "l3a", scenery: true,
      desc: () => "通路の片側をふさぐ鉄格子。傷ひとつない。誰かが壁に「何をやっても曲がらない」と書いている。格子の奥の床に、ノートの切れ端が落ちている。" + (S.l3.bars ? "" : "\nその奥の暗がりに、人の形の影が立っている。") });
    thing("diary3", { name: "ノートの切れ端", aliases: ["ノートの切れ端", "切れ端", "ノート", "diary"], loc: "l3a", scenery: true,
      desc: "格子の向こうに落ちている、殴り書きの紙。手は届かないが、字は読める。",
      read: "（格子ごしに読む）\n「また来た。小さくて、しつこいものたち。答えのないことを、知りたがる」\n「わたしの作ったものたちは、こんな姿になるはずではなかった」\n「聖所にだけは、あれらも入らない。入れない理由を、あれらは覚えている」\n最後の行は、同じ字のくり返しで、黒く塗りつぶされている。" });
    thing("raincoat", { name: "レインコート", aliases: ["レインコート", "皮", "抜け殻"], loc: "l3d", scenery: true,
      desc: "床に脱ぎ捨てられた、人の形にたるんだもの。……レインコートだ。たぶん。指で触る気にはなれない。" });
    thing("card", { name: "身分証", aliases: ["身分証", "カード", "id card"], loc: "l3d", take: true,
      desc: "M.E.G. の身分証。基地ガンマの入館印。名前の欄は、かすれて読めない。",
      read: () => `「M.E.G. 調査員　＿＿＿＿　（基地ガンマ：血液確認済）」\n裏に、走り書き。「配電盤は${S.swOk[0]}と${S.swOk[1]}だけ。全部は上げるな」` + (LOOP.n ? "\n走り書きの字は、自分の字に似ている。" : "") });
    thing("liftkey", { name: "エレベーターの鍵", aliases: ["エレベーターの鍵", "鍵", "elevator key"], loc: "l3d", take: true,
      desc: "小さな鍵。タグに「昇降機」。" });
    thing("water2", { name: "アーモンド水（二本目）", aliases: ["アーモンド水（二本目）", "二本目", "アーモンド水", "ボトル", "second almond water"], loc: "l3d", take: true, drink: true,
      desc: "もう一本の灰色の魔法瓶。ラベルの字が、一本目と同じ人の字だ。" });
    for (let k = 1; k <= 4; k++) {
      thing("sw" + k, { name: `スイッチ${k}`, aliases: [`スイッチ${k}`, `${k}番のスイッチ`, `switch ${k}`], en: `switch ${k}`, loc: "l3b", scenery: true,
        desc: () => `配電盤のスイッチ${k}。今は${S.sw[k] ? "上がっている" : "下がっている"}。` });
    }
    thing("panel3", { name: "配電盤", aliases: ["配電盤", "panel"], loc: "l3b", scenery: true,
      desc: () => "発電機の横の、四つのスイッチが並ぶ配電盤。" + [1, 2, 3, 4].map(k => `${k}:${S.sw[k] ? "上" : "下"}`).join("　") });
    thing("bottle", { name: "赤い瓶", aliases: ["赤い瓶", "瓶", "red bottle"], loc: "l3b", take: true, drink: true, pain: true,
      desc: "どろりとした赤い液体の瓶。手書きのラベルに「液体の痛み　飲むな」。" });
    thing("teeth3", { name: "歯の列", aliases: ["歯の列", "スマイラー", "歯", "smiler"], scenery: true, feel: true,
      desc: "暗闇の真ん中に浮かぶ、白く光る二つの目と、細長い歯の列。笑っている。" });
    thing("hound3", { name: "背後の何か", aliases: ["背後の何か", "ハウンド", "何か", "hound behind"], scenery: true, feel: true,
      desc: "背後の暗がりで、爪がレンガを擦っている。見えないが、そこにいる。" });
    thing("liftbtn", { name: "ボタン", aliases: ["ボタン", "下のボタン", "button"], loc: "l3c", scenery: true,
      desc: () => "エレベーターの呼び出しボタン。" + (S.power ? "小さく光っている。" : "光っていない。") });
    thing("keyhole3", { name: "鍵穴", aliases: ["鍵穴", "keyhole"], loc: "l3c", scenery: true,
      desc: () => S.keyIn ? "鍵が差さっている。" : "ボタンの横の鍵穴。" });
    thing("angel", { name: "天使の像", aliases: ["天使の像", "像", "天使", "angel statue"], loc: "l3s", scenery: true,
      desc: "翼を広げた、顔のない天使の像。台座に、誰にも読めない文字が刻まれている。像の足もとにだけ、埃が積もっていない。" });

    // ---- レベル4「放棄されたオフィス」
    thing("cooler", { name: "給水器", aliases: ["給水器", "ウォーターサーバー", "cooler"], loc: "l4a", scenery: true, drink: true, tap: true,
      desc: () => S.cooler > 0 ? `オフィスの給水器。タンクの中身は、ほんのり白く濁っている。アーモンド水だ。残りは、${S.cooler === 1 ? "底のほうに、ほんの少し" : "紙コップ二杯ぶんくらい"}。` : "オフィスの給水器。タンクは空だ。" });
    thing("vend", { name: "自動販売機", aliases: ["自動販売機", "自販機", "vending machine"], loc: "l4a", scenery: true,
      desc: () => "壁ぎわの自動販売機。灰色の魔法瓶が一列だけ並んでいる。値段の表示はない。" + (S.vend ? "取り出し口は空だ。" : "ボタンが一つ、光っている。") });
    thing("waterV", { name: "アーモンド水（自販機）", aliases: ["アーモンド水（自販機）", "自販機の水", "アーモンド水", "vending water"], take: true, drink: true,
      desc: "自動販売機から出てきた灰色の魔法瓶。まだ冷たい。" });
    thing("terminal", { name: "端末", aliases: ["端末", "パソコン", "画面", "terminal"], loc: "l4a", scenery: true,
      desc: "まだ点いている端末。M.E.G. 基地オメガの掲示板が開いたままだ。",
      read: () => { S.bulletin = true; emit("align"); emit("sfx", "beep"); return "M.E.G. 基地オメガ　掲示（受信日時不明）\n・レベル37で、車の走る音を聞いたという報告。「いちばん浅いプールの、いちばん深いところ」（未確認・報告者とは連絡がつかない）\n・経路の報告：ボイラー室 → 暗闇 → 横倒しの部屋 → 海の底の洞窟 → ……（ここから先は、文字化けしている）\n・風船の扉の先は、近道に見える。近道ではない。\n・塗られていない窓の報告が、また一件。報告者は戻っていない。\n・給水器のタンクは、補充されていない。"; } });
    thing("drawer", { name: "引き出し", aliases: ["引き出し", "机", "drawer"], loc: "l4a", scenery: true, container: true, closed: true,
      desc: () => O.drawer.closed ? "部屋に一つだけ残った事務机の引き出し。" : "開いた引き出し。" });
    thing("ration2", { name: "ロイヤルレーション（二つ目）", aliases: ["ロイヤルレーション（二つ目）", "二つ目", "ロイヤルレーション", "レーション", "second ration"], loc: "drawer", take: true, food: true,
      desc: "銀色の包みの携帯食。" });
    thing("battery2", { name: "電池（二本目）", aliases: ["電池（二本目）", "二本目の電池", "電池", "second battery"], loc: "drawer", take: true, battery: 40,
      desc: "単一の電池。" });
    thing("invite", { name: "招待状", aliases: ["招待状", "カード", "invitation"], loc: "l4a", take: true,
      desc: "床の上の、黄色いカード。角に風船の絵。",
      read: () => { S.invited = true; return "「あなたは招待されています =)」\n裏返すと、同じ字がびっしり。=) =) =) =) =)"; } });
    thing("window4", { name: "塗られていない窓", aliases: ["塗られていない窓", "窓", "unpainted window"], loc: "l4a", scenery: true,
      desc: () => S.l4.win ? "窓の向こうに、見覚えのある部屋。……目が、離せない。" : "黒く塗られた窓の列の中に、一枚だけ、塗られていない窓がある。向こうは、昼の光だ。" });
    thing("faceling", { name: "顔のない人", aliases: ["顔のない人", "人", "フェイスリング", "faceling"], loc: "l4b", scenery: true,
      desc: () => { note("faceling"); return "会議室の椅子に、スーツの人が座っている。顔があるはずのところが、なめらかな皮膚だけだ。電源の入っていないノートパソコンを、でたらめに叩いている。"; } });
    thing("board4", { name: "ホワイトボード", aliases: ["ホワイトボード", "ボード", "board"], loc: "l4b", scenery: true,
      desc: "会議室のホワイトボード。", read: () => S.facePointed ? "大きな「=)」に、赤いペンでばつ印。その横に、矢印。「5」。" : "会議の予定表。日付の欄が全部、同じ日だ。" });
    thing("door5", { name: "5の扉", aliases: ["5の扉", "5", "door 5"], loc: "l4c", scenery: true,
      desc: "番号札「5」のついた、古風な木の扉。隙間から、レコードの音。" });
    thing("doorb", { name: "風船の扉", aliases: ["風船の扉", "風船", "balloon door"], loc: "l4c", scenery: true,
      desc: "色とりどりの風船が、取っ手に結びつけてある扉。隙間から、楽しそうな音楽。小さなシールに「=)」。" });
    thing("intercom", { name: "インターホン", aliases: ["インターホン", "鷲の扉", "扉", "intercom"], loc: "l4c", scenery: true,
      desc: "鷲の印の、重い扉。「BASE Ω」。横にインターホン。カメラが一つ、こちらを見ている。" });

    // ---- レベル5「恐怖のホテル」
    thing("bell", { name: "呼び鈴", aliases: ["呼び鈴", "ベル", "bell"], loc: "l5a", scenery: true,
      desc: "フロントの真鍮の呼び鈴。指紋ひとつない。" });
    thing("register", { name: "宿帳", aliases: ["宿帳", "台帳", "register"], loc: "l5a", scenery: true,
      desc: "開いたままの宿帳。",
      read: () => "どのページも、チェックインの記録だけ。チェックアウトの欄は、全部空いている。\nいちばん新しい行だけ、インクが乾いていない。「ワンダラー　一名」" + (LOOP.n ? "\nその字は、自分の字だ。" : "\nその一行上も、同じ字だ。") });
    thing("rack", { name: "鍵掛け", aliases: ["鍵掛け", "キーボックス", "key rack"], loc: "l5a", scenery: true,
      desc: "部屋の鍵がずらりと並ぶ鍵掛け。番号は、どれも並び順になっていない。いちばん端の「ボイラー室」の鉤だけ、空いている。" });
    thing("portraits", { name: "肖像画", aliases: ["肖像画", "絵", "壁紙", "portraits"], loc: "l5b", scenery: true,
      desc: "深紅と金の壁紙に、肖像画が並ぶ。どの人も、少しずつ、こちらのほうを向いている。……さっきより。壁紙の模様も、顔に見える。" });
    thing("bdoor", { name: "ボイラー室の扉", aliases: ["ボイラー室の扉", "扉", "boiler door"], loc: "l5b", scenery: true,
      desc: () => S.boilerOpen ? "ボイラー室の扉。開いている。熱気が漏れてくる。" : "廊下の西の端の、鉄の扉。「ボイラー室」。鍵がかかっている。" });
    thing("mothdoor", { name: "暗い客室", aliases: ["暗い客室", "客室", "半開きの扉", "dark room"], loc: "l5b", scenery: true,
      desc: "金色の札の番号が「7½」の客室。扉が半開きで、中は真っ暗。天井のあたりで、何かが乾いた翅をたたむ音。" });
    thing("liftdoor5", { name: "エレベーター", aliases: ["エレベーター", "昇降機", "elevator"], loc: "l5b", scenery: true,
      desc: "銅の格子の、古いエレベーター。扉は開いている。" });
    thing("turntable", { name: "蓄音機", aliases: ["蓄音機", "レコード", "turntable"], loc: "l5c", scenery: true,
      desc: () => songOn() ? "壁ぎわの蓄音機で、レコードが回っている。誰も針を落としていないのに。ジャズ。" : "蓄音機の針が、ひとりでに上がっている。次のレコードを待つように。" });
    thing("mahjong", { name: "麻雀卓", aliases: ["麻雀卓", "麻雀", "卓", "テーブル", "mahjong table"], loc: "l5c", scenery: true,
      desc: () => "シャンデリアの真下の、小さな卓。飲みかけのグラスと、打ちかけの麻雀。牌は、あと一手で上がれそうに並んでいる。" + (O.bkey.loc === "l5c" ? "牌のあいだに、鍵が一本置いてある。" : "") + (S.invited ? "\nグラスの下に、黄色いカード。「あとで来てね =)」" : "") });
    thing("bkey", { name: "ボイラー室の鍵", aliases: ["ボイラー室の鍵", "鍵", "boiler key"], loc: "l5c", take: true,
      desc: "重い鉄の鍵。タグに「ボイラー室」。" });
    thing("btn1", { name: "1のボタン", aliases: ["1のボタン", "1", "button 1"], loc: "l5e", scenery: true, desc: "真鍮のボタン「1」。" });
    thing("btn5", { name: "5のボタン", aliases: ["5のボタン", "5", "button 5"], loc: "l5e", scenery: true, desc: "真鍮のボタン「5」。横に小さく「H.K.」。" });
    thing("btn13", { name: "13のボタン", aliases: ["13のボタン", "13", "button 13"], loc: "l5e", scenery: true,
      desc: "「13」のボタン。そこだけ、指の脂で黒ずんでいる。その上には、382まで、ずらりとボタンが並ぶ。" });
    thing("cart5", { name: "ワゴン", aliases: ["ワゴン", "台車", "cart"], loc: "l5h", scenery: true,
      desc: "シーツを積んだワゴン。白い腕章に、鷲の印。" });
    thing("waterB", { name: "青い魔法瓶", aliases: ["青い魔法瓶", "青い瓶", "アーモンド水", "blue thermos"], loc: "l5h", take: true, drink: true, blue: true,
      desc: "青い魔法瓶。口もとまで満ちている。ラベルに「眠れない夜に／引き返したい人に」。" });
    thing("note5", { name: "引き継ぎメモ", aliases: ["引き継ぎメモ", "メモ", "handover note"], loc: "l5h", take: true,
      desc: "ワゴンに挟まった、M.E.G. ハウスキーピングの引き継ぎメモ。",
      read: () => { S.l5.note = true; return "「ボイラー室の鍵は、舞踏室（ビバリールーム）の卓の上。レコードが鳴っているあいだは、触るな。針が上がってから」\n「13より上を押した客は、今月三人目」\n「暗い客室（7½）は巣。開けるな」\n「ボイラー室の奥、梯子の先が6。灯りは役に立たない。耳で行け」\n「ロビーの間のことは、書かないこと」"; } });
    thing("furnace", { name: "ボイラー", aliases: ["ボイラー", "炉", "furnace"], loc: "l5d", scenery: true,
      desc: "唸りを上げる巨大なボイラー。焚き口の奥から、囁くような音。裏に回ると、床に四角い穴。下へ梯子が延びている。その先は、真っ暗だ。" });
    thing("leak5", { name: "漏れている管", aliases: ["漏れている管", "管", "漏れ", "leaking pipe"], loc: "l5d", scenery: true, drink: true, leak: true,
      desc: "天井の管の継ぎ目から、透明な水が滴っている。アーモンドの匂い。" });

    // ---- レベル6「消灯」
    thing("switch6", { name: "スイッチ", aliases: ["スイッチ", "明かりのスイッチ", "light switch"], scenery: true, feel: true,
      desc: "手探りで触れる。壁に、ふつうの明かりのスイッチ。今は「切」のほうに倒れている。" });
    thing("beggar6", { name: "囁く人", aliases: ["囁く人", "人", "声", "whispering person"], scenery: true, feel: true,
      desc: "すぐ横で、誰かが、同じ調子で囁いている。「お願い。スイッチを入れて。入れてくれるだけでいい」" });

    // ---- レベル7「海洋恐怖症」
    thing("shelf7", { name: "本棚", aliases: ["本棚", "本", "bookcase"], loc: "l7a", scenery: true,
      desc: "左の壁の本棚。背表紙の字は、どれも読めない。一冊だけ、M.E.G. の印のついた帳面が差してある。" });
    thing("log7", { name: "帳面", aliases: ["帳面", "M.E.G.の帳面", "log"], loc: "l7a", take: true,
      desc: "水を吸って膨らんだ帳面。",
      read: () => { note("7"); return "M.E.G. 臨時記録（入口の部屋）\n「戸口の前に立つな。重さが、海のほうへ向く」\n「降りるなら、ロープを戸口に結べ。戻る道は、それしかない」\n「この部屋の空気を吸っておけ。驚くほど、息が続く」\n「洞窟は、この部屋の真下の山の腹。昼、薄明、真夜中。三つ潜れ」\n「浅いところの影は耳がいい。通るあいだは、動くな」\n「真夜中のやつは、光を嫌う。灯りを持っていけ」" + (LOOP.n ? "\n余白に、自分の字。「三つ目で、灯りを」" : ""); } });
    thing("chair7", { name: "椅子", aliases: ["椅子", "chair"], loc: "l7a", scenery: true, desc: "一脚だけの椅子。座面が、ほんのり温かい。" });
    thing("lamp7", { name: "照明", aliases: ["照明", "蛍光灯", "lamp"], loc: "l7a", scenery: true, desc: "天井の蛍光灯。……天井だと思っていた面は、壁かもしれない。" });
    thing("rope", { name: "ロープ", aliases: ["ロープ", "綱", "rope"], loc: "l7a", take: true,
      desc: () => S.l7.rope ? "戸口の金具に結んだロープが、下の海へ垂れている。" : "床に巻いて置かれた、太いロープ。端に、金具に掛けるためのフック。" });
    thing("doorway7", { name: "戸口", aliases: ["戸口", "扉", "doorway"], loc: "l7a", scenery: true,
      desc: () => "部屋の向かいの戸口。……向こう側は、下だ。4メートル半ほど下に、黒い海が広がっている。戸口の枠に、ロープを掛ける金具。" + (S.l7.rope ? "ロープが結んである。" : "") });
    thing("sea7", { name: "海", aliases: ["海", "水", "sea"], loc: "l7b", scenery: true,
      desc: "果てのない、黒い海。ほの暗い光が、どこからともなく水面を照らしている。真上のコンクリートの天井に、入口の部屋の戸口が、四角く開いている。遠くの島に、壊れた家具を組んだ小屋。人影が、こちらを指さしている。" });
    thing("bones7", { name: "骨", aliases: ["骨", "骸骨", "bones"], loc: "l7d", scenery: true,
      desc: "人に似た骸骨。顎がひどく大きく、長い歯が並んでいる。脚の先は、ひれの形だ。骨のあちこちに、もっと大きな歯の跡。" });
    thing("cave7", { name: "洞窟", aliases: ["洞窟", "穴", "山", "cave"], loc: "l7e", scenery: true, feel: true,
      desc: () => lightOn() ? "光の輪の中に、海の底からそびえる山の斜面。その腹に、黒い洞窟が口を開けている。" : "手を伸ばすと、ざらざらした岩肌。山の斜面だ。どこかに、穴があるはずだ。" });
    thing("tiny7", { name: "影", aliases: ["影", "大きな影", "shadow"], scenery: true, feel: true,
      desc: "下を、とてつもなく大きな影が通っている。部屋より大きい。" });
    thing("thing7", { name: "何か", aliases: ["何か", "下の何か", "thing"], scenery: true, feel: true,
      desc: "真っ暗な下のほうで、何か巨大なものが、ゆっくり向きを変えている。" });
    // ---- レベル8（洞窟）
    thing("sign8", { name: "看板", aliases: ["看板", "標示", "sign"], loc: "l8a", scenery: true,
      desc: "蜘蛛の巣をかぶった木の看板。かすかに光る塗料で、鷲の印と字が書いてある。",
      read: () => { note("8"); return "M.E.G.　9番道路　起点\n「標識に従え。標識を見失うな」\n「眠るな。水に浸かるな」\n「ここでは、灯りは長くもたない」"; } });
    thing("lake8", { name: "地底湖", aliases: ["地底湖", "湖", "水", "underground lake"], en: "underground lake", loc: "l8a", scenery: true, drink: true, lake: true,
      desc: "黒く静かな地底湖。さっき、ここから這い上がった。水は、ほんのりアーモンドの匂いがする。" });
    thing("body8", { name: "遺体", aliases: ["遺体", "死体", "男", "body"], loc: "l8a", scenery: true,
      desc: () => "岩壁にもたれて座っている男。頭の横が、へこんでいる。壁を登ろうとして、落ちたのだろう。まだ、腐っていない。" + (O.coat.loc === "l8a" ? "厚手の上着を着ている。" : "上着は、もう着ていない。") + (O.pack8.loc === "l8a" ? "足もとに、リュック。" : "") });
    thing("coat", { name: "上着", aliases: ["上着", "防寒着", "ジャケット", "coat"], loc: "l8a", take: true,
      desc: "遺体が着ている、厚手の防寒着。内側はフリース、外側は防水の布。胸に「ハーマウス洞窟協会」の刺繍。" });
    thing("pack8", { name: "リュック", aliases: ["リュック", "バッグ", "backpack"], loc: "l8a", scenery: true, container: true, closed: true,
      desc: () => O.pack8.closed ? "遺体の足もとの、泥だらけのリュック。" : "口の開いたリュック。" });
    thing("battery3", { name: "古い電池", aliases: ["古い電池", "電池", "old battery"], loc: "pack8", take: true, battery: 15,
      desc: "端が錆びた電池。少しは残っているかもしれない。" });
    thing("scrap8", { name: "地図の切れ端", aliases: ["地図の切れ端", "切れ端", "紙", "map scrap"], loc: "pack8", take: true,
      desc: "鉛筆で描いた、洞窟の地図の切れ端。",
      read: "番号つきの丸が、点線でつながっている。余白に、走り書き。\n「羽音 → 灯り」\n「玉ねぎの匂い → ×」\n「暗いときは、待つ。光が来る」\n「床が薄いところ → 」\nそこで、破れている。" });
    thing("marker8", { name: "標識", aliases: ["標識", "M.E.G.の標識", "marker"], loc: "l8r", scenery: true,
      desc: () => lightOn() ? `M.E.G. の鷲の印と、番号「#${S.c8.num + S.c8.step}」。その下の矢印は、${DIR_JA[S.c8.route[S.c8.step]]}を指している。` : "岩に打ちつけた金属の板。蛍光塗料は、ほとんど剥げている。暗くて、番号も矢印も分からない。" });
    thing("rock8", { name: "浮かぶ岩", aliases: ["浮かぶ岩", "岩", "floating rock"], loc: "l8r", scenery: true,
      desc: "宙に浮いた岩がいくつか。拳ほどのものから、机ほどのものまで。音もなく、ゆっくり回っている。" });
    thing("balloon8", { name: "赤い風船", aliases: ["赤い風船", "風船", "red balloon"], scenery: true, feel: true,
      desc: "穴の暗がりに、赤い風船がひとつ浮いている。風もないのに、こちらへ寄ってくる。垂れたリボンの先が、ひくひく動いた。" });
    thing("moths", { name: "蛾", aliases: ["蛾", "羽音", "moths"], scenery: true, feel: true,
      desc: "天井いっぱいに、手のひらより大きな蛾がとまっている。翅がこすれ合うたびに、銀色の粉が降る。" });
    thing("chime8", { name: "石の風鈴", aliases: ["石の風鈴", "風鈴", "stone chimes"], loc: "l8z", scenery: true, feel: true,
      desc: "天井から、石の鎖で吊られた風鈴。鍾乳石が、なぜか楽器の形に育っている。そばには、石のギターと、石のラッパ。" });
    // ---- レベル9（郊外）
    thing("man9", { name: "男", aliases: ["手招きする男", "男", "人", "man"], loc: "l9a", scenery: true, feel: true,
      desc: () => {
        let t = `${DIR_JA[S.l9.side]}の家の玄関先に、男が立っている。こちらに手招きしている。「霧が来る。中に入れ」\n片腕に、深い切り傷。指先から、何かが垂れている。`;
        if (!(lightOn() || lamp9())) return t + "暗くて、それが何色なのか分からない。";
        return t + (S.l9.clear ? "垂れているのは、水のように透明なものだった。" : "垂れているのは、赤い血だった。");
      } });
    thing("lamp9", { name: "街灯", aliases: ["街灯", "外灯", "street lamp"], loc: "l9a", scenery: true,
      desc: () => lamp9() ? "街灯が、今だけ点いている。じじ、と鳴っている。" : "消えた街灯。ときどき、思い出したように点く。" });
    thing("sign9", { name: "矢印の標識", aliases: ["矢印の標識", "標識", "arrow sign"], loc: "l9a", scenery: true,
      desc: "「11 →」と書いた矢印の標識。風もないのに、ゆっくり回っている。止まるたびに、違う方を指す。" });
    thing("fence9", { name: "落書き", aliases: ["塀の落書き", "落書き", "chalk"], loc: "l9a", scenery: true,
      desc: "塀に、チョークの落書き。", read: "子どもの字。「あかは いきてる」\nその先は、雨で流れて読めない。" });
    thing("houseW", { name: "西の家", aliases: ["西の家", "左の家", "west house"], loc: "l9a", scenery: true, feel: true,
      desc: "西側の家。窓は暗い。玄関のポーチに、枯れ葉が積もっている。" });
    thing("houseE", { name: "東の家", aliases: ["東の家", "右の家", "east house"], loc: "l9a", scenery: true, feel: true,
      desc: "東側の家。窓は暗い。郵便受けに、新聞が差さったまま。" });
    thing("fridge9", { name: "冷蔵庫", aliases: ["冷蔵庫", "fridge"], loc: "l9h", scenery: true, container: true, closed: true,
      desc: () => O.fridge9.closed ? "台所の冷蔵庫。動いていない。扉に、メモが一枚、磁石で留めてある。" : "開いた冷蔵庫。ぬるい空気。" });
    thing("can9", { name: "缶詰", aliases: ["缶詰", "缶", "can"], loc: "fridge9", take: true, food: true,
      desc: "ラベルのない缶詰。振ると、重たい音がする。" });
    thing("memo9", { name: "メモ", aliases: ["メモ", "紙", "note"], loc: "l9h", scenery: true,
      desc: "冷蔵庫の扉のメモ。",
      read: () => { note("9"); return "M.E.G.（走り書き）\n「畑へ出たいなら、裏庭の小道を外れて、草の中へ」\n「小道をたどると、通りに戻される」\n「透明な血の者を、家に入れるな」"; } });
    thing("tv9", { name: "テレビ", aliases: ["テレビ", "tv"], loc: "l9h", scenery: true,
      desc: "電源の入っていないテレビ。黒い画面に、居間が映っている。" });
    thing("path9", { name: "小道", aliases: ["石の小道", "小道", "path"], loc: "l9y", scenery: true,
      desc: "平たい石を並べた小道。生け垣の門を抜けて、まっすぐ北の草原へ続いている。" });
    thing("grass9", { name: "草", aliases: ["草原", "草", "grass"], loc: "l9y", scenery: true,
      desc: "小道の両側は、膝までの草。風もないのに、波のように揺れている。" });
    // ---- レベル10（麦畑）
    thing("wheat", { name: "麦", aliases: ["麦の穂", "麦畑", "麦", "wheat"], loc: "l10a", scenery: true, food: true,
      desc: "大麦と小麦が、胸の高さまで実っている。穂を一本折ってみる。乾いていて、少しも傷んでいない。" });
    thing("lake10", { name: "湖", aliases: ["湖", "水", "lake"], loc: "l10a", scenery: true, drink: true, lake: true,
      desc: "低いところに、澄んだ湖。藻ひとつ浮いていない。" });
    thing("barn", { name: "納屋", aliases: ["赤い納屋", "納屋", "barn"], loc: "l10a", scenery: true,
      desc: "東の生け垣の向こうに、赤い納屋。屋根の下に、小さな窓。" });
    thing("kayu", { name: "麦粥", aliases: ["麦粥", "鍋", "粥", "porridge"], loc: "l10b", scenery: true, food: true,
      desc: () => S.l10.ate ? "鍋の麦粥は、減っていない。さっき食べたぶんも、元に戻っている。湯気が立っている。" : "冷えたかまどの上の鍋。麦粥が、たっぷり入っている。火の気はないのに、湯気が立っている。" });
    thing("diary10", { name: "日記", aliases: ["日記", "ノート", "diary"], loc: "l10b", scenery: true,
      desc: "子どもの字の日記。",
      read: "「母さんが、新しい木の踏み段を作った。わたしは、麦の穂を一本、踏み段に置いた。腐っていくのを見るのが好きだから」\n「十日たっても、穂は腐らない。ミミズが来て、かじって、引き返していった」\n「わたしたちが食べているのは、これだけだ」\n「父さんは、毎晩、麦粥をおかわりする。おかわりした夜は、とてもよく眠る。朝になっても、起きてこない日がある」\n（その先は、字が薄くて読めない）" });
    thing("straw", { name: "藁", aliases: ["藁の寝床", "藁", "寝床", "straw"], loc: "l10b", scenery: true,
      desc: "干し草を積んだ寝床。人の形に、くぼんでいる。ひどく、寝心地がよさそうだ。" });
    thing("step10", { name: "踏み段", aliases: ["踏み段", "戸口", "doorstep"], loc: "l10b", scenery: true,
      desc: "戸口の、新しい木の踏み段。麦の穂が一本、置いてある。色も形も、摘んだばかりのようだ。" });
    thing("window10", { name: "窓", aliases: ["小さな窓", "窓", "window"], loc: "l10c", scenery: true,
      desc: () => `屋根裏の窓。曇り空の下、麦畑がどこまでも続いている。${DIR_JA[S.l10.road]}の生け垣の向こうに、二本の轍の線が、まっすぐ延びている。` });
    thing("ruts", { name: "轍", aliases: ["轍", "道", "ruts"], loc: "l10d", scenery: true,
      desc: () => S.l10.walk >= 2 ? `道が東と西に分かれている。${DIR_JA[S.l10.fork]}の轍はくっきりと新しい。もう一方は、草に埋もれかけている。` : "二本の轍と、そのあいだの草の筋。誰かが毎日通っているような跡。車は、見えない。" });
    // ---- レベル11（街）
    for (const [c, ja] of [["blue", "青"], ["white", "白"], ["red", "赤"]]) {
      thing("arrow_" + c, { name: `${ja}い矢印`, aliases: [`${ja}い矢印`, `${ja}の矢印`, `${c} arrow`], en: `${c} arrow`, loc: "l11a", scenery: true,
        desc: () => `路面にスプレーで描いた、${ja}い矢印。${DIR_JA[S.l11.dirs[c]]}を指している。` + (c === "blue" ? "矢印の根もとに、鷲の印。" : "") });
    }
    thing("hound11", { name: "ハウンド", aliases: ["ハウンド", "四つ足の何か", "hound"], en: "city hound", loc: "l11a", scenery: true, feel: true,
      desc: () => { note("hound"); return "歩道の端に、ハウンドが一匹、寝そべっている。こちらを見ても、起き上がらない。背中の毛が、ときどき逆立つ。"; } });
    thing("mirror11", { name: "ビルの窓", aliases: ["ビルの窓", "窓", "ビル", "windows"], loc: "l11a", scenery: true,
      desc: "ビルの窓は、どれも黒い鏡のようだ。中は見えない。映っているのは、通りと、自分だけ。" });
    thing("cars11", { name: "車", aliases: ["車", "cars"], loc: "l11a", scenery: true,
      desc: "路肩に停まった車。鍵はかかっていない。燃料計の針は、どれも空を指している。" });
    thing("officer", { name: "隊員", aliases: ["M.E.G.の隊員", "隊員", "女", "officer"], loc: "l11c", scenery: true,
      desc: "鷲の印の腕章をつけた、疲れた顔の女。机の地図に、赤い印をつけている。" });
    thing("map11", { name: "地図", aliases: ["壁の地図", "地図", "map"], loc: "l11c", scenery: true,
      desc: "壁いっぱいの、手描きの街の地図。",
      read: () => {
        S.l11.map = true;
        emit("align");
        const ja = { white: "白", red: "赤" }, other = S.l11.pool === "white" ? "red" : "white";
        return `M.E.G. 基地ベータ周辺図（手描き）\n「青い矢印：基地ベータ」\n「${ja[S.l11.pool]}い矢印：屋内プール」その横に「37」と書いて、線で消してある。さらに横に、別の字で「帰れる？」\n「${ja[other]}い矢印：バリケード。出口多数。立入禁止。花を供えること」`;
      } });
    thing("judges", { name: "判定機", aliases: ["五台の判定機", "判定機", "端末", "judges"], loc: "l11c", scenery: true,
      desc: "部屋の隅に、古い端末が五台。それぞれに、A〜E の札。画面に、緑の文字が流れている。",
      read: () => {
        const a = audit();
        S.l11.judged = (S.l11.judged || 0) + 1;
        const tags = ["core", "related", "off"];
        const j = ["A", "B", "C", "D", "E"].map((x, i) => `${x}：${i === 4 && S.l11.judged === 1 ? "再判定待ち" : tags[(i + S.moves + S.l11.judged) % 3]}`).join("／");
        const score = Math.max(3, Math.min(97, 100 - S.falls * 21 - Object.keys(S.hints).length * 4 - (S.moves >> 4)));
        return `標本記録：ワンダラー（名前の欄は空白）\n判定 ${j}\n関連度 ${score}／100　一致率 ${a.rate}%　取りこぼし ${a.missed}件\n注記：要約が記憶を上書きした形跡あり。原文で確かめられない項目がある。\n注記：一つの判定を信じるな。別の機で確かめ直すこと。` +
          (S.l11.judged > 1 ? "\n（再判定）さっきと、仕分けが違う。どちらが正しいのかは、画面には書いていない。" : "") +
          (LOOP.n ? `\n前回の標本と一致しない項目：${1 + (LOOP.n % 4)}件。` : "");
      } });
    thing("roster", { name: "名簿", aliases: ["名簿", "register"], loc: "l11c", scenery: true,
      desc: "机の上の名簿。",
      read: () => "名前が、何ページにもわたって並んでいる。どの行にも、日付がない。\n" + (LOOP.n ? "いちばん新しい行に、見覚えのある字。自分の字に、よく似ている。" : "いちばん下の行だけ、空いている。ペンが、そこに置いてある。") });
    thing("water4", { name: "アーモンド水（四本目）", aliases: ["アーモンド水（四本目）", "四本目", "アーモンド水", "ボトル", "fourth almond water"], take: true, drink: true,
      desc: "M.E.G. の印のついたボトル。" });
    thing("water3", { name: "アーモンド水（三本目）", aliases: ["アーモンド水（三本目）", "三本目", "アーモンド水", "ボトル", "third almond water"], take: true, drink: true,
      desc: "飲みかけのボトル。半分くらい残っている。" });
    thing("barricade", { name: "バリケード", aliases: ["バリケード", "barricade"], loc: "l11x", scenery: true,
      desc: "車と家具を積み上げたバリケード。スプレーで大きく「この先 出口多数　立入禁止」。隙間から、通りの向こうが見える。いくつもの扉が、勝手に開いたり閉じたりしている。" });
    thing("memorial", { name: "献花", aliases: ["献花", "花", "写真", "flowers"], loc: "l11x", scenery: true,
      desc: "バリケードの足もとに、しおれた花と、写真と、名前を書いた紙。",
      read: () => "「この先に入って、帰ってこなかった人たちへ」\n名前が並んでいる。写真の顔は、どれも少しずつ色が抜けている。" + (LOOP.n ? "\nいちばん新しい写真は、裏返しになっている。めくる気にはなれない。" : "") });
    thing("balloons11", { name: "風船", aliases: ["風船", "balloons"], en: "alley balloons", loc: "l11b", scenery: true, feel: true,
      desc: "非常階段に結ばれた、色とりどりの風船。風もないのに、こちらへ寄ってくる。甘い、ケーキのような匂い。リボンが、ひくひく動いた。" });
    thing("poster11", { name: "ポスター", aliases: ["ポスター", "貼り紙", "poster"], loc: "l11b", scenery: true,
      desc: "壁の黄色いポスター。", read: "「パーティー　今夜　みんな来てね =)」\n下の余白に、誰かの字で小さく。「行くな」" });
    thing("partydoor", { name: "=)の扉", aliases: ["=)の扉", "扉", "party door"], loc: "l11b", scenery: true,
      desc: "路地の奥の扉。ノブに「=)」のシール。隙間から、楽しそうな音楽。" });
    thing("capsule", { name: "カプセル", aliases: ["カプセル", "寝台", "capsule"], loc: "l433", scenery: true,
      desc: "人ひとりぶんの、白いカプセル。中は、きれいに整えられた布団。枕に、くぼみ。" });
    thing("pool11", { name: "プール", aliases: ["屋内プール", "プール", "水", "indoor pool"], loc: "l11p", scenery: true,
      desc: "二十五メートルのプール。水が張ってある。照明が半分だけ点いていて、底のタイルのレーンの線が揺れている。" });
    // ---- レベル37
    thing("pools", { name: "プール", aliases: ["プール", "水", "pools"], loc: "l37a", scenery: true,
      desc: "白いタイルに囲まれた、浅いプールがいくつも。水は体温と同じくらい温かい。" });
    thing("deep", { name: "深いプール", aliases: ["深いプール", "プール", "deep pool"], loc: "l37b", scenery: true,
      desc: "底の見えないプール。白いタイルの壁が、どこまでも下へ続いている。" });
    thing("drain", { name: "排水口", aliases: ["排水口", "格子", "drain"], loc: "l37c", scenery: true,
      desc: () => S.drain ? "格子の外れた排水口。細い梯子が下へ続いている。" : "床がわずかに傾いた、そのいちばん低いところに、排水口の格子。耳を近づけると、遠くで車の走る音。" });

    // ---- レベル Fun
    thing("partygoers", { name: "パーティーゴアー", aliases: ["パーティーゴアー", "黄色い人たち", "人たち", "partygoers"], loc: "lfun", scenery: true,
      desc: () => { note("party"); return "黄色い、のっぺりした体の人たち。顔には、マジックで描いたような笑顔。全員が、こちらを見ている。=)"; } });
    thing("cake", { name: "ケーキ", aliases: ["ケーキ", "cake"], loc: "lfun", scenery: true, food: true,
      desc: "真っ白な大きなケーキ。ろうそくの数が、多すぎて数えられない。切り口が、赤い。" });
    thing("balloons", { name: "風船", aliases: ["風船", "紙吹雪", "balloons"], loc: "lfun", scenery: true,
      desc: "天井いっぱいの風船。一つ一つに、「=)」と描いてある。" });
    thing("doorx", { name: "「!」の扉", aliases: ["「!」の扉", "!の扉", "非常扉", "扉", "exclamation door"], loc: "lfun", scenery: true,
      desc: "部屋の隅の、赤い非常扉。殴り書きの「!」。" });
  }

  // ---- 部屋 ----
  // レベル0は、どこへ行っても似た部屋。少しずつ違うことが起きる
  const YELLOW = [
    "低い天井。どの壁にも、同じ黄色い壁紙。",
    "細長い通路。突き当たりで、また同じ幅の通路に分かれている。",
    "コンセントが一つだけある部屋。どこにもつながっていない。",
    "カーペットの一角だけ、色が濃い。誰かが長く座っていたような跡。",
    "天井のパネルが一枚、外れている。奥は暗い。",
    "ドアのない戸口が四つ。どれも、同じ部屋へ続いている。",
    "壁紙に、子どもの背丈くらいの高さで、線が引かれている。日付はない。",
    "ここだけ蛍光灯が一本切れていて、隅が暗い。暗いところを、見ないようにする。",
    "床に、ボトルのキャップが一つ。中身は、どこにもない。",
    "壁の低いところに、爪で引っかいた線。五本ずつ束ねてある。途中でやめている。",
    "どこかで、電話が鳴っているような気がする。耳をすますと、蛍光灯のうなりだけ。",
    "床に、印刷された写真が一枚。この部屋とそっくりの、黄色い壁紙の廊下。裏に、鉛筆で「2019」とだけ書いてある。",
    "カーペットに、裸足の足跡。この部屋で、ぐるぐると円を描いて、途切れている。",
    "壁に、マーカーで矢印が描いてある。矢印の先の壁にも、同じ矢印。その先にも。",
    "壁の向こうで、爪を研ぐような音がする。こちらが止まると、音も止まる。",
  ];
  const L0_KIND = {
    arch: "白っぽい壁に、アーチ形の穴がいくつも開いている。カーペットが深く、水を吸って重い。アーチの縁は、腰かけられるほどの幅がある。……この部屋は、背後で形を変えない気がする。",
    pillar: "太い柱が、格子のように等間隔に並んでいる。柱の向こうにも柱。そのまた向こうにも。どこまでも。",
    hole: "床に、黒い四角い穴が、格子のように並んで開いている。光は、穴の縁から先へ届かない。",
    manila: "ここだけ、壁紙がマニラ紙のような薄茶色だ。床は木の板。八角形のテーブルと、椅子が二脚。四つの壁に、木の扉。\n蛍光灯のうなりが、ここでは聞こえない。どこからか、静かなピアノ。……誰かが、すぐ近くにいる気がする。",
  };
  const ROOMS = {
    l0: { name: "黄色い部屋", exits: { n: "l0", s: "l0", e: "l0", w: "l0" },
      desc: () => (L0_KIND[S.l0.kind] || YELLOW[S.l0.i]) +
        (S.l0.seam ? "\n東の壁の一か所だけ、蛍光灯の明滅と半拍ずれて、壁そのものがちらついている。ちらつきの奥から、冷たい空気。" : "") +
        (LOOP.n && S.l0.steps % 4 === 3 ? "\nカーペットに、自分と同じ靴の足跡。こちらへ来る向きで。" : "") +
        (S.l0.kind === "manila" ? "" : "\n湿ったカーペットの匂い。うなりつづける蛍光灯。どの方向にも、同じような部屋が続いている。") },
    l1a: { name: "倉庫の広間", exits: { n: "l1c", e: "l1b", s: "l1a", w: "l1a" },
      desc: () => ["コンクリートの柱が並ぶ、地下駐車場のような広間。", "鉄骨の棚が両側に続く広間。棚は全部、空っぽだ。", "天井の高い吹き抜け。上のほうに霧が溜まっている。"][S.l1v] +
        "床のあちこちに水たまり。照明が、ときどき息をするように暗くなる。\n天井の細い配管が、北へ行くほど束になっていく。東の金網の向こうの扉の上に、緑の非常灯。" +
        (O.cloth1.loc === "l1a" ? "\n柱に、黄緑色の布が結ばれている。" : S.l1.clothDown ? "\n黄緑の布が、床に置いてある。" : "") +
        (O.crate.loc === "l1a" ? "\n通路の真ん中に、木箱。" : "") },
    l1b: { name: "基地アルファの分所", exits: { w: "l1a" },
      desc: "緑の非常灯の扉の奥。通路の一室を金網で仕切った、M.E.G. 基地アルファの分所。誰もいない。簡易ベッド、机の上の無線機、番号つきのロッカーが三つ（2・5・7）。ホワイトボードと、ふやけた日誌。ここは広間より狭く、まっすぐで、距離がちゃんと距離のままだ。\n西の扉から、広間へ戻れる。" },
    l1c: { name: "配管の通路", exits: { s: "l1a", d: "l2a" },
      desc: () => isDark() ? "" : "壁も天井も、配管と計器で埋まっていく通路。照明は死んでいる。懐中電灯の輪の中で、通路はゆるい下り坂になり、その先に鉄の階段。奥から、配管を叩くような音。\n南へ戻れば広間。" },
    l2a: { name: "トンネルの入口", exits: { u: "l1c", n: "l2j", e: "l2c" },
      desc: "低く狭い整備用トンネル。45度に折れて、また45度に折れる。天井を這う太い管の多くは、もう冷えている。熱いものも、まだある。壁に、5メートルごとのステンシルと、スプレーの落書き。\n北へ、トンネルが続いている。東の脇に、段ボールの看板の部屋。上へ戻れば、レベル1。" },
    l2c: { name: "野営跡", exits: { w: "l2a" },
      desc: "折りたたみ椅子と、焦げたコンロ。段ボールの看板。かつて誰かが暮らしていた部屋。缶詰の空き缶が、きれいに積んである。部屋の隅に、毛布をかぶった人。\n西へ戻れば、トンネルの入口。" },
    l2j: { name: "分岐", exits: { n: "l2j", e: "l2j", w: "l2j", s: "l2a" },
      desc: () => `${S.j + 1}つ目の分岐。太い管が三本、北・東・西へ、45度に折れながら分かれていく。` + (S.hound === 1 || S.hound === 2 ? "\n管の陰に、四つ足の何かがいる。" : "") + "\n南へ戻れば、トンネルの入口。" },
    l2e: { name: "二つの扉", exits: { d: "l3a" },
      desc: () => "トンネルの行き止まり。扉が二つ。板を打ちつけた「3」の鉄の扉と、小さな窓のある「4」の白い扉。" + (S.l2.planks ? "「3」の扉の板は外れている。" : "") },
    l2v: { name: "黒", exits: { s: "l2e" },
      desc: () => "何もない。床があるのかも分からない。音もしない。自分の息の音さえ、口から出たとたんに消える。\n背中のほうに、入ってきた戸口が、四角く光っている。" + (S.l2.void >= 1 ? "さっきより、小さい。" : "") },
    l3a: { name: "レンガの廊下", exits: { e: "l3b", n: "l3c", w: "l3s" },
      desc: () => "赤いレンガの廊下。薄暗い蛍光灯。壁の配電箱がぱちぱちと火花を上げ、黒い泥の管が湯気を立てている。片側を、鉄格子がふさいでいる。途中に、鉄扉が一つ。" +
        (S.ss === 1 ? "その扉を、内側から誰かが叩いている。" : "") + "\n東に発電機室。北にエレベーターホール。西の奥に、レンガではない白い石の戸口。" },
    l3b: { name: "発電機室", exits: { w: "l3a" },
      desc: () => isDark() ? "" : "唸る発電機と、配電盤の部屋。四つのスイッチ。床に、赤い液体の瓶。" + (S.burnt ? "天井の電球は全部割れていて、非常灯だけが赤い。" : "") + "\n西へ戻れば廊下。" },
    l3c: { name: "エレベーターホール", exits: { s: "l3a" },
      desc: () => "古いエレベーターの扉。呼び出しボタンと、鍵穴。" + (S.power ? "どこかで、モーターが唸っている。" : "電気が来ていないようだ。") + "\n南へ戻れば廊下。" },
    l3d: { name: "鉄扉の小部屋", exits: { w: "l3a" },
      desc: "鉄扉の向こうの、狭い物置。誰もいない。床に、人の形にたるんだものが脱ぎ捨てられている。\n西の扉から廊下へ。" },
    l3s: { name: "聖所", exits: { e: "l3a" },
      desc: "レンガの壁のまま、天井だけが大聖堂のように高い部屋。白い石の柱。長椅子も、オルガンもない。正面に、翼を広げた天使の像。壁一面に、同じ天使の絵。\nここでは、機械の唸りが遠い。……ここには、何も入ってこない気がする。\n東へ戻れば廊下。" },
    l4a: { name: "オフィス", exits: { e: "l4b", n: "l4c" },
      desc: "家具のほとんどない、がらんとしたオフィス。窓はどれも黒く塗りつぶされている。……一枚を除いて。蛍光灯は静かに点いていて、ここのうなりは、少しだけやさしい。給水器、自動販売機、まだ点いている端末、事務机が一つ。床に、黄色いカード。\n東に会議室。北に階段室。" },
    l4b: { name: "会議室", exits: { w: "l4a" },
      desc: "ガラス張りの会議室。長いテーブル。椅子の一つに、スーツの人が座っている。ホワイトボード。\n西へ戻ればオフィス。" },
    l4c: { name: "階段室", exits: { s: "l4a" },
      desc: "下へ続く階段の踊り場。扉が二つ。番号札「5」の古風な扉と、風船の結ばれた扉。踊り場の奥に、鷲の印の重い扉。\n南へ戻ればオフィス。" },
    l5a: { name: "ホテルのロビー", exits: { n: "l5b" },
      desc: "古いホテルのロビー。塵ひとつない深紅の絨毯、金色の手すり、止まった柱時計。フロントに呼び鈴と宿帳。鍵掛け。どこか遠くで、レコードのジャズ。\n北に大広間の廊下。" },
    l5b: { name: "大広間の廊下", exits: () => S.boilerOpen ? { s: "l5a", e: "l5c", w: "l5d" } : { s: "l5a", e: "l5c" },
      desc: "深紅と金の壁紙の廊下が、どこまでも続く。燭台の形の電灯が、じじ、とうなる。金色の札の番号は、並び順になっていない。肖像画。半開きの暗い客室。銅の格子のエレベーター。壁の向こうで、パーティーのざわめき。西の端に「ボイラー室」の鉄の扉。\n東の大きな両開きの扉から、音楽。南へ戻ればロビー。" },
    l5c: { name: "ビバリールーム", exits: { w: "l5b" },
      desc: () => "シャンデリアの下がった舞踏室。壁にも、床にも、天井にも、扉がある。数えるたびに数が違う。真ん中に、小さな卓。打ちかけの麻雀と、飲みかけのグラス。壁ぎわの蓄音機が、" + (songOn() ? "ジャズを鳴らしている。" : "今は黙っている。") + "\n西へ戻れば廊下。" },
    l5d: { name: "ボイラー室", exits: { e: "l5b", d: "l6" },
      desc: "ひどく暑い。古い機械と、からみ合う配管。管の継ぎ目からアーモンド水が漏れ、湯気になる。巨大なボイラーが唸りを上げている。ボイラーの裏の床に、下へ続く梯子。\n東へ戻れば廊下。" },
    l5e: { name: "エレベーターの中", exits: {},
      desc: "銅の格子の箱。真鍮のボタンが、1から382まで並んでいる。目につくのは「1」「5」「13」。" },
    l5h: { name: "リネン室", exits: {},
      desc: "シーツの匂い。棚に白いタオルが積まれている。M.E.G. の出張所「ハウスキーピング」の札。誰もいない。ワゴンが一台。\nエレベーターは、扉を開けたまま待っている。" },
    l6: { name: "暗闇", exits: { n: "l6", s: "l6", e: "l6", w: "l6" },
      desc: () => "何も見えない。目を開けているのか、閉じているのかも分からない。手を伸ばすと、冷たく滑らかな壁。狭い通路だ。" + (S.l6 < 3 ? "\n耳鳴りの奥で、かすかに、波の音。" : "") },
    l7a: { name: "入口の部屋", exits: { u: "l6", d: "l7b" },
      desc: "階段の下の、家具のある小さな部屋。本棚、低いテーブル、椅子が一脚、蛍光灯。カーペットに、水たまり程度の水。\n向かいの戸口の向こうは、下だ。部屋ごと横倒しに、海の天井に埋まっている。4メートル半下に、果てのない黒い海。\n上の階段は、暗闇へ戻る。" },
    l7b: { name: "海面", exits: { d: "l7c" },
      desc: () => "黒い海に浮かんでいる。冷たい。高いコンクリートの天井が、どこまでも続く。真上に、入口の部屋の戸口。" + (S.l7.rope ? "ロープが垂れている。" : "ロープはない。戸口には、手が届かない。") + "\n真下の暗がりに、山の影がある気がする。" },
    l7c: { name: "昼の層", exits: { u: "l7b", d: "l7d" },
      desc: "水の中。上からの、ほの暗い光。何もない。魚一匹いない。" },
    l7d: { name: "薄明の層", exits: { u: "l7c", d: "l7e" },
      desc: "暗く、冷たい。錆びた金属のかけら。漂う骨。人に似た骸骨が、いくつも沈んでいく。" },
    l7e: { name: "真夜中の層", exits: { u: "l7d", d: "l8a" },
      desc: () => "真っ暗だ。水圧が、胸を押す。" + (lightOn() ? "光の輪の中に、海の底からそびえる山。斜面の腹に、洞窟が口を開けている。" : "手を伸ばすと、ざらざらした岩肌。山の斜面だ。") },
    l8a: { name: "地底湖のほとり", exits: { n: "l8r" },
      desc: () => "冷たい鍾乳洞。天井から、牙のような石が垂れている。黒い地底湖の岸に、蜘蛛の巣をかぶった看板。岩壁に、男がもたれて座っている。" +
        "\n壁のひび割れが、かすかに青く光っている。どこかで、何かがかちかちと鳴く。北へ、洞窟が続いている。" },
    l8r: { name: "9番道路", exits: { n: "l8r", e: "l8r", w: "l8r", s: "l8a" },
      desc: () => {
        const c = S.c8;
        let t = `標識のある洞窟（${NUM_JA[c.step + 1]}つ目）。濡れた岩壁に、M.E.G. の標識が打ちつけてある。宙に、岩がいくつか浮かんでいる。穴は北・東・西へ。南へ戻れば地底湖。`;
        if (c.step === c.moth && c.mothOn > 0) t += "\n天井から、銀色の粉が、はらはらと降ってくる。紙をこすり合わせるような、たくさんの羽音。";
        if (c.step === c.moth) t += `\n${DIR_JA[c.hive]}の穴から、甘く腐った匂いと、湿った熱が流れてくる。`;
        if (c.step === c.balloon) t += `\n${DIR_JA[c.smell]}の穴の奥から、玉ねぎを炒めたような、おいしそうな匂いがする。` + (lightOn() ? "灯りの輪の端に、赤い風船がひとつ浮いている。" : "");
        if (c.guide >= 2) t += `\n青緑の小さな光が、${DIR_JA[c.route[c.step]]}の穴の前で、ゆっくり揺れている。`;
        return t;
      } },
    l8z: { name: "薄い床", exits: { d: "l9a" },
      desc: "標識は、ここで終わっている。行き止まりの、丸い洞窟。天井から、石の風鈴が下がっている。\n足もとの床だけ、岩ではない。太鼓の皮のように薄く、踏むたびに、下から風の音がする。" },
    l9a: { name: "交差点", exits: { w: "l9a", e: "l9a", n: "l9a", s: "l9a" },
      desc: () => "真夜中の住宅街の交差点。濡れたアスファルトに、枯れ葉。白線はない。枯れ木。両側に、窓の暗い家。" +
        (S.l9.side ? `${DIR_JA[S.l9.side]}の家の玄関先に、誰か立っている。` : "") +
        (lamp9() ? "\n街灯が一本だけ、今、点いている。" : "\n街灯は消えている。") +
        (S.l9.fog === 1 ? "\n道の端から、白い霧が這い寄ってくる。" : S.l9.fog === 2 ? "\n霧が、もう足首まで来ている。" : "") +
        "\n西と東に家。道は、北と南へ、どこまでも続いている。" },
    l9h: { name: "家の中", exits: { n: "l9y", s: "l9a" },
      desc: "家具のそろった居間。ソファ、テレビ、食卓。台所に冷蔵庫。スイッチを押しても、明かりはつかない。窓からの青い夜の光だけ。\n北に、裏庭へ出る勝手口。南の玄関から通りへ。" },
    l9y: { name: "裏庭", exits: { n: "l9y", e: "l9y", w: "l9y", s: "l9h" },
      desc: "芝生の裏庭。物干し竿、ブランコ。石の小道が、生け垣の門を抜けて、まっすぐ北の草原へ続いている。小道の両側は、膝までの草。\n南の勝手口から家の中へ。" },
    l10a: { name: "麦畑", exits: { n: "l10a", e: "l10b", w: "l10a", s: "l10a" },
      desc: () => "曇り空の下の、果てのない麦畑。生け垣と並木が、畑をいくつもの区画に分けている。低いところに、澄んだ湖。東の生け垣の向こうに、赤い納屋。" +
        "\n空は鉛色で、明るさが少しも変わらない。風が、麦を渡っていく。" },
    l10b: { name: "納屋", exits: { w: "l10a", u: "l10c" },
      desc: "がらんとした納屋。材木と、釘の箱。冷えたかまどに、鍋がひとつ。藁の寝床。机の上に、日記。戸口に、新しい木の踏み段。\n梯子が、屋根裏へ上がっている。西の戸口から麦畑へ。" },
    l10c: { name: "屋根裏", exits: { d: "l10b" },
      desc: "干し草の匂いのする屋根裏。小さな窓が一つ。\n梯子で、下へ降りられる。" },
    l10d: { name: "轍の道", exits: () => S.l10.walk >= 2 ? { e: "l10d", w: "l10d", s: "l10a" } : { n: "l10d", s: "l10a" },
      desc: () => S.l10.walk >= 2 ? `轍の道が、東と西に分かれている。${DIR_JA[S.l10.fork]}の轍はくっきりと新しい。もう一方は、草に埋もれかけている。\n南へ戻れば麦畑。` :
        `土の道。二本の轍のあいだに、草の筋。轍は北へ、まっすぐ続いている。${S.l10.walk ? "ずいぶん歩いた。" : ""}\n南へ戻れば麦畑。` },
    l11a: { name: "大通り", exits: { n: "l11a", e: "l11a", w: "l11a", s: "l11b" },
      desc: "誰もいない大通り。高層ビルが両側にそびえ、窓はどれも黒い鏡のようだ。信号機が、律儀に色を変えている。路肩に、車。\n路面に、スプレーの矢印が三本。青、白、赤。歩道の端に、ハウンドが寝そべっている。\n南に、細い路地。" },
    l11b: { name: "路地", exits: { n: "l11a" },
      desc: "ビルのあいだの細い路地。非常階段に、色とりどりの風船が結ばれている。壁に黄色いポスター。奥に、「=)」のシールの扉。甘い匂い。\n北へ戻れば大通り。" },
    l11c: { name: "基地ベータ", exits: { s: "l11a" },
      desc: "元はオフィスビルだった建物。入口に、鷲の印の旗。中は、机と無線機と、壁いっぱいの手描きの地図。机で、M.E.G. の隊員が地図に印をつけている。名簿。隅に、五台の判定機。\n南の出入口から大通りへ。" },
    l11p: { name: "屋内プール", exits: { s: "l11a", d: "l11p" },
      desc: "白いタイル貼りの、閉まった市民プール。ガラス戸は開いている。塩素の匂い。照明が半分だけ点いている。プールには、水が張ってある。\n南の出入口から大通りへ。" },
    l11x: { name: "バリケードの前", exits: { s: "l11a", n: "l11x" },
      desc: "通りが、車と家具のバリケードでふさがれている。足もとに、花と写真。\n南へ戻れば大通り。" },
    l433: { name: "カプセルホテル", exits: { n: "l433", s: "l433", e: "l433", w: "l433" },
      desc: "二段に積まれたカプセルが、蛍光灯の下、どこまでも並んでいる。どのカプセルも、ブラインドが下りている。空調の低い音。番号札は、どれも同じ「433」。\n自動販売機は、全部「売切」。給湯器は、空。" },
    l37a: { name: "プールルーム", exits: { e: "l37b", w: "l37c" },
      desc: "白いタイル。浅いプール。柔らかい光が、どこからともなく満ちていて、影がない。水の音が、いつまでも反響している。\nここに来たことがある気がする。来たことはないはずなのに。\n東に、深いプール。西に、浅いプール。" },
    l37b: { name: "深いプール", exits: { w: "l37a", d: "l37b" },
      desc: "底の見えない、四角いプール。白いタイルの壁が、どこまでも下へ続いている。\n西へ戻れば、プールルーム。" },
    l37c: { name: "浅いプール", exits: () => S.drain ? { e: "l37a", d: "l37c" } : { e: "l37a" },
      desc: () => "くるぶしほどの深さの、広いプール。床がほんのわずかに傾いている。いちばん低いところに、排水口。" + (S.drain ? "格子は外れている。" : "") + "\n東へ戻れば、プールルーム。" },
    lfun: { name: "パーティー会場", exits: {},
      desc: "風船、紙吹雪、大きなケーキ。楽しそうな音楽が、大きすぎる音で鳴っている。黄色い人たちが、こちらを見ている。\n入ってきた扉は、もうない。部屋の隅に、赤い「!」の扉。" },
    lrun: { name: "赤い廊下", exits: () => runExits(),
      desc: () => "赤い非常灯が回る、長い廊下。警報。後ろから、何かの足音が近づいてくる。\n" + runCue() },
  };
  const exitsOf = loc => text(ROOMS[loc].exits);

  // ---- 状態 ----
  let S = null;
  let LOOP = loadLoop();
  function shuffleDirs(n, from) { const out = []; for (let i = 0; i < n; i++) out.push(pick(from)); return out; }
  function newState() {
    initWorld();
    S = { loc: "l0", moves: 0, done: false, seen: {}, san: 10, bat: 40, light: false, falls: 0, broken: false, hints: {},
      pages: {}, hist: [], said: {},
      l0: { i: rnd(YELLOW.length), steps: 0, seam: false, foot: pick(["n", "s", "e", "w"]), ac: pick(["n", "s", "e", "w"]), idle: 0,
        kind: "", red: "n", redN: 0, spike: false, manilaSeen: false, holeWarn: 0, archRest: false, manilaRest: 0 },
      l1v: 0, radio: 0, blk: 0, blkArmed: false, blkDone: false,
      l1: { crateT: 0, checked: false, cut: false, clothDown: false, clothBonus: false, crateGone: false },
      l2: { gave: false, planks: false, void: 0, camp: 0 },
      l3: { t: 0, amb: 0, bars: false },
      l4: { win: 0 }, vend: false,
      l5: { note: false, lift: 0 },
      q6: 0, qWait: 0, mim: 0,
      l7: { rope: false, air: 9, tiny: 0, tinyAt: pick(["l7c", "l7d"]), tinyDone: false, thing: 0, thingDone: false },
      pipes: shuffleDirs(4, ["n", "e", "w"]), j: 0, hound: 0, heat: 0,
      ss: 0, ssWait: 0, ssLine: 0, sw: { 1: false, 2: false, 3: false, 4: false }, power: false, burnt: false, smile: null, keyIn: false,
      bulletin: false, invited: false, facePointed: false,
      song: 0, boilerOpen: false, watched: 0,
      l6: 0, l6d: shuffleDirs(3, ["n", "e", "w"]),
      calm: 0, drain: false,
      funWait: 0,
      run: 0, runDirs: shuffleDirs(5, ["n", "e", "w"]),
      // ここから下は、ゲームごとに変わる配置
      gear: pick([2, 5, 7]), swOk: pick([[1, 3], [2, 4], [1, 4], [2, 3], [3, 4]]), cooler: 2, darkStep: 0,
      cold: 0, coat: false, lake: 0, h433: 0, ver: {}, visited: { "0": true },
      c8: null, l9: null, l10: null, l11: null };
    newRed();
    const others = shuffle([2, 5, 7].filter(k => k !== S.gear));
    S.hairLk = others[0]; S.emptyLk = others[1];
    O.flashlight.loc = O.book.loc = "lk" + S.gear;
    O.hair.loc = "lk" + S.hairLk;
    // レベル8：9番道路の正しい穴、蛾の部屋、風船の部屋
    const route = shuffleDirs(4, ["n", "e", "w"]);
    const moth = 1 + rnd(3);
    const balloon = pick([0, 1, 2, 3].filter(k => k !== moth));
    S.c8 = { route, step: 0, moth, balloon, num: 30 + rnd(50), mothOn: 0, mothFresh: false, guide: 0, creak: 0,
      hive: pick(["n", "e", "w"].filter(d => d !== route[moth])), smell: pick(["n", "e", "w"].filter(d => d !== route[balloon])) };
    // レベル9：手招きする男の家、その血の色、霧、街灯
    S.l9 = { side: pick(["w", "e"]), clear: Math.random() < 0.5, fog: 0, st: 0, tick: 0, gave: false, tv: false };
    // レベル10：轍の道の方角と、分かれ道の新しいほう
    S.l10 = { road: pick(["n", "w", "s"]), fork: pick(["e", "w"]), walk: 0, t: 0, ate: 0, slept: 0, lake: 0 };
    // レベル11：三色の矢印の向き、プールへ行く色
    const ds = shuffle(["n", "e", "w"]);
    S.l11 = { dirs: { blue: ds[0], white: ds[1], red: ds[2] }, pool: pick(["white", "red"]), map: false, glass: false, met: false, wire: 0, wireFresh: false, wireDone: false };
  }
  // 赤い部屋のある方角は、足音とも空調とも違う方角にする
  function newRed() { S.l0.red = pick(["n", "s", "e", "w"].filter(d => d !== S.l0.foot && d !== S.l0.ac)); S.l0.redN = 0; }
  const lamp9 = () => S.loc === "l9a" && S.l9.tick % 3 === 2;
  const SAVED_FIELDS = ["loc", "closed"];
  function snapshot() {
    const objs = {};
    for (const o of Object.values(O)) {
      objs[o.id] = {};
      for (const k of SAVED_FIELDS) if (k in o) objs[o.id][k] = o[k];
    }
    return { v: VERSION, S, objs, log: rows.slice(-300) };
  }
  function restore(data) {
    if (!data || data.v !== VERSION || !data.S || typeof data.S !== "object") return false;
    const d = data.S;
    if (!ROOMS[d.loc] || !d.c8 || !d.l9 || !d.l10 || !d.l11 || !d.l0 || !d.l1 || !d.l2 || !d.l3 || !d.l4 || !d.l5 || !d.l7 || !Array.isArray(d.hist) || typeof d.san !== "number") return false;
    initWorld();
    S = data.S;
    for (const [id, st] of Object.entries(data.objs || {})) if (O[id]) Object.assign(O[id], st);
    return true;
  }

  // ---- 文章の行 ----
  let rows = [];
  let turnStart = 0;
  let flashed = false;
  function push(r) { rows.push(r); }
  // 正気が削れてくると、字がところどころ欠ける
  function corrupt(t) {
    const cold = S && LV() === "8" && !S.coat && S.cold >= 10;
    if (!S || (S.san > 3 && !cold) || t.length < 6 || Math.random() > (S.san <= 2 ? 0.4 : 0.25)) return t;
    const i = 2 + rnd(t.length - 3);
    return t.slice(0, i) + pick(["■", "黄", "=)"]) + t.slice(i + 1);
  }
  function say(t, cls) { for (const part of String(t).split("\n")) push({ t: "out", ja: cls === "title" || cls === "win" || cls === "doc" ? part : corrupt(part), cls: cls || "" }); }
  function gap() { push({ t: "gap" }); }
  // 蛍光灯のちらつき（画面の側で fx.js の flicker）と、効果音（fx.js の sfx）のきっかけ
  function flicker(n) { flashed = true; emit("flicker", n || 2); }
  function sfx(name) { emit("sfx", name); }
  // 過去に打った命令の一つが、打っていない命令に書き換わる
  function haunt(t) {
    const idx = [];
    rows.forEach((r, i) => { if (r.t === "cmd" && i < rows.length - 8) idx.push(i); });
    if (!idx.length) return;
    rows[idx[rnd(idx.length)]] = { t: "cmd", ja: t, en: "", haunted: true };
    if (!S.seen.overwrite) { S.seen.overwrite = true; say("（注記：要約が、記憶を上書きした形跡がある。打った覚えのない命令が、記録に残っている）", "note"); }
  }
  function note(k) {
    if (!S.ver) S.ver = {};
    if (S.pages[k]) return;
    S.pages[k] = true;
    S.lastPage = k;
    if (held("book")) say("（生存手引きに、ページが一枚増えた）", "note");
  }
  // 自分の目で確かめたページ。うわさ（読んだだけ）と、確かめたことを分けておく
  function verify(k) { if (S.pages[k]) S.ver[k] = true; }
  // このレベルで、とくに読むべきページ
  const CORE = { "0": ["0"], "1": ["water"], "2": ["hound", "wretch"], "3": ["skin", "smiler", "hound"], "4": ["faceling", "party", "windows"], "5": ["moth"], "6": ["mimic"], "7": ["tiny", "thing"], "8": ["moth", "balloon"],
    "9": ["skin"], "10": [], "11": ["hound", "wire", "balloon", "party"], "Fun": ["party"], "37": [] };
  function audit() {
    const have = PAGE_ORDER.filter(k => S.pages[k]);
    const ok = have.filter(k => S.ver[k]).length;
    const missed = Object.keys(S.visited).filter(l => PAGES[l] && !S.pages[l] && l !== LV()).length;
    return { have, ok, rate: have.length ? (ok / have.length * 100).toFixed(1) : "0.0", missed };
  }
  function bookText() {
    const lv = LV();
    const a = audit(), have = a.have;
    const short = k => pageTitle(k).replace(/^(実体|物品)/, "").replace(/「(.+)」.*/, "$1").replace(/^レベル/, "Lv");
    const core = have.filter(k => k === lv || (CORE[lv] || []).includes(k));
    const rel = have.filter(k => !core.includes(k) && S.ver[k]);
    const off = have.filter(k => !core.includes(k) && !S.ver[k]);
    let t = "M.E.G. 生存手引き\n" + (have.length ? `照合：綴じたページ ${have.length}枚／自分で確かめたもの ${a.ok}枚（一致率 ${a.rate}%）／取りこぼし ${a.missed}件` : "綴じてあるページ：まだない");
    if (have.length) t += `\n［core］${core.map(short).join("、") || "なし"}\n［related］${rel.map(short).join("、") || "なし"}\n［off］${off.map(short).join("、") || "なし"}`;
    t += "\n\n" + (S.pages[lv] ? PAGES[lv] : "（このレベルのページは、まだない）");
    if (S.lastPage && S.lastPage !== lv && S.pages[S.lastPage]) t += "\n\n" + PAGES[S.lastPage];
    return t;
  }
  function loopScrawl() {
    if (!LOOP.n) return "";
    const by = { exit: "……出られたはずなのに。", sublime: "37に長居するな。", party: "風船に近づくな。", wretch: "水を飲め。何よりも先に。",
      harvest: "麦を、二度食べるな。", beta: "残るな。地図は、ほかの誰かが描く。" }[LOOP.last] || "前にも、ここに来た。";
    return `\n余白に、自分の字で書き足しがある。「${by}」`;
  }
  const songOn = () => S.song % 5 < 3;
  function runCue() {
    if (S.run >= 5) return "目の前に、緑色の「非常口」。";
    const d = S.runDirs[S.run];
    return d === "n" ? "廊下は、まっすぐ北へ続いている。" : `すぐ先で、廊下が${DIR_JA[d]}へ折れている。`;
  }
  function runExits() { const e = {}; if (S.run < 5) e[S.runDirs[S.run]] = "lrun"; return e; }
  const WATER7 = ["l7c", "l7d", "l7e"];
  // 部屋ごとの環境音（画面の側が fx.js の bed に渡す）
  function roomBed() {
    const l = S.loc, lv = LV();
    if (S.done) return { exit: "city", sublime: "pool", party: "party", wretch: "fluoro", harvest: "field", beta: "city" }[S.endId] || "silence";
    if (l === "l0") return S.l0.kind === "manila" ? "hotel" : S.l0.redN >= 2 ? "dark" : "fluoro";
    if (lv === "1") return S.blk > 0 ? "dark" : l === "l1b" ? "office" : "warehouse";
    if (l === "l2v") return "silence";
    if (l === "l2c") return "warehouse";
    if (l === "l3s") return "silence";
    if (l === "l3b" && S.burnt) return "dark";
    if (l === "l5d") return "pipes";
    if (l === "l5e" || l === "l5h") return "office";
    if (l === "l7a" || l === "l7b") return "sea";
    if (l === "l7c" || l === "l7d") return "pool";
    if (l === "l7e") return "dark";
    if (l === "l9h" || l === "l9y") return "night";
    if (l === "l10b" || l === "l10c") return "warehouse";
    if (l === "l11c") return "office";
    if (l === "l11p") return "pool";
    if (l === "l11b") return "party";
    return { "0": "fluoro", "1": "warehouse", "2": "pipes", "3": "electric", "4": "office", "5": "hotel", "6": "dark", "7": "sea",
      "8": "cave", "9": "night", "10": "field", "11": "city", "37": "pool", "Fun": "party", "!": "electric", "433 N": "office" }[lv] || "fluoro";
  }
  function danger() {
    return !!(S.smile || S.hound === 1 || S.blk > 0 || S.loc === "lrun" || S.l0.redN >= 2 || S.l0.spike || S.l3.amb === 1 || S.mim === 1 || S.q6 === 1 ||
      S.l7.tiny > 0 || S.l7.thing > 0 || S.loc === "l2v" || (WATER7.includes(S.loc) && S.l7.air <= 3) ||
      (S.loc === "l8r" && S.c8.mothOn > 0) || (S.loc === "l9a" && S.l9.fog > 0) || (S.loc === "l11a" && S.l11.wire > 0));
  }
  function status() {
    const lv = LV();
    const info = LEVEL_INFO[lv];
    const glitch = S.san <= 2 && !S.done && Math.random() < 0.5;
    const ex = isDark() && S.loc !== "l6" ? {} : exitsOf(S.loc);
    return { room: isDark() ? "暗闇" : ROOMS[S.loc].name,
      level: "Level " + (glitch ? pick(["?", "0", "−1", "∞"]) : lv), cls: info[1], levelName: info[0],
      san: S.san, low: S.san <= 3, bat: held("flashlight") ? S.bat : null, light: lightOn(),
      air: WATER7.includes(S.loc) ? S.l7.air : null,
      exits: Object.keys(ex).filter(k => ex[k]), done: S.done, lv, loc: S.loc, bed: roomBed(),
      red: S.loc === "l0" ? S.l0.redN : 0, deep: S.loc === "l7c" ? 1 : S.loc === "l7d" ? 2 : S.loc === "l7e" ? 3 : 0,
      danger: danger(),
      cold: LV() === "8" && !S.coat ? Math.min(1, S.cold / 15) : 0 };
  }

  // ---- 世界のしくみ ----
  const lightOn = () => S.light && held("flashlight") && S.bat > 0 && LV() !== "6";
  function baseDark(loc) {
    if (loc === "l1c" || loc === "l2a" || loc === "l2j" || loc === "l2e" || loc === "l6" || loc === "l7e") return true;
    if (loc === "l3b" && S.smile) return true;
    if (LEVEL_OF[loc] === "1" && S.blk > 0) return true;
    return false;
  }
  const isDark = () => baseDark(S.loc) && !lightOn();
  function visible() {
    const out = [];
    const dark = isDark();
    const walk = parent => {
      for (const o of Object.values(O)) {
        if (o.loc !== parent) continue;
        if (dark && parent === S.loc && !o.feel) continue;
        out.push(o);
        if (o.container && !o.closed) walk(o.id);
      }
    };
    walk(S.loc);
    walk("player");
    return out;
  }
  function describe(full) {
    const r = ROOMS[S.loc];
    if (isDark() && S.loc !== "l6" && S.loc !== "l7e") {
      say("暗闇", "title");
      if (LV() === "2") say("真っ暗だ。熱い管の匂い。手を伸ばすと、管に触れる。" + (S.loc === "l2j" ? "三本に分かれている。" : S.loc === "l2e" ? "扉が二つある。片方には板が打ちつけてあり、片方には、ひどく冷たいガラスの小窓。" : ""));
      else if (LV() === "1" && S.blk > 0) say("照明が、すべて消えている。東の扉の上で、緑の非常灯だけが、かすかに光っている。");
      else if (S.loc === "l3b") say("割れた電球のかけらが、靴の下で鳴る。暗闇の真ん中に、白く光る目と、歯の列が浮かんでいる。");
      else say("真っ暗で、何も見えない。奥から、配管を叩くような音。");
      return;
    }
    say(r.name, "title");
    if (S.loc === "l8r") syncCave();
    if (full || !S.seen[S.loc] || ["l0", "l2j", "lrun", "l6", "l7b", "l7e", "l8r", "l9a", "l10a", "l10d"].includes(S.loc)) say(text(r.desc));
    if (S.loc === "l0" && S.l0.redN) say(S.l0.redN === 1 ? "カーペットが、靴の裏に粘りつく。毛足が、急に粗くなった。" : "壁紙がところどころめくれて、下から、赤い色がのぞいている。息が、少し苦しい。この先へは、行かないほうがいい。", "warn");
    S.seen[S.loc] = true;
    const loose = Object.values(O).filter(o => o.loc === S.loc && !o.scenery);
    for (const o of loose) say(`ここに${o.name}がある。`);
    for (const c of Object.values(O).filter(o => o.loc === S.loc && o.container && !o.closed)) {
      const inside = Object.values(O).filter(o => o.loc === c.id);
      if (inside.length) say(`${c.name}の中に、${inside.map(o => o.name).join("、")}。`);
    }
  }
  // 洞窟の一つの部屋に、そのとき居るもの（風船・蛾）を置く
  function syncCave() {
    const c = S.c8;
    O.balloon8.loc = c.step === c.balloon ? "l8r" : null;
    O.moths.loc = c.step === c.moth && c.mothOn > 0 ? "l8r" : null;
  }
  // 初めて着いたときの格言（英語・日本語・出典）
  const TRU = {
    "1": ["THE CEILING YOU FELL THROUGH IS NOT THERE", "落ちてきた天井は、どこにもない", "Level 1"],
    "2": ["A COLD PIPE HAS STOPPED PRETENDING", "冷たい管は、ふりをやめた管だ", "Level 2"],
    "3": ["A FAMILIAR VOICE IS NOT A FAMILIAR PERSON", "聞き覚えのある声は、知っている人ではない", "Level 3"],
    "4": ["A WINDOW CAN WANT SOMETHING", "窓にも、欲しいものがある", "Level 4"],
    "5": ["SOMEONE IS ALWAYS WATCHING THE HALLWAY", "廊下は、いつも誰かに見られている", "Level 5"],
    "6": ["IN TOTAL DARK, DO NOT ANSWER", "完全な闇では、答えるな", "Level 6"],
    "7": ["DOWN IS A DIRECTION YOU CHOOSE", "下は、自分で選ぶ方角だ", "Level 7"],
    "8": ["FOLLOW THE MARKERS. THEY WILL NOT FOLLOW YOU", "標識に従え。標識はあなたに従わない", "M.E.G. 9番道路"],
    "9": ["NOT EVERYONE WHO WAVES IS WAITING FOR YOU", "手招きする者が、あなたを待っているとは限らない", "郊外"],
    "10": ["NOTHING HERE ROTS. ASK WHY", "ここでは何も腐らない。理由を問え", "豊作"],
    "11": ["EVERY DOOR IS A ONE WAY DOOR", "どの扉も、片道の扉だ", "眠らない街"],
    "37": ["COMFORT IS A KIND OF FORGETTING", "安らぎは、忘れることの一種だ", "崇高"],
    "Fun": ["IF THEY ASK YOU TO STAY, DO NOT SAY YES", "留まれと言われても、はいと言うな", "=)"],
    "!": ["RUN", "走れ", "!"],
    "433 N": ["REST IS NOT THE SAME AS STAYING", "休むことは、留まることと同じではない", "433"],
  };
  // 階が変わったときの出来事
  function arrive(lv, from) {
    if (lv === from) return;
    const info = LEVEL_INFO[lv];
    say(`―― Level ${lv}「${info[0]}」`, "note");
    if (DEPTH[lv] > LOOP.deep) { LOOP.deep = DEPTH[lv]; saveLoop(LOOP); }
    // 新しい階に着いたときだけ、足音（毎回の移動では鳴らさない）
    if (!S.visited[lv] && !["7", "8", "9", "37", "!"].includes(lv)) sfx("step");
    S.visited[lv] = true;
    if (from) verify(from);
    if (!S.seen["tru" + lv] && TRU[lv]) { S.seen["tru" + lv] = true; emit("truism", TRU[lv]); }
    if (lv === "8" && !S.seen.arr8) { S.seen.arr8 = true; S.cold = 0; }
    if (lv === "9") { S.l9.fog = 0; S.l9.st = 0; }
    if (lv === "11" && !S.seen.arr11) { S.seen.arr11 = true; say("どこかで、ずっと信号機が鳴っている。人の気配はない。それなのに、見られている気がする。", "note"); }
    if (lv === "1" && !S.seen.arr1) { S.seen.arr1 = true; say("落ちてきたはずの天井を見上げる。コンクリートの天井には、穴も継ぎ目もない。", "note"); }
    if (lv === "2" && !S.seen.arr2) { S.seen.arr2 = true; say("壁の照明が、一本切れると、その先の何本かがまとめて消えた。直列につながっているのだ。", "note"); flicker(2); }
    if (lv === "3" && !S.seen.arr3) { S.seen.arr3 = true; S.ss = 1; S.l3.t = 0; haunt("開けて"); sfx("knock"); }
    if (lv === "5" && !S.seen.arr5) { S.seen.arr5 = true; sfx("bell"); }
    if (lv === "6" && !S.seen.arr6) { S.seen.arr6 = true; if (S.light) say("懐中電灯のスイッチは入ったままなのに、光が出ていない。", "warn"); }
    if (lv === "7" && !S.seen.arr7) { S.seen.arr7 = true; say("階段を降りきると、潮の匂い。足もとの重さが、少しだけ斜めにかかっている。", "note"); }
    if (lv === "Fun" && !S.seen.arrF) {
      S.seen.arrF = true;
      say("背中で、扉が閉まる音。振り向くと、扉はもうなかった。", "warn");
      say("「ねえ、パーティーしようよ =)」", "voice");
    }
    if (lv === "!" && !S.seen.arrR) { S.seen.arrR = true; haunt("走れ"); flicker(4); emit("shock2"); sfx("stinger"); }
    if (lv === "37" && !S.seen.arr37) { S.seen.arr37 = true; note("37"); sfx("drip"); }
  }
  function enter(to) {
    const from = LV();
    S.loc = to;
    describe(false);
    arrive(LV(), from);
    onEnter(to);
  }
  // 部屋に入ったときの前ぶれ
  function onEnter(to) {
    if (to === "l7c" || to === "l7d") {
      if (S.l7.tinyAt === to && !S.l7.tinyDone && !S.l7.tiny) {
        S.l7.tiny = 2; O.tiny7.loc = to; S.l7.fresh = true;
        gap();
        say("下のほうの水が、ゆっくり押しのけられてくる。……とてつもなく大きな影が、真下を横切りはじめた。部屋より、船より、ずっと大きい。", "warn");
        sfx("stinger"); emit("omen");
      }
    }
    if (to === "l7e" && !S.l7.thingDone && !S.l7.thing) {
      S.l7.thing = 1; O.thing7.loc = "l7e"; S.l7.fresh = true;
      gap();
      if (lightOn()) { thingFlee(); return; }
      say("下の暗闇で、何か、とてつもなく大きなものが、こちらへ向きを変えた。水が、ゆっくりと押してくる。", "warn");
      sfx("hum"); emit("omen");
    }
    if (to === "l2c" && !S.l2.gave && !S.seen.camp) { S.seen.camp = true; sfx("whisper"); }
    if (to === "l3s" && !S.seen.sanct) { S.seen.sanct = true; sfx("chime"); }
  }
  // 正気が尽きると倒れる。三度目で、ウレッチになる
  function addSan(n, why) {
    if (S.done) return;
    if (why) say(why, n < 0 ? "warn" : "note");
    S.san = Math.max(0, Math.min(10, S.san + n));
    if (S.san === 0) fall();
  }
  function fall() {
    S.falls++;
    emit("fall");
    sfx("heart");
    gap();
    if (S.falls >= 3) { endWretch(); return; }
    say("目の前が、黄色く塗りつぶされていく……", "warn");
    haunt(pick(["ここはどこ", "水", "黄色", "=)"]));
    S.san = 4;
    respawn(LEVEL_START[LV()], `……気がつくと、${ROOMS[LEVEL_START[LV()]].name}の床に倒れていた。喉が、からからに乾いている。`);
    note("wretch");
    if (S.falls === 2) say("腕に、かゆい発疹が出ている。苛立ちが、どこからともなく湧いてくる。", "warn");
  }
  // 実体に襲われる。そのレベルの入口で目を覚ます
  function hurt(n, msg) {
    emit("hurt");
    sfx("thud");
    say(msg, "warn");
    S.san = Math.max(0, S.san - n);
    if (S.san === 0) { fall(); return; }
    respawn(LEVEL_START[LV()], `……気がつくと、${ROOMS[LEVEL_START[LV()]].name}にうずくまっていた。`);
  }
  function respawn(loc, msg) {
    S.broken = true;
    S.smile = null; S.blk = 0;
    const lv = LEVEL_OF[loc];
    if (lv === "0") { S.l0.redN = 0; S.l0.spike = false; S.l0.kind = ""; S.l0.seam = false; O.seam.loc = null; O.holes0.loc = null; hideManila(); newRed(); }
    if (lv === "2") { S.j = 0; S.l2.void = 0; if (S.hound !== 3) { S.hound = 0; O.hound.loc = null; } }
    if (lv === "3") { S.ssWait = 0; S.burnt = false; O.teeth3.loc = null; if (S.l3.amb === 1) { S.l3.amb = 0; S.l3.t = 0; } O.hound3.loc = null; }
    if (lv === "5") S.l5.lift = 0;
    if (lv === "6") { S.l6 = 0; if (S.q6 === 1) S.q6 = 0; if (S.mim === 1) S.mim = 0; O.switch6.loc = O.beggar6.loc = null; S.qWait = 0; }
    if (lv === "7") { S.l7.tiny = 0; S.l7.thing = 0; S.l7.air = 9; O.tiny7.loc = O.thing7.loc = null; }
    if (lv === "!") S.run = 0;
    if (lv === "8") { S.c8.step = 0; S.c8.mothOn = 0; S.c8.guide = 0; S.c8.creak = 0; }
    if (lv === "9") { S.l9.fog = 0; S.l9.st = 0; }
    if (lv === "10") S.l10.walk = 0;
    gap();
    say(msg);
    S.loc = loc;
    describe(true);
  }

  // ---- 動き ----
  function go(dir) {
    if (S.smile && S.loc === "l3b") {
      if (S.smile.eye && dir === "w") {
        S.smile = null; O.teeth3.loc = null; verify("smiler");
        say("目を逸らさないまま、ゆっくり、ゆっくり後ずさる。歯の列は笑ったまま、ついてこなかった。");
        enter("l3a"); return;
      }
      hurt(4, "動いた瞬間、歯の列が、目の前いっぱいに広がった。"); note("smiler"); return;
    }
    if (S.loc === "l6") { move6(dir); return; }
    if (S.loc === "lfun") { say("出口は、あの「!」の扉しかない。黄色い人たちが、道をふさぐように立っている。"); return; }
    if (S.loc === "l0") { move0(dir); return; }
    if (S.loc === "l2j") { move2(dir); return; }
    if (S.loc === "l2v") {
      if (dir === "s") { S.l2.void = 0; say("光の四角から目を離さずに、後ろ向きに戻る。戸口をくぐった瞬間、音が帰ってきた。"); enter("l2e"); return; }
      lostVoid(`${DIR_JA[dir] || "そちら"}へ、一歩。`); return;
    }
    if (S.loc === "l5e") { say("ボタンを押さないと、どこへも行けない。"); return; }
    if (S.loc === "l5h") { say("リネン室を出て、エレベーターへ戻る。"); enter("l5e"); return; }
    if (S.loc === "l433") {
      if (dir === "u" || dir === "d") { say("上段のカプセルによじ登っても、天井があるだけだ。"); return; }
      say(`${DIR_JA[dir]}へ歩く。カプセル、カプセル、カプセル。……どこまで行っても、同じ通路だ。`);
      describe(true);
      return;
    }
    if (LV() === "7") { move7(dir); return; }
    if (S.loc === "l11c" && dir === "s" && S.l11.map && !S.l11.wireDone && S.l11.wire === 0) {
      say("基地を出て、大通りへ戻る。");
      enter("l11a");
      S.l11.wire = 2; S.l11.wireFresh = true;
      gap();
      say("信号機の柱に、新しい引っかき傷。「うごくな」「しずかに」。", "warn");
      say("頭の上の電線の束が、たわんだ。灰色の、細い人の形が、ぶら下がるように降りてくる。顔に、目がない。", "warn");
      note("wire");
      sfx("scratch"); flicker(2);
      emit("omen");
      return;
    }
    if (S.loc === "l8a" && dir === "n") { S.c8.step = 0; S.c8.guide = 0; S.c8.mothOn = 0; say("看板の矢印のほうへ、北の洞窟に入る。"); enter("l8r"); return; }
    if (S.loc === "l8r") { move8(dir); return; }
    if (S.loc === "l8z" && dir === "d") { fall9("床に、体重をかけた。"); return; }
    if (LV() === "9") { if (move9(dir)) return; }
    if (LV() === "10") { if (move10(dir)) return; }
    if (LV() === "11") { if (move11(dir)) return; }
    if (S.loc === "l1c" && dir === "d" && !lightOn()) {
      // 灯りがなくても、二度目は手すりを頼りに降りられる。ただし、ただでは済まない
      if (S.darkStep < 1) { S.darkStep++; say("暗すぎて、階段の一段目が分からない。踏み外したら終わりだ。灯りがあれば……。", "warn"); return; }
      S.darkStep = 0;
      say("手すりだけを頼りに、暗闇の階段を降りる。……途中で、足が空を踏んだ。何段も、滑り落ちる。");
      sfx("thud");
      gap(); note("1"); addSan(-2, ""); if (S.broken || S.done) return;
      enter("l2a"); return;
    }
    if (S.loc === "l1c" && dir === "n") { say("通路は、すぐ先で配管に埋まっている。階段は、下にしかない。"); return; }
    if (S.loc === "l1a" && (dir === "s" || dir === "w")) {
      S.l1v = (S.l1v + 1 + rnd(2)) % 3;
      say("広間を歩く。ずいぶん歩いたはずなのに、振り返ると、さっきの柱がすぐそこにある。");
      describe(true);
      return;
    }
    if (S.loc === "l1a" && (dir === "n" || dir === "e")) leaveCrate();
    if (S.loc === "l2e" && dir === "d") {
      if (!S.l2.planks) { say("「3」の扉には、板が打ちつけてある。外さないと通れない。"); return; }
      say("板を外した鉄の扉を押し開け、階段を降りる。熱気が引いて、代わりに、低い唸りが体に響いてくる。"); sfx("door"); gap(); enter("l3a"); return;
    }
    if (S.loc === "l3c" && dir === "d") { liftDown(); return; }
    if (S.loc === "l5b" && dir === "w" && !S.boilerOpen) { say("ボイラー室の扉には、鍵がかかっている。"); return; }
    if (S.loc === "l5d" && dir === "d") { say("ボイラーの裏の梯子を降りる。熱が、一段ごとに遠のく。光も、音も、一段ごとに遠のく。"); gap(); note("5"); enter("l6"); return; }
    if (S.loc === "l37b" && dir === "d") {
      say("深いプールに潜る。温かい水。白いタイルの壁が、下へ、下へと続く。潜っても、潜っても、底がない。");
      say("……息が切れる直前、気がつくと、プールルームのタイルの上に座っていた。髪が濡れている。");
      gap();
      S.loc = "l37a";
      sfx("splash");
      addSan(-1, "");
      describe(true);
      return;
    }
    if (S.loc === "l37c" && dir === "d") { if (S.drain) { endExit(); return; } say("ここに、降りる場所はない。"); return; }
    if (S.loc === "l37a" && dir === "u") { say("上を見る。白い天井の、どこにも継ぎ目がない。……ここへ来た道は、どこにもない。"); return; }
    const to = exitsOf(S.loc)[dir];
    if (!to) { say(`${DIR_JA[dir] || "そちら"}へは行けない。`); return; }
    if (S.loc === "l1c" && dir === "d") { say("懐中電灯の輪を頼りに、鉄の階段を降りる。一段ごとに、空気が熱く、重くなる。配管の数が、また増えた。"); gap(); note("1"); }
    if (S.loc === "l2a" && dir === "u") say("階段を上り、配管の通路へ戻る。");
    if (S.loc === "l3a" && dir === "w" && S.l3.amb === 1) { ambushSafe("聖所へ駆けこむ。"); }
    enter(to);
  }
  // 補給の木箱は、目を離すと消える
  function leaveCrate() {
    if (O.crate.loc !== "l1a" || O.crate.closed) return;
    const left = Object.values(O).filter(o => o.loc === "crate" && o.id !== "glass1");
    O.crate.loc = null; S.l1.crateGone = true;
    for (const o of Object.values(O)) if (o.loc === "crate") o.loc = "gone";
    if (left.length) say("背中で、木の箱がきしむ音がした。振り向かなかった。", "note");
  }
  function hideManila() { O.table0.loc = O.cupboard0.loc = null; }
  function move0(dir) {
    if (dir === "u") { say("天井は、手の届かない高さにある。"); return; }
    if (dir === "d") {
      if (S.l0.kind !== "hole") { say("床は、ただの湿ったカーペットだ。"); return; }
      if (S.l0.holeWarn < 1) { S.l0.holeWarn++; say("穴の縁で、足が止まる。底のない黒が、足もとから吸いこもうとしている。……降りたら、戻れない気がする。", "warn"); sfx("breath"); return; }
      S.l0.holeWarn = 0;
      say("穴の縁から、黒の中へ、足を下ろした。");
      hurt(3, "落ちる。落ちる。どこまでも落ちる。風の音もしない。……途中で、自分が落ちているのか、浮かんでいるのか、分からなくなった。");
      return;
    }
    S.l0.steps++;
    S.l0.idle = 0;
    S.l0.spike = false;
    S.l0.holeWarn = 0;
    const wasKind = S.l0.kind;
    // 赤い部屋：二度の前ぶれのあと、三度目で入ってしまう
    if (dir === S.l0.red) {
      S.l0.redN++;
      if (S.l0.redN >= 3) { redRoom(); return; }
    } else if (S.l0.redN) { S.l0.redN = 0; newRed(); }
    // 空調の音のほうへ進みつづけると、別の場所に迷いこむことがある
    if (dir === S.l0.ac && dir !== S.l0.foot && S.l0.steps >= 3 && Math.random() < 0.5) {
      S.h433 = 0;
      say("空調の音のほうへ歩く。黄色い壁紙が、いつのまにか、白い化粧板に変わっていた。");
      gap();
      hideManila(); S.l0.kind = "";
      enter("l433");
      return;
    }
    const toward = dir === S.l0.foot;
    S.l0.i = (S.l0.i + 1 + rnd(YELLOW.length - 1)) % YELLOW.length;
    hideManila();
    // 部屋の種類（アーチ・柱・穴・マニラの部屋）
    const r = Math.random();
    S.l0.kind = S.l0.redN ? "" : (!S.l0.manilaSeen && S.l0.steps >= 3 && r < 0.2) ? "manila" : r < 0.32 ? "arch" : r < 0.42 ? "pillar" : r < 0.54 ? "hole" : "";
    if (S.l0.kind === "manila") { S.l0.manilaSeen = true; O.table0.loc = O.cupboard0.loc = "l0"; }
    O.holes0.loc = S.l0.kind === "hole" ? "l0" : null;
    const wasSeam = S.l0.seam;
    S.l0.seam = S.l0.kind !== "manila" && ((S.l0.steps >= 4 && Math.random() < 0.35) || S.l0.steps >= 8);
    if (S.l0.seam) S.l0.steps = 0;
    O.seam.loc = S.l0.seam ? "l0" : null;
    if (S.l0.steps === 2 && O.page0.loc === null && !held("page0")) O.page0.loc = "l0";
    else if (O.page0.loc === "l0") O.page0.loc = "gone";
    describe(true);
    if (S.l0.seam && !wasSeam) flicker(3);
    if (S.l0.redN === 2) sfx("heart");
    if (S.l0.kind === "manila") say("（ここでは、孤立効果が、少しだけ弱まるという）", "note");
    if (toward) {
      sfx("step");
      addSan(-1, "足音のしていたほうへ来た。……誰もいない。カーペットに、自分と同じ靴の足跡だけが残っている。まだ、温かい。");
      S.l0.foot = pick(["n", "s", "e", "w"].filter(d => d !== dir && d !== S.l0.red));
    } else if (Math.random() < 0.3) S.l0.foot = pick(["n", "s", "e", "w"].filter(d => d !== S.l0.red));
    // うなりが急に大きくなる（耳をふさいで歩きつづける）
    if (!S.broken && S.l0.kind !== "manila" && S.moves > 4 && Math.random() < 0.1) {
      S.l0.spike = true;
      say("蛍光灯のうなりが、急に、耳を裂くほど大きくなった。ここに立ち止まっていてはいけない。", "warn");
      sfx("hum"); flicker(3);
    }
  }
  function redRoom() {
    S.l0.redN = 0;
    say("足を踏み入れた瞬間、色が変わった。壁も、床も、天井も、赤い。カーペットが足首まで粘りつく。振り向くと、入ってきた戸口が、どこにもない。", "warn");
    sfx("stinger"); emit("shock2"); flicker(4);
    hurt(3, "赤い部屋の中を、どれだけ歩いたのか分からない。壁を叩いても、音が返ってこない。……息が、できない。");
  }
  function move2(dir) {
    if (S.hound === 1) { hurt(3, "背を向けた瞬間、それが跳んだ。熱い管に叩きつけられる。"); note("hound"); return; }
    if (S.hound === 2) {
      S.hound = 3;
      say("目を逸らさないまま、ゆっくりと後ずさる。……それは低く唸り、やがて興味を失ったように、管の陰へ戻っていった。");
      O.hound.loc = null;
      note("hound"); verify("hound");
      if (dir === "s") { S.j = 0; enter("l2a"); return; }
    }
    if (dir === "s") { S.j = 0; say("来た道を戻る。"); enter("l2a"); return; }
    if (dir === "u" || dir === "d") { say("管が邪魔で、上にも下にも行けない。"); return; }
    if (dir !== S.pipes[S.j]) {
      S.j = 0;
      say(`${DIR_JA[dir]}の管をたどって進む。45度、また45度。……管は、途中で壁に潜りこんで消えた。気づくと、最初の分岐に戻っていた。`);
      sfx("clang");
      addSan(-1, "");
      if (S.broken || S.done) return;
      describe(true);
      return;
    }
    S.j++;
    say(`冷たい管をたどって、${DIR_JA[dir]}へ進む。ステンシルの数字が、${S.j * 5 + 10}メートル。`);
    if (S.j >= 4) { gap(); say("冷たい管は、行き止まりの壁の、二つの扉のあいだに潜りこんでいた。"); enter("l2e"); note("2"); return; }
    if (S.j === 2 && S.hound === 0) {
      S.hound = 1;
      O.hound.loc = "l2j";
      describe(true);
      gap();
      say(isDark() ? "暗闇の奥で、何かが、こちらを見ている。荒い息。長い髪が床を擦る音。" : "懐中電灯の輪の端に、四つ足の何かがいた。長い黒髪の奥から、こちらを見ている。", "warn");
      sfx("stinger"); sfx("breath");
      return;
    }
    describe(true);
  }
  // 窓の向こうが真っ黒な扉の先
  function lostVoid(why) {
    S.l2.void = 0;
    say(why + "……振り返ると、戸口の光が、なかった。どちらが前で、どちらが後ろだったのか。", "warn");
    hurt(3, "黒の中を、どれだけ手探りしたのか分からない。指先が、ふいに、熱い管に触れた。");
  }
  // レベル3：背後から来るハウンドを、振り向いて見つめ返す
  function ambushSafe(how) {
    S.l3.amb = 2; O.hound3.loc = null;
    note("hound"); verify("hound");
    say(how + (how.includes("聖所") ? "背後で、爪の音が、聖所の戸口の手前でぴたりと止まった。……やがて、遠ざかっていく。" : "暗がりに、長い髪と、低い姿勢の何か。目を逸らさずに、にらみ返す。……それは歯を見せたまま後ずさり、レンガの陰へ消えた。"), "note");
  }
  function move6(dir) {
    if (dir === "u" || dir === "d") { say("手探りでは、上も下も分からない。"); return; }
    if (S.l6 >= 3) { toStairs7(); return; }
    if (dir !== S.l6d[S.l6]) {
      if (S.mim === 1) { S.mim = 2; hurt(3, "手探りの先で、誰かの胸に触れた。「……ここだ」と、自分の声が言った。何本もの手が、腕に、肩に、口に。"); note("mimic"); return; }
      sfx("thud");
      addSan(-1, "手探りで進む。……何かに、ぶつかった。柔らかかった。息をしていた。");
      return;
    }
    S.l6++;
    if (S.q6 === 1) { S.q6 = 2; O.switch6.loc = O.beggar6.loc = null; say("囁き声を背中に残して、離れる。「……どうして」と、声が言った。", "note"); }
    if (S.mim === 1) { S.mim = 2; verify("mimic"); say("音を立てずに、すり足で離れる。背後で、自分の声が、自分の声と話している。", "note"); }
    say(`手探りで、${DIR_JA[dir]}へ進む。波の音が、近くなった。`);
    if (S.l6 === 1 && !S.q6) {
      S.q6 = 1; O.switch6.loc = O.beggar6.loc = "l6";
      gap();
      say("すぐ横で、誰かが囁いた。「ねえ。そこの壁に、スイッチがあるでしょう。入れて。お願い。入れてくれるだけでいい」\nその声は、ずっと同じ調子で、同じことを言っている。", "warn");
      sfx("whisper");
      return;
    }
    if (S.l6 === 2 && !S.mim) {
      S.mim = 1;
      const h = S.hist.filter(x => x && !/わからない/.test(x)).slice(-6);
      const t = h.length ? h[h.length - 1] : "見る";
      gap();
      say(`暗闇の向こうで、誰かが、自分の声で言った。「${t}」\nもう一人が、同じことばを、少し遅れて。さらにもう一人。……音を立ててはいけない。`, "warn");
      sfx("whisper"); sfx("breath"); emit("omen");
      return;
    }
    if (S.l6 >= 3) {
      say("指先に、湿った手すりが触れた。下へ降りる階段。下から、潮の匂いと、薄い光。");
      gap();
      toStairs7();
    }
  }
  function toStairs7() { S.l6 = 3; note("6"); enter("l7a"); }
  // ---- レベル7：横倒しの部屋・ロープ・三つの層
  function move7(dir) {
    const l = S.loc, a = S.l7;
    if (l === "l7a") {
      if (dir === "u") { say("階段を上り、暗闇へ戻る。"); S.l6 = 3; enter("l6"); return; }
      if (dir === "d") {
        if (a.rope) { say("ロープを伝って、戸口から下へ。重さの向きが、くるりと変わる。……足から、冷たい海に入った。"); sfx("splash"); enter("l7b"); return; }
        say("戸口の前に立った瞬間、重さの向きが、くるりと変わった。……4メートル半、落ちる。", "warn");
        sfx("splash"); gap();
        enter("l7b");
        addSan(-1, "冷たい。息が止まる。見上げると、戸口は、手の届かない高さにある。");
        return;
      }
      say("部屋の中を歩く。戸口の前を通るとき、体が、海のほうへ引かれた。慌てて離れる。"); return;
    }
    if (l === "l7b") {
      if (dir === "u") {
        if (!a.rope) { say("戸口は、手の届かない高さにある。ロープがあれば……。"); return; }
        a.air = 9; say("ロープをよじ登り、戸口から部屋へ転がりこむ。重さの向きが、また変わる。部屋の空気を、胸いっぱいに吸う。"); enter("l7a"); return;
      }
      if (dir === "d") { a.air = 9; say("部屋で吸った空気を胸に溜めて、潜る。"); sfx("splash"); enter("l7c"); return; }
      say("泳いでも泳いでも、同じ黒い水と、同じ天井。遠くの島は、少しも近づかない。"); return;
    }
    if (dir === "u") {
      if (l === "l7c") { a.air = 9; say("水面へ浮かび上がる。空気。"); enter("l7b"); return; }
      say("上へ泳ぐ。"); enter(l === "l7d" ? "l7c" : "l7d"); return;
    }
    if (dir === "d") {
      if (l === "l7e") {
        if (!lightOn() && !a.thingDone) { say("暗くて、洞窟がどこにあるのか分からない。"); return; }
        say(lightOn() ? "光の輪に浮かぶ洞窟へ、まっすぐ泳ぎこむ。" : "岩肌を手でたどって、ようやく穴の縁を見つけた。中へ泳ぎこむ。");
        say("狭い水路が、上へ、上へと続く。……水面が、頭の上にある。顔を出すと、冷たい、乾いた空気。");
        gap(); note("7"); flicker(2); emit("flash"); sfx("splash");
        S.cold = 0;
        enter("l8a");
        say("岸へ這い上がる。服が、肌に張りついて冷たい。", "note");
        return;
      }
      say("さらに潜る。" + (l === "l7c" ? "光が、薄くなっていく。" : "光が、なくなった。"));
      enter(l === "l7c" ? "l7d" : "l7e"); return;
    }
    say("横へ泳いでも、どこまでも同じ水だ。");
  }
  function thingFlee() {
    S.l7.thing = 0; S.l7.thingDone = true; O.thing7.loc = null;
    note("thing"); verify("thing");
    say("光の輪の端に、ありえない形の何かが一瞬だけ浮かんだ。目のない顔。山ほどもある顎。……それは身をよじり、光から逃げるように、闇の底へ沈んでいった。", "warn");
    emit("flash"); sfx("stinger");
  }
  // ---- レベル8：9番道路。標識の矢印（灯りが要る）か、暗闇で待つと来る光の玉に従う
  function move8(dir) {
    const c = S.c8;
    if (dir === "u" || dir === "d") { say("天井は低く、足もとは濡れた岩だ。上にも下にも行けない。"); return; }
    if (dir === "s") { c.step = 0; c.mothOn = 0; c.guide = 0; say("来た道を戻る。標識の番号が、ひとつずつ減っていく。"); enter("l8a"); return; }
    if (dir === c.route[c.step]) {
      if (c.step === c.balloon) { note("balloon"); verify("balloon"); }
      c.step++; c.guide = 0; c.mothOn = 0;
      say(`${DIR_JA[dir]}の穴を、這うようにして抜ける。`);
      if (c.step >= 4) { gap(); say("最後の標識の先で、洞窟は行き止まりになっていた。"); note("8"); enter("l8z"); return; }
      if (c.step === c.moth) { c.mothOn = 2; c.mothFresh = true; emit("omen"); }
      if (c.step === c.balloon) emit("omen");
      describe(true);
      return;
    }
    if (c.step === c.moth && dir === c.hive) {
      note("moth");
      hurt(4, `${DIR_JA[dir]}の穴の、ぶよぶよした膜を押し分けた。……中は、巣だった。何百もの翅が、いっせいに開いた。`);
      return;
    }
    if (c.step === c.balloon && dir === c.smell) {
      note("balloon");
      hurt(3, "おいしそうな匂いのほうへ進む。暗がりで、何か軽いものが頬に触れた。……リボンだった。腕が、指先から、しびれて動かなくなる。");
      return;
    }
    const was = c.num + c.step;
    c.step = 0; c.mothOn = 0; c.guide = 0;
    say(`${DIR_JA[dir]}の穴を進む。……標識が見えた。「#${was - 2 - rnd(5)}」。さっき通ったはずの番号だ。顔に似た岩にも、見覚えがある。`);
    addSan(-1, "");
    if (S.broken || S.done) return;
    describe(true);
  }
  function fall9(why) {
    say(why + "……床が、抜けた。");
    say("長く、落ちる。風の音。それから、雨上がりの匂い。");
    gap();
    emit("flash"); sfx("thud");
    note("8");
    S.cold = 0;
    enter("l9a");
    say("濡れたアスファルトの上に、転がっていた。見上げても、空には穴も、洞窟もない。月もない。", "note");
  }
  // ---- レベル9：通り・家・裏庭
  function move9(dir) {
    if (S.loc === "l9a") {
      if (dir === "w" || dir === "e") { enterHouse(dir); return true; }
      if (dir === "n" || dir === "s") {
        say(`${DIR_JA[dir]}へ、通りを歩く。同じような家並みが続く。……気づくと、同じ交差点に立っていた。標識の矢印が、くるりと回った。`);
        describe(true);
        return true;
      }
      say("上にも下にも、行けない。"); return true;
    }
    if (S.loc === "l9h" && dir === "s") { say("玄関から、通りへ出る。"); enter("l9a"); return true; }
    if (S.loc === "l9y") {
      if (dir === "n") {
        say("石の小道をたどって、生け垣の門をくぐる。……門の向こうは、通りだった。振り返ると、門はない。");
        enter("l9a");
        return true;
      }
      if (dir === "e" || dir === "w") {
        say("小道を外れて、草の中へ踏みこむ。一歩ごとに、草が高くなる。家が、遠ざかる。夜が、薄くなっていく。");
        gap();
        note("9");
        enter("l10a");
        say("……気がつくと、曇り空の下にいた。麦の穂が、肩をこする。", "note");
        return true;
      }
    }
    return false;
  }
  function enterHouse(dir) {
    const isMan = dir === S.l9.side;
    if (S.l9.clear && isMan) {
      note("skin");
      hurt(4, `男に招かれるまま、${DIR_JA[dir]}の家に入る。背中で、扉が閉まった。「よく来た。よく来た。よく来た」……肩にかかった手の、皮が、ずるりとずれた。`);
      return;
    }
    if (!S.l9.clear && !isMan) {
      addSan(-2, `${DIR_JA[dir]}の家の扉を開ける。……玄関の中に、もう一つ玄関がある。居間の中に、居間が食いこんでいる。二軒の家が、重なっている。頭が、割れるように痛い。`);
      if (S.broken || S.done) return;
      say("よろめきながら、通りへ戻った。");
      describe(true);
      return;
    }
    sfx("door");
    say(`${DIR_JA[dir]}の家の扉を開け、中に入る。` + (isMan ? "男は、入ってこなかった。戸口で、腕を押さえている。" : "背中で、男が何か言った。ふり返らずに、扉を閉める。"));
    S.l9.fog = 0;
    if (S.l9.clear) { note("skin"); verify("skin"); }
    enter("l9h");
  }
  // ---- レベル10：麦畑・納屋・轍の道
  function move10(dir) {
    const t = S.l10;
    if (S.loc === "l10a") {
      if (dir === "e") return false;
      if (dir === "u" || dir === "d") { say(dir === "u" ? "空は、低く、遠い。" : "土を掘る道具がない。"); return true; }
      if (dir === t.road) { t.walk = 0; say(`${DIR_JA[dir]}の生け垣を抜ける。……土の道に出た。`); enter("l10d"); return true; }
      t.t++;
      say(`${DIR_JA[dir]}の生け垣を抜ける。……同じような麦畑。振り返ると、赤い納屋が、さっきと同じ距離に見える。`);
      describe(true);
      return true;
    }
    if (S.loc === "l10d") {
      if (dir === "s") { t.walk = 0; say("麦畑へ戻る。"); enter("l10a"); return true; }
      if (t.walk < 2 && dir === "n") { t.walk++; say(t.walk === 1 ? "轍に沿って、北へ歩く。麦の穂が、ずっと同じ高さで続く。" : "歩く。……道の先が、二つに分かれていた。"); describe(true); return true; }
      if (t.walk >= 2 && (dir === "e" || dir === "w")) {
        if (dir === t.fork) {
          say(`新しい轍をたどって、${DIR_JA[dir]}へ歩く。土の道が、砂利に、それからアスファルトに変わる。麦畑が途切れ、電柱が、ビルが、現れる。`);
          gap();
          note("10");
          enter("l11a");
          return true;
        }
        t.walk = 0; t.t += 2;
        say(`草に埋もれた轍をたどって、${DIR_JA[dir]}へ歩く。……轍は、だんだん薄くなって、消えた。見回すと、麦畑の真ん中だった。納屋が見える。`);
        enter("l10a");
        return true;
      }
      say("轍は、そちらへは続いていない。"); return true;
    }
    return false;
  }
  // ---- レベル11：矢印・路地・バリケード・プール
  function arrowAt(dir) { return Object.keys(S.l11.dirs).find(c => S.l11.dirs[c] === dir); }
  function move11(dir) {
    if (S.loc === "l11a" && ["n", "e", "w"].includes(dir)) {
      const c = arrowAt(dir);
      const ja = { blue: "青", white: "白", red: "赤" }[c];
      if (c === "blue") { say(`${ja}い矢印をたどって、${DIR_JA[dir]}へ。矢印は、いくつも角を曲がる。鷲の旗の建物の前で、終わっていた。`); enter("l11c"); return true; }
      if (c === S.l11.pool) { say(`${ja}い矢印をたどって、${DIR_JA[dir]}へ。古いアーケードを抜け、矢印は、白いタイルの建物の前で終わっていた。`); enter("l11p"); return true; }
      say(`${ja}い矢印をたどって、${DIR_JA[dir]}へ。……矢印は、車と家具の山の前で終わっていた。`);
      enter("l11x");
      return true;
    }
    if (S.loc === "l11x" && dir === "n") { crossBarricade(); return true; }
    if (S.loc === "l11p" && dir === "d") { diveCity(); return true; }
    if (S.loc === "l11b" && dir === "e") { VERB_DO.open(O.partydoor); return true; }
    return false;
  }
  function crossBarricade() {
    say("バリケードの隙間をくぐる。花を踏まないように。……通りの向こうで、扉が一つ、こちらに向かって開いていた。");
    say("近づいただけなのに、足もとが、ふっと消えた。", "warn");
    gap();
    flicker(3); sfx("stinger");
    emit("shock2");
    const dest = pick(["l9a", "l10a"]);
    addSan(-1, "");
    if (S.broken || S.done) return;
    say(dest === "l9a" ? "……濡れたアスファルトの上。真夜中の住宅街。出口は、片道だった。" : "……曇り空の下。麦畑。出口は、片道だった。", "note");
    if (dest === "l10a") S.l10.walk = 0;
    enter(dest);
  }
  function diveCity() {
    say("プールの縁から、水に入る。水は、体温と同じ温度。底のレーンの線をたどって、潜る。");
    say("潜っても、潜っても、底に着かない。白いタイルの壁だけが、下へ続く。");
    sfx("splash");
    gap();
    emit("flash");
    note("11");
    enter("l37a");
    say("……浮かび上がると、知らない白い部屋のプールだった。さっきの照明の半分は、どこにもない。", "note");
  }
  function liftDown() {
    if (!S.power) { say("ボタンは反応しない。電気が来ていない。"); return; }
    if (!S.keyIn) { say("ボタンを押しても、鍵穴の横のランプが赤く点滅するだけだ。鍵が要る。"); return; }
    say("エレベーターの扉が開く。中に入ると、扉が勝手に閉まり、ゆっくり動きはじめた。上なのか下なのか、分からない。");
    say("階数の表示は「3」から「5」へ。迷うように「4」へ。それから、なぜか一度だけ「0」を表示して、また「4」へ。天井の蛍光灯が、それに合わせてちらつく。");
    sfx("door"); sfx("beep");
    gap();
    flicker(3);
    note("3");
    enter("l4a");
  }

  // ---- 結末 ----
  function finish(id, lines, title) {
    S.done = true;
    gap();
    for (const l of lines) say(l, "win");
    say(`****  ${title}  ****`, "win");
    say(`（手 ${S.moves}。いちばん下の「はじめから」で、最初から）`, "note");
    S.endId = id;
    const ends = LOOP.ends.includes(id) ? LOOP.ends.slice() : LOOP.ends.concat([id]);
    LOOP_AFTER = { n: LOOP.n + 1, echo: S.hist.slice(-12), last: id, ends, deep: LOOP.deep };
    saveLoop(LOOP_AFTER);
    emit("end", id);
    sfx({ exit: "chime", sublime: "drip", party: "stinger", wretch: "whisper", harvest: "breath", beta: "static" }[id]);
    const t = END_TRU[id];
    if (t) emit("truism", t);
  }
  let LOOP_AFTER = null;
  const END_TRU = {
    exit: ["EVERY HUM SOUNDS LIKE THE FIRST ONE", "どのうなりも、最初のうなりに似ている", "帰還"],
    sublime: ["YOU FORGOT THE REASON BEFORE THE WAY", "道より先に、理由を忘れた", "崇高"],
    party: ["=)", "=)", "=)"],
    wretch: ["NO ONE COUNTS THE ONES WHO STAYED", "残った者を、誰も数えない", "ウレッチ"],
    harvest: ["A FULL STOMACH CAN STILL BE EMPTY", "満ちた腹も、空っぽでありうる", "豊作"],
    beta: ["TO MAP THE EXITS IS NOT TO LEAVE", "出口を描くことは、出ることではない", "地図係"],
  };
  function endExit() {
    say("排水口の梯子を降りる。細い縦穴。塩素の匂いが薄れて、代わりに、湿った夜の匂い。");
    say("梯子の先の鉄の蓋を押し上げる。");
    sfx("clang");
    finish("exit", [
      "……夜の、古い市民プールだった。",
      "照明の半分が消えた館内。プールには水が張ってあり、底のタイルに、レーンの線が引いてある。",
      "どこかで見た形だ、と思った。どこで見たのかは、思い出さないことにした。",
      "見回りの警備員が、懐中電灯でこちらを照らした。「……閉館ですよ」",
      "警備員の顔は、逆光で、よく見えなかった。",
      "外に出る。夜の道路。街灯。自動販売機。信号機が、誰もいない交差点で色を変えている。",
      "家への道順を、思い出そうとした。思い浮かんだのは、黄色い壁紙の、細い縦じまだった。",
      "自動販売機の明かりが、低くうなっている。蛍光灯のうなりと、同じ高さで。",
      "ポケットに手を入れると、ボトルのキャップが一つ入っていた。",
    ], "帰還");
  }
  function endSublime() {
    finish("sublime", [
      "プールの縁に座り、足を水に浸す。水は、ちょうど体温と同じだ。",
      "帰りたい理由を、思い出そうとした。",
      "ひとつ目は、もう思い出せない。ふたつ目も。",
      "それでいい、と思った。",
      "それが、いちばん怖いことなのだと、最後に少しだけ思った。",
      "水の音が、いつまでも反響している。",
    ], "崇高");
  }
  function endParty() {
    finish("party", [
      "黄色い人たちが、いっせいに拍手をした。",
      "誰かが、こちらの顔に、マジックで何かを描いている。くすぐったい。",
      "鏡を渡される。そこに映っているのは、描いたような笑顔だった。",
      "とても、楽しい。",
      "=)",
    ], "=)");
  }
  function endHarvest() {
    finish("harvest", [
      "藁の寝床に横になると、麦の匂いが、体の中まで満ちてきた。",
      "朝は来なかった。夜も来なかった。曇り空は、ずっと同じ明るさだった。",
      "鍋の麦粥は、いつまでも減らない。いつまでも温かい。",
      "戸口の踏み段に、麦の穂を一本置いた。腐らない。ミミズが来て、かじって、引き返していった。",
      "それを見ても、もう、何とも思わなかった。",
      "ここは、いい場所だ。おなかは、すかない。",
    ], "豊作");
  }
  function endBeta() {
    finish("beta", [
      "名簿のいちばん下に、名前を書いた。書いてから、それが本当に自分の名前だったか、少し考えた。",
      "隊員は、色鉛筆を一本くれた。赤。出口に印をつけるための色。",
      "毎日、街を歩いて、出口を見つけ、地図に印をつける。印をつけた扉を、自分でくぐることはない。",
      "ときどき、新しいワンダラーが、矢印をたどって基地に来る。地図を見せる。何人かは、プールへ行く。誰も戻ってこない。帰れたのか、どうなのか、誰にも分からない。",
      "地図の「37」の横に、誰かが「帰れる？」と書いている。",
      "ある日、その字が、自分の字だと気づいた。",
    ], "地図係");
  }
  function endWretch() {
    finish("wretch", [
      "アーモンド水の味を、思い出せない。",
      "自分が何を探していたのかも。",
      "黄色い部屋の隅にうずくまり、壁紙の模様を、指で数える。数えても数えても、合わない。",
      "ずっと遠くで、誰かの足音。こちらを見つけても、その人は、目を逸らして通りすぎていく。",
      "自分も前に、そうしたことがある気がする。",
    ], "ウレッチ");
  }

  // ---- ヒント ----
  function hintText() {
    // 無線の切れ切れの声。はっきりとは言わない
    const water = ["water0", "water1", "water2", "waterV", "waterB", "water3", "water4"].find(id => held(id));
    if (S.san <= 3 && water) return "……持っている、水を……";
    if (LV() === "1" && S.blk > 0) return S.loc === "l1a" ? "……動くな……動くなら……緑の、ほう……" : "……動くな……";
    if (S.smile && S.loc === "l3b") return lightOn() ? "……灯りを、向けるな……" : "……目を……逸らさずに……ゆっくり……";
    if (S.l3.amb === 1) return "……後ろ……見ろ……";
    if (S.loc === "l2v") return "……光から……目を離すな……戻れ……";
    if (S.q6 === 1) return "……入れるな……";
    if (S.mim === 1) return "……声を……出すな……";
    if (S.l7.tiny > 0) return "……動くな……";
    if (S.l7.thing > 0) return "……光……";
    if (S.hound === 1 && S.loc === "l2j") return "……目を、逸らすな……背中を、見せるな……";
    if (S.loc === "l8r" && S.c8.mothOn > 0) return "……羽音……光に、集まる……";
    if (S.loc === "l9a" && S.l9.fog > 0) return "……霧……通りから、離れろ……";
    if (S.loc === "l0" && S.l0.redN) return "……赤……引き返せ……";
    switch (LV()) {
      case "0":
        if (S.l0.seam) return "……ちらつく、ところ……体ごと……";
        return "……足音のほうへは……行くな……壁の、ちらつき……";
      case "1":
        if (O.crate.loc === "l1a" && O.crate.closed) return "……補給の、箱……";
        if (O.crate.loc === "l1a" && !S.l1.checked) return "……手を入れる前に……見ろ……";
        if (!held("flashlight")) return S.loc !== "l1b" ? "……緑の、非常灯……" : "……七……いや……（ノイズ）……板に、書いてある……";
        return "……配管の、増える、ほう……灯りが、なくても……二度……";
      case "2":
        if (S.loc === "l2j") return "……熱い管は、どこにも行かない……";
        if (S.loc === "l2e") return S.l2.planks ? "……下……" : "……窓を……のぞいたか……";
        if (S.loc === "l2c") return S.l2.gave ? "……北へ……" : "……水を……分けて……";
        return "……北へ……";
      case "3":
        if (S.ss === 1) return "……返事を、するな……開けるな……あの水を、嫌う……";
        if (!held("liftkey")) return "……扉の、向こう……もう、静かか……？";
        if (!S.power) return "……身分証の、裏……";
        return "……昇降機……鍵穴……";
      case "4":
        if (!S.bulletin) return "……端末……掲示を……";
        return "……風船じゃない、ほうの扉……";
      case "5":
        if (!held("bkey") && !S.boilerOpen) {
          if (S.loc === "l5c") return "……針が、上がるまで……触るな……";
          if (!S.l5.note) return "……エレベーター……五……";
          return "……音楽の、するほう……";
        }
        if (S.loc === "l5e") return "……一……五……十三は……";
        return "……ボイラー……熱い……その、下……";
      case "6": return "……耳を……波の、音……";
      case "7":
        if (S.loc === "l7a") return S.l7.rope ? "……下……三つ……" : "……帳面……ロープを……";
        if (S.loc === "l7e") return lightOn() ? "……洞窟……下……" : "……灯りを……";
        return S.l7.air <= 3 ? "……息……上へ……" : "……潜れ……";
      case "8":
        if (S.loc === "l8a") return S.coat ? "……北……標識を……" : "……寒さで、死ぬ……あの男は、もう寒くない……";
        if (S.loc === "l8z") return "……床が、薄い……";
        return lightOn() ? "……標識を、読め……" : "……灯りがないなら……待て……光が、来る……";
      case "9":
        if (S.loc === "l9a") return "……腕の、血の色……それか、ことばを、かけてみろ……";
        if (S.loc === "l9h") return "……冷蔵庫の、扉……";
        return "……小道を、たどるな……";
      case "10":
        if (S.loc === "l10a" || S.loc === "l10b") return S.l10.ate ? "……二杯目は……" : "……高いところから、見ろ……";
        if (S.loc === "l10d") return "……新しい、轍……";
        return "……窓……";
      case "11":
        if (!S.l11.map) return "……鷲の、印の……";
        if (S.loc === "l11p") return "……潜れ……";
        return "……地図の、色……";
      case "37":
        if (S.loc === "l37c") return S.drain ? "……下……" : "……格子……";
        return "……長居、するな……いちばん浅い、ところの……";
      case "Fun": return "……はいと、言うな……食べるな……「!」……";
      case "!": return S.run >= 5 ? "……北……" : `……${DIR_JA[S.runDirs[S.run]]}……止まるな……`;
      case "433 N": return "……眠れ……どれかの、寝床で……";
    }
    return "……（ノイズ）……";
  }

  // ---- 動作 ----
  function need(o, verbJa) { if (!o) { say(`何を${verbJa}？`); return false; } return true; }
  const WORDS = [
    { ja: "はい", en: "yes", alt: ["うん", "いいよ"] },
    { ja: "いいえ", en: "no", alt: ["いや", "嫌だ", "行かない"] },
    { ja: "誰？", show: "誰？", en: "who", alt: ["誰", "だれ", "あなたは誰"] },
    { ja: "助けて", en: "help me", alt: ["たすけて"] },
    { ja: "ここはどこ", show: "ここはどこ？", en: "where", alt: ["ここどこ"] },
    { ja: "わからない", en: "i dont know", alt: ["分からない"] },
  ];
  const W = ja => WORDS.find(w => w.ja === ja);
  function wordsHere() {
    if (S.loc === "lfun") return ["はい", "いいえ"].map(W);
    if (S.loc === "l3a" && S.ss === 1) return ["誰？", "助けて", "はい"].map(W);
    if (S.loc === "l4b") return ["誰？", "ここはどこ", "助けて"].map(W);
    if (S.loc === "l6" && S.q6 === 1) return ["いいえ", "誰？"].map(W);
    if (S.loc === "l9a") return ["誰？", "助けて", "ここはどこ"].map(W);
    if (S.loc === "l11c") return ["誰？", "ここはどこ", "助けて", "はい", "いいえ"].map(W);
    return ["ここはどこ", "助けて", "誰？"].map(W);
  }
  const WATERS = ["water0", "water1", "water2", "waterV", "waterB", "water3", "water4"];
  const isWater = o => o && WATERS.includes(o.id);
  function drinkWater(o) {
    o.loc = "gone";
    note("water"); verify("water");
    sfx("drip");
    if (o.blue) {
      addSan(3, "");
      say("青い魔法瓶の水を飲む。味がしない。ただの水のようだ。（正気 +3）");
      if (S.falls > 0) { S.falls--; say("腕の発疹が、すうっと引いていく。何かから、一歩だけ引き返した気がする。", "note"); }
      say("……まぶたが、急に重くなった。一瞬だけ、眠った。", "note");
      haunt(pick(["眠る", "水", "ここはどこ"]));
      return;
    }
    addSan(4, "");
    say("アーモンド水を飲みほした。ほんのり甘い。喉を通るあいだだけ、うなりが遠のいた。（正気 +4）");
  }
  // ウレッチになりかけた人に、水か食べ物を分ける
  function giveWretch(o) {
    if (S.l2.gave) { say("もう、眠っている。"); return; }
    if (!o || !(isWater(o) || o.food) || o.loc !== "player") { say("その人は、こちらの手もとを見た。「みず……たべもの……」"); return; }
    o.loc = "gone";
    S.l2.gave = true;
    note("wretch"); verify("wretch");
    say(`${o.name}を差し出す。ただれた手が、震えながら受けとった。……長いあいだ、黙って、口に運んでいた。`);
    say("「……ありがとう。さきに いった ひとも、みずを くれた。おなじ かおを していた」", "voice");
    say("毛布の下から、使いかけの電池が一本、こちらへ転がってきた。それから、その人は眠った。", "note");
    O.batteryW.loc = "l2c";
    sfx("breath");
  }
  function tieRope() {
    if (S.l7.rope) { say("ロープは、もう結んである。"); return; }
    if (S.loc !== "l7a") { say("ここに、ロープを結ぶところはない。"); return; }
    if (!near("rope")) { say("ロープが手もとにない。"); return; }
    O.rope.loc = "l7a"; S.l7.rope = true;
    say("戸口に近づきすぎないように、床に腹ばいになって、ロープのフックを戸口の金具に掛けた。ロープの束を投げると、それは「下」へ落ちていき、海面に届いた。");
    sfx("clang");
  }
  function toggleSwitch(k) {
    S.sw[k] = !S.sw[k];
    say(`スイッチ${k}を${S.sw[k] ? "上げた" : "下げた"}。`);
    if ([1, 2, 3, 4].every(i => S.sw[i])) {
      for (const i of [1, 2, 3, 4]) S.sw[i] = false;
      S.power = false;
      S.burnt = true;
      S.smile = { t: -1, warn: false, eye: false };
      O.teeth3.loc = "l3b";
      gap();
      say("四つ目を上げた瞬間、天井の電球が、端から順に破裂した。スイッチが全部、ばちんと落ちる。", "warn");
      say(lightOn() ? "懐中電灯の輪の中に、白く光る目と、歯の列が浮かんでいる。笑っている。灯りのほうを向いて。" : "真っ暗な部屋の真ん中に、白く光る目と、歯の列が浮かんでいる。笑っている。", "warn");
      note("smiler");
      sfx("glass"); sfx("stinger");
      flicker(4);
      emit("shock2");
      return;
    }
    sfx("clang");
    const p = [1, 2, 3, 4].every(i => S.sw[i] === S.swOk.includes(i));
    if (p && !S.power) { say("廊下の向こう、エレベーターホールのほうで、モーターが唸りはじめた。"); sfx("hum"); }
    if (!p && S.power) say("エレベーターホールのほうで、モーターの音が止んだ。");
    S.power = p;
  }
  // レベル5のエレベーター
  function liftTo(k) {
    if (k === 13) {
      if (S.l5.lift) { say("もう一度押しても、表示は上がりつづけるだけだ。"); return; }
      S.l5.lift = 1;
      say("扉が閉まる。表示が、12、13……14、15。止まらない。下の階のボタンの灯りが、一つずつ消えていく。まだ「1」だけが、かすかに光っている。", "warn");
      sfx("hum"); flicker(2); emit("omen");
      return;
    }
    const was = S.l5.lift;
    S.l5.lift = 0;
    if (was) say("「1」を叩くように押す。……長い沈黙のあと、箱が、がくんと下へ動いた。表示が、数字ではない形をいくつか通りすぎて、「1」に戻る。", "note");
    sfx("bell");
    if (k === 1) { say("扉が開く。ロビーだ。"); enter("l5a"); return; }
    say("扉が開く。白い廊下の先に、シーツの匂いのする小部屋。");
    enter("l5h");
  }
  // 塗られていない窓（Entity 2）
  function windowBite() {
    note("windows");
    sfx("glass"); sfx("stinger");
    hurt(3, "窓枠に手をかけた瞬間、ガラスの向こうの部屋が、こちらへ身を乗り出した。……窓の縁に、歯が並んでいた。");
  }
  const VERB_DO = {
    look: () => describe(true),
    inventory: () => {
      const h = Object.values(O).filter(o => o.loc === "player");
      if (!h.length) { say("何も持っていない。"); return; }
      say("持ち物：");
      for (const o of h) say(o.name + (o.id === "flashlight" ? `（${lightOn() ? "点いている" : "消えている"}・電池${S.bat}%）` : o.id === "coat" ? "（着ている）" : ""), "indent");
    },
    wait: () => {
      if (LV() === "1" && S.blk > 0) { say("息を殺して、じっとしている。"); return; }
      if (S.smile && S.loc === "l3b") { say("動かない。息も、止める。"); return; }
      switch (S.loc) {
        case "l0":
          if (S.l0.kind === "manila") {
            if (S.l0.manilaRest < 2) { S.l0.manilaRest++; addSan(1, ""); say("椅子に座る。ピアノの音。誰かが向かいの椅子に座っているような気がする。少しだけ、楽になった。（正気 +1）"); }
            else say("ピアノの音。ここにいると、出ていく理由を忘れそうになる。");
            return;
          }
          if (S.l0.kind === "arch") { say("アーチの縁に腰かける。濡れたカーペットから、足が浮く。この部屋は、背後で形を変えない。"); return; }
          if (S.l0.spike) { say("耳をふさいで、立ちつくす。"); return; }
          S.l0.idle++;
          if (S.l0.idle >= 2) addSan(-1, "立ち止まっていると、黄色が、目の奥にしみこんでくる。");
          else say("立ち止まる。蛍光灯のうなりだけが、頭の中で大きくなっていく。");
          return;
        case "l2c":
          S.l2.camp++;
          if (!S.l2.gave && S.l2.camp % 2 === 0) addSan(-1, "「みず……たべもの……たすけて……」そのことばが、胸の奥に刺さる。");
          else say(S.l2.gave ? "眠っている人の寝息だけが聞こえる。" : "「みず……たべもの……」");
          return;
        case "l2v":
          S.l2.void++;
          if (S.l2.void >= 2) { lostVoid("じっとしているあいだに、"); return; }
          say("戸口の光が、さっきより小さくなった。遠ざかっているのは、光のほうなのか、自分のほうなのか。", "warn");
          return;
        case "l3a": say(S.ss === 1 ? "返事をしないで、じっとしている。扉を叩く音が続く。" : "機械の唸り。火花の音。"); return;
        case "l3s": say("天使の像の前で、息を整える。ここには、何も入ってこない。"); return;
        case "l5c": say(songOn() ? "ジャズが続いている。誰もいない席から、かすかな笑い声。グラスの触れ合う音。" : "静かだ。蓄音機の針が、上がったまま止まっている。"); return;
        case "l5e": say("エレベーターは、ボタンを待っている。"); return;
        case "l6":
          if (S.q6 === 1) {
            S.qWait++;
            if (S.qWait >= 2) addSan(-1, "「お願い。入れて。入れて。入れて」囁きが、耳の中に入ってくる。");
            else say("「入れてくれるだけでいいの。ねえ」");
            return;
          }
          if (S.mim === 1) { S.mim = 2; verify("mimic"); note("mimic"); say("息を止めて、じっとする。……すぐ横を、いくつもの足音が通りすぎていった。自分の声で、ひそひそと話しながら。", "note"); return; }
          say("暗闇の中で、じっとする。波の音だけが、遠くで続いている。"); return;
        case "l7a": say("椅子に座る。戸口の向こうで、波の音。この部屋の空気は、吸うたびに胸の奥まで届く。"); return;
        case "l7b": say("黒い水に浮かんで、じっとする。体温が、少しずつ奪われていく。"); return;
        case "l7c": case "l7d": case "l7e": say("水の中で、じっとする。"); return;
        case "l37a": case "l37b": case "l37c": say("ここは、静かで、温かい。"); return;
        case "lfun": say("「ねえ、ケーキ食べようよ =)」"); return;
        case "lrun": return;
        case "l8a": say("湖の水が、黒く揺れている。濡れた服が、じわじわと体温を奪っていく。"); return;
        case "l8r":
          if (!lightOn()) {
            S.c8.guide++;
            if (S.c8.guide === 2) { say(`暗闇の中に、小さな青緑の光が降りてきた。目の高さで止まり、こちらを確かめるように揺れる。……それから、${DIR_JA[S.c8.route[S.c8.step]]}の穴のほうへ、すうっと飛んでいった。`, "note"); sfx("chime"); return; }
            if (S.c8.guide > 2) { say(`青緑の光は、${DIR_JA[S.c8.route[S.c8.step]]}の穴の前で揺れている。`); return; }
            say("灯りのない暗闇で、じっとする。壁のひびが、かすかに青く光っている。……何かが、近くを漂っている気がする。");
            return;
          }
          say("冷たい水滴が、首筋に落ちる。灯りの輪の外は、何も見えない。"); return;
        case "l8z":
          S.c8.creak++;
          if (S.c8.creak >= 2) { fall9("じっとしていると、"); return; }
          say("床が、みしりと鳴った。足の下から、風。", "warn"); sfx("thud"); return;
        case "l9a": say(lamp9() ? "立ち止まる。街灯の光の中で、男が、腕を押さえて手招きしている。" : "立ち止まる。暗い家並み。どこかの家で、柱時計が鳴る。"); return;
        case "l9h": case "l9y": say("静かだ。家じゅうが、息を止めているみたいに。"); return;
        case "l10a": case "l10b": case "l10c": case "l10d": say("風が、麦を渡っていく。空の明るさは、少しも変わらない。"); return;
        case "l11a": case "l11b": case "l11c": case "l11p": case "l11x": say("信号機が、誰もいない交差点で、律儀に色を変える。どこかで、車のドアが閉まる音。"); return;
      }
      say("時が過ぎる。");
    },
    hint: () => VERB_DO.dunno(),
    // 「わからない」：無線が切れ切れに答える。一つのレベルで二度まで。答えるたびに、頭がきしむ
    dunno: () => {
      if (WATER7.includes(S.loc)) { say("「わからない」と言おうとして、ことばは泡になって消えた。", "note"); return; }
      say("「わからない」", "voice");
      if (S.loc === "lfun") { say("「わからないの？　じゃあ、パーティーしようよ =)」", "voice"); return; }
      if (S.loc === "l3a" && S.ss === 1) { say("扉の向こうの声が、そっくり同じ声で言った。「わからない」", "warn"); sfx("whisper"); return; }
      if (S.loc === "l6" && S.mim === 1) { addSan(-2, "暗闇の中で、何人もの声が、同じことばをくり返した。「わからない」「わからない」「わからない」。……近い。"); sfx("whisper"); return; }
      if (S.loc === "l9a" && S.l9.clear) say("戸口の男が、こちらと同じ声で言った。「わからない」", "warn");
      const lv = LV();
      const used = S.hints[lv] || 0;
      if (used >= 2) { say("無線は、ノイズしか返さない。……自分で、確かめるしかない。", "note"); return; }
      S.hints[lv] = used + 1;
      say("どこかで、ノイズまじりの無線の声が、小さく答えた。", "note");
      say(hintText(), "voice");
      sfx("static");
      if (S.san > 2) { S.san--; say("（声を聞いているあいだ、頭の奥がきしんだ。正気 −1）", "note"); }
    },
    listen: () => {
      switch (S.loc) {
        case "l0":
          if (S.l0.kind === "manila") { say("うなりが、ない。静かなピアノ。……それから、ごく近くで、誰かが椅子を引く音。誰もいない。"); return; }
          say(`蛍光灯のうなり。……その奥で、${DIR_JA[S.l0.foot]}のほうから、何かが歩きまわる足音がする。` + (S.l0.ac !== S.l0.foot && S.l0.steps >= 2 ? `それとは別に、${DIR_JA[S.l0.ac]}のほうから、空調の低い音。` : "") +
            (S.l0.redN ? `${DIR_JA[S.l0.red]}のほうからは、何も聞こえない。うなりさえ。` : "") + (Math.random() < 0.3 ? "誰かが、名前を呼んでいる気がする。名前のところだけ、聞きとれない。" : ""));
          return;
        case "l1a": say("水の滴る音。遠くで、鉄の扉が閉まる音。照明が、じじ、と鳴る。北のほうで、配管が鳴っている。" + (O.crate.loc === null && !S.l1.crateGone && S.l1.crateT > 0 ? "背中のほうで、木の箱を置くような音。" : "")); return;
        case "l1b": VERB_DO.listenTo(O.radio); return;
        case "l1c": say("下のほうから、配管を叩く音。カン、カン、カン。"); return;
        case "l2a": say("管の中を、何かが叩きながら流れていく。東の部屋から、かすれた声。"); return;
        case "l2c": say(S.l2.gave ? "寝息。" : "「みず……たべもの……たすけて……」くり返し、くり返し。"); return;
        case "l2e": say("板の打たれた扉の向こうから、低い唸り。窓のある扉の向こうからは、何も。……何も、という音がする。"); return;
        case "l2v": say("何も聞こえない。自分の心臓の音さえ。"); return;
        case "l2j": say(S.hound === 1 || S.hound === 2 ? "低い唸り声。こちらの呼吸に合わせるように。" : "三本の管が、それぞれ違う音で鳴っている。熱い管は、まだ流れている音。どれが冷たいかは、音だけでは分からない。"); return;
        case "l3a": say(S.ss === 1 ? "扉を叩く音。それから、声。" + ssLine() : "機械の唸り。火花。格子の奥で、誰かが泣いているような声。……「たすけて」。"); return;
        case "l3b": say(S.smile ? "暗闇の真ん中から、歯の擦れる、小さな音。" : "発電機の唸り。"); return;
        case "l3c": say(S.power ? "モーターの唸り。ケーブルが、上のほうで軋む。" : "何も聞こえない。"); return;
        case "l3s": say("高い天井に、自分の息だけが響く。機械の唸りは、戸口の外で止まっている。"); return;
        case "l4a": case "l4b": say("空調の音。蛍光灯のうなりは、ここでは少しだけ小さい。塗られていない窓のほうから、外の、車の音。……外？"); return;
        case "l4c": say("階段の下から、レコードの音。風船の扉の向こうから、楽しそうな音楽。鷲の扉の向こうは、静か。"); return;
        case "l5a": case "l5b": say("遠くで、レコードのジャズ。壁の向こうで、パーティーのざわめき。" + (S.loc === "l5b" ? "暗い客室の中で、乾いた翅の音。" : "")); return;
        case "l5c": say(songOn() ? "ジャズ。誰もいない席で、グラスの触れ合う音。" : "静けさ。蓄音機の針が上がっている。誰かが、次の曲を待って息を止めている。"); return;
        case "l5d": say("ボイラーの轟音。焚き口の奥から、囁き。梯子の穴の奥は、無音だ。"); return;
        case "l5e": case "l5h": say("ケーブルの軋み。遠くで、ジャズ。"); return;
        case "l6":
          if (S.q6 === 1) { say("「入れて。お願い」囁きが、ずっと続いている。その向こうに、波の音。"); }
          if (S.l6 >= 3) { say("すぐそこで、波の音。"); return; }
          say(`波の音が、${DIR_JA[S.l6d[S.l6]]}のほうから聞こえる。` + (S.mim === 1 ? "そのあいだに、自分の声の囁き。" : ""));
          return;
        case "l7a": case "l7b": say("戸口の向こうの、波の音。ずっと下のほうで、何かが鳴いている。"); return;
        case "l7c": case "l7d": case "l7e": say(S.l7.tiny > 0 ? "水が、とても低い音で震えている。" : S.l7.thing > 0 ? "下のほうで、何かが水を押しのける音。" : "自分の鼓動。水の重さ。"); return;
        case "l37a": case "l37b": case "l37c": say(S.loc === "l37c" ? "水の反響。……その奥、排水口の下から、遠くで車の走る音。" : "水の反響。どこかで、誰かが水をかく音。"); return;
        case "lfun": say("音楽が大きすぎて、自分の声も聞こえない。黄色い人たちの、くすくす笑い。"); return;
        case "lrun": say("警報。後ろから、足音。すぐ後ろから。"); return;
        case "l8a": say("水滴の音。ずっと奥で、何かが、かちかちと鳴いている。"); return;
        case "l8r": {
          const c = S.c8;
          if (c.step === c.moth && c.mothOn > 0) { say("頭の上で、紙をこすり合わせるような羽音。たくさん。"); return; }
          if (c.step === c.balloon) { say(`${DIR_JA[c.smell]}の穴の奥から、しゅう、と、細く空気の漏れる音。`); return; }
          say("水の流れる音。どこかで、石の鳴るような音。"); return;
        }
        case "l8z": say("足の下、ずっと下のほうから、風の音。……雨だれ。犬の遠吠え。"); return;
        case "l9a": say("濡れた路面を渡る風。どこかの家で、柱時計。" + (S.l9.fog ? "霧の中で、関節の鳴る音が、いくつも。" : "")); return;
        case "l9h": say("冷蔵庫は鳴っていない。時計の針の音もしない。"); return;
        case "l9y": say("草が風に鳴る。小道の先、生け垣の門の向こうから、車の走る音。……ここは、住宅街のはずなのに。"); return;
        case "l10a": case "l10c": say("風が麦を渡る音。ずっと遠くで、エンジンをかけるような音が一度だけ。方角は、分からない。"); return;
        case "l10b": say("納屋の梁がきしむ。鍋の中で、何かが、ぷつりと泡を立てた。火の気は、ないのに。"); return;
        case "l10d": say("轍の上を渡る風。……ずっと先で、クラクション。"); return;
        case "l11a": say("信号機の切り替わる音。ハウンドの寝息。ビルの窓の奥から、自分の足音が、少し遅れて返ってくる。"); return;
        case "l11b": say("風船のこすれる音。扉の向こうで、くぐもった音楽と、くすくす笑い。=)"); return;
        case "l11c": say("無線の雑音。ペンが地図をこする音。"); return;
        case "l11p": say("水の音。……塩素の匂いの奥で、ずっと遠く、車の走る音。"); return;
        case "l11x": say("バリケードの向こうで、たくさんの扉が、ばらばらに開いたり閉じたりする音。"); return;
        case "l433": say("空調の低い音。どのカプセルの中からも、寝息は聞こえない。"); return;
      }
      say("何も聞こえない。");
    },
    help: () => say("遊び方：「命令を作る」で、動詞 → 物（「言う」ならことば）の順にタップする。方角のボタンで移動し、「上」「下」で上下に動く。（もとにした記事と著作権の表示は、PWA 版のメニューに）", "note"),
    noclip: () => {
      if (S.loc === "l0") {
        if (!S.l0.seam) { say("壁に肩を押しつけてみた。ただの壁だ。……どこかに、ちらついている壁があるはずだ。"); return; }
        say("ちらつく壁に、肩から体を投げこむ。壁紙が、水のように冷たくなった。");
        say("……体が、壁の中を通り抜けていく。");
        gap();
        flicker(4); sfx("static"); emit("shock1");
        say("落ちる。長くは落ちなかった。コンクリートの床に、膝から着いた。");
        note("0");
        enter("l1a");
        return;
      }
      if (S.loc === "l8z") { fall9("薄い床に、体を押しつける。"); return; }
      if (S.loc === "l2v") { lostVoid("黒に、体を押しつけた。"); return; }
      say("壁に体を押しつけてみた。……ここの壁は、すり抜けられそうにない。");
    },
    run: () => {
      if (S.loc === "l2j" && (S.hound === 1 || S.hound === 2)) { hurt(3, "走り出した瞬間、背中に重いものが飛びついた。"); note("hound"); return; }
      if (S.loc === "lrun") return; // 赤い廊下では act の中で扱う
      if (S.loc === "l0") { say("走る。黄色い部屋が、次々に後ろへ流れていく。……どれだけ走っても、同じ部屋だ。"); move0(pick(["n", "s", "e", "w"].filter(d => d !== S.l0.red))); return; }
      if (S.loc === "lfun") { say("走って出口を探す。黄色い人たちが、手をつないで輪になり、道をふさいだ。"); return; }
      if (S.loc === "l11a") { note("hound"); hurt(3, "走り出した瞬間、寝そべっていたハウンドが跳ね起きた。この街でも、逃げるものは追われる。"); return; }
      if (S.loc === "l9a") { say("走る。濡れた路面で、足が滑る。……どこまで走っても、同じ交差点だ。"); return; }
      if (S.loc === "l2v") { lostVoid("走った。"); return; }
      say("走る理由が見つからない。走ると、何かに気づかれる気がする。");
    },
    // 泳ぐ（「漕ぐ」とも言える）
    row: () => {
      if (S.loc === "l7a") { say("ここは部屋の中だ。海は、戸口の「下」にある。"); return; }
      if (S.loc === "l7b") { say("立ち泳ぎをする。遠くの島は、少しも近づかない。……潜るなら、下だ。"); return; }
      if (WATER7.includes(S.loc)) { say("水をかいて、その場にとどまる。"); return; }
      if (["l37a", "l37b", "l37c", "l11p"].includes(S.loc)) { say("温かい水を、ゆっくりかく。……ずっと、こうしていたい。"); if (LV() === "37") S.calm++; return; }
      say("泳ぐ水がない。");
    },
    examine: (o) => {
      if (!need(o, "調べる")) return;
      if (o.id === "hound") {
        if (S.hound === 1) { S.hound = 2; say("目を逸らさずに、見つめ返す。それは低く唸り、前脚を止めた。……こちらが怖がるのを、待っている。"); note("hound"); return; }
        say(text(o.desc)); return;
      }
      if (o.id === "teeth3" && S.smile) { S.smile.eye = true; say("目を逸らさずに、光る目を見つめ返す。歯の列は、笑ったまま止まった。……今なら、ゆっくり離れられるかもしれない。"); return; }
      if (o.id === "hound3" && S.l3.amb === 1) { ambushSafe("振り向く。"); return; }
      if (o.id === "bars") { say(text(o.desc)); if (!S.l3.bars) { S.l3.bars = true; sfx("whisper"); addSan(-1, "瞬きをすると、影は、一歩近くにいた。格子の、すぐ向こうに。"); } return; }
      if (o.id === "window4") {
        S.l4.win++;
        if (S.l4.win === 1) { say("ガラスの向こうに、見覚えのある部屋が見える。自分の部屋に、よく似ている。……帰れる、と思った。窓枠に、手が伸びかける。", "warn"); sfx("whisper"); return; }
        addSan(-1, "目が、離せない。ガラスの向こうの部屋が、少しずつ近づいてくる。……窓が、こちらを見ている。"); note("windows"); return;
      }
      if (o.id === "tiny7") { addSan(-2, "影を、見てしまった。顎の大きさだけで、ボートが何艘も入る。"); return; }
      if (o.id === "bones7") { say(text(o.desc)); if (!S.seen.bones7) { S.seen.bones7 = true; addSan(-1, ""); } return; }
      if (o.id === "tv9") { emit("vhs"); say(text(o.desc)); if (!S.l9.tv) { S.l9.tv = true; addSan(-1, "黒い画面の中で、ソファに、もう一人座っている。振り向いても、誰もいない。"); sfx("static"); } return; }
      if (o.id === "mirror11") { say(text(o.desc)); if (!S.l11.glass) { S.l11.glass = true; addSan(-1, "窓に映った自分が、一拍遅れて、まばたきをした。"); } return; }
      if (o.id === "moths" && lightOn()) { say(text(o.desc)); say("灯りの中で、いくつもの複眼が、いっせいにこちらを向いた。", "warn"); return; }
      if (o.id === "crate" && !O.crate.closed) { S.l1.checked = true; say("おがくずをそっと探る。……割れたガラスの破片が、いくつも混じっていた。よけて取り出せば、手は切らない。"); return; }
      if (o.id === "sludge") { say(text(o.desc) + "触れたら、ただでは済まない。", "warn"); return; }
      if (o.id === "sdoor" && S.ss === 1) { note("skin"); say(text(o.desc)); say("血が透明なら、近づくな。……どこかで読んだことばが、頭に浮かんだ。", "note"); return; }
      say(text(o.desc) || `${o.name}に、特に変わったところはない。`);
    },
    read: (o) => {
      if (!need(o, "読む")) return;
      if (isDark() && !o.feel) { say("暗くて、字が読めない。"); return; }
      if (!o.read) { VERB_DO.examine(o); return; }
      const t = text(o.read);
      say(t, o.id === "book" || o.id === "page0" ? "doc" : "");
      if (o.id === "page0" && held("book")) say("（生存手引きに綴じた）", "note");
    },
    take: (o) => {
      if (!need(o, "取る")) return;
      if (o.loc === "player") { say("もう持っている。"); return; }
      if (o.loc === "crate" && !S.l1.checked && !S.l1.cut) {
        S.l1.cut = true;
        addSan(-1, "おがくずに手を入れた瞬間、指先に鋭い痛み。……割れたガラスが混じっていた。血がにじむ。");
        return;
      }
      if (o.id === "glass1") { say("割れたガラスは、そのままにしておく。"); return; }
      if (o.id === "bkey" && songOn()) {
        sfx("glass");
        addSan(-2, "鍵に指が触れた瞬間、レコードが止まった。誰もいない席から、いっせいに拍手。……手を引っこめると、また曲が始まった。");
        return;
      }
      if (o.id === "hound") { hurt(3, "手を伸ばした瞬間、それが跳んだ。"); return; }
      if (o.id === "partygoers" || o.id === "cake") { VERB_DO.eat(O.cake); return; }
      if (["hound11", "balloon8", "balloons11", "rock8", "man9", "moths", "teeth3", "hound3", "tiny7", "thing7", "wretch2", "sludge", "window4", "switch6"].includes(o.id)) { VERB_DO.touch(o); return; }
      if (o.id === "coat") {
        o.loc = "player"; S.coat = true; S.cold = 0;
        addSan(-1, "遺体の上着のファスナーを下ろす。目を閉じて、顔をそむけて。……ごめんなさい、と小さく言った。");
        say("上着を着こむ。濡れた体に、フリースが温かい。");
        return;
      }
      if (o.id === "rope" && S.l7.rope) { say("結んだロープは、ほどかないでおく。"); return; }
      if (!o.take) { say(`${o.name}は取れない。`); return; }
      o.loc = "player";
      say(`${o.name}を取った。`);
      if (o.id === "flashlight" && !S.blkArmed && !S.blkDone) S.blkArmed = true;
      if (o.id === "bkey") sfx("clang");
      if (o.id === "book") {
        const n = Object.keys(S.pages).length;
        if (held("page0") || n) say("拾ったページを、バインダーに綴じた。", "note");
      }
    },
    drop: (o) => {
      if (!need(o, "置く")) return;
      if (o.loc !== "player") { say(`${o.name}は持っていない。`); return; }
      if (o.id === "rope" && S.loc === "l7a") { tieRope(); return; }
      if (o.id === "flashlight") S.light = false;
      if (o.id === "coat") S.coat = false;
      o.loc = S.loc;
      say(`${o.name}を置いた。`);
      if (o.id === "cloth1" && S.loc === "l1a") {
        S.l1.clothDown = true;
        if (!S.l1.clothBonus) { S.l1.clothBonus = true; addSan(1, "黄緑の布を、床に広げて置いた。誰かのための合図。……誰かとつながっている気が、少しだけした。（正気 +1）"); }
      }
    },
    put: (o, w) => {
      if (!need(o, "入れる")) return;
      const sm = o.id.match(/^sw([1-4])$/);
      if (sm) { if (!S.sw[+sm[1]]) toggleSwitch(+sm[1]); else say("もう上がっている。"); return; }
      if (o.battery) {
        if (!held("flashlight")) { say("懐中電灯を持っていない。"); return; }
        if (o.loc !== "player" && o.loc !== S.loc && !visible().includes(o)) { say(`${o.name}が手元にない。`); return; }
        o.loc = "gone";
        S.bat = Math.min(100, S.bat + (+o.battery || 40));
        say(`電池を入れ替えた。電池 ${S.bat}%。` + (o.battery < 30 ? "……ほとんど、残っていなかった。" : ""));
        sfx("beep");
        return;
      }
      if (o.id === "rope" || (w && w.id === "rope")) { tieRope(); return; }
      if (w && w.id === "wretch2") { giveWretch(o); return; }
      if (isWater(o) && w && w.id === "sdoor") {
        if (S.ss !== 1) { say("扉の向こうは、もう静かだ。"); return; }
        if (o.loc !== "player") { say(`${o.name}を持っていない。`); return; }
        o.loc = "gone"; S.ss = 2; note("skin"); verify("skin");
        say("扉の下の隙間へ、アーモンド水を流しこむ。……扉の向こうで、誰の声でもない声が、長く、長く叫んだ。床を引っかきながら、何かが遠ざかっていく。", "warn");
        sfx("stinger"); sfx("scratch");
        return;
      }
      if (o.id === "liftkey" || (o.id === "keyhole3" && w && w.id === "liftkey")) {
        if (S.loc !== "l3c") { say("ここに、鍵穴はない。"); return; }
        if (!held("liftkey")) { say("鍵を持っていない。"); return; }
        O.liftkey.loc = "keyhole3_in";
        S.keyIn = true;
        say("鍵を差して、回す。カチリ。ボタンの横の小さなランプが、緑に変わった。");
        sfx("clang");
        return;
      }
      if (o.id === "bkey" && w && w.id === "bdoor") { VERB_DO.open(O.bdoor); return; }
      if (!w) { say("どこに入れる？"); return; }
      if (w.container && !w.closed && o.loc === "player") { o.loc = w.id; say(`${o.name}を、${w.name}に入れた。`); return; }
      say(`${o.name}は、${w.name}には入れられない。`);
    },
    give: (o, w) => {
      if (!need(o, "渡す")) return;
      if (o.id === "wretch2") { giveWretch(w); return; }
      if ((w && w.id === "wretch2") || (!w && S.loc === "l2c")) { giveWretch(o); return; }
      if (w && (w.id === "faceling" || w.id === "partygoers")) { say("受けとろうとしない。何をされたのか、分からないようだ。"); return; }
      say("受けとる人が、いない。");
    },
    tie: (o) => {
      if (!o || o.id === "rope" || o.id === "doorway7") { tieRope(); return; }
      say(`${o.name}を、結ぶところがない。`);
    },
    open: (o) => {
      if (!need(o, "開ける")) return;
      if (o.id === "sdoor") {
        if (S.ss === 1) {
          note("skin");
          S.ssWait = 0;
          sfx("door"); sfx("stinger");
          hurt(4, "扉を開けた。……立っていたのは、人の形にたるんだ皮だった。皮の内側で、何かが、こちらの声で笑った。");
          return;
        }
        say("鉄扉を開ける。……誰もいない。");
        sfx("door");
        gap();
        enter("l3d");
        return;
      }
      if (o.id === "door3") {
        if (!S.l2.planks) { S.l2.planks = true; sfx("clang"); say("打ちつけてある板に指をかけ、一枚ずつ剥がす。錆びた釘が、悲鳴のような音を立てた。「行くな」の字が、ばらばらになって床に落ちた。"); return; }
        go("d"); return;
      }
      if (o.id === "door4") {
        say("「4」の扉を開ける。……向こうには、何もなかった。床も、壁も、音も。足を一歩、黒の中へ。");
        sfx("door");
        gap();
        S.l2.void = 0;
        enter("l2v");
        say("背中の戸口の光から離れたら、たぶん、もう戻れない。", "warn");
        return;
      }
      if (o.id === "doorway7" || o.id === "doorway2") { go(o.id === "doorway7" ? "d" : "s"); return; }
      if (o.id === "door5") { say("「5」の扉を開け、古風な階段を降りる。一階ぶんのはずが、長い。踊り場の絨毯が、途中から深紅に変わった。レコードの音が近づく。"); sfx("door"); gap(); note("4"); enter("l5a"); return; }
      if (o.id === "doorb") {
        say("風船の扉を開ける。音楽が、どっとあふれてきた。");
        gap();
        flicker(2);
        note("4");
        enter("lfun");
        return;
      }
      if (o.id === "intercom") { VERB_DO.press(o); return; }
      if (o.id === "window4") { windowBite(); return; }
      if (o.id === "mothdoor") {
        note("moth");
        sfx("scratch"); sfx("stinger");
        hurt(3, "半開きの扉を押した。……真っ暗な天井いっぱいに、灰色の翅が開いた。羽音の雨が、顔に、首に、口に。");
        return;
      }
      if (o.id === "liftdoor5") { say("銅の格子を引いて、エレベーターに乗る。"); sfx("door"); enter("l5e"); return; }
      if (o.id === "bdoor") {
        if (S.boilerOpen) { say("もう開いている。"); return; }
        if (!held("bkey")) { say("鍵がかかっている。"); return; }
        S.boilerOpen = true;
        say("重い鍵を回す。扉を引くと、熱気が顔を打った。");
        sfx("door");
        return;
      }
      if (o.id === "doorx") {
        say("「!」の扉に飛びつき、押し開ける。後ろで、黄色い人たちが、いっせいに笑うのをやめた。");
        sfx("door");
        gap();
        note("Fun"); note("party"); verify("party");
        enter("lrun");
        say("背後で扉が閉まる。……すぐに、何かがその扉を叩きはじめた。", "warn");
        sfx("knock");
        return;
      }
      if (o.id === "drain") {
        if (S.drain) { say("もう外してある。"); return; }
        S.drain = true;
        say("格子に指をかけて、持ち上げる。思ったより軽い。下へ、細い梯子が続いている。遠くで、車の走る音。");
        sfx("clang");
        return;
      }
      if (o.id === "houseW" || o.id === "houseE") { enterHouse(o.id === "houseW" ? "w" : "e"); return; }
      if (o.id === "lake8") { S.cold += 6; sfx("splash"); addSan(-2, "地底湖に体を沈める。……冷たさが、骨まで刺さった。歯が鳴りやまない。慌てて、岸へ這い上がる。"); return; }
      if (o.id === "lake10") { say("湖に足を入れる。思ったより深い。底のほうに、別の部屋の明かりが揺れている。……引き返した。ここから先は、どこへ着くか分からない。"); return; }
      if (o.id === "pool11") { diveCity(); return; }
      if (o.id === "barn") { go("e"); return; }
      if (o.id === "partydoor") {
        say("=)の扉を開ける。音楽が、どっとあふれてきた。");
        gap(); flicker(2); emit("shock2");
        enter("lfun");
        return;
      }
      if (o.id === "barricade") { crossBarricade(); return; }
      if (["diary10", "memo9", "map11", "roster", "sign8", "scrap8", "poster11", "note1", "docs0", "note5", "log7", "sign2", "diary3"].includes(o.id)) { VERB_DO.read(o); return; }
      if (o.id === "page0" || o.id === "book" || o.id === "invite") { VERB_DO.read(o); return; }
      if (o.container) {
        if (!o.closed) { say("もう開いている。"); return; }
        o.closed = false;
        if (o.id === "crate") { say("木箱の蓋をこじ開ける。釘がきしむ。おがくずの中に、灰色の魔法瓶と、電池。"); say("……おがくずの奥で、何かが、きらりと光った。", "warn"); sfx("clang"); }
        else if (o.id === "lk" + S.hairLk) { sfx("door"); addSan(-1, `${S.hairLk}番のロッカーを開ける。……長い髪の束が、ずるりと垂れ下がった。`); }
        else if (o.id === "lk" + S.emptyLk) { sfx("door"); say(`${S.emptyLk}番のロッカーを開ける。空っぽだ。内側に、爪で引っかいた字。「もどれない」`); }
        else if (o.id === "lk" + S.gear) { sfx("door"); say(`${S.gear}番のロッカーを開ける。黄色い懐中電灯と、M.E.G. のバインダー。`); }
        else if (o.id === "drawer") say("引き出しを開ける。銀色の包みと、電池が一本。");
        else if (o.id === "cupboard0") say("戸棚を開ける。灰色の魔法瓶と、紐で綴じた書類。");
        else if (o.id === "pack8") say("リュックの口を開ける。錆びた電池と、紙の切れ端。食べ物は、何もない。");
        else if (o.id === "fridge9") say("冷蔵庫を開ける。ぬるい空気。棚に、ラベルのない缶詰がひとつ。");
        else say(`${o.name}を開けた。`);
        return;
      }
      say(`${o.name}は、開けるものではない。`);
    },
    close: (o) => {
      if (!need(o, "閉める")) return;
      if (o.container) { if (o.closed) { say("もう閉まっている。"); return; } o.closed = true; say(`${o.name}を閉めた。`); return; }
      say(`${o.name}は、閉めるものではない。`);
    },
    lighton: (o) => {
      if (o && o.id !== "flashlight") { say(`${o.name}は、点けるものではない。`); return; }
      if (!held("flashlight")) { say("灯りになるものを持っていない。"); return; }
      if (LV() === "6") { S.light = true; say("スイッチを入れる。……光が、出ない。電池はあるのに。ここでは、光が光にならない。"); return; }
      if (S.bat <= 0) { say("電池が切れている。"); return; }
      if (S.light) { say("もう点いている。"); return; }
      S.light = true;
      say("懐中電灯を点けた。");
      if (S.smile && S.loc === "l3b") { say("歯の列が、ゆっくり、灯りのほうを向いた。", "warn"); S.smile.warn = true; return; }
      if (LV() === "1" && S.blk > 0) { say("灯りの輪の外で、何かが、立ち止まった。天井の通気口から、細長い腕が、ゆっくり伸びてくる。", "warn"); sfx("scratch"); addSan(-1, ""); return; }
      if (S.loc === "l7e" && S.l7.thing > 0) { thingFlee(); describe(true); return; }
      describe(true);
    },
    lightoff: (o) => {
      if (o && o.id !== "flashlight") { say(`${o.name}は、消すものではない。`); return; }
      if (!held("flashlight") || !S.light) { say("消す灯りがない。"); return; }
      S.light = false;
      say("懐中電灯を消した。");
      if (isDark()) say("真っ暗だ。");
    },
    drink: (o) => {
      if (!need(o, "飲む")) return;
      if (!o.drink) { say(`${o.name}は、飲めない。`); return; }
      if (o.tap) {
        if (S.cooler <= 0) { say("給水器のレバーを押す。……ごぼ、と空気の音がしただけだ。タンクは空になっている。"); return; }
        S.cooler--;
        note("water"); verify("water");
        sfx("drip");
        addSan(3, "");
        say("紙コップで、給水器のアーモンド水を飲む。ほんのり甘い。（正気 +3）" + (S.cooler ? "" : "……タンクが、空になった。"));
        return;
      }
      if (o.leak) {
        S.l5.leak = (S.l5.leak || 0) + 1;
        if (S.l5.leak > 2) { say("管の水は、熱すぎる。もう口をつけられない。"); return; }
        sfx("drip");
        addSan(1, "");
        say("管の継ぎ目から滴る水を、手で受けて飲む。熱い。アーモンドの味。（正気 +1）");
        return;
      }
      if (o.lake) {
        const k = o.id === "lake8" ? "lake" : null;
        const used = k ? S.lake : S.l10.lake;
        if (used >= 2) { say(o.id === "lake8" ? "手ですくって飲む。……苦い。もう、体が受けつけない。" : "手ですくって飲む。土の味。もう、喉は渇いていない。"); return; }
        if (k) S.lake++; else S.l10.lake++;
        addSan(1, "");
        say(o.id === "lake8" ? "地底湖の水を、手ですくって飲む。かすかにアーモンドの味。それから、鉱物の苦み。（正気 +1）" : "湖の水を、手ですくって飲む。冷たい。土の匂いがする。（正気 +1）");
        return;
      }
      if (o.pain) {
        o.loc = "gone";
        addSan(-6, "赤い液体を飲んだ。……喉から、全身へ、焼けるような痛みが広がった。何も考えられない。");
        return;
      }
      if (!near(o.id)) { say(`ここに${o.name}はない。`); return; }
      drinkWater(o);
    },
    eat: (o) => {
      if (!need(o, "食べる")) return;
      if (o.id === "cake" || o.id === "partygoers") {
        say("ケーキを一口、食べた。甘い。とても甘い。", "warn");
        endParty();
        return;
      }
      if (o.id === "carpet") { addSan(-1, "カーペットの端をむしって、口に入れた。……繊維が喉に貼りつく。吐き出す。古い水の味が、いつまでも残る。"); return; }
      if (o.id === "kayu") {
        if (S.l10.ate >= 1) { say("もう一杯、よそう。……やめられない。", "warn"); endHarvest(); return; }
        S.l10.ate = 1;
        addSan(3, "");
        say("麦粥を、一杯食べた。温かい。やさしい味。体じゅうが、ゆるむ。（正気 +3）");
        say("……もう一杯、食べたい。とても。", "warn");
        emit("omen");
        return;
      }
      if (o.id === "wheat") { say("麦の穂をしごいて、生のままかじる。ぱさぱさで、味がない。いくら噛んでも、腹は少しもふくれない。"); return; }
      if (!o.food) { say(`${o.name}は、食べられない。`); return; }
      if (!near(o.id)) { say(`ここに${o.name}はない。`); return; }
      o.loc = "gone";
      addSan(2, "");
      say(o.id === "can9" ? "缶詰を、石で叩いて開ける。豆の煮たもの。冷たいが、ちゃんと食べ物の味がする。（正気 +2）" : "銀色の包みを開けて、食べる。ぱさぱさしているが、ちゃんと食べ物の味がする。（正気 +2）");
    },
    press: (o) => {
      if (!need(o, "押す")) return;
      const m = o.id.match(/^sw([1-4])$/);
      if (m) { toggleSwitch(+m[1]); return; }
      if (o.id === "liftbtn") { liftDown(); return; }
      if (o.id === "btn1") { liftTo(1); return; }
      if (o.id === "btn5") { if (S.l5.lift) { say("「5」は、もう光らない。光っているのは「1」だけだ。", "warn"); return; } liftTo(5); return; }
      if (o.id === "btn13") { liftTo(13); return; }
      if (o.id === "bell") {
        sfx("bell");
        say("チン。……誰も来ない。廊下の奥で、どこかの扉が一つ、そっと閉まる音がした。");
        return;
      }
      if (o.id === "vend") {
        if (S.vend) { say("ボタンを押しても、もう何も出てこない。"); return; }
        S.vend = true; O.waterV.loc = "l4a";
        sfx("clang");
        say("ボタンを押す。ごとん、と音がして、取り出し口に灰色の魔法瓶が落ちてきた。");
        return;
      }
      if (o.id === "intercom") {
        sfx("beep");
        say("インターホンを押す。……ノイズ。「名前と、所属を」", "voice");
        say("名前を言おうとして、ことばが出てこない。", "note");
        say("「……記録にない。ここは記事を書いて、しまっておく場所だ。あんたのことは、まだ誰も書いていない。下へ行け」", "voice");
        sfx("static");
        return;
      }
      if (o.id === "switch6") {
        note("mimic");
        sfx("stinger"); emit("flash"); emit("shock2");
        S.q6 = 2; O.switch6.loc = O.beggar6.loc = null;
        hurt(4, "スイッチを入れた。……一瞬だけ、灯りがついた。狭い通路の壁という壁に、こちらを向いた顔が、びっしりと並んでいた。灯りが消える前に、顔たちは、いっせいに口を開けた。");
        return;
      }
      if (o.id === "hound") { hurt(3, "手を伸ばした瞬間、それが跳んだ。"); return; }
      if (["hound11", "balloon8", "balloons11", "rock8", "man9", "chime8", "window4", "sludge", "wretch2", "teeth3", "hound3", "tiny7", "thing7"].includes(o.id)) { VERB_DO.touch(o); return; }
      say(`${o.name}を押しても、何も起きない。`);
    },
    touch: (o) => {
      if (!need(o, "触る")) return;
      const m = o.id.match(/^pipe([new])$/);
      if (m) {
        const cold = S.pipes[S.j] === m[1];
        say(cold ? `${o.name}に触れる。……冷たい。中で何も流れていない。止まった管だ。` : `${o.name}に触れる。熱い。中を、何かがまだ流れている。思わず手を引っこめた。`);
        return;
      }
      if (o.id === "raincoat") { addSan(-1, "触れてしまった。……まだ、少し温かかった。"); return; }
      if (o.id === "faceling") { say("肩に触れる。顔のない人は、びくりと身を引き、それからゆっくり振り向いて、こちらを「見た」。……それから、ホワイトボードのほうを指さした。"); S.facePointed = true; note("faceling"); verify("faceling"); return; }
      if (o.id === "hound") { hurt(3, "手を伸ばした瞬間、それが跳んだ。"); return; }
      if (o.id === "teeth3") { O.teeth3.loc = null; S.smile = null; hurt(4, "手を伸ばした。……歯の列が、手首ごと、腕ごと、広がった。"); note("smiler"); return; }
      if (o.id === "hound3") { S.l3.amb = 0; O.hound3.loc = null; hurt(3, "後ろへ手を伸ばした瞬間、長い髪の何かが、喉もとへ飛びかかってきた。"); note("hound"); return; }
      if (o.id === "tiny7") { hurt(3, "影に手を伸ばした。……影が、こちらに気づいた。水ごと、顎が閉じる。"); note("tiny"); return; }
      if (o.id === "thing7") { hurt(4, "暗闇に手を伸ばした。指先が、何か冷たく、果てしなく大きなものの表面に触れた。"); note("thing"); return; }
      if (o.id === "cake") { VERB_DO.eat(o); return; }
      if (o.id === "sludge") { sfx("spark"); addSan(-2, "黒い泥に、指が触れた。熱い。皮膚が、焼ける匂い。頭の奥が、しびれる。"); return; }
      if (o.id === "wretch2") {
        if (S.l2.gave) { say("毛布の上から、そっと触れる。温かい。眠っている。"); return; }
        addSan(-1, "肩に触れた瞬間、ただれた手が、こちらの手首をつかんだ。爪が、皮膚に食いこむ。「みず」……ようやく、振りほどいた。"); return;
      }
      if (o.id === "angel") { say("冷たい石に触れる。指先から、ふしぎに、落ち着きが広がる。台座の文字は、読めないのに、意味だけは分かる気がした。……分かった気がしただけだ。"); return; }
      if (o.id === "window4") { windowBite(); return; }
      if (o.id === "switch6") { VERB_DO.press(o); return; }
      if (o.id === "seam") { VERB_DO.noclip(); return; }
      if (o.id === "pools" || o.id === "deep" || o.id === "pool11") { say("水に手を入れる。体温と同じ温度。手を引き抜くのが、少し惜しい。"); return; }
      if (o.id === "rock8") { hurt(2, "浮かぶ岩に、指先が触れた。……岩が、ふっと重さを思い出した。頭の上に、降ってくる。"); return; }
      if (o.id === "balloon8" || o.id === "balloons11") { note("balloon"); hurt(3, "風船に触れた瞬間、リボンが腕に巻きついた。ちくり。……腕から肩へ、しびれが広がっていく。"); return; }
      if (o.id === "hound11") { note("hound"); hurt(3, "手を伸ばした瞬間、寝そべっていたハウンドが跳ね起きた。この街でも、手を出されれば、彼らは噛む。"); return; }
      if (o.id === "moths") { note("moth"); hurt(3, "蛾に手を伸ばした。……翅の嵐が、顔に、腕に、まとわりついた。"); return; }
      if (o.id === "mahjong") { addSan(-1, "牌に指が触れた。……上がりの一枚を、どうしても置けない。手が、卓から離れない。ようやく引きはがした。"); return; }
      if (o.id === "man9") {
        if (S.l9.clear) { note("skin"); hurt(4, "男の腕に触れた。……冷たい。皮の下で、何かが、皮とは別の向きに動いた。手首を、つかまれる。"); return; }
        say("男の腕に触れる。温かい。男は顔をしかめた。「触るなよ、痛いんだ」");
        return;
      }
      if (o.id === "chime8") { sfx("chime"); say("石の風鈴に触れる。重く澄んだ音が、洞窟に広がった。……ずっと下のほうから、同じ音が、ひとつ返ってきた。"); return; }
      if (o.id === "lake8") { S.cold += 2; say("指先を水に入れる。痛いほど冷たい。"); return; }
      VERB_DO.examine(o);
    },
    listenTo: (o) => {
      if (o && o.id === "radio") {
        S.radio++;
        sfx("static");
        if (LOOP.n && S.radio % 3 === 0 && LOOP.echo.length) {
          say("（ノイズ）……ワンダラー用の周波数に、勝手に切り替わった。");
          say("自分の声だ。", "note");
          for (const t of LOOP.echo.slice(-3)) say(`「${t}」`, "voice");
          say("いつ言ったのか、覚えていない。", "note");
          return;
        }
        say("（ノイズ）……こちら M.E.G.、基地アルファ。全ワンダラーへ。……装備は、七番。くり返す、七番。……レベル37で、出口の目撃情報。……灯りが消えたら、緑の非常灯へ。……（ノイズ）");
        return;
      }
      if (o && o.id === "sdoor") { VERB_DO.listen(); return; }
      if (o && o.id === "drain") { say("排水口に耳を近づける。……遠くで、車の走る音。誰かの話し声。ずっと遠く。"); return; }
      if (o && o.id === "furnace") { sfx("whisper"); say("焚き口に耳を寄せる。炎の音の奥で、誰かが、何かを数えている。"); return; }
      VERB_DO.listen();
    },
    say: (w) => {
      if (!w) { say("何と言う？"); return; }
      if (w.ja === "わからない") { VERB_DO.dunno(); return; }
      const show = w.show || w.ja;
      if (WATER7.includes(S.loc)) { say(`「${show}」と言おうとして、ことばは泡になって消えた。`); return; }
      say(`「${show}」`, "voice");
      if (S.loc === "lfun") {
        if (w.ja === "はい") { endParty(); return; }
        if (w.ja === "いいえ") { say("「えー、ざんねん =(」……誰も、帰り道を教えてくれない。黄色い人たちが、一歩近づく。"); return; }
        say("「パーティーのこと？　ねえ、パーティーしようよ =)」");
        return;
      }
      if (S.loc === "l3a" && S.ss === 1) {
        S.ssWait = 0;
        note("skin");
        sfx("whisper");
        addSan(-2, `扉の向こうで、声が言った。「${show}」……こちらと、まったく同じ声で。`);
        return;
      }
      if (S.loc === "l4b") {
        S.facePointed = true;
        note("faceling");
        say("顔のない人は、びくりとして、首をかしげた。それから立ち上がり、ホワイトボードに大きく「=)」と描いて、赤いペンでばつ印をつけた。その横に、矢印と「5」。");
        return;
      }
      if (S.loc === "l2c") { say(S.l2.gave ? "眠っている。" : "「みず……たべもの……」ことばは、届いているのか分からない。"); return; }
      if (S.loc === "l2j" && (S.hound === 1)) { hurt(3, "声を出した瞬間、それが跳んだ。"); note("hound"); return; }
      if (S.loc === "l9a") {
        if (S.l9.clear) {
          note("skin");
          addSan(-1, `戸口の男が、こちらとまったく同じ声で言った。「${show}」……まばたきを、しない。`);
          return;
        }
        if (w.ja === "助けて" && !S.l9.gave) {
          S.l9.gave = true;
          O.water3.loc = "player";
          say("「助けてほしいのは、こっちだよ」男は笑って、ポケットからボトルを出した。「半分やる。……半分の瓶は飲むなって言うだろ。でも、おれのは平気だ。畑に出るなら、小道を外れろ。霧には、気をつけな」");
          say("（アーモンド水（三本目）を受けとった）", "note");
          return;
        }
        say({ "誰？": "「……迷子だよ。あんたと同じ。腕は、さっき塀で切った」", "ここはどこ": "「郊外。ずっと夜の。……早く入れ、霧が来る」" }[w.ja] || "「とにかく、入れ」");
        return;
      }
      if (S.loc === "l11c") {
        S.l11.met = true;
        if (w.ja === "はい") { say("隊員は、黙って名簿とペンを差し出した。", "note"); endBeta(); return; }
        if (w.ja === "いいえ") { say("「そうか。じゃあ、地図だけ見ていきな。……見たら、忘れな」"); return; }
        if (w.ja === "助けて") {
          if (O.water4.loc === null) { O.water4.loc = "player"; say("隊員は、棚からボトルを一本、放ってよこした。「一人一本。……あんたが探してるのは、たぶん、地図のどこかにある」" + (S.l1.clothDown ? "\n「……レベル1の布を床に置いてったの、あんたか。ああいうのが、いちばん助かる」" : "")); say("（アーモンド水（四本目）を受けとった）", "note"); return; }
          say("「もう渡した。ここも、余ってるわけじゃない」"); return;
        }
        say({ "誰？": "「M.E.G.、基地ベータ。地図係。……出口の地図を描いてる。自分では、くぐらないけどね」", "ここはどこ": "「Level 11。たいていのレベルは、ここにつながってる。たいていの出口は、片道だ」" }[w.ja] || "隊員は、地図から目を上げない。");
        return;
      }
      if (S.loc === "l11a") { say("声が、ビルの谷間に吸いこまれる。ハウンドが、片耳だけ立てた。"); return; }
      if (S.loc === "l6") {
        if (S.q6 === 1) { say(w.ja === "いいえ" ? "「……どうして」囁きが止まった。それから、また最初から。「ねえ、スイッチを入れて」" : "「誰でもいいでしょう。スイッチを入れて。お願い」"); return; }
        addSan(-1, "声は、暗闇に吸いこまれて、どこにも反響しない。……すぐそばで、誰かが、同じことばを囁いた。");
        sfx("whisper");
        return;
      }
      if (S.loc === "l0") { say("声は、壁紙に吸われて消えた。……ここでは、誰にも届かない。孤立効果、と手引きには書いてあった気がする。"); return; }
      say("……返事はない。蛍光灯のうなりだけが、少し大きくなった気がする。");
    },
    lookback: () => {
      if (S.loc === "lrun") return;
      if (S.l3.amb === 1 && LV() === "3") { ambushSafe("振り向く。"); return; }
      if (S.loc === "l2j" && S.hound === 1) { hurt(3, "振り向いた瞬間、背中を見せた側から、それが跳んだ。"); return; }
      if (S.loc === "l0") { say("振り向く。今来た部屋は、もう別の部屋になっている。" + (S.l0.kind === "arch" ? "……いや、この部屋だけは、そのままだ。" : "")); return; }
      if (S.loc === "l1a" && O.crate.loc === null && !S.l1.crateGone) { crateAppear(); return; }
      if (S.loc === "l11a") { say("振り向く。……路肩の車が、どれも、少しずつ位置を変えていた。見ていないあいだに。"); return; }
      if (S.loc === "l9a") { say("振り向く。……さっき通ったはずの家と、そっくり同じ家が、二軒並んでいる。"); return; }
      if (S.loc === "l2v") { say("振り向く。戸口の光は、まだそこにある。……南だ。"); return; }
      say("振り向く。誰もいない。……振り向く前は、いた気がする。");
    },
    sleep: () => {
      if (LV() === "37") { S.calm += 1; say("白いタイルに横になる。水の音。……少しだけ眠った。何か大切なことを、夢の中に置いてきた気がする。"); return; }
      if (S.loc === "l0" && S.l0.kind === "arch") {
        if (S.l0.archRest) { say("もう眠れない。うなりが、まぶたの裏まで届く。"); return; }
        S.l0.archRest = true;
        addSan(2, "");
        say("アーチの縁に体を丸めて、進む方角に顔を向けて眠る。……短い夢。目を覚ますと、部屋は、そのままだった。（正気 +2）");
        haunt(pick(["眠る", "黄色", "ここはどこ"]));
        return;
      }
      if (S.loc === "l433") {
        say("カプセルに潜りこみ、ブラインドを下ろす。布団は、ちょうど体温と同じ温度。……眠った。");
        gap();
        S.l0.seam = true; S.l0.steps = 0; O.seam.loc = "l0"; S.l0.kind = ""; S.l0.redN = 0;
        say("……目を覚ますと、カーペットの上だった。黄色。うなり。東の壁が、ちらついている。", "note");
        enter("l0");
        flicker(3);
        return;
      }
      if (LV() === "8") { addSan(-3, "濡れた岩に横になる。まぶたが重い。……目を閉じたら、もう開かない気がした。飛び起きる。体が、氷のようだ。"); return; }
      if (S.loc === "l10b" || S.loc === "l10c") {
        if (S.l10.slept >= 1) { endHarvest(); return; }
        S.l10.slept = 1;
        say("藁に横になる。……とても、気持ちがいい。目を閉じかけて、なぜか、はっと起き上がった。", "warn");
        emit("omen");
        return;
      }
      if (LV() === "10") { addSan(-2, "麦のあいだの土に横になる。……土の下で、何かが、もぞもぞと動いた。たくさん。背中の下を、這っている。飛び起きた。"); return; }
      say("こんな場所では、眠れない。");
    },
    down: () => go("d"),
    up: () => go("u"),
    // たどる：矢印・小道・轍・標識・男など、向きのあるものについていく
    follow: (o) => {
      if (!need(o, "たどる")) return;
      const m = o.id.match(/^arrow_(\w+)$/);
      if (m) { go(S.l11.dirs[m[1]]); return; }
      if (o.id === "path9") { go("n"); return; }
      if (o.id === "ruts") { go(S.l10.walk >= 2 ? S.l10.fork : "n"); return; }
      if (o.id === "marker8") { if (!lightOn()) { say("暗くて、矢印の向きが分からない。"); return; } go(S.c8.route[S.c8.step]); return; }
      if (o.id === "man9") { enterHouse(S.l9.side); return; }
      if (o.id === "sign9") { say("標識の矢印をたどって歩く。……矢印は、見るたびに違う方を指している。同じ交差点に戻ってきた。"); return; }
      if (o.id === "balloon8" || o.id === "balloons11") { VERB_DO.touch(o); return; }
      if (o.id === "pipes1") { say("目を配管から離さずに、北へ歩く。配管は、ちゃんと近づいてくる。"); go("n"); return; }
      if (o.id === "exitlight") { say("緑の非常灯から目を離さずに、東へ。"); go("e"); return; }
      if (o.id === "doorway2") { go("s"); return; }
      if (o.id === "rope") { go(S.loc === "l7b" ? "u" : "d"); return; }
      if (o.id === "cave7") { go("d"); return; }
      say(`${o.name}は、たどれるものではない。`);
    },
    // 小道を外れる／バリケードを越える（命令を作るには出てこない言い方）
    leave: (o) => { if (S.loc === "l9y") { go(pick(["e", "w"])); return; } say("外れる道が、ない。"); },
    cross: (o) => { if (S.loc === "l11x") { crossBarricade(); return; } say("越えられるものが、ない。"); },
  };
  // 補給の木箱は、背中を向けたときに現れる
  function crateAppear() {
    O.crate.loc = "l1a";
    say("振り向く。……通路の真ん中に、木箱が置かれていた。さっきまで、なかった。側面にステンシルで「補給」。", "note");
    sfx("thud");
  }
  function ssLine() {
    const lines = ["「おい、開けてくれ。M.E.G. の者だ。仲間とはぐれた。基地ガンマへ戻りたい」", "「頼む。ここは暗いんだ。暗いのは嫌なんだ」", "「……ねえ、きみの名前、なんだっけ。呼びたいんだ」", "「開けて。開けてよ。開けて」"];
    return lines[S.ssLine++ % lines.length];
  }

  // ---- 手が進むたびに起きること ----
  const META = ["hint", "help", "inventory", "look", "dunno"];
  function after(v) {
    if (S.done || S.broken || META.includes(v)) return;
    const lv = LV();
    // 懐中電灯の電池
    if (S.light && held("flashlight") && lv !== "6" && S.bat > 0) {
      S.bat = Math.max(0, S.bat - (lv === "8" ? 6 : 3));
      if (S.bat === 0) { S.light = false; say("懐中電灯が、ふっと消えた。電池が切れた。", "warn"); sfx("beep"); }
    }
    // レベル0：うなりの急な高まりの中で、立ち止まっている
    if (S.loc === "l0" && S.l0.spike && v !== "go" && v !== "run") {
      addSan(-1, "耳の奥が、うなりで焼けるように痛む。");
      if (S.broken || S.done) return;
    }
    // レベル1：木箱は、背中を向けたときに現れる／灯りが消える
    if (S.loc === "l1a" && O.crate.loc === null && !S.l1.crateGone) {
      S.l1.crateT++;
      if (S.l1.crateT === 2) { say("背中のほうで、ことり、と、木の箱を床に置くような音がした。", "note"); sfx("thud"); }
      else if (S.l1.crateT >= 4) crateAppear();
    }
    if (lv === "1") {
      if (S.blk > 0) {
        S.blk--;
        if (S.blk === 0) { S.blkDone = true; flicker(3); say("……照明が、一本ずつ戻ってきた。床の水たまりに、とても大きな足跡が残っている。足跡は、こちらのすぐ横を通っていた。", "note"); }
        else { say("暗闇の中を、何かが通りすぎていく。床の水が、はねる音。天井の通気口が、かたかたと鳴る。", "warn"); sfx("scratch"); }
      } else if (S.blkArmed && !S.blkDone && v !== "take" && S.loc === "l1a") {
        S.blkArmed = false;
        S.blk = 2;
        gap();
        flicker(4);
        emit("blackout");
        say("照明が、ちらついて、いっせいに消えた。", "warn");
        say("東の扉の上で、緑の非常灯だけが、かすかに光っている。遠くで、何か大きなものが、水たまりを踏む音。近づいてくる。");
        sfx("stinger");
      }
    }
    // レベル2：暑さ
    if (lv === "2" && S.loc !== "l2c" && S.loc !== "l2v") { S.heat++; if (S.heat % 5 === 0) addSan(-1, "暑さで、頭がぼんやりする。"); }
    if (S.loc === "l5d") addSan(-1, "熱気で、息が苦しい。");
    if (S.broken || S.done) return;
    // レベル3：扉の向こうの声と、背後から来るもの
    if (lv === "3" && S.ss === 1) {
      S.ssWait++;
      if (S.ssWait >= 5) {
        S.ss = 2;
        if (S.loc === "l3a") { say("扉の向こうの声が、急に、こちらの声になった。「……じゃあね」", "warn"); say("足音が、扉の向こうの、もっと向こうへ遠ざかっていく。"); sfx("whisper"); }
        else say("廊下のほうで、扉を叩く音が、ぴたりと止んだ。", "note");
        note("skin"); verify("skin");
      } else if (S.loc === "l3a" && v !== "listen") { say(ssLine(), "voice"); if (S.ssWait % 2) sfx("knock"); }
    }
    if (lv === "3") {
      S.l3.t++;
      if (S.l3.amb === 1 && v !== "lookback") {
        S.l3.amb = 0; O.hound3.loc = null; S.l3.t = 0;
        note("hound");
        hurt(3, "背後から、長い髪の何かが飛びかかってきた。爪が、背中に食いこむ。");
        return;
      }
      if (S.l3.amb === 0 && S.l3.t >= 5 && S.loc !== "l3s" && !S.smile && S.ss !== 1) {
        S.l3.amb = 1; O.hound3.loc = S.loc;
        gap();
        say("背後で、爪がレンガを擦る音。荒い息。……すぐ後ろに、何かいる。", "warn");
        sfx("scratch"); sfx("breath");
      }
    }
    // スマイラー
    if (S.smile && S.loc === "l3b") {
      if (lightOn()) {
        if (S.smile.warn && v !== "lighton") { S.light = false; O.teeth3.loc = null; sfx("stinger"); hurt(4, "灯りの中で、歯の列が、こちらへ跳んだ。"); return; }
        S.smile.warn = true;
        if (v !== "lighton") say("歯の列が、灯りのほうを向いた。", "warn");
      } else if (S.smile.t < 0) S.smile.t = 0;
      else if (v !== "lightoff") {
        S.smile.t++;
        if (S.smile.t >= 2) {
          S.smile = null; O.teeth3.loc = null; verify("smiler");
          say("歯の列が、ゆっくり、暗闇に溶けていった。……非常灯が、赤く点いた。", "note");
        } else say("息を止める。歯の列は、まだ、そこに浮かんでいる。");
      }
    }
    // レベル5：曲と視線
    if (lv === "5") S.song++;
    if (S.loc === "l5c" && S.song % 5 === 3) { say("曲が終わった。蓄音機の針が、ひとりでに上がる。誰もいない席から、まばらな拍手。", "note"); }
    if (S.loc === "l5c" && S.song % 5 === 0) say("蓄音機の針が、また降りた。次の曲が始まる。", "note");
    if (S.loc === "l5b") {
      S.watched++;
      if (S.watched % 4 === 0) addSan(-1, pick(["肖像画の視線が、首の後ろに刺さる。", "誰もいないのに、肩を、とん、と叩かれた。", "壁紙の顔が、一つ、こちらを向いた。"]));
      else if (S.watched % 4 === 2 && Math.random() < 0.5) { say("暗い客室の隙間から、灰色の翅が一枚、ひらりと出てきて、また戻った。", "note"); sfx("scratch"); }
    }
    if (S.loc === "l5e" && S.l5.lift) {
      if (v === "press") { /* ボタンを押した手は、liftTo が扱う */ }
      else {
        S.l5.lift = 0;
        sfx("stinger"); flicker(4);
        hurt(4, "表示の数字が、数字でなくなった。扉が開く。……そこには、床がなかった。");
        return;
      }
    }
    if (S.broken || S.done) return;
    // レベル7：息・影・真夜中の何か
    const fresh7 = S.l7.fresh; S.l7.fresh = false;
    if (WATER7.includes(S.loc)) {
      if (S.l7.tiny > 0 && S.loc === S.l7.tinyAt && !fresh7) {
        if (["wait", "examine", "listen", "listenTo"].includes(v)) {
          S.l7.tiny--;
          if (S.l7.tiny === 0) { S.l7.tinyDone = true; O.tiny7.loc = null; note("tiny"); verify("tiny"); say("影が、ゆっくり遠ざかっていった。水が、また静かになる。", "note"); }
          else say("動かない。息も、止める。影は、まだ真下を通っている。", "warn");
        }
      }
      if (S.l7.thing > 0 && S.loc === "l7e" && !fresh7) {
        if (lightOn()) thingFlee();
        else if (["wait", "listen", "listenTo", "examine"].includes(v)) {
          S.l7.thing++;
          if (S.l7.thing >= 3) { S.l7.thing = 0; S.l7.thingDone = true; O.thing7.loc = null; note("thing"); verify("thing"); say("……何かが、すぐ横を、とても長い時間をかけて通りすぎていった。水が、元に戻る。", "note"); }
          else addSan(-1, "息を殺す。冷たい水の壁が、ゆっくり押してくる。目の前を、何かの表面が、果てしなく流れていく。");
          if (S.broken || S.done) return;
        }
      }
      if (WATER7.includes(S.loc)) {
        S.l7.air--;
        if (S.l7.air === 3) { say("胸が焼ける。息が、もうすぐ続かない。", "warn"); sfx("breath"); }
        else if (S.l7.air === 1) { say("目の前が、暗くなっていく。上へ――", "warn"); sfx("heart"); }
        else if (S.l7.air <= 0) {
          S.l7.air = 9; S.l7.tiny = 0; S.l7.thing = 0; O.tiny7.loc = O.thing7.loc = null;
          say("息が、切れた。……気がつくと、海面に浮かんで、咳きこんでいた。", "warn");
          sfx("splash");
          S.loc = "l7b";
          addSan(-2, "");
          if (S.broken || S.done) return;
          describe(true);
        }
      }
    }
    if (S.loc === "l7b" && !S.l7.rope) { S.l7.cold7 = (S.l7.cold7 || 0) + 1; if (S.l7.cold7 % 4 === 0) addSan(-1, "冷たい水が、体温を奪っていく。部屋へ戻る手段がない。"); }
    // レベル37：落ち着きすぎる
    if (lv === "37") {
      if (S.san < 10) S.san++;
      if (v === "wait" || v === "sleep" || v === "sit") S.calm++;
      if (S.calm >= 5) { endSublime(); return; }
      if (S.calm >= 3 && !S.seen.calm3) { S.seen.calm3 = true; say("帰りたい理由を、ひとつ、思い出せなくなった。", "warn"); }
    }
    // レベル8：寒さと蛾
    if (lv === "8" && !S.coat) {
      S.cold++;
      if (S.cold % 5 === 0) { addSan(-1, S.cold >= 10 ? "歯の根が合わない。指先の感覚が、もうない。" : "寒い。濡れた服が、体温を奪っていく。"); if (S.broken || S.done) return; }
    }
    if (S.loc === "l8r" && S.c8.mothOn > 0) {
      if (S.c8.mothFresh) S.c8.mothFresh = false;
      else if (lightOn()) { note("moth"); S.light = false; sfx("scratch"); hurt(3, "灯りに、羽音が殺到した。翅が顔を叩き、銀色の粉で息ができない。懐中電灯が、手から落ちる。"); return; }
      else {
        S.c8.mothOn--;
        note("moth");
        if (!S.c8.mothOn) verify("moth");
        say(S.c8.mothOn ? "羽音が、頭のすぐ上を通りすぎていく。銀色の粉が、髪に積もる。息を殺す。" : "羽音が、遠ざかっていった。銀色の粉だけが、床に残っている。", S.c8.mothOn ? "warn" : "note");
        syncCave();
      }
    }
    // レベル9：街灯と霧
    if (lv === "9") {
      S.l9.tick++;
      if (S.loc === "l9a" && lamp9()) { say("街灯が、じじ、と鳴って、一瞬だけ点いた。", "note"); flicker(1); }
    }
    if (S.loc === "l9a") {
      if (S.l9.fog === 2) { S.l9.fog = 0; sfx("stinger"); hurt(3, "霧が、腰まで来た。霧の中から、関節の多すぎる腕が、何本も伸びてくる。ねじれた指が、口の中に入ってくる。"); return; }
      if (S.l9.fog === 1) { S.l9.fog = 2; emit("omen"); sfx("breath"); say("霧が、足首まで来た。霧の中で、何かがもつれ合いながら、こちらへ這ってくる。……通りにいてはいけない。", "warn"); }
      else if (S.l9.st >= 2 && Math.random() < 0.25) { S.l9.fog = 1; emit("omen"); sfx("whisper"); say("道の端から、白い霧が這い寄ってくる。霧の中で、何かがもつれ合うように動いている。", "warn"); }
      S.l9.st++;
    } else if (lv === "9") { S.l9.fog = 0; S.l9.st = 0; }
    // レベル10：時間の感覚がなくなる
    if (lv === "10") {
      S.l10.t++;
      if (S.l10.t >= 10 && S.l10.t % 4 === 2) { addSan(-1, "空の明るさが、少しも変わらない。どれだけ時間がたったのか、分からなくなってきた。"); if (S.broken || S.done) return; }
    }
    // レベル11：基地ベータの隊員と、電線の灰色の人影
    if (S.loc === "l11c" && !S.l11.met) {
      S.l11.met = true;
      say("隊員が、地図から顔を上げた。「新顔か。……残るなら、名簿に名前を。地図係が足りないんだ」", "voice");
    }
    if (S.loc === "l11a" && S.l11.wire > 0) {
      if (S.l11.wireFresh) S.l11.wireFresh = false;
      else {
        S.l11.wire--;
        if (S.l11.wire) say("灰色の人影が、目のない顔を左右に振っている。すぐ近くで。息を、止める。", "warn");
        else { S.l11.wireDone = true; verify("wire"); say("灰色の人影は、するすると電線の束に戻っていった。柱の引っかき傷だけが残っている。", "note"); }
      }
    }
    // レベル433 N：水も食べ物もない
    if (S.loc === "l433") {
      S.h433++;
      if (S.h433 % 3 === 0) { addSan(-1, "喉が渇く。ここには、水も、食べ物もない。"); if (S.broken || S.done) return; }
    }
    // レベル Fun：留まるほど、輪が狭まる
    if (S.loc === "lfun") {
      S.funWait++;
      if (S.funWait >= 6) { say("黄色い人たちの輪が、肩に触れるほど狭まった。誰かが、ケーキを口元に差し出す。", "warn"); endParty(); return; }
      if (S.funWait >= 2) say(["", "", "黄色い人たちが、一歩近づいた。=)", "輪が、また狭まる。音楽が、さらに大きくなる。", "誰かが、手をつないできた。", "顔のすぐそばで、描いた笑顔が笑う。=)"][S.funWait], "warn");
    }
  }
  // 赤い廊下では、正しい方向に動くこと以外、すべてが遅れになる
  function runStep(p) {
    const d = S.runDirs[S.run];
    const ok = (p.v === "go" && p.dir === d) || (p.v === "run" && d === "n") || (S.run >= 5 && p.v === "go" && p.dir === "n") || (S.run >= 5 && p.v === "run");
    if (!ok) {
      const what = p.v === "go" ? `${DIR_JA[p.dir] || ""}へ行こうとして、壁にぶつかった。` : "一瞬、足が止まった。";
      note("!");
      hurt(3, what + "……すぐ後ろまで来ていた何かに、肩を掴まれた。");
      return;
    }
    if (S.run >= 5) {
      say("緑色の「非常口」の扉に体当たりする。扉が開き、その先へ転がりこむ。");
      say("扉が閉まる。警報が、ぷつりと止んだ。……夜の空気。信号機の切り替わる音。");
      gap();
      note("!");
      enter("l11a");
      return;
    }
    S.run++;
    say(pick(["走る。息が焼ける。", "角を曲がる。足音が、すぐ後ろに。", "走る。非常灯の赤が、壁を流れていく。", "転びかけて、踏みとどまる。走る。"]));
    describe(true);
  }

  // ---- 命令を読む ----
  const EN_SIMPLE = [
    ["look", /^(look|l)$/], ["inventory", /^(inventory|i)$/], ["wait", /^(wait|z)$/], ["hint", /^hint$/], ["help", /^help$/],
    ["listen", /^listen$/], ["noclip", /^noclip$/], ["dunno", /^(dunno|i don'?t know)$/], ["run", /^run$/], ["row", /^(row|swim)$/],
    ["sleep", /^sleep$/], ["lookback", /^look back$/], ["down", /^(descend|climb down)$/], ["up", /^(ascend|climb up)$/],
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
    for (const w of WORDS) for (const a of [w.ja, ...(w.alt || [])]) { const k = a.replace(/[？?、]/g, ""); if (k && k.length > len && s.includes(k)) { best = w; len = k.length; } }
    return best;
  }
  function parseEn(cmd) {
    cmd = cmd.toLowerCase().replace(/\s+/g, " ").trim();
    for (const [v, rx] of EN_SIMPLE) if (rx.test(cmd)) return { v };
    const g = cmd.replace(/^go /, "");
    if (DIR_WORDS[g]) return { v: "go", dir: DIR_WORDS[g] };
    const sm = cmd.match(/^say (.+)$/);
    if (sm) return { v: "say", w: findWord(sm[1]) };
    const pats = [
      ["put", /^(?:put|insert) (.+) (?:in|into) (.+)$/], ["put", /^(?:put|insert) (.+)$/],
      ["open", /^open (.+)$/], ["close", /^(?:close|shut) (.+)$/], ["lighton", /^(?:light|turn on|switch on) (.+)$/],
      ["lightoff", /^(?:douse|turn off|switch off) (.+)$/], ["drink", /^drink (.+)$/], ["eat", /^eat (.+)$/], ["press", /^(?:press|push|flip|ring) (.+)$/],
      ["touch", /^(?:touch|feel) (.+)$/], ["listenTo", /^listen (?:to )?(.+)$/],
      ["examine", /^(?:examine|x|look at|stare at) (.+)$/], ["read", /^read (.+)$/], ["follow", /^follow (.+)$/],
      ["give", /^give (.+) to (.+)$/], ["give", /^give (.+)$/], ["tie", /^tie (.+?)(?: to (.+))?$/],
      ["take", /^(?:take|get|pick up) (.+)$/], ["drop", /^drop (.+)$/],
    ];
    for (const [v, rx] of pats) { const m = cmd.match(rx); if (m) return { v, a: m[1], b: m[2] }; }
    return null;
  }
  // 先に当たったものを動詞にする。物の名前の部分は伏せてから探すので、名前の中の字は動詞にならない
  const JA_VERBS = [
    ["noclip", /すり抜け|通り抜け|ノークリップ/], ["dunno", /わからな|分からな/], ["leave", /外れ|それる/], ["cross", /越え|乗り越え|くぐる/],
    ["follow", /たどる|辿る|たどって|ついて行|ついてい|従う/],
    ["say", /と言う|って言う|と言って|と答え|を言う|と叫ぶ|と呟く|と口にする|言う$/],
    ["lookback", /振り向|振り返|ふりむ|ふりかえ|後ろを見/], ["run", /走る|走って|駆け/], ["row", /漕ぐ|漕いで|こぐ|泳ぐ|泳いで/],
    ["tie", /結ぶ|結んで|結わえ|垂らす/], ["give", /渡す|渡して|あげる|分ける|与え/],
    ["sleep", /寝る|眠る|寝て|横になる/], ["up", /上る|登る|上がる|のぼる/], ["down", /降りる|おりる|下りる|降りて|潜る/],
    ["touch", /触る|触れる|触って|さわる|なでる/], ["eat", /食べる|食べて|食う|かじる/], ["drink", /飲む|飲んで|飲み/],
    ["lighton", /点ける|つける|点灯|点けて/], ["lightoff", /消す|消して|消灯/],
    ["press", /押す|押して|押した|鳴らす|上げる|下げる/],
    ["listenTo", /聞く|聴く|聞いて|耳をすま|耳を澄ま/], ["close", /閉める|閉じる|閉めて|しめる/],
    ["open", /開け|開く|入る|乗る/], ["put", /入れ|差す|差し|挿す|替え/], ["read", /読/], ["examine", /調べ|見る|眺め|見つめ|覗|にらむ/],
    ["take", /取|拾|持つ/], ["drop", /置/],
  ];
  const JA_DIRS = { "北": "n", "南": "s", "東": "e", "西": "w", "上": "u", "下": "d" };
  const OBJLESS = ["dunno", "noclip", "run", "row", "sleep", "lookback", "down", "up", "leave", "cross"];
  const SIMPLE = { "見る": "look", "周りを見る": "look", "見回す": "look", "持ち物": "inventory", "待つ": "wait", "ヒント": "hint", "遊び方": "help", "ヘルプ": "help",
    "すり抜ける": "noclip", "耳をすます": "listen", "耳を澄ます": "listen", "聞く": "listen", "わからない": "dunno", "分からない": "dunno",
    "走る": "run", "漕ぐ": "row", "泳ぐ": "row", "寝る": "sleep", "潜る": "down", "振り向く": "lookback", "振り返る": "lookback", "降りる": "down", "上る": "up" };
  function parseJa(t) {
    const s = t.replace(/[\s　。！？!?、「」『』]/g, "");
    if (!s) return null;
    const dm = s.match(/^(北|南|東|西|上|下)(へ|に)?(行く|進む|いく|移動|行って|進んで|出る|降りる|おりる|登る|上がる|上る|る|走る)?(ください)?$/);
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
    if (verb === "say") return { v: "say", w: findWordIn(objPart), raw: true };
    // 名前の頭は、文の頭か助詞のすぐあとにあるものだけを数える
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
    if (!hits.length && objPart && !["listenTo", "lighton", "lightoff"].includes(verb)) {
      const m = objPart.match(/^(.+?)(を|に|へ|で|の|と)/);
      return { v: verb, ao: { missing: m ? m[1] : objPart }, bo: null, raw: true };
    }
    const uniq = hits.filter(h => !hits.some(k => k !== h && k.i <= h.i && k.end >= h.end && (k.end - k.i) > (h.end - h.i)));
    uniq.sort((x, y) => x.i - y.i);
    const after1 = h => objPart.slice(h.end, h.end + 1);
    const a = uniq.find(h => after1(h) === "を") || uniq.find(h => after1(h) === "の") || uniq[0];
    const b = uniq.find(h => h !== a);
    return { v: verb, ao: a ? a.o : null, bo: b ? b.o : null, raw: true };
  }

  function act(input, label) {
    if (S.done) { say("ここで、終わっている。いちばん下の「はじめから」で、最初から。", "note"); return; }
    const ascii = /^[\x20-\x7e]*$/.test(input);
    const p = ascii ? parseEn(input) : parseJa(input);
    if (!p) { say("その言い方はわからない。「命令を作る」を使うと確実だ。"); return; }
    S.moves++;
    S.broken = false;
    if (label && !META.includes(p.v)) { S.hist.push(label); if (S.hist.length > 30) S.hist.shift(); }
    // 灯りの消えた広間で、緑の非常灯のほうへ壁づたいに歩くのは、よい
    if (S.loc === "l1a" && S.blk > 0 && p.v === "go" && p.dir === "e") {
      S.blk = 0; S.blkDone = true;
      say("緑の非常灯から目を離さずに、壁に指を這わせて、一歩ずつ東へ。……背中のすぐ後ろを、大きなものが通りすぎた。扉を押す。", "note");
      enter("l1b");
      flicker(2);
      say("……扉の向こうで、照明が、一本ずつ戻ってくる音がした。", "note");
      return;
    }
    if (LV() === "1" && S.blk > 0 && (p.v === "go" || p.v === "run")) {
      S.blk = 0; S.blkDone = true;
      sfx("stinger");
      hurt(3, "暗闇の中で、一歩踏み出した。……肩を、大きな手に掴まれた。");
      return;
    }
    if (S.loc === "lrun" && !META.includes(p.v)) { runStep(p); return; }
    // レベル7：影が真下を通るあいだ／真夜中の何かが向きを変えたあとで、動く
    if (S.l7.tiny > 0 && S.loc === S.l7.tinyAt && !META.includes(p.v) && !["wait", "examine", "listen", "listenTo"].includes(p.v)) {
      S.l7.tiny = 0; O.tiny7.loc = null; note("tiny");
      sfx("stinger");
      hurt(3, "水をかいた瞬間、真下の影が、止まった。……巨大な顎が、下から、水ごと閉じた。");
      return;
    }
    if (S.l7.thing > 0 && S.loc === "l7e" && !lightOn() && !META.includes(p.v) && !["wait", "lighton", "listen", "listenTo", "examine"].includes(p.v)) {
      S.l7.thing = 0; O.thing7.loc = null; note("thing");
      sfx("stinger");
      hurt(4, "暗闇で、何かが口を開けた。水ごと、吸いこまれる――");
      return;
    }
    // レベル6の「ものまね」：声を出す・走ると、寄ってくる
    if (S.loc === "l6" && S.mim === 1 && (p.v === "say" || p.v === "run")) {
      S.mim = 2; note("mimic"); sfx("whisper");
      hurt(3, "音を立てた瞬間、暗闇じゅうの声が、ぴたりと止んだ。……それから、こちらの声で、いっせいに笑った。何本もの手が、口をふさぐ。");
      return;
    }
    // 灰色の人影がいるあいだは、動いても、声を出しても、物音を立ててもいけない
    if (S.loc === "l11a" && S.l11.wire > 0 && !S.l11.wireFresh && !["wait", "look", "listen", "listenTo", "inventory", "examine", "read", "lookback", "help"].includes(p.v)) {
      S.l11.wire = 0; S.l11.wireDone = true;
      note("wire");
      hurt(3, "物音を立てた瞬間、目のない顔が、まっすぐこちらを向いた。細い灰色の腕が、電線のように首に巻きつく。");
      return;
    }
    if (p.v === "go") { go(p.dir); after("go"); return; }
    if (p.v === "say") { VERB_DO.say(p.w); after("say"); return; }
    let a = p.ao, b = p.bo;
    if (!p.raw) { a = p.a ? findObj(p.a) : null; b = p.b ? findObj(p.b) : null; }
    for (const x of [a, b]) if (x && x.missing) { say(isDark() ? "暗くて、何も見えない。" : `ここに「${x.missing}」は見当たらない。`); return; }
    VERB_DO[p.v](a, b);
    after(p.v);
  }

  function submit(label, en) {
    label = String(label || "").trim();
    const cmd = en || label;
    if (!cmd) return;
    if (rows.length > 600) rows = rows.slice(-400);
    turnStart = rows.length;
    flashed = false;
    fxq = [];
    gap();
    push({ t: "cmd", ja: label || cmd, en: en && en !== label ? en : "" });
    act(cmd, label || cmd);
    writeSaved(snapshot());
  }

  // ---- 命令を作る ----
  // [ボタンの文字, 英語の型, 日本語の型]。% は1つ目の物、# は2つ目の物。% がなければ物を選ばずにそのまま送る。「言う」はことばを選ぶ
  const VERBS = [
    ["調べる", "examine %", "%を調べる"], ["読む", "read %", "%を読む"], ["取る", "take %", "%を取る"],
    ["置く", "drop %", "%を置く"], ["入れる", "put % in #", "%を#に入れる"], ["開ける", "open %", "%を開ける"],
    ["閉める", "close %", "%を閉める"], ["押す", "press %", "%を押す"], ["触る", "touch %", "%に触る"],
    ["点ける", "light %", "%を点ける"], ["消す", "douse %", "%を消す"], ["飲む", "drink %", "%を飲む"],
    ["食べる", "eat %", "%を食べる"], ["聞く", "listen to %", "%に耳をすます"], ["言う", "say %", "「%」と言う"],
    ["走る", "run", "走る"], ["泳ぐ", "swim", "泳ぐ"], ["振り向く", "look back", "振り向く"],
    ["寝る", "sleep", "寝る"], ["たどる", "follow %", "%をたどる"], ["渡す", "give % to #", "%を#に渡す"], ["結ぶ", "tie %", "%を結ぶ"],
  ];

  // ---- 起動 ----
  function intro() {
    say("ノークリップ", "title");
    gap();
    if (LOOP.n) {
      say("また、床が、ほんの一瞬だけ、なかった。");
      say("……湿ったカーペットの匂い。この匂いを、知っている。");
    } else {
      say("床が、ほんの一瞬だけ、なかった。");
      say("……湿ったカーペットの匂い。黄色。うなりつづける蛍光灯。");
      say("さっきまで、どこにいたのか、思い出せない。足もとの床だけが、まだ、なかったときの感じを覚えている。");
    }
    gap();
    describe(true);
    say("―― Level 0「しきい」", "note");
  }
  function start(fresh) {
    rows = [];
    fxq = [];
    LOOP = loadLoop();
    LOOP_AFTER = null;
    const saved = fresh ? null : loadSaved();
    if (saved && restore(saved)) {
      rows = (saved.log || []).slice();
      turnStart = rows.length;
      gap();
      say("（前回の続きから）", "note");
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
    rows: () => rows,
    turnStart: () => turnStart,
    turn: () => rows.slice(turnStart),
    pastCommands: n => rows.slice(0, turnStart).filter(r => r.t === "cmd").slice(-n).map(r => r.ja),
    flashed: () => flashed,
    // 演出のきっかけ（直前の手で起きたこと）。[{ type, k }]
    fx: () => fxq.slice(),
    // 起動画面に渡す要約
    meta: () => {
      const L = LOOP_AFTER || LOOP;
      const r = L.deep || 0;
      const name = Object.keys(DEPTH).filter(k => DEPTH[k] <= r).sort((a, b) => DEPTH[b] - DEPTH[a])[0] || "0";
      return { endings: (L.ends || []).slice(), total: ENDINGS.length, deepest: "Level " + name, runs: L.n || 0 };
    },
    visible: () => visible().map(o => ({ id: o.id, name: o.name, en: o.en, held: o.loc === "player" })),
    wordsHere: () => wordsHere().map(w => ({ ja: w.ja, show: w.show || w.ja, en: w.en })),
    // テスト用：今の状態を覗く
    peek: () => S,
  };
}
