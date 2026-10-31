// house.js — 『蔵守』の世界：柏木家の母屋・庭・蔵。
"use strict";

Kura.define(w => {
  const room = (id, d) => w.room(id, d);
  const item = (id, name, words, d) => w.item(id, Object.assign({ name, words }, d));

  w.set("start", "gate");
  w.set("title", "蔵守");

  // ------------------------------------------------------------------
  // 手もとにあるもの
  // ------------------------------------------------------------------
  item("techo", "手帳", ["手帳", "メモ帳", "ノート"], {
    loc: "held", take: true,
    desc: "仕事用の小さな手帳。気づいたことを、ここに書きとめておくことにしている。",
    text: g => {
      const n = g.S.notes;
      return n.length ? "書きとめたこと：\n" + n.map((x, i) => (i + 1) + ". " + x.text).join("\n") : "まだ、何も書いていない。";
    },
    on: { use: g => { g.act("notes"); return true; } },
  });
  item("sumaho", "スマートフォン", ["スマホ", "スマートフォン", "携帯"], {
    loc: "held", take: true,
    desc: g => g.flag("sumahoDead") ? "画面は真っ暗なまま、点かない。" : "電池の表示が、赤い。残りは、ほんのわずか。",
    on: {
      use: g => {
        if (g.flag("sumahoDead")) { g.say("何度押しても、点かない。"); return true; }
        g.set("sumahoDead");
        g.say("画面が点いた。圏外。電池は 3%。\n時刻を確かめる間もなく、画面は暗くなった。\n坂の途中で降ろされたバス停の名前が、頭に浮かぶ。本数は、一日に三本だった。");
        return true;
      },
    },
  });
  item("onigiri", "おにぎり", ["おにぎり", "おむすび", "握り飯"], {
    take: true, desc: "海苔のしめった、大きなおにぎり。まだ、あたたかい。",
    on: {
      use: g => {
        g.move("onigiri", null);
        g.say("おにぎりを食べた。塩がきいている。どこか、水のにおいがした。", "sub");
        g.dread(-2);
        return true;
      },
    },
  });

  // ------------------------------------------------------------------
  // 門前・前庭
  // ------------------------------------------------------------------
  room("gate", {
    name: "門前", indoor: false, moon: true,
    desc: g => "山あいの集落のいちばん上、坂の途中に、柏木の家はある。石の門柱に、傾いた表札。門の奥に瓦屋根の母屋、そのさらに奥の屋根の向こうに、白壁の蔵の棟が見える。\n坂の下へ、集落の屋根が点々と続いている。空気が、湿っている。" +
      (g.night() ? "\n夜の坂は、墨を流したように暗い。集落の灯りは、ひとつも見えない。" : ""),
    exits: { n: "maeniwa", s: "michi" },
    listen: "沢の音がする。ふだんより、近い。",
  });
  item("monchu", "石の門柱", ["門柱", "石", "門"], {
    loc: "gate", scenery: true,
    desc: "苔が、下から三十センチほどだけ黒ずんでいる。ここまで水が上がった跡のようにも見えるが、ここは坂の上だ。",
  });
  item("hyosatsu", "表札", ["表札", "名札"], {
    loc: "gate", scenery: true,
    desc: g => {
      g.clue("hyosatsu", "表札の「柏木」の下に、消えかけた文字が重ねて彫られている。「蔵守」と読める。");
      return "「柏木」と墨で書かれた板の下、石の門柱のほうに、彫り込まれた文字が残っている。\n消えかけているが、「蔵守」と読めた。";
    },
  });
  item("tome", "トメ", ["トメ", "老婆", "おばあさん", "婆さん", "隣の人", "お婆さん"], {
    loc: "gate", npc: true, scenery: true,
    here: g => g.here("tome") ? "門の脇に、小柄な老婆が立っている。" : "",
    desc: "八十は越えているだろう。背が低く、紺の割烹着の袖から出た手が、驚くほど節くれ立っている。目だけが、よく動く。",
    on: {
      talk: g => { Kura.tomeTalk(g); return true; },
      ask: (g, topic) => { Kura.tomeAsk(g, topic); return true; },
      give: (g, id) => Kura.tomeGive(g, id),
    },
  });

  room("maeniwa", {
    name: "前庭", indoor: false, moon: true,
    desc: g => "砂利を敷いた、広い前庭。松が一本、枝をだらりと垂らしている。母屋の玄関は、北。東には古い納屋、西には家の脇をまわる細い通路がある。\n庭のどこにも、草がない。ここだけ、きれいに掃き清められている。" +
      (g.flag("night1done") ? "\n玄関のほうへ向かって、濡れた足跡が、砂利の上に点々と続いている。" : ""),
    exits: { s: "gate", n: "genkan", e: "nagaya", w: "uraniwa" },
    listen: g => g.night() ? "松の枝から、雫が落ちる音がする。雨は降っていない。" : "鳥の声が、ない。",
  });
  item("matsu", "松", ["松", "松の木"], {
    loc: "maeniwa", scenery: true,
    desc: "枝の先から、ときどき雫が落ちる。晴れているのに。",
  });
  item("post", "郵便受け", ["郵便受け", "ポスト", "郵便"], {
    loc: "maeniwa", scenery: true, container: true, openable: true,
    desc: "門柱のかわりに、前庭の端に立っている古い木の郵便受け。",
    openMsg: "錆びた蓋を、持ち上げた。",
    onOpen: g => { g.reveal("kuyami"); g.reveal("oshirase"); },
  });
  item("kuyami", "お悔やみの葉書", ["葉書", "お悔やみ", "ハガキ"], {
    loc: "in:post", take: true, hidden: true,
    desc: "町の郵便局からの、お悔やみの葉書。「ハツ様のご逝去を悼み」とだけ書いてある。",
    text: "「柏木ハツ様のご逝去を、心よりお悔やみ申し上げます。」\n差出人は、役場の福祉課。それ以上のことは、何も書かれていない。",
  });
  item("oshirase", "ダムのお知らせ", ["お知らせ", "チラシ", "通知", "ダムの知らせ", "知らせ"], {
    loc: "in:post", take: true, hidden: true,
    desc: "役場の名前の入った、薄い紙。",
    text: g => {
      g.clue("oshirase", "ダムは点検のため、数日間、管理棟が無人になる。（役場のお知らせ）");
      g.learn("dam");
      return "『眞木沢ダム 設備点検のお知らせ』\n点検のため、今週いっぱい、管理棟は無人となります。職員の巡回はありません。\n設備にお近づきにならないよう、ご注意ください。\n\n裏には、鉛筆で、細い字の走り書きがある。\n『水位がまた下がらない。ハツさんの蔵も、おなじ』";
    },
  });

  room("uraniwa", {
    name: "裏庭", indoor: false, moon: true,
    desc: g => "母屋の裏手にまわった、細長い庭。北には白壁の蔵が、すぐ目の前にそびえている。西に古い井戸。母屋の縁側が、南の上に見える。\n土が、湿って黒い。" + (g.flag("night1done") ? "\n足跡は、井戸から蔵の前まで、ひとすじに続いている。" : ""),
    exits: { e: "maeniwa", n: "kuramae", w: "ido", u: "engawa" },
    listen: "蔵の壁の内側で、何かが、ぽちゃんと鳴った。",
  });
  item("uraniwa_dirt", "黒い土", ["土", "黒い土", "地面"], {
    loc: "uraniwa", scenery: true,
    desc: "足で踏むと、じわりと水がにじむ。晴れが続いているはずなのに。",
  });

  room("ido", {
    name: "古井戸", indoor: false, moon: true,
    desc: "石を丸く積んだ、古い井戸。木の蓋は、すでに朽ちて外されている。縁に、苔がびっしりと生えている。\n釣瓶の縄が、一本、たれている。",
    exits: { e: "uraniwa" },
    listen: g => g.night() ? "井戸の底から、人が大勢で息を吸うような音がする。" : "底のほうで、水がゆっくり動いている。",
  });
  item("ido_well", "井戸", ["井戸", "古井戸", "底", "水"], {
    loc: "ido", scenery: true,
    desc: g => {
      g.dread(1);
      return "のぞきこむ。丸い闇の底に、小さな空が映っている。\nその空に、あなたの顔はない。\nしばらくして、映っている空のほうが、すこし動いた。";
    },
    on: {
      use2: (g, id) => false,
      usedWith: (g, id) => {
        if (id === "oke" || id === "tsurube") {
          if (g.flag("okeFull")) { g.say("もう、桶には水が入っている。"); return true; }
          if (!g.has("oke")) { g.say("桶を持っていない。"); return true; }
          g.set("okeFull");
          g.say("桶を下ろして、引き上げた。水は、澄んでいる。澄みすぎている。\n手を入れると、骨に染みるほど冷たい。", "sub");
          return true;
        }
        return false;
      },
    },
  });
  item("tsurube", "釣瓶の縄", ["縄", "釣瓶", "つるべ", "釣瓶の縄"], {
    loc: "ido", scenery: true,
    desc: "縄の先に、結び目だけが残っている。桶がないと、水は汲めない。",
  });

  room("nagaya", {
    name: "納屋", indoor: false,
    desc: "土間に、農具や古い道具が雑然と置かれた納屋。窓からの光で、ほこりが舞っている。\n壁の釘には、さまざまな道具が掛かっている。",
    exits: { w: "maeniwa" },
    darkMsg: "窓が小さく、中がよく見えない。",
    dark: g => g.night() && !g.flag("nagayaLit"),
    listen: "ネズミの足音すら、しない。",
  });
  item("kama", "鎌", ["鎌", "草刈り鎌"], {
    loc: "nagaya", take: true, here: "壁の釘に、鎌が掛かっている。",
    desc: "刃は黒く錆びているが、先は鋭い。注連縄くらいなら、切れるだろう。",
  });
  item("abura", "灯油缶", ["灯油缶", "灯油", "ポリタンク", "缶"], {
    loc: "nagaya", take: true, here: "隅に、灯油缶が置かれている。",
    desc: g => "赤いポリ缶。振ると、半分ほど入っている音がする。" + (g.flag("aburaPoured") ? "\n（もう蓋が開いている）" : ""),
  });
  item("kago", "背負い籠", ["籠", "背負い籠", "かご"], {
    loc: "nagaya", take: true, here: "梁に、背負い籠がひとつ引っかけてある。",
    desc: "竹を編んだ、大きな背負い籠。底は厚く、重いものを入れても抜けそうにない。縄の肩紐がついている。",
  });
  item("chochin", "提灯", ["提灯", "ちょうちん", "灯り"], {
    loc: "nagaya", take: true, light: true, here: "棚の上に、紙の提灯が畳んで置いてある。",
    desc: g => "「柏木」と墨書された、手持ちの提灯。中に、短い蝋燭が立っている。" + (g.on("chochin") ? "\n（ついている）" : "\n（消えている）"),
    on: {
      use: g => {
        if (g.on("chochin")) { g.set("chochin.on", false); g.say("提灯の火を、吹き消した。"); return true; }
        if (!g.has("matchbox")) { g.say("火がない。マッチのようなものが、必要だ。"); return true; }
        if (g.flag("matches") <= 0) { g.say("マッチ箱は、空だった。"); return true; }
        g.S.f.matches--;
        g.set("chochin.on", true);
        g.say("マッチを擦って、蝋燭に火をつけた。紙の中で、橙色の光がふくらんだ。" + (g.flag("matches") <= 1 ? "\n（マッチは、もう残り少ない）" : ""));
        return true;
      },
    },
  });
  item("nagagutsu", "長靴", ["長靴", "ゴム長", "ブーツ"], {
    loc: "nagaya", take: true, here: "戸口の脇に、ゴムの長靴が一足、揃えて置かれている。",
    desc: "黒いゴムの長靴。内側は乾いていて、新しい。誰かが、最近、出しておいたような気がする。",
  });
  item("sukoppu", "スコップ", ["スコップ", "シャベル"], {
    loc: "nagaya", scenery: true, desc: "刃に、泥がこびりついている。まだ湿っている。",
  });
  item("nagaya_tana", "棚", ["棚"], {
    loc: "nagaya", scenery: true, desc: "道具が整理して並べてある。ここだけは、ハツが生前、使っていた当時のままのようだ。",
  });
  item("rope", "荒縄", ["荒縄", "縄"], {
    loc: "nagaya", take: true, here: "束ねた荒縄が、床に置かれている。", desc: "太い荒縄を、輪にして束ねたもの。",
  });

  // ------------------------------------------------------------------
  // 母屋（一階）
  // ------------------------------------------------------------------
  room("genkan", {
    name: "玄関", indoor: true,
    desc: "広い土間の玄関。上がり框の向こうに、薄暗い廊下が奥へのびている。西には台所の土間がつながっている。\n戸は、あなたが来る前から、開いていた。",
    exits: { s: "maeniwa", n: "rouka", w: "doma" },
    listen: g => g.night() ? "戸の外で、誰かが、じっと立っている気配がする。" : "家のなかは、静かだ。",
  });
  item("getabako", "下駄箱", ["下駄箱", "靴箱", "靴"], {
    loc: "genkan", scenery: true, container: true, openable: true,
    desc: "背の低い、古い下駄箱。",
    openMsg: "戸を引いた。履物がぎっしり詰まっている。",
    onOpen: g => { g.reveal("zori"); },
  });
  item("zori", "ハツの草履", ["草履", "ぞうり", "ハツの草履"], {
    loc: "in:getabako", take: true, hidden: true,
    desc: "底の擦り減った、小さな草履。鼻緒が、濡れている。何日も前のものなのに。",
  });
  item("kasa", "傘立て", ["傘立て", "傘"], {
    loc: "genkan", scenery: true, desc: "傘が七本、立っている。どれも、きちんと閉じている。どれも、濡れている。",
  });

  room("doma", {
    name: "土間の台所", indoor: true,
    desc: "かまどのある、広い土間の台所。流しと、背の高い戸棚。西の勝手口は、内側から太い閂が掛かっている。北に、茶の間。\n神棚に、小さな灯明皿がのっている。",
    exits: { e: "genkan", n: "chanoma" },
    listen: g => g.night() ? "蛇口から、ぽつ、ぽつ、と水が落ちる。誰も、捻っていないのに。" : "蛇口から、水が一滴ずつ落ちている。",
  });
  item("nagashi", "流し", ["流し", "蛇口", "水道", "水"], {
    loc: "doma", scenery: true,
    desc: "ステンレスの蛇口から、水が一滴ずつ落ちている。受けた水が、濁りのない透明で、触ると冷たい。",
    on: {
      use: g => {
        g.say("蛇口をひねると、勢いよく水が出た。\n澄んだ水が、いつまでも、いつまでも、出つづけた。手を止めたのは、あなたのほうだった。", "sub");
        return true;
      },
    },
  });
  item("kamado", "かまど", ["かまど", "竈"], {
    loc: "doma", scenery: true, desc: "灰が、きれいに掻き出されている。最後に火を入れたのは、いつだろう。",
  });
  item("kanuki", "勝手口の閂", ["閂", "勝手口"], {
    loc: "doma", scenery: true,
    desc: "樫の太い閂が、内側から掛けられている。外から開けた様子は、ない。",
    on: { pull: g => { g.say("閂は、固く動かない。ここは、開けないほうがいい気がする。"); return true; } },
  });
  item("todana", "戸棚", ["戸棚", "食器棚", "棚"], {
    loc: "doma", scenery: true, container: true, openable: true,
    desc: "ガラス戸のついた、背の高い戸棚。",
    openMsg: "ガラス戸を、横に引いた。",
    onOpen: g => { g.reveal("shio"); },
  });
  item("shio", "塩", ["塩", "しお", "塩壺"], {
    loc: "in:todana", take: true, hidden: true,
    desc: "素焼きの小さな壺に入った、粗塩。縁が、少し湿っている。",
    on: {
      use: g => {
        g.say("塩をひとつまみ、足もとに撒いた。すこしだけ、息がしやすくなった。", "sub");
        g.dread(-2);
        return true;
      },
    },
  });
  item("hikidashi", "流しの引き出し", ["流しの引き出し", "引き出し", "引出し", "抽斗"], {
    loc: "doma", scenery: true, container: true, openable: true,
    desc: "流しの下の、浅い引き出し。",
    openMsg: "引き出しを引いた。きしむ音がした。",
    onOpen: g => { g.reveal("nikki1"); },
  });
  item("nikki1", "ハツの日記（今年）", ["日記", "日記帳", "ハツの日記", "ノート", "大学ノート"], {
    loc: "in:hikidashi", take: true, hidden: true,
    desc: "大学ノート。表紙に、細い鉛筆の字で「今年」とだけ書かれている。",
    text: g => {
      g.set("diary1Read");
      g.learn("tsutome"); g.learn("kagi"); g.learn("hatsu");
      g.clue("diary1", "ハツの日記：毎晩、蔵の前で鈴を鳴らして数を数えるのが「務め」。足が悪くなり、つらかった。鍵はトメさんに預けてある。");
      g.tick(1);
      return "（ノートをめくる。鉛筆の字は、年を取るにつれ、少しずつ崩れている）\n\n『六月二日　晴　水がまた上がってきた。夜の務め、今夜も、どうにか。』\n『六月九日　足がいよいよ悪い。蔵の前までが、遠い。数えているうちに、ときどき、もうひとりの声が混じる。』\n『七月三日　鈴の音が、おかしい。あの子が来てから、ずっと。トメさんにだけ話した。』\n『九月十日　蔵の鍵は、トメさんに預けた。あの子（わたしの孫のこと）には、できれば、継がせたくない。けれど、わたしがいなくなれば、蔵はまた、誰かを探す。』\n『九月二十日　子の刻。鈴を三度。桶の水を、溝へ。数える。ひとつ、ふたつ、みっつ……最後まで数えて、いつもひとつ、足りない。』\n\nそこで、日記は終わっている。";
    },
  });
  item("matchbox", "マッチ箱", ["マッチ", "マッチ箱", "燐寸"], {
    take: true, loc: "in:butsudan_hiki", hidden: true,
    desc: g => "「喫茶 水無月」と書かれた、古い箱のマッチ。残りは" + (g.flag("matches")) + "本ほど。",
  });

  room("chanoma", {
    name: "茶の間", indoor: true,
    desc: "十畳の茶の間。真ん中にちゃぶ台、壁ぎわにテレビと茶箪笥。柱に、古い柱時計が掛かっている。\n南は台所の土間、北は仏間、東は廊下。",
    exits: { s: "doma", n: "butsuma", e: "rouka" },
    listen: g => {
      if (g.flag("clockWound")) return "柱時計が、かち、こち、と鳴っている。";
      return "柱時計は止まっている。それなのに、ときどき、振り子の揺れる音がする。";
    },
  });
  item("chabudai", "ちゃぶ台", ["ちゃぶ台", "卓袱台", "台"], {
    loc: "chanoma", scenery: true, desc: "湯呑みがひとつ、伏せてある。二人分の座布団が、向かい合って置かれている。片方は、ずっと使われていない。",
  });
  item("hashira_tokei", "柱時計", ["柱時計", "時計", "振り子"], {
    loc: "chanoma", scenery: true,
    desc: g => g.flag("clockWound") ? "ねじを巻いたので、時計は動いている。針は、いまの時刻を指している。" : "十二時の少し前で、針が止まっている。ねじ穴に、鍵はささっていない。",
    on: {
      use: g => {
        if (g.flag("clockWound")) { g.say("もう動いている。"); return true; }
        g.say("ねじ穴に指をかけて、巻いてみる。固い。\n三度まわしたところで、振り子が、ことりと動き出した。", "sub");
        g.set("clockWound");
        return true;
      },
    },
  });
  item("terebi", "テレビ", ["テレビ", "TV", "ブラウン管"], {
    loc: "chanoma", scenery: true,
    desc: "分厚いブラウン管のテレビ。電源は、入らない。\n画面に、あなたが映っている。背後の障子が、少しだけ開いている。",
    on: { use: g => { g.say("スイッチを押した。何も起きない。画面の中の障子だけが、すこし、閉じた。"); g.dread(1); return true; } },
  });
  item("shashin", "壁の古い写真", ["写真", "古い写真", "壁の写真", "額"], {
    loc: "chanoma", scenery: true,
    desc: g => {
      g.set("photoSeen"); g.learn("mio");
      g.clue("shashin", "茶の間の古い集合写真：昭和三十三年、「底の社にて」。胸に名札をつけた二人の女の子が、手をつないでいる。名札のひとつは、「みお」。");
      return "額に入った白黒の集合写真。鳥居の前に、大人と子どもが、ぎっしり並んでいる。裏には、鉛筆で「昭和三十三年　底の社にて」とある。\n前列の端に、女の子がふたり、手をつないで写っている。ひとりは、ハツだ。目元に面影がある。もうひとりの子の胸には、白い名札がついている。「みお」と、読めた。\nふたりとも、笑っていない。\n人数を数えてみる。大人も子どもも、あわせて二十一人。";
    },
  });
  item("chadansu", "茶箪笥", ["茶箪笥", "箪笥", "たんす"], {
    loc: "chanoma", scenery: true, container: true, openable: true,
    desc: "引き戸のついた、背の低い箪笥。",
    openMsg: "引き戸を開けた。茶筒と、急須がしまってある。",
    onOpen: g => { g.reveal("ocha"); },
  });
  item("ocha", "茶筒", ["茶筒", "お茶", "茶葉"], {
    loc: "in:chadansu", take: true, hidden: true,
    desc: "茶筒の蓋を開けると、乾いた茶葉の香りが、ひろがった。人のいる家のにおいがした。",
    on: { use: g => { g.say("お茶を淹れる余裕はない。けれど、香りを嗅いだだけで、少し、落ち着いた。", "sub"); g.dread(-1); return true; } },
  });

  room("butsuma", {
    name: "仏間", indoor: true,
    desc: "八畳の仏間。奥に、大きな仏壇。壁には、遺影がずらりと並んでいる。ハツのものは、いちばん端に、新しく掛けられていた。\n東は奥座敷、南は茶の間。\n線香の残り香が、まだ、濃い。",
    exits: { s: "chanoma", e: "zashiki" },
    listen: "仏壇のおりんが、触れもしないのに、小さく鳴った。",
    on: {
      pray: g => {
        g.say("仏壇の前に正座して、手を合わせた。\nしばらくそうしていると、胸のあたりに、ゆっくりとしたあたたかさが戻ってきた。", "sub");
        g.dread(-3);
        return true;
      },
    },
  });
  item("butsudan", "仏壇", ["仏壇"], {
    loc: "butsuma", scenery: true, container: true, openable: true,
    desc: "黒塗りの大きな仏壇。扉は閉じている。",
    openMsg: "観音開きの扉を、両側に開いた。位牌が、ずらりと並んでいる。",
    onOpen: g => { g.reveal("butsudan_hiki"); },
  });
  item("butsudan_hiki", "仏壇の引き出し", ["引き出し", "引出し"], {
    loc: "in:butsudan", hidden: true, scenery: true, container: true, openable: true,
    desc: "仏壇の下段に、小さな引き出しがついている。",
    openMsg: "引き出しを、そっと引いた。",
    onOpen: g => { g.reveal("oboegaki"); g.reveal("matchbox"); },
  });
  item("oboegaki", "務めの覚え書", ["覚え書", "務めの覚え書", "覚書", "紙", "和紙"], {
    loc: "in:butsudan_hiki", take: true, hidden: true,
    desc: "半紙に筆で書かれた、短い覚え書。何度も折り畳まれたあとがある。",
    text: g => {
      g.set("oboegakiRead");
      g.learn("tsutome");
      g.clue("oboegaki", "覚え書：子の刻に蔵の前へ。鈴を三度鳴らし、数を数える。桶の水を溝へ流す。決して、戸の隙間を覗かない。（水は井戸から汲む）");
      g.tick(1);
      return "『務めの覚え書』\n\n一、日が落ちたら、蔵の戸に近づくべからず。\n一、子の刻、蔵の前に立ち、鈴を三度鳴らすこと。\n一、井戸の水を桶に汲み、戸の下の溝へ流すこと。\n一、ひとつから数え、二十一で止めること。二十二は、数えてはならぬ。\n一、戸の隙間を覗くべからず。\n一、蔵守は、蔵のそばで死ぬこと。\n\n最後の一行だけ、あとから、別の筆で書き足されている。『忘れるな。名を呼べば、帰る』";
    },
  });
  item("ihai", "位牌", ["位牌", "遺影", "新しい位牌"], {
    loc: "butsuma", scenery: true,
    desc: g => {
      g.clue("ihai", "仏壇の位牌は、柏木の家の者のほかに、苗字の違う位牌が二十一ある。（二十一人の何か）");
      return "ハツの新しい位牌が、いちばん前に立っている。その奥の段に、古い位牌が、ずらりと並んでいる。\n柏木の姓のものは、数えるほどしかない。ほかは、すべて、見知らぬ苗字。\n数えると、全部で、二十一あった。";
    },
  });
  item("yunomi", "供えの湯呑み", ["湯呑み", "供え", "水", "お供え"], {
    loc: "butsuma", scenery: true,
    desc: g => "仏壇の前に、水を入れた湯呑みが供えてある。" + (g.night() ? "\n水面が、縁ぎりぎりまで上がっている。さっきは、半分ほどだったはずだ。" : "\n水は、半分ほど。"),
  });
  item("senko", "線香とろうそく", ["線香", "ろうそく", "蝋燭", "ローソク"], {
    loc: "butsuma", scenery: true, desc: "線香立ての灰に、燃えさしの線香が、四本ささっている。",
  });

  room("zashiki", {
    name: "奥座敷", indoor: true,
    desc: "母屋でいちばん奥の座敷。床の間に、「水」と一字だけ書かれた掛け軸。押入れの襖が、片側だけ少し開いている。\n畳が、一枚だけ、他より新しい。\n西は仏間、東は縁側、南は廊下。",
    exits: { w: "butsuma", e: "engawa", s: "rouka", d: { to: "yukashita", show: g => !!g.flag("tatamiUp"), if: g => g.flag("tatamiUp") ? true : "下へは降りられない。" } },
    listen: g => g.night() ? "畳の下から、水のしたたる音がする。" : "障子ごしに、日が差している。",
    on: {
      sit: g => { g.say("座布団に、ゆっくり座る。畳の目が、じっとりと冷たい。"); return true; },
    },
  });
  item("kakejiku", "掛け軸", ["掛け軸", "床の間", "水"], {
    loc: "zashiki", scenery: true,
    desc: "墨で、大きく「水」と一字だけ。よく見ると、その字の最後の払いが、紙の下のほうへ、まっすぐ伸びている。まるで、滴っているようだ。",
  });
  item("oshiire", "押入れ", ["押入れ", "押し入れ", "布団", "襖"], {
    loc: "zashiki", scenery: true, container: true, openable: true,
    desc: "襖が少し開いている。",
    openMsg: "襖を、開けた。布団が、きちんと畳んで積んである。",
    onOpen: g => { g.reveal("futon"); },
  });
  item("futon", "布団", ["布団", "ふとん", "掛け布団"], {
    loc: "in:oshiire", scenery: true, desc: "干したばかりのように、ふかふかしている。ここで、眠れという意味だろう。",
  });
  item("tatami", "新しい畳", ["畳", "新しい畳", "たたみ", "床板"], {
    loc: "zashiki", scenery: true,
    desc: g => g.flag("tatamiUp") ? "畳は持ち上げてある。床板の一枚が、はずれて、下へ降りる穴があいている。" : "他の畳より、ひとまわり新しい。縁が、すこし浮いている。",
    on: {
      pull: g => {
        if (g.flag("tatamiUp")) { g.say("畳はもう上げてある。"); return true; }
        g.set("tatamiUp");
        g.say("縁に指をかけて、畳を持ち上げた。重い。\n下の床板が一枚、はずれて、暗い穴があいていた。冷たい空気が、昇ってくる。", "sub");
        return true;
      },
      push: g => { g.say("上から押しても、動かない。縁から、引き上げるのだろう。"); return true; },
    },
  });

  room("engawa", {
    name: "縁側", indoor: true,
    desc: "裏庭に面した、長い縁側。ガラス戸ごしに、蔵が見える。\n西は奥座敷。庭へは、段を降りて行ける。\n軒に、風鈴が下がっている。",
    exits: { w: "zashiki", d: "uraniwa" },
    listen: g => g.night() ? "風鈴が、風もないのに、ひとつずつ、順に鳴る。数えると、二十一回。" : "風鈴が、ちりん、と鳴った。風は、ない。",
  });
  item("furin", "風鈴", ["風鈴"], {
    loc: "engawa", scenery: true, desc: "短冊に、まだ濡れたような字で、「底」と書かれている。",
  });
  item("garasudo", "ガラス戸", ["ガラス戸", "ガラス", "窓", "蔵"], {
    loc: "engawa", scenery: true,
    desc: "裏庭の向こうに、白壁の蔵が見える。古い家のなかでも、蔵だけが、ひどくきれいだ。\n蔵の戸には、太い注連縄が、渡してある。",
  });

  room("rouka", {
    name: "廊下", indoor: true,
    desc: "玄関から奥へ、まっすぐのびる板張りの廊下。西は茶の間、北は奥座敷、東には納戸。階段が、二階へ上がっている。\n黒電話が、廊下の隅の台に置いてある。",
    exits: { s: "genkan", w: "chanoma", n: "zashiki", e: "nando", u: "niaikai" },
    listen: g => g.night() ? "板の継ぎ目から、水の染み出る音がしている。" : "家全体が、ゆっくりと軋む。",
  });
  item("kuro_denwa", "黒電話", ["黒電話", "電話", "受話器"], {
    loc: "rouka", scenery: true,
    desc: "ダイヤル式の、黒い電話。線は、壁のジャックに、きちんとつながっている。",
    on: {
      use: g => {
        if (g.flag("phoneRing")) {
          g.set("phoneRing", false);
          g.set("phoneAnswered");
          Kura.phoneCall(g);
          return true;
        }
        g.say("受話器を上げた。ツーという音すらしない。耳に当てると、水の中のような、くぐもった音が、ただ、していた。");
        g.dread(1);
        return true;
      },
    },
  });
  item("hashira_kizu", "柱の傷", ["柱", "傷", "背くらべ", "柱の傷"], {
    loc: "rouka", scenery: true,
    desc: g => {
      g.learn("mio");
      g.clue("kizu", "廊下の柱の背くらべの傷に、「みお」の名前がある。柏木の子ではないのに。");
      return "柱に、背くらべの傷が何本も刻まれている。「ハツ　五つ」「ハツ　七つ」……\n低いところに、ひとつだけ、別の名前がある。「みお　八つ」。\n日付は、昭和三十四年の、五月。";
    },
  });

  room("nando", {
    name: "納戸", indoor: true,
    desc: "廊下の突きあたりの、窓のない納戸。昼でも、戸口から入る薄明かりだけ。長持と古い棚、衣紋掛け。かび臭い。\n北に風呂場、西は廊下。",
    exits: { w: "rouka", n: "furo" },
    dark: g => g.night(),
    darkMsg: "窓がない。夜は、まったくの暗闇で、手探りもできない。",
    listen: "壁の向こうで、水が、ことり、と鳴った。",
  });
  item("nagamochi", "長持", ["長持", "行李", "箱"], {
    loc: "nando", scenery: true, container: true, openable: true,
    desc: "古い着物を収めた、大きな長持。",
    openMsg: "蓋を持ち上げた。ナフタリンのにおいがした。",
    onOpen: g => { g.reveal("kaichu"); },
  });
  item("kaichu", "懐中電灯", ["懐中電灯", "電灯", "ライト", "灯り"], {
    loc: "in:nagamochi", take: true, hidden: true, light: true,
    desc: g => "古い、金属の懐中電灯。" + (g.on("kaichu") ? "\n（ついている）" : "\n（消えている）"),
    on: {
      use: g => {
        if (g.on("kaichu")) { g.set("kaichu.on", false); g.say("懐中電灯を、消した。"); return true; }
        g.set("kaichu.on", true);
        g.say("スイッチを入れた。黄色い光が、闇に丸く浮かんだ。");
        return true;
      },
    },
  });
  item("nando_tana", "古い棚", ["棚", "古い棚"], {
    loc: "nando", scenery: true, container: true, openable: false, surface: true,
    desc: "棚には、ほこりをかぶった小物が並んでいる。",
  });
  item("rosoku", "蝋燭", ["蝋燭", "ろうそく", "ローソク"], {
    loc: "in:nando_tana", take: true, here: "棚に、蝋燭の束がある。",
    desc: "仏事用の、太い蝋燭。何本か束になっている。",
  });
  item("nando_door", "納戸の戸", ["戸", "納戸の戸", "引き戸", "扉"], {
    loc: "nando", scenery: true,
    desc: g => g.flag("nandoClosed") ? "戸は、内側から閉めてある。" : "引き戸。いまは開いている。",
    on: {
      close: g => {
        if (g.flag("nandoClosed")) { g.say("もう閉まっている。"); return true; }
        g.set("nandoClosed");
        g.say("引き戸を、内側から閉めた。外の気配が、すこし遠くなった。", "sub");
        return true;
      },
      open: g => {
        if (!g.flag("nandoClosed")) { g.say("もう開いている。"); return true; }
        g.set("nandoClosed", false);
        g.say("引き戸を、すこし開けた。廊下の暗さが、流れこんでくる。");
        return true;
      },
    },
  });

  room("furo", {
    name: "風呂場", indoor: true,
    desc: "タイル張りの、古い風呂場。大きな木の浴槽が据えてある。窓は、すりガラス。\n南は納戸。",
    exits: { s: "nando" },
    listen: g => g.night() ? "浴槽の水面が、静かに、波打っている。" : "水が、ごく小さく、揺れる音がする。",
  });
  item("yokusou", "浴槽", ["浴槽", "風呂", "湯船", "水"], {
    loc: "furo", scenery: true,
    desc: g => {
      if (g.night()) { g.dread(2); return "浴槽は、縁までいっぱいに満ちている。使っていないはずなのに。\n水面に、あなたの顔のかわりに、見知らぬ人の顔が、いくつも、ゆっくりと浮かんでは、沈んでいく。"; }
      return "浴槽には、水が張ってある。使っていないはずなのに、昨日汲んだばかりのように澄んでいる。\n水面に、天井の電球が映っている。ひとつ。ひとつのはず、なのに、よく見ると、輪が、いくつも重なっている。";
    },
  });
  item("oke", "湯桶", ["桶", "湯桶", "洗い桶", "木桶"], {
    loc: "furo", take: true, here: "洗い場に、木の湯桶が伏せて置かれている。",
    desc: g => "檜の湯桶。だいぶ使い込まれている。" + (g.flag("okeFull") ? "\n水が、なみなみと入っている。" : "\n空。"),
    on: {
      use: g => {
        if (!g.flag("okeFull")) {
          if (g.here("yokusou") || g.S.room === "furo") {
            g.set("okeFull");
            g.say("浴槽の水を、桶に汲んだ。……澄んでいる。つめたい。\nこの水を使ってはいけないような気がして、手が、すこし、震えた。", "sub");
            g.set("okeBath");
            return true;
          }
          g.say("桶が、空だ。水のあるところで、使うといい。");
          return true;
        }
        g.say("水を汲んだ桶を、そのまま持ち歩く。重い。");
        return true;
      },
      use2: (g, id) => false,
    },
  });
  item("furo_mado", "すりガラスの窓", ["窓", "すりガラス"], {
    loc: "furo", scenery: true, desc: "曇りガラスの向こうに、人影のようなものが、ひとつ。庭の松かもしれない。",
  });

  // ------------------------------------------------------------------
  // 二階
  // ------------------------------------------------------------------
  room("niaikai", {
    name: "二階の廊下", indoor: true,
    desc: "階段を上がった、短い廊下。東に祖母の部屋、北に子供部屋。天井に、屋根裏への蓋がある。\n窓から、蔵の瓦屋根と、坂の向こうの谷が見える。谷の底に、白く光るものがある。",
    exits: { d: "rouka", e: "obaba", n: "kodomo", u: { to: "yaneura", if: g => g.flag("hatchOpen") ? true : "天井の蓋は閉まっている。紐が、垂れているが、届くだろうか。" } },
    listen: "階下から、水の流れるような音がしている。",
  });
  item("himo", "天井の紐", ["紐", "ひも", "蓋", "天井", "屋根裏"], {
    loc: "niaikai", scenery: true,
    desc: "天井の蓋から、白い紐が垂れている。引けば、梯子が降りてくる仕組みだろう。",
    on: {
      pull: g => {
        if (g.flag("hatchOpen")) { g.say("もう梯子は降りている。"); return true; }
        g.set("hatchOpen");
        g.say("紐を引くと、蓋が開いて、折りたたみの梯子が、ことんと降りてきた。\n暗い穴から、乾いた埃のにおいが降りてくる。", "sub");
        return true;
      },
    },
  });
  item("niaikai_mado", "窓", ["窓", "谷", "湖"], {
    loc: "niaikai", scenery: true,
    desc: g => {
      g.learn("dam");
      return "谷の底に、細長く、白く光る水面が見える。ダム湖だ。\n水面の端に、ひとつだけ、細い棒のようなものが突き出ている。鳥居の先端のように見えた。";
    },
  });

  room("obaba", {
    name: "祖母の部屋", indoor: true,
    desc: "六畳の、祖母の部屋。小さな文机と、布をかけた鏡台。布団は、たたんだまま。\n部屋じゅうに、薄荷のような匂いが残っている。\n西は廊下。",
    exits: { w: "niaikai" },
    listen: "耳をすますと、微かに、鈴の音がした気がした。",
    on: {
      pray: g => { g.say("祖母の布団に向かって、手を合わせた。部屋が、すこし明るくなったような気がした。", "sub"); g.dread(-2); return true; },
    },
  });
  item("fudukue", "文机", ["文机", "机"], {
    loc: "obaba", scenery: true, container: true, openable: true,
    desc: "小さな文机。引き出しが一つ、ついている。",
    openMsg: "引き出しを引いた。",
    onOpen: g => { g.reveal("suzu"); g.reveal("kirihako"); },
  });
  item("suzu", "蔵守の鈴", ["鈴", "蔵守の鈴", "鐘", "ベル"], {
    loc: "in:fudukue", take: true, hidden: true,
    desc: "真鍮の小さな鈴。柄には、赤い紐が巻かれている。紐の端が、ほどけて、水を吸ったように黒ずんでいる。",
    on: {
      use: g => Kura.ringBell(g),
    },
  });
  item("kirihako", "桐の小箱", ["桐箱", "小箱", "桐の小箱", "箱"], {
    loc: "in:fudukue", take: true, hidden: true, container: true, openable: true,
    desc: "手のひらほどの、桐の小箱。蓋に、「みお」と、爪で彫ったような字がある。",
    openMsg: "蓋を、そっと持ち上げた。",
    onOpen: g => { g.reveal("nafuda"); },
  });
  item("nafuda", "名札", ["名札", "みおの名札", "ネームプレート"], {
    loc: "in:kirihako", take: true, hidden: true,
    desc: "白い布に、黒い糸で刺繍された、小さな名札。「眞木分校　二年　みお」。端が、水のしみで変色している。",
    onTaken: g => {
      g.learn("mio");
      g.clue("nafuda", "祖母の桐箱に、みおの名札があった。みおは、祖母の幼なじみのようだ。");
    },
  });
  item("kyoudai", "鏡台", ["鏡台", "鏡", "布"], {
    loc: "obaba", scenery: true,
    desc: g => {
      if (g.flag("kyoudaiOpen")) return "布を外した鏡台。鏡は、澄んでいる。映っているのは、あなたの背後の障子だ。障子が、少し開いている。";
      return "黒い布が、鏡にかけてある。亡くなった人の部屋に、よくある習わしだ。";
    },
    on: {
      pull: g => {
        if (g.flag("kyoudaiOpen")) { g.say("布は、もう外してある。"); return true; }
        g.set("kyoudaiOpen");
        g.say("布を外した。鏡のなかのあなたが、すこし遅れて、こちらを向いた。\nそれだけだ。気のせいだと思うことにする。", "sub");
        g.dread(1);
        return true;
      },
      open: g => { g.act("pull", "kyoudai"); return true; },
    },
  });

  room("kodomo", {
    name: "子供部屋", indoor: true,
    desc: "かつての子供部屋。勉強机と、木の本棚。壁には、色あせた絵が貼られている。\n南は廊下。",
    exits: { s: "niaikai" },
    listen: "ふと、ひそひそ声が止んだ気がした。",
  });
  item("kodomo_tsukue", "勉強机", ["勉強机", "机"], {
    loc: "kodomo", scenery: true, container: true, openable: true,
    desc: "小学生用の、小さな木の机。",
    openMsg: "引き出しを開けた。",
    onOpen: g => { g.reveal("ohajiki"); },
  });
  item("ohajiki", "おはじきの缶", ["おはじき", "缶", "おはじきの缶"], {
    loc: "in:kodomo_tsukue", take: true, hidden: true,
    desc: g => "クッキーの缶いっぱいの、ガラスのおはじき。数えてみる。二十個、あった。\n缶の内側に、ひとつ分の、丸いへこみがある。",
    on: {
      use: g => {
        g.clue("ohajiki", "おはじきは二十個。缶には二十一個目の跡があるが、ひとつ足りない。");
        g.say("缶をひっくり返して、おはじきを床に広げた。ひとつずつ数える。\nひとつ、ふたつ……にじゅう。\nあとひとつ、あるはずの場所が、空いている。", "sub");
        return true;
      },
    },
  });
  item("kodomo_e", "壁の絵", ["絵", "壁の絵", "クレヨン"], {
    loc: "kodomo", scenery: true,
    desc: "クレヨンで描かれた、家と蔵と、たくさんの人。ぜんぶ、水色で塗られている。\n人の数は、二十一人。ひとりだけ、赤い服を着て、蔵の戸の前に立っている。顔は、塗りつぶされていた。",
  });

  room("yaneura", {
    name: "屋根裏", indoor: true,
    desc: "傾いた天井の低い屋根裏。古い行李や、箱が、埃をかぶって並んでいる。\n小さな丸窓から、斜めの光が差している。",
    exits: { d: "niaikai" },
    listen: "屋根の上を、誰かが、そっと歩いたような気がする。",
    dark: g => g.night(),
  });
  item("koori", "行李", ["行李", "古い行李"], {
    loc: "yaneura", scenery: true, container: true, openable: true,
    desc: "竹で編んだ、古い行李。",
    openMsg: "蓋を開けた。古い紙のにおいがする。",
    onOpen: g => { g.reveal("nikki2"); },
  });
  item("nikki2", "古い日記（昭和）", ["古い日記", "日記", "昭和の日記", "ノート", "子供の日記"], {
    loc: "in:koori", take: true, hidden: true,
    desc: "変色した、子供用のノート。表紙に、幼い字で「ハツ」。",
    text: g => {
      g.set("diary2Read");
      g.learn("suikyo"); g.learn("sokonoyashiro");
      g.clue("diary2", "ハツの子供の日記：昭和三十四年、ダムの貯水で、底の集落の人々二十一人が、水神の社で亡くなった。水神の鏡は、柏木の蔵へ運ばれた。みおも、そのひとり。");
      g.tick(1);
      return "『昭和三十四年　六月二十日　あめ』\n\n『きょう、ダムに水をためる日だった。底の社には、おとなが、ぜんぶで二十一人、あつまった。水神さまを、うつしたくないからだ。みおも、いっしょだった。』\n\n『夜になって、水がきた。みおが、手をはなした。』\n\n『つぎの日、水神さまの鏡だけが、石段のところに、ういていた。おとなたちが、それを、うちの蔵にしまうことにした。ほんとうは、社にかえさなきゃいけないのに。』\n\n『かがみの水が、まいばん、かさをます。だれかが、かぞえつづけないといけないって、おじいちゃんが言った。ふたつ、みっつ……』\n\n『みおの名前を、わたしが、いちばんさいごに、よべなかった。』\n\n（日記は、そこで終わっている。紙の端に、濡れたように、にじんだ跡がある）";
    },
  });
  item("yane_mado", "丸窓", ["窓", "丸窓"], {
    loc: "yaneura", scenery: true,
    desc: "丸窓から、谷が見える。谷の底の水面に、鳥居の先端が、わずかに突き出ている。",
  });

  room("yukashita", {
    name: "床下", indoor: true,
    desc: "這って進むしかない、低い床下。湿った土のにおい。前方、蔵のほうへ、石を並べた細い溝がのびている。溝には、水が溜まっている。\n上は、奥座敷。",
    exits: { u: "zashiki" },
    dark: true,
    darkMsg: "真っ暗だ。灯りがなくては、足も出せない。",
    listen: "溝を、水が、蔵から母屋のほうへ、ゆっくりと流れている。",
  });
  item("mizo_yuka", "石の溝", ["溝", "石の溝", "水"], {
    loc: "yukashita", scenery: true,
    desc: "蔵のほうへ続く、石組みの溝。水が、蔵から、母屋へ向かって流れている。逆だ。水は、下へ流れるはずなのに。",
  });
  item("kan", "錆びた缶", ["缶", "錆びた缶", "ブリキ缶"], {
    loc: "yukashita", take: true, container: true, openable: true,
    here: "土に半分埋もれて、錆びた缶がある。",
    desc: "煎餅の缶のような、ブリキの箱。",
    openMsg: "蓋を、こじ開けた。",
    onOpen: g => { g.reveal("ohajiki21"); },
  });
  item("ohajiki21", "ひとつだけのおはじき", ["おはじき", "ガラス玉", "ひとつ"], {
    loc: "in:kan", take: true, hidden: true,
    desc: "青い、ガラスのおはじき。内側に、小さな泡が閉じこめられている。握ると、ほんのり冷たい。",
    onTaken: g => {
      g.clue("ohajiki21", "床下の缶から、二十一個目のおはじきが見つかった。");
    },
  });

  // ------------------------------------------------------------------
  // 蔵
  // ------------------------------------------------------------------
  room("kuramae", {
    name: "蔵の前", indoor: false, moon: true,
    desc: g => "白壁の蔵が、目の前にそびえている。高さは、母屋の屋根より、ずっと上だ。分厚い扉には、太い注連縄が渡されていて、鉄の錠前がかかっている。\n戸の下の、地面すれすれに、石組みの浅い溝が掘られている。溝のなかは、いつも湿っている。\n南は裏庭。" +
      (g.flag("kuraOpen") ? "\n戸は、いま、開け放たれている。" : ""),
    exits: { s: "uraniwa", n: { to: "kura1", show: g => !!g.flag("kuraOpen"), if: g => g.flag("kuraOpen") ? true : "蔵の戸は、閉まっている。" } },
    listen: g => g.night() ? "蔵の壁に、耳を当てるまでもなかった。内側から、水の鳴る音が、ひっきりなしに響いている。" : "壁の内側から、水の動く音がする。",
    on: {
      count: g => Kura.countAtKura(g),
      sit: g => { g.say("石段に腰を下ろした。壁の冷気が、背中から染みてくる。"); return true; },
    },
  });
  item("kura_no_to", "蔵の戸", ["戸", "扉", "蔵の戸", "蔵", "錠前", "鍵穴"], {
    loc: "kuramae", scenery: true,
    desc: g => {
      if (g.flag("kuraOpen")) return "蔵の戸は、開いている。奥から、冷たい風が、静かに流れ出てくる。";
      let s = "分厚い漆喰の扉。";
      s += g.flag("shimenawaCut") ? "注連縄は切られて、足もとに落ちている。" : "太い注連縄が、渡してある。紙垂が、ひとつ、濡れたように垂れている。";
      s += g.flag("kuraUnlocked") ? "錠前は外れている。" : "鉄の錠前が、重たくかかっている。";
      s += "\n戸と戸のあいだに、ほんの指一本ぶんの隙間がある。……覗いてはいけない。";
      return s;
    },
    on: {
      open: g => {
        if (g.flag("kuraOpen")) { g.say("もう開いている。"); return true; }
        if (!g.flag("shimenawaCut")) { g.say("注連縄が、戸をふさいでいる。"); return true; }
        if (!g.flag("kuraUnlocked")) { g.say("錠前が、かかっている。"); return true; }
        g.set("kuraOpen");
        g.say("両手で、戸を引いた。重い。ゆっくり、ゆっくりと、音もなく、戸は動いた。\n闇の奥から、井戸の底のような冷たさが、流れ出てくる。", "sub");
        g.dread(1);
        return true;
      },
      push: g => { g.act("open", "kura_no_to"); return true; },
      pull: g => { g.act("open", "kura_no_to"); return true; },
      examine: g => false,
      use2: () => false,
      usedWith: (g, id) => {
        if (id === "kama") {
          if (g.flag("shimenawaCut")) { g.say("注連縄は、もう切ってある。"); return true; }
          g.set("shimenawaCut");
          g.say("鎌の刃を、注連縄に当てて、引いた。ぶつりと、繊維が切れた。\n切れた縄の先から、水が、ぽたり、と落ちた。", "sub");
          g.dread(1);
          return true;
        }
        if (id === "kuranokagi") {
          if (g.flag("kuraUnlocked")) { g.say("もう外れている。"); return true; }
          g.set("kuraUnlocked");
          g.say("鍵を錠前にさしこむと、思ったよりも軽く、回った。\nかちり、と、乾いた音がして、錠が、外れた。", "sub");
          return true;
        }
        if (id === "abura") return Kura.burnTry(g);
        return false;
      },
    },
  });
  item("mizo", "溝", ["溝", "石組みの溝", "排水溝"], {
    loc: "kuramae", scenery: true,
    desc: "蔵の戸の下に、石組みの浅い溝。ここへ水を流すのが、務めの一部のようだ。溝の先は、石段の下の暗がりへ消えている。",
    on: {
      usedWith: (g, id) => {
        if (id === "oke") return Kura.pourWater(g);
        return false;
      },
    },
  });
  item("shimenawa", "注連縄", ["注連縄", "しめ縄", "縄"], {
    loc: "kuramae", scenery: true,
    desc: g => g.flag("shimenawaCut") ? "切れた注連縄が、足もとで、まだ、湿っている。" : "稲藁を太く編んだ注連縄。紙垂のひとつが、いまも濡れて、重たそうに垂れている。",
    on: {
      usedWith: (g, id) => { if (id === "kama") return g.item("kura_no_to").on.usedWith(g, "kama"); return false; },
    },
  });

  room("kura1", {
    name: "蔵の一階", indoor: true,
    desc: g => "分厚い土壁に囲まれた、広い土間。高い天井の梁は、黒光りしている。奥に、小さな机と座布団。階段が、二階へ上がっている。床の中央に、四角い板蓋がある。\n戸の外は、南。\n湿った空気のなかに、井戸のような、深いにおいがする。",
    exits: { s: "kuramae", u: "kura2", d: { to: "kura_b", show: g => !!g.flag("hatchOpen2"), if: g => !g.flag("hatchOpen2") ? "床の板蓋は閉まっている。" : (g.has("nagagutsu") ? true : "下の水は、刺すように冷たそうだ。長靴がないと、足を入れていられない。") } },
    dark: true,
    darkMsg: "戸口から入る光だけでは、何も見えない。灯りが要る。",
    listen: g => g.night() ? "床の下から、水が静かに、のぼってくる音がする。" : "床の下で、水が揺れる音がしている。",
    on: {
      sit: g => { Kura.sitKeeper(g); return true; },
      enter: g => { if (!g.flag("kuraEntered")) { g.set("kuraEntered"); g.say("背後で、戸が、軽く、きしんだ。", "warn"); } },
    },
  });
  item("kura_tsukue", "小さな机", ["机", "小さな机", "文机"], {
    loc: "kura1", scenery: true, container: true, openable: true,
    desc: "座布団の前に、小さな机がある。使い込まれて、角が丸い。ここに、毎晩、誰かが座っていた。",
    openMsg: "引き出しを引いた。",
    onOpen: g => { g.reveal("nikki3"); },
  });
  item("zabuton", "座布団", ["座布団", "ざぶとん"], {
    loc: "kura1", scenery: true,
    desc: "擦り切れた座布団。真ん中が、ちょうど人の形に、へこんでいる。いまも、少し、温かいような気がした。",
  });
  item("nikki3", "ハツの最後の日記", ["日記", "最後の日記", "日記帳", "ノート"], {
    loc: "in:kura_tsukue", take: true, hidden: true,
    desc: "表紙に、「しまい」とだけ書かれたノート。",
    text: g => {
      g.set("diary3Read");
      g.learn("keeper"); g.learn("suikyo");
      g.clue("diary3", "ハツの最後の日記：蔵守は、水鏡のそばに座り、二十二人目として「数えられる」ことで、水を鎮める。あるいは、水鏡を底の社へ返し、二十一人の名を読めば、みなが帰れる。");
      g.tick(1);
      return "『しまい』\n\n『蔵守は、鏡のそばで座って、数えつづける者。数えられる側の二十一人のほかに、二十二人目として、ここにいる者のことだ。だれかが座れば、水はしずまる。』\n\n『けれど、ほんとうは、ちがう。鏡を、底の社に返せばいい。底の社は、水が引けば、見える。日照りの年に、見えたことがある。』\n\n『返すとき、二十一人の名を、ひとり残らず、呼ばなくてはいけない。名前をわたしは、ぜんぶ、おぼえていた。けれど、みおの名だけ、呼べなかった。声が、出なかった。だから、帰れないままなのだ。』\n\n『あの子（孫のこと）には、これを読んでほしくない。けれど、読むなら、鏡はひとりでは重い。籠を使いなさい。夜でなければ、動かない。』\n\n『みおの名札は、桐の箱にある。あの子に、返してやってほしい。』";
    },
  });
  item("kura_ita", "床の板蓋", ["板蓋", "板", "蓋", "床", "床の板蓋", "地下"], {
    loc: "kura1", scenery: true,
    desc: g => g.flag("hatchOpen2") ? "板蓋は、開いている。下へ、石の段が続いている。水のにおいが、強くなる。" : "床の中央に、四角い板蓋がある。取っ手がついている。",
    on: {
      pull: g => {
        if (g.flag("hatchOpen2")) { g.say("もう開いている。"); return true; }
        g.set("hatchOpen2");
        g.say("取っ手を引いた。板蓋は、重たくはずれて、石の階段が、下へ続いているのが見えた。\n冷気が、一気に、あふれてきた。", "sub");
        return true;
      },
      open: g => { g.act("pull", "kura_ita"); return true; },
    },
  });

  room("kura2", {
    name: "蔵の二階", indoor: true,
    desc: "低い天井の、細長い二階。棚が三段に組まれ、ずらりと、ものが並んでいる。茶碗、櫛、下駄、人形、眼鏡、位牌……\n一階へ、階段が降りている。",
    exits: { d: "kura1" },
    dark: true,
    darkMsg: "暗くて、何も見えない。ただ、たくさんのものの気配だけがある。",
    listen: "棚のものたちが、いっせいに、こちらを見た気がした。",
  });
  item("kura_tana", "三段の棚", ["棚", "三段の棚", "品", "品々", "遺品"], {
    loc: "kura2", scenery: true,
    desc: g => {
      g.dread(1);
      g.learn("meibo");
      g.clue("kuratana", "蔵の二階の棚に、二十一人の遺品が並んでいる。ひとつひとつに、墨で名前が書かれている。");
      return "二十一の品が、きちんと並べられている。茶碗、櫛、下駄、人形、眼鏡、位牌。ひとつずつに、紙が結んである。\n名前が、書かれている。\n「タケ」「ヨシゾウ」「ふみ」「源七」「サダ」……\nひとつも、読み上げる気になれない。読み上げたら、返事が、返ってきそうだ。\n端の人形には、紙がついていない。胸に、名札を縫いつけたあとの、穴だけがある。";
    },
  });
  item("ningyo", "紙のない人形", ["人形", "端の人形", "紙のない人形"], {
    loc: "kura2", scenery: true,
    desc: "着物を着た、小さな人形。胸に、名札を縫いつけたらしい、針の穴がある。名札は、ない。",
    on: {
      usedWith: (g, id) => {
        if (id === "nafuda") {
          g.say("人形の胸に、名札を当ててみた。針の穴が、ぴったり合った。\n人形が、ほんの少し、笑ったように見えた。", "sub");
          g.set("ningyoDone");
          return true;
        }
        return false;
      },
    },
  });

  room("kura_b", {
    name: "水の間", indoor: true,
    desc: g => "石積みの円い部屋。壁に沿って、細い石の足場が一巡している。その内側は、窪んだ池のように、水に満たされている。水は、黒く、澄んでいる。\n池の真ん中の石の台座に、丸い、青銅の鏡が据えられている。鏡面は、水に向かって寝かせてある。\n階段は、上へ。" + (g.flag("drawdown") ? "\n水位が、すこし下がっている。東の壁に、人が通れるほどの、四角い穴が、現れている。" : ""),
    exits: {
      u: "kura1",
      e: { to: "suido1", show: g => !!g.flag("drawdown"), if: g => g.flag("drawdown") ? true : "そちらに、道はない。" },
    },
    dark: true,
    darkMsg: "真っ暗だ。灯りがなくては、足を踏み外す。",
    listen: "水の中から、人の声が、折り重なって聞こえる。数を数えているようにも、助けを呼んでいるようにも聞こえる。",
    on: {
      sit: g => { Kura.sitKeeper(g); return true; },
      enter: g => {
        g.say("長靴ごしにも、水の冷たさが、はっきり伝わってくる。", "sub");
      },
    },
  });
  item("suimen", "水面", ["水", "水面", "池", "黒い水"], {
    loc: "kura_b", scenery: true,
    desc: "黒く澄んだ水。覗きこむと、底が見えない。\n水の底に、白いものが、ぼんやり、たくさん揺れている。人の手のようにも、見える。",
    on: { use: g => { g.say("水に手を入れるのは、やめておこう。"); return true; } },
  });
  item("daiza", "石の台座", ["台座", "石の台座", "台"], {
    loc: "kura_b", scenery: true,
    desc: "池の真ん中に、丸く削った石が据えてある。上に、青銅の鏡が置かれている。台座には、鏡の形に合わせた浅い窪みが、彫られている。",
  });
  item("suikyo", "水鏡", ["鏡", "水鏡", "青銅の鏡", "青銅鏡"], {
    loc: "kura_b", scenery: true,
    desc: g => {
      g.learn("suikyo");
      return "掌を二つ並べたほどの、丸い青銅の鏡。裏面には、波の文様が刻まれている。\n水面に向けて寝かせてあるので、鏡面は見えない。\n台座から離そうとすると、まるで水の底に根を張っているように、びくともしなかった。\n──夜でなければ、動かない。日記には、そうあった。";
    },
    on: {
      take: g => Kura.takeMirror(g),
    },
  });
  item("nagagutsu_placeholder", "水の間の足場", ["足場", "石の足場"], {
    loc: "kura_b", scenery: true, desc: "苔むした、細い石の足場。水が、足の下まで来ている。",
  });
});
