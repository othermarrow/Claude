// 「野帳」のゲーム本体。yacho/yacho.html の ENGINE BEGIN〜END をそのまま抜き出し、言い回しを少し時計向けにしたもの。
// tools/build-engine.js で作る。直接は直さない。
// ==== ENGINE BEGIN ====
// ゲーム本体。画面（DOM）には触らない。時計版に移すときは、この区切りの中だけを使う。
// io: { loadState(), saveState(obj), loadLoop(), saveLoop(obj) }（どれも失敗してよい）
export function createGame(io) {
  const VERSION = 1;
  const LOOP0 = () => ({ n: 0, last: "", book: [] });
  function loadSaved() { try { return io.loadState(); } catch (e) { return null; } }
  function writeSaved(obj) { try { io.saveState(obj); } catch (e) { /* 残せなくても遊べる */ } }
  function loadLoop() { try { return io.loadLoop() || LOOP0(); } catch (e) { return LOOP0(); } }
  function saveLoop(v) { try { io.saveLoop(v); } catch (e) { /* 残らなくても遊べる */ } }

  // ---- 小さな道具 ----
  const O = {};
  function thing(id, def) {
    O[id] = Object.assign({ id, loc: null, take: false, en: id.toLowerCase(), aliases: [def.name], on: {} }, def);
  }
  const text = v => (typeof v === "function" ? v() : v);
  const held = id => O[id].loc === "player";
  const here = id => O[id].loc === S.loc;
  const rnd = n => Math.floor(Math.random() * n);
  const pick = a => a[rnd(a.length)];
  const DIR_JA = { n: "北", s: "南", e: "東", w: "西", u: "上", d: "下" };
  const DIRS4 = ["n", "s", "e", "w"];

  // ---- レベル（名前と生存難易度は wiki の記事のとおり） ----
  const LEVEL_OF = { y0: "0", y0m: "0", y1a: "1", y1k: "1", y1c: "1", y1x: "1", y1d: "1",
    y2a: "2", y2b: "2", y2c: "2", y2e: "2", y3a: "3", y3s: "3", y3g: "3", y3b: "3", y3e: "3",
    y4a: "4", y4h: "4", y4o: "4", y4s: "4", y5a: "5", y5b: "5", y5c: "5", y6: "6", y6q: "6", y6s: "6", y7: "7", y7w: "7" };
  const LEVEL_INFO = {
    "0": ["敷居", "クラス1"], "1": ["居住可能区域", "クラス1"], "2": ["放棄された設備通路", "クラス3"],
    "3": ["電気設備所", "クラス4"], "4": ["放棄されたオフィス", "クラス1"], "5": ["恐怖のホテル", "クラス2"],
    "6": ["消灯", "クラス未定"], "7": ["海洋恐怖症", "クラス4"],
  };
  const LV = () => LEVEL_OF[S.loc];

  // ---- 野帳に書くこと ----
  // reads: 読んだ・聞いたこと（出どころつき）。lines: 自分で見たこと（A・B・C）。hyp: 見立て。done: 確かめたこと。
  // kind: abc（確かめられる）／open（確かめようがない）／fact（見たことだけ）
  const SRC = {
    photo: "前に見た写真", manila: "マニラの部屋の書き置き", note1: "レベル1の M.E.G. のメモ", board: "基地アルファの掲示",
    board2: "掲示の別紙", partner: "基地アルファで待っている人", e: "基地オメガの実体の棚", lv: "基地オメガのレベルの棚",
    keeper: "ハウスキーピングの隊員", guard: "基地ガンマの隊員", wand: "レベル4のワンダラー",
  };
  const REC = {
    carpet: { t: "カーペット", lv: "0", kind: "fact",
      reads: { photo: "黄色いカーペットの部屋" },
      lines: ["近くで見ると、黄色ではない。茶色がかったベージュ。じっとり湿っている"],
      hyp: "写真で黄色く見えたのは、照明のせいかもしれない" },
    wall: { t: "ちらつく壁", lv: "0", kind: "abc",
      reads: { manila: "ちらつく壁を見つけたら、体ごと投げこむこと" },
      lines: ["壁の一面だけ、照明が三拍ごとに一拍だけ消える", "消えた一拍のあいだ、壁紙の模様が消えて、奥に灰色が見える", "次の拍には、ただの壁紙に戻っている"],
      obs: ["数えてみる。点く、点く、消える。……点く、点く、消える。三拍ごとに、一拍だけ消える。",
        "消えた一拍に、目を凝らす。壁紙の模様が消えて、奥に灰色のコンクリートが見えた。",
        "次の拍には、もう、ただの黄色い壁紙に戻っている。"],
      hyp: "模様の消えた一拍なら、通り抜けられる", done: "模様の消えた一拍に飛びこむと、向こうへ抜けた" },
    crate: { t: "木箱", lv: "1", kind: "abc",
      reads: { note1: "木箱は、中身を全部確かめてから手を入れること" },
      lines: ["振り向くと、さっきまでなかった木箱がある", "中を見ると、瓶や缶にまじって、割れたガラスや妙なものも入っている", "区画を離れて戻ると、木箱はもうない"],
      obs: ["", "", ""],
      hyp: "見ていないあいだに置かれ、見ていないあいだに消える", done: "もう一度振り向くと、また別の木箱があった" },
    arms: { t: "腕", lv: "1", kind: "abc",
      reads: { board: "停電中、通気口や割れ目から腕が出る。後ろや上で音がしたら、光を浴びせろ", board2: "停電中、ホールで灯りを点けるな。ただ一つの光になれば、すぐに死ぬ",
        note1: "停電したら、緑の非常口の灯りへ。灯りは点けずに、壁をつたって" },
      lines: ["停電中、背後の通気口でこすれる音がした", "光が当たると、白い腕が通気口へ引っこんだ", "光が消えると、またこすれる音が出てきた"],
      obs: ["停電の暗闇。息を止めて、背後の通気口に耳を向ける。……こすれる音。何かが、少しずつ出てくる。",
        "遠くで、誰かの懐中電灯が一瞬だけ光った。その光の中で、通気口から伸びかけた白い腕が、びくりと引っこんだ。",
        "光が消えると、こすれる音が、また少しずつ出てくる。"],
      hyp: "光を当てているあいだは来ない。ただ、点けっぱなしの光は、遠くのものも呼ぶ",
      done: "停電のなか、灯りは消したまま壁をつたい、音がしたときだけ照らした。何にも触れられなかった" },
    growler: { t: "グラウラー", lv: "1", kind: "abc",
      reads: { board: "ケーブルでできた生き物。力は強いが、頭は悪い。頭に重い物を落とし、逃げろ" },
      lines: ["一歩近づいた", "ケーブルの束を振り回して唸った。胸の一か所から、ケーブルが枝分かれしている", "下がると、それ以上は追ってこない"],
      obs: ["一歩だけ近づいて、様子を見る。", "ケーブルの束が持ち上がり、唸る。胸のあたりの一か所から、ケーブルが枝分かれして出ている。あそこが頭らしい。",
        "一歩下がる。ケーブルの束は床に戻り、それ以上は追ってこない。"],
      hyp: "近づくものを打つ。追ってくるほどの知恵はない", done: "枝分かれのところに重い物を投げつけると、ふらついた。そのあいだに抜けた" },
    smiler: { t: "スマイラー", lv: "2", kind: "abc",
      reads: { board: "光に寄る。見つかると音にも寄る。落ち着いて、灯りを消すか、投げて囮にしろ", e: "目を合わせたまま、ゆっくり離れること。静かに。灯りは全部消す。慌てて逃げたときと、大きな音を立てたときだけ襲う" },
      lines: ["近くで光が点いた", "光る顔が、その光のほうへ寄った", "光が消えると止まり、暗がりへ戻った"],
      obs: ["すみれ色の非常灯が、じじ、とまたたいて点いた。", "暗がりの顔が、すうっと、そちらへ寄っていく。", "非常灯が消えると、顔はそこで止まり、やがて暗がりの奥へ戻った。"],
      hyp: "光に寄ってくる。暗く静かにしていれば来ない", done: "灯りを消して、静かに横を抜けた" },
    wretch: { t: () => (S.wrName ? "ウレッチ → その人" : "ウレッチ"), lv: "2", kind: "abc",
      reads: { board: "ウレッチは人ではない。声が分かっても、関わるな", partner: "のどが渇くと、怒りっぽくなる人。怒っているときは、たいてい何か欲しいとき",
        e: "元は人。食べ物、水、眠りを奪われ、一人でいるうちに変わる。二つ目の段階では、ことばは水と食べ物と助けを求めるものだけになる。アーモンド水で戻る見込みがある" },
      lines: ["ボトルを手に持って近づいた", "叫んで、ボトルのほうへ腕を伸ばした。顔は見ていない", "ボトルを背中に隠すと、叫ぶのをやめた"],
      obs: ["ボトルを持ったまま、一歩近づく。", "その人は叫び声を上げ、ボトルのほうへ腕を伸ばした。目は、こちらの顔ではなく、ボトルを見ている。",
        "ボトルを背中に隠す。……叫び声がやみ、その人はうずくまった。"],
      hyp: "欲しいのは水。こちらを傷つけたいわけではない（要求）", done: "ボトルを床に置いて下がると、それを飲んで、静かになった" },
    faceling: { t: "顔なし（レベル3）", lv: "3", kind: "abc",
      reads: { board: "顔なし（フェイスリング）は、ほとんどがおとなしい。放っておけ", e: "レベル3の顔なしは、例外なく敵対的",
        guard: "一人で歩くな。追われたら聖所へ。ここの連中は、天使の像を怖がる" },
      lines: ["一人で、エレベーターへの通路へ向かった", "煉瓦を削った槌を構え、まっすぐこちらへ来た", "聖所へ入ると、廊下の手前で止まり、後ずさった"],
      obs: ["", "顔のない者たちを見る。顔に、目のようなくぼみと、口のような裂け目ができかけている。三人とも、槌を構えてこちらへ来る。",
        "像のほうを見たとたん、三人とも、肩をすくめるように後ずさった。"],
      hyp: "ここの顔なしは、人を襲う。聖所の像には近づかない", done: "聖所で待つと、去っていった。それから通路を抜けた" },
    skin: { t: () => (S.sk === 9 ? "厚着の人 → スキンスティーラー" : "厚着の人"), lv: "3", kind: "abc",
      reads: { board: "スキンスティーラーは人の皮をかぶる。話してみろ。人でないと分かったら、静かに下がれ", board2: "一人きりの人影には近づくな。人は、たいてい連れだって歩く",
        e: "血が透明。レベル3のものは、簡単な会話ができ、厚着で正体を隠す" },
      lines: ["衛兵が、門の前で別のワンダラーの指を刺した", "柱の陰の厚着の人は、それを見て一歩下がり、顔をそむけた", "衛兵が門へ戻ると、また柱の陰から出てきた"],
      obs: ["門の前で、衛兵がほかのワンダラーを呼びとめた。指先に針。赤い血がにじむ。",
        "柱の陰の厚着の人は、それを見て一歩下がり、顔をそむけた。この暑さで、厚いコートにフード、サングラス。",
        "衛兵が門へ戻ると、厚着の人は、また柱の陰から出てきた。"],
      hyp: "血を調べられるのを避けている", done: "見たことを衛兵に伝えた。衛兵が近づくと、厚着の人は走り去った。床に、透明なしずく" },
    window: { t: "塗られていない窓", lv: "4", kind: "open",
      reads: { e: "第2記事『窓』。黒く塗られていない窓は罠。何があっても近づくな", wand: "塗ってない窓は見るな。見るだけならまだいいが、近づくな" },
      lines: ["黒く塗られていない窓が、一枚だけある", "外に、見覚えのある道。夕方の光", "目をそらしてもう一度見ると、景色が、こちらの思い浮かべたものに寄っている"],
      obs: ["部屋の入口から、窓を見る。黒く塗られていない窓が、一枚だけある。", "外に、見覚えのある道。夕方の光。",
        "目をそらして、もう一度見る。……景色が、さっきと少し違う。こちらが思い浮かべたものに、寄ってきている。"],
      hyp: "見たいものを見せる。近づかないこと。確かめる方法はない" },
    hound: { t: "ハウンド", lv: "4", kind: "abc",
      reads: { board: "目を合わせ、声を出して威嚇しろ。でなければ、通り道から離れろ", e: "人を見たとたんに敵意を向ける。まっすぐ目を合わせて見すえると、ひるむ。長くはもたないが、離れるだけの時間はできる。見てすぐ逃げるな" },
      lines: ["別のワンダラーが、背を向けて走った", "ハウンドが唸って、跳んだ", "その人が振り向いて目を合わせ、声を出すと、止まった"],
      obs: ["廊下の向こうで、別のワンダラーが、ハウンドに背を向けて走り出した。", "ハウンドは低く唸り、四つ足で跳んだ。",
        "その人は振り向いて、ハウンドの目をにらみ、大声を出した。ハウンドは足を止めた。そのあいだに、その人は扉の向こうへ消えた。"],
      hyp: "背を向けて走ると来る。目を合わせて声を出すと、少しのあいだ止まる", done: "目を合わせたまま、止まっているあいだに基地の扉へ入った" },
    mahjong: { t: "打ちかけの麻雀", lv: "5", kind: "abc",
      reads: { lv: "ビバリールームの麻雀は、終わらせようとしても終わらない。卓が、離れたい気持ちを起こさせる", keeper: "麻雀には手を出さないこと。終わらせようとした人は、みんな途中でやめた" },
      lines: ["卓に近づいた", "一歩ごとに、ここを離れたい気持ちが強くなった", "下がると、その気持ちは消えた"],
      obs: ["卓に向かって、一歩近づく。", "一歩ごとに、ここを離れたい気持ちが強くなる。理由は分からない。", "下がると、その気持ちは、すっと消えた。"],
      hyp: "卓が、人を遠ざけている。終わらせなくていい", done: "手を出さずに、部屋を出た。何も起きなかった" },
    whisper: { t: "炉のささやき", lv: "5", kind: "fact",
      reads: { lv: "ボイラー室の炉から、かすかなささやき。調査中" },
      lines: ["炉の奥から、かすかなささやき声がする", "耳を近づけても、何と言っているかは分からない"],
      hyp: "分からない" },
    dark: { t: () => (S.dk === 3 ? "暗闇でぶつかったもの → 人" : "暗闇でぶつかったもの"), lv: "6", kind: "abc",
      reads: { lv: "暗闇でぶつかってきたものは、人の指で、人の声だったという。あそこが危ないのは、何かがいるからではなく、何もいないから" },
      lines: ["暗闇で、何かとぶつかった", "相手は「来るな」と叫んで、こちらの腕に爪を立てた", "こちらが下がって黙ると、相手の手が離れた"],
      obs: ["", "", "動かずに、耳をすます。息が速い。ときどき、しゃくりあげるような音。……相手も、動かない。"],
      hyp: "怖くて、離れようとしている（逃避）。人かもしれない", done: "離れたまま小さな声で話しかけると、「あなたも、見えないの」と返ってきた。人だった" },
    voice: { t: "スイッチを頼む声", lv: "6", kind: "open",
      reads: { lv: "世界一静かな部屋：スイッチを入れてと頼みつづける人がいるという。入れないこと" },
      lines: ["話しかけた", "「スイッチを入れて」と、同じ調子でくり返した", "こちらが黙ると、声も黙った。問いには一度も答えなかった"],
      obs: ["「誰かいるの？」と声をかける。", "「スイッチを、入れて」。さっきと、同じ高さ、同じ間合い。", "黙って待つ。……声も、黙った。何を聞いても、返ってくるのは同じことばだけだった。"],
      hyp: "頼みなのか、まねなのか、分からない。確かめようがない" },
    deep: { t: "海の二つの影", lv: "7", kind: "open",
      reads: { lv: "浅い層と深い層に、一つずつ大きなものがいる。互いの層では狩りをしない。深いほうは光に、浅いほうは音に弱い" },
      lines: ["ロープにつかまって、水の中を見下ろした", "浅いところを、大きな影がゆっくり横切った。ある深さより下へは行かない", "ずっと下でも、何かが動いた。そちらは、ある深さより上へ来ない"],
      obs: ["ロープにつかまったまま、顔を水につける。ぼんやりした光の中に、何もない水が、どこまでも続いている。",
        "浅いところを、大きな影がゆっくり横切っていった。ある深さまで来ると、向きを変える。それより下へは、行かない。",
        "ずっと下、光の届かないあたりで、別の何かが動いた。そちらも、ある深さより上へは、来ない。"],
      hyp: "二つの影は、互いの深さに入らない。確かめる方法はない" },
  };
  const titleOf = k => text(REC[k].t);
  function rec(k) {
    if (!S.rec[k]) { S.rec[k] = { r: [], s: [false, false, false], at: [0, 0, 0], ok: false, luck: false }; S.recOrder.push(k); }
    return S.rec[k];
  }
  function readRec(k, src) { const r = rec(k); if (!r.r.includes(src)) r.r.push(src); }
  const full = k => !!S.rec[k] && REC[k].lines.every((_, i) => S.rec[k].s[i]);
  function noteMark(t) { say(held("notebook") ? `（野帳に書いた：${t}）` : `（覚えておく：${t}）`, "note"); }
  function see(k, i) {
    const r = rec(k), d = REC[k];
    if (r.s[i]) return false;
    r.s[i] = true; r.at[i] = S.moves;
    noteMark((d.kind === "fact" ? "" : "ABC"[i] + "　") + d.lines[i]);
    emit("write", k);
    if (full(k)) say(`（見立て：${d.hyp}）`, "note");
    return true;
  }
  function verify(k) {
    const r = rec(k), d = REC[k];
    if (r.ok) return;
    if (full(k)) { r.ok = true; say(`（確かめた：${d.done}）`, "note"); emit("verify", k); }
    else if (!r.luck) { r.luck = true; say("（うまくいった。でも、なぜうまくいったのかは、見ていない）", "note"); emit("write", k); }
  }
  function watchNext(k) {
    const r = rec(k), d = REC[k];
    const i = d.lines.findIndex((_, j) => !r.s[j]);
    if (i < 0 || !d.obs[i]) { say(i < 0 ? "しばらく見ていた。新しく分かることは、もうない。" : "見ているだけでは、何も起きない。"); return false; }
    say(d.obs[i]);
    see(k, i);
    return true;
  }
  function recStatus(k) {
    const r = S.rec[k], d = REC[k];
    if (d.kind === "fact") return full(k) ? "事実" : r.s.some(Boolean) ? "見ている" : "読んだ";
    if (r.ok) return "確かめた";
    if (full(k)) return d.kind === "open" ? "分からない" : "見立て";
    if (r.s.some(Boolean)) return "見ている";
    if (r.luck) return "たまたま";
    return "読んだ";
  }
  function recLines(k) {
    const r = S.rec[k], d = REC[k];
    const out = [`■ ${titleOf(k)}（レベル${d.lv}）［${recStatus(k)}］`];
    for (const src of r.r) out.push(`　読んだ　「${d.reads[src]}」（${SRC[src]}）`);
    d.lines.forEach((l, i) => { if (r.s[i]) out.push(`　${d.kind === "fact" ? "見た" : "ABC"[i]}　${l}（手${r.at[i]}）`); });
    if (full(k)) out.push(`　見立て　${d.hyp}${d.kind === "abc" && !r.ok ? "（未確認）" : ""}`);
    if (r.ok) out.push(`　確かめた　${d.done}`);
    else if (r.luck) out.push("　うまくいった。理由は見ていない");
    return out;
  }
  function counts() {
    let read = 0, seen = 0, ok = 0;
    for (const k of S.recOrder) { const r = S.rec[k]; if (r.r.length) read++; if (r.s.some(Boolean)) seen++; if (r.ok) ok++; }
    return { read, seen, ok };
  }
  function bookText(all) {
    if (!held("notebook")) {
      const c = counts();
      return ["野帳は、まだ持っていない。" + (c.seen || c.read ? "見たことと読んだことは、覚えておく。" : ""), "次に見ること：" + hintText()];
    }
    const c = counts();
    const out = [`野帳（読んだ ${c.read}・見た ${c.seen}・確かめた ${c.ok}）`];
    if (!S.recOrder.length) out.push("まだ、白紙。最初のページに「いつも、とは書かない。そのとき、と書く」。");
    if (all) { for (const k of S.recOrder) { out.push(...recLines(k)); } }
    else {
      out.push(S.recOrder.map(k => `${titleOf(k)}［${recStatus(k)}］`).join("　"));
      const lv = LV();
      let focus = S.recOrder.filter(k => REC[k].lv === lv && !S.rec[k].ok);
      if (!focus.length && S.lastRec) focus = [S.lastRec];
      for (const k of focus.slice(0, 2)) out.push(...recLines(k));
    }
    out.push("次に見ること：" + hintText());
    return out;
  }

  // ---- 物 ----
  function initWorld() {
    for (const k of Object.keys(O)) delete O[k];

    // レベル0
    thing("wallpaper0", { name: "壁紙", aliases: ["壁紙", "壁", "wallpaper"], loc: "y0", scenery: true,
      desc: () => S.l0.red ? `${DIR_JA[S.l0.red]}の戸口の向こうでは、壁紙がめくれ、その下から深紅がのぞいている。` : "病的な黄色の壁紙。細い縦じまの模様。どの部屋も、同じ壁紙だ。" });
    thing("carpet0", { name: "カーペット", aliases: ["カーペット", "床", "carpet"], loc: "y0", scenery: true, feel: true,
      desc: "目の詰んだ、硬い織りのカーペット。写真で見たときは黄色かった。近くで見ると、黄色ではない。茶色がかったベージュだ。指で押すと、何かの液体がにじむ。",
      on: { examine: o => { say(o.desc); readRec("carpet", "photo"); see("carpet", 0); return true; }, watch: o => { say(o.desc); readRec("carpet", "photo"); see("carpet", 0); return true; },
        drink: () => { say("カーペットにしみた水には、何が混ざっているか分からない。口をつける気にはなれない。"); return true; } } });
    thing("lights0", { name: "蛍光灯", aliases: ["蛍光灯", "明かり", "lights"], loc: "y0", scenery: true,
      desc: "天井の蛍光灯。ひび割れるようなうなりが、ときどき急に大きくなる。" });
    thing("fwall", { name: "ちらつく壁", aliases: ["ちらつく壁", "壁の照明", "壁", "flickering wall"], scenery: true, feel: true,
      desc: () => "壁の一面だけ、照明がまたたいている。" + phaseText(),
      on: { watch: () => { watchNext("wall"); return true; },
        dive: () => { diveWall(); return true; },
        touch: () => { say(S.l0.fw === 2 ? "模様の消えた壁に触れる。指先が、少しだけ沈んだ。冷たい。" : "壁紙に触れる。湿っていて、ただの壁だ。"); return true; } } });
    thing("wdoor0", { name: "木の扉", aliases: ["木の扉", "扉", "茶色い壁", "wooden door"], scenery: true,
      desc: "黄色い部屋の中に、一面だけ茶色い壁がある。木の扉がついている。扉の向こうから、ピアノ。",
      on: { open: () => { enterManila(); return true; }, listen: () => { say("扉に耳を当てる。静かなピアノ。うなりが、ここだけ薄い。"); return true; } } });
    thing("red0", { name: "赤い戸口", aliases: ["赤い戸口", "赤い部屋", "戸口", "red doorway"], scenery: true,
      desc: () => `${DIR_JA[S.l0.red]}の戸口の向こうが、赤い。そちらへ行くほど、カーペットが厚く、べたついている。壁紙がめくれ、下から深紅がのぞく。見ているだけで、息が浅くなる。`,
      on: { away: () => { say("赤い戸口に背を向ける。……背中に、ねばつくような視線を感じる。"); return true; },
        dive: () => { endRed(); return true; }, open: () => { move0(S.l0.red); return true; } } });
    // マニラの部屋
    thing("table0", { name: "八角形のテーブル", aliases: ["八角形のテーブル", "テーブル", "table"], loc: "y0m", scenery: true,
      desc: "八角形の木のテーブル。天板に、書き置きが何枚も重ねてある。下に戸棚。" });
    thing("chairs0", { name: "椅子", aliases: ["椅子", "二脚の椅子", "chairs"], loc: "y0m", scenery: true,
      desc: "椅子が二脚。一脚は、こちらに背を向けている。テーブルに向かって、誰かを待つように。もう一脚は、扉のほうを向いている。" });
    thing("cupboard", { name: "戸棚", aliases: ["戸棚", "棚", "cupboard"], loc: "y0m", scenery: true, container: true, closed: true,
      desc: () => O.cupboard.closed ? "テーブルの下の戸棚。扉に、手書きの札。「持っていっていい。書いたものは置いていって」" : "開いた戸棚。" });
    thing("bluew", { name: "青いアーモンド水", aliases: ["青いアーモンド水", "青い瓶", "アーモンド水", "blue almond water"], loc: "cupboard", take: true, drink: "blue",
      desc: "青い瓶のアーモンド水。ラベルに手書きで「眠れないとき」。" });
    thing("can0", { name: "缶詰", aliases: ["缶詰", "缶", "can"], loc: "cupboard", take: true, food: true, heavy: true,
      desc: "ずっしり重い缶詰。ラベルははがれている。" });
    thing("notebook", { name: "野帳", aliases: ["野帳", "帳面", "ノート", "notebook"], loc: "cupboard", take: true,
      desc: "黄土色の表紙の、小さな野帳。中は方眼。表紙の隅に、誰かが描いた小さな星。最初のページに、知らない人の字。「いつも、とは書かない。そのとき、と書く」",
      read: () => bookText(true).join("\n") });
    thing("letter0", { name: "書き置き", aliases: ["書き置き", "メモ", "手紙", "letter"], loc: "y0m", scenery: true,
      desc: "テーブルの上の書き置き。何人もの字。",
      read: () => { readRec("wall", "manila"); S.l0.readLetter = true;
        return "「ここに来た人へ。\n食べ物と水は、持っていっていい。\nちらつく壁を見つけたら、体ごと投げこむこと。その先に、人がいる。\n赤い部屋には近づかないこと。赤く見えたら、引き返す。\n戸棚に書くものを置いておく。自分が誰で、何をしようとしているかを書くこと。\n見たことは見たと、読んだことは読んだと書くこと。」"; } });
    thing("oldbook", { name: "誰かの野帳", aliases: ["誰かの野帳", "古い野帳", "old notebook"], take: true,
      desc: "使いこまれた野帳。表紙の隅に、小さな星。",
      read: () => "知らない人の字……いや、どこかで見た字だ。\n" + (LOOP.book.length ? LOOP.book.map(l => "・" + l).join("\n") : "ほとんど白紙。") + "\n最後のページ：「読んだことは、読んだと書くこと」" });
    thing("doors0", { name: "四つの扉", aliases: ["四つの扉", "扉", "doors"], loc: "y0m", scenery: true,
      desc: "どの壁にも、木の扉が一つずつ。どれを開けても、黄色い部屋へ出る。" });

    // レベル1
    thing("yellowp", { name: "黄色い壁紙の柱", aliases: ["黄色い壁紙の柱", "黄色い柱", "黄色い壁紙", "yellow pillar"], loc: "y1a", scenery: true,
      desc: "一本だけ、柱の表面に、見覚えのある黄色い壁紙が貼りついている。湿っている。",
      on: { dive: () => { backToZero(); return true; }, touch: () => { say("黄色い壁紙に触れる。……指先が、少しだけ沈んだ。体ごと押しつければ、向こうへ抜けてしまいそうだ。"); return true; } } });
    thing("pillars1", { name: "柱", aliases: ["柱", "pillars"], loc: "y1a", scenery: true,
      desc: "太いコンクリートの柱。どれも同じに見える。" });
    thing("clothfar", { name: "遠くの色布", aliases: ["遠くの色布", "色布", "布", "distant cloth"], loc: "y1a", scenery: true,
      desc: "ずっと北の柱に、鮮やかな橙色の布。近いのか遠いのか、よく分からない。",
      on: { stare: () => { fixOn("cloth", "遠くの色布"); return true; }, watch: () => { fixOn("cloth", "遠くの色布"); return true; } } });
    thing("exitlight", { name: "緑の非常口の灯り", aliases: ["緑の非常口の灯り", "非常口", "緑の灯り", "灯り", "exit light"], loc: "y1a", scenery: true, feel: true,
      desc: "東の遠くに、緑の非常口の灯り。その下に、押して開ける扉があるはずだ。",
      on: { stare: () => { fixOn("exit", "緑の非常口の灯り"); return true; }, watch: () => { fixOn("exit", "緑の非常口の灯り"); return true; } } });
    thing("pipes1", { name: "配管", aliases: ["配管", "管", "pipes"], loc: "y1a", scenery: true,
      desc: "天井の細い管から、水がしたたっている。南のほうでは、壁の配管が少しずつ太く、多くなっていく。",
      on: { drink: () => { say("管から漏れる水は、飲めないと聞く。油と金気の匂いがする。"); return true; } } });
    thing("puddle1", { name: "水たまり", aliases: ["水たまり", "水", "puddle"], loc: "y1a", scenery: true,
      desc: "床の水たまり。油が虹色に浮いている。",
      on: { drink: () => { say("水たまりに顔を近づける。……よどんだプラスチックの匂い。やめておく。"); return true; } } });
    thing("megnote", { name: "M.E.G. のメモ", aliases: ["M.E.G. のメモ", "メモ", "note"], en: "meg note", loc: "y1a", scenery: true,
      desc: "非常口の扉の横に、メモが置いてある。鷲の印。",
      read: () => { readRec("crate", "note1"); readRec("arms", "note1");
        return "「見つけた人へ。よくここまで来た。\nこのアーモンド水は、M.E.G. から。飲んだら、空き瓶とこのメモはここに残して。補充する。\nここでは、遠くが近く、近くが遠く見える。目印を一つ決めて、目を離さずに歩くこと。\n木箱は、中身を全部確かめてから手を入れること。満杯でない瓶は、飲まないこと。誰かが手を加えたかもしれない。\n停電したら、緑の非常口の灯りへ。灯りは点けずに、壁をつたって。\n通路の先に、基地アルファがある。」"; } });
    thing("giftw", { name: "アーモンド水（M.E.G.）", aliases: ["アーモンド水（M.E.G.）", "アーモンド水", "ボトル", "gift almond water"], loc: "y1a", take: true, drink: "grey", gift: true,
      desc: "ガラス瓶のアーモンド水。古めかしい書体で「Almond Water」。" });
    thing("empty", { name: "空き瓶", aliases: ["空き瓶", "瓶", "empty bottle"], take: true,
      desc: "M.E.G. のアーモンド水の空き瓶。" });
    thing("debris", { name: "がれき", aliases: ["がれき", "木片", "debris"], loc: "y1a", scenery: true,
      desc: () => { if (!S.cbFound) { S.cbFound = true; O.crowbar.loc = "y1a"; return "木片、梱包材、金属のくず。……つぶれた板の下から、バールが一本のぞいている。"; } return "木片、梱包材、金属のくず。"; } });
    thing("crowbar", { name: "バール", aliases: ["バール", "crowbar"], take: true, heavy: true,
      desc: "錆の浮いたバール。ずしりと重い。板をこじ開けるのにも使えそうだ。" });
    thing("vent1", { name: "通気口", aliases: ["通気口", "割れ目", "腕", "vent"], loc: "y1a", scenery: true, feel: true,
      desc: () => S.l1.flk ? "背後の、低いところの通気口。暗くて、中は見えない。" : "柱の根もとの通気口。格子が外れかけている。",
      on: { watch: () => { if (!S.l1.flk) { say("通気口を見る。……今は、何も起きない。"); return true; } watchNext("arms"); return true; },
        lighton: () => { VERB_DO.lighton(null); return true; } } });
    thing("wall1", { name: "壁", aliases: ["壁", "wall"], loc: "y1a", scenery: true, feel: true,
      desc: "くすんだ灰色の壁。",
      on: { touch: () => { if (S.l1.flk) { S.l1.wall = true; say("手探りで壁を見つけ、片手を当てる。冷たい。このまま、緑の灯りのほうへつたっていける。"); } else say("冷たいコンクリート。"); return true; } } });
    thing("crate", { name: "木箱", aliases: ["木箱", "箱", "crate"], scenery: true, container: true, closed: true,
      desc: () => O.crate.closed ? "飾り気のない木箱。蓋は釘で軽く留めてあるだけ。" : (O.cratein.loc ? "蓋の開いた木箱。中に、いくつか物が入っている。手を入れる前に、よく見たほうがいい。" : "蓋の開いた木箱。"),
      on: { watch: () => { if (!O.crate.closed && O.cratein.loc) { identifyCrate(); return true; } say("木箱から目を離さずにいる。……見ているあいだは、そこにある。"); return true; } } });
    thing("cratein", { name: "箱の中", aliases: ["箱の中", "中身", "contents"], scenery: true,
      desc: () => { identifyCrate(); return ""; },
      on: { take: () => { grabCrate(); return true; }, watch: () => { identifyCrate(); return true; }, touch: () => { grabCrate(); return true; } } });
    thing("greyw", { name: "灰色の瓶", aliases: ["灰色の瓶", "金属の瓶", "アーモンド水", "grey bottle"], take: true, drink: "grey",
      desc: "銀色がかった灰色の金属の瓶。振ると水音。アーモンドの匂い。" });
    thing("can1", { name: "缶詰（木箱）", aliases: ["缶詰（木箱）", "缶詰", "缶", "crate can"], take: true, food: true, heavy: true, desc: "重い缶詰。" });
    thing("glass", { name: "ガラス片", aliases: ["ガラス片", "ガラス", "glass"], take: false,
      desc: "割れた窓ガラスの破片。縁が鋭い。持っていく理由はない。" });
    thing("yarn", { name: "毛糸玉", aliases: ["毛糸玉", "毛糸", "yarn"], take: true,
      desc: "赤い毛糸玉。伸ばしていけば、帰り道の印になる。" });
    thing("can2", { name: "缶詰（二つ目）", aliases: ["缶詰（二つ目）", "缶詰", "缶", "second can"], take: true, food: true, heavy: true, desc: "重い缶詰。" });
    // 通路
    thing("bed1", { name: "医務室のベッド", aliases: ["医務室のベッド", "ベッド", "bed"], loc: "y1k", scenery: true,
      desc: "通路の小部屋の一つ。ベッドが一台だけの医務室。ここなら眠れそうだ。" });
    thing("pc1", { name: "古いパソコン", aliases: ["古いパソコン", "パソコン", "computer"], loc: "y1k", scenery: true,
      desc: "事務室の机の上の、古いパソコン。画面は暗い。電源を入れても、何も映らない。" });
    thing("lock1", { name: "部屋の鍵", aliases: ["部屋の鍵", "鍵", "lock"], loc: "y1k", scenery: true,
      desc: "小部屋の扉の、つまみ式の鍵。扉に貼り紙。「鍵はかけるな。見ているうちに消えて、出られなくなる」" });
    // 色布の目印
    thing("cloth", { name: "色布", aliases: ["色布", "橙色の布", "布", "cloth"], loc: "y1c", scenery: true,
      desc: () => S.clothDown ? "床に置かれた橙色の布。鷲の印。" : "柱に結ばれた、鮮やかな橙色の布。鷲の印。",
      on: { take: () => { clothDown(); return true; } } });
    thing("clothnote", { name: "結ばれたメモ", aliases: ["結ばれたメモ", "メモ", "cloth note"], loc: "y1c", scenery: true,
      desc: "布に結ばれたメモ。",
      read: "「見つけた人へ。水は持っていって。持っていったら、この布を外して床に置いてほしい。次の巡回で補充する。\n基地アルファへは、緑の非常口の灯りから通路へ入り、人の声のするほうへ。\n―― M.E.G. 方位班」" });
    thing("clothw", { name: "アーモンド水（目印）", aliases: ["アーモンド水（目印）", "アーモンド水", "ボトル", "cloth almond water"], loc: "y1c", take: true, drink: "grey",
      desc: "目印に添えられたアーモンド水。" });
    // 基地アルファ
    thing("operative", { name: "受付の隊員", aliases: ["受付の隊員", "隊員", "受付", "operative"], loc: "y1x", scenery: true, person: true,
      desc: "明るい黄緑の上着に、鷲の印。机の上に、名簿と地図。",
      on: { talk: () => { talkOperative(); return true; } } });
    thing("waiter", { name: "待っている人", aliases: ["待っている人", "人", "waiting person"], loc: "y1x", scenery: true, person: true,
      desc: () => S.wr === 2 ? "待っていた人が、戻ってきた相棒と並んで座っている。" : "通路の奥を、ずっと見ている人。手に、青い瓶を握っている。",
      on: { talk: () => { talkWaiter(); return true; } } });
    thing("partner", { name: "戻ってきた人", aliases: ["戻ってきた人", "相棒", "partner"], scenery: true, person: true,
      desc: "毛布にくるまって、温かいものを飲んでいる。腕の発疹は、まだ消えていない。",
      on: { talk: () => { say("「あのとき、床に置いてくれたよね。……手渡しされてたら、たぶん、つかみかかってた。自分でも、止められなかったと思う」", "voice"); return true; } } });
    thing("board1", { name: "掲示板", aliases: ["掲示板", "掲示", "board"], loc: "y1x", scenery: true,
      desc: "コルクの掲示板。手書きの紙が何枚も。",
      read: () => { for (const k of ["arms", "growler", "hound", "skin", "smiler", "wretch", "faceling"]) readRec(k, "board"); readRec("arms", "board2"); readRec("skin", "board2");
        return "M.E.G. 基地アルファ　掲示\n・腕：停電中、通気口や割れ目から出る。後ろや上で音がしたら、光を浴びせろ。\n・グラウラー：ケーブルでできた生き物。力は強いが、頭は悪い。頭に重い物を落とし、逃げろ。\n・ハウンド：目を合わせ、声を出して威嚇しろ。でなければ、通り道から離れろ。\n・スキンスティーラー：人の皮をかぶる。話してみろ。人でないと分かったら、静かに下がれ。\n・スマイラー：光に寄る。見つかると音にも寄る。落ち着いて、灯りを消すか、投げて囮にしろ。\n・ウレッチ：人ではない。声が分かっても、関わるな。\n・顔なし（フェイスリング）：ほとんどがおとなしい。放っておけ。\n（別紙）停電中は、ホールで灯りを点けるな。ただ一つの光になれば、すぐに死ぬ。\n（別紙）一人きりの人影には近づくな。人は、たいてい連れだって歩く。"; } });
    thing("bed2", { name: "簡易ベッド", aliases: ["簡易ベッド", "ベッド", "cot"], loc: "y1x", scenery: true, desc: "空いている簡易ベッド。" });
    thing("diner", { name: "食堂", aliases: ["食堂", "diner"], loc: "y1x", scenery: true,
      desc: "基地の近くの食堂。湯気と、何かを焼く匂い。物々交換で食べさせてくれるらしい。",
      on: { talk: () => { diner(); return true; }, eat: () => { diner(); return true; } } });
    thing("keeperw", { name: "アーモンド水（出張所）", aliases: ["アーモンド水（出張所）", "アーモンド水", "ボトル", "keeper almond water"], take: true, drink: "grey",
      desc: "ハウスキーピングでもらった、金属の瓶のアーモンド水。" });
    thing("flashlight", { name: "懐中電灯", aliases: ["懐中電灯", "ライト", "flashlight"], take: true, light: true,
      desc: () => `M.E.G. の懐中電灯。${S.light ? "点いている" : "消えている"}。` });
    thing("alphaw", { name: "アーモンド水（基地）", aliases: ["アーモンド水（基地）", "アーモンド水", "ボトル", "alpha almond water"], take: true, drink: "grey",
      desc: "基地でもらった、金属の瓶のアーモンド水。" });
    thing("bluegift", { name: "預かった青い瓶", aliases: ["預かった青い瓶", "青い瓶", "アーモンド水", "entrusted blue bottle"], take: true, drink: "blue", entrusted: true,
      desc: "待っている人から預かった、青い瓶のアーモンド水。「あの人の好きなやつ」。" });
    // 計器の通路
    thing("gauges", { name: "計器", aliases: ["計器", "配管", "gauges"], loc: "y1d", scenery: true,
      desc: "壁を埋めていく配管と、針の止まった計器。南へ行くほど、通路が狭くなる。" });
    thing("growler", { name: "グラウラー", aliases: ["グラウラー", "ケーブルの束", "growler"], loc: "y1d", scenery: true,
      desc: () => S.gr === 2 ? "ケーブルの束が、ふらふらと揺れている。絡まりかけて、こちらを見ていない。" : "狭くなったところに、ケーブルの束のようなものがうずくまっている。束は、胸のような一か所から枝分かれしている。",
      on: { watch: () => {
          if (S.gr === 2) { say("ケーブルの束は、まだふらついている。"); return true; }
          const r = rec("growler"), i = REC.growler.lines.findIndex((_, j) => !r.s[j]);
          watchNext("growler");
          if (i === 0 || i === 1) S.gr = 1;
          if (i === 2) S.gr = 0;
          return true;
        },
        away: () => {
          if (S.rec.growler && S.rec.growler.s[1]) see("growler", 2);
          if (S.gr === 1) S.gr = 0;
          say(S.gr === 2 ? "一歩下がる。ケーブルの束は、まだふらついている。" : "一歩下がる。ケーブルの束は床に戻り、それ以上は追ってこない。");
          return true;
        },
        touch: () => { hurt("ケーブルの束に手を伸ばした瞬間、束が腕を打った。"); return true; } } });

    // レベル2
    thing("door1", { name: "「1」の扉", aliases: ["「1」の扉", "1の扉", "door 1"], en: "door 1", loc: "y2a", scenery: true,
      desc: "白い鉄の扉。誰かが釘で「1」と刻んでいる。", on: { open: () => { go("u"); return true; } } });
    thing("door3", { name: "「3」の扉", aliases: ["「3」の扉", "3の扉", "板", "door 3"], en: "door 3", loc: "y2a", scenery: true,
      desc: () => S.door3 ? "板をはがした「3」の扉。向こうに、下へ続く階段。" : "「3」と刻まれた扉。板が何枚も打ちつけてある。上から貼り紙。「この先、レベル3。行くなら、レベル4にしろ」",
      on: { open: () => { openDoor3(); return true; } } });
    thing("toolbox", { name: "工具箱", aliases: ["工具箱", "箱", "toolbox"], loc: "y2a", scenery: true, container: true, closed: true,
      desc: () => O.toolbox.closed ? "台車の上の、錆びた工具箱。" : "開いた工具箱。" });
    thing("glow", { name: "ケミカルライト", aliases: ["ケミカルライト", "glow stick"], loc: "toolbox", take: true, light: true,
      desc: () => S.glowLit ? "緑色に光っているケミカルライト。" : "折ると光る、細い筒。まだ折っていない。" });
    thing("machines2", { name: "機械", aliases: ["機械", "配管", "machines"], loc: "y2a", scenery: true,
      desc: "床から天井まで、何に使うのか分からない機械。互いに管でつながっているが、一緒に働いているようには見えない。中で、かすかに何かが空回りしている。" });
    thing("violet", { name: "すみれ色の非常灯", aliases: ["すみれ色の非常灯", "非常灯", "violet light"], loc: "y2b", scenery: true,
      desc: "ところどころの、すみれ色の非常灯。ときどき、じじ、とまたたく。" });
    thing("smiler", { name: "光る顔", aliases: ["光る顔", "スマイラー", "顔", "smiler"], loc: "y2b", scenery: true, feel: true,
      desc: () => S.sm.bait ? "光る顔は、転がっていった灯りのほうに夢中になっている。" : S.sm.near >= 2 ? "光る顔が、すぐそこにある。目と歯だけが、白く光っている。" : "奥の暗がりに、白く光る顔が浮かんでいる。目と歯だけが、ぼんやり光る。",
      on: { watch: () => { watchNext("smiler"); return true; } } });
    thing("wretch", { name: "ウレッチ", aliases: ["ウレッチ", "その人", "うずくまる人", "人影", "wretch"], loc: "y2c", scenery: true, person: true,
      desc: () => S.wr === 1 ? "その人は、空になったボトルを抱えて、壁にもたれている。目は閉じている。ときどき、かすれた声で何か言う。" :
        "部屋の隅に、人がうずくまっている。皮膚が赤くただれ、ところどころに穴。髪は、ほとんど抜けている。腕の発疹をかきむしりながら、「みず」と、くり返している。",
      on: { watch: () => { watchWretch(); return true; }, talk: () => { talkWretch(); return true; }, touch: () => { touchWretch(); return true; },
        away: () => { awayWretch(); return true; } } });
    thing("halfw", { name: "飲みかけのボトル", aliases: ["飲みかけのボトル", "飲みかけ", "half bottle"], loc: "y2c", take: true, drink: "half",
      desc: "机の上の、金属の瓶。半分ほどしか入っていない。" });
    thing("sign2", { name: "看板", aliases: ["看板", "sign"], loc: "y2c", scenery: true,
      desc: "手書きの看板。「生き残り（The Survivors）―― 新しく来た人へ。ここで休んでいって」。字の上に、埃。" });
    thing("door4", { name: "「4」の扉", aliases: ["「4」の扉", "4の扉", "door 4"], en: "door 4", loc: "y2e", scenery: true,
      desc: "テープで大きく「4」と書かれた扉。鍵はかかっていない。", on: { open: () => { go("e"); return true; } } });

    // レベル3
    thing("bars", { name: "格子", aliases: ["格子", "鉄格子", "bars"], loc: "y3a", scenery: true,
      desc: "通路を塞ぐ鉄格子。何をしても傷一つつかないと聞く。奥の暗がりに、誰かが立っている気がする。見つめすぎないほうがいい。" });
    thing("sludge", { name: "黒い管", aliases: ["黒い管", "管", "black pipe"], loc: "y3a", scenery: true,
      desc: "黒い液体が流れる管。熱い。触れるなと、どこにでも書いてある。",
      on: { touch: () => { hurt("黒い管に触れた。焼けるような痛み。"); return true; }, drink: () => { say("冗談ではない。"); return true; } } });
    thing("sign3", { name: "警告の札", aliases: ["警告の札", "札", "warning sign"], loc: "y3a", scenery: true,
      desc: "M.E.G. の札。", read: "「この先、暗く狭い区画。幻聴の報告多数。一人で入らないこと」\n「顔なしは、一人で歩く者を狙う。追われたら、聖所へ」" });
    thing("facelings", { name: "顔なしたち", aliases: ["顔なしたち", "顔なし", "フェイスリング", "facelings"], scenery: true,
      desc: () => S.fc === 2 ? "聖所に続く廊下の手前に、顔のない者が三人。こちらへは、一歩も入ってこない。" : "顔のない者が三人。顔に、目のようなくぼみと、口のような裂け目ができかけている。手に、煉瓦を削った槌。",
      on: { watch: () => { watchFacelings(); return true; } } });
    thing("statue", { name: "天使の像", aliases: ["天使の像", "像", "statue"], loc: "y3s", scenery: true,
      desc: "大きな天使の像。翼を広げ、顔は少し上を向いている。台座に、読めない文字が刻まれている。この部屋だけ、機械の音が遠い。" });
    thing("guard", { name: "衛兵", aliases: ["衛兵", "guard"], loc: "y3g", scenery: true, person: true,
      desc: "門の前の衛兵。手に、細い針。", on: { talk: () => { talkGuard(); return true; } } });
    thing("stranger", { name: "厚着の人", aliases: ["厚着の人", "人", "stranger"], loc: "y3g", scenery: true, person: true,
      desc: "門から少し離れた柱の陰に、人が立っている。この暑さで、厚いコートにフード、サングラス。かすかに、何かが傷んだような匂い。",
      on: { watch: () => { watchNext("skin"); return true; }, talk: () => { talkStranger(); return true; },
        away: () => { say("厚着の人から、静かに離れる。門の衛兵のそばへ。"); S.skLure = false; return true; } } });
    thing("tapg", { name: "給水所", aliases: ["給水所", "アーモンド水", "tap"], loc: "y3b", scenery: true, drink: "tap",
      desc: "何十本ものアーモンド水が並ぶ棚。「一人一本、その場で」。" });
    thing("bed3", { name: "寝台", aliases: ["寝台", "ベッド", "bunk"], loc: "y3b", scenery: true, desc: "公共区画の寝台。" });
    thing("door11", { name: "レベル11への扉", aliases: ["レベル11への扉", "扉", "door 11"], en: "door 11", loc: "y3b", scenery: true,
      desc: "基地の奥の扉。札に「レベル11へ」。今は、そちらへ行くつもりはない。", on: { open: () => { say("扉の札を見る。「レベル11へ」。……今は、行かない。"); return true; } } });
    thing("lift3", { name: "エレベーター", aliases: ["エレベーター", "ボタン", "lift"], loc: "y3e", scenery: true,
      desc: "古いエレベーター。札に「実体81でない昇降機は、レベル4か5へ。どちらになるかは選べない」。",
      on: { press: () => { liftFrom3(); return true; }, open: () => { liftFrom3(); return true; } } });

    // レベル4
    thing("window", { name: "塗られていない窓", aliases: ["塗られていない窓", "窓", "window"], loc: "y4a", scenery: true,
      desc: "黒く塗られていない窓が、一枚だけある。外は、明るい。",
      on: { watch: () => { watchNext("window"); return true; }, open: () => { nearWindow(); return true; }, touch: () => { nearWindow(); return true; }, dive: () => { nearWindow(); return true; },
        away: () => { say("窓から目をそらす。……視界の端で、夕方の光が、まだ呼んでいる。"); return true; } } });
    thing("blackwin", { name: "黒く塗られた窓", aliases: ["黒く塗られた窓", "black windows"], loc: "y4a", scenery: true,
      desc: "窓のほとんどは、内側から黒く塗りつぶされている。" });
    thing("cooler", { name: "給水器", aliases: ["給水器", "ウォーターサーバー", "cooler"], loc: "y4a", scenery: true, drink: "tap",
      desc: "オフィスの給水器。タンクの中身は、ほんのり白く濁っている。アーモンド水だ。" });
    thing("stairdoor", { name: "階段室の扉", aliases: ["階段室の扉", "階段室", "扉", "stair door"], loc: "y4a", scenery: true,
      desc: () => { S.sawStair = true; S.y4aIdle = 0; return "東の壁の、階段室の扉。目を離すと消えることがある、とワンダラーたちは言う。"; },
      on: { open: () => { go("e"); return true; }, watch: () => { S.sawStair = true; S.y4aIdle = 0; say("階段室の扉から、目を離さずにいる。"); return true; } } });
    thing("wanderers", { name: "ワンダラーたち", aliases: ["ワンダラーたち", "ワンダラー", "人たち", "wanderers"], loc: "y4a", scenery: true, person: true,
      desc: "壁ぎわで、何人かのワンダラーが休んでいる。給水器のまわりに、紙コップ。",
      on: { talk: () => { readRec("window", "wand");
        say("「塗ってない窓は見るな。見るだけならまだいいが、近づくな」\n「北の廊下にハウンドがいる。オメガへ行くなら、背中を見せるな」\n「階段室の扉は、目を離すと消えることがある。行くなら、見てから行け」", "voice"); return true; } } });
    thing("hound", { name: "ハウンド", aliases: ["ハウンド", "四つ足", "hound"], loc: "y4h", scenery: true,
      desc: () => S.hd === 1 ? "ハウンドは前脚を止め、喉の奥で唸っている。こちらの目を見ている。" : "四つ足でうずくまる、痩せた人のような形。長い黒髪が顔にかかっている。髪のあいだから、目がこちらをうかがう。",
      on: { watch: () => { watchNext("hound"); return true; }, stare: () => { stareHound(); return true; }, touch: () => { hurt("手を伸ばした瞬間、ハウンドが跳んだ。"); return true; } } });
    thing("archivist", { name: "保管係", aliases: ["保管係", "人", "archivist"], loc: "y4o", scenery: true, person: true,
      desc: "机の向こうの保管係。眼鏡を額に上げ、紙の束に何か書きこんでいる。",
      on: { talk: () => { talkArchivist(); return true; } } });
    thing("shelfE", { name: "実体の棚", aliases: ["実体の棚", "棚", "entity shelf"], loc: "y4o", scenery: true,
      desc: "実体の記事の棚。同じ番号の束が、何冊も並ぶ。版が違うのだ。",
      read: () => { for (const k of ["smiler", "hound", "faceling", "skin", "wretch", "window"]) readRec(k, "e");
        return "実体の棚（抜き書き）\n第1記事「人間」。……一つ目の記事は、わたしたち自身だ。\n第2記事「窓」：黒く塗られていない窓は罠。何があっても近づくな。\n第3記事「スマイラー」：光に寄る。慌てて逃げたときと、大きな音を立てたときだけ襲う。目を合わせたまま、ゆっくり離れること。灯りは全部消す。\n第8記事「ハウンド」：人を見たとたんに敵意を向ける。まっすぐ目を合わせて見すえると、ひるむ。長くはもたないが、離れるだけの時間はできる。唸り声が聞こえたら、姿を見せないこと。\n第9記事「顔なし」：ほとんどはおとなしい。人の日課を、意味も分からずにまねる。（レベル3の項：ここの顔なしは、例外なく敵対的）\n第10記事「スキンスティーラー」：血が透明。聞いたことばを、ときに別の言語でくり返すが、話は通じない。「血が赤なら、生きている。血が透明なら、近づくな」（レベル3の項：簡単な会話ができ、厚着で正体を隠す）\n第15記事「ウレッチ」：元は人。食べ物、水、眠りを奪われ、一人でいるうちに変わる。初めの段階なら、ふつうの食べ物と水で止まる。二つ目の段階では、ことばは水と食べ物と助けを求めるものだけになる。アーモンド水で戻る見込みがある。"; } });
    thing("shelfL", { name: "レベルの棚", aliases: ["レベルの棚", "棚", "level shelf"], loc: "y4o", scenery: true,
      desc: "レベルの記事の棚。",
      read: () => { for (const k of ["mahjong", "whisper", "dark", "voice", "deep"]) readRec(k, "lv");
        return "レベルの棚（抜き書き）\nレベル5：ビバリールームの麻雀は、終わらせようとしても終わらない。卓が、離れたい気持ちを起こさせる。ボイラー室の炉から、かすかなささやき。調査中。\nレベル6：灯りは役に立たない。実体は、まだ見つかっていない。それでも、出てくる人は少ない。\n「世界一静かな部屋」：スイッチを入れてと頼みつづける人がいるという。入れないこと。\n「ミミクリー」：どんな音も声も、そっくりまねる四人。避けること。\n入口に残されたメモ：「暗闇でぶつかってきたものは、人の指で、人の声だった。……あそこが危ないのは、何かがいるからじゃない。何もいないからだ」\nレベル7：入口の部屋から水面まで垂らしたロープが、戻る唯一の道。浅い層と深い層に、一つずつ大きなものがいて、互いの層では狩りをしない。深いほうは光に、浅いほうは音に弱い。ここの空気を吸うと、息を長く止めていられる。"; } });
    thing("darkdoor", { name: "黒い扉", aliases: ["黒い扉", "扉", "black door"], loc: "y4o", scenery: true,
      desc: "保管庫の奥の、黒く塗られた扉。札に「この先レベル6。灯りは役に立たない」。", on: { open: () => { go("d"); return true; } } });
    thing("cot4", { name: "仮眠用の寝台", aliases: ["仮眠用の寝台", "寝台", "cot"], loc: "y4o", scenery: true, desc: "保管庫の隅の、仮眠用の寝台。" });
    thing("lift4", { name: "エレベーター", aliases: ["エレベーター", "ボタン", "lift"], loc: "y4s", scenery: true,
      desc: "古いエレベーター。札に「レベル3行き。おすすめしない」。", on: { press: () => { liftTo3(); return true; }, open: () => { liftTo3(); return true; } } });

    // レベル5
    thing("keeper", { name: "ハウスキーピングの隊員", aliases: ["ハウスキーピングの隊員", "隊員", "keeper"], loc: "y5a", scenery: true, person: true,
      desc: "M.E.G. の出張所「ハウスキーピング」の腕章をつけた人。",
      on: { talk: () => { talkKeeper(); return true; } } });
    thing("cage", { name: "銅の籠のエレベーター", aliases: ["銅の籠のエレベーター", "エレベーター", "cage lift"], loc: "y5a", scenery: true,
      desc: "銅の格子の籠。中に、1から382までのボタン。誰かがテープで「13より上は押すな」と貼っている。" });
    thing("btnlow", { name: "1〜12のボタン", aliases: ["1〜12のボタン", "低い階のボタン", "low buttons"], loc: "y5a", scenery: true,
      desc: "1から12までのボタン。", on: { press: () => { say("「7」を押す。籠は上がらず、横へ動いたような気がした。扉が開くと、同じ大広間の、少し違う場所だった。"); return true; } } });
    thing("btnhigh", { name: "13より上のボタン", aliases: ["13より上のボタン", "13のボタン", "high buttons"], loc: "y5a", scenery: true,
      desc: "13から上のボタン。テープの上から、誰かが爪で×を刻んでいる。", on: { press: () => { endThirteen(); return true; } } });
    thing("paintings", { name: "肖像画", aliases: ["肖像画", "絵", "paintings"], loc: "y5a", scenery: true,
      desc: "古い肖像画が並ぶ。目が、こちらを追ってくる気がする。気のせいかどうかは、確かめようがない。" });
    thing("mahjong", { name: "打ちかけの麻雀", aliases: ["打ちかけの麻雀", "麻雀", "卓", "mahjong"], loc: "y5b", scenery: true,
      desc: "シャンデリアの下の小さな卓に、打ちかけの麻雀。グラスが並ぶ。",
      on: { watch: () => { watchNext("mahjong"); return true; }, touch: () => { touchMahjong(); return true; }, take: () => { touchMahjong(); return true; },
        away: () => { see("mahjong", 2); say("卓から下がる。離れたい気持ちが、すっと消えた。"); return true; } } });
    thing("doors5", { name: "たくさんの扉", aliases: ["たくさんの扉", "扉", "doors"], loc: "y5b", scenery: true,
      desc: "四方の壁に、数えきれないほどの扉。天井にも、床にもあるように見える。", on: { open: () => { beverlyDoor(); return true; } } });
    thing("pipes5", { name: "アーモンド水の管", aliases: ["アーモンド水の管", "管", "漏れ", "pipes"], loc: "y5c", scenery: true, drink: "tap",
      desc: "アーモンド水が流れる太い管。継ぎ目から、湯気を立てて漏れている。" });
    thing("furnace", { name: "炉", aliases: ["炉", "furnace"], loc: "y5c", scenery: true,
      desc: "煙を上げる大きな炉。",
      on: { listen: () => { whisper(); return true; }, watch: () => { whisper(); return true; } } });

    // レベル6
    thing("darkp", { name: "何か", aliases: ["何か", "暗闇の人", "人", "相手", "someone"], scenery: true, feel: true, person: true,
      desc: () => S.dk === 3 ? "隣に、暗闇で会った人がいる。手が、ときどき触れる。" : "暗闇の中、すぐそばに、何かがいる。荒い息。",
      on: { watch: () => { watchDark(); return true; }, listen: () => { watchDark(); return true; }, touch: () => { touchDark(); return true; },
        talk: () => { talkDark(); return true; }, away: () => { awayDark(); return true; } } });
    thing("voice6", { name: "声", aliases: ["声", "人", "voice"], loc: "y6q", scenery: true, feel: true,
      desc: "部屋の奥から、かすれた声。「スイッチを、入れて」",
      on: { watch: () => { watchNext("voice"); return true; }, talk: () => { watchNext("voice"); return true; }, listen: () => { watchNext("voice"); return true; } } });
    thing("switch6", { name: "スイッチ", aliases: ["スイッチ", "switch"], loc: "y6q", scenery: true, feel: true,
      desc: "壁を手でなでると、指先に、小さな出っぱりが触れた。スイッチだ。", on: { press: () => { pressSwitch(); return true; } } });
    thing("rail6", { name: "手すり", aliases: ["手すり", "階段", "rail"], loc: "y6s", scenery: true, feel: true, desc: "冷たい鉄の手すり。下へ続く。" });

    // レベル7
    thing("rope", { name: "ロープ", aliases: ["ロープ", "rope"], loc: "y7", scenery: true,
      desc: "扉の枠に、太いロープが固く結ばれている。水面まで垂れている。戻る道は、これだけだ。" });
    thing("books7", { name: "本棚", aliases: ["本棚", "本", "bookcase"], loc: "y7", scenery: true,
      desc: "どこから来たのか分からない本が並ぶ。背表紙の文字は、読めそうで読めない。" });
    thing("sea7", { name: "海", aliases: ["海", "水", "sea"], loc: "y7w", scenery: true,
      desc: "どこまでも続く暗い水。冷たいが、耐えられないほどではない。",
      on: { watch: () => { watchSea(); return true; }, dive: () => { diveSea(); return true; }, drink: () => { say("塩辛い。"); return true; } } });
    thing("companion", { name: "暗闇で会った人", aliases: ["暗闇で会った人", "人", "companion"], scenery: true, person: true,
      desc: "暗闇で会った人。ここでは、顔が見える。思っていたより、ずっと若い。",
      on: { talk: () => { talkCompanion(); return true; } } });
  }

  // ---- 部屋 ----
  // レベル0は、どこへ行っても似た部屋。wiki の記事にある変わり種が、ときどき混じる
  const YELLOW = [
    "低い天井。どの壁にも、同じ黄色い壁紙。",
    "柱の部屋。同じ間隔の柱が、格子のようにどこまでも並ぶ。進む向きを一つ決めて、守るしかない。",
    "淡い色の壁に、アーチ形の穴が並ぶ部屋。ここは、背後で形を変えないと言われている。",
    "床に、黒い穴がいくつも口を開けている。光は、少し先で吸いこまれて届かない。穴の縁を避けて歩く。",
    "細長い通路。突き当たりで、また同じ幅の通路に分かれる。",
    "壁の向こうで、何かが爪を研ぐような音。……ついてくる。気にしないで、歩く。",
    "どこかで、知っている声に呼ばれた気がした。耳をすますと、蛍光灯のうなりだけ。",
    "カーペットが足首まで沈む。歩くたびに、水が靴にしみてくる。",
    "コンセントが一つだけある部屋。どこにもつながっていない。",
    "天井のパネルが一枚、外れている。奥は暗い。",
    "階段が三段だけあって、どこにも続いていない。",
    "柱の陰を、黒い人影が横切った気がした。見直すと、誰もいない。",
  ];
  function phaseText() {
    return ["（いま、点いたところ）", "（点いている）", "（いまは消えている。壁紙の模様がない）"][S.l0.fw];
  }
  const ROOMS = {
    y0: { name: "黄色い部屋", exits: { n: 1, s: 1, e: 1, w: 1 },
      desc: () => YELLOW[S.l0.i] +
        (S.l0.wall ? "\n壁の一面だけ、照明がまたたいている。" + phaseText() : "") +
        (S.l0.near >= 3 ? "\n一面だけ、茶色い壁がある。木の扉がついている。扉の向こうから、ピアノ。" : "") +
        (S.l0.red ? `\n${DIR_JA[S.l0.red]}の戸口の向こうが、赤い。` : "") +
        "\nうなりつづける蛍光灯。湿ったカーペットの匂い。どの方向にも、同じような部屋が続いている。" },
    y0m: { name: "マニラの部屋", exits: { n: 1, s: 1, e: 1, w: 1 },
      desc: "マニラ紙のような、くすんだベージュの壁紙。木の床板。八角形のテーブルと、椅子が二脚。テーブルの上に書き置き、下に戸棚。どの壁にも、木の扉が一つずつ。\nうなりが、ここでは聞こえない。どこか遠くで、静かなピアノ。" },
    y1a: { name: "柱の区画", exits: { n: "y1c", e: "y1k", s: "y1d", w: 1 },
      desc: "灰色の壁と床。太いコンクリートの柱が、どこまでも並ぶ。地下駐車場と倉庫のあいだのような場所。天井の細い管から水が漏れ、床に水たまり。がれきの山。一本だけ、黄色い壁紙の貼られた柱。\n遠くに目印が見える。北に橙色の布、東に緑の非常口の灯り。南は、壁の配管が少しずつ増えていく。" },
    y1k: { name: "通路", exits: { w: "y1a", n: "y1x" },
      desc: "狭いコンクリートの通路。薄暗いが、ここは形が変わらない。小さな部屋がいくつも並ぶ。古いパソコンのある事務室、ベッドが一台だけの医務室、壁にゴムを張った部屋。\n西の扉から柱の区画へ。北の奥から、人の声。" },
    y1c: { name: "色布の目印", exits: { s: "y1a" },
      desc: () => (S.clothDown ? "柱の根もとに、橙色の布が置かれている。" : "柱に、鮮やかな橙色の布が結んである。") + "鷲の印。結ばれたメモ。\n南へ戻れば、柱の区画。" },
    y1x: { name: "基地アルファ", exits: { s: "y1k" },
      desc: () => "通路の奥が、町のようになっている。テントと簡易ベッド、木箱の板を敷いた床。明るい黄緑の上着に鷲の印の人たちが行き交う。受付の机、掲示板。近くに食堂。" +
        (S.wr === 2 ? "\n待っていた人の隣に、戻ってきた相棒が座っている。" : "\n通路の奥を、ずっと見ている人がいる。") + "\n南へ戻れば通路。" },
    y1d: { name: "計器の通路", exits: { n: "y1a", s: "y2a" },
      desc: () => "壁の配管と計器が、目に見えて増えてきた。この先、通路は狭くなり、レベル2へ続いているはずだ。" +
        (S.gr === 3 ? "" : "\n狭くなったところに、ケーブルの束のようなものがうずくまっている。") + "\n北へ戻れば、柱の区画。" },
    y2a: { name: "機械の通路", exits: { n: "y2c", e: "y2b", u: "y1d", d: () => (S.door3 ? "y3a" : null) },
      desc: "四十五度ずつ折れ曲がる、狭いコンクリートの通路。壁は粉っぽく、触れると指が白くなる。床から天井まで機械が並ぶが、ほとんど動いていない。台車の上に工具箱。\n色も形も違う扉が並ぶ。刻まれた印のある扉が二つ：「1」（上へ戻る）と「3」。北に、手書きの看板の出た一角。東は、灯りの少ない区画。" },
    y2b: { name: "灯りの少ない区画", exits: { w: "y2a", e: "y2e" },
      desc: () => "灯りがほとんど点いていない区画。ところどころ、すみれ色の非常灯がにじんでいる。機械も配管も、ここでは黙っている。" +
        (S.sm.bait ? "\n奥のほうで、転がった灯りに、光る顔が群がっている。" : "\n奥の暗がりに、白く光る顔が浮かんでいる。") + "\n東の先に、扉の並ぶ突き当たり。西へ戻れば、機械の通路。" },
    y2c: { name: "「生き残り」の基地跡", exits: { s: "y2a" },
      desc: () => "手書きの看板。机と簡易ベッド、空の木箱。最近まで、誰かがいたようだ。" +
        (S.wr === 2 ? "" : S.wr === 1 ? "\n壁ぎわで、その人が眠っている。" : "\n部屋の隅に、人がうずくまっている。") + "\n南へ戻れば、機械の通路。" },
    y2e: { name: "扉の並ぶ突き当たり", exits: { w: "y2b", e: "y4a" },
      desc: "通路の突き当たりに、扉が並ぶ。一枚に、テープで大きく「4」。ほかの扉には、何も書かれていない。\n西へ戻れば、灯りの少ない区画。" },
    y3a: { name: "煉瓦の通路", exits: { u: "y2a", n: "y3s", e: "y3g", w: "y3e" },
      desc: () => "色の揃わない煉瓦の壁。埃っぽいコンクリートの床。薄暗い蛍光灯。壁を這う配線と、黒い液体の流れる管。機械が、うなり、ぱちぱちと鳴る。ところどころ、鉄格子が通路を塞いでいる。警告の札。" +
        (S.fc === 1 ? "\n西の通路の前に、顔のない者が三人、立ちはだかっている。" : "") +
        "\n北に聖所。東に基地ガンマの門。西の通路の先に、エレベーター。上へ戻れば、レベル2。" },
    y3s: { name: "聖所", exits: { s: "y3a" },
      desc: () => "煉瓦の壁はそのままに、そこだけ大聖堂のような天井。ギリシャ風の柱。中央の台座に、大きな天使の像。長椅子もオルガンもない。機械の音が、ここでは遠い。" +
        (S.fc === 2 ? "\n聖所に続く廊下の手前に、顔のない者が三人。こちらへは入ってこない。" : "") + "\n南へ戻れば、煉瓦の通路。" },
    y3g: { name: "基地ガンマの門", exits: { w: "y3a", e: "y3b" },
      desc: () => "広い空間の奥に、煉瓦とチタンの壁、有刺鉄線。カメラ。門の前に衛兵。" +
        (S.sk < 8 ? "\n門から少し離れた柱の陰に、厚着の人が立っている。" : "") + "\n西へ戻れば、煉瓦の通路。" },
    y3b: { name: "基地ガンマ", exits: { w: "y3g" },
      desc: "門の内側は、地下とは思えない広さだった。天井は見えない。食堂、寝台、給水所。人の声。奥に「レベル11へ」の扉。\n西へ出れば、門。" },
    y3e: { name: "エレベーターホール", exits: { e: "y3a" },
      desc: "古いエレベーターが一基。札に「実体81でない昇降機は、レベル4か5へ」。\n東へ戻れば、煉瓦の通路。" },
    y4a: { name: "空のオフィス", exits: { w: "y2e", n: "y4h", e: "y4s" },
      desc: "家具のほとんどない、空のオフィス。窓のほとんどは、内側から黒く塗られている。一枚だけ、塗られていない窓。給水器。壁ぎわで休むワンダラーたち。\n北に長い廊下。東に階段室の扉。西の扉から、レベル2へ戻れる。" },
    y4h: { name: "長い廊下", exits: { s: "y4a", n: "y4o" },
      desc: () => "長い廊下。両側に、空っぽの部屋。突き当たりに、重い扉（基地オメガ）。" +
        (S.hd === 3 ? "" : "\n廊下の中ほどに、四つ足の、人のようなものがうずくまっている。ハウンドだ。") + "\n南へ戻れば、空のオフィス。" },
    y4o: { name: "基地オメガ（保管庫）", exits: { s: "y4h", d: "y6" },
      desc: "厚い扉の向こうは、静かな保管庫だった。天井まで紙の束。棚ごとに札。同じ番号の束が、何冊も並んでいる。机の向こうに保管係。奥に黒い扉。\n南へ戻れば、廊下。" },
    y4s: { name: "階段室", exits: { w: "y4a", d: "y5a" },
      desc: "事務所ふうの階段室。下へ続く階段。古いエレベーター。\n西へ戻れば、空のオフィス。" },
    y5a: { name: "大広間", exits: { u: "y4s", e: "y5b" },
      desc: "深紅と金の壁紙。胡桃材の床に、赤と金の絨毯。本棚、長椅子、燭台。どこかの蓄音機から、静かなジャズ。壁の向こうで、パーティーのざわめき。肖像画。銅の籠のエレベーター。ハウスキーピングの隊員。\n東に、銀の札「ビバリールーム」。上へ戻れば、レベル4の階段。" },
    y5b: { name: "ビバリールーム", exits: { w: "y5a" },
      desc: "広い部屋。四方の壁に、数えきれないほどの扉。中央に、シャンデリアに照らされた小さな卓。飲み物と、打ちかけの麻雀。\n西の扉から、大広間へ戻れる。" },
    y5c: { name: "ボイラー室", exits: { w: "y5b", d: "y6" },
      desc: "古い機械と、からみあう管。管にはアーモンド水が流れ、継ぎ目から漏れて湯気を立てる。ひどく暑いのに、どこも乾いている。煙を上げる炉。\n奥へ降りていくと、レベル6だと聞く。西の扉から、ビバリールームへ。" },
    y6: { name: "暗闇", exits: { n: 1, s: 1, e: 1, w: 1 },
      desc: () => "何も見えない。何も聞こえない。防音室のような静けさ。手を伸ばすと、冷たく滑らかな壁。" + (S.dk === 3 ? "\n隣に、暗闇で会った人がいる。" : "") },
    y6q: { name: "静かな部屋", exits: { n: 1, s: 1, e: 1, w: 1 },
      desc: () => "狭い部屋。壁を手でなでると、小さなスイッチ。部屋の奥から、かすれた声。「スイッチを、入れて」" + (S.dk === 3 ? "\n隣の人の手が、こちらの袖をつかんだ。" : "") },
    y6s: { name: "階段", exits: { d: "y7", u: 1 },
      desc: "指先に、冷たい手すりが触れた。下へ続く階段。波の音が、はっきり聞こえる。" },
    y7: { name: "入口の部屋", exits: { u: "y6s", d: "y7w" },
      desc: "階段を降りきると、ふつうの部屋だった。本棚、小さなコーヒーテーブル、椅子が一脚、天井の蛍光灯。カーペットの床に、水たまりほどの水が張っている。\n階段の向かいに、開いた扉。扉の向こうは、下に海がある。扉の前に立つと、体の重さが、そちらへ引っぱられる。水面まで、四、五メートル。\n扉の枠に、太いロープ。水面まで垂れている。" },
    y7w: { name: "水面", exits: { u: "y7" },
      desc: "ロープにつかまって、水面に浮かぶ。ぼんやりした光が、どこからともなく満ちている。見上げると、コンクリートの天井に、扉の四角が小さい。見下ろすと、どこまでも暗い。" },
  };
  function exitsOf(loc) {
    const ex = ROOMS[loc].exits;
    const out = {};
    for (const [d, v] of Object.entries(ex)) { const t = text(v); if (t) out[d] = t; }
    return out;
  }

  // ---- 状態 ----
  let S = null;
  let LOOP = loadLoop();
  function newState() {
    initWorld();
    S = { loc: "y0", moves: 0, done: false, seen: {}, hist: [], th: 0, inj: 0, light: false, glowLit: false, stageSaid: 0,
      rec: {}, recOrder: [], lastRec: null, kind: 0,
      l0: { i: rnd(YELLOW.length), steps: 0, quiet: pick(DIRS4), near: 0, red: null, redWarn: false, wall: false, fw: 0, spike: 0, ring: 0, readLetter: false },
      manilaKnown: false,
      fix: null, cr: { on: false, n: 0, gone: false }, cbFound: false, clothDown: false, bottleBack: false,
      l1: { turns: 0, next: 5, flk: 0, arm: 0, lit: 0, wall: false, hurt: false, flashed: false },
      alpha: false, op: 0, wt: 0, soup: false,
      gr: 0, grT: 0,
      door3: false, sm: { near: 0, bait: 0 }, wr: 0, wrName: false,
      fc: 0, fcT: 0, fcW: 0, sk: 0, skT: 0, skLure: false, gamma: false,
      sawStair: false, y4aIdle: 0, hd: 0, hdT: 0, omega: false, ar: 0,
      keeper: false, mjTouched: false,
      l6: { step: 0, dirs: [pick(DIRS4), pick(DIRS4), pick(DIRS4)], from: "y5c" }, dk: 0, dkT: 0, diveWarn: false };
    O.oldbook.loc = LOOP.book && LOOP.book.length ? "cupboard" : null;
  }
  const SAVED_FIELDS = ["loc", "closed", "name"];
  function snapshot() {
    const objs = {};
    for (const o of Object.values(O)) {
      objs[o.id] = {};
      for (const k of SAVED_FIELDS) if (k in o) objs[o.id][k] = o[k];
    }
    return { v: VERSION, S, objs, log: rows.slice(-80) };
  }
  function restore(data) {
    if (!data || data.v !== VERSION || !data.S) return false;
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
  function say(t, cls) { for (const part of String(t).split("\n")) push({ t: "out", ja: part, cls: cls || "" }); }
  function gap() { push({ t: "gap" }); }
  function flicker() { flashed = true; emit("flicker"); }
  // 画面と音の演出に渡す出来事（ゲームの進み方には関わらない）
  let fxq = [];
  function emit(type, k) { fxq.push({ type, k }); }

  function stage() { return S.th < 90 ? 0 : S.th < 130 ? 1 : 2; }
  function status() {
    const lv = LV();
    const info = LEVEL_INFO[lv];
    const dark = isDark();
    const ex = dark && S.loc !== "y6" ? {} : exitsOf(S.loc);
    const c = counts();
    const th = S.th >= 130 ? "ウレッチ化" : S.th >= 90 ? "発疹" : S.th >= 50 ? "渇き" : "";
    return { room: dark && S.loc === "y1a" ? "暗闇" : ROOMS[S.loc].name, level: "Level " + lv, cls: info[1], levelName: info[0],
      rec: c.seen, ok: c.ok, th, hot: S.th >= 90, inj: S.inj,
      exits: Object.keys(ex), done: S.done, theme: S.loc === "y0m" ? "tm" : "t" + lv,
      amb: ambience(), blackout: S.loc === "y1a" && S.l1.flk > 0, arm: S.loc === "y1a" ? S.l1.arm : 0, spike: S.loc === "y0" && !!S.l0.spike };
  }
  // その場で鳴っている音の種類（画面側が音を作る）
  function ambience() {
    const lv = LV();
    if (S.loc === "y0m") return "manila";
    if (lv === "0") return "hum";
    if (S.loc === "y1a" && S.l1.flk > 0) return "blackout";
    if (S.loc === "y1x" || S.loc === "y3b") return "base";
    if (S.loc === "y1k") return "corridor";
    if (lv === "1") return "pipes";
    if (S.loc === "y2b") return "brownout";
    if (lv === "2") return "machine";
    if (S.loc === "y3s") return "sanctum";
    if (lv === "3") return "electric";
    if (lv === "4") return S.loc === "y4o" ? "archive" : "office";
    if (S.loc === "y5c") return "boiler";
    if (lv === "5") return "hotel";
    if (lv === "6") return "silence";
    return "sea";
  }

  // ---- 世界のしくみ ----
  const lightOn = () => LV() !== "6" && ((S.light && held("flashlight")) || (S.glowLit && held("glow") && !S.glowHidden));
  const isDark = () => S.loc === "y6" || S.loc === "y6q" || S.loc === "y6s" || (S.loc === "y1a" && S.l1.flk > 0);
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
  const ALWAYS = ["y0", "y6"];
  function describe(full) {
    const r = ROOMS[S.loc];
    if (S.loc === "y1a" && S.l1.flk > 0) {
      say("暗闇", "title");
      say("照明が、すべて消えている。東のほうに、緑の非常口の灯りだけが、かすかに浮かんでいる。" + (S.l1.wall ? "片手を、冷たい壁に当てている。" : ""));
      return;
    }
    say(r.name, "title");
    if (full || !S.seen[S.loc] || ALWAYS.includes(S.loc)) say(text(r.desc));
    S.seen[S.loc] = true;
    if (S.loc === "y4a") { S.sawStair = true; S.y4aIdle = 0; }
    const loose = Object.values(O).filter(o => o.loc === S.loc && !o.scenery);
    for (const o of loose) say(`ここに${o.name}がある。`);
    for (const c of Object.values(O).filter(o => o.loc === S.loc && o.container && !o.closed)) {
      const inside = Object.values(O).filter(o => o.loc === c.id);
      if (inside.length) say(`${c.name}の中に、${inside.map(o => o.name).join("、")}。`);
    }
  }
  // 階が変わったときの出来事
  function arrive(lv, from) {
    if (lv === from) return;
    say(`―― Level ${lv}「${LEVEL_INFO[lv][0]}」`, "note");
    if (lv === "1" && !S.seen.arr1) { S.seen.arr1 = true; say("見上げる。コンクリートの天井には、穴も継ぎ目もない。……静かだ。うなりのない場所が、こんなにありがたいとは思わなかった。", "note"); }
    if (lv === "3" && !S.seen.arr3) { S.seen.arr3 = true; say("暑い。空気がよどんでいる。煉瓦の匂い。", "note"); }
    if (lv === "6" && !S.seen.arr6) { S.seen.arr6 = true; if (S.light || S.glowLit) say("灯りは点いているはずなのに、光が、目の前の手さえ照らさない。", "warn"); }
    if (lv === "7" && !S.seen.arr7) { S.seen.arr7 = true; say("潮の匂い。光。……光が、目に痛い。", "note"); }
  }
  function enter(to) {
    const from = LV();
    const was = S.loc;
    if (was === "y1a" && to !== "y1a" && S.cr.on) leaveCrate();
    if (was === "y5b" && to !== "y5b") leaveBeverly();
    S.loc = to;
    if (S.glowHidden && to !== "y2b") S.glowHidden = false;
    if (S.dk === 3 && (LEVEL_OF[to] === "6" || LEVEL_OF[to] === "7")) O.companion.loc = to;
    else if (O.companion.loc && O.companion.loc !== "gone") {
      O.companion.loc = "gone";
      say("暗闇で会った人とは、ここで別れた。「ありがとう。……ここからは、自分の足で戻れる」", "voice");
    }
    describe(false);
    arrive(LV(), from);
    if (to === "y1a" && S.cr.gone) {
      S.cr.gone = false;
      say("木箱があった場所には、何もない。", "note");
      see("crate", 2);
    }
    if (to === "y1x") S.alpha = true;
    if (to === "y4o") S.omega = true;
    if (to === "y4h" && S.hd === 0 && !S.seen.hd) { S.seen.hd = true; say("ハウンドは、まだこちらに気づいていない。……と、思う。", "warn"); }
    if (to === "y2c" && S.wr === 0 && holdingAlmond()) say("うずくまっていた人が顔を上げ、こちらの手もとを見て、叫んだ。", "warn");
  }
  function holdingAlmond() { return Object.values(O).some(o => o.loc === "player" && (o.drink === "grey" || o.drink === "blue")); }

  // ---- けが・倒れる ----
  const SAFE = { "0": () => (S.manilaKnown ? "y0m" : "y0"), "1": () => (S.alpha ? "y1x" : "y1k"), "2": () => (S.alpha ? "y1x" : "y2a"),
    "3": () => (S.gamma ? "y3b" : "y3s"), "4": () => (S.omega ? "y4o" : "y4a"), "5": () => "y5a", "6": () => S.l6.from, "7": () => "y7" };
  function hurt(msg) {
    say(msg, "warn");
    emit("hurt");
    S.inj++;
    if (S.inj < 3) { say(S.inj === 1 ? "（けがをした。あと二度で、倒れる）" : "（けがをした。もう一度で、倒れる）", "note"); return; }
    collapse();
  }
  function collapse() {
    const to = SAFE[LV()]();
    emit("collapse");
    S.inj = 0;
    S.th += 20;
    S.broken = true;
    S.l1.flk = 0; S.l1.arm = 0; S.l1.lit = 0; S.l1.wall = false;
    if (S.fc === 1 || S.fc === 2) S.fc = 0;
    if (S.hd === 1) S.hd = 0;
    S.sm.near = 0; S.skLure = false;
    if (S.dk === 1 || S.dk === 2) { S.dk = 9; O.darkp.loc = null; }
    if (LEVEL_OF[to] === "6") S.l6.step = 0;
    gap();
    say("目の前が、暗くなっていく……", "warn");
    gap();
    const base = { y1x: "M.E.G. の巡回に見つけられ、基地アルファへ運ばれた。", y3b: "基地ガンマの衛兵に引きずりこまれた。", y4o: "保管係が、扉の外から引き入れてくれた。" }[to];
    say("……気がつくと、" + (base ? base + "簡易ベッドの上だ。" : ROOMS[to].name + "にうずくまっていた。") + "のどが、からからに乾いている。");
    S.loc = to;
    describe(true);
  }

  // ---- 動き ----
  function go(dir) {
    if (S.loc === "y0") { move0(dir); return; }
    if (S.loc === "y0m") { leaveManila(dir); return; }
    if (S.loc === "y6") { move6(dir); return; }
    if (S.loc === "y6q") { moveQuiet(dir); return; }
    if (S.loc === "y1a") { move1(dir); return; }
    if (S.loc === "y1d" && dir === "s") {
      if (S.gr === 2 || S.gr === 3) { if (S.gr === 2) { say("ふらつくケーブルの束の横を、すり抜ける。"); verify("growler"); S.gr = 3; O.growler.loc = null; } gap(); say("配管と計器に埋もれていく通路を進む。壁の色が、粉っぽい灰色に変わった。"); enter("y2a"); return; }
      if (S.gr === 0) { S.gr = 1; say("近づくと、ケーブルの束が起き上がった。束の一本が、目の前の床を打つ。", "warn"); see("growler", 0); see("growler", 1); return; }
      hurt("ケーブルの束が、脚を打った。"); return;
    }
    if (S.loc === "y2a" && dir === "d" && !S.door3) { say("「3」の扉は、板で塞がれている。"); return; }
    if (S.loc === "y2a" && dir === "d") { say("板をはがした扉を抜け、狭い階段を降りる。空気が、熱く、よどんでいく。"); gap(); enter("y3a"); return; }
    if (S.loc === "y2a" && dir === "u") { say("「1」の扉を開ける。だんだん飾り気のなくなる通路を戻る。"); gap(); enter("y1d"); return; }
    if (S.loc === "y2b" && dir === "e") { passSmiler(); return; }
    if (S.loc === "y2e" && dir === "e") { say("「4」の扉を開ける。……カーペットの床。静かな空調の音。オフィスの匂い。"); gap(); enter("y4a"); return; }
    if (S.loc === "y3a" && dir === "w") { toLift3(); return; }
    if (S.loc === "y3a" && S.fc === 1 && dir !== "n") { S.fc = 0; S.fcT = 0; O.facelings.loc = null; say("背を向けずに、後ずさりで離れる。三人は、追ってはこなかった。", "note"); }
    if (S.loc === "y3a" && dir === "n" && S.fc === 1) {
      say("聖所へ駆けこむ。");
      enter("y3s");
      S.fc = 2; S.fcW = 0;
      say("振り向くと、三人は、聖所に続く廊下の手前で足を止めていた。像のほうを見て、肩をすくめるように後ずさる。", "note");
      see("faceling", 2);
      O.facelings.loc = "y3s";
      return;
    }
    if (S.loc === "y3s" && dir === "s" && S.fc === 2) { hurt("廊下へ出たとたん、待ちかまえていた槌が振り下ろされた。"); return; }
    if (S.loc === "y3g" && dir === "e" && !S.gamma) { say("衛兵に止められた。「指を出して。誰でも同じ。例外はない」"); return; }
    if (S.loc === "y3g" && dir === "w" && S.skLure) {
      S.skLure = false; S.sk = 8; O.stranger.loc = null;
      enter("y3a");
      hurt("厚着の人が、ついてきた。通路に出たとたん、コートの下から、白い腕が伸びた。");
      return;
    }
    if (S.loc === "y4a" && dir === "e" && !S.sawStair) { say("階段室の扉を探す。……さっきまであった場所が、ただの壁になっている。目を離しすぎたのかもしれない。"); return; }
    if (S.loc === "y4h" && dir === "n" && S.hd !== 3) {
      if (S.hd === 1) { say("目を離さないまま、壁ぎわを進む。重い扉を開け、身を滑りこませる。背中で、扉が閉まった。"); verify("hound"); S.hd = 3; O.hound.loc = null; gap(); enter("y4o"); return; }
      hurt("背を向けた瞬間、ハウンドが跳んだ。"); return;
    }
    if (S.loc === "y4o" && dir === "d") { say("黒い扉を開ける。その先は、光を飲みこむ暗闇だった。手探りで、一歩踏みこむ。"); S.l6.from = "y4o"; S.l6.step = 0; gap(); enter("y6"); return; }
    if (S.loc === "y5c" && dir === "d") { say("ボイラー室の奥へ、奥へ。熱が、息を焼く。……やがて、熱が嘘のように消え、光も消えた。"); S.th += 6; S.l6.from = "y5c"; S.l6.step = 0; gap(); enter("y6"); return; }
    if (S.loc === "y6s" && dir === "u") { say("階段を上がり、手探りで、来た道を戻る。……ずいぶん長く歩いた。"); S.th += 10; S.l6.step = 0; gap(); enter(S.l6.from); return; }
    if (S.loc === "y7" && dir === "d") { say("ロープをつかみ、扉の前に立つ。体が、海のほうへ倒れていく。ロープを伝って、水面まで、ゆっくり降りる。"); gap(); enter("y7w"); return; }
    if (S.loc === "y7w" && dir === "d") { diveSea(); return; }
    if (S.loc === "y7w" && dir === "u") { say("ロープをたぐって、扉まで登る。腕が震える。"); gap(); enter("y7"); return; }
    const to = exitsOf(S.loc)[dir];
    if (!to || to === 1) { say(`${DIR_JA[dir] || "そちら"}へは行けない。`); return; }
    enter(to);
  }
  // レベル0：歩くたびに、違う部屋になる
  function move0(dir) {
    if (dir === "u" || dir === "d") { say(dir === "u" ? "天井は、手の届かない高さにある。" : "床は、湿ったカーペットだ。"); return; }
    const l = S.l0;
    if (l.red && dir === l.red) {
      if (!l.redWarn) { l.redWarn = true; say("赤いほうへ一歩踏み出したところで、足が止まった。カーペットが、靴の裏にねばりつく。……息が浅くなる。", "warn"); return; }
      endRed();
      return;
    }
    if (l.near >= 3 && dir === l.quiet) { enterManila(); return; }
    if (l.spike) { l.spike = 0; say("うなりの大きい部屋を離れる。耳の痛みが、少しずつ引いていく。", "note"); }
    l.steps++;
    if (dir === l.quiet) l.near++; else l.near = Math.max(0, l.near - 1);
    l.i = (l.i + 1 + rnd(YELLOW.length - 1)) % YELLOW.length;
    l.redWarn = false;
    l.wall = l.near < 3 && l.steps >= 3 && (l.steps === 6 || Math.random() < 0.4);
    l.fw = 0;
    l.red = !l.wall && l.near < 3 && l.steps >= 2 && Math.random() < 0.15 ? pick(DIRS4.filter(d => d !== l.quiet)) : null;
    O.fwall.loc = l.wall ? "y0" : null;
    O.wdoor0.loc = l.near >= 3 ? "y0" : null;
    O.red0.loc = l.red ? "y0" : null;
    describe(true);
  }
  function diveWall() {
    if (S.l0.fw !== 2) { say("壁に、肩から体当たりした。……ただの壁だった。肩が痛い。"); return; }
    say("模様の消えた壁に、肩から飛びこむ。壁紙が、水のように冷たくなった。……体が、向こう側へ抜けていく。");
    verify("wall");
    gap();
    flicker();
    say("落ちる。長くは落ちなかった。コンクリートの床に、膝をついた。");
    S.l0.wall = false; O.fwall.loc = null;
    enter("y1a");
  }
  function backToZero() {
    say("黄色い壁紙に、肩から体を押しつける。壁紙が、水のように冷たくなった。……うなりが、戻ってくる。");
    const l = S.l0;
    l.steps = 3; l.near = 0; l.quiet = pick(DIRS4); l.wall = false; l.red = null; l.redWarn = false; l.fw = 0;
    O.fwall.loc = null; O.wdoor0.loc = null; O.red0.loc = null;
    gap();
    flicker();
    enter("y0");
  }
  function enterManila() {
    say("木の扉を開ける。うなりが、ふっと消えた。");
    S.manilaKnown = true;
    S.l0.near = 0;
    O.wdoor0.loc = null;
    gap();
    enter("y0m");
  }
  function leaveManila(dir) {
    if (dir === "u" || dir === "d") { say("上にも下にも、扉はない。"); return; }
    say(`${DIR_JA[dir]}の扉を開けて、外へ。……振り向くと、扉はもうなかった。うなりが戻ってくる。`);
    const l = S.l0;
    l.steps = Math.max(l.steps, 3); l.near = 0; l.quiet = pick(DIRS4); l.wall = false; l.red = null; l.redWarn = false;
    O.fwall.loc = null; O.wdoor0.loc = null; O.red0.loc = null;
    gap();
    enter("y0");
  }
  // レベル1：遠くは近く、近くは遠い。目印から目を離さずに歩く
  function fixOn(k, name) { S.fix = k; say(`${name}を見つめる。目を離さないように。`); }
  function move1(dir) {
    if (S.l1.flk > 0) {
      if (lightOn()) { flickerHit("灯りを手に、歩きだした。……区画で、光っているのは自分だけだ。暗闇の奥から、何かがまっすぐこちらへ走ってくる。"); return; }
      if (dir === "e" && S.l1.wall) {
        say("壁に手を当てたまま、緑の灯りのほうへ、少しずつ進む。……指先に、扉の押し棒。押して、通路へ入る。");
        if (!S.l1.hurt) { if (full("arms")) verify("arms"); }
        S.l1.flk = 0; S.l1.arm = 0; S.l1.lit = 0; S.l1.wall = false;
        S.l1.next = S.l1.turns + 14;
        gap();
        enter("y1k");
        say("通路も暗い。でも、ここには何も来ないと聞く。しばらくして、灯りが戻った。", "note");
        return;
      }
      say(dir === "e" ? "緑の灯りのほうへ歩いた……つもりが、柱にぶつかった。灯りは、さっきより遠い。" : "暗闇で、方向が分からない。");
      return;
    }
    if (dir === "w") { S.fix = null; say("柱を何本も過ぎた。……気づくと、さっきと同じ柱の前にいる。"); return; }
    if (dir === "u" || dir === "d") { say("そちらへは行けない。"); return; }
    if (dir === "s") { S.fix = null; say("壁の配管が増えていくほうへ、歩く。"); gap(); enter("y1d"); return; }
    const want = dir === "n" ? "cloth" : "exit";
    if (S.fix !== want) {
      S.fix = null;
      say(`${DIR_JA[dir]}の目印へ向かって歩く。……数分歩いたのに、ほとんど近づいていない。周りを見るたびに、距離が分からなくなる。`);
      return;
    }
    S.fix = null;
    say(dir === "n" ? "橙色の布から目を離さずに歩く。……布が、少しずつ、ちゃんと大きくなる。" : "緑の灯りから目を離さずに歩く。……押して開ける扉。通路へ入る。");
    gap();
    enter(dir === "n" ? "y1c" : "y1k");
  }
  // 木箱
  function crateAppears() {
    S.cr.on = true; S.cr.n++;
    O.crate.loc = "y1a"; O.crate.closed = true; O.cratein.loc = null;
    for (const id of ["greyw", "can1", "glass", "yarn", "can2"]) if (O[id].loc === "crate" || O[id].loc === "cratehid") O[id].loc = null;
    if (S.cr.n === 1) for (const id of ["greyw", "can1", "glass"]) O[id].loc = "cratehid";
    if (S.cr.n === 2) for (const id of ["yarn", "can2"]) O[id].loc = "cratehid";
  }
  function leaveCrate() {
    S.cr.on = false; S.cr.gone = true;
    O.crate.loc = null; O.cratein.loc = null;
    for (const id of ["greyw", "can1", "glass", "yarn", "can2"]) if (O[id].loc === "crate" || O[id].loc === "cratehid") O[id].loc = null;
  }
  function identifyCrate() {
    if (O.crate.closed) { say("木箱は、まだ閉まっている。"); return; }
    if (!O.cratein.loc) { say("木箱の中は、もう全部見た。"); return; }
    O.cratein.loc = null;
    const items = Object.values(O).filter(o => o.loc === "cratehid");
    for (const o of items) o.loc = "crate";
    say(items.length ? `手を入れる前に、中をよく見る。……${items.map(o => o.name).join("、")}。` : "中を見る。おがくずだけで、空っぽだ。");
    if (items.some(o => o.id === "glass")) say("おがくずの中に、割れたガラスが混じっている。手を突っこんでいたら、切っていた。", "note");
    see("crate", 1);
  }
  function grabCrate() {
    if (O.crate.closed) { say("木箱は、まだ閉まっている。"); return; }
    const items = Object.values(O).filter(o => o.loc === "cratehid");
    if (items.some(o => o.id === "glass")) {
      hurt("中を見ないまま、手を突っこんだ。……指先に、鋭い痛み。割れたガラスだ。");
      identifyCrate();
      return;
    }
    identifyCrate();
  }
  function clothDown() {
    if (S.clothDown) { say("布は、もう床に置いてある。"); return; }
    S.clothDown = true;
    say("柱から布を外して、床に置いた。" + (O.clothw.loc === "y1c" ? "（中身はまだ取っていないけれど）" : "中身を取った、という印だ。"));
    if (O.clothw.loc !== "y1c") S.kind++;
  }
  // レベル1の停電
  function flickerStart() {
    S.l1.flk = 1; S.l1.arm = 0; S.l1.lit = 0; S.l1.wall = false; S.l1.hurt = false; S.l1.flashed = false;
    gap();
    flicker();
    emit("blackout");
    say("照明が、いっせいに消えた。", "warn");
    say("真っ暗だ。東のほうに、緑の非常口の灯りだけが、かすかに浮かんでいる。");
  }
  function flickerHit(msg) {
    S.l1.hurt = true;
    S.l1.flk = 0; S.l1.arm = 0; S.l1.lit = 0;
    S.l1.next = S.l1.turns + 14;
    hurt(msg);
    if (!S.broken) say("……照明が、戻った。", "note");
  }
  function flickerEnd() {
    S.l1.flk = 0; S.l1.arm = 0; S.l1.lit = 0; S.l1.wall = false;
    S.l1.next = S.l1.turns + 14;
    say("照明が、一本ずつ戻ってきた。", "note");
    emit("lightsback");
    if (!S.l1.hurt && full("arms") && S.l1.flashed) verify("arms");
    if (!S.cr.on) { crateAppears(); say("……柱の根もとに、さっきまでなかった木箱がある。", "note"); see("crate", 0); }
  }
  // レベル2
  function openDoor3() {
    if (S.door3) { go("d"); return; }
    if (!held("crowbar")) { say("板が釘で打ちつけてある。素手では外れない。"); return; }
    S.door3 = true;
    say("バールを板の隙間に差しこみ、こじあける。釘がきしむ。……板がはがれた。扉の向こうに、下へ続く階段。煉瓦の匂いと、熱。");
  }
  function passSmiler() {
    if (S.sm.bait > 0) { say("光る顔が、転がった灯りに気を取られているあいだに、横を抜ける。"); verify("smiler"); gap(); enter("y2e"); return; }
    if (lightOn()) { S.sm.near = 0; hurt("灯りを持ったまま横を抜けようとした瞬間、光る顔が、光ごと跳びかかってきた。"); return; }
    if (S.sm.near >= 2) { S.sm.near = 0; hurt("顔がすぐそこにある。動いた瞬間、気づかれた。"); return; }
    say("灯りを消したまま、壁ぎわを、ゆっくり抜ける。……光る顔は、動かなかった。");
    verify("smiler");
    gap();
    enter("y2e");
  }
  function watchWretch() {
    if (S.wr === 1) { say("その人は、眠っている。呼吸は、さっきより深い。"); return; }
    if (!holdingAlmond()) { say("少し離れて見る。その人は、腕の発疹をかきむしりながら、「みず」とだけくり返している。こちらには、目を向けない。"); say("（手ぶらだと、こちらを見ない）", "note"); return; }
    watchNext("wretch");
    if (S.rec.wretch.s[2] && !S.wrName) { S.wrName = true; O.wretch.name = "その人"; say("……掲示の呼び名ではなく、ただ、のどの渇いた人に見えた。", "note"); }
  }
  function talkWretch() {
    if (S.wr === 1) { say("「……みず。……ありがと」かすれた声。まだ、ことばは少ない。"); return; }
    say("「大丈夫」と声をかける。");
    say(holdingAlmond() ? "ことばは届いていないようだ。目は、ボトルを追っている。" : "「……みず」とだけ、返ってきた。");
  }
  function touchWretch() {
    if (S.wr === 1) { say("肩にそっと触れる。その人は、目を閉じたまま、小さくうなずいた。"); return; }
    say("触れようとした手を、叩き落とされた。");
  }
  function awayWretch() {
    if (S.wr === 0 && holdingAlmond() && S.rec.wretch && S.rec.wretch.s[1]) { see("wretch", 2); if (!S.wrName) { S.wrName = true; O.wretch.name = "その人"; } say("ボトルを背中に隠して、一歩下がる。……叫び声がやんだ。"); return; }
    say("一歩下がる。");
  }
  function feedWretch(o, handed) {
    if (handed && !full("wretch")) {
      hurt("ボトルを差し出した。……手首をつかまれた。爪が食いこむ。");
      if (S.broken) return;
    } else {
      say(handed ? "手渡しはしない。床に置いて、そっとすべらせ、二歩下がった。" : "ボトルを床に置いて、二歩下がった。");
    }
    o.loc = "gone";
    verify("wretch");
    if (!S.wrName) { S.wrName = true; O.wretch.name = "その人"; }
    if (o.drink === "blue") { recoverWretch(o); return; }
    S.wr = 1;
    say("その人は這うように近づき、ボトルをつかんで、一気に飲んだ。……長い息。叫び声は、もう上がらない。壁にもたれて、目を閉じた。");
  }
  function recoverWretch(o) {
    S.wr = 2;
    say("その人は、青い瓶を最後まで飲みほした。長い沈黙。……やがて、かすれた声で言った。");
    say("「……のど、かわいてた。ずっと」", "voice");
    say("「ここに、一人でいた。何日か、分からない」", "voice");
    if (o.entrusted) say("瓶を見て、少し笑った。「……これ、好きなやつだ」", "voice");
    say("基地アルファで待っている人がいる、と伝えると、その人は小さくうなずいた。");
    say("「……先に戻る。ありがとう。この先、スマイラーがいる。光にしか興味がない。灯りを消して、静かに行けば、抜けられる。自分は、そうやってここまで来た」", "voice");
    O.wretch.loc = null; O.partner.loc = "y1x";
    S.kind++;
  }
  // レベル3
  function toLift3() {
    if (S.fc === 3) { say("通路を抜ける。……誰も出てこない。"); verify("faceling"); gap(); enter("y3e"); return; }
    if (S.fc === 0) {
      S.fc = 1; S.fcT = 0; O.facelings.loc = "y3a";
      say("エレベーターのほうへ一歩踏み出したとき、横の通路から、顔のない者が三人、出てきた。手に、煉瓦を削った槌。", "warn");
      see("faceling", 0);
      return;
    }
    hurt("三人が、いっせいに槌を振り上げた。");
  }
  function watchFacelings() {
    if (S.fc === 1) { say(REC.faceling.obs[1]); see("faceling", 1); return; }
    if (S.fc === 2) { if (!S.rec.faceling.s[1]) { say("三人は、槌を握りなおし、こちらを見ている。像のほうへは、一歩も入ってこない。"); see("faceling", 1); } else say("三人は、廊下の手前から動かない。"); return; }
    say("誰もいない。");
  }
  function talkGuard() {
    if (!S.gamma) {
      S.gamma = true;
      say("「門を通るなら、指を出して。誰でも同じ。例外はない」", "voice");
      say("指先に針。赤い血がにじむ。");
      say("「よし。……通っていい」", "voice");
      return;
    }
    if (S.sk >= 8) { say("「気をつけて。ここでは、一人で歩かないこと」", "voice"); return; }
    if (full("skin")) {
      S.sk = 9;
      say("柱の陰の人のことを話す。暑いのに厚着。指を刺されるのを見て下がった。衛兵がいなくなると、また出てきた。");
      say("「……見た目だけなら、何とも言えない。でも、それは見過ごせない」", "voice");
      say("衛兵が二人、柱のほうへ歩いていく。厚着の人は背を向け、走りだした。床に、透明なしずくが点々と残った。");
      O.stranger.loc = null;
      verify("skin");
      return;
    }
    say("柱の陰の人のことを、聞いてみる。");
    say("「見た目だけで人を疑うな。何を見た？　見たことなら、聞く」", "voice");
  }
  function talkStranger() {
    S.skT++;
    if (S.skT === 1) { say("「……ひとり？」声は低く、くぐもっている。ことばの区切りが、どこかおかしい。", "voice"); return; }
    if (S.skT === 2) { S.skLure = true; say("「仲間が、向こうで、けがを。……来て、くれる？」厚着の人は、西の通路を指さした。", "voice"); return; }
    S.sk = 8; S.skLure = false; O.stranger.loc = null;
    hurt("厚着の人が、こちらの腕をつかもうと手を伸ばした。コートの袖から、白い指。");
  }
  function liftFrom3() {
    const to = Math.random() < 0.5 ? "y4s" : "y5a";
    say("ボタンを押す。扉が閉まり、籠が揺れる。……どちらへ向かっているのかは、分からない。");
    gap();
    enter(to);
  }
  function liftTo3() {
    say("ボタンを押す。扉が閉まり、籠がゆっくり沈んでいく。暑くなる。");
    gap();
    enter("y3e");
  }
  // レベル4
  function nearWindow() {
    if (!S.winWarn) { S.winWarn = true; say("窓のほうへ一歩踏み出したところで、足が止まった。夕方の光が、まぶしい。……近づくな、と言われた窓だ。", "warn"); return; }
    endWindow();
  }
  function pressSwitch() {
    if (!S.swWarn) { S.swWarn = true; say("指先が、スイッチにかかる。……入れないこと、と読んだ。何が起きるのかは、誰も書いていない。", "warn"); return; }
    endSwitch();
  }
  function stareHound() {
    if (S.hd === 3) { say("もう、いない。"); return; }
    S.hd = 1; S.hdT = 2;
    say("ハウンドの目を、まっすぐ見る。……ハウンドが、前脚を止めた。喉の奥で唸っている。長くはもたない。");
  }
  function talkArchivist() {
    S.ar++;
    if (S.ar === 1) {
      say("「ここは、書かれたものを置いておく場所。……読みに来たの？　それとも、書いたものを持ってきた？」", "voice");
      say("「同じ実体について、版が三つも四つもある。どれかが嘘というより、見た人が違う。どこで、いつ、何を見たかが書いてあれば、並べて残せる。書いていなければ、うわさと同じ棚に行く」", "voice");
      say("「野帳を渡してくれれば、写して棚に入れる。……渡したら、それで終わりにしていい。まだ見たいものがあるなら、行ってきて」", "voice");
      return;
    }
    if (!held("notebook")) { say("「書くものがないなら、まずそれから。自分が誰で、何をしようとしているか」", "voice"); return; }
    const c = counts();
    say(c.ok ? `「確かめたものが、${tsu(c.ok)}。……渡すなら、いつでも」` : "「まだ、確かめたものはないね。……渡すなら、いつでも」", "voice");
  }
  // レベル5
  function talkKeeper() {
    readRec("mahjong", "keeper");
    say("「ボイラー室を抜けるなら、水を持っていって。奥はひどく暑い。ビバリールームの扉は、たいてい大広間に戻る。何度か開ければ、ボイラー室に出る」", "voice");
    say("「麻雀には手を出さないこと。終わらせようとした人は、みんな途中でやめた」", "voice");
    say("「エレベーターの13より上は、押さないこと」", "voice");
    if (!S.keeper) { S.keeper = true; O.keeperw.loc = "player"; say("隊員は、金属の瓶を一本くれた。（アーモンド水を受け取った）"); }
  }
  function touchMahjong() {
    S.mjTouched = true;
    say("卓に手を伸ばす。……指先が届く手前で、どうしても、ここを離れたくなる。手を引っこめた。");
    see("mahjong", 1);
  }
  function leaveBeverly() {
    if (full("mahjong") && !S.rec.mahjong.ok) verify("mahjong");
  }
  function beverlyDoor() {
    const toBoiler = Math.random() < 0.4;
    say("扉の一つを開ける。");
    gap();
    enter(toBoiler ? "y5c" : "y5a");
  }
  function whisper() {
    if (!S.rec.whisper || !S.rec.whisper.s[0]) { say("炉の轟音の奥に、耳をすます。……ささやき声。"); see("whisper", 0); return; }
    if (!S.rec.whisper.s[1]) { say("炉に、もう少し近づく。熱い。……ささやきは続いている。何と言っているのかは、分からない。"); see("whisper", 1); return; }
    say("ささやきは続いている。やはり、分からない。");
  }
  // レベル6
  function move6(dir) {
    if (S.dk === 1) {
      S.dk = 9; O.darkp.loc = null;
      say("手探りで、その場を離れる。……荒い息が、遠ざかっていった。追ってはこない。");
      see("dark", 2);
    }
    if (dir === "u" || dir === "d") {
      if (dir === "u" && (S.l6.step === 0 || held("yarn"))) { say(S.l6.step === 0 ? "手探りで、来た扉へ戻る。" : "毛糸をたぐって、来た道を戻る。"); S.l6.step = 0; gap(); enter(S.l6.from); return; }
      say("手探りでは、上も下も分からない。");
      return;
    }
    if (dir !== S.l6.dirs[S.l6.step]) { S.th += 2; say("手探りで進む。……行き止まり。指先に、冷たい壁だけ。"); return; }
    S.l6.step++;
    say(`手探りで、${DIR_JA[dir]}へ。波の音が、少しだけ近くなった。`);
    if (S.l6.step === 1 && S.dk === 0) {
      S.dk = 1; S.dkT = 0; O.darkp.loc = "y6";
      gap();
      say("……何かに、ぶつかった。温かい。動いた。", "warn");
      say("「来るな！」叫び声。腕に、爪が食いこむ。", "warn");
      see("dark", 0); see("dark", 1);
      return;
    }
    if (S.l6.step === 2) {
      gap();
      say("指先が、扉の枠に触れた。中から、かすれた声。");
      enter("y6q");
      return;
    }
  }
  function moveQuiet(dir) {
    if (dir === "u" && held("yarn")) { say("毛糸をたぐって、来た道を戻る。"); S.l6.step = 0; gap(); enter(S.l6.from); return; }
    if (dir === "u" || dir === "d") { say("手探りでは、上も下も分からない。"); return; }
    if (dir !== S.l6.dirs[2]) { S.th += 2; say("手探りで進む。……壁。この部屋の出口ではない。"); return; }
    say("声に背を向けて、部屋を出る。声は、追ってこない。");
    S.l6.step = 3;
    gap();
    enter("y6s");
  }
  function watchDark() {
    if (S.dk === 1 || S.dk === 2) { if (!S.rec.dark.s[2] && S.dk === 1) S.dk = 2; watchNext("dark"); if (S.dk === 2) say("腕をつかんでいた手が、ゆるんでいく。", "note"); return; }
    if (S.dk === 3) { say("隣の人の息づかい。さっきより、落ち着いている。"); return; }
    say("何も聞こえない。");
  }
  function awayDark() {
    if (S.dk === 1) { S.dk = 2; say("一歩下がって、息をひそめる。……腕をつかんでいた手が、離れた。荒い息だけが聞こえる。"); see("dark", 2); return; }
    say("少し離れる。");
  }
  function touchDark() {
    if (S.dk === 1) { S.dk = 9; O.darkp.loc = null; hurt("腕をつかみ返した瞬間、相手は悲鳴を上げ、めちゃくちゃに暴れた。……それから、足音が遠ざかっていった。"); return; }
    if (S.dk === 2) { joinDark("そっと手を差し出す。……ふるえる指先が、こちらの指に触れた。人の手だった。"); return; }
    if (S.dk === 3) { say("手が触れる。握り返してくる。"); return; }
    say("何もない。");
  }
  function talkDark() {
    if (S.dk === 1) { S.dkT++; if (S.dkT >= 2) { S.dk = 9; O.darkp.loc = null; hurt("声を出したとたん、相手は叫び、こちらを突き飛ばして走り去った。"); return; } say("声を出したとたん、相手の手に、ぎゅっと力がこもった。", "warn"); return; }
    if (S.dk === 2) { joinDark("小さな声で「大丈夫」と言う。……長い沈黙。\n「……人？」かすれた声。「あなたも、見えないの」"); return; }
    if (S.dk === 3) { talkCompanion(); return; }
    say("声は、暗闇に吸いこまれた。");
  }
  function joinDark(msg) {
    say(msg);
    S.dk = 3;
    verify("dark");
    say("二人で、壁に手を当てて進むことにした。手をつないでいると、暗闇が、少しだけ狭くなる。");
    O.darkp.loc = null; O.companion.loc = S.loc;
    S.kind++;
  }
  function talkCompanion() {
    if (LV() === "7") { say("「戻るよ。ロープで。……あなたは？」", "voice"); return; }
    if (S.loc === "y6q") { say("「あの声……ずっとあれを聞いてた。入れたら、どうなるんだろうって」", "voice"); return; }
    say("「ずっと、何かがいると思ってた。……いたのは、あなただった」", "voice");
  }
  // レベル7
  function watchSea() { watchNext("deep"); }
  function diveSea() {
    if (!S.diveWarn) { S.diveWarn = true; say("ロープから手を放せば、もう戻れない。……それでも行くなら、もう一度。", "warn"); return; }
    endDive();
  }

  // ---- 人と話す ----
  function talkOperative() {
    S.op++;
    if (S.op === 1) {
      say("「落ちてきたばかり？　まず座って。水を飲んで」", "voice");
      O.alphaw.loc = "player";
      O.flashlight.loc = "player";
      say("金属の瓶のアーモンド水と、懐中電灯を受け取った。");
      say("「懐中電灯は、通路で使うこと。ホールでは、停電中に点けないこと」", "voice");
      if (!held("notebook")) { O.notebook.loc = "player"; say("「書くものは持ってる？　……ないなら、これ。自分が誰で、何をしようとしているか、書いておいて」", "voice"); say("野帳を受け取った。覚えていることを書きこむ。"); }
      return;
    }
    if (S.op === 2) {
      say("「オメガ――レベル4の基地の保管庫は、版の食い違った記事だらけでね。見たものを見たとおりに書いてくる人が、いつも足りない。先へ行くなら、野帳を届けてほしい」", "voice");
      say("「レベル2へは、柱の区画の南、配管の増えていくほうへ。2の『4』の扉から、レベル4へ出られる」", "voice");
      say("「掲示板も読んでいって。……ただ、あれも、誰かが書いたものだよ」", "voice");
      say("「それと、柱の区画の黄色い壁紙の柱には、体を押しつけないこと。レベル0に戻されるから」", "voice");
      return;
    }
    if (S.wr === 2) { say("「あの二人、戻ってきたね。……ありがとう」", "voice"); return; }
    say(pick(["「水は、いつも一本多めに」", "「目を離さないこと。ここでは、それがいちばん大事」", "「見たことは、その日のうちに書くこと」"]), "voice");
  }
  function talkWaiter() {
    if (S.wr === 2) {
      if (!S.seen.thanks) { S.seen.thanks = true; S.kind++; }
      say("「……戻ってきた。ありがとう。ほんとうに」", "voice");
      say("待っていた人は、相棒の手を、ずっと握っている。");
      return;
    }
    if (S.wt === 0) {
      S.wt = 1;
      readRec("wretch", "partner");
      say("「相棒が、レベル2の『生き残り』の基地を見に行ったきり、戻らない。もう何日になるか」", "voice");
      say("「……のどが渇くと、怒りっぽくなる人なんだ。怒っているときは、たいてい、何か欲しいときだった」", "voice");
      say("「これ、あの人の好きなやつ。会えたら、渡して」", "voice");
      O.bluegift.loc = "player";
      say("青い瓶を預かった。");
      return;
    }
    say("「……まだ、戻らない」", "voice");
  }
  function diner() {
    if (S.soup) { say("食堂は、にぎわっている。"); return; }
    S.soup = true;
    S.th = Math.max(0, S.th - 30);
    say("食堂の人が、温かいスープを出してくれた。代わりに何を、と聞くと、「今度、何か持ってきて」と笑った。（のどの渇きが少しおさまった）");
  }

  // ---- 結末 ----
  function finish(id, lines, title) {
    S.done = true;
    emit("end", id);
    gap();
    for (const l of lines) say(l, "win");
    say(`****  ${title}  ****`, "win");
    const c = counts();
    say(`（手 ${S.moves}・読んだ ${c.read}・見た ${c.seen}・確かめた ${c.ok}。いちばん下の「はじめから」で、最初から）`, "note");
    const book = id === "chair" ? S.recOrder.filter(k => S.rec[k].ok || full(k)).map(k => `${titleOf(k)}：${S.rec[k].ok ? REC[k].done : REC[k].hyp}`) : LOOP.book || [];
    saveLoop({ n: LOOP.n + 1, last: id, book });
  }
  const tsu = k => (k < 10 ? ["", "一つ", "二つ", "三つ", "四つ", "五つ", "六つ", "七つ", "八つ", "九つ"][k] : k === 10 ? "十" : `${k}`);
  function endArchive() {
    const c = counts();
    const L = ["保管係に、野帳を渡した。", "保管係は、一ページずつ、ゆっくりめくった。"];
    if (c.ok === 0) L.push("「……確かめたものは、まだない。でも、読んだことを『読んだ』と書いてある。それだけで、ここでは珍しいほうだ」");
    else if (c.ok <= 4) L.push(`「確かめたものが、${tsu(c.ok)}。……『いつも』とは、どこにも書いていない。『そのとき』と書いてある」`);
    else L.push(`「確かめたものが、${tsu(c.ok)}。読んだことと見たことが、分けて書いてある。これなら、並べて棚に置ける」`);
    if (S.rec.wretch && S.rec.wretch.ok) L.push("「第15記事の版と、基地アルファの掲示。どちらかが嘘なんじゃなかった。……戻れる段階が、あったんだね」");
    if (S.rec.faceling && S.rec.faceling.ok) L.push("「第9記事に、レベル3の項を足しておく。あなたが見たとおりに」");
    if (S.rec.dark && S.rec.dark.ok) L.push("「レベル6のメモの横に、これを置く。ぶつかってきたのは、怖がっている人だった、と」");
    if (S.recOrder.some(k => REC[k].kind !== "abc" && full(k))) L.push("「分からない、と書いてあるところもある。調査中、と同じ意味だ。それでいい」");
    L.push("保管係は、白い紙の束を出して、野帳を写しはじめた。");
    L.push("写し終えると、いちばん上に、あなたが最初のページに書いた一行を写した。");
    L.push("自分が誰で、何をしようとしているか。");
    finish("archive", L, "記録");
  }
  function endChair() {
    const L = ["戸棚に、野帳を入れた。", "書き置きの横に、一枚、紙を足した。「見たことは見たと、読んだことは読んだと書いてある。使って」",
      "八角形のテーブルの、背を向けた椅子に座る。", "ピアノが、遠くで鳴っている。", "ここは、人と人が会える、ただ一つの部屋だ。",
      "次に来る人は、この椅子の背中を見て、入ってくるだろう。"];
    if (S.wr === 2) L.push("基地アルファで、あの二人は、今ごろ何を食べているだろう。");
    if (S.dk === 3) L.push("暗闇で握った手の温度を、まだ覚えている。");
    L.push("立ち上がって、扉の一つを開ける。黄色いうなりが、また始まる。");
    finish("chair", L, "椅子");
  }
  function endDive() {
    const L = ["野帳の最後のページに、一行だけ書いた。", "「ここから先は、まだ誰も見ていない」"];
    if (O.companion.loc === S.loc) L.push("ロープの上で、暗闇で会った人が、野帳を受け取ってくれた。「上に持っていく。……ちゃんと、届ける」");
    else L.push("野帳を、扉の枠のロープの結び目に、はさんでおいた。");
    L.push("ロープから手を放す。", "水は冷たいが、耐えられないほどではない。ここの空気は、息を長くもたせると読んだ。", "ずっと下、山のような岩の陰に、洞窟の口があるという。", "下へ。光の届かないほうへ。");
    finish("dive", L, "記録の外");
  }
  function endWretch() {
    const L = ["のどが、焼けるようだ。", "ことばを探す。「水」しか、出てこない。", "腕をかきむしる。皮膚が、自分のものではないように、はがれていく。",
      "足音。誰かが、少し離れたところで止まった。", "その人は、しばらく、こちらを見ていた。小さな帳面に、何かを書いている。", "それから、ボトルを床に置いて、一歩、下がった。"];
    L.push(S.wr === 2 ? "……あの人だった。前に、自分がそうしたように。" : "知らない人だった。");
    L.push("ボトルに手を伸ばす。");
    finish("wretch", L, "ウレッチ");
  }
  function endRed() {
    finish("red", ["赤い光の中へ、足を踏み入れた。", "カーペットが、靴の裏に貼りつく。", "振り向く。来た戸口が、ない。",
      "四方の壁紙がめくれて、その下も、赤い。", "うなりが、だんだん、自分の心臓の音と区別できなくなっていく。"], "赤");
  }
  function endWindow() {
    finish("window", ["窓に近づく。", "見覚えのある道。夕方の光。角の自動販売機。……家の方角。", "窓に手をかける。窓は、あっけなく開いた。", "外へ、身を乗り出す。",
      "夕方の光は、どこまで行っても、夕方のままだった。", "道は、こちらが思い浮かべるより、ほんの少しだけ先にある。"], "窓");
  }
  function endThirteen() {
    finish("thirteen", ["「13」のボタンを押した。", "銅の籠が、ゆっくりと上がりはじめる。", "ジャズが、遠くなる。", "表示の針が、12を過ぎた。", "……"], "十三階");
  }
  function endSwitch() {
    finish("switch", ["スイッチを入れた。", "かちり。", "……何も変わらない。暗いままだ。", "頼む声が、やんでいた。", "しばらくして、すぐ後ろで、声がした。",
      "「スイッチを、入れて」", "自分の声だった。"], "スイッチ");
  }

  // ---- 次に見ること（ヒント） ----
  function hintText() {
    const water = Object.values(O).find(o => o.loc === "player" && (o.drink === "grey" || o.drink === "blue"));
    if (S.th >= 90) return water ? `${water.name}を「飲む」。それから、安全な場所で「寝る」。` : "アーモンド水を探す。レベル4の給水器、レベル5のボイラー室の管、基地ガンマの給水所。";
    if (S.l1.flk > 0) return "停電。灯りは点けたままにしない。壁に「触る」、それから東の緑の灯りへ。背後でこすれる音がしたら、一度だけ灯りを点けて、すぐ消す。";
    if (S.th >= 50 && water) return `のどが渇いている。${water.name}を「飲む」。`;
    switch (S.loc) {
      case "y0":
        if (S.l0.red) return "赤い戸口には近づかない。別の方角へ。";
        if (S.l0.near >= 3) return "木の扉を「開ける」。";
        if (S.l0.wall) return full("wall") ? "壁の模様が消えている一拍（「いまは消えている」と出たとき）に、ちらつく壁に「飛びこむ」。" : "ちらつく壁を「観察する」。何拍ごとに消えるのか。";
        if (!S.manilaKnown) return "「耳をすます」。うなりの薄い方角へ進みつづけると、何かがある。";
        return "歩きまわって、ちらつく壁を探す。";
      case "y0m":
        if (O.cupboard.closed) return "戸棚を「開ける」。";
        if (!held("notebook") && O.notebook.loc === "cupboard") return "野帳を「取る」。";
        if (!S.l0.readLetter) return "書き置きを「読む」。";
        if (O.bluew.loc === "cupboard") return "青いアーモンド水も持っていく。";
        return "扉から出て、ちらつく壁を探す。";
      case "y1a":
        if (O.megnote.loc === "y1a" && !S.seen.megnote) return "M.E.G. のメモを「読む」。";
        if (S.cr.on && O.crate.closed) return "木箱を「開ける」。";
        if (S.cr.on && O.cratein.loc) return "手を入れる前に、木箱を「観察する」（中を見る）。";
        if (!S.alpha) return "遠くの緑の非常口の灯りを「見つめる」。そのまま東へ。通路の先に、基地アルファがある。";
        if (!S.cbFound) return "がれきを「調べる」と、何か出てくるかもしれない。";
        if (S.gr !== 3) return "南へ。配管の増えていくほうが、レベル2。";
        return "南の計器の通路から、レベル2へ。";
      case "y1k": return S.alpha ? "西が柱の区画、北が基地アルファ。疲れていたら、医務室のベッドで「寝る」。" : "北の人の声のほうへ。";
      case "y1c": return O.clothw.loc === "y1c" ? "アーモンド水を「取る」。取ったら、色布も「取る」（床に置く印）。" : (S.clothDown ? "南へ戻る。" : "色布を「取る」と、床に置ける。補充の印だ。");
      case "y1x":
        if (S.op === 0) return "受付の隊員に「話しかける」。";
        if (S.op === 1) return "もう一度、受付の隊員に「話しかける」。";
        if (S.wt === 0) return "待っている人に「話しかける」。";
        if (!S.rec.wretch || !S.rec.wretch.r.includes("board")) return "掲示板を「読む」。";
        return "南の通路から柱の区画へ。そこから南が、レベル2。";
      case "y1d":
        if (S.gr === 2) return "今のうちに南へ。";
        if (!full("growler")) return "グラウラーを「観察する」。";
        return held("crowbar") || held("can0") || held("can1") || held("can2") ? "重い物（バールや缶詰）を「投げる」。頭の枝分かれを狙う。それから南へ。" : "重い物が要る。柱の区画のがれきを調べる。木箱の缶詰でもいい。";
      case "y2a":
        if (O.toolbox.closed) return "工具箱を「開ける」。";
        if (S.wr === 0 && O.wretch.loc === "y2c") return "北の「生き残り」の基地跡を見に行く。";
        return "東の灯りの少ない区画を抜けると、「4」の扉。「3」の扉はバールでこじあけられる（レベル3は危険）。";
      case "y2b":
        if (!full("smiler")) return "光る顔を「観察する」。何に寄っていくのか。";
        if (lightOn()) return "灯りを「消す」。それから東へ。";
        return S.sm.near >= 2 ? "灯りを消したまま「待つ」。顔が遠ざかってから、東へ。" : "灯りを消したまま、東へ。";
      case "y2c":
        if (S.wr === 0) {
          if (!holdingAlmond()) return "アーモンド水を持って、もう一度来る。";
          if (!full("wretch")) return "その人を「観察する」。何に反応しているのか。";
          return "アーモンド水を床に「置く」。手渡しはしない。";
        }
        if (S.wr === 1) return held("bluegift") || held("bluew") ? "青い瓶を床に「置く」。" : "今は眠っている。青いアーモンド水があれば、もっとよくなるかもしれない。";
        return "南へ戻る。";
      case "y2e": return "「4」の扉を「開ける」。";
      case "y3a":
        if (S.fc === 1) return "北の聖所へ逃げこむ。";
        if (S.fc === 0) return "東の基地ガンマの門。西の通路の先にエレベーター（ただし、何かが出る）。";
        return "西の通路から、エレベーターへ。";
      case "y3s": return S.fc === 2 ? "ここで「待つ」。去っていくまで。" : "南へ戻る。";
      case "y3g":
        if (!S.gamma) return "衛兵に「話しかける」。";
        if (S.sk < 8 && !full("skin")) return "厚着の人を「観察する」。話しかけすぎない。";
        if (S.sk < 8) return "見たことを、衛兵に「話しかける」で伝える。";
        return "東の基地ガンマで休める。";
      case "y3b": return "給水所で「飲む」。寝台で「寝る」。";
      case "y3e": return "エレベーターの「ボタン」を「押す」。";
      case "y4a":
        if (!full("window")) return "塗られていない窓を、離れたところから「観察する」。近づかない。";
        if (S.hd !== 3) return "北の廊下へ。基地オメガは、その先。";
        return "東の階段室の扉は、見てから行く（「見る」）。下がレベル5。北が基地オメガ。";
      case "y4h":
        if (!full("hound")) return "ハウンドを「観察する」。";
        if (S.hd === 1) return "今のうちに北へ。";
        return "ハウンドを「見つめる」。止まっているあいだに、北へ。";
      case "y4o":
        if (S.ar === 0) return "保管係に「話しかける」。棚も「読む」。";
        return "野帳を保管係に「渡す」と、終わりにできる。まだ見るなら、階段室からレベル5へ、黒い扉からレベル6へ。";
      case "y4s": return "下へ降りると、レベル5。";
      case "y5a": return S.keeper ? "東のビバリールームへ。" : "ハウスキーピングの隊員に「話しかける」。";
      case "y5b": return full("mahjong") ? "麻雀は放っておく。たくさんの扉を「開ける」と、ときどきボイラー室に出る。" : "打ちかけの麻雀を「観察する」。";
      case "y5c": return !S.rec.whisper || !S.rec.whisper.s[1] ? "炉に「耳をすます」。管のアーモンド水も飲める。" : "下へ降りると、レベル6。暑いので、長居しない。";
      case "y6":
        if (S.dk === 1) return "動かない。一歩「離れる」か、黙って「待つ」。";
        if (S.dk === 2) return "小さな声で話しかける（「話しかける」）か、そっと「触る」。";
        return "「耳をすます」と、波の音の方角が分かる。そちらへ。";
      case "y6q": return full("voice") ? "スイッチは入れない。「耳をすます」で波の方角を確かめて、部屋を出る。" : "声を「観察する」。スイッチは入れない。";
      case "y6s": return "下へ。";
      case "y7": return "ロープで下へ。戻るなら上へ。";
      case "y7w": return full("deep") ? "上へ戻れば、帰り道。手を放せば、その先。" : "海を「観察する」。";
    }
    return "まず、見る。";
  }

  // ---- 動作 ----
  function need(o, verbJa) { if (!o) { say(`何を${verbJa}？`); return false; } return true; }
  const WORDS = [
    { ja: "大丈夫", en: "its okay", alt: ["だいじょうぶ", "大丈夫だよ"] },
    { ja: "誰？", show: "誰？", en: "who", alt: ["誰", "だれ", "誰かいるの"] },
    { ja: "水", en: "water", alt: ["みず"] },
    { ja: "来るな！", show: "来るな！", en: "get back", alt: ["来るな", "くるな"] },
    { ja: "ここはどこ", show: "ここはどこ？", en: "where", alt: ["ここどこ"] },
    { ja: "助けて", en: "help me", alt: ["たすけて"] },
  ];
  const W = ja => WORDS.find(w => w.ja === ja);
  function wordsHere() {
    if (stage() >= 2) return [W("水")];
    if (S.loc === "y2c") return ["大丈夫", "水", "誰？"].map(W);
    if (S.loc === "y4h") return ["来るな！", "大丈夫"].map(W);
    if (S.loc === "y6" || S.loc === "y6q") return ["大丈夫", "誰？", "助けて"].map(W);
    if (S.loc === "y3g") return ["誰？", "ここはどこ"].map(W);
    return ["ここはどこ", "助けて", "誰？"].map(W);
  }
  function drinkIt(o) {
    if (o.drink === "tap") {
      const before = stage();
      S.th = before >= 2 ? Math.max(90, S.th - 80) : Math.max(0, S.th - 80);
      say({ cooler: "紙コップで、給水器のアーモンド水を飲む。ほんのり甘い。", tapg: "棚から一本取り、その場で飲む。", pipes5: "漏れたアーモンド水を手に受けて飲む。熱い。でも、煮えた水は、かえって安全だと聞く。" }[o.id] || "アーモンド水を飲んだ。");
      return;
    }
    if (o.loc !== "player" && o.loc !== S.loc && !visible().includes(o)) { say(`ここに${o.name}はない。`); return; }
    if (o.drink === "half") {
      if (S.seen.megnote) { say("満杯でない瓶は飲むな、とメモにあった。誰が口をつけたか分からない。やめておく。"); return; }
      o.loc = "gone";
      hurt("飲みかけの瓶を飲んだ。……妙な味。少しして、腹がねじれるように痛みだした。");
      return;
    }
    o.loc = "gone";
    if (o.drink === "blue") {
      const itchy = S.th >= 90;
      S.th = 0;
      say("青い瓶を飲む。ただの水のような味。……頭の奥が静かになる。少し眠い。" + (itchy ? "腕のかゆみが、引いていく。" : ""));
    } else {
      const before = stage();
      S.th = before >= 2 ? Math.max(90, S.th - 80) : Math.max(0, S.th - 80);
      say("アーモンド水を飲む。ほのかに甘い。のどの渇きが、すっと引いていく。" + (before >= 2 ? "……発疹は、まだ残っている。休まないと。" : ""));
    }
    if (o.gift) { O.empty.loc = "player"; say("空き瓶が残った。", "note"); }
  }
  const VERB_DO = {
    look: () => describe(true),
    inventory: () => {
      const h = Object.values(O).filter(o => o.loc === "player");
      if (!h.length) { say("何も持っていない。"); return; }
      say("持ち物：");
      for (const o of h) say(o.name + (o.id === "flashlight" ? `（${S.light ? "点いている" : "消えている"}）` : o.id === "glow" ? `（${S.glowLit ? "光っている" : "まだ折っていない"}）` : ""), "indent");
    },
    wait: () => {
      if (S.l1.flk > 0 && S.loc === "y1a") { say("息を殺して、じっとしている。"); return; }
      if (S.loc === "y6" && S.dk === 1) { awayDark(); return; }
      if (S.loc === "y3s" && S.fc === 2) { say("像のそばで、じっと待つ。"); return; }
      if (S.loc === "y2b") { say("息をひそめて、待つ。"); return; }
      if (S.loc === "y6q") { if (S.rec.voice && S.rec.voice.s[1] && !S.rec.voice.s[2]) { watchNext("voice"); return; } say("黙って待つ。声も、黙っている。"); return; }
      say("時が過ぎる。");
    },
    hint: () => say("次に見ること：" + hintText(), "note"),
    dunno: () => { say("（分からないときは、まず見る）", "note"); say("次に見ること：" + hintText(), "note"); },
    book: () => say(bookText(false).join("\n"), "doc"),
    help: () => say("遊び方：「命令を作る」で、動詞 → 物（「言う」ならことば）の順にタップする。方角のボタンで移動し、「上」「下」で上下に動く。「観察する」で、きっかけ（A）・行動（B）・その後（C）が野帳に書きこまれる。三つそろうと見立てが立ち、見立てどおりにやってうまくいくと「確かめた」になる。困ったら「野帳」の最後の行。", "note"),
    listen: () => {
      if (S.l0.ring > 0 && S.loc === "y0") { say("耳鳴りで、何も聞こえない。"); return; }
      switch (S.loc) {
        case "y0": say(`蛍光灯のうなり。……その奥で、${DIR_JA[S.l0.quiet]}のほうだけ、うなりが薄い。` + (S.l0.near >= 1 ? "かすかに、ピアノ。" : "")); return;
        case "y0m": say("静かなピアノ。うなりは、ここでは聞こえない。"); return;
        case "y1a": say(S.l1.flk ? (S.l1.arm ? "背後の低いところで、こすれる音。" : "自分の息の音だけ。") : "水の滴る音。天井の管の中を、何かが転がっていく。"); return;
        case "y1k": say("遠くで、人の声。笑い声も混じっている。"); return;
        case "y1x": say("人の声。食器の音。誰かが、ギターを弾いている。"); return;
        case "y1d": say(S.gr === 3 ? "管の中を流れる音。" : "低い唸り。ケーブルがこすれる音。"); return;
        case "y2a": say("機械の中で、何かが空回りする、かすかな音。"); return;
        case "y2b": say("静かだ。……暗がりで、歯のこすれるような小さな音。"); return;
        case "y2c": say(S.wr === 0 ? "「みず……」かすれた声が、くり返している。" : "寝息。"); return;
        case "y3a": case "y3g": say("機械のうなり。電気がはぜる音。遠くで、誰かが泣いているような声。……気のせいかもしれない。"); return;
        case "y3s": say("機械の音が、遠い。"); return;
        case "y3b": say("人の声。発電機の低い音。"); return;
        case "y4a": case "y4h": say("空調の音。蛍光灯のうなりは、ここでは少し小さい。" + (S.loc === "y4h" && S.hd !== 3 ? "低い唸り声。" : "")); return;
        case "y4o": say("紙をめくる音。ペンの音。"); return;
        case "y5a": say("静かなジャズ。壁の向こうで、パーティーのざわめき。誰かに、肩を叩かれた気がした。"); return;
        case "y5b": say("ジャズが、遠く聞こえる。グラスの触れ合う音。誰もいないのに。"); return;
        case "y5c": whisper(); return;
        case "y6":
          if (S.dk === 1 || S.dk === 2) { watchDark(); return; }
          say(`……波の音が、${DIR_JA[S.l6.dirs[Math.min(S.l6.step, 2)]]}のほうから、かすかに。` + (Math.random() < 0.3 ? "どこかで、何かが這うような音。……気のせいだ。" : ""));
          return;
        case "y6q": say(`声の向こう、${DIR_JA[S.l6.dirs[2]]}のほうから、波の音。`); return;
        case "y6s": say("波の音。すぐ下で。"); return;
        case "y7": case "y7w": say("波の音。ずっと下のほうで、何かが鳴いている。"); return;
      }
      say("何も聞こえない。");
    },
    examine: (o) => {
      if (!need(o, "調べる")) return;
      if (o.on.examine && o.on.examine(o)) return;
      if (o.id === "megnote") { VERB_DO.read(o); return; }
      const t = text(o.desc);
      if (t) say(t); else if (t !== "") say(`${o.name}に、特に変わったところはない。`);
    },
    watch: (o) => {
      if (!need(o, "観察する")) return;
      if (o.on.watch && o.on.watch(o)) return;
      VERB_DO.examine(o);
    },
    read: (o) => {
      if (!need(o, "読む")) return;
      if (isDark() && !o.feel) { say("暗くて、字が読めない。"); return; }
      if (!o.read) { VERB_DO.examine(o); return; }
      if (o.id === "megnote") S.seen.megnote = true;
      say(text(o.read), "doc");
    },
    take: (o) => {
      if (!need(o, "取る")) return;
      if (o.on.take && o.on.take(o)) return;
      if (o.loc === "player") { say("もう持っている。"); return; }
      if (o.person) { say(`${o.name}は、物ではない。`); return; }
      if (!o.take) { say(`${o.name}は取れない。`); return; }
      o.loc = "player";
      say(`${o.name}を取った。`);
      if (o.id === "notebook") say("覚えていることを、最初のページから書きこんだ。", "note");
    },
    drop: (o) => {
      if (!need(o, "置く")) return;
      if (o.loc !== "player") { say(`${o.name}は持っていない。`); return; }
      if (S.loc === "y2c" && O.wretch.loc === "y2c" && S.wr < 2 && (o.drink === "grey" || o.drink === "blue")) { feedWretch(o, false); return; }
      if (o.id === "empty" && S.loc === "y1a") { o.loc = "gone"; S.bottleBack = true; S.kind++; say("空き瓶を、メモの横に戻した。"); return; }
      if (o.id === "notebook" && S.loc === "y0m") { VERB_DO.put(o, O.cupboard); return; }
      if (o.id === "flashlight") S.light = false;
      o.loc = S.loc;
      say(`${o.name}を置いた。`);
    },
    put: (o, w) => {
      if (!need(o, "入れる")) return;
      if (o.id === "switch6") { pressSwitch(); return; }
      if (o.id === "notebook" && w && w.id === "cupboard") {
        if (o.loc !== "player") { say("野帳を持っていない。"); return; }
        if (O.cupboard.closed) { say("戸棚は閉まっている。"); return; }
        if (!S.recOrder.some(k => S.rec[k].s.some(Boolean))) { say("まだ、ほとんど白紙だ。何か見てからにしよう。"); return; }
        endChair();
        return;
      }
      if (!w) { say("どこに入れる？"); return; }
      if (w.container && !w.closed && o.loc === "player") { o.loc = w.id; say(`${o.name}を、${w.name}に入れた。`); return; }
      say(`${o.name}は、${w.name}には入れられない。`);
    },
    give: (o, w) => {
      if (!need(o, "渡す")) return;
      if (!w) { say("誰に渡す？"); return; }
      if (o.loc !== "player") { say(`${o.name}は持っていない。`); return; }
      if (w.id === "wretch" && (o.drink === "grey" || o.drink === "blue") && S.wr < 2) { feedWretch(o, true); return; }
      if (w.id === "archivist" && o.id === "notebook") { endArchive(); return; }
      if (w.id === "archivist") { say("「それは、野帳ではないね」", "voice"); return; }
      if (w.id === "waiter" && o.id === "bluegift") { say("「……自分で渡してほしい。会えたら」", "voice"); return; }
      if (w.person) { say(`${w.name}は、首を横に振った。`); return; }
      say(`${w.name}に渡すことはできない。`);
    },
    throw: (o) => {
      if (!need(o, "投げる")) return;
      if (o.loc !== "player") { say(`${o.name}は持っていない。`); return; }
      if (S.loc === "y1d" && S.gr !== 3) {
        o.loc = "y1d";
        if (!o.heavy) { say(`${o.name}を投げた。軽すぎて、効き目がない。`); return; }
        S.gr = 2; S.grT = 3;
        say(`頭の枝分かれを狙って、${o.name}を投げつけた。……当たった。ケーブルの束がふらつき、絡まりかける。`);
        return;
      }
      if (S.loc === "y2b" && (o.id === "flashlight" && S.light || o.id === "glow" && S.glowLit)) {
        o.loc = "gone";
        if (o.id === "flashlight") S.light = false;
        S.sm.bait = 4; S.sm.near = 0;
        say(`${o.name}を、通路の奥へ投げた。灯りが床を転がっていく。……光る顔は、転がる灯りを追っていった。`);
        if (!S.rec.smiler || !S.rec.smiler.s[1]) see("smiler", 1);
        return;
      }
      if (o.id === "notebook") { say("野帳は投げない。"); return; }
      o.loc = S.loc;
      say(`${o.name}を投げた。床に転がった。`);
    },
    open: (o) => {
      if (!need(o, "開ける")) return;
      if (o.on.open && o.on.open(o)) return;
      if (o.container) {
        if (!o.closed) { say("もう開いている。"); return; }
        o.closed = false;
        if (o.id === "crate") { O.cratein.loc = "crate"; say("蓋を外す。おがくずの中に、いくつか物が入っている。……手を入れる前に、よく見たほうがいい。"); return; }
        if (o.id === "cupboard") { say("戸棚を開ける。" + Object.values(O).filter(x => x.loc === "cupboard").map(x => x.name).join("、") + "。"); return; }
        if (o.id === "toolbox") { say("工具箱を開ける。錆びた工具の下に、ケミカルライトが一本。"); return; }
        say(`${o.name}を開けた。`);
        return;
      }
      if (o.read) { VERB_DO.read(o); return; }
      say(`${o.name}は、開けるものではない。`);
    },
    press: (o) => {
      if (!need(o, "押す")) return;
      if (o.on.press && o.on.press(o)) return;
      if (o.id === "hound") { hurt("手を伸ばした瞬間、ハウンドが跳んだ。"); return; }
      say(`${o.name}を押しても、何も起きない。`);
    },
    touch: (o) => {
      if (!need(o, "触る")) return;
      if (o.on.touch && o.on.touch(o)) return;
      VERB_DO.examine(o);
    },
    stare: (o) => {
      if (!need(o, "見つめる")) return;
      if (o.on.stare && o.on.stare(o)) return;
      if (o.on.watch && o.on.watch(o)) return;
      VERB_DO.examine(o);
    },
    away: (o) => {
      if (!need(o, "離れる")) return;
      if (o.on.away && o.on.away(o)) return;
      say(`${o.name}から、少し離れた。`);
    },
    lighton: (o) => {
      if (o && !o.light && !(o.id === "vent1")) { say(`${o.name}は、点けるものではない。`); return; }
      const src = o && o.light ? o : held("flashlight") ? O.flashlight : held("glow") ? O.glow : null;
      if (!src || src.loc !== "player") { say("灯りになるものを持っていない。"); return; }
      if (src.id === "glow") {
        if (S.glowLit && S.glowHidden) { S.glowHidden = false; say("服の中から、ケミカルライトを取り出した。緑の光。"); }
        else if (S.glowLit) { say("もう光っている。"); return; }
        else {
        S.glowLit = true;
        say(LV() === "6" ? "ケミカルライトを折る。……光らない。ここでは、光が光にならない。" : "ケミカルライトを折る。緑色に光りはじめた。");
        }
      } else {
        if (S.light) { say("もう点いている。"); return; }
        S.light = true;
        if (LV() === "6") { say("スイッチを入れる。……光が、出ない。ここでは、光が光にならない。"); return; }
        say("懐中電灯を点けた。");
      }
      if (LV() === "6") return;
      if (S.loc === "y1a" && S.l1.flk > 0) {
        if (S.l1.arm >= 1) { S.l1.arm = 0; S.l1.flashed = true; say("光を向けると、通気口から伸びかけていた白い腕が、びくりと引っこんだ。"); see("arms", 1); }
        else say("灯りの輪の外で、何かが動きを止めた気配。", "warn");
        return;
      }
      if (S.loc === "y2b" && S.sm.bait === 0) { see("smiler", 0); }
      if (S.loc === "y1a" || S.loc === "y2b") return;
      describe(true);
    },
    lightoff: (o) => {
      if (o && !o.light) { say(`${o.name}は、消すものではない。`); return; }
      if ((o && o.id === "glow") || (!S.light && S.glowLit && held("glow"))) {
        if (!S.glowLit) { say("ケミカルライトは、まだ折っていない。"); return; }
        say("ケミカルライトは、一度折ったら消せない。……服の中に押しこんで、光を隠した。");
        S.glowHidden = true;
        return;
      }
      if (!held("flashlight") || !S.light) { say("消す灯りがない。"); return; }
      S.light = false;
      say("懐中電灯を消した。");
    },
    drink: (o) => {
      if (!need(o, "飲む")) return;
      if (o.on.drink && o.on.drink(o)) return;
      if (!o.drink) { say(`${o.name}は、飲めない。`); return; }
      drinkIt(o);
    },
    eat: (o) => {
      if (!need(o, "食べる")) return;
      if (o.on.eat && o.on.eat(o)) return;
      if (!o.food) { say(`${o.name}は、食べられない。`); return; }
      if (o.loc !== "player" && !visible().includes(o)) { say(`ここに${o.name}はない。`); return; }
      o.loc = "gone";
      S.th = Math.max(0, S.th - 25);
      say("缶を開けて、食べる。冷たいが、ちゃんと食べ物の味がする。");
    },
    talk: (o) => {
      if (!need(o, "話しかける")) return;
      if (o.on.talk && o.on.talk(o)) return;
      if (o.id === "hound") { hurt("声をかけた瞬間、ハウンドが跳んだ。"); return; }
      say(o.person ? `${o.name}は、答えない。` : `${o.name}は、答えない。物だ。`);
    },
    say: (w) => {
      if (!w) { say("何と言う？"); return; }
      const show = w.show || w.ja;
      if (stage() >= 2) { say("「……みず」", "voice"); say("ことばが、それしか出てこない。", "note"); return; }
      say(`「${show}」`, "voice");
      if (S.loc === "y4h" && w.ja === "来るな！" && S.hd !== 3) {
        if (S.hd === 1) { S.hdT += 1; say("大声に、ハウンドが耳を伏せた。"); return; }
        say("ハウンドが、こちらを向いた。……目は、まだ合わせていない。", "warn"); return;
      }
      if (S.loc === "y2b" && S.sm.near >= 1) { S.sm.near++; say("声に、光る顔がこちらを向いた。", "warn"); return; }
      if (S.loc === "y2c" && O.wretch.loc === "y2c") { talkWretch(); return; }
      if (S.loc === "y6" && (S.dk === 1 || S.dk === 2)) { talkDark(); return; }
      if (S.loc === "y6q") { watchNext("voice"); return; }
      if (S.loc === "y3g" && O.stranger.loc === "y3g") { say("厚着の人が、こちらを見た。……サングラスの奥は見えない。"); return; }
      if (S.dk === 3 && O.companion.loc === S.loc) { talkCompanion(); return; }
      say("……返事はない。");
    },
    dive: (o) => {
      if (!need(o, "飛びこむ")) return;
      if (o.on.dive && o.on.dive(o)) return;
      say(`${o.name}に飛びこむことはできない。`);
    },
    lookback: () => {
      if (S.loc === "y0") { say("振り向く。今来た部屋は、もう別の部屋になっている。見ていないあいだに、形を変えたのだ。"); return; }
      if (S.loc === "y1a" && S.l1.flk === 0) {
        if (!S.cr.on) {
          crateAppears();
          say("振り向く。……さっきまで何もなかった柱の根もとに、木箱が置いてある。");
          if (S.cr.n >= 2 && full("crate")) verify("crate");
          see("crate", 0);
          return;
        }
        say("振り向く。木箱は、まだそこにある。");
        return;
      }
      if (S.loc === "y4h" && S.hd === 0) { hurt("振り向いて、背中を見せた瞬間、ハウンドが跳んだ。"); return; }
      say("振り向く。誰もいない。");
    },
    sleep: () => {
      const safe = ["y0m", "y1k", "y1x", "y3b", "y3s", "y4a", "y4o", "y5a"];
      if (S.l1.flk > 0) { say("こんなときに、眠れない。"); return; }
      if (!safe.includes(S.loc)) { say("ここでは、眠れない。"); return; }
      S.th = Math.max(0, S.th - 15);
      S.inj = 0;
      say({ y0m: "椅子に座って、テーブルに突っ伏す。ピアノを聞きながら、少し眠った。", y1k: "医務室のベッドで眠る。夢は見なかった。", y1x: "簡易ベッドで眠る。人の話し声が、遠くで子守唄のように続いた。",
        y3b: "寝台で眠る。分厚い壁の外で、ときどき、何かがぶつかる音。", y3s: "像の足もとで、膝を抱えて眠る。", y4a: "壁ぎわで、ワンダラーたちにまじって眠る。",
        y4o: "保管庫の隅の寝台で眠る。紙の匂い。", y5a: "空いている客室を借りて眠る。シーツは、ぱりっとしていた。" }[S.loc]);
      say("（休んだ。けがは手当てされ、渇きも少しおさまった）", "note");
    },
    down: () => go("d"),
    up: () => go("u"),
  };

  // ---- 手が進むたびに起きること ----
  const META = ["hint", "help", "inventory", "look", "dunno", "book"];
  function after(v) {
    if (S.done || S.broken || META.includes(v)) return;
    const lv = LV();
    // 渇き
    S.th += 1 + (S.loc === "y5c" ? 2 : 0);
    const st = S.th >= 170 ? 3 : stage();
    if (st === 3) { endWretch(); return; }
    if (S.th >= 50 && S.stageSaid < 1) { S.stageSaid = 1; say("のどが渇いてきた。", "note"); }
    if (st >= 1 && S.stageSaid < 2) { S.stageSaid = 2; say("腕がかゆい。見ると、赤い発疹が出ている。気持ちが、ささくれ立つ。", "warn"); }
    if (st >= 2 && S.stageSaid < 3) { S.stageSaid = 3; say("ことばが、うまく出てこない。頭の中が、水のことでいっぱいだ。", "warn"); }
    if (S.th < 50) S.stageSaid = 0; else if (S.th < 90) S.stageSaid = Math.min(S.stageSaid, 1); else if (S.th < 130) S.stageSaid = Math.min(S.stageSaid, 2);
    // レベル0：ちらつく壁、うなり
    if (S.loc === "y0") {
      if (S.l0.ring > 0) S.l0.ring--;
      if (S.l0.wall && v !== "go" && v !== "dive") {
        S.l0.fw = (S.l0.fw + 1) % 3;
        emit("tick", S.l0.fw);
        say(["ぱち、と壁の照明が点いた。", "……まだ点いている。", "ふっと消えた。壁紙の模様が消え、奥に灰色のコンクリートが見える。"][S.l0.fw], "note");
      }
      if (S.l0.spike && v !== "go") { S.l0.spike = 0; S.l0.ring = 5; say("うなりの中に立ちつづけた。耳の奥で、甲高い音が鳴りやまない。（しばらく、耳がきかない）", "warn"); }
      else if (!S.l0.spike && v === "go" && Math.random() < 0.08) { S.l0.spike = 1; emit("spike"); say("うなりが、急に大きくなった。耳が痛い。ここを離れたほうがいい。", "warn"); }
    }
    // レベル1：停電と腕
    if (lv === "1") {
      S.l1.turns++;
      if (S.loc === "y1a" && S.l1.flk > 0) {
        S.l1.flk++;
        if (lightOn()) {
          S.l1.lit++;
          if (S.l1.lit >= 2) { flickerHit("灯りが、この区画でただ一つの光になった。……暗闇の奥から、何かが、まっすぐこちらへ走ってくる。"); return; }
        } else {
          S.l1.lit = 0;
          S.l1.arm++;
          if (S.l1.arm === 1) {
            say("背後の低いところ、通気口のあたりで、こすれる音。", "warn");
            see("arms", 0);
            if (S.l1.flashed && S.rec.arms && S.rec.arms.s[1]) see("arms", 2);
          } else if (S.l1.arm === 2) say("首筋に、冷たい指先が触れた。", "warn");
          else if (S.l1.arm >= 3) { flickerHit("白い腕に、首をつかまれた。"); return; }
        }
        if (S.l1.flk > 6 && S.l1.flk) flickerEnd();
      } else if (S.loc === "y1a" && S.l1.flk === 0 && S.l1.turns >= S.l1.next && v !== "go") flickerStart();
    }
    if (S.loc === "y1d" && S.gr === 2) { S.grT--; if (S.grT <= 0) { S.gr = 0; say("ケーブルの束が、また起き上がった。", "warn"); } }
    // レベル2：光る顔
    if (S.loc === "y2b") {
      if (S.sm.bait > 0) { S.sm.bait--; if (S.sm.bait === 0) say("転がった灯りが消えた。光る顔が、またこちらを探している。", "warn"); }
      else if (lightOn()) {
        S.sm.near++;
        if (S.sm.near >= 3) { S.sm.near = 0; hurt("光る顔が、光ごと、こちらに跳びかかった。"); return; }
        say(S.sm.near === 1 ? "光る顔が、こちらの灯りのほうへ、すうっと寄ってきた。" : "顔が、すぐそこまで来ている。", "warn");
        see("smiler", 0); see("smiler", 1);
      } else if (S.sm.near > 0) {
        S.sm.near--;
        say(S.sm.near ? "光る顔は止まり、少しだけ遠ざかった。" : "光る顔は、暗がりの奥へ戻っていった。", "note");
        if (S.rec.smiler && S.rec.smiler.s[1]) see("smiler", 2);
      }
    }
    // レベル3：顔なし
    if (S.loc === "y3a" && S.fc === 1 && v !== "go") {
      S.fcT++;
      if (S.fcT === 1) { say("三人が、槌を構えて、まっすぐこちらへ歩いてくる。", "warn"); see("faceling", 1); }
      else { S.fc = 0; S.fcT = 0; O.facelings.loc = null; hurt("槌が振り下ろされた。"); return; }
    }
    if (S.loc === "y3s" && S.fc === 2) {
      S.fcW++;
      if (S.fcW >= 2) { S.fc = 3; O.facelings.loc = null; say("廊下の足音が、向こうへ遠ざかっていった。", "note"); }
    }
    // レベル4：階段室の扉、ハウンド
    if (S.loc === "y4a" && v !== "look") { S.y4aIdle++; if (S.y4aIdle >= 3 && S.sawStair) { S.sawStair = false; } }
    if (S.loc === "y4h" && S.hd === 1) { S.hdT--; if (S.hdT <= 0) { S.hd = 0; say("ハウンドが、また唸りはじめた。", "warn"); } }
    // レベル6：暗闇でぶつかった人
    if (S.loc === "y6" && S.dk === 1 && !["away", "wait", "go", "listen", "watch", "talk", "touch", "say"].includes(v)) {
      S.dkT++;
      if (S.dkT >= 2) { S.dk = 9; O.darkp.loc = null; hurt("相手は叫んで、めちゃくちゃに腕を振り回し、走り去った。"); return; }
      say("相手の爪に、さらに力がこもる。", "warn");
    }
  }

  // ---- 命令を読む ----
  const EN_SIMPLE = [
    ["look", /^(look|l)$/], ["inventory", /^(inventory|i)$/], ["wait", /^(wait|z)$/], ["hint", /^hint$/], ["help", /^help$/],
    ["listen", /^listen$/], ["dunno", /^(dunno|i don'?t know)$/], ["sleep", /^sleep$/], ["lookback", /^look back$/],
    ["book", /^(book|notebook|read notebook)$/], ["down", /^(descend|climb down)$/], ["up", /^(ascend|climb up)$/],
  ];
  const DIR_WORDS = { n: "n", north: "n", s: "s", south: "s", e: "e", east: "e", w: "w", west: "w", u: "u", up: "u", d: "d", down: "d" };
  function findObj(s) {
    s = String(s || "").trim().toLowerCase().replace(/^the /, "");
    if (!s) return null;
    const vis = visible();
    for (const o of vis) if (o.en === s) return o;
    for (const o of vis) if (o.aliases.some(a => a.toLowerCase() === s)) return o;
    for (const o of vis) if (o.aliases.some(a => a.length > 1 && s.includes(a.toLowerCase()))) return o;
    return { missing: s };
  }
  function findWord(s) {
    s = String(s || "").trim().toLowerCase();
    return WORDS.find(w => w.en === s || w.ja.toLowerCase() === s || (w.alt || []).some(a => a.toLowerCase() === s)) || null;
  }
  function findWordIn(s) {
    let best = null, len = 0;
    for (const w of WORDS) for (const a of [w.ja, ...(w.alt || [])]) { const k = a.replace(/[？?、！!]/g, ""); if (k && k.length > len && s.includes(k)) { best = w; len = k.length; } }
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
      ["give", /^give (.+) to (.+)$/], ["put", /^(?:put|insert) (.+) (?:in|into) (.+)$/], ["put", /^(?:put|insert) (.+)$/],
      ["watch", /^(?:watch|observe) (.+)$/], ["stare", /^stare (?:at )?(.+)$/], ["away", /^(?:back away from|away from) (.+)$/],
      ["talk", /^talk (?:to )?(.+)$/], ["throw", /^throw (.+)$/], ["dive", /^(?:dive into|jump into) (.+)$/],
      ["open", /^open (.+)$/], ["lighton", /^(?:light|turn on|switch on) (.+)$/], ["lightoff", /^(?:douse|turn off|switch off) (.+)$/],
      ["drink", /^drink (.+)$/], ["eat", /^eat (.+)$/], ["press", /^(?:press|push|flip) (.+)$/], ["touch", /^(?:touch|feel) (.+)$/],
      ["listen", /^listen (?:to )?(.+)$/], ["examine", /^(?:examine|x|look at) (.+)$/], ["read", /^read (.+)$/],
      ["take", /^(?:take|get|pick up) (.+)$/], ["drop", /^drop (.+)$/],
    ];
    for (const [v, rx] of pats) { const m = cmd.match(rx); if (m) return { v, a: m[1], b: m[2] }; }
    return null;
  }
  // 先に当たったものを動詞にする。物の名前の部分は伏せてから探すので、名前の中の字は動詞にならない
  const JA_VERBS = [
    ["dunno", /わからな|分からな/],
    ["say", /と言う|って言う|と言って|と答え|を言う|と叫ぶ|と呟く|と口にする|言う$/],
    ["lookback", /振り向|振り返|ふりむ|ふりかえ|後ろを見/],
    ["watch", /観察|様子を見|ようすを見|見張/],
    ["stare", /見つめ|にらむ|睨む|目を合わせ/],
    ["away", /離れ|はなれ|下がる|さがる|遠ざか|後ずさ/],
    ["talk", /話しかけ|話す|はなしかけ|声をかけ/],
    ["give", /渡す|渡して|わたす|あげる|差し出/],
    ["throw", /投げ/],
    ["dive", /飛びこ|飛び込|体当たり|身を投げ|潜る|もぐる/],
    ["sleep", /寝る|眠る|寝て|横になる|休む/], ["up", /上る|登る|上がる|のぼる/], ["down", /降りる|おりる|下りる|降りて/],
    ["touch", /触る|触れる|触って|さわる|なでる|つたう|伝う/], ["eat", /食べる|食べて|食う/], ["drink", /飲む|飲んで|飲み/],
    ["lighton", /点ける|つける|点灯|点けて|折る/], ["lightoff", /消す|消して|消灯/],
    ["press", /押す|押して|押した/],
    ["listen", /聞く|聴く|聞いて|耳をすま|耳を澄ま/],
    ["open", /開け|開く|入る|乗る/], ["put", /入れ|差す|差し|挿す|しまう/], ["read", /読/], ["examine", /調べ|見る|眺め|覗/],
    ["take", /取|拾|持つ|もらう/], ["drop", /置/],
  ];
  const JA_DIRS = { "北": "n", "南": "s", "東": "e", "西": "w", "上": "u", "下": "d" };
  const OBJLESS = ["dunno", "lookback", "sleep", "up", "down"];
  const SIMPLE = { "見る": "look", "周りを見る": "look", "見回す": "look", "持ち物": "inventory", "待つ": "wait", "ヒント": "hint", "遊び方": "help", "ヘルプ": "help",
    "耳をすます": "listen", "耳を澄ます": "listen", "聞く": "listen", "わからない": "dunno", "分からない": "dunno",
    "寝る": "sleep", "眠る": "sleep", "振り向く": "lookback", "振り返る": "lookback", "降りる": "down", "上る": "up", "野帳": "book", "野帳を見る": "book" };
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
    if (verb === "listen" && !objPart) return { v: "listen", raw: true };
    // 名前の頭は、文の頭か助詞のすぐあとにあるものだけを数える
    const edge = i => i === 0 || /[をのにでとへがはから]/.test(objPart[i - 1]);
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
    if (!hits.length && objPart && !["lighton", "lightoff"].includes(verb)) {
      const m = objPart.match(/^(.+?)(を|に|へ|で|の|と|から)/);
      return { v: verb, ao: { missing: m ? m[1] : objPart }, bo: null, raw: true };
    }
    const uniq = hits.filter(h => !hits.some(k => k !== h && k.i <= h.i && k.end >= h.end && (k.end - k.i) > (h.end - h.i)));
    uniq.sort((x, y) => x.i - y.i);
    const after1 = h => objPart.slice(h.end, h.end + 1);
    const a = uniq.find(h => after1(h) === "を") || uniq.find(h => after1(h) === "の") || uniq[0];
    const b = uniq.find(h => h !== a);
    if (verb === "listen") return { v: "listenTo", ao: a ? a.o : null, raw: true };
    return { v: verb, ao: a ? a.o : null, bo: b ? b.o : null, raw: true };
  }

  function act(input, label) {
    if (S.done) { say("ここで、終わっている。いちばん下の「はじめから」で、最初から。", "note"); return; }
    const ascii = /^[\x20-\x7e]*$/.test(input);
    let p = ascii ? parseEn(input) : parseJa(input);
    if (!p) { say("その言い方はわからない。「命令を作る」を使う。"); return; }
    S.moves++;
    S.broken = false;
    if (label && !META.includes(p.v)) { S.hist.push(label); if (S.hist.length > 30) S.hist.shift(); }
    if (p.v === "go") { go(p.dir); after("go"); return; }
    if (p.v === "say") { VERB_DO.say(p.w); after("say"); return; }
    let a = p.ao, b = p.bo;
    if (!p.raw) { a = p.a ? findObj(p.a) : null; b = p.b ? findObj(p.b) : null; }
    for (const x of [a, b]) if (x && x.missing) { say(isDark() ? "暗くて、何も見えない。" : `ここに「${x.missing}」は見当たらない。`); return; }
    let v = p.v;
    if (v === "listen" && a) v = "listenTo";
    if (v === "listenTo") {
      if (a && a.on.listen && a.on.listen(a)) { after("listen"); return; }
      VERB_DO.listen();
      after("listen");
      return;
    }
    const before = S.recOrder.slice();
    VERB_DO[v](a, b);
    const touched = S.recOrder.find(k => !before.includes(k)) || (a && Object.keys(REC).find(k => S.rec[k] && S.rec[k].at.includes(S.moves)));
    if (touched) S.lastRec = touched;
    after(v);
  }

  function submit(label, en) {
    label = String(label || "").trim();
    const cmd = en || label;
    if (!cmd) return;
    if (rows.length > 300) rows = rows.slice(-200);
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
    ["観察する", "watch %", "%を観察する"], ["調べる", "examine %", "%を調べる"], ["読む", "read %", "%を読む"],
    ["取る", "take %", "%を取る"], ["置く", "drop %", "%を置く"], ["渡す", "give % to #", "%を#に渡す"],
    ["入れる", "put % in #", "%を#に入れる"], ["投げる", "throw %", "%を投げる"], ["開ける", "open %", "%を開ける"],
    ["押す", "press %", "%を押す"], ["触る", "touch %", "%に触る"], ["見つめる", "stare at %", "%を見つめる"],
    ["離れる", "away from %", "%から離れる"], ["点ける", "light %", "%を点ける"], ["消す", "douse %", "%を消す"],
    ["飲む", "drink %", "%を飲む"], ["食べる", "eat %", "%を食べる"], ["話しかける", "talk to %", "%に話しかける"],
    ["言う", "say %", "「%」と言う"], ["飛びこむ", "dive into %", "%に飛びこむ"], ["振り向く", "look back", "振り向く"],
  ];

  // ---- 起動 ----
  function intro() {
    say("野帳", "title");
    gap();
    if (LOOP.n) {
      say("また、床が、ほんの一瞬だけ、なかった。");
      say("……ひび割れるようなうなり。湿ったカーペット。この黄色を、知っている。");
    } else {
      say("床が、ほんの一瞬だけ、なかった。");
      say("……ひび割れるような蛍光灯のうなり。腐った水の匂いのするカーペット。黄色い迷路。");
      say("まばたきをすると、通路の位置が、さっきと違っていた。");
    }
    gap();
    describe(true);
    say("―― Level 0「敷居」", "note");
  }
  function start(fresh) {
    rows = [];
    fxq = [];
    LOOP = loadLoop();
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
    fx: () => fxq.slice(),
    visible: () => visible().map(o => ({ id: o.id, name: o.name, en: o.en, held: o.loc === "player" })),
    wordsHere: () => wordsHere().map(w => ({ ja: w.ja, show: w.show || w.ja, en: w.en })),
    // テスト用：今の状態を覗く
    peek: () => S,
    obj: id => O[id],
  };
}
