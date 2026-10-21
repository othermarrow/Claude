// kura_walk.js — 『蔵守』の攻略手順（自動テスト用）。
// エンジンの act / go / choose だけで、結末までの手順を再現して、着けるかを確かめる。
"use strict";

function make(g, Kura, verbose) {
  const R = Kura.DEFS.rooms;
  const w = { g };

  // 部屋の行き先を、幅優先で探して、1歩ずつ歩く（条件は実際に歩いて確かめる）
  w.route = (from, to) => {
    const prev = { [from]: null };
    const q = [from];
    while (q.length) {
      const r = q.shift();
      if (r === to) break;
      for (const d of Object.keys(R[r].exits)) {
        const e = R[r].exits[d];
        const nx = typeof e === "string" ? e : e.to;
        if (!(nx in prev)) { prev[nx] = [r, d]; q.push(nx); }
      }
    }
    if (!(to in prev)) throw new Error("道がない: " + from + " → " + to);
    const steps = [];
    for (let r = to; prev[r]; r = prev[r][0]) steps.unshift(prev[r][1]);
    return steps;
  };
  w.goto = to => {
    let guard = 0;
    while (g.S.room !== to && !g.S.over && guard++ < 60) {
      w.clearPrompt();
      const r = g.S.room;
      const d = w.route(r, to)[0];
      g.go(d);
      if (g.S.room === r && !g.S.over) throw new Error("動けなかった: " + d + " @ " + r + "（" + to + "へ）\n" + g.out.slice(-3).join("\n"));
    }
  };
  w.act = (v, a, b) => { w.clearPrompt(); g.act(v, a, b); };
  w.take = id => {
    w.clearPrompt();
    g.act("take", id);
    if (g.S.loc[id] !== "held") throw new Error("取れなかった: " + id + " @ " + g.S.room + "\n" + g.out.slice(-3).join("\n"));
  };
  w.open = id => w.act("open", id);
  w.read = id => w.act("read", id);
  w.use = id => w.act("use", id);
  w.use2 = (a, b) => w.act("use2", a, b);
  w.talk = id => w.act("talk", id);
  w.ask = (id, t) => w.act("ask", id, "t:" + t);
  w.give = (a, b) => w.act("give", a, b);
  w.pull = id => w.act("pull", id);
  w.choose = label => {
    const c = g.choices().find(x => x.label === label);
    if (!c) throw new Error("選択肢がない: " + label + " / " + JSON.stringify(g.choices()) + "\n" + g.out.slice(-3).join("\n"));
    g.choose(c.id);
  };
  w.want = (cond, msg) => { if (!cond) throw new Error("条件が満たされていない: " + msg + " [" + w.state() + "]\n" + g.out.slice(-4).join("\n")); };
  w.state = () => `${g.S.day}日目 ${g.S.phase} t=${g.S.t} nt=${g.S.nt} 場所=${g.S.room} 不安=${g.S.dread}`;
  w.clearPrompt = () => {
    const ch = g.choices();
    if (ch.length) {
      const safe = ch.find(c => /しない|断る|やめる|見送る/.test(c.label)) || ch[ch.length - 1];
      g.choose(safe.id);
    }
  };
  w.wait1 = () => { w.clearPrompt(); g.act("wait"); };
  w.waitPhase = (phase) => { let n = 0; while (g.S.phase !== phase && !g.S.over && n++ < 80) w.wait1(); };
  w.waitNt = nt => { let n = 0; while (g.S.phase === "夜" && g.S.nt < nt && !g.S.over && n++ < 80) w.wait1(); };
  w.waitDay = day => { let n = 0; while (g.S.day < day && !g.S.over && n++ < 200) w.wait1(); };
  w.light = () => { if (!g.on("kaichu")) g.act("use", "kaichu"); };
  w.log = (...a) => { if (verbose) console.log("   ##", ...a, "|", w.state()); };
  return w;
}

function day1(w) {
  const { g } = w;
  w.talk("tome");
  w.goto("doma");
  w.open("hikidashi"); w.take("nikki1"); w.read("nikki1");
  w.open("todana"); w.take("shio");
  w.goto("butsuma");
  w.open("butsudan"); w.open("butsudan_hiki");
  w.take("oboegaki"); w.read("oboegaki"); w.take("matchbox");
  w.goto("nando");
  w.open("nagamochi"); w.take("kaichu");
  w.goto("furo"); w.take("oke");
  w.goto("obaba");
  w.open("fudukue"); w.take("suzu");
  w.open("kirihako"); w.take("nafuda");
  w.log("day1 done");
}

// 夜の務め：蔵の前で、鈴・桶・数える
function duty(w, n) {
  const { g } = w;
  w.want(g.has("suzu") && g.has("kaichu"), "鈴と懐中電灯");
  if (!g.flag("okeFull")) {
    if (g.has("oke")) { w.goto("ido"); w.use2("oke", "ido_well"); }
  }
  w.want(g.flag("okeFull"), "桶に水");
  w.goto("kuramae");
  if (!g.on("kaichu")) w.use("kaichu");
  w.waitNt(6);
  for (let i = 0; i < 3; i++) w.use("suzu");
  w.use2("oke", "mizo");
  for (let i = 0; i < 3; i++) w.act("count");
  w.want(g.flag("duty" + n), "務め" + n);
  w.log("duty" + n + " done");
}

function nightWait(w, n) {
  const { g } = w;
  w.waitDay(n + 1);
  w.want(g.S.day === n + 1 && !g.S.over, "夜が明ける " + w.state());
}

function day2(w) {
  const { g } = w;
  w.want(g.S.day === 2, "2日目");
  // 集会所
  w.goto("shukaijo");
  w.act("examine", "keijiban");
  w.read("kirinuki");
  // 水神社
  w.goto("suijinja");
  w.act("examine", "ema");
  w.act("examine", "hokora");
  // 寺
  w.goto("hondo");
  w.talk("juushoku");
  w.want(g.flag("juushokuTrust"), "住職の信頼");
  w.read("kakocho");
  w.want(g.has("meibo_copy"), "名簿の写し");
  w.log("寺 done");
  // ダム
  w.goto("dam_office");
  w.use("tenkey");
  w.choose("1960");
  w.want(g.flag("damDoorOpen"), "管理棟の扉");
  w.goto("kanri");
  w.read("tejunsho");
  w.use("seigyoban");
  w.choose("主電源を入れる");
  w.choose("放流警報を鳴らす");
  w.choose("副ゲートを開く");
  w.want(g.flag("drawdown"), "放流");
  w.log("ダム done");
  // 分校（夕方）
  w.goto("classroom");
  w.waitPhase("夕");
  w.act("examine", "kokuban");
  w.talk("mio");
  w.give("nafuda", "mio");
  w.want(g.flag("mioHelped"), "みおに名札");
  w.log("分校 done");
}

function day3morning(w) {
  const { g } = w;
  w.want(g.S.day === 3, "3日目の朝 " + w.state());
  w.goto("gate");
  w.talk("tome");
  w.want(g.has("kuranokagi"), "蔵の鍵");
}

function day3(w, opts) {
  opts = opts || {};
  const { g } = w;
  w.goto("nagaya");
  w.take("kama"); w.take("nagagutsu"); w.take("kago");
  if (opts.fire) w.take("abura");
  w.goto("kuramae");
  w.use2("kama", "kura_no_to");
  w.use2("kuranokagi", "kura_no_to");
  w.open("kura_no_to");
  w.want(g.flag("kuraOpen"), "蔵が開く");
  w.goto("kura1");
  w.light();
  w.open("kura_tsukue"); w.take("nikki3"); w.read("nikki3");
  w.goto("kura2");
  w.act("examine", "kura_tana");
  w.goto("kura1");
  w.pull("kura_ita");
  w.log("蔵 done");
}

function night3finale(w) {
  const { g } = w;
  w.goto("kura_b");
  w.want(g.S.phase === "夜" && g.S.day === 3, "3日目の夜 " + w.state());
  w.light();
  w.take("suikyo");
  w.want(g.has("suikyo"), "水鏡");
  w.read("meibo_copy");
  w.go_e = () => g.go("e");
  g.go("e"); g.go("e"); g.go("e");
  w.want(g.S.room === "soko", "底の社 " + w.state());
  w.use2("suikyo", "soko_daiza");
  w.want(g.flag("mirrorPlaced"), "鏡を置く");
  w.read("meibo_copy");
}

const WALKS = {
  // 真の結末：帰る人々
  return(w) {
    const { g } = w;
    day1(w);
    w.goto("maeniwa");
    w.waitPhase("夜");
    duty(w, 1);
    w.waitDay(2);
    day2(w);
    // 2日目の夜
    w.goto("zashiki");
    w.waitPhase("夜");
    duty(w, 2);
    w.waitDay(3);
    day3morning(w);
    day3(w);
    w.waitPhase("夜");
    night3finale(w);
    w.want(g.S.over === "return", "結末 return / " + g.S.over);
  },
};


// 共通：3日目の昼まで
function upToDay3(w, opts) {
  const { g } = w;
  day1(w);
  w.goto("maeniwa");
  w.waitPhase("夜");
  duty(w, 1);
  w.waitDay(2);
  if (!(opts && opts.skipDay2)) day2(w);
  w.goto("zashiki");
  w.waitPhase("夜");
  if (!(opts && opts.skipDuty2)) duty(w, 2);
  w.waitDay(3);
  day3morning(w);
}

const WALKS2 = {
  escape(w) {
    const { g } = w;
    w.waitDay(2);
    w.goto("basutei");
    w.act("wait");
    w.choose("乗る");
    w.want(g.S.over === "escape", "結末 escape / " + g.S.over);
  },
  loop(w) {
    const { g } = w;
    day1(w);
    w.goto("nando");
    w.waitDay(4);
    w.want(g.S.over === "loop", "結末 loop / " + g.S.over + " " + w.state());
  },
  keeper(w) {
    const { g } = w;
    upToDay3(w);
    day3(w);
    w.waitPhase("夜");
    w.goto("kura_b");
    w.light();
    w.act("sit");
    w.choose("座る");
    w.want(g.S.over === "keeper", "結末 keeper / " + g.S.over + " " + w.state());
  },
  substitute(w) {
    const { g } = w;
    upToDay3(w);
    day3(w);
    w.goto("gate");
    w.give("nikki3", "tome");
    w.want(g.flag("tomeOffered"), "トメの申し出");
    w.goto("kuramae");
    w.waitPhase("夜");
    w.waitNt(3);
    w.want(g.here("tome"), "トメが蔵の前に来る " + w.state());
    w.talk("tome");
    w.choose("お願いする");
    w.want(g.S.over === "substitute", "結末 substitute / " + g.S.over);
  },
  fire(w) {
    const { g } = w;
    upToDay3(w);
    w.goto("nagaya");
    w.take("kama"); w.take("abura");
    w.goto("kuramae");
    w.use2("kama", "kura_no_to");
    w.use2("abura", "kura_no_to");
    w.use2("matchbox", "kura_no_to");
    w.choose("火をつける");
    w.want(g.S.over === "fire", "結末 fire / " + g.S.over);
  },
  called(w) {
    const { g } = w;
    upToDay3(w);
    day3(w);
    w.waitPhase("夜");
    w.goto("kura_b");
    w.light();
    w.take("suikyo");
    let n = 0;
    while (!g.S.over && n++ < 40) w.act("wait");
    w.want(g.S.over === "called", "結末 called / " + g.S.over + " " + w.state());
  },
  hide(w) {
    // 務めを果たさず、納戸に隠れて夜を越える
    const { g } = w;
    day1(w);
    w.goto("nando");
    w.waitPhase("夜");
    w.act("close", "nando_door");
    w.act("eyes");
    let n = 0;
    while (g.S.day < 2 && n++ < 60) w.act("wait");
    w.want(g.S.day === 2, "朝になる");
    w.want(g.S.dread < 12, "気を失わない");
    console.log("   不安:", g.S.dread);
  },
  expose(w) {
    // 務めを果たさず、座敷にいる：来訪者に会う
    const { g } = w;
    day1(w);
    w.goto("zashiki");
    w.waitPhase("夜");
    let n = 0;
    while (g.S.day < 2 && n++ < 60) w.act("wait");
    console.log("   不安:", g.S.dread, w.state());
  },
};
Object.assign(WALKS, WALKS2);

function day2plus(w) {
  const { g } = w;
  w.want(g.S.day === 2, "2日目");
  w.goto("tadokoro");
  w.open("tadokoro_butsudan"); w.take("wappu_tadokoro");
  w.goto("matsuoka");
  w.open("matsuoka_irori"); w.take("wappu_matsuoka"); w.read("matsuoka_tegami");
  w.goto("yubin");
  w.open("yubin_yama"); w.take("wappu_kubo");
  w.goto("suijinja");
  w.open("saisenbako"); w.take("wappu_tsuruta");
  w.goto("hondo");
  w.talk("juushoku");
  w.read("kakocho");
  w.open("mokugyo"); w.take("wappu_onodera");
  w.goto("chuzaisho");
  w.read("nisshi");
  w.use("kinko"); w.choose("0620");
  w.take("hatsu_tegami"); w.take("kagi_yobi"); w.take("wappu_mizuno");
  w.read("hatsu_tegami");
  w.goto("dam_office");
  w.use2("kagi_yobi", "tenkey");
  w.goto("kanri");
  w.read("tejunsho");
  w.use("seigyoban");
  w.choose("主電源を入れる"); w.choose("放流警報を鳴らす"); w.choose("副ゲートを開く");
  w.want(g.flag("drawdown"), "放流");
  w.log("day2plus done");
}

function day3plus(w) {
  const { g } = w;
  w.goto("nagaya");
  w.take("kama"); w.take("nagagutsu"); w.take("kago");
  w.goto("kuramae");
  w.use2("kama", "kura_no_to");
  w.use2("kuranokagi", "kura_no_to");
  w.open("kura_no_to");
  w.goto("kura1");
  w.light();
  w.open("kura_tsukue"); w.take("nikki3"); w.read("nikki3");
  w.goto("kura2");
  w.use2("nafuda", "ningyo");
  w.take("wappu_kashiwagi");
  w.goto("kura1");
  w.pull("kura_ita");
  w.log("day3plus done");
}

WALKS.plus = function (w) {
  const { g } = w;
  day1(w);
  w.goto("maeniwa");
  w.waitPhase("夜");
  duty(w, 1);
  w.waitDay(2);
  day2plus(w);
  w.goto("zashiki");
  w.waitPhase("夜");
  w.waitDay(3);
  day3morning(w);
  day3plus(w);
  w.waitPhase("夜");
  w.goto("kura_b");
  w.light();
  w.take("suikyo");
  w.read("meibo_copy");
  g.go("e"); g.go("e"); g.go("e");
  w.want(g.S.room === "soko", "底の社 " + w.state());
  w.use2("suikyo", "soko_daiza");
  for (const id of ["wappu_kashiwagi","wappu_tadokoro","wappu_matsuoka","wappu_mizuno","wappu_kubo","wappu_onodera","wappu_tsuruta"]) w.want(g.has(id), "割符 " + id);
  w.use2("wappu_kashiwagi", "soko_daiza");
  w.want((g.flag("wappu") || 0) >= 7, "割符7");
  w.read("meibo_copy");
  w.want(g.S.over === "return_plus", "結末 return_plus / " + g.S.over);
};

module.exports = { make, WALKS };
module.exports.run = function (newGame, name, verbose, Kura) {
  const g = newGame(verbose);
  const w = make(g, g.Kura || Kura, verbose);
  console.log("walk:", name);
  WALKS[name](w);
  console.log("結末:", g.S.over, "|", w.state());
};
