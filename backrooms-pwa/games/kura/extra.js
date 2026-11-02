// extra.js — 『蔵守』の拡張：七家の旧家・駐在所・郵便局・七つの割符・夢・章の題。
"use strict";

Kura.define(w => {
  const D = Kura.DEFS;
  const room = (id, d) => w.room(id, d);
  const item = (id, name, words, d) => w.item(id, Object.assign({ name, words }, d));
  const topic = (id, name, words) => w.topic(id, { name, words: words || [] });

  topic("nanake", "七家", ["七家", "七軒", "旧家"]);
  topic("wappu", "割符", ["割符", "札"]);

  // 章の題
  D.chapter = { 1: "第一章　水の家", 2: "第二章　底の集落", 3: "第三章　名を呼ぶ" };

  // ------------------------------------------------------------------
  // 道をつなぐ
  // ------------------------------------------------------------------
  D.rooms.michi.exits.d = "roji";
  D.rooms.kawa.exits.s = "chuzaisho";
  D.rooms.shukaijo.exits.e = "yubin";
  D.rooms.michi.desc += "\n坂の途中に、下へおりる細い路地がある。";
  D.rooms.kawa.desc += "\n南の川べりに、小さな駐在所が見える。";
  D.rooms.shukaijo.desc += "\n東の壁の向こうは、郵便局のようだ。";

  // ------------------------------------------------------------------
  // 路地と、ほかの旧家
  // ------------------------------------------------------------------
  room("roji", {
    name: "旧家の路地", indoor: false, moon: true,
    desc: "村道から下りる、細い石畳の路地。両側に、古い門構えの家が向かい合って並んでいる。どの家にも、人の気配はない。\n北の坂を上がれば村道。西の家の表札は「田所」、東は「松岡」。",
    exits: { u: "michi", w: "tadokoro", e: "matsuoka" },
    listen: "路地の石畳の目地から、水が静かににじんでいる。",
  });
  item("roji_ido", "共同の手押しポンプ", ["ポンプ", "手押しポンプ", "井戸"], {
    loc: "roji", scenery: true,
    desc: "路地の突きあたりに、錆びた手押しポンプがある。レバーを押すと、澄んだ水が一筋、出た。……すぐに止んだ。誰かが、向こう側で、押さえたように。",
  });
  item("nanake_hyosatsu", "並んだ表札", ["表札", "門", "田所", "松岡"], {
    loc: "roji", scenery: true,
    desc: g => {
      g.learn("nanake");
      g.clue("nanake", "柏木のほかにも、昔は七軒の旧家（七家）があった。田所・松岡・水野・久保・小野寺・鶴田。");
      return "路地の門の表札を読む。「田所」「松岡」。\n柏木のほかにも、この村には昔、旧家が七軒あったという。ほかの家の名も、どこかで聞いた気がする。水野、久保、小野寺、鶴田。";
    },
  });

  room("tadokoro", {
    name: "田所家", indoor: true,
    desc: "雨戸の外れた廃屋。畳は腐って沈み、柱だけがまっすぐ立っている。奥の仏間に、小さな仏壇が残っている。\n東は路地。",
    exits: { e: "roji" },
    dark: g => g.night(),
    listen: "家の奥で、湯呑みの触れ合うような、小さな音がする。",
  });
  item("tadokoro_butsudan", "田所家の仏壇", ["仏壇"], {
    loc: "tadokoro", scenery: true, container: true, openable: true,
    desc: "扉が半分、はずれた仏壇。位牌は、ひとつもない。かわりに、湯呑みが七つ、きれいに並んでいる。どれにも水が、縁まで入っている。",
    openMsg: "傾いた扉を、あけた。線香の灰の下に、何かが埋まっている。",
    onOpen: g => g.reveal("wappu_tadokoro"),
  });
  item("tadokoro_shashin", "壁の家族写真", ["写真", "家族写真"], {
    loc: "tadokoro", scenery: true,
    desc: "色あせた家族写真。父と母と、子どもが四人。その全員の足もとが、ぼんやり、滲んでいる。裏に、日付。『昭和三十四年　六月十九日』。\n翌日の夜、この家の人は、誰ひとり、帰らなかったのだろう。",
  });

  room("matsuoka", {
    name: "松岡家", indoor: true,
    desc: "土間に囲炉裏のある、古い家。壁に、子どもの描いた絵が、何枚も貼ってある。天井の梁に、縄がひとつ、ぶらさがっている。\n西は路地。",
    exits: { w: "roji" },
    dark: g => g.night(),
    listen: "囲炉裏の灰が、ひとりでに、さらさらと動く。",
  });
  item("matsuoka_irori", "囲炉裏の灰", ["囲炉裏", "灰"], {
    loc: "matsuoka", scenery: true, container: true, openable: true,
    desc: "冷えきった、白い灰。何かが埋まっていそうだ。",
    openMsg: "灰を、手でかきわけた。指先に、硬い板のようなものが、ふれた。",
    onOpen: g => g.reveal("wappu_matsuoka"),
  });
  item("matsuoka_tegami", "松岡家の手紙", ["手紙", "封筒", "松岡家の手紙"], {
    loc: "matsuoka", take: true, here: "囲炉裏のふちに、黄ばんだ手紙が置かれている。",
    desc: "宛名のない、古い手紙。",
    text: g => {
      g.clue("matsuoka", "松岡家の手紙：子ふたりが社へ行ったまま帰らなかった。名を呼ぶことだけが、残された家族の願いだった。");
      return "『……上の子は十一、下の子は八つ。社へ行ったきり、帰りません。\nお上が、水を抜いてくださる日が来たら、名前を、呼んでやってください。\nうちの子の名は、清次と、サダ。……どうか、どうか、ひとりずつ、呼んでやってください』";
    },
  });
  item("matsuoka_e", "壁の絵", ["絵", "壁の絵"], {
    loc: "matsuoka", scenery: true,
    desc: "子どもの描いた絵。家の前で、手をつないだ二人。その上に、水色の線が、波のように、何本も引かれている。",
  });

  // ------------------------------------------------------------------
  // 駐在所
  // ------------------------------------------------------------------
  room("chuzaisho", {
    name: "駐在所", indoor: true,
    desc: "小さな駐在所。机と、書類棚と、古い金庫。壁に、地図と、「尋ね人」の貼り紙が何枚も。\n北は川端。",
    exits: { n: "kawa" },
    dark: g => g.night(),
    listen: "壁の時計が、止まったまま、秒針だけが、ひくひくと震えている。",
  });
  item("nisshi", "巡回日誌", ["日誌", "巡回日誌", "ノート", "帳面"], {
    loc: "chuzaisho", take: true, here: "机の上に、巡回日誌が広げてある。",
    desc: "厚い、緑色の帳面。駐在さんの字だ。",
    text: g => {
      g.learn("nanake"); g.learn("hatsu");
      g.clue("nisshi", "駐在所の日誌：ハツは毎年六月二十日に堤で手を合わせた。金庫の番号は「あの日」の月日、とある。");
      g.tick(1);
      return "『平成十年六月二十日　底の追悼の日。参列者なし。ハツさんだけ、ダムの堤で、ずっと手を合わせていた』\n『平成二十三年八月　柏木ハツ宅より、水の音がするとの通報。異常なし。ただ、蔵の前の地面だけが、濡れていた』\n『平成二年　ダム工事の作業員が一名、柏木家の蔵の前で、行方がわからなくなった。捜索したが、見つからず』\n『令和五年十月　ハツさんから、封のある箱を預かる。「わたしが死んだら、孫に」。金庫に入れた。番号は、「あの日」の月日、とだけ』\n\n欄外に、鉛筆で。『七家の旧家は、いまは、誰も住んでいない。だが、それぞれの家に、割符のようなものが残っているらしい。何かの、まじないか』";
    },
  });
  item("tazunebito", "尋ね人の貼り紙", ["貼り紙", "尋ね人", "紙"], {
    loc: "chuzaisho", scenery: true,
    desc: "色あせた貼り紙が、何枚も重ねてある。『ダム作業員　昭和六十三年』『登山者　平成二年』『釣り人　平成七年』……みな、最後に目撃された場所が、同じ集落の名前になっている。",
  });
  item("kinko", "金庫", ["金庫"], {
    loc: "chuzaisho", scenery: true, container: true, openable: true,
    locked: true, lockedMsg: "四桁の数字の錠がかかっている。（「使う」で番号を入れる）",
    desc: g => g.flag("kinko.unlocked") ? "金庫は開いている。" : "古い、灰色の金庫。四桁の数字を回す錠がついている。",
    on: {
      use: g => {
        if (g.flag("kinko.unlocked")) { g.say("もう開いている。"); return true; }
        g.say("ダイヤルの前に立った。四桁。日誌には、「あの日」の月日、とあった。", "sub");
        g.ask("safe");
        return true;
      },
    },
  });
  item("hatsu_tegami", "ハツの手紙", ["手紙", "封筒", "ハツの手紙", "箱"], {
    loc: "in:kinko", take: true, hidden: true,
    desc: "封のある、白い封筒。表に、「孫へ」と、細い字。",
    text: g => {
      g.set("tegamiRead");
      g.learn("nanake"); g.learn("wappu"); g.learn("suikyo");
      g.clue("tegami", "ハツの手紙：継がずにいてほしい。鏡は底の社へ返し、二十一人の名を呼ぶこと。七家の割符を七つ揃えて台座に置けば、みなが笑って帰れる。無理はしないで。");
      g.tick(1);
      return "『孫へ。\n\nこの手紙を、あなたが読んでいるということは、わたしは、もう蔵のそばには、いないのでしょう。\n\nあなたに、継いでほしくありません。蔵守は、人の一生を、ここに縛ります。わたしは、それでも、後悔はしていません。けれど、あなたには、あなたの人生を。\n\nそれでも、もし、あなたが、この村に来てしまったなら。\n鏡は、底の社へ返してください。二十一人の名を、ひとりずつ、呼んでください。みおの名だけ、わたしは、六十年、呼べませんでした。\n\n七つの旧家には、それぞれ、割符があります。七つ揃えて、台座に置けば、みなが、笑って帰れます。揃わなくても、名を呼べば、帰れます。無理は、しないで。\n\nわたしの、たったひとりの、孫へ。　ハツ』";
    },
  });
  item("kagi_yobi", "ダム管理棟の予備鍵", ["予備鍵", "鍵", "管理棟の鍵"], {
    loc: "in:kinko", take: true, hidden: true,
    desc: "札のついた、小さな鍵。札に「管理棟　予備」とある。",
  });

  // 管理棟の扉は、予備鍵でも開く
  D.items.tenkey.on.usedWith = (g, id) => {
    if (id === "kagi_yobi") {
      if (g.flag("damDoorOpen")) { g.say("もう開いている。"); return true; }
      g.set("damDoorOpen");
      g.say("予備鍵を、鍵穴にさした。かちり、と、扉が外れた。", "sub");
      return true;
    }
    return false;
  };
  D.items.tenkey.on.use2 = () => false;

  w.prompt("safe", {
    q: "金庫の数字を、入れる。（「あの日」の月日は？）",
    options: [
      { label: "0619", words: ["0619"], run: g => safeTry(g, "0619") },
      { label: "0620", words: ["0620"], run: g => safeTry(g, "0620") },
      { label: "0621", words: ["0621"], run: g => safeTry(g, "0621") },
      { label: "1960", words: ["1960"], run: g => safeTry(g, "1960") },
      { label: "やめる", words: ["やめる"], run: g => g.say("ダイヤルから、手を離した。", "sub") },
    ],
  });
  function safeTry(g, code) {
    if (code === "0620") {
      g.set("kinko.unlocked");
      g.set("kinko.open");
      g.reveal("hatsu_tegami"); g.reveal("kagi_yobi"); g.reveal("wappu_mizuno");
      g.say("カチ、カチ、と、ダイヤルが落ちて、重たい扉が、ひらいた。\n中に、封筒と、小さな鍵と、木の札が入っている。", "sub");
    } else g.say("ダイヤルは、回ったが、扉は、開かなかった。", "sub");
    g.tick(1);
  }

  // ------------------------------------------------------------------
  // 郵便局
  // ------------------------------------------------------------------
  room("yubin", {
    name: "郵便局", indoor: true,
    desc: "シャッターの半分おりた、小さな郵便局。窓口の奥に、郵便物の山。局員はいない。\n西は集会所。",
    exits: { w: "shukaijo" },
    dark: g => g.night(),
    listen: "窓口の鈴が、ひとりでに、ちん、と鳴った。",
  });
  item("yubin_yama", "届かない郵便物", ["郵便物", "手紙", "窓口", "山"], {
    loc: "yubin", scenery: true, container: true, openable: true,
    desc: "窓口の奥に、宛先不明の郵便物の、小さな山がある。",
    openMsg: "山の下のほうから、茶色い封筒を、引き出した。",
    onOpen: g => { g.reveal("wappu_kubo"); g.reveal("yubin_tegami"); },
  });
  item("yubin_tegami", "宛先のない手紙", ["手紙", "宛先のない手紙", "封筒"], {
    loc: "in:yubin_yama", take: true, hidden: true,
    desc: "表に「底の社　御中」とだけ書かれた、古い封筒。",
    text: g => {
      g.clue("yubin", "毎年、町の親戚から「底の社」宛の手紙が届いていた。誰も、読む相手がいなかった。");
      return "『底の社の皆さまへ。\n\n今年も、お盆が来ました。うちの子は、大きくなりました。\nあなたたちが、帰ってこられる日を、みんなで、待っています。\n久保　絹』\n\n同じ筆跡の封筒が、何十通も、輪ゴムでとめてある。毎年、送られていたのだ。届く先のない手紙が。";
    },
  });

  // ------------------------------------------------------------------
  // 七つの割符
  // ------------------------------------------------------------------
  const WAPPU = [
    ["wappu_kashiwagi", "柏木", "in:ningyo_hako"],
    ["wappu_tadokoro", "田所", "in:tadokoro_butsudan"],
    ["wappu_matsuoka", "松岡", "in:matsuoka_irori"],
    ["wappu_mizuno", "水野", "in:kinko"],
    ["wappu_kubo", "久保", "in:yubin_yama"],
    ["wappu_onodera", "小野寺", "in:mokugyo"],
    ["wappu_tsuruta", "鶴田", "in:saisenbako"],
  ];
  for (const [id, fam, loc] of WAPPU) {
    item(id, fam + "の割符", ["割符", fam + "の割符", fam + "の札", "札"], {
      loc, take: true, hidden: true,
      desc: "手のひらほどの木の札。「" + fam + "」と墨で書かれ、真ん中で二つに割られた形の、片方だ。割った跡が、水に濡れたように黒い。",
      onTaken: g => {
        const n = WAPPU.filter(x => g.has(x[0])).length;
        g.clue("wappu_" + fam, fam + "の割符を手に入れた（" + n + "/7）。");
        g.learn("wappu");
      },
    });
  }
  // 柏木の割符：人形の名札の裏から出てくる
  item("ningyo_hako", "人形の胸の小箱", ["小箱", "箱", "人形の胸"], {
    loc: "kura2", scenery: true, container: true, transparent: true, hidden: g => !g.flag("ningyoDone"),
    desc: "名札を縫いつけた胸のあたりが、小さな箱のように、ひらいている。",
  });
  D.items.ningyo.on.usedWith = (g, id) => {
    if (id === "nafuda") {
      g.say("人形の胸に、名札を当ててみた。針の穴が、ぴったり合った。\n人形が、ほんの少し、笑ったように見えた。\nすると、胸の布の裏から、小さな木の札が、こつんと、床に落ちた。", "sub");
      g.set("ningyoDone");
      g.reveal("wappu_kashiwagi");
      g.move("wappu_kashiwagi", "kura2");
      return true;
    }
    return false;
  };
  D.items.wappu_kashiwagi.here = "床に、小さな木の札が落ちている。";
  // 小野寺：本堂の木魚
  item("mokugyo", "木魚", ["木魚"], {
    loc: "hondo", scenery: true, container: true, openable: true,
    desc: "朱塗りの大きな木魚。底に、ごく細い継ぎ目がある。",
    openMsg: "木魚を持ち上げて、底の継ぎ目を、爪でこじ開けた。小さな札が、すべり出てきた。",
    onOpen: g => g.reveal("wappu_onodera"),
  });
  // 鶴田：水神社の賽銭箱
  Object.assign(D.items.saisenbako, {
    container: true, openable: true,
    desc: "賽銭箱の底に、五円玉が何枚か。そのうちの一枚だけ、濡れて、青く光っている。",
    openMsg: "賽銭箱の蓋を、持ち上げた。青く光る五円玉の下に、木の札が一枚、敷かれていた。",
    onOpen: g => g.reveal("wappu_tsuruta"),
  });

  // 底の社の台座：割符を置く
  const oldDaiza = D.items.soko_daiza.on.usedWith;
  D.items.soko_daiza.on.usedWith = (g, id) => {
    if (id.startsWith("wappu_")) {
      if (!g.flag("mirrorPlaced")) { g.say("先に、鏡を台座に置こう。", "sub"); return true; }
      let n = 0;
      for (const [wid] of WAPPU) if (g.has(wid)) { g.move(wid, "soko"); n++; }
      g.S.f.wappu = (g.S.f.wappu || 0) + n;
      g.say("台座の縁の、七つの小さな窪みに、割符を、ひとつずつ置いた。（いま " + g.S.f.wappu + " / 7）", "doc");
      if (g.S.f.wappu >= 7) g.say("七つ目を置いたとき、台座の縁が、ぼうっと、白く光った。\n七つの灯が、水のない湖底に、静かにともった。", "doc");
      return true;
    }
    return oldDaiza(g, id);
  };

  // 結末「七つの灯」
  D.endings.return_plus = Object.assign({}, D.endings.return, {
    title: "七つの灯", good: true,
    text: D.endings.return.text.slice(0, 7).concat([
      "七つの灯が、台座の縁で、やさしく揺れていた。\n呼ばれた人々は、その灯の前で、ひとりずつ、あなたに頭を下げた。笑って。柏木の灯の前に、見覚えのある、小さな、丸い背中が立っていた。",
      "「ハツさん」",
      "ハツは、振り返って、あなたを見た。若い頃の顔だった。手を、ずっと、誰かとつないでいる。小さな、濡れた手と。\n「ありがとうね」\nそれだけ言って、ハツは、笑った。",
      "みおと、ハツは、手をつないだまま、鏡のなかへ、歩いていった。\nふたりとも、もう、手を、はなさなかった。",
    ]).concat(D.endings.return.text.slice(7)),
  });
  // 名簿を読む（最後）：割符が揃っていたら別の結末
  const oldRead = Kura.readNames;
  Kura.readNames = g => {
    if (g.S.room === "soko" && g.flag("mirrorPlaced") && g.lit() && (g.flag("wappu") || 0) >= 7) { g.end("return_plus"); return true; }
    return oldRead(g);
  };
  D.items.meibo_copy.on.read = g => Kura.readNames(g);
  D.items.meibo_copy.on.use = g => Kura.readNames(g);

  // ------------------------------------------------------------------
  // 会話：七家・割符
  // ------------------------------------------------------------------
  const oldTomeAsk = Kura.tomeAsk;
  Kura.tomeAsk = (g, topic) => {
    const t = String(topic).replace(/^t:/, "");
    if (t === "nanake") {
      g.say("「七家か。柏木、田所、松岡、水野、久保、小野寺、鶴田。みな、昔は、底の社を守る家だった。いまは、わたししか、残っとらん。……いや、鶴田の血は、わたしだ」", "doc");
      g.tick(1);
      return;
    }
    if (t === "wappu") {
      g.say("「割符は、七家が、それぞれ一枚ずつ、持っとった。社の台座に、七つ揃えて置くと、鏡が、ええ気持ちで、帰るんだ、と聞いた。わたしゃ、見たことはないがね」", "doc");
      g.tick(1);
      return;
    }
    oldTomeAsk(g, topic);
  };

  // ------------------------------------------------------------------
  // 夢：夜が明けるとき
  // ------------------------------------------------------------------
  const wrapDawn = (n, fn) => {
    const old = D.nights[n].dawn;
    D.nights[n].dawn = g => { if (old) old(g); if (!g.S.over) fn(g); };
  };
  wrapDawn(1, g => {
    if (g.flag("duty1")) g.say("夢を見た。\n水のなかに、ふたりの女の子がいた。手をつないで、ゆっくりと、沈んでいく。こわくない。水は、やわらかく、あたたかかった。\n「はなさないで」\n小さな声が、そう言った。", "dream");
    else g.say("夢を見た。\n水のなかで、誰かの手が、あなたの足首を、つかんでいる。つかんでいるのに、引こうとは、しない。ただ、たしかめるように、握っている。\n『ハツちゃん？』\n目が覚めたとき、手のひらが、濡れていた。", "dream");
  });
  wrapDawn(2, g => {
    g.say("夢を見た。\n夜の、底の集落。石段の下に、二十一の影が、正座している。雨の音のような、数を数える声。\n『ひとつ、ふたつ、みっつ……』\n数が終わるたびに、石段の上の、小さな社が、すこしずつ、明るくなる。\n最後の、二十一まで、数え終わっても、社の戸は、開かない。\n誰かが、鍵を、持っている。", "dream");
  });

  // ------------------------------------------------------------------
  // ヒント（末尾に足す）
  // ------------------------------------------------------------------
  w.hint(g => (g.S.day >= 2 && !g.flag("tegamiRead") && g.flag("posterSeen") && !g.flag("kinko.unlocked") && g.S.day === 2 && g.flag("juushokuTrust") ? "川端の南に駐在所がある。日誌と金庫に、ハツの残したものがあるかもしれない。" : null));
  w.hint(g => (g.flag("tegamiRead") && (g.flag("wappu") || 0) < 7 ? "七家の割符は、柏木（蔵二階の人形）・田所と松岡（旧家の路地）・水野（駐在所の金庫）・久保（郵便局）・小野寺（本堂の木魚）・鶴田（水神社の賽銭箱）。底の社で、鏡を置いたあと、台座に使う。" : null));
});
