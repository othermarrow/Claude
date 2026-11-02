// village.js — 『蔵守』の世界：集落・寺・分校・ダム・底の集落。
"use strict";

Kura.define(w => {
  const room = (id, d) => w.room(id, d);
  const item = (id, name, words, d) => w.item(id, Object.assign({ name, words }, d));
  const topic = (id, name, words) => w.topic(id, { name, words: words || [] });

  topic("kura", "蔵", ["蔵"]);
  topic("mizu", "水の音", ["水の音", "水"]);
  topic("tsutome", "夜の務め", ["務め", "夜の務め"]);
  topic("kagi", "蔵の鍵", ["鍵", "蔵の鍵"]);
  topic("hatsu", "ハツ", ["ハツ", "祖母"]);
  topic("mio", "みお", ["みお"]);
  topic("dam", "ダム", ["ダム", "湖"]);
  topic("suikyo", "水鏡", ["水鏡", "鏡"]);
  topic("sokonoyashiro", "底の社", ["底の社", "底", "社"]);
  topic("keeper", "蔵守", ["蔵守", "守り"]);
  topic("meibo", "二十一人の名", ["名前", "名簿", "二十一人", "名"]);

  // ------------------------------------------------------------------
  // 集落
  // ------------------------------------------------------------------
  room("michi", {
    name: "村道", indoor: false, moon: true,
    desc: "集落をつらぬく、舗装のない一本道。両側に、屋根の落ちかけた空き家が並んでいる。人の気配が、ほとんどない。\n北は柏木の家へ登る坂。西に小さな家、東に集会所。南へ道は、辻に出る。",
    exits: { n: "gate", w: "tome_house", e: "shukaijo", s: "tsuji" },
    listen: "犬も、鳥も、鳴かない。ただ、沢の音だけが、地面の下から聞こえる。",
  });
  item("akiya", "空き家", ["空き家", "家", "屋根"], {
    loc: "michi", scenery: true,
    desc: "雨戸が閉まったまま、庭に草が茂っている。どの家の軒下にも、同じ大きさの、乾かない染みがある。",
  });

  room("tome_house", {
    name: "トメの家", indoor: true,
    desc: "小さな平屋。土間に、囲炉裏のある板の間。火は、小さく、燃えている。神棚に、水のはいった湯呑みがひとつ。\n東は村道。",
    exits: { e: "michi" },
    dark: g => g.night(),
    listen: "囲炉裏の炭が、ぱち、と鳴った。",
  });
  item("irori", "囲炉裏", ["囲炉裏", "火"], {
    loc: "tome_house", scenery: true,
    desc: "小さな火が、静かに燃えている。この家だけは、水のにおいがしない。塩と、煙のにおいがする。",
    on: { use: g => { g.say("手をかざした。あたたかい。気持ちが、ほぐれてくる。", "sub"); g.dread(-3); g.tick(1); return true; } },
  });
  item("kamidana", "神棚", ["神棚", "湯呑み"], {
    loc: "tome_house", scenery: true,
    desc: "神棚の湯呑みの水は、干上がって、底に白い塩の輪だけが残っている。トメが、毎日取り替えているらしい。",
  });

  room("shukaijo", {
    name: "集会所", indoor: true,
    desc: "コンクリート造りの、小さな集会所。長机がいくつかと、折り畳みの椅子。壁には、掲示板と、色あせた古い地図が貼られている。\n西は村道。北へ、石段が上がっている。",
    exits: { w: "michi", n: "suijinja" },
    dark: g => g.night(),
    listen: "掲示板のピンが、ひとつ、からりと落ちた。",
  });
  item("keijiban", "掲示板", ["掲示板", "ポスター", "貼り紙"], {
    loc: "shukaijo", scenery: true,
    desc: g => {
      g.set("posterSeen");
      g.clue("poster", "集会所のポスター：「眞木沢ダム　竣工記念　昭和三十五年」。");
      return "古いポスターが、何枚か重ねて貼られている。\n一番上の、いちばん新しい紙は、役場の『ダム設備点検のお知らせ』。\nその下に、茶色く変色したポスターがある。\n『眞木沢ダム　竣工記念　昭和三十五年十月』\n真ん中に、完成したばかりのダムの写真。コンクリートの壁が、白く、誇らしげに光っている。";
    },
  });
  item("kirinuki", "新聞の切り抜き", ["切り抜き", "新聞", "記事", "新聞の切り抜き"], {
    loc: "shukaijo", take: true, here: "長机の上に、色あせた新聞の切り抜きが、一枚、広げられている。",
    desc: "茶色くなった、新聞の切り抜き。",
    text: g => {
      g.learn("sokonoyashiro"); g.learn("meibo");
      g.clue("kirinuki", "新聞の切り抜き：昭和三十四年六月、ダム貯水の夜、底の集落の社に避難しなかった住民二十一名が、増水で亡くなった。");
      g.tick(1);
      return "『眞木沢ダム　貯水開始の夜　増水により、底集落の住民二十一名が死亡』\n\n昭和三十四年六月二十日、眞木沢ダムの貯水が始まった夜、水没予定地の「底」集落で、避難勧告に従わず、水神を祀る社にとどまっていた住民二十一名が、急な増水で亡くなった。遺体の一部は、いまだ見つかっていない。\n\n記事の端に、鉛筆で、小さな字が書き足されている。『名をよべ』";
    },
  });
  item("chizu", "古い地図", ["地図", "古い地図", "壁の地図"], {
    loc: "shukaijo", scenery: true,
    desc: "手描きの、村の地図。谷の底に、いまは湖になった場所が描かれている。\n湖のなかに、小さな丸と、「底」の字と、鳥居の印。\n社の位置は、いまのダム湖の、堤から見て、ちょうど真下に当たる。",
  });

  room("suijinja", {
    name: "水神社", indoor: false, moon: true,
    desc: "石段を上がった先の、小さな神社。鳥居の脇に手水舎、奥に、小さな祠。\n祠の中は、がらんとしている。奉納された絵馬が、風もないのに、かたかたと揺れている。\n南の石段を降りれば、集会所へ戻れる。",
    exits: { s: "shukaijo" },
    listen: "絵馬が、かたかた、と鳴る。それが、いつのまにか、数を数えるリズムに聞こえる。",
    on: { pray: g => { g.say("祠に向かって、手を合わせた。返事のかわりに、水の音が、わずかに止んだ。", "sub"); g.dread(-1); return true; } },
  });
  item("hokora", "祠", ["祠", "社", "社殿", "御神体"], {
    loc: "suijinja", scenery: true,
    desc: g => {
      g.learn("suikyo");
      return "祠の扉は、開いている。中に、ご神体はない。丸い石の台座に、鏡の形の、浅いへこみだけが残っている。\nここにあるはずのものが、よそへ移されたのだ。";
    },
  });
  item("ema", "絵馬", ["絵馬"], {
    loc: "suijinja", scenery: true,
    desc: g => {
      g.set("emaSeen"); g.learn("sokonoyashiro");
      g.clue("ema", "水神社の絵馬：水底の社の絵。石の台座に、鏡を寝かせて置く形が描かれている。「水鏡をかえせ」と読める。");
      return "絵馬が、一枚だけ、ほかのものと違う。子どもの字で、水底の社が描かれている。\n石を三つ組んだ台座の上に、丸い鏡が、水面に向けて、寝かせて置かれている。\n絵の隅に、書いてある。\n『みずかがみを　かえして　なまえを　よんで』";
    },
  });
  item("saisenbako", "賽銭箱", ["賽銭箱", "賽銭", "箱"], {
    loc: "suijinja", scenery: true,
    desc: "賽銭箱の底に、五円玉が何枚か。そのうちの一枚だけ、濡れて、青く光っている。",
  });
  item("chozuya", "手水舎", ["手水舎", "手水", "水"], {
    loc: "suijinja", scenery: true,
    desc: "手水舎の水は、石の鉢から、上へ向かって、少しずつ満ちている。あふれたことは、一度もないらしい。",
  });

  room("tsuji", {
    name: "辻", indoor: false, moon: true,
    desc: "道が三つに分かれる辻。小さなお地蔵さまが、石の祠に立っている。\n北は村道。西に石段、寺へ。東は、廃校の分校。南は、川へ降りる道。",
    exits: { n: "michi", w: "sanmon", e: "koutei", s: "kawa" },
    listen: "お地蔵さまの足もとで、水が、じわじわと湧いている。",
  });
  item("jizo", "お地蔵さま", ["地蔵", "お地蔵さま", "お地蔵"], {
    loc: "tsuji", scenery: true,
    desc: "苔むした、小さな石のお地蔵さま。前掛けは、新しく、赤い。それなのに、びっしょりと濡れて、重たそうだ。",
    on: { pray: g => { g.say("お地蔵さまに手を合わせた。前掛けから、雫が、ひとつ、落ちた。", "sub"); g.dread(-1); return true; } },
  });

  room("sanmon", {
    name: "山門", indoor: false, moon: true,
    desc: "苔のついた石段の上の、小さな山門。『正念寺』の額が掛かっている。\n東は辻へ降りる石段。北には、本堂。",
    exits: { e: "tsuji", n: "hondo" },
    listen: "風に、木の葉の擦れる音。……水の音は、ここでは、すこし遠い。",
  });

  room("hondo", {
    name: "本堂", indoor: true,
    desc: "畳敷きの、静かな本堂。ご本尊の前に、蝋燭が一本。\n壁ぎわの経机の上に、分厚い帳面が置かれている。\n南は山門。東の戸から、墓地へ出られる。",
    exits: { s: "sanmon", e: "bochi" },
    dark: g => g.night(),
    listen: "木魚の音が、どこかで、ゆっくりと響いている。",
    on: {
      pray: g => { g.say("本尊に手を合わせた。ひとつ息をつくと、肩の力が抜けた。", "sub"); g.dread(-3); return true; },
    },
  });
  item("juushoku", "住職", ["住職", "和尚", "お坊さん", "坊さん"], {
    loc: "hondo", npc: true, scenery: true,
    here: "本堂の隅に、袈裟姿の老僧が、静かに座っている。",
    desc: "痩せた老僧。目は穏やかだが、膝の上に置いた数珠を握る手が、細かく、震えている。",
    on: {
      talk: g => { Kura.juushokuTalk(g); return true; },
      ask: (g, topic) => { Kura.juushokuAsk(g, topic); return true; },
    },
  });
  item("kakocho", "過去帳", ["過去帳", "帳面", "帳簿"], {
    loc: "hondo", scenery: true,
    desc: g => g.flag("juushokuTrust") ? "寺の過去帳。住職は、見てよい、と手で示している。" : "分厚い、和綴じの過去帳。住職が、さりげなく、手のひらで覆っている。",
    on: {
      read: g => {
        if (!g.flag("juushokuTrust")) { g.say("住職が、そっと過去帳を、あなたの手から遠ざけた。まだ、見せてもらえないらしい。"); return true; }
        if (g.flag("namesCopied")) { g.say("もう、書き写してある。"); return true; }
        g.set("namesCopied");
        g.move("meibo_copy", "held");
        g.learn("meibo");
        g.clue("meibo", "過去帳から、昭和三十四年六月二十日に亡くなった二十一人の名を、手帳に書き写した。声に出して読めば、呼べる。");
        g.tick(1);
        g.say("過去帳をめくる。昭和三十四年六月二十日の欄に、二十一の名が、並んでいる。\n手帳に、ひとつずつ、書き写した。\n書き写す手が、途中で、止まった。最後の名が、あまりにも、小さな字だったからだ。\n『みお　八つ』", "doc");
        return true;
      },
      use: g => { g.act("read", "kakocho"); return true; },
    },
  });
  item("juzu", "数珠", ["数珠", "じゅず"], {
    take: true, desc: "黒い珠を連ねた、手に馴染む数珠。ひと粒ずつが、あたたかい。",
    on: {
      use: g => {
        g.say("数珠を握って、目を閉じた。胸のなかの水の音が、すこし遠のいた。", "sub");
        g.dread(-3);
        return true;
      },
    },
  });
  item("meibo_copy", "名簿の写し", ["名簿", "名簿の写し", "写し", "名前"], {
    desc: "手帳に写した、二十一人の名。紙の上の字が、ときどき、にじんで見える。",
    on: {
      read: g => Kura.readNames(g),
      use: g => Kura.readNames(g),
    },
  });

  room("bochi", {
    name: "墓地", indoor: false, moon: true,
    desc: "斜面にならんだ、古い墓石。つい最近、土を盛りなおしたばかりの墓がひとつ。\n西は本堂。",
    exits: { w: "hondo" },
    listen: "どの墓石の下からも、同じ速さで、水が滴る音がしている。",
    on: { pray: g => { g.say("真新しい墓の前で、手を合わせた。「柏木ハツ」と刻まれている。\n返事は、ない。それでも、気持ちが、すこし、整った。", "sub"); g.dread(-2); return true; } },
  });
  item("hatsu_haka", "ハツの墓", ["墓", "ハツの墓", "墓石", "新しい墓"], {
    loc: "bochi", scenery: true,
    desc: "「柏木家之墓」の脇に、真新しい戒名の板。土の上に、濡れた足跡がひとつ、墓石のほうへ向いて、残っている。……見送りに来たのが、誰なのかは、わからない。",
  });
  item("mu_en_haka", "名のない小さな墓", ["小さな墓", "名のない墓", "無縁墓"], {
    loc: "bochi", scenery: true,
    desc: "隅に、名前の彫られていない、小さな墓石がひとつ。誰も供えなかったはずなのに、白い花が、ひとつ置かれている。",
  });

  room("koutei", {
    name: "分校の校庭", indoor: false, moon: true,
    desc: "草の伸びた校庭に、鉄棒とぶらんこが、ぽつんと残っている。木造の校舎が、静かに、うずくまっている。\n校舎の入り口は、北。西は辻。",
    exits: { w: "tsuji", n: "classroom" },
    listen: "ぶらんこの鎖が、きい、きい、と鳴っている。誰も、乗っていない。",
  });
  item("buranko", "ぶらんこ", ["ぶらんこ", "ブランコ"], {
    loc: "koutei", scenery: true,
    desc: "ぶらんこは、ゆっくりと前後に揺れている。風は、ない。さっきまで、誰かが乗っていたような揺れかただ。",
  });
  item("tetsubo", "鉄棒", ["鉄棒"], {
    loc: "koutei", scenery: true, desc: "錆びた鉄棒。握ると、手のひらに、冷たい水の感触が残る。",
  });

  room("classroom", {
    name: "教室", indoor: true,
    desc: "分校のたった一つの教室。小さな机と椅子が、いくつも並んでいる。黒板には、白墨の字が、うっすら残っている。\n窓の外に、校庭が見える。\n南は校庭。",
    exits: { s: "koutei" },
    dark: g => g.night(),
    listen: g => g.S.phase === "夕" ? "どこかで、ひとり分の、小さな足音がしている。" : "壁の時計が、止まっている。",
  });
  item("kokuban", "黒板", ["黒板", "白墨", "歌"], {
    loc: "classroom", scenery: true,
    desc: g => {
      g.set("songSeen"); g.learn("keeper");
      g.clue("kokuban", "黒板のかぞえ歌：「二十一まで数えたら、のこりのひとつは、かみさまの」。二十二人目は、守り手。");
      return "黒板に、子どもの字が、薄く残っている。\n『ひとつひろって　ふたつひろって\nみっつ　よっつ　いつつ　むっつ\n……\nにじゅういち　ひろったら\nのこりのひとつは　かみさまの\nにじゅうに　かぞえて　もりびとに』";
    },
  });
  item("tsukue_mio", "名前の刻まれた机", ["机", "みおの机", "名前の机"], {
    loc: "classroom", scenery: true,
    desc: "窓ぎわの小さな机。天板に、爪でひっかいたような字で、「みお」とある。\n机の上だけ、乾いている。",
  });
  item("mio", "みお", ["みお", "女の子", "少女", "子ども", "子供"], {
    loc: "classroom", npc: true, scenery: true,
    hidden: g => g.S.phase !== "夕",
    here: "窓ぎわの机に、八つくらいの女の子が、ちょこんと座っている。",
    desc: "白い服の、小さな女の子。髪も、服も、ぐっしょり濡れている。足もとに、水たまりができていない。胸のあたりに、名札のあと。",
    on: {
      talk: g => { Kura.mioTalk(g); return true; },
      give: (g, id) => {
        if (id === "nafuda") {
          g.move("nafuda", null);
          g.set("mioHelped");
          g.learn("mio");
          g.clue("mio", "みおに名札を返した。みおは、「みんな、名前をよばれたら、帰れる」と言い、「あとひとつ、おはじき」とつぶやいた。");
          g.say("名札を差し出すと、女の子は、両手で、そっと受け取った。\n胸に当てると、名札は、すうっと、布の上にとけて、そこにあったように、しっかり縫いつけられた。\n「……ありがとう」\n小さな声だった。\n「ハツちゃんが、もってて くれたんだ。わたしの」\n「ね、おねがい。みんなの名前を、よんで。かがみを、かえして。そうしたら、みんな、かえれる。わたしの名前は、さいごに、よんで」\n女の子は、にこっと、笑った。\n「あとひとつ、おはじきも。ひとつだけ、たりないの」", "doc");
          g.dread(-3);
          return true;
        }
        if (id === "ohajiki21") {
          if (!g.flag("mioHelped")) { g.say("女の子は、おはじきを見て、すこし首をかしげた。「……まず、なふだ、ほしいな」"); return true; }
          g.move("ohajiki21", null);
          g.set("mioFull");
          g.clue("mio2", "みおに二十一個目のおはじきを返した。");
          g.say("青いおはじきを渡すと、女の子の顔が、ぱっと明るくなった。\n「これ！ わたしの、だいじなやつ」\n握りしめて、笑う。\n「ありがとう。……夜、底で待ってる」", "doc");
          return true;
        }
        return false;
      },
      ask: (g, topic) => { Kura.mioAsk(g, topic); return true; },
    },
  });

  room("kawa", {
    name: "川端", indoor: false, moon: true,
    desc: "細い川にかかった、小さな橋のたもと。水は、澄んで、冷たく、速い。\n北は辻。東にバス停。西に、山へ入る林道。",
    exits: { n: "tsuji", e: "basutei", w: "rindo" },
    listen: "川の音。それなのに、水が流れていく向きが、いつも、上流のほうを向いて聞こえる。",
  });
  item("kawa_mizu", "川", ["川", "水", "橋"], {
    loc: "kawa", scenery: true,
    desc: "覗きこむと、川底の石の一つひとつに、細い白いものが巻きついているように見える。……藻だ。藻に決まっている。",
  });

  room("basutei", {
    name: "バス停", indoor: false, moon: true,
    desc: "草むらの端に、色あせた標識と、木のベンチ。時刻表には、朝と夕方の、二便だけが載っている。\n西は川端。",
    exits: { w: "kawa" },
    listen: "遠く、山の向こうで、車のエンジンの音がしたような気がする。",
    on: {
      wait: g => {
        const ph = g.S.phase;
        if (ph === "朝" || ph === "夕") {
          g.say("ベンチに座って、バスを待った。\nしばらくして、山の向こうから、エンジンの音が近づいてくる。", "sub");
          g.ask("bus");
          return true;
        }
        g.say("ベンチに座って、しばらく待った。バスは、来ない。時刻表によると、次の便は、朝か夕方だ。", "sub");
        return true;
      },
    },
  });
  item("jikokuhyo", "時刻表", ["時刻表", "標識", "ベンチ"], {
    loc: "basutei", scenery: true,
    desc: "朝と夕の、一日二便だけ。このバスに乗れば、町へ戻れる。……そのまま、この村のことを、忘れてしまうこともできる。\n（バスを待つには「待つ」。朝か夕方だけ、来る）",
  });

  room("rindo", {
    name: "林道", indoor: false, moon: true,
    desc: "杉林の中の、荒れた林道。わだちに、水が溜まっている。\n東は川端へ戻る道。北に、コンクリートの建物が見える。",
    exits: { e: "kawa", n: "dam_office" },
    listen: "どこか上のほうで、水の落ちる音がしている。",
  });

  room("dam_office", {
    name: "ダム管理棟の前", indoor: false, moon: true,
    desc: "コンクリートの、小さな管理棟。ひさしの下の鉄の扉に、テンキー式の錠がついている。\n南は林道。北へ、ダムの堤に上がる階段がある。",
    exits: { s: "rindo", n: "dam_top", e: { to: "kanri", show: g => !!g.flag("damDoorOpen"), if: g => g.flag("damDoorOpen") ? true : "扉は、閉まっている。" } },
    listen: "コンクリートの壁の向こうから、重たく、水のうなる音。",
  });
  item("tenkey", "テンキー", ["テンキー", "鍵", "扉", "錠", "暗証番号", "ドア"], {
    loc: "dam_office", scenery: true,
    desc: g => g.flag("damDoorOpen") ? "鍵は、外れている。" : "四桁の暗証番号を入れる、ボタン式の錠。扉の脇に、小さなシールが貼ってある。『職員以外立入禁止　暗証番号は、竣工の年』",
    on: {
      use: g => {
        if (g.flag("damDoorOpen")) { g.say("もう開いている。"); return true; }
        g.say("ボタンの前に立った。四桁の数字を入れるのだろう。", "sub");
        g.ask("code");
        return true;
      },
      open: g => { g.act("use", "tenkey"); return true; },
    },
  });

  room("kanri", {
    name: "管理室", indoor: true,
    desc: "管理棟の、小さな制御室。壁一面に、計器とスイッチがならんでいる。事務机の上に、分厚い手順書。\n西は外。",
    exits: { w: "dam_office" },
    dark: g => g.night() && !g.flag("damPower"),
    listen: "計器のなかで、針が、ゆっくりと震えている。",
  });
  item("tejunsho", "手順書", ["手順書", "マニュアル", "書類", "冊子"], {
    loc: "kanri", take: false, here: "事務机の上に、手順書が広げてある。",
    desc: "「眞木沢ダム　運転手順書」と書かれた冊子。",
    text: g => {
      g.set("manualRead"); g.learn("dam");
      g.clue("manual", "ダム放流の手順書：主電源→警報→副ゲートの順に操作する。水位が下がるまで、半日ほどかかる。");
      return "『眞木沢ダム　運転手順書（抜粋）』\n\n『点検時の水位低下（臨時放流）』\n1. 主電源を投入する。\n2. 放流警報を鳴らす。（下流への通告）\n3. 副ゲートを開く。\n※水位が目標に達するまで、約半日。\n※完了後、下流の旧堤体の一部が、冠水域から現れることがある。\n\n鉛筆の書き込みがある。『ここの昔の集落が、見えるらしい。ほんとうなら、見たくない』";
    },
  });
  item("seigyoban", "制御盤", ["制御盤", "盤", "レバー", "スイッチ", "パネル"], {
    loc: "kanri", scenery: true,
    desc: g => g.flag("drawdown") ? "放流は始まっている。計器の針が、ゆっくり、下がっていく。" : "レバーとボタンが並んだ、大きな制御盤。「主電源」「放流警報」「副ゲート」のラベルが貼られている。",
    on: {
      use: g => {
        if (g.flag("drawdown")) { g.say("もう、放流は始まっている。"); return true; }
        g.S.f.panelStep = g.S.f.panelStep || 0;
        g.say("制御盤の前に立った。ラベルを、指でなぞる。", "sub");
        g.ask("panel");
        return true;
      },
    },
  });

  room("dam_top", {
    name: "堤の上", indoor: false, moon: true,
    desc: g => "ダムの堤の上の、細い通路。片側は、ダム湖の水面。反対側は、はるか下の谷。\n南は管理棟。西の端から、湖畔へ降りる道がある。" + (Kura.lakeLow(g) ? "\n湖の水位が、驚くほど下がっている。泥の斜面が、白く、乾きはじめている。斜面の底に、鳥居の跡のようなものが、見える。" : "\n湖の水面は、動かない。奥のほうに、鳥居の先端が、わずかに水から出ている。"),
    exits: { s: "dam_office", w: "kohan" },
    listen: g => Kura.lakeLow(g) ? "水の抜ける、ごうごうという音が、足もとから響いてくる。" : "水面を渡る風の音。それだけだ。",
  });

  room("kohan", {
    name: "湖畔", indoor: false, moon: true,
    desc: g => "ダム湖のほとり。足もとの岸辺は、濡れた砂利で、ところどころに流木が打ち上げられている。\n東は堤の上。" + (Kura.lakeLow(g) ? "\n水が引いた湖底が、泥の道になって、谷の底へ降りていく。その先に、倒れた鳥居と、石の基礎の並びが見える。" : "\n水面は、黒く動かない。"),
    exits: { e: "dam_top", d: { to: "soko", show: g => Kura.lakeLow(g), if: g => Kura.lakeLow(g) ? true : "水に入ることになる。" } },
    listen: "水面から、ひとつぶ、ふたつぶ、と、泡が上がる。",
  });
  item("ryuuboku", "流木", ["流木", "木"], {
    loc: "kohan", scenery: true, desc: "岸に打ち上げられた流木。よく見ると、白く、細い糸のようなものが、からみついている。……髪の毛では、ない。藻だ。",
  });

  room("soko", {
    name: "底の社の跡", indoor: false, moon: true,
    desc: "水の引いた湖底の、谷の底。泥にまみれた石の基礎が、家々の間取りの形に、並んでいる。倒れた石の鳥居。その先に、三つの大きな石を組んだ、低い台座。\n台座の上は、空いている。\n空気は、湿って、冷たい。どこからともなく、数えきれない足音が、あなたのまわりに、集まってきている。",
    exits: { u: "kohan", w: { to: "suido2", show: g => !!g.flag("drawdown") } },
    listen: g => g.flag("mirrorPlaced") ? "水の音が、静かにほどけていく。" : "名を呼ばれるのを待つ、人々の気配。",
  });
  item("soko_daiza", "三つの石の台座", ["台座", "石の台座", "社の台座", "石", "三つの石"], {
    loc: "soko", scenery: true,
    desc: g => g.flag("mirrorPlaced") ? "鏡が、台座に、水面を上に向けて寝かせてある。鏡面に、星の少ない夜空が映っている。" : "三つの石を組んだ台座。上面に、鏡の形に、浅く、丸く窪んでいる。……ここに、あの鏡を、戻すのだ。",
    on: {
      usedWith: (g, id) => {
        if (id === "suikyo") {
          if (g.flag("mirrorPlaced")) { g.say("もう置いてある。"); return true; }
          g.set("mirrorPlaced");
          g.move("suikyo", "soko");
          g.say("籠から、鏡を、そっと降ろした。台座のくぼみに、水面を上に向けて寝かせる。\nカチ、と、驚くほど小さな音がして、鏡は、ぴたりと収まった。\n鏡面に、あなたの顔のかわりに、人々の顔が、いくつも、ゆっくりと、浮かんでは、消えていく。\n足音が、ぴたりと、やんだ。\n……みな、あなたを見ている。名を、呼ばれるのを、待っている。", "doc");
          g.dread(-2);
          return true;
        }
        return false;
      },
    },
  });
  item("kuzureta_torii", "倒れた鳥居", ["鳥居", "倒れた鳥居"], {
    loc: "soko", scenery: true, desc: "石の鳥居が、泥のなかに横倒しになっている。笠木に、びっしりと、小さな貝がついている。",
  });
  item("soko_ato", "家々の基礎", ["基礎", "家々", "跡", "石の基礎"], {
    loc: "soko", scenery: true, desc: "泥のなかに、石の基礎だけが、家の形に、並んでいる。かつては、人が住んでいた。竈の跡の石のうえに、湯呑みがひとつ、ちょこんと、のっていた。",
  });

  room("suido1", {
    name: "水路（手前）", indoor: true,
    desc: "蔵の地下から延びる、石積みの水路。人ひとりがやっと通れる幅で、足もとに、浅く水が流れている。\n西は水の間。東へ、水路は続く。",
    exits: { w: "kura_b", e: "suido2" },
    dark: true,
    darkMsg: "真っ暗だ。灯りがなくては、一歩も進めない。",
    listen: "水路の奥から、足音が、ひたひたと、いくつも近づいてくる。",
  });
  room("suido2", {
    name: "水路（奥）", indoor: true,
    desc: "水路の奥。天井が低く、冷たい風が、前方から吹いてくる。\n西は水路の手前。東へ、風の吹いてくる方へ、道は開けている。",
    exits: { w: "suido1", e: "soko" },
    dark: true,
    darkMsg: "真っ暗だ。灯りがなくては、一歩も進めない。",
    listen: "足もとの水が、東から西へ、逆らって、流れている。",
  });
});
