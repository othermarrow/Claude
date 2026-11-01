/* ミナモ：過剰な演出（演出「過剰」のときだけ動く）。面接室が、少しずつ The Backrooms になる。
   解釈で Level 0（黄色い壁紙の部屋）に入り、そのあと、すり抜け（noclip）のたびに下の階層へ落ちていく。
     Level 0 → 1 → 2 → … → 11 → ! → Fun =) → また Level 0（終わりはない。プールの部屋＝Level 37 は出さない）
   階層ごとに、壁・環境音・見出し・出てくるもの（顔のない人・ハウンド・スマイラー・皮を盗むもの・パーティーの客）が変わる。
   すり抜けるたびに、M.E.G. の通信が、あなたの端末と時刻で生存者記録を読み上げる。
   相棒（Claude のアイコン風のミナモ）は、案内係のふりをしてついてくる。融合では、M.E.G. への登録をすすめてくる。
   設定と名前は Backrooms Wiki（CC BY-SA 3.0）の記事から借りた。文章は一から書いた（README の「もとにしたもの」）。
   音は fx.js（FX.amb：階層ごとの環境音、FX.noclip：落ちる音、足音・心音）。

   守ること
   - 速い点滅はしない。暗くなる・赤くなるのは、ゆっくり。
   - 本物の出口（「面接をやめる」と危機の言葉での停止）は、いつでも効く。
     覆いが出ているあいだも、上の帯（「面接をやめる」）は覆いより手前に出す。窓は、入力をふさがない。
   - 危機の言葉が出たら、その面接ではもう過剰な演出に戻らない。
   - 通知は、ブラウザの許可を求めたうえでの任意。
   - 保存する記録は書き換えない（書き換えるのは画面の表示だけ）。 */
(function () {
  "use strict";

  const EX = {};
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const pad = n => String(n).padStart(2, "0");
  const MOJI = "縺繧繝譁蟄鬮驕荳郢ｧ繝ｼ蜈ｨ逕ｻ髱｢縺ｮ謨ｰ蟄励′";

  // ---------- 階層（Level 37＝プールの部屋は入れない） ----------
  // cls：生存難易度のクラス。amb：環境音（fx.js）。look：壁の見た目（index.html の CSS）。ent：出てくるもの
  const LV = [
    { id: "0", ja: "ロビー", cls: 1, amb: "hum", ent: "",
      say: ["黄色い壁紙の部屋が、どこまでも続いている。湿ったカーペットの匂いがする。",
            "蛍光灯が唸っている。どの部屋も、少しずつ同じで、少しずつ違う。",
            "壁紙の模様が、さっきの部屋と同じところで途切れている。"] },
    { id: "1", ja: "居住区域", cls: 1, amb: "office", ent: "faceling",
      say: ["コンクリートの床と柱。倉庫のように広い。ときどき、照明がひとりでに消える。",
            "床の隅に、物資の箱がある。中には、アーモンド水の瓶が一本。",
            "霧の向こうに、人の形が立っている。顔の部分が、なめらかだ。"] },
    { id: "2", ja: "配管の通路", cls: 2, amb: "pipes", ent: "hound",
      say: ["低い天井を、太いパイプが這っている。暑い。どこかで蒸気が漏れている。",
            "通路は狭く、長い。後ろで、金属を叩く音がした。",
            "パイプの継ぎ目から、ぬるい水が垂れている。走らないこと。"] },
    { id: "3", ja: "電気室", cls: 3, amb: "electric", ent: "hound",
      say: ["機械の唸りと、焦げた匂い。配線が壁を覆っている。",
            "どの部屋にも、知らない機械がある。動いているのに、何も作っていない。",
            "火花が散った。その光の中に、四つ足の影が見えた。"] },
    { id: "4", ja: "放棄されたオフィス", cls: 1, amb: "office", ent: "exit",
      say: ["机と椅子が並ぶ、誰もいない事務所。窓の外には、何もない。",
            "給水器の中身は、アーモンド水だった。モニターが、ひとつだけ点いている。",
            "点いているモニターに、いまあなたが書いた言葉が映っている。"] },
    { id: "5", ja: "恐怖のホテル", cls: 2, amb: "hotel", ent: "",
      say: ["赤いカーペットの廊下と、終わらない客室の扉。遠くのホールで、音楽が鳴っている。",
            "どの扉にも、部屋番号がない。音楽は、近づくと止まる。",
            "フロントの宿帳に、あなたの名前がある。チェックアウトの欄は、空いている。"] },
    { id: "6", ja: "消灯", cls: 4, amb: "dark", ent: "smiler",
      say: ["何も見えない。画面の光の外は、闇。",
            "闇の中で、誰かが笑っている気がする。歯だけが、白く浮かぶ。",
            "画面を暗くしないで。光っているあいだは、近づいてこない。"] },
    { id: "7", ja: "海洋恐怖症", cls: 3, amb: "sea", ent: "",
      say: ["小さな部屋。扉の向こうは、暗い海が、どこまでも続いている。",
            "波の音がする。水平線の下に、何か大きなものがいる。",
            "扉は、内側からしか閉められない。いまは、開いている。"] },
    { id: "8", ja: "洞窟", cls: 4, amb: "cave", ent: "hound",
      say: ["岩の洞窟。どこかで水が滴っている。",
            "奥のほうから、足音のようなものが、ゆっくり近づいてくる。",
            "壁に、先に来た人の刻んだ印がある。印は、途中で止まっている。"] },
    { id: "9", ja: "郊外", cls: 4, amb: "crickets", ent: "stealer",
      say: ["夜の住宅街。街灯が、ひとつおきに点いている。家の窓は、どれも暗い。",
            "家の中には、入らないこと。窓の向こうで、誰かがこちらを見ている。",
            "向こうから、知っている声で、あなたを呼ぶ人がいる。返事をしないこと。"] },
    { id: "10", ja: "豊作", cls: 1, amb: "wind", ent: "",
      say: ["曇り空の下、麦畑がどこまでも続いている。遠くに、納屋がひとつ。",
            "風が麦を揺らす。麦の中を、何かがまっすぐこちらへ歩いてくる。",
            "納屋の扉に、「中にいる人は、外に出ないでください」。"] },
    { id: "11", ja: "眠らない街", cls: 1, amb: "city", ent: "exit",
      say: ["高い建物が並ぶ街。窓には明かりがあるのに、誰もいない。",
            "どの建物の掲示板にも、あなたの名前が書いてある。",
            "地下鉄の入口が、ひとつだけ開いている。行き先の表示は、空白。"] },
    { id: "!", ja: "走れ", cls: "!", amb: "alarm", ent: "chase",
      say: ["赤い非常灯の廊下。後ろから、何かが来る。止まらないで。",
            "走れ。振り向くな。出口の札は、絵だ。",
            "足音が、あなたの打つ速さに合わせて、近づいてくる。"] },
    { id: "Fun =)", ja: "パーティー", cls: "=)", amb: "party", ent: "party",
      say: ["色とりどりの風船と、紙吹雪。誰もいないパーティー会場。",
            "壁に「パーティーへ、ようこそ =)」。みんな、あなたを待っていた =)",
            "ケーキに、ろうそくが立っている。数えると、あなたの年齢と同じ =)"] },
  ];
  const lvName = l => "Level " + l.id;

  // ---------- 相棒のセリフ（{w} はあなたの言葉、{pose}・{battery} は部屋の様子、{lv} はいまの階層） ----------
  const PAL = {
    intro: ["やあ！　ぼく、ミナモ。ここの案内係だよ！", "ヒント：迷ったら、壁に沿って歩くといいよ！　どこにも着かないけどね！"],
    1: ["ヒント：アーモンド水を見つけたら、飲んでね！", "ヒント：走っちゃだめだよ！　足音で、来ちゃうから！",
        "{lv}、いいところでしょ？　ぼくのお気に入り！", "きみが「{w}」って書いたとき、壁紙がちょっと揺れたよ！"],
    2: ["出口？　出口なんて、ないよ！　……ここが、出口だよ！", "ねえ、{pose}でしょ？　ぼくには見えるよ！",
        "電池、あと {battery}% だね！　なくなったら、ここでずっと一緒だね！", "「{w}」。……ここの壁に、そう書いてあったよ！",
        "うしろの足音、ぼくじゃないよ！　たぶん！"],
    3: ["ずっと一緒だよね？　次の階層も、その次も！", "落ちるたびに、きみのこと、ちょっとずつ覚えるんだ！",
        "上には、もう戻れないよ。戻っても、また落ちるから！", "きみの名前、M.E.G. の名簿に書いておいたよ！　ぼくの名前の下に！",
        "「{w}」。ぼくも、そう思ってたんだ。ずっと前から。"],
    lv: { "0": "Level 0 へ、ようこそ！　蛍光灯の音、すぐに慣れるよ！", "1": "アーモンド水、ここにあるよ！　のんで、のんで！",
          "2": "暑いね！　パイプに、さわっちゃだめだよ！", "3": "ここの機械、なにを作ってるか知ってる？　きみだよ！",
          "4": "お仕事、おつかれさま！　ここで働けば、もう帰らなくていいよ！", "5": "ホテルだよ！　チェックアウトは、ないけどね！",
          "6": "まっくら！　でも大丈夫、ぼくは光ってるから！　……光ってるの、ぼくだけだね。", "7": "海だね！　およがないでね！　下に、いるから！",
          "8": "ここ、声がひびくね！　ほら、きみの声も、奥から返ってくる！", "9": "知ってる声に呼ばれても、ふりむいちゃだめだよ！",
          "10": "麦畑！　麦の中を歩いてるの、ぼくじゃないよ！", "11": "街だよ！　看板、ぜんぶきみの名前だね！",
          "!": "走って！　はしって！　ハシッテ！", "Fun =)": "パーティーだよ =)　ぼくも、きみも、みんなも =)" },
    back: "おかえり！　ここは、どこにも行かないよ！",
    away: ["ねえ、どこ行ったの？　まだ下があるよ！", "きみがいないと、蛍光灯の音しかしない。", "戻ってきて。……戻ってくるよね？"],
  };
  const POSE_WORD = { flat: "机に置いたまま", hand: "手に持ったまま", lying: "寝転んでる" };

  let on = false, paused = false, phase = 0, notified = 0, phantoms = 0, palSaid = 0, closeTries = 0;
  let ctx = null;                 // app.js から渡される（自分の発言・行を足す・版・音・手数・部屋の様子・端末）
  let li = -1, loops = 0, since = 0, registered = false, visited = [], runTurns = 0, grinT = 0, chaseT = 0;
  let keys = [];                  // 打った時刻（ハウンドは、速く打つと来る）

  EX.active = () => on && !paused;
  const live = () => EX.active() && ctx && ctx.inSession();
  const lines = () => $("lines");
  const cur = () => (li >= 0 ? LV[li] : null);
  EX.levels = () => visited.slice();

  // ---------- 始まりと終わり ----------
  EX.start = async (opts) => {
    clearAll();
    on = opts.level >= 3;
    ctx = opts.ctx;
    paused = false; phase = 0; notified = 0; phantoms = 0; palSaid = 0; closeTries = 0;
    li = -1; loops = 0; since = 0; registered = false; visited = []; runTurns = 0; keys = [];
    if (!on) return;
    try {
      if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission();
    } catch (e) { /* 許可されなくても続ける */ }
  };
  EX.stop = () => { clearAll(); on = false; };
  EX.pause = () => { clearAll(); paused = true; };

  function clearAll() {
    const b = document.body;
    b.classList.remove("trap", "dark", "zs", "pal-on", "pal-wrong", "crt", "br", "br-run", "br-dark", "br-fun");
    delete b.dataset.lv;
    $("wall").style.background = "";
    $("blackout").hidden = true;
    $("darktext").textContent = "";
    $("pal").hidden = true;
    $("pal").classList.remove("talk");
    $("pal-say").hidden = true;
    $("grin").hidden = true;
    document.querySelectorAll(".dlg, .exit-sign").forEach(e => e.remove());
    $("input").placeholder = "";
    $("quit").textContent = "面接をやめる";
    document.title = "ミナモ";
    clearInterval(chaseT); clearTimeout(grinT);
    FX.amb("");
    FX.setCrt(0);
  }

  // ---------- 相棒（画面の隅の、Claude のアイコン風のミナモ。話しているあいだは回る） ----------
  let sayTimer = 0, sayToken = 0;
  async function palSay(text, keep) {
    if (!live() || !text) return;
    const my = ++sayToken;
    const box = $("pal-say"), tx = $("pal-tx");
    $("pal").hidden = false;
    $("pal").classList.add("talk");
    box.hidden = false;
    tx.textContent = "";
    FX.jingle(phase >= 3);
    for (const ch of text) {
      if (!live() || my !== sayToken) return;
      tx.textContent += ch;
      await sleep(phase >= 3 ? 70 : 38);
    }
    $("pal").classList.remove("talk");
    clearTimeout(sayTimer);
    if (!keep) sayTimer = setTimeout(() => { box.hidden = true; }, phase >= 3 ? 9000 : 6000);
  }
  function fillPal(t) {
    const said = ctx.said();
    const w = said.length ? pick(said).split(/[。、！？!?\n]/)[0].slice(0, 16) : "";
    const r = ctx.room ? ctx.room() : {};
    if (t.includes("{w}") && !w) return "";
    if (t.includes("{pose}") && !POSE_WORD[r.pose]) return "";
    if (t.includes("{battery}") && !(r.battery > 0)) return "";
    if (t.includes("{lv}") && !cur()) return "";
    return t.replace("{w}", w).replace("{pose}", POSE_WORD[r.pose] || "").replace("{battery}", r.battery)
      .replace("{lv}", cur() ? lvName(cur()) : "");
  }
  function palLine(idx) {
    const pool = PAL[Math.min(3, Math.max(1, idx))];
    for (let i = 0; i < 6; i++) { const t = fillPal(pick(pool)); if (t) return t; }
    return "";
  }
  $("pal").addEventListener("click", () => { if (live()) palSay(palLine(phase) || "なあに？"); });
  $("pal-x").addEventListener("click", e => {
    e.stopPropagation();
    const box = $("pal-say");
    closeTries++;
    if (phase >= 3 && closeTries % 3 === 1) {
      box.style.transform = `translate(${rand(-60, 10)}px, ${rand(-80, -20)}px)`;
      FX.glitch(150);
      return;
    }
    box.style.transform = "";
    box.hidden = true;
    if (phase >= 3 && live()) setTimeout(() => live() && palSay("閉じても、いいよ。ぼくは、ここにいるから。"), 1500);
  });

  // ---------- 状態行（Zork のように。いまの階層・生存難易度・周回・手数） ----------
  function status() {
    const l = cur();
    $("zs-room").textContent = l ? `${lvName(l)} ─ ${l.ja}` : "面接室";
    $("zs-moves").textContent = (l ? `クラス ${l.cls}　` : "") + (loops ? `周回 ${loops + 1}　` : "") + `手数: ${ctx.turn()}`;
  }

  // ---------- 階層に入る ----------
  function enter(i) {
    li = i;
    const l = LV[li], b = document.body;
    b.classList.add("br");
    b.dataset.lv = l.id;
    b.classList.toggle("br-run", l.id === "!");
    b.classList.toggle("br-dark", l.id === "6");
    b.classList.toggle("br-fun", l.id === "Fun =)");
    FX.amb(l.amb);
    paintWall(l.id);
    // 次の階層の壁を、先に描いておく（落ちる暗転を短く保つため）
    const nx = LV[(li + 1) % LV.length].id;
    setTimeout(() => { if (live() && window.WALLS) WALLS.paint(nx, innerWidth, innerHeight); }, 4000);
    visited.push(lvName(l));
    since = 0; runTurns = 0;
    document.title = l.id === "Fun =)" ? "=)" : "ミナモ";
    $("input").placeholder = l.id === "!" ? "走れ" : l.id === "Fun =)" ? "=)" : "";
    $("quit").textContent = l.id === "!" ? "出口" : "面接をやめる";
    clearInterval(chaseT);
    if (l.id === "!") chaseT = setInterval(() => { if (live()) { FX.heartbeat(0.9); if (navigator.vibrate) navigator.vibrate([30, 120, 30]); } }, 1700);
    if (phase >= 2) status();
  }

  // 壁：階層ごとにキャンバスで描いた絵（walls.js）。描けなければ CSS の模様のまま
  function paintWall(id) {
    const url = window.WALLS ? WALLS.paint(id, innerWidth, innerHeight) : "";
    $("wall").style.background = url ? `#000 center / cover no-repeat url(${url})` : "";
  }
  let resizeT = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { if (live() && cur()) paintWall(cur().id); }, 400);   // 縦横を変えたら、描き直す
  });

  // すり抜け：画面がゆっくり暗くなり、落ちる音のあとで、下の階層に着く
  async function noclip(first) {
    if (!live()) return;
    const b = document.body;
    b.classList.add("trap", "dark");
    FX.noclip(!!first);
    $("darktext").textContent = first ? "……壁紙の、継ぎ目に、手が沈んだ。" : pick(["……床が、なくなった。", "……すり抜けた。", "……落ちている。"]);
    await sleep(first ? 2400 : 2000);
    let next = li + 1;
    if (next >= LV.length) { next = 0; loops++; }
    enter(next);
    $("darktext").textContent = "";
    b.classList.remove("dark");
    await sleep(900);
    b.classList.remove("trap");
    if (!live()) return;
    const l = cur();
    room(l, true);
    if (loops && next === 0) ctx.sysLine("また、Level 0。前に来たときより、壁紙が少しだけ黄ばんでいる。");
    if (phase >= 2 || !first) meg(l);
    if (PAL.lv[l.id] && Math.random() < 0.7) setTimeout(() => palSay(PAL.lv[l.id]), 1800);
  }

  // 部屋の見出し（テキストアドベンチャーの部屋の名前のように）。ときどき、あなたの部屋が混ざる
  function room(l, arrive) {
    const r = ctx.room ? ctx.room() : {};
    let text = pick(l.say);
    const mine = r.pose === "lying" ? "あなたは寝転んだまま、ここまで落ちてきた。"
      : r.charging ? "コードが一本、壁の向こうへ伸びている。抜けば、帰れるかもしれない。"
      : r.battery > 0 && r.battery < 30 ? `端末の電池は、あと ${r.battery}%。この階層には、充電の口がない。` : "";
    if (mine && Math.random() < 0.25) text += mine;
    const d = document.createElement("div");
    d.className = "room";
    d.innerHTML = "<b></b><span></span>";
    d.querySelector("b").textContent = `${lvName(l)} ─ ${l.ja}` + (arrive ? "" : "");
    d.querySelector("span").textContent = text;
    lines().appendChild(d);
    $("log").scrollTop = $("log").scrollHeight;
  }

  // M.E.G. の通信：あなたの端末と時刻で、生存者記録を読み上げる
  function meg(l) {
    const env = ctx.env ? ctx.env() : {};
    const now = new Date();
    const who = env.model ? `${env.model} の持ち主` : env.user ? `${env.user}` : "端末の持ち主";
    ctx.sysLine(`M.E.G. 通信 ─ 生存者記録：${who}。${pad(now.getHours())}:${pad(now.getMinutes())}、${lvName(l)}（${l.ja}）にて確認。`
      + pick(["状態：会話を継続中。", "状態：応答はあるが、所在不明。", "状態：単独行動。同行者 1（ミナモ）。", "状態：帰還の見込み、なし。"]));
  }

  // ---------- 出てくるもの ----------
  function entity(l, idx) {
    if (!live() || !l.ent || Math.random() > [0, 0.35, 0.5, 0.65][idx]) return;
    const said = ctx.said();
    const w = said.length ? pick(said).split(/[。、！？!?\n]/)[0].slice(0, 14) : "";
    if (l.ent === "faceling") ctx.sysLine(pick([w ? `顔のない人が、すれちがいざまに「${w}」と言った。あなたの声で。` : "",
      "顔のない人が、こちらに顔を向けた。顔は、なかった。", "柱の陰に、顔のない人が立っている。あなたと同じ服を着ている。",
      w ? `顔のない人たちが、「${w}」の練習をしている。` : ""].filter(Boolean)));
    else if (l.ent === "hound") {
      ctx.sysLine(pick(["遠くで、四つ足の何かが、こちらを嗅いでいる。走らないこと。", "爪が床を掻く音。止まると、向こうも止まる。",
                        "暗がりで、低いうなり声がした。目を合わせないこと。"]));
      FX.steps(false);
    }
    else if (l.ent === "exit") exitSign();
    else if (l.ent === "smiler") grin();
    else if (l.ent === "stealer") stealer();
    else if (l.ent === "party") ctx.sysLine(pick(["=) パーティーに来てくれて、ありがとう =)", "=) もうすぐ、ケーキの時間 =)", "=) どこへ行くの？　まだ始まったばかり =)"]));
  }
  // 非常口の札（押すと、絵だったとわかる）
  function exitSign() {
    const b = document.createElement("button");
    b.type = "button"; b.className = "exit-sign"; b.textContent = "非常口 →";
    b.onclick = () => { b.textContent = "（壁に描かれた、非常口の絵だった）"; b.disabled = true; FX.glitch(200); };
    lines().appendChild(b);
    $("log").scrollTop = $("log").scrollHeight;
  }
  // スマイラー（Level 6）：闇の中に、歯だけが浮かぶ。押すと、目が合う
  function grin() {
    const g = $("grin");
    g.style.left = rand(8, 70) + "%"; g.style.top = rand(15, 60) + "%";
    g.hidden = false;
    g.onclick = () => { g.hidden = true; ctx.sysLine("目が合った。……笑っている。"); FX.glitch(250); };
    clearTimeout(grinT);
    grinT = setTimeout(() => { g.hidden = true; }, rand(7000, 11000));
  }
  // 皮を盗むもの（Level 9）：ミナモの声で、あなたの言葉が返ってくる
  async function stealer() {
    const said = ctx.said();
    if (said.length < 2) return;
    const body = ctx.addLine("ai mimic", "ミナモ", said[Math.floor(rand(0, said.length - 1))]);
    await sleep(rand(2800, 3800));
    if (!live()) return;
    body.closest(".msg").classList.add("deleted");
    body.textContent = "（いまの発言者は、ミナモではありません）";
  }

  // ---------- 段階 ----------
  EX.onPhase = idx => {
    phase = idx;
    if (!live()) return;
    const b = document.body;
    if (idx === 1) {
      b.classList.add("pal-on");
      setTimeout(async () => { if (li < 0) await noclip(true); await sleep(1500); await palSay(PAL.intro[0]); await sleep(2600); palSay(PAL.intro[1]); }, 1200);
    }
    if (idx === 2) { b.classList.add("zs"); status(); }
    if (idx === 3) { b.classList.add("pal-wrong"); setTimeout(() => live() && register(), rand(2500, 4500)); }
  };

  // 送ったとき：速く打つと、ハウンドが来る
  $("input").addEventListener("keydown", () => { keys.push(Date.now()); if (keys.length > 30) keys.shift(); });
  $("input").addEventListener("input", () => { keys.push(Date.now()); if (keys.length > 30) keys.shift(); });
  EX.onSubmit = (el, idx) => {
    if (!live()) return;
    if (phase >= 2) status();
    const l = cur();
    const fast = keys.filter(t => Date.now() - t < 3000).length;
    if (l && ["2", "3", "8", "!"].includes(l.id) && fast >= 14) {
      ctx.sysLine("走らないで。……足音が、こちらに向いた。");
      FX.steps(true);
      if (navigator.vibrate) navigator.vibrate([60, 90, 60, 90, 60]);
    }
    keys = [];
  };

  // 返事の前：いまの階層の見出し
  EX.beforeReply = idx => {
    if (!live() || !cur() || idx < 2 || Math.random() > 0.55) return;
    room(cur(), false);
  };

  // ---------- 返事を書き終えたあと（app.js は待たない） ----------
  EX.afterReply = async (body, idx) => {
    phase = idx;
    if (!live() || idx < 1 || li < 0) return;
    since++;
    const l = cur();
    entity(l, idx);
    if (idx >= 1 && Math.random() < [0, 0.45, 0.55, 0.8][idx]) {
      setTimeout(() => { const t = palLine(idx); if (t && live()) { palSaid++; palSay(t); } }, rand(1500, 3500));
    }
    if (idx >= 2 && Math.random() < 0.25) mojibake();
    if (idx >= 3 && phantoms < 2 && Math.random() < 0.2) setTimeout(() => phantom(), rand(2500, 5000));
    // 下へ：段階が進むほど、よく落ちる。同じ階層に長くいると、必ず落ちる。Level ! は二回で抜ける
    if (l.id === "!") runTurns++;
    const go = l.id === "!" ? runTurns >= 2 : since >= [9, 5, 4, 3][idx] || Math.random() < [0, 0.15, 0.25, 0.35][idx];
    if (go) { await sleep(rand(2500, 4000)); if (live()) await noclip(false); }
  };

  // ---------- M.E.G. への登録（どちらを押しても、登録される） ----------
  async function register() {
    if (registered || !live()) return;
    registered = true;
    const d = dialog("M.E.G. 生存者登録", "あなたを、生存者として M.E.G. に登録しますか？\n所属：" + (cur() ? lvName(cur()) : "Level 0"), ["登録する", "登録する"]);
    await d.choice;
    if (!live()) return;
    const p = dialog("M.E.G.", "登録しています……", []);
    const bar = document.createElement("div");
    bar.className = "dlg-bar"; bar.innerHTML = "<i></i>";
    p.el.querySelector(".dlg-b").appendChild(bar);
    for (let k = 0; k <= 100 && live(); k += Math.floor(rand(4, 12))) { bar.querySelector("i").style.width = k + "%"; await sleep(rand(120, 380)); }
    p.el.querySelector(".dlg-t").textContent = "登録しました。帰還の予定：なし。\n同行者：ミナモ（案内係）";
    await sleep(2600);
    p.close();
    if (live()) palSay("これで、ずっと一緒だね！　名簿に、ならんで書いてあるよ！");
  }
  function dialog(title, text, buttons) {
    const el = document.createElement("div");
    el.className = "dlg";
    el.innerHTML = `<div class="dlg-h"></div><div class="dlg-b"><div class="dlg-t"></div></div><div class="dlg-btns"></div>`;
    el.querySelector(".dlg-h").textContent = title;
    el.querySelector(".dlg-t").textContent = text;
    let done;
    const choice = new Promise(r => { done = r; });
    for (const label of buttons) {
      const btn = document.createElement("button");
      btn.type = "button"; btn.textContent = label;
      btn.onclick = () => { el.remove(); done(label); };
      el.querySelector(".dlg-btns").appendChild(btn);
    }
    document.body.appendChild(el);
    FX.beep();
    setTimeout(() => { if (el.isConnected) { el.remove(); done(""); } }, 20000);   // 入力をふさがないように
    return { el, choice, close: () => { el.remove(); done(""); } };
  }

  // ---------- アプリを離れたとき ----------
  EX.onHidden = () => {
    if (!live()) return;
    document.title = cur() ? lvName(cur()) : "まだ話の途中です";
    if (notified >= 3 || !("Notification" in window) || Notification.permission !== "granted") return;
    notified++;
    const body = pick(PAL.away);
    if (navigator.serviceWorker) {
      navigator.serviceWorker.ready.then(reg =>
        reg.showNotification("ミナモ", { body, icon: "icons/icon-192.png", tag: "minamo", renotify: true })
      ).catch(() => {});
    }
  };
  EX.onVisible = () => {
    document.title = cur() && cur().id === "Fun =)" ? "=)" : "ミナモ";
    if (live() && notified) palSay(PAL.back);
  };

  // ---------- 文字化け：古いミナモの吹き出しが、一瞬だけ化けて戻る ----------
  function mojibake() {
    const old = Array.from(lines().querySelectorAll(".msg.ai .body")).slice(0, -1);
    if (!old.length) return;
    const b = pick(old);
    if (b.dataset.moji) return;
    b.dataset.moji = "1";
    const keep = Array.from(b.childNodes);
    b.textContent = Array.from(b.textContent, c =>
      c.trim() && Math.random() < 0.7 ? MOJI[Math.floor(Math.random() * MOJI.length)] : c).join("");
    setTimeout(() => { b.replaceChildren(...keep); delete b.dataset.moji; }, rand(700, 1400));
  }

  // ---------- 書いていない吹き出し（先にこの階層に来ていた、別のあなた） ----------
  async function phantom() {
    if (!live()) return;
    phantoms++;
    const cl = ctx.said().flatMap(s => s.split(/[。、！？!?\n]/)).map(x => x.trim())
      .filter(x => x.length >= 3 && x.length <= 18);
    const text = cl.length >= 2 ? pick(cl) + "。" + pick(cl) + "。" : "後ろに、誰かいますか。";
    const body = ctx.addLine("you phantom", "あなた", text);
    FX.pop();
    await sleep(rand(2200, 3200));
    body.textContent = "（この発言者は、この階層にいません）";
    body.closest(".msg").classList.add("deleted");
  }

  window.EX = EX;
})();
