// engine.js — 日本語で書き下ろしたテキストアドベンチャー用の、小さなエンジン。
// 世界（部屋・物・夜の出来事・結末）は別のファイルで Kura.define() に渡して作る。
// 画面とのやりとりは ui（say / gap / sep / status / sys / vibrate）と、
// game の verbs() / things() / exits() / act() / go() / text() / choices() / choose() で行う。
"use strict";

const Kura = (() => {
  const DEFS = { rooms: {}, items: {}, topics: {}, nights: {}, prompts: {}, endings: {}, hints: [], plan: {}, phaseMsg: {}, init: [], title: "" };

  const api = {
    room(id, d) { DEFS.rooms[id] = Object.assign({ id, exits: {} }, d); },
    item(id, d) { DEFS.items[id] = Object.assign({ id, take: false, on: {}, words: [] }, d); },
    topic(id, d) { DEFS.topics[id] = Object.assign({ id }, d); },
    night(n, d) { DEFS.nights[n] = d; },
    prompt(id, d) { DEFS.prompts[id] = d; },
    ending(id, d) { DEFS.endings[id] = d; },
    hint(fn) { DEFS.hints.push(fn); },
    plan(d) { Object.assign(DEFS.plan, d); },
    phaseMsg(d) { Object.assign(DEFS.phaseMsg, d); },
    onInit(fn) { DEFS.init.push(fn); },
    set(k, v) { DEFS[k] = v; },
  };
  function define(fn) { fn(api); }

  const DIR = { n: "北", s: "南", e: "東", w: "西", u: "上", d: "下" };
  const DIR_WORDS = { "北": "n", "南": "s", "東": "e", "西": "w", "上": "u", "下": "d" };

  // [id, ボタンの字, 物の数, 画面に出す形, 目立たせる]
  const VERBS = [
    ["look", "見回す", 0, "見回す", 1], ["inv", "持ち物", 0, "持ち物を見る", 1], ["notes", "手がかり", 0, "手がかりを見返す", 1],
    ["wait", "待つ", 0, "待つ", 0], ["sleep", "眠る", 0, "眠る", 0], ["listen", "耳をすます", 0, "耳をすます", 0],
    ["smell", "においを嗅ぐ", 0, "においを嗅ぐ", 0], ["eyes", "目を閉じる", 0, "目を閉じる", 0], ["count", "数える", 0, "数える", 0],
    ["examine", "調べる", 1, "%を調べる", 0], ["take", "取る", 1, "%を取る", 0], ["drop", "置く", 1, "%を置く", 0],
    ["open", "開ける", 1, "%を開ける", 0], ["close", "閉める", 1, "%を閉める", 0], ["read", "読む", 1, "%を読む", 0],
    ["use", "使う", 1, "%を使う", 0], ["use2", "〜に使う", 2, "%を#に使う", 0],
    ["push", "押す", 1, "%を押す", 0], ["pull", "引く", 1, "%を引く", 0],
    ["talk", "話しかける", 1, "%に話しかける", 0], ["ask", "尋ねる", 2, "%に#について尋ねる", 0], ["give", "渡す", 2, "%を#に渡す", 0],
    ["pray", "手を合わせる", 0, "手を合わせる", 0], ["sit", "座る", 0, "座る", 0],
  ].map(v => ({ id: v[0], label: v[1], args: v[2], fmt: v[3], quick: !!v[4] }));

  const SYN = [
    [/^(見回す|まわりを見る|周りを見る|辺りを見る|あたりを見る|見る|みる|ルック)$/, "look"],
    [/^(持ち物|持ち物を見る|持ち物を確認|所持品|インベントリ|i)$/, "inv"],
    [/^(手がかり|てがかり|手掛かり|メモ|手がかりを見返す|手帳)$/, "notes"],
    [/^(待つ|まつ|待機|様子を見る)$/, "wait"],
    [/^(眠る|ねむる|寝る|ねる|横になる)$/, "sleep"],
    [/^(耳をすます|耳を澄ます|聞く|きく|音を聞く|耳をすませる)$/, "listen"],
    [/^(においを嗅ぐ|匂いを嗅ぐ|嗅ぐ|かぐ|におう)$/, "smell"],
    [/^(目を閉じる|目をつぶる|目をとじる|目を瞑る|目を閉じて待つ)$/, "eyes"],
    [/^(数える|かぞえる|数を数える|数をかぞえる)$/, "count"],
    [/^(手を合わせる|祈る|いのる|合掌|合掌する)$/, "pray"],
    [/^(座る|すわる|腰を下ろす|腰かける)$/, "sit"],
    [/^(ヒント|ひんと|hint|助けて|どうすれば)$/, "hint"],
    [/^(ひとつ戻す|戻す|やり直す|アンドゥ|undo)$/, "undo"],
  ];
  const VERB_RE = [
    ["examine", /(を|の)?(よく)?(調べる|しらべる|見る|みる|観察する|確かめる|のぞく|覗く)$/],
    ["take", /(を)?(取る|とる|拾う|ひろう|持つ|持っていく|持っていく|手に取る|もらう|いただく)$/],
    ["drop", /(を)?(置く|おく|捨てる|すてる|手放す)$/],
    ["open", /(を)?(開ける|あける|開く|ひらく|開錠する)$/],
    ["close", /(を)?(閉める|しめる|閉じる|とじる)$/],
    ["read", /(を)?(読む|よむ|読み上げる|音読する)$/],
    ["use", /(を)?(使う|つかう|つける|点ける|灯す|ともす|消す|着る|飲む|食べる)$/],
    ["push", /(を)?(押す|おす)$/],
    ["pull", /(を)?(引く|ひく|引っ張る)$/],
    ["talk", /(に|と)?(話しかける|話す|はなす|声をかける)$/],
  ];

  function create(ui) {
    let S = null;
    const history = [];
    const g = { ui, DEFS, S: null, onChange: null };

    // ---- 状態 ----
    function newState() {
      const s = {
        room: DEFS.start, loc: {}, f: {}, day: 1, phase: DEFS.plan[1][0][0], t: 0, nt: 0,
        dread: 0, turns: 0, notes: [], topics: [], visited: {}, prompt: null, eyes: false, over: null,
      };
      for (const id in DEFS.items) s.loc[id] = DEFS.items[id].loc || null;
      return s;
    }
    function setState(s) { S = s; g.S = s; }

    // ---- 出力 ----
    function say(text, cls) {
      for (const part of String(text).split("\n")) {
        if (part === "") ui.gap(); else ui.say(part, cls || "");
      }
    }
    g.say = say;
    g.gap = () => ui.gap();
    g.vibrate = p => ui.vibrate && ui.vibrate(p);
    const txt = v => (typeof v === "function" ? v(g) : v);

    // ---- 物 ----
    const IT = id => DEFS.items[id];
    g.item = IT;
    g.at = id => S.loc[id];
    g.has = id => S.loc[id] === "held";
    g.here = id => S.loc[id] === S.room;
    g.move = (id, to) => { S.loc[id] = to; };
    g.flag = k => S.f[k];
    g.set = (k, v) => { S.f[k] = v === undefined ? true : v; };
    g.reveal = id => { S.f["found." + id] = true; };
    g.on = id => !!S.f[id + ".on"];
    g.isOpen = id => !!S.f[id + ".open"];
    g.night = () => S.phase === "夜";
    g.nameOf = id => (IT(id) ? txt(IT(id).name) : id);

    function hidden(it) {
      if (typeof it.hidden === "function") return !!it.hidden(g);
      return !!it.hidden && !S.f["found." + it.id];
    }
    function litNow() {
      const r = DEFS.rooms[S.room];
      if (!isDark(r)) return true;
      for (const id in S.loc) if (S.loc[id] === "held" && IT(id).light && S.f[id + ".on"]) return true;
      return false;
    }
    function isDark(r) {
      if (typeof r.dark === "function") return !!r.dark(g);
      if (r.dark) return true;
      return S.phase === "夜" && r.indoor !== false && !r.moon;
    }
    g.lit = litNow;
    // 手元・部屋・開いている入れ物の中にある物
    function scope() {
      const out = [];
      const add = (id, depth) => {
        const it = IT(id);
        if (!it || hidden(it)) return;
        out.push(it);
        if (depth < 3 && (it.container || it.surface) && (it.surface || S.f[id + ".open"] || it.transparent)) {
          for (const k in S.loc) if (S.loc[k] === "in:" + id) add(k, depth + 1);
        }
      };
      for (const id in S.loc) if (S.loc[id] === "held") add(id, 0);
      if (litNow()) {
        for (const id in S.loc) if (S.loc[id] === S.room || S.loc[id] === "*") add(id, 0);
      } else {
        for (const id in S.loc) if (S.loc[id] === "*") add(id, 0);
      }
      return out;
    }
    g.scope = scope;
    const inScope = id => scope().some(it => it.id === id);
    g.near = inScope;

    // ---- 手がかり ----
    g.clue = (k, text) => {
      if (S.notes.some(n => n.k === k)) return false;
      S.notes.push({ k, text });
      say("【手がかり】" + text, "sub");
      return true;
    };
    g.learn = (id) => { if (!S.topics.includes(id)) S.topics.push(id); };

    // ---- 不安（ざわめき） ----
    g.dread = (n, why) => {
      const before = S.dread;
      S.dread = Math.max(0, Math.min(12, S.dread + n));
      if (n > 0) {
        ui.vibrate && ui.vibrate(n >= 3 ? [120, 60, 120] : 60);
        if (before < 4 && S.dread >= 4) say("耳の奥で、水の音がしている。気のせいだと思おうとする。", "warn");
        else if (before < 7 && S.dread >= 7) say("まっすぐ立っているのが、むずかしい。床がわずかに傾いているような気がする。", "warn");
        else if (before < 10 && S.dread >= 10) say("息が浅くなる。視界の端に、人の形がいくつも立っている。", "warn");
      }
      if (S.dread >= 12 && !S.over && DEFS.faint) DEFS.faint(g);
    };

    // ---- 結末 ----
    g.end = id => {
      const e = DEFS.endings[id];
      S.over = id;
      ui.sep();
      say(txt(e.title), "title");
      for (const p of e.text) say(typeof p === "function" ? p(g) : p, e.cls || "");
      ui.gap();
      say("── 結末「" + txt(e.title) + "」 ──", "sub");
      if (ui.ended) ui.ended(id, txt(e.title), !!e.good);
      ui.status(e.title ? "結末：" + txt(e.title) : "", "");
      changed();
    };

    // ---- 時間 ----
    function planIndex() {
      const p = DEFS.plan[S.day];
      return p.findIndex(x => x[0] === S.phase);
    }
    g.tick = (n) => {
      n = n === undefined ? 1 : n;
      for (let i = 0; i < n && !S.over; i++) tick1();
    };
    function tick1() {
      S.turns++;
      if (S.phase === "夜") {
        S.nt++;
        const night = DEFS.nights[S.day];
        if (night.events && night.events[S.nt]) night.events[S.nt](g);
        if (night.each && !S.over) night.each(g);
        if (!S.over && S.nt >= night.end) dawn();
        return;
      }
      S.t++;
      const plan = DEFS.plan[S.day];
      const idx = planIndex();
      if (S.t >= plan[idx][1]) {
        if (idx + 1 < plan.length) {
          S.phase = plan[idx + 1][0]; S.t = 0;
          const m = DEFS.phaseMsg[S.day + ":" + S.phase] || DEFS.phaseMsg[S.phase];
          if (m) say(txt(m), "sub");
          if (DEFS.onPhase) DEFS.onPhase(g);
        } else beginNight();
      }
    }
    function beginNight() {
      S.phase = "夜"; S.nt = 0; S.eyes = false;
      ui.sep();
      const night = DEFS.nights[S.day];
      if (night.begin) night.begin(g);
    }
    function dawn() {
      const night = DEFS.nights[S.day];
      if (night.dawn) night.dawn(g);
      if (S.over) return;
      S.day++;
      S.eyes = false;
      if (!DEFS.plan[S.day]) { if (DEFS.noDay) DEFS.noDay(g); return; }
      S.phase = DEFS.plan[S.day][0][0]; S.t = 0; S.nt = 0;
      ui.sep();
      say("── " + dayName() + " ──", "title");
      if (DEFS.morning) DEFS.morning(g);
      look(true);
    }
    function dayName() { return ["", "一日目", "二日目", "三日目", "四日目"][S.day] + "・" + S.phase; }
    g.dayName = dayName;

    // ---- 部屋 ----
    function status() {
      const r = DEFS.rooms[S.room];
      let left = r ? txt(r.name) : "";
      if (S.phase === "夜") left += "（夜）";
      ui.status(left, ["", "一日目", "二日目", "三日目"][S.day] + "・" + S.phase);
    }
    g.status = status;

    function roomItems() {
      const lines = [];
      for (const it of scope()) {
        if (S.loc[it.id] === "held") continue;
        if (it.scenery || it.listed === false) continue;
        const parent = /^in:/.test(S.loc[it.id]) ? S.loc[it.id].slice(3) : null;
        if (parent && !(IT(parent).surface || IT(parent).container)) continue;
        const h = it.here !== undefined ? txt(it.here) : txt(it.name) + "がある。";
        if (h) lines.push(h);
      }
      return lines;
    }
    function look(full) {
      const r = DEFS.rooms[S.room];
      status();
      S.visited[S.room] = true;
      say(txt(r.name), "title");
      if (!litNow()) {
        say(r.darkMsg ? txt(r.darkMsg) : "暗くて、何も見えない。灯りがいる。", "sub");
      } else {
        say(txt(r.desc));
        const items = roomItems();
        if (items.length) say(items.join("\n"));
      }
      if (r.on && r.on.look) r.on.look(g);
      const ex = Object.keys(r.exits).filter(d => exitVisible(r, d));
      if (ex.length) say("行ける方向：" + ex.map(d => DIR[d] + (S.visited[exitTo(r, d)] ? "（" + txt(DEFS.rooms[exitTo(r, d)].name) + "）" : "")).join("　"), "sub");
    }
    g.look = look;
    function exitDef(r, d) {
      const e = r.exits[d];
      if (!e) return null;
      return typeof e === "string" ? { to: e } : e;
    }
    function exitTo(r, d) { return exitDef(r, d).to; }
    function exitVisible(r, d) {
      const e = exitDef(r, d);
      if (!e) return false;
      if (e.show === false) return false;
      if (typeof e.show === "function") return !!e.show(g);
      return true;
    }

    function go(dir) {
      if (S.over) return;
      if (S.prompt) { say("まず、いまの問いに答えてほしい。", "sub"); return; }
      const r = DEFS.rooms[S.room];
      const e = exitDef(r, dir);
      if (!e || !exitVisible(r, dir)) { say("そちらへは行けない。", "sub"); return; }
      if (!litNow() && !DEFS.dim) { /* 暗くても歩ける */ }
      if (typeof e.if === "function") {
        const res = e.if(g);
        if (res !== true) { say(res || "行けない。", "sub"); return; }
      }
      if (r.on && r.on.leave && r.on.leave(g, dir) === false) return;
      if (DEFS.beforeMove && DEFS.beforeMove(g, dir, e) === false) return;
      push();
      S.eyes = false;
      S.room = e.to;
      if (e.msg) say(txt(e.msg));
      look(false);
      const nr = DEFS.rooms[e.to];
      if (nr.on && nr.on.enter) nr.on.enter(g);
      g.tick(e.cost || 1);
      if (!S.over) { if (DEFS.afterMove) DEFS.afterMove(g); }
      changed();
    }
    g.go = go;

    // ---- 手の入れかた ----
    function find(id) { return scope().find(it => it.id === id) || IT(id); }

    function defaultMsg(v, it) {
      const n = txt(it.name);
      switch (v) {
        case "examine": return it.desc ? txt(it.desc) : "特に変わったところはない。";
        case "take": return it.takeMsg ? txt(it.takeMsg) : "持っていけそうにない。";
        case "open": return "開けられそうにない。";
        case "close": return "閉められそうにない。";
        case "read": return "読めるものではない。";
        case "use": return "どう使えばいいのか、わからない。";
        case "push": return "押しても、何も起きない。";
        case "pull": return "引いても、何も起きない。";
        case "talk": return it.npc ? "返事はない。" : "返事があるはずもない。";
        default: return n + "には、手の出しようがない。";
      }
    }

    function listContents(it) {
      const kids = [];
      for (const k in S.loc) if (S.loc[k] === "in:" + it.id && !hidden(IT(k))) kids.push(IT(k));
      return kids;
    }

    function actItem(v, a, b) {
      const it = find(a);
      if (!it) return;
      const hook = it.on && it.on[v];
      if (v === "examine") {
        S.f["seen." + a] = true;
        let handled = false;
        if (hook) handled = hook(g, b) === true;
        if (!handled) {
          say(defaultMsg("examine", it));
          if ((it.container || it.surface) && (it.surface || g.isOpen(a) || it.transparent)) {
            const kids = listContents(it);
            if (kids.length) say((it.surface ? "上に" : "中に") + kids.map(k => txt(k.name)).join("、") + "がある。");
          }
        }
        if (it.after && it.after.examine) it.after.examine(g);
        return;
      }
      if (v === "take") {
        if (S.loc[a] === "held") { say("もう持っている。"); return; }
        if (hook) { const r = hook(g); if (r === true) return; if (r === false) return; }
        if (!it.take) { say(defaultMsg("take", it)); return; }
        S.loc[a] = "held";
        say("「" + txt(it.name) + "」を取った。", "take");
        if (it.onTaken) it.onTaken(g);
        return;
      }
      if (v === "drop") {
        if (S.loc[a] !== "held") { say("持っていない。"); return; }
        if (hook && hook(g) === true) return;
        S.loc[a] = S.room;
        if (it.light) S.f[a + ".on"] = S.f[a + ".on"];
        say("「" + txt(it.name) + "」を置いた。");
        return;
      }
      if (v === "open" || v === "close") {
        if (hook && hook(g) === true) return;
        if (!it.openable) { say(defaultMsg(v, it)); return; }
        const key = a + ".open";
        if (v === "open") {
          if (S.f[key]) { say("もう開いている。"); return; }
          if (it.locked && txt(it.locked) && !S.f[a + ".unlocked"]) { say(txt(it.lockedMsg) || "鍵がかかっている。"); return; }
          S.f[key] = true;
          say(it.openMsg ? txt(it.openMsg) : txt(it.name) + "を開けた。");
          const kids = listContents(it);
          if (kids.length) say("中に" + kids.map(k => txt(k.name)).join("、") + "がある。");
          if (it.onOpen) it.onOpen(g);
        } else {
          if (!S.f[key]) { say("もう閉まっている。"); return; }
          S.f[key] = false;
          say(it.closeMsg ? txt(it.closeMsg) : txt(it.name) + "を閉めた。");
          if (it.onClose) it.onClose(g);
        }
        return;
      }
      if (v === "read") {
        if (hook && hook(g) === true) return;
        if (it.text) { say(txt(it.text), "doc"); return; }
        say(defaultMsg("read", it));
        return;
      }
      if (hook && hook(g, b) === true) return;
      say(defaultMsg(v, it));
    }

    function actPair(v, a, b) {
      const ia = find(a);
      if (!ia) return;
      if (v === "ask") {
        const h = ia.on && ia.on.ask;
        if (h && h(g, b) === true) return;
        say(ia.npc ? txt(ia.name) + "は、首を振った。「さあ、なあ」" : "返事はない。");
        return;
      }
      const ib = find(b);
      if (!ib) return;
      if (v === "use2") {
        const h1 = ia.on && ia.on.use2, h2 = ib.on && ib.on.usedWith;
        if (h1 && h1(g, b) === true) return;
        if (h2 && h2(g, a) === true) return;
        say("「" + txt(ia.name) + "」を「" + txt(ib.name) + "」に使っても、何も起きなかった。");
        return;
      }
      if (v === "give") {
        const h = ib.on && ib.on.give;
        if (h && h(g, a) === true) return;
        say(ib.npc ? txt(ib.name) + "は、受け取ろうとしない。" : "渡しようがない。");
        return;
      }
    }

    // ---- 動詞の受け口 ----
    const FREE = new Set(["examine", "look", "inv", "notes", "hint", "undo", "take", "drop", "open", "close", "push", "pull", "read"]);
    function act(v, a, b) {
      if (S.over) {
        if (v === "undo") return undo();
        say("終わった物語は動かない。「ひとつ戻す」か、メニューの「はじめから遊ぶ」から。", "sub");
        return;
      }
      if (S.prompt) { say("まず、いまの問いに答えてほしい。", "sub"); return; }
      if (v === "undo") return undo();
      if (v === "hint") return hint();
      const mutate = !["look", "inv", "notes", "examine"].includes(v);
      if (mutate) push();
      S.eyes = v === "eyes" ? true : (v === "wait" && S.eyes);
      const r = DEFS.rooms[S.room];
      switch (v) {
        case "look": look(true); break;
        case "inv": inventory(); break;
        case "notes": notes(); break;
        case "wait": {
          if (!(r.on && r.on.wait && r.on.wait(g) === true)) say(S.eyes ? "目を閉じたまま、じっとしている。" : "じっと待った。", "sub");
          g.tick(1);
          break;
        }
        case "sleep": sleep(); break;
        case "listen": doRoom("listen", "耳をすます。静かだ。", 1); break;
        case "smell": doRoom("smell", "特に変わったにおいはしない。", 0); break;
        case "eyes": say("目を閉じた。まぶたの裏の暗さのなかで、音だけが近くなる。", "sub"); g.tick(1); break;
        case "count": doRoom("count", "ひとつ、ふたつ、と数えてみた。数えるものが、ここにはない。", 0); break;
        case "pray": doRoom("pray", "手を合わせた。何も返ってはこない。", 0); break;
        case "sit": doRoom("sit", "ここには、座る場所がない。", 0); break;
        default:
          if (VERBS.find(x => x.id === v && x.args === 2)) actPair(v, a, b);
          else actItem(v, a, b);
      }
      if (!S.over && DEFS.afterAct) DEFS.afterAct(g, v, a, b);
      changed();
    }
    g.act = act;

    function doRoom(v, fallback, cost) {
      const r = DEFS.rooms[S.room];
      const h = r.on && r.on[v];
      let handled = false;
      if (h) handled = h(g) === true;
      if (!handled && DEFS.global && DEFS.global[v]) handled = DEFS.global[v](g) === true;
      if (!handled) say(fallback, "sub");
      if (cost) g.tick(cost);
    }

    function sleep() {
      if (!DEFS.canSleep(g)) { return; }
      if (S.phase === "夜") {
        say("布団をかぶって、目を閉じる。", "sub");
        g.tick(3);
        return;
      }
      if (DEFS.sleepDay) DEFS.sleepDay(g);
    }

    function inventory() {
      const held = Object.keys(S.loc).filter(id => S.loc[id] === "held").map(id => IT(id));
      if (!held.length) { say("何も持っていない。", "sub"); return; }
      say("持ち物：", "sub");
      for (const it of held) {
        let s = "　" + txt(it.name);
        if (it.light) s += S.f[it.id + ".on"] ? "（ついている）" : "（消えている）";
        say(s);
      }
    }
    function notes() {
      if (!S.notes.length) { say("手がかりは、まだない。", "sub"); return; }
      say("手がかり：", "sub");
      S.notes.forEach((n, i) => say((i + 1) + ". " + n.text));
    }
    function hint() {
      for (const fn of DEFS.hints) {
        const t = fn(g);
        if (t) { say("（" + t + "）", "sub"); return; }
      }
      say("（いまは、思いつくことを試してみるといい）", "sub");
    }
    g.hint = () => { hint(); };

    // ---- 問い（はい／いいえなど） ----
    g.ask = (id) => {
      S.prompt = id;
      const p = DEFS.prompts[id];
      say(txt(p.q), "warn");
    };
    g.choices = () => {
      if (!S.prompt) return [];
      return DEFS.prompts[S.prompt].options.map((o, i) => ({ id: i, label: o.label }));
    };
    g.choose = i => {
      if (!S.prompt) return;
      const p = DEFS.prompts[S.prompt];
      const o = p.options[i];
      if (!o) return;
      push();
      S.prompt = null;
      ui.say("▶ " + o.label, "sub");
      o.run(g);
      changed();
    };

    // ---- 元に戻す ----
    function push() {
      history.push(JSON.stringify(S));
      if (history.length > 40) history.shift();
    }
    function undo() {
      if (!history.length) { say("これ以上は戻せない。", "sub"); return; }
      setState(JSON.parse(history.pop()));
      ui.sep();
      say("（ひとつ前に戻した）", "sub");
      look(true);
      changed();
    }
    g.undo = undo;

    function changed() {
      status();
      if (g.onChange) g.onChange();
    }

    // ---- 外とのやりとり ----
    g.verbs = () => VERBS.filter(v => !v.hide);
    g.exits = () => {
      const r = DEFS.rooms[S.room];
      return Object.keys(r.exits).filter(d => exitVisible(r, d)).map(d => {
        const to = exitTo(r, d);
        return { dir: d, label: DIR[d] + (S.visited[to] ? "：" + txt(DEFS.rooms[to].name) : "") };
      });
    };
    g.things = (verb, firstId) => {
      let list = scope();
      if (verb === "ask" && firstId) {
        const topics = S.topics.map(id => ({ id: "t:" + id, label: txt(DEFS.topics[id].name), held: false }));
        const here = list.filter(it => !it.npc).map(it => ({ id: it.id, label: txt(it.name), held: S.loc[it.id] === "held" }));
        return topics.concat(here);
      }
      if (verb === "ask") list = list.filter(it => it.npc);
      else if (verb === "talk") list = list.filter(it => it.npc);
      else if (verb === "take") list = list.filter(it => S.loc[it.id] !== "held" && (it.take || (it.on && it.on.take)));
      else if (verb === "drop") list = list.filter(it => S.loc[it.id] === "held");
      else if (verb === "open") list = list.filter(it => it.openable && !S.f[it.id + ".open"] || (it.on && it.on.open));
      else if (verb === "close") list = list.filter(it => (it.openable && S.f[it.id + ".open"]) || (it.on && it.on.close));
      else if (verb === "read") list = list.filter(it => it.text || (it.on && it.on.read));
      else if (verb === "use") list = list.filter(it => it.on && it.on.use);
      else if (verb === "push") list = list.filter(it => !it.npc);
      else if (verb === "pull") list = list.filter(it => !it.npc);
      else if (verb === "give") {
        if (firstId) list = list.filter(it => it.npc);
        else list = list.filter(it => S.loc[it.id] === "held");
      } else if (verb === "use2") {
        if (!firstId) list = list.filter(it => S.loc[it.id] === "held" || (it.on && (it.on.use2)));
      }
      return list.map(it => ({ id: it.id, label: txt(it.name), held: S.loc[it.id] === "held" }));
    };

    // ---- 文字で入力された日本語 ----
    g.text = str => {
      if (S.over) { act("look"); return; }
      if (S.prompt) {
        const p = DEFS.prompts[S.prompt];
        const i = p.options.findIndex(o => (o.words || []).some(w => str.includes(w)) || str.includes(o.label));
        if (i >= 0) g.choose(i); else say("答えを選んでください。", "sub");
        return;
      }
      const s = str.replace(/[\s　。、！？!?]+/g, "");
      if (!s) return;
      for (const [re, v] of SYN) if (re.test(s)) { act(v); return; }
      const m = s.match(/^(北|南|東|西|上|下)(に|へ|の方へ|の方に)?(行く|いく|進む|すすむ|向かう|歩く|上がる|降りる|登る|のぼる)?$/);
      if (m) { go(DIR_WORDS[m[1]]); return; }
      if (/^(2階|二階)(へ|に)?(上がる|行く)?$/.test(s)) { go("u"); return; }
      // 物の名前を探す
      const sc = scope();
      const topics = S.topics.map(id => DEFS.topics[id]);
      const found = [];
      for (const it of sc) {
        for (const w of it.words.concat([txt(it.name)])) {
          const i = w ? s.indexOf(w) : -1;
          if (i >= 0) { found.push({ id: it.id, at: i, len: w.length, after: s.slice(i + w.length, i + w.length + 1) }); break; }
        }
      }
      found.sort((x, y) => x.at - y.at);
      // 同じ範囲に重なった候補は、長い名前のほうを使う
      const uniq = [];
      for (const f of found) {
        const dup = uniq.find(u => Math.abs(u.at - f.at) < Math.max(u.len, f.len) && u.at + u.len > f.at);
        if (dup) { if (f.len > dup.len) uniq[uniq.indexOf(dup)] = f; } else uniq.push(f);
      }
      const asked = s.match(/(.+?)(に|へ)(.+?)(について|のこと|を)?(尋ねる|聞く|たずねる|訊く)$/);
      if (asked && uniq.length) {
        const npc = uniq.find(f => IT(f.id).npc);
        const tp = topics.find(t => (t.words || []).concat([txt(t.name)]).some(w => s.includes(w)));
        const other = uniq.find(f => !IT(f.id).npc);
        if (npc && (tp || other)) { act("ask", npc.id, tp ? "t:" + tp.id : other.id); return; }
      }
      if (/(渡す|わたす|あげる|差し出す)$/.test(s) && uniq.length >= 2) {
        const a = uniq.find(f => f.after === "を") || uniq[0];
        const b = uniq.find(f => f !== a);
        act("give", a.id, b.id); return;
      }
      if (/(を|で|に)使う$|につかう$/.test(s) && uniq.length >= 2) {
        const a = uniq.find(f => f.after === "を") || uniq[0];
        const b = uniq.find(f => f !== a);
        act("use2", a.id, b.id); return;
      }
      for (const [v, re] of VERB_RE) {
        if (re.test(s)) {
          if (!uniq.length) { say("何について言っているのか、わからなかった。いま見えているものの名前を、入れてください。", "sub"); return; }
          const target = (v === "talk" ? uniq.find(f => IT(f.id).npc) : null)
            || uniq.find(f => f.after === "を" || f.after === "に" || f.after === "と") || uniq[uniq.length - 1];
          act(v, target.id); return;
        }
      }
      say("その言い方は、うまく読み取れなかった。下のボタンから選ぶこともできる。", "sub");
    };

    // ---- 始まりと続き ----
    g.start = () => {
      setState(newState());
      for (const fn of DEFS.init) fn(g);
      if (DEFS.intro) DEFS.intro(g);
      look(true);
      changed();
    };
    g.state = () => S;
    // 保存用：いまの状態と、「ひとつ戻す」の履歴
    g.export = () => ({ v: 2, S, h: history.slice(-12) });
    g.import = o => {
      if (o && o.v === 2 && o.S) {
        history.length = 0;
        for (const x of (o.h || [])) history.push(x);
        return g.load(o.S);
      }
      return g.load(o);
    };
    g.load = o => {
      if (!o || typeof o !== "object" || !o.loc || !DEFS.rooms[o.room]) return false;
      const base = newState();
      for (const id in base.loc) if (!(id in o.loc)) o.loc[id] = base.loc[id];
      setState(o);
      status();
      return true;
    };
    g.inScope = inScope;
    return g;
  }

  return { define, create, current: null, DEFS };
})();
if (typeof module !== "undefined") module.exports = { Kura };
