// 「蔵守」のゲーム本体と世界。backrooms-pwa/games/kura/*.js をそのまま束ね、kuramori.html の配色・場所の表と、時計用の口を足したもの。
// tools/build-kuramori.js で作る。直接は直さない。
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
      if (DEFS.chapter && DEFS.chapter[S.day]) say(DEFS.chapter[S.day], "sub");
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

// night.js — 『蔵守』の、人との会話・夜の務め・三晩の出来事・結末・ヒント。
"use strict";

Kura.define(w => {
  const D = Kura.DEFS;
  const item = (id, name, words, d) => w.item(id, Object.assign({ name, words }, d));

  const HOUSE = ["genkan", "doma", "chanoma", "butsuma", "zashiki", "engawa", "rouka", "nando", "furo", "niaikai", "obaba", "kodomo", "yaneura", "yukashita"];
  const GROUNDS = HOUSE.concat(["gate", "maeniwa", "uraniwa", "ido", "nagaya", "kuramae", "kura1", "kura2", "kura_b"]);
  const WINDOW = { 1: [6, 14], 2: [6, 14] };
  const inWindow = g => g.night() && WINDOW[g.S.day] && g.S.nt >= WINDOW[g.S.day][0] && g.S.nt <= WINDOW[g.S.day][1];

  w.plan({
    1: [["午後", 18], ["夕", 8]],
    2: [["朝", 12], ["昼", 14], ["夕", 10]],
    3: [["朝", 10], ["昼", 12], ["夕", 10]],
  });
  w.phaseMsg({
    "夕": "日が、山の端にかかった。座敷の隅から、暗さが、にじんでくる。まもなく、夜になる。夜は、家の外にいてはいけない。",
    "昼": "日が高くなった。それでも、家の中は、ひんやりしている。",
  });

  w.onInit(g => {
    g.S.f.matches = 5;
    g.learn("kura"); g.learn("mizu");
    g.S.loc.tome = "gate";
    g.S.loc.onigiri = null;
  });

  item("kuranokagi", "蔵の鍵", ["鍵", "蔵の鍵", "古い鍵"], {
    take: true,
    desc: "黒ずんだ、大きな鉄の鍵。持ち手に、赤い糸が結んである。ずしりと重い。",
  });

  // ------------------------------------------------------------------
  // 導入
  // ------------------------------------------------------------------
  D.intro = g => {
    g.say("第一章　水の家", "sub");
    g.say("柏木 ハツ、七十四歳。あなたの祖母は、十二日前に、亡くなった。", "title");
    g.say("葬儀は、町の親戚が済ませてくれた。あなたは、仕事の都合で出られなかった。\n四十九日の法要には、みなが、この家に集まる。それまでに、家を、片づけておくことになった。\n三晩、ひとりで、泊まる。そう決めて、バスに乗った。");
    g.say("山あいのバス停で降りたとき、運転手が、窓越しに、なにか言いかけて、やめた。\n坂を、上がる。\n古い家の門が、見えてくる。");
    g.say("（画面の下のボタンから、「調べる」「取る」などを選びます。【手がかり】は手帳に残り、「手がかり」でいつでも見返せます。\n　困ったときは、メニュー（⋮）の「ヒントを見る」を。やり直したいときは「ひとつ戻す」。）", "sub");
    g.gap();
  };

  D.canSleep = g => {
    if (!HOUSE.includes(g.S.room)) { g.say("ここでは、眠れない。家のなかへ戻ろう。", "sub"); return false; }
    return true;
  };
  D.sleepDay = g => {
    const S = g.S;
    if (S.phase === "夕") {
      g.say("座敷の布団に、横になった。目を閉じる。……つぎに目を開けたとき、闇が、部屋の隅まで満ちていた。", "sub");
      let guard = 0;
      while (S.phase !== "夜" && guard++ < 40) g.tick(1);
      return;
    }
    g.say("眠るには、まだ早い。日のあるうちに、できることがありそうだ。", "sub");
  };
  D.global = {
    count: g => {
      if (g.S.phase === "夜") { g.say("ひとつ、ふたつ、と数えはじめて、やめた。数えるものが、この場所には、ない。", "sub"); g.dread(1); return true; }
      return false;
    },
  };

  D.beforeMove = (g, dir) => {
    const S = g.S;
    if (g.night()) {
      if (S.room === "gate" && dir === "s") {
        g.say("門の外へ出ようとした。\n足が、一歩も、前に出なかった。坂の下から、水のにおいが、濃く、のぼってくる。", "warn");
        g.dread(1);
        return false;
      }
      if (S.day === 3 && g.flag("crowd") && !g.flag("mirrorPlaced") && ["kura_b", "suido1", "suido2"].includes(S.room) && S.nt > (g.flag("calmUntil") || 0)) {
        g.say("闇のなかから、濡れた手が、いくつも伸びてきて、あなたの足首を、つかんだ。\n進めない。……名前を、呼ばなくては。『名簿の写し』を、声に出して読もう。", "warn");
        g.dread(2);
        g.tick(1);
        return false;
      }
    }
    return true;
  };

  D.faint = g => {
    const S = g.S;
    if (S.day === 3 && g.night() && g.flag("crowd") && !g.flag("mirrorPlaced")) { g.end("called"); return; }
    S.dread = 5;
    g.say("視界が、水のなかのように、ゆらいだ。誰かが、耳もとで、名前を、数えはじめている。\nあなたの名前が、二十二番目にあたるところで、意識が、途切れた。", "warn");
    S.room = "zashiki";
    S.eyes = false;
    g.tick(3);
    if (!S.over) { g.say("……気づくと、奥座敷の畳の上に、座りこんでいた。", "sub"); g.look(true); }
  };

  // ------------------------------------------------------------------
  // 人との会話：トメ
  // ------------------------------------------------------------------
  Kura.tomeTalk = g => {
    const S = g.S;
    if (!g.flag("tomeMet")) {
      g.set("tomeMet");
      g.say("「あんた、ハツさんの孫か」\n小柄な老婆が、門柱の陰から、あなたを見上げている。\n「トメという。坂の下に、住んどる。……ハツさんが死んで、十二日だ。あんたが来てくれて、ようござんした」", "doc");
      g.say("老婆は、そこで、すこし黙った。それから、早口で言った。", "doc");
      g.say("「ひとつだけ、言うとく。夜は、外へ出んさんな。水の音がしても、戸を開けるな。呼ばれても、返事をするな」\n「あの家の蔵には、手を出さんこと。ええね」\n「……これ、食べんさい」", "doc");
      g.move("onigiri", "held");
      g.say("紙に包んだ、大きなおにぎりを、押しつけられた。（「おにぎり」を手に入れた）", "take");
      g.clue("tome", "隣家のトメ：「夜は外へ出るな。水の音がしても戸を開けるな。呼ばれても返事をするな」。蔵には手を出すなと言われた。");
      g.say("トメは、あなたの返事を待たず、坂を、ゆっくり下りていった。", "sub");
      g.move("tome", "tome_house");
      return;
    }
    if (S.day === 3 && g.here("tome") && !g.flag("keyGiven")) {
      g.set("keyGiven");
      g.move("kuranokagi", "held");
      g.move("tome", "tome_house");
      if (g.flag("duty1") || g.flag("duty2")) {
        g.say("「……務めを、果たしたようだね。ハツさんも、喜んどる」\nトメは、ふところから、古い鍵を取り出した。\n「これを。……蔵の鍵だ。ハツさんから、預かっとった」", "doc");
      } else {
        g.say("「……務めは、果たせなかったようだな。ようも、まだ、ここにおったもんだ」\nトメは、しばらく、あなたの顔を見ていた。\n「これは、あんたが持っとき。……ハツさんから、預かっとった。蔵の鍵だ」", "doc");
      }
      g.say("（「蔵の鍵」を手に入れた）", "take");
      if (!g.flag("drawdown")) {
        g.say("「底の社は、水が引けば、見える。昔、日照りの年に、見えたことがある。ダムの管理棟に、水を抜く手順が、あるらしい。……わたしゃ、機械はようわからんがね」", "doc");
      }
      g.clue("key", "トメから蔵の鍵を受け取った。");
      g.say("トメは、あなたが何か言うよりさきに、背を向けて、坂を下りていった。", "sub");
      return;
    }
    const day = S.day;
    if (day === 1) {
      g.say("「夜になる前に、家に戻りんさい。戸締まりは、しなくてええ。……どうせ、役に立たん」", "doc");
    } else if (day === 2) {
      if (!g.flag("diary1Read")) g.say("「ハツさんの日記が、台所のどこかにあるはずだよ。まず、あれを読みんさい」", "doc");
      else if (!g.flag("juushokuTrust")) g.say("「寺の住職さんに、会いんさい。わたしでは、話せんことを、知っとる」", "doc");
      else if (!g.flag("mioHelped")) g.say("「夕方に、分校へ行ってみんさい。……子どもらが、むかしから、そう言うとる。夕方の校舎には、灯りがつくってな」", "doc");
      else g.say("「できることは、もう、やっとるようだね。あとは、夜を、迎えるだけだ」", "doc");
    } else {
      g.say("「あんた、蔵守になる気かね。……いや。聞かんでおこう」", "doc");
    }
    g.tick(1);
  };

  Kura.tomeAsk = (g, topic) => {
    const t = String(topic).replace(/^t:/, "");
    const S = g.S;
    switch (t) {
      case "kura":
        g.say("「あの蔵は、柏木だけの蔵じゃなかった。村じゅうの、蔵だった。それを、ハツさんひとりが、守っとった」", "doc"); break;
      case "mizu":
        g.say("「水の音は、呼んどる音だ。呼ばれても、返事をするな。名前を取られる」", "doc"); break;
      case "tsutome":
        g.say("「子の刻にな、蔵の前で、鈴を三度。桶の水を、溝へ。そして、数える。それだけだ。……それだけが、ハツさんは、六十年、できた」", "doc"); break;
      case "kagi":
        if (g.flag("keyGiven")) { g.say("「もう、渡したろう」", "doc"); break; }
        g.set("tomeKeyPromised");
        g.say("「鍵は、わたしが預かっとる。……簡単には、渡せん。ハツさんが、あんたには継がせたくない、言うとった」\n「務めを、一晩でも、果たしてみなされ。それで、あんたの覚悟が、わかる。朝になったら、持っていく」", "doc"); break;
      case "hatsu":
        g.say("「ハツさんはなあ、九つの時から、ずっと、あの蔵のそばにおった。親も、きょうだいも、先に逝った。それでも、ひとりで、守っとった。最後まで、あんたの話ばかり、しとったよ」", "doc"); break;
      case "mio":
        g.say("「……みおちゃんか。ハツさんの、一番の友だちだよ。あの晩の……いや。分校のほうへ、行ってみんさい。夕方なら、会えるかもしれん」", "doc");
        g.learn("mio"); break;
      case "dam":
        g.say("「あのダムの下に、昔の集落があった。底、と呼んどった。社も、そこにあった」", "doc"); break;
      case "suikyo":
        g.say("「水鏡か。……あれは、底の社の、ご神体だ。蔵にあるのは、間違いだ。返さにゃならん。けど、誰も、よう返さんかった」", "doc"); break;
      case "sokonoyashiro":
        g.say("「底の社は、いまは、湖の下だ。水が引けば、見える。……ダムの管理棟に、手順書があると、聞いた」", "doc"); break;
      case "keeper":
        if (g.flag("diary3Read")) {
          g.say("「……蔵守のこと、知ったんか。ハツさんは、あんたに、継がせたくなかった。けどな」\nトメは、手のひらをこすり合わせた。\n「もし、あんたが嫌なら、わたしが入る。わたしゃ、八十五だ。いつ死んでもええ」", "doc");
          g.set("tomeOffered");
        } else g.say("「蔵守は、蔵のそばで、数えつづける者のことだ。……詳しゅうは、日記に、書いてあるだろう」", "doc");
        break;
      case "meibo":
        g.say("「二十一人の名か。……寺の過去帳に、のっとる。住職さんなら、見せてくれるかもしれん」", "doc"); break;
      case "nafuda":
        g.say("トメは、名札を見て、目を細めた。\n「……みおちゃんの。ハツさんが、持っとったんか。……返してやりんさい。夕方の、分校で」", "doc"); break;
      default:
        g.say("「……さあ、なあ」トメは、首を横に振った。", "doc");
    }
    g.tick(1);
  };

  Kura.tomeGive = (g, id) => {
    if (id === "nikki3") {
      if (!g.flag("diary3Read")) { g.say("トメは、日記を受け取らず、首を振った。「……あんたが、先に読みんさい」", "doc"); return true; }
      g.set("tomeKnowsDiary3");
      g.say("トメは、日記を、受け取った。老眼鏡をかけて、ゆっくりと、読んでいく。\n最後のページまで来て、しばらく、動かなかった。\n「……そうか。ハツさん、そんなことまで、ひとりで」\n日記を、あなたに返しながら、言った。\n「あんた、決めたら、わたしに言いんさい。わたしが蔵に入ってもええ。……そのほうが、ハツさんも、ええだろう」", "doc");
      g.set("tomeOffered");
      return true;
    }
    if (id === "nafuda") { g.say("トメは、受け取らなかった。「それは、わたしのもんじゃない。みおちゃんに」", "doc"); return true; }
    return false;
  };

  Kura.juushokuTalk = g => {
    const S = g.S;
    if (!g.flag("juushokuTrust")) {
      if (!g.flag("diary1Read")) {
        g.say("「……柏木の、お孫さんか。このたびは、お悔やみ申し上げます」\n住職は、手を合わせた。\n「あの家のことは、わたしの口から、お話しできることは、少ない。……ハツさんの、書き残したものを、ご覧になりましたか」", "doc");
        g.tick(1);
        return;
      }
      g.set("juushokuTrust");
      g.move("juzu", "held");
      g.say("「……務めのことを、ご存じか。ならば、話は早い」\n住職は、数珠を、あなたの手に、載せた。\n「持ちなさい。ひとときは、静かになる。……二十一人の名は、この過去帳にある。写してゆきなさい」\n「それと、鏡のことです。あれは、底の社へ、返すしかない。水が引かねば、無理だが。……名を、ひとりひとり、呼んであげなさい。名を呼ばれた者は、帰ります」", "doc");
      g.say("（「数珠」を手に入れた。過去帳を「読む」と、名を書き写せる）", "take");
      g.learn("meibo"); g.learn("suikyo");
      g.clue("juushoku", "住職：鏡は底の社に返すしかない。二十一人の名を、ひとりひとり呼べば、みなが帰れる。数珠をもらった。");
      g.tick(1);
      return;
    }
    if (!g.flag("drawdown")) g.say("「水が引かねば、底の社へは行けません。ダムの管理棟に、手順があるはずです」", "doc");
    else g.say("「あとは、あなた次第です。……どうか、お気をつけて」", "doc");
    g.tick(1);
  };
  Kura.juushokuAsk = (g, topic) => {
    const t = String(topic).replace(/^t:/, "");
    switch (t) {
      case "suikyo": g.say("「水鏡は、底の社の、ご神体です。水に向けて、寝かせて祀ります。蔵へ移されたのが、そもそもの、間違いだった」", "doc"); break;
      case "sokonoyashiro": g.say("「底の社は、日照りの年、一度だけ、水が引いて、見えたことがあります。その台座は、石を三つ組んだものでした」", "doc"); break;
      case "meibo": g.say("「二十一人の名は、過去帳に。写しなさい。呼べば、帰れる」", "doc"); break;
      case "keeper": g.say("「蔵守は、二十二人目として、数えられる者です。そこに座れば、水は鎮まる。ですが、座った者は、二度と、出られません」", "doc"); break;
      case "dam": g.say("「ダムの管理棟は、いま無人です。暗証番号は、竣工の年のはず。……私は、知りませんがね」", "doc"); break;
      case "mio": g.say("「みおちゃんは、分校の子でした。八つ。ハツさんが、いつも、手をつないでいた」", "doc"); break;
      default: g.say("住職は、静かに首を振った。「それは、わかりません」", "doc");
    }
    g.tick(1);
  };

  Kura.mioTalk = g => {
    if (!g.flag("mioMet")) {
      g.set("mioMet");
      g.learn("mio");
      g.say("机に座った女の子が、あなたを見て、首をかしげた。\n「……ハツちゃん？」\nすぐに、首を横に振った。\n「ちがう。ハツちゃんじゃない。……でも、ハツちゃんの、においがする」\n「わたしの名札、なくしちゃったの。ずっと、さがしてるの。……ハツちゃんが、もってると、おもうんだけど」", "doc");
      g.clue("miomet", "分校の教室に、みおがいた。名札をなくして、ずっと探している。祖母が持っているはず、と言った。");
      g.dread(1);
      return;
    }
    if (g.flag("mioHelped")) { g.say("「みんなの名前を、よんでね。さいごは、わたし」", "doc"); return; }
    g.say("「名札、見つかった？」女の子は、あなたの手もとを、じっと見ている。", "doc");
  };
  Kura.mioAsk = (g, topic) => {
    const t = String(topic).replace(/^t:/, "");
    switch (t) {
      case "nafuda": g.say("「それ、わたしの！」女の子は、身を乗り出した。（渡すなら「渡す」）", "doc"); break;
      case "ohajiki21": g.say("「それ……おはじき。ひとつだけ、たりないの。かえして」（渡すなら「渡す」）", "doc"); break;
      case "meibo": g.say("「みんなの名前を、よんで。ひとりずつ。そうしたら、みんな、かえれるの」", "doc"); break;
      case "suikyo": g.say("「かがみは、そこの下。……底に、かえさなきゃ。まっくらなところ」", "doc"); break;
      case "keeper": g.say("「にじゅうに人目は、ずっと、そこにすわってなきゃいけないの。ハツちゃんは、ずっとすわってた」", "doc"); break;
      case "hatsu": g.say("「ハツちゃんはね、手をはなさなかったの。わたしが、はなしたの。ハツちゃんは、わるくないの」", "doc"); break;
      default: g.say("女の子は、ふしぎそうに、あなたを見ている。", "doc");
    }
  };

  // ------------------------------------------------------------------
  // 夜の務め
  // ------------------------------------------------------------------
  function dutyCheck(g) {
    const S = g.S;
    if (g.flag("duty" + S.day)) return;
    if ((S.f.rings || 0) >= 3 && S.f.poured && (S.f.counts || 0) >= 3) {
      g.set("duty" + S.day);
      g.say("最後の数が、闇に消えたとき、蔵の内側の水の音が、ゆっくりと、静まっていった。\n戸の向こうで、誰かが、ほっと、息をついたような気がした。", "doc");
      g.dread(-4);
      g.clue("duty" + S.day, "夜の務めを果たした（" + ["", "一", "二", "三"][S.day] + "晩目）。水の音が静まった。");
    }
  }
  Kura.ringBell = g => {
    const S = g.S;
    if (!g.night()) { g.say("鈴を鳴らした。澄んだ音は、昼の空気に吸われて、すぐに消えた。"); return true; }
    if (S.room !== "kuramae") { g.say("鈴を鳴らした。闇のなかで、音が、あらぬ方向から返ってきた。ここではない気がする。", "sub"); g.dread(1); return true; }
    if (!inWindow(g)) { g.say("鈴を鳴らした。音が、水のなかに、落ちたように、沈んだ。いまは、その刻ではないらしい。", "sub"); g.dread(1); return true; }
    S.f.rings = (S.f.rings || 0) + 1;
    g.say("りん。\n" + ["一度目の音が、蔵の壁に、吸いこまれていった。", "二度目。戸の向こうで、水が、すこし、鳴った。", "三度目。音が、止まった。静けさのなかに、数を待つ気配が、できた。"][Math.min(S.f.rings, 3) - 1], "doc");
    g.tick(1);
    dutyCheck(g);
    return true;
  };
  Kura.pourWater = g => {
    const S = g.S;
    if (!g.has("oke")) { g.say("桶を持っていない。"); return true; }
    if (!g.flag("okeFull")) { g.say("桶が、空だ。井戸か、風呂場で、水を汲んでこよう。"); return true; }
    g.set("okeFull", false);
    if (inWindow(g) && S.room === "kuramae") {
      S.f.poured = true;
      g.say("桶を傾けた。水は、溝を伝って、蔵の戸の下へ、するすると、吸いこまれていった。\n……どこかが、水を、受け取った。", "doc");
      g.tick(1);
      dutyCheck(g);
    } else {
      g.say("桶の水を、溝に流した。水は、戸の下へ、吸いこまれていく。……意味があったのかは、わからない。", "sub");
    }
    return true;
  };
  Kura.countAtKura = g => {
    const S = g.S;
    if (!g.night()) { g.say("昼間に数えても、蔵は、答えない。", "sub"); return true; }
    if (!inWindow(g)) { g.say("ひとつ、ふたつ、と数えかけて、口をつぐんだ。いまは、数える刻ではない。", "sub"); g.dread(1); return true; }
    S.f.counts = S.f.counts || 0;
    if (S.f.counts >= 3) { g.say("二十一で、止める。それより先は、数えてはならない。", "warn"); return true; }
    S.f.counts++;
    const base = (S.f.counts - 1) * 7;
    const nums = ["ひとつ", "ふたつ", "みっつ", "よっつ", "いつつ", "むっつ", "ななつ", "やっつ", "ここのつ", "とお", "じゅういち", "じゅうに", "じゅうさん", "じゅうし", "じゅうご", "じゅうろく", "じゅうしち", "じゅうはち", "じゅうく", "にじゅう", "にじゅういち"];
    g.say("声に出して、数える。\n" + nums.slice(base, base + 7).join("、") + "。", "doc");
    if (S.f.counts === 1) g.say("蔵の壁の内側から、水音にまじって、小さな声が、いっしょに数えた。", "sub");
    if (S.f.counts === 2) g.say("声は、ふえている。十人、二十人……老いた声、幼い声。みな、数に合わせて、息をしている。", "sub");
    if (S.f.counts === 3) {
      g.say("「にじゅういち」と言い終えたとき、壁の内側から、声が、ゆっくり、揃って、言った。\n『……ひとり、たりない』", "warn");
      g.dread(2);
      g.learn("keeper");
      g.clue("tarinai", "二十一まで数えたとき、蔵の内側の声が、「ひとり、たりない」と言った。（二十二人目＝蔵守のこと？）");
    }
    g.tick(1);
    dutyCheck(g);
    return true;
  };

  Kura.phoneCall = g => {
    g.say("受話器を、耳に当てた。\n水の底のような、くぐもった音。そのなかに、声が、聞こえる。\n『ひとつ、ふたつ、みっつ……』\n数えている。たくさんの声が、揃って。『……にじゅう、にじゅういち』\nそこで、声は、ふっと、途切れた。\n『……ひとり、たりない』\nしばらくして、小さな、ひとりの女の子の声が、言った。\n『ハツちゃん？ ……ちがう。だれ？』\nぷつり、と、電話は、切れた。", "doc");
    g.dread(2);
    g.learn("mio"); g.learn("keeper");
    g.clue("phone", "夜、黒電話に出ると、数を数える声と、「ひとり、たりない」、そして女の子の声が聞こえた。");
    g.tick(1);
  };

  // ------------------------------------------------------------------
  // 来訪者（務めを果たさなかった夜に、家に入ってくるもの）
  // ------------------------------------------------------------------
  Kura.visit = (g, strong) => {
    const S = g.S;
    if (g.flag("duty" + S.day)) { g.say("遠くで、足音が、蔵のほうへ、引き返していく。……務めが、効いている。", "sub"); return; }
    const hid = S.room === "nando" && g.flag("nandoClosed") && !g.on("kaichu") && !g.on("chochin");
    if (hid) {
      g.say("戸の向こうの廊下を、濡れたものが、ゆっくり通りすぎていく。ぴちゃ、ぴちゃ、と。\n戸の前で、止まった。\n……長い時間のあと、足音は、離れていった。", "warn");
      g.dread(1);
    } else if (S.eyes) {
      g.say("目を閉じたまま、息を殺した。\n何かが、すぐそばに、立った。冷たい水が、まぶたの上に、ぽたりと落ちた。\n名前を、呼ばれた気がした。返事は、しなかった。", "warn");
      g.dread(2);
    } else {
      g.say("部屋の入口に、濡れた人影が、立っている。\n髪から、水が、とめどなく落ちている。顔は、見えない。ただ、こちらに向けて、ゆっくりと、手を、のばしてくる。\n……あなたは、その手の冷たさを、知っている。", "warn");
      g.dread(strong ? 5 : 4);
      g.vibrate([200, 80, 200, 80, 400]);
    }
  };

  // ------------------------------------------------------------------
  // 三日目の山場
  // ------------------------------------------------------------------
  Kura.lakeLow = g => !!g.flag("drawdown") && g.S.turns - (g.flag("drawTurn") || 0) >= 8;

  Kura.takeMirror = g => {
    const S = g.S;
    if (!(S.day === 3 && g.night())) {
      g.say("鏡に手をかけて、持ち上げようとした。水の底に、根を張っているように、びくともしない。\n──夜でなければ、動かない。日記には、そうあった。\n（それも、最後の夜でなければ、動かないのだろう）", "sub");
      return true;
    }
    if (!g.has("kago")) { g.say("鏡は、掌を並べたほどの大きさなのに、ひとりでは、持ち上がらないほど、重い。背負う籠が、いる。", "sub"); return true; }
    g.move("suikyo", "held");
    g.set("mirrorTaken");
    g.set("crowd");
    S.f.calmUntil = S.nt - 1;
    g.say("籠を下ろして、鏡に、そっと、手をかけた。\nさっきまで動かなかった鏡が、水面を離れるときだけ、すうっと、軽くなった。\n籠に入れて、背負う。ずしり、と、肩が沈んだ。", "take");
    g.say("その瞬間、蔵じゅうの水が、いっせいに、ざわめいた。\n水面に、無数の顔が、浮かび上がってくる。\n足場の上に、ひとり、ふたりと、濡れた人が、立ち上がる。誰も、何も言わない。ただ、あなたを、見ている。", "warn");
    g.dread(2);
    g.vibrate([100, 60, 100, 60, 300]);
    if (Kura.lakeLow(g)) g.say("東の壁の穴の向こうから、風が、吹いてくる。底の社へ続く道だ。", "sub");
    else g.say("……東の壁に、穴は、ない。水は、まだ、引いていない。これでは、鏡を運べない。", "warn");
    return true;
  };

  Kura.readNames = g => {
    const S = g.S;
    if (!g.lit()) { g.say("暗くて、手帳の字が、読めない。灯りが、いる。", "sub"); return true; }
    const NAMES = ["タケ", "ヨシゾウ", "ふみ", "源七", "サダ", "清次", "ミヨ", "勝", "ハナ", "重蔵", "イネ", "孝一", "つる", "平八", "キミ", "正吉", "トシ", "与四郎", "サチ", "辰男", "みお"];
    if (S.room === "soko" && g.flag("mirrorPlaced")) {
      g.end("return");
      return true;
    }
    if (S.day === 3 && g.night() && g.flag("crowd") && !g.flag("mirrorPlaced")) {
      S.f.calmUntil = S.nt + 8;
      g.say("手帳を開き、懐中電灯の光を当てて、声に出して、読んだ。\n『" + NAMES.slice(0, 7).join("さん、") + "さん……』\n声は、震えた。けれど、読み進めるうちに、足もとにまとわりついていた冷たい手が、ひとつ、またひとつ、ほどけていった。\n人々は、道を開けた。誰ひとり、あなたを止めない。ただ、あなたの、あとを、ついてくる。", "doc");
      g.dread(-3);
      g.tick(1);
      return true;
    }
    g.say("手帳に写した二十一の名を、目でたどった。\n" + NAMES.join("、") + "。\n声に出して読むのは、鏡を返すときだと、直感した。", "doc");
    return true;
  };

  Kura.sitKeeper = g => {
    const S = g.S;
    if (!g.flag("diary3Read")) {
      g.say("座布団に近づいた。座れば、何かが、決まってしまう。そんな予感がして、膝が、止まった。\n（ここの意味を、知ってからのほうが、いい）", "sub");
      return;
    }
    if (!(S.day === 3 && g.night())) {
      g.say("座布団の前に、立つ。……いまは、まだ、その刻ではない気がする。座れば、戻れなくなる。", "sub");
      return;
    }
    g.say("鏡のそばに、座布団がある。ハツが、六十年、座りつづけた場所。\nここに座れば、水は、鎮まるという。そのかわり、二度と、立ち上がれない。", "warn");
    g.ask("keeper");
  };

  Kura.burnTry = g => {
    if (!g.has("abura")) { g.say("灯油缶を持っていない。"); return true; }
    if (g.flag("aburaPoured")) { g.say("もう、灯油は、まいてある。あとは、火だけだ。", "sub"); return true; }
    g.set("aburaPoured");
    g.say("蓋を開けて、灯油を、蔵の戸の下の溝に、そそいだ。灯油のにおいが、水のにおいを押しのけた。\n……これから先は、取り返しが、つかない。", "warn");
    g.dread(2);
    return true;
  };
  // マッチ箱の手の入れかたを、あとから足す
  D.items.matchbox.on = {
    use: g => {
      g.say("マッチを擦りかけて、やめた。何に火をつけるのか。", "sub");
      return true;
    },
    use2: (g, id) => {
      if (id === "kura_no_to") {
        if (!g.flag("aburaPoured")) { g.say("蔵の戸に火をつけても、湿った漆喰は、燃えないだろう。", "sub"); return true; }
        if (!g.flag("matches")) { g.say("マッチは、もう、ない。"); return true; }
        g.say("マッチを持つ手が、震える。溝に流れた灯油は、いまにも、火を待っている。", "warn");
        g.ask("burn");
        return true;
      }
      if (id === "chochin") return D.items.chochin.on.use(g);
      return false;
    },
  };
  D.items.matchbox.take = true;
  D.items.matchbox.loc = "in:butsudan_hiki";
  D.items.matchbox.hidden = true;
  D.items.matchbox.desc = g => "「喫茶 水無月」と書かれた、古い箱のマッチ。残りは" + g.flag("matches") + "本ほど。";
  D.items.kaichu.on.use2 = (g, id) => false;

  // ------------------------------------------------------------------
  // 問い
  // ------------------------------------------------------------------
  w.prompt("bus", {
    q: "バスが、停まった。運転手が、扉を開けて、こちらを見ている。\nこのバスに乗れば、町へ戻れる。……乗りますか？",
    options: [
      { label: "乗る", run: g => g.end("escape") },
      { label: "見送る", run: g => g.say("首を振った。扉が閉まり、バスは、砂埃をあげて、坂を下っていった。\n運転手は、一度だけ、こちらを振り返った。", "sub") },
    ],
  });
  w.prompt("code", {
    q: "四桁の数字を、入れる。（ポスターで見た数字は？）",
    options: [
      { label: "1958", words: ["1958"], run: g => codeTry(g, 1958) },
      { label: "1959", words: ["1959"], run: g => codeTry(g, 1959) },
      { label: "1960", words: ["1960"], run: g => codeTry(g, 1960) },
      { label: "1961", words: ["1961"], run: g => codeTry(g, 1961) },
      { label: "やめる", words: ["やめる"], run: g => g.say("ボタンから、手を離した。", "sub") },
    ],
  });
  function codeTry(g, n) {
    if (n === 1960) {
      g.set("damDoorOpen");
      g.say("ピッ、という電子音。かちり、と、鍵が外れた。\n扉が、すこしだけ、内側へ、開いた。", "sub");
    } else {
      g.say("ピッ、ピッ、と短い音がして、赤いランプが点いた。違うらしい。", "sub");
    }
    g.tick(1);
  }
  w.prompt("panel", {
    q: "どれを操作しますか？",
    options: [
      { label: "主電源を入れる", words: ["電源", "主電源"], run: g => panelStep(g, 0) },
      { label: "放流警報を鳴らす", words: ["警報"], run: g => panelStep(g, 1) },
      { label: "副ゲートを開く", words: ["ゲート", "副ゲート"], run: g => panelStep(g, 2) },
      { label: "手を離す", words: ["やめる", "離す"], run: g => g.say("制御盤から、手を離した。", "sub") },
    ],
  });
  function panelStep(g, which) {
    const S = g.S;
    const want = S.f.panelStep || 0;
    if (which === want) {
      S.f.panelStep = want + 1;
      if (want === 0) { g.set("damPower"); g.say("主電源のレバーを、上げた。盤全体が、ぶうん、と低く唸って、計器に灯りがともった。", "sub"); }
      if (want === 1) g.say("警報のボタンを押す。谷じゅうに、長い、サイレンが鳴り渡った。", "sub");
      if (want === 2) {
        g.set("drawdown");
        S.f.drawTurn = S.turns;
        g.say("副ゲートのハンドルを、全身の力で、回した。\n足もとの地面が、ごうと低く鳴った。堤の向こうで、何かが、動きはじめた。\n計器の針が、ゆっくりと、下がっていく。", "doc");
        g.dread(1);
        g.clue("drawdown", "ダムの水位を下げ始めた。半日ほどで、底の社が見えてくるはずだ。");
        g.tick(1);
        return;
      }
      g.tick(1);
      g.ask("panel");
    } else {
      S.f.panelStep = 0;
      g.say("操作の順番が、ちがう。ブザーが、短く鳴って、計器の針が、もとに戻った。……手順書の順に、やり直そう。", "sub");
      g.tick(1);
      g.ask("panel");
    }
  }
  w.prompt("knock", {
    q: "戸は、まだ、叩かれている。……どうしますか？",
    options: [
      { label: "戸を開けに行く", words: ["開け"], run: g => {
        if (g.flag("mioHelped")) {
          g.say("玄関の戸を開けた。外には、誰もいなかった。\n足もとに、小さな、濡れた足跡がひとつ。それから、遠くで、笑う声。\n「……ありがとう。やくそく、まもってくれて」\n足跡は、ゆっくり、乾いていった。", "doc");
          g.dread(-3);
          g.clue("knock", "二日目の夜、玄関でみおの声がした。名札を返したので、もう怖くない。");
        } else {
          g.say("玄関の戸を、開けた。\n誰も、いなかった。足もとが、びしょ濡れだった。\n……背後で、何かが、家の中へ、入っていった。", "warn");
          g.dread(5);
          g.vibrate([200, 80, 200]);
        }
      } },
      { label: "返事をしない", words: ["しない"], run: g => {
        g.say("息を殺して、返事をしなかった。\nしばらくして、足音が、ひとつ、離れていった。", "sub");
        g.dread(1);
      } },
    ],
  });
  w.prompt("keeper", {
    q: "座布団に、座りますか？（座れば、あなたは二十二人目として、ここに残る）",
    options: [
      { label: "座る", words: ["座る"], run: g => g.end("keeper") },
      { label: "やめる", words: ["やめる"], run: g => g.say("膝を伸ばして、座布団から、離れた。まだ、座るときではない。", "sub") },
    ],
  });
  w.prompt("tome_offer", {
    q: "トメが、蔵の前に立っている。「わたしが入る」と言う。\nトメに、蔵守を、頼みますか？",
    options: [
      { label: "お願いする", words: ["お願い", "頼む"], run: g => g.end("substitute") },
      { label: "断る", words: ["断る"], run: g => { g.say("「トメさん。それは、できません」\nトメは、しばらく、あなたの顔を見ていた。それから、ふっと、笑った。\n「……ハツさんに、似とるな」\nトメは、ひとり、坂を下りていった。", "doc"); g.move("tome", "tome_house"); g.set("tomeDeclined"); } },
    ],
  });
  w.prompt("burn", {
    q: "火をつけますか？",
    options: [
      { label: "火をつける", words: ["つける"], run: g => g.end("fire") },
      { label: "やめる", words: ["やめる"], run: g => g.say("マッチを、擦らずに、箱へ戻した。", "sub") },
    ],
  });

  // ------------------------------------------------------------------
  // 三晩
  // ------------------------------------------------------------------
  function nightHome(g) {
    const S = g.S;
    if (!GROUNDS.includes(S.room)) {
      S.room = "gate";
      g.say("いつのまにか、日が落ちていた。\n気づくと、柏木の家の門の前に、立っていた。どうやって戻ったのか、おぼえていない。", "warn");
    }
  }
  function clock(g, n) {
    g.say("ぼーん、と、柱時計が、鳴った。\n一つ、二つ……十二。\n止まっているはずの時計が、確かに、十二、打った。子の刻だ。蔵の前に、立つ刻限だ。", "warn");
    g.vibrate(120);
  }

  w.night(1, {
    end: 21,
    begin: g => {
      nightHome(g);
      g.say("日が、落ちた。", "title");
      g.say("ぷつり、と、家じゅうの明かりが、消えた。ブレーカーでは、ないらしい。電気は、日が落ちると、この家から、いなくなる。\n闇は、思っていたよりも、ずっと、濃い。", "sub");
      g.dread(1);
    },
    events: {
      3: g => g.say("どこかで、ぴちゃ、と、水を踏む音がした。", "warn"),
      5: g => { g.set("footprints"); g.say("廊下のほうから、濡れた足音が、近づいたり、遠のいたりしている。玄関から、蔵のほうへ。ゆっくり。何度も。", "warn"); },
      6: g => clock(g, 1),
      15: g => Kura.visit(g, false),
      18: g => Kura.visit(g, false),
    },
    dawn: g => {
      g.set("night1done");
      g.say("やがて、窓の外が、すこしずつ、白んできた。\n水の音が、遠のいていく。", "sub");
      if (g.flag("duty1")) g.say("……務めを、果たした夜は、静かに、明けた。", "doc");
      else g.say("……体の芯が、冷えきっている。畳が、湿っている。", "doc");
    },
  });

  w.night(2, {
    end: 22,
    begin: g => {
      nightHome(g);
      g.say("二日目の、日が、落ちた。", "title");
      g.say("また、ぷつり、と、明かりが消える。昨夜より、闇が、近い。壁の向こうに、誰かが、じっと立っている、そんな気配がする。", "sub");
      g.dread(1);
      g.S.f.rings = 0; g.S.f.poured = false; g.S.f.counts = 0;
    },
    events: {
      2: g => { g.set("phoneRing"); g.say("廊下の隅で、黒電話が、鳴りはじめた。\nジリリリ、ジリリリ……", "warn"); g.vibrate([80, 80, 80, 80]); },
      7: g => { if (g.flag("phoneRing")) { g.set("phoneRing", false); g.say("電話が、ぷつりと、鳴り止んだ。", "sub"); } },
      4: g => g.say("風呂場のほうで、ざあ、と、水のあふれる音がした。廊下の板の隙間から、水が、ゆっくりと、にじみ出てくる。", "warn"),
      6: g => clock(g, 2),
      10: g => {
        g.say("とん、とん。\n玄関の戸が、叩かれた。\n「……ハツちゃん。あけて」\n小さな、女の子の声だ。濡れた声。", "warn");
        g.vibrate([60, 60, 60]);
        g.ask("knock");
      },
      15: g => Kura.visit(g, true),
      18: g => Kura.visit(g, true),
    },
    dawn: g => {
      g.set("night2done");
      g.say("夜が、白んできた。", "sub");
      if (g.flag("duty2")) g.say("……二晩目も、務めを、果たした。", "doc");
      else g.say("……水の音は、まだ、耳の奥に、残っている。", "doc");
    },
  });

  w.night(3, {
    end: 46,
    begin: g => {
      nightHome(g);
      g.say("三日目の、日が、落ちた。", "title");
      g.say("今夜の闇は、昨夜までと、ちがう。家全体が、水の底に、沈んでいるような気がする。\n壁の隙間から、柱から、天井から、水の音が、聞こえる。\nいくつもの足音が、あなたの寝る家を、まわっている。", "sub");
      g.say("今夜が、最後だ。……何かを、終わらせなくてはいけない。", "warn");
      g.S.f.rings = 0; g.S.f.poured = false; g.S.f.counts = 0;
      g.dread(1);
    },
    events: {
      2: g => {
        if (g.flag("tomeOffered") && !g.flag("tomeDeclined") && !g.flag("tomeAsked")) {
          g.set("tomeAsked");
          g.move("tome", "kuramae");
          g.say("どこからか、足音がした。\n……蔵の前に、トメが、立っている。提灯も持たず、割烹着の袖を、握りしめて。", "doc");
          g.say("（蔵の前に行って、トメに話しかけてみよう）", "sub");
        }
      },
      12: g => g.say("ぼーん、と、柱時計が、十二、打った。夜は、まだ、半分だ。", "warn"),
      30: g => g.say("夜明けまで、あと、すこしのはずだ。でも、東の空が、白む気配は、まだない。", "sub"),
      40: g => g.say("空気が、わずかに、軽くなった。夜明けが、近い。……もう、時間が、ない。", "warn"),
    },
    each: g => {
      const S = g.S;
      if (g.flag("crowd") && !g.flag("mirrorPlaced") && S.nt > (g.flag("calmUntil") || 0)) g.dread(1);
    },
    dawn: g => {
      if (!g.flag("mirrorPlaced")) g.end("loop");
    },
  });

  // tome at kuramae on night 3
  D.items.tome.npc = true;
  D.items.tome.scenery = true;
  D.items.tome.here = g => g.here("tome") ? "老婆が、そこに立っている。" : "";
  D.items.tome.desc = "八十は越えているだろう。背が低く、紺の割烹着の袖から出た手が、驚くほど節くれ立っている。目だけが、よく動く。";
  D.items.tome.loc = "gate";
  D.items.tome.on = {
    talk: g => {
      if (g.S.day === 3 && g.night() && g.here("tome") && g.flag("tomeOffered") && !g.flag("tomeDeclined")) {
        g.say("「あんた」\nトメは、まっすぐに、あなたを見た。\n「わたしが、入る。ハツさんの代わりに、数える。あんたは、帰りんさい。町へ」", "doc");
        g.ask("tome_offer");
        return true;
      }
      Kura.tomeTalk(g);
      return true;
    },
    ask: (g, topic) => { Kura.tomeAsk(g, topic); return true; },
    give: (g, id) => Kura.tomeGive(g, id),
  };

  D.morning = g => {
    const S = g.S;
    S.dread = Math.max(0, S.dread - 4);
    S.f.rings = 0; S.f.poured = false; S.f.counts = 0;
    S.loc.tome = "tome_house";
    if (S.day === 2) {
      g.say("目を覚ますと、あなたは、奥座敷の畳に、横になっていた。\n……いつ、眠ったのだろう。", "sub");
    } else if (S.day === 3) {
      g.say("朝。\n門のほうから、人の声がした。トメが、坂の上の門のところに、立っているらしい。", "sub");
      S.loc.tome = "gate";
      g.say("（門のところへ行って、トメに話しかけよう）", "sub");
    }
  };

  // ------------------------------------------------------------------
  // 結末
  // ------------------------------------------------------------------
  w.ending("return", {
    title: "帰る人々", good: true, cls: "doc",
    text: [
      "鏡を、台座に収めた。手帳を開いて、懐中電灯の光を当てる。\n谷の底の、冷たい空気を、胸いっぱいに吸いこんだ。",
      "「タケさん」",
      "声は、闇に吸われなかった。まっすぐ、谷の底の、鏡のなかへ、届いた。\n鏡面に、小さな、白い手が、ひとつ、浮かび上がった。手を振るように、揺れて、すうっと、水面に、溶けた。",
      "「ヨシゾウさん。ふみさん。源七さん。サダさん……」\nひとつ、呼ぶたびに、足音が、ひとつ、遠のいた。ひとつ、呼ぶたびに、鏡のなかで、あたたかい光が、ともった。\n十、十五、二十。呼ぶ声が、涙で、震えはじめた。",
      g => g.flag("mioHelped")
        ? "「みお」\n最後の名を、呼んだ。\n濡れた髪の、小さな女の子が、鏡のそばに立っていた。胸に、真新しい名札が、光っている。\n「……ありがとう」\nみおは、笑った。\n「ハツちゃんにも、いってね。……もう、てを、はなさなくていいよ、って」\n女の子は、手を振って、鏡のなかへ、駆けていった。"
        : "「みお」\n最後の名を、呼んだ。\n鏡の底で、小さな、泣くような声が、ひとつだけ、返事をした。\n……ありがとう、と、聞こえた気がした。",
      g => g.flag("mioFull") ? "鏡の縁で、青いおはじきが、ひとつ、きらりと光った。みおが、握りしめていたものだ。\nそれが、水面に、そっと、落ちて、輪になった。ひとつ。ふたつ。……二十一の輪が、重なって、ひとつになった。" : "",
      "二十一の名を、すべて、呼び終えたとき、足音は、ひとつも、残っていなかった。\n鏡の水面は、ただの、青銅の、冷たい円に戻っていた。\n谷の空が、白みはじめている。",
      "あなたは、泥の道を、ゆっくり、引き返した。\n遠く、坂の上の、柏木の家の蔵から、鈴の音が、一度だけ、聞こえた。\n誰も、鳴らしていない鈴。\nあなたは、なぜか、それが、ハツの音だと、わかった。",
      "家に戻ると、蔵の戸は、開け放たれていた。中の水は、すっかり引いて、座布団の窪みだけが、残っていた。\nあなたは、その窪みに、そっと、手を置いた。\n温かさは、もう、なかった。それで、よかった。",
      "四十九日の朝、親戚が、家に集まった。\n誰も、蔵の水のことを、知らなかった。\nあなたは、仏壇の前に、そっと、手帳を置いた。そこには、二十一の名と、「柏木ハツ」の名が、並んでいた。",
    ],
  });

  w.ending("keeper", {
    title: "蔵守", cls: "doc",
    text: [
      "あなたは、座布団に、座った。\n膝をそろえて、鏡のそばに、背を伸ばす。",
      "すると、水の音が、ゆっくりと、ゆっくりと、鎮まっていった。\n足音も、声も、遠くなる。蔵のなかは、おだやかな、闇になった。\n──これで、いい。ハツも、きっと、こうして、はじめた。",
      "朝が来て、夜が来て、また朝が来る。\n何日目からか、数えるのを、やめた。ただ、ここに座って、水の音に、耳をすませている。\n時折、鈴を鳴らし、数を数える。ひとつ、ふたつ。にじゅういち。\nそして、あなたが、二十二。",
      "四十九日の朝。\n親戚が、家に集まった。誰かが、ふと、蔵の戸が、開いているのに、気づいた。\n「あの子は？」\n蔵のなかには、座布団と、小さな机と、丸い鏡があるだけだった。\n座布団には、人のかたちの、あたたかい窪みが、できていた。",
      "それから、柏木の家の蔵は、静かになった。\n夜になると、ときどき、鈴の音と、誰かが数を数える声が、聞こえるという。",
    ],
  });

  w.ending("substitute", {
    title: "身代わり", cls: "doc",
    text: [
      "「お願いします」\nそう言ったとき、トメは、うれしそうに、笑った。\n「ええ子だ。ハツさんの孫だけある」",
      "トメは、蔵の戸を、ゆっくりと、開けた。小さな背が、闇のなかへ、ひとりで、入っていく。\n鈴が、ちりん、と、鳴った。\n戸が、ゆっくりと、閉まった。",
      "……水の音が、静まっていった。\nあなたは、いつまでも、蔵の前に、立っていた。何かを、言いたかった。ありがとう、でも、ごめんなさい、でもなかった。\n夜が明けるまで、あなたは、そこから動けなかった。",
      "翌朝、あなたは、町へ帰った。\n四十九日の法要には、トメさんの姿は、なかった。誰に聞いても、「そんな人は、知らん」と言う。\nあの坂の下の小さな家は、いつのまにか、廃屋になっていた。",
      "それから、あなたは、毎年、夏になると、水の音を聞く。\n夜中に目覚めて、耳をすませると、遠くで、小さな鈴が、鳴っている。\nそのたびに、あなたは、静かに、手を合わせる。",
    ],
  });

  w.ending("fire", {
    title: "炎", cls: "doc",
    text: [
      "マッチを、擦った。\n小さな炎が、ふっと、ふくらんで、溝の灯油に、ふれた。\n火は、ぱっと、走って、蔵の戸の下から、壁を、駆け上がった。",
      "炎は、白壁を、赤く染めた。\n蔵のなかから、悲鳴のような、水の音が、噴き出した。\nどん、どん、と、内側から、戸が、叩かれる。何十もの手で。",
      "あなたは、後ずさった。\n水が、蔵の戸から、あふれ出した。炎は、水を焼いた。水は、炎を消した。それでも、火は、消えなかった。\n夜じゅう、蔵は、燃え、水は、庭にあふれ、母屋を、のみこんだ。",
      "朝になった。\n柏木の家は、跡形もなかった。濡れた、黒い灰の山が、庭いっぱいに、広がっていた。",
      "あなたは、生きていた。けれど、それから、何年たっても、あなたは、夜、水の音に、追われている。\n数を、数える声が、背中から、離れない。\n「……ひとり、たりない」\nその声は、いつも、あなたの、すぐ後ろで、言う。",
    ],
  });

  w.ending("called", {
    title: "二十二人目", cls: "doc",
    text: [
      "足首をつかむ手が、増えていく。\n息が、できなくなる。水の音で、頭のなかが、いっぱいになる。\nあなたは、膝をついた。",
      "『ひとつ』『ふたつ』『みっつ』\n声が、数えている。\n『……にじゅういち』\n『にじゅうに』",
      "最後の数が、あなたの名前に、重なった。",
      "気づくと、あなたは、水のなかに、立っていた。\n濡れた人々が、あなたを、ぐるりと囲んで、静かに、見ている。\n誰もが、笑っていた。さびしそうに。",
      "それから、あなたは、蔵の、水の間で、数を数えている。\n二十一までは、人の数。二十二番目は、あなた。\n鏡のなかの水面に、小さな、白い手が、ときどき、浮かんでくる。\nあなたは、まだ、その手を、握ることが、できない。",
    ],
  });

  w.ending("escape", {
    title: "帰りのバス", cls: "doc",
    text: [
      "あなたは、バスに、乗った。\n運転手は、何も言わず、扉を閉めた。バスは、砂埃をあげて、坂を下っていく。",
      "窓の外に、谷の底の湖が、白く光っている。鳥居の先端が、水面から、すこしだけ、のぞいている。\nあなたは、ゆっくり、目をそらした。",
      "町に着いて、親戚に、「やっぱり、無理でした」と、電話した。\n四十九日の法要には、あなただけが、行かなかった。誰も、何も、責めなかった。",
      "それから、数年が、過ぎた。\nあの村のことは、すこしずつ、忘れていった。忘れようと、した。\nけれど、夏の夜、風呂の水を張るとき、水道の蛇口から、一滴、また一滴と、落ちる音を聞くと、決まって、耳の奥で、誰かが数えはじめる。\n「ひとつ。ふたつ。みっつ……」\nあなたは、いつも、二十一まで数えて、そっと、蛇口を閉める。\n二十二は、数えない。",
    ],
  });

  w.ending("loop", {
    title: "四日目の夜", cls: "doc",
    text: [
      "夜が、明けた。\n空が白み、鳥が、鳴いた。……鳥が？\nあなたは、座敷の窓を、開けた。庭の土が、乾いている。",
      "ほっとして、手帳を開いた。\n書いてあるはずの手がかりが、ひとつ、残らず、水に溶けたように、にじんで、読めなくなっていた。",
      "その夜、日が落ちると、ぷつり、と、明かりが消えた。\n廊下の隅の、黒電話が、鳴りはじめた。\n四日目の夜が、はじまる。\n五日目も、六日目も。たぶん、四十九日の法要の日まで、あなたは、毎晩、同じ夜を、繰り返す。",
      "水の音は、終わらない。\n……終わらせないかぎり。",
      "（「ひとつ戻す」で、やり直せます）",
    ],
  });

  // ------------------------------------------------------------------
  // ヒント
  // ------------------------------------------------------------------
  const HINTS = [
    [g => !g.flag("tomeMet"), "門のそばの老婆に、話しかけてみよう。"],
    [g => g.S.day === 1 && !g.flag("diary1Read"), "台所の流しの下の引き出しに、ハツの日記がある。読むと、務めのことがわかる。"],
    [g => g.S.day === 1 && !g.flag("oboegakiRead"), "仏間の仏壇を開けて、引き出しも開けてみよう。覚え書がある。"],
    [g => g.S.day === 1 && !g.has("kaichu") && !g.has("chochin"), "納戸の長持に、灯りがあるかもしれない。夜は、灯りがなければ動けない。"],
    [g => g.S.day === 1 && !g.has("suzu"), "二階の祖母の部屋の文机に、鈴がある。夜の務めに使う。"],
    [g => g.S.day === 1 && !g.has("oke"), "風呂場に、湯桶がある。水は、井戸か風呂で汲める。"],
    [g => g.S.day === 1 && !g.flag("duty1") && g.S.phase !== "夜", "務めの準備：鈴、水を入れた桶、灯り。夜、蔵の前で、鈴を三度鳴らし、桶の水を溝へ流し、数を三回数える（七つずつ）。"],
    [g => g.S.phase === "夜" && !g.flag("duty" + g.S.day) && g.S.day < 3, "子の刻（柱時計が十二打つ）の少し前後に、蔵の前で鈴を三度、桶の水を溝へ、数を三回。足音が来る前に済ませたい。隠れるなら、納戸の戸を内側から閉めて灯りを消す。"],
    [g => g.S.day === 2 && !g.flag("juushokuTrust"), "二日目は、集落を歩こう。ハツの日記を読んだら、寺の住職を訪ねてみる。"],
    [g => g.S.day >= 2 && !g.flag("namesCopied") && g.flag("juushokuTrust"), "本堂の過去帳を、読んで、名を写そう。"],
    [g => g.S.day >= 2 && !g.flag("mioHelped") && !g.has("nafuda"), "祖母の部屋の桐の小箱に、みおの名札があるかもしれない。"],
    [g => g.S.day >= 2 && !g.flag("mioHelped") && g.has("nafuda"), "名札は、夕方の分校の教室にいる、みおに返せる。"],
    [g => g.S.day >= 2 && !g.flag("manualRead"), "ダムの管理棟に、何かあるらしい。集会所のポスターに、数字のヒントがある。"],
    [g => g.S.day >= 2 && g.flag("manualRead") && !g.flag("drawdown"), "管理棟の制御盤は、主電源→警報→副ゲートの順に操作する。"],
    [g => g.S.day === 3 && !g.flag("keyGiven"), "三日目の朝、門のところにいるトメに話しかけよう。蔵の鍵を持っている。"],
    [g => g.S.day === 3 && g.flag("keyGiven") && !g.flag("shimenawaCut"), "蔵の戸の注連縄を、鎌（納屋）で切る。鍵は「〜に使う」で錠前に。"],
    [g => g.S.day === 3 && g.flag("kuraOpen") && !g.flag("diary3Read"), "蔵の一階の机に、ハツの最後の日記がある。"],
    [g => g.S.day === 3 && !g.has("nagagutsu") && !g.has("kago"), "納屋の長靴（水の間へ降りるのに必要）と、背負い籠（鏡を運ぶのに必要）を。"],
    [g => g.S.day === 3 && !g.flag("drawdown"), "夜までに、ダムの水を下げておくと、底の社への道が開く。"],
    [g => g.S.day === 3 && g.night() && !g.flag("mirrorTaken"), "最後の夜：蔵の地下の水の間で、背負い籠を持って、水鏡を取る。灯りを忘れずに。"],
    [g => g.S.day === 3 && g.night() && g.flag("mirrorTaken") && !g.flag("mirrorPlaced"), "名簿の写しを声に出して「読む」と、人々は道を開ける（八つほど）。水の間の東の穴から、底の社へ。台座に、鏡を「〜に使う」。"],
    [g => g.flag("mirrorPlaced"), "名簿の写しを、ここで「読む」。"],
  ];
  HINTS.forEach(([cond, text]) => w.hint(g => (cond(g) ? text : null)));
});

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


// ---- ここから、時計用の口（ほかの四本と同じ形） ----
export function createGame(io) {
  io = io || {};
  const ENDINGS = ["return", "return_plus", "keeper", "substitute", "fire", "called", "escape", "loop"];

  const DEEP = ["一日目", "一晩目", "二日目", "二晩目", "三日目", "蔵の中", "水の間", "三晩目", "底の社"];

  function rankOf(S) {
    const night = S.phase === "夜";
    let r = S.day <= 1 ? (night ? 1 : 0) : S.day === 2 ? (night ? 3 : 2) : (night ? 7 : 4);
    if (S.visited.kura1) r = Math.max(r, 5);
    if (S.visited.kura_b) r = Math.max(r, 6);
    if (S.visited.soko) r = Math.max(r, 8);
    return r;
  }

  const AREA = {
    gate: "niwa", maeniwa: "niwa", uraniwa: "niwa", ido: "niwa", nagaya: "niwa",
    genkan: "omoya", doma: "omoya", chanoma: "omoya", zashiki: "omoya", engawa: "omoya", rouka: "omoya",
    niaikai: "omoya", obaba: "omoya", kodomo: "omoya", yaneura: "omoya",
    butsuma: "butsuma", furo: "furo", nando: "nando", yukashita: "nando",
    kuramae: "kuramae", kura1: "kura", kura2: "kura", kura_b: "mizu", suido1: "suido", suido2: "suido",
    michi: "mura", shukaijo: "mura", tsuji: "mura", roji: "mura", chuzaisho: "mura", yubin: "mura",
    tome_house: "tome", suijinja: "jinja", tadokoro: "haioku", matsuoka: "haioku",
    sanmon: "tera", hondo: "tera", bochi: "tera", koutei: "gakko", classroom: "gakko",
    kawa: "kawa", basutei: "kawa", rindo: "dam", dam_office: "dam", kanri: "kanri", dam_top: "kohan", kohan: "kohan",
    soko: "soko",
  };

  const PAL = {
    // 母屋（昼）：古い畳と障子の、くすんだ琥珀。電気は、昼のあいだだけ、この家にいる
    "omoya-day": { s: "#120e09", w: "#e3d3b4", b: "#fff7e8", d: "#8c7a5e", f: "#3a3023", k: "#1b150e", bb: "#e2c58c", bf: "#120e09", wa: "#ff5b4a", g: "226,197,140", a: "#e2c58c", c: "#ff5b4a", m: "tags", bed: "office", lv: 5, t: "house" },
    // 母屋（夕）：障子ごしの橙
    "omoya-dusk": { s: "#170b0b", w: "#f2cdb4", b: "#fff1e6", d: "#9a6f5c", f: "#3d2420", k: "#1f100e", bb: "#ff9b5e", bf: "#170b0b", wa: "#ff4f7b", g: "255,155,94", a: "#ff9b5e", c: "#b38cff", m: "tags", bed: "office", lv: 5, t: "house" },
    // 母屋（夜）：電気のいなくなった家。冷たい青の闇
    "omoya-night": { s: "#04060b", w: "#9cadc4", b: "#e4eeff", d: "#4c5a70", f: "#121a28", k: "#080d16", bb: "#1d2a40", bf: "#b9cdf0", wa: "#ff3b5c", g: "90,140,255", a: "#6f8cff", c: "#ff3b5c", m: "dark", bed: "dark", lv: 6, t: "house" },
    // 仏間：線香の煙。金と紫
    "butsuma-day": { s: "#110b12", w: "#e6d6ee", b: "#fff6ff", d: "#8a7593", f: "#33243a", k: "#1a111c", bb: "#d9b56b", bf: "#110b12", wa: "#ff4f6d", g: "217,181,107", a: "#d9b56b", c: "#c58bff", m: "tags", bed: "silence", lv: 9, t: "house" },
    "butsuma-night": { s: "#07040a", w: "#b7a6c9", b: "#f3eaff", d: "#5a4a6b", f: "#1c1426", k: "#0d0812", bb: "#2a1d3a", bf: "#d9c7f2", wa: "#ff3b5c", g: "157,123,255", a: "#9d7bff", c: "#ff3b5c", m: "dark", bed: "dark", lv: 6, t: "house" },
    // 風呂場：水色のタイル
    "furo-day": { s: "#061210", w: "#bfe6de", b: "#effffb", d: "#5e8c85", f: "#16302c", k: "#0b1d1a", bb: "#8eeedb", bf: "#061210", wa: "#ff6b9a", g: "142,238,219", a: "#8eeedb", c: "#ff6b9a", m: "water", bed: "pool", lv: 37, t: "house" },
    "furo-night": { s: "#020908", w: "#7fbcb3", b: "#dffbf6", d: "#3e6a64", f: "#0c2421", k: "#051311", bb: "#0f3a35", bf: "#a9f5e8", wa: "#ff3b6b", g: "47,224,200", a: "#2fe0c8", c: "#ff3b6b", m: "water", bed: "pool", lv: 37, t: "house" },
    // 納戸・床下：かび臭い暗がり
    "nando-day": { s: "#0b0805", w: "#b9a689", b: "#efe3cc", d: "#6b5c45", f: "#241c12", k: "#120d08", bb: "#6b5c45", bf: "#efe3cc", wa: "#ff7a4a", g: "255,190,110", a: "#b9a689", c: "#ff7a4a", m: "dark", bed: "dark", lv: 6, t: "house" },
    "nando-night": { s: "#030201", w: "#8c7c64", b: "#e0d4be", d: "#4a3f30", f: "#16110a", k: "#080604", bb: "#2a2117", bf: "#d8c8ac", wa: "#ff4a3d", g: "255,160,90", a: "#8c7c64", c: "#ff4a3d", m: "dark", bed: "dark", lv: 6, t: "house" },
    // 庭（昼）：湿った苔。晴れているのに、雫が落ちる
    "niwa-day": { s: "#0b100c", w: "#cddfc8", b: "#f3fff0", d: "#6f8a6c", f: "#1f2c20", k: "#111a12", bb: "#a8cf8e", bf: "#0b100c", wa: "#ff6a5a", g: "168,207,142", a: "#a8cf8e", c: "#ff6a5a", m: "drip", bed: "field", lv: 10, t: "niwa" },
    // 外（夕）：山の端の橙と紫
    "out-dusk": { s: "#160c0a", w: "#ffd6be", b: "#fff3ea", d: "#a2715c", f: "#3e2219", k: "#1f110c", bb: "#ff8a4c", bf: "#160c0a", wa: "#b38cff", g: "255,138,76", a: "#ff8a4c", c: "#b38cff", m: "stars", bed: "night", lv: 9, t: "niwa" },
    // 外（夜）：月明かりの藍
    "out-night": { s: "#050716", w: "#a9b6e6", b: "#eef1ff", d: "#4f5a8c", f: "#151b3a", k: "#0a0e22", bb: "#8c9cff", bf: "#050716", wa: "#ff3b6b", g: "140,156,255", a: "#8c9cff", c: "#ff3b6b", m: "stars", bed: "night", lv: 9, t: "niwa" },
    // 蔵の前（昼）：白壁。ここだけ、白い
    "kuramae-day": { s: "#ebe8df", w: "#2c3236", b: "#0e1214", d: "#7d8186", f: "#cfcac0", k: "#e0dcd2", bb: "#2c3236", bf: "#ebe8df", wa: "#b8322a", g: "194,55,43", a: "#4d6b78", c: "#c2372b", m: "drip", bed: "pool", lv: "white", t: "kura", light: true },
    "kuramae-dusk": { s: "#e8d6c4", w: "#3a2a24", b: "#160d0a", d: "#8a6d5e", f: "#d2b9a6", k: "#dfcab6", bb: "#3a2a24", bf: "#e8d6c4", wa: "#b52a35", g: "181,42,53", a: "#b0603a", c: "#c2372b", m: "drip", bed: "pool", lv: "white", t: "kura", light: true },
    // 蔵の前（夜）：闇に浮く白壁
    "kuramae-night": { s: "#06060a", w: "#e6e6ee", b: "#ffffff", d: "#6c6c7c", f: "#1a1a24", k: "#0c0c12", bb: "#f0f0f6", bf: "#06060a", wa: "#ff2d55", g: "255,255,255", a: "#e6e6ee", c: "#ff2d55", m: "drip", bed: "cave", lv: 8, t: "kura" },
    // 蔵の中：懐中電灯の黄色い円
    "kura-day": { s: "#080705", w: "#ddd2b6", b: "#fff8e6", d: "#7a6f58", f: "#221d14", k: "#100e0a", bb: "#f5e7a6", bf: "#080705", wa: "#ff4a3d", g: "245,231,166", a: "#f5e7a6", c: "#ff4a3d", m: "drip", bed: "cave", lv: 8, t: "kura" },
    "kura-night": { s: "#040405", w: "#c9cbd6", b: "#f4f6ff", d: "#5d6070", f: "#16171e", k: "#0a0a0e", bb: "#cfd8ff", bf: "#040405", wa: "#ff3355", g: "207,216,255", a: "#cfd8ff", c: "#ff3355", m: "drip", bed: "cave", lv: 8, t: "kura" },
    // 水の間：黒く澄んだ水
    "mizu-day": { s: "#01080a", w: "#8fe0dc", b: "#e6ffff", d: "#3f7774", f: "#0b2324", k: "#041214", bb: "#00d1c1", bf: "#01080a", wa: "#ff3d7f", g: "0,209,193", a: "#00d1c1", c: "#ff3d7f", m: "water", bed: "pool", lv: 7, t: "mizu" },
    "mizu-night": { s: "#000507", w: "#76d0cc", b: "#dcffff", d: "#2f625f", f: "#06191a", k: "#020c0d", bb: "#00a89b", bf: "#e6ffff", wa: "#ff2d6f", g: "0,168,155", a: "#00e0cf", c: "#ff2d6f", m: "water", bed: "sea", lv: 7, t: "mizu" },
    // 水路
    "suido": { s: "#020506", w: "#9cc4c6", b: "#e6ffff", d: "#4b6f71", f: "#0e1d1e", k: "#061011", bb: "#2f7f84", bf: "#dffcff", wa: "#ff3d7f", g: "79,214,220", a: "#4fd6dc", c: "#ff3d7f", m: "drip", bed: "cave", lv: 7, t: "mizu" },
    // 村（昼）：色の抜けた写真
    "mura-day": { s: "#100f0b", w: "#dcd3bd", b: "#fffaf0", d: "#8a8169", f: "#2e2a1f", k: "#18160f", bb: "#cdb98c", bf: "#100f0b", wa: "#ff5f57", g: "205,185,140", a: "#cdb98c", c: "#7fd0ff", m: "tags", bed: "field", lv: 9, t: "mura" },
    // 空き家（田所・松岡）
    "haioku-day": { s: "#0c0b0d", w: "#d2ccd6", b: "#f8f4fb", d: "#77707e", f: "#26232a", k: "#141217", bb: "#a99bb5", bf: "#0c0b0d", wa: "#ff6a5a", g: "169,155,181", a: "#a99bb5", c: "#ff6a5a", m: "dark", bed: "dark", lv: 6, t: "mura" },
    // トメの家：囲炉裏の火
    "tome-day": { s: "#140a06", w: "#f0d2b4", b: "#fff4e8", d: "#9a7458", f: "#3a2418", k: "#1d0f08", bb: "#ff9f5a", bf: "#140a06", wa: "#ff5050", g: "255,159,90", a: "#ff9f5a", c: "#ffd27a", m: "scope", bed: "silence", lv: 5, t: "mura" },
    // 水神社：朱と杉
    "jinja-day": { s: "#0e0a08", w: "#ecd9c8", b: "#fff6ee", d: "#94786a", f: "#33241d", k: "#170f0b", bb: "#ff5a3c", bf: "#0e0a08", wa: "#7fe3ff", g: "255,90,60", a: "#ff5a3c", c: "#7fe3ff", m: "tags", bed: "field", lv: 2, t: "mura" },
    // 寺：線香と紫
    "tera-day": { s: "#0e0a12", w: "#e2d5ec", b: "#fbf6ff", d: "#85769a", f: "#2c2236", k: "#150f1b", bb: "#c9a6ff", bf: "#0e0a12", wa: "#ffcf5a", g: "201,166,255", a: "#c9a6ff", c: "#ffcf5a", m: "tags", bed: "silence", lv: 9, t: "tera" },
    // 分校：黒板の緑
    "gakko-day": { s: "#0b1712", w: "#cfe6d4", b: "#f4fff6", d: "#6f9a80", f: "#1e3a2b", k: "#10241a", bb: "#e6f2c4", bf: "#0b1712", wa: "#ff7a8a", g: "230,242,196", a: "#e6f2c4", c: "#ff7a8a", m: "tags", bed: "field", lv: 10, t: "gakko" },
    // 分校（夕）：誰かのいる教室
    "gakko-dusk": { s: "#1a0d05", w: "#ffe0c2", b: "#fff6ec", d: "#a3765a", f: "#42261a", k: "#22120a", bb: "#ffa64d", bf: "#1a0d05", wa: "#ff4f8b", g: "255,166,77", a: "#ffa64d", c: "#ff4f8b", m: "stars", bed: "silence", lv: 5, t: "gakko" },
    // 川端・バス停
    "kawa-day": { s: "#071012", w: "#c4e0e4", b: "#f0feff", d: "#64888d", f: "#1a2e31", k: "#0d1a1c", bb: "#7fd6e0", bf: "#071012", wa: "#ffb35c", g: "127,214,224", a: "#7fd6e0", c: "#ffb35c", m: "sea", bed: "sea", lv: 7, t: "mura" },
    // ダム
    "dam-day": { s: "#0a0e11", w: "#c3d1da", b: "#f2f8fc", d: "#687985", f: "#1d272e", k: "#11171c", bb: "#8fd3ff", bf: "#0a0e11", wa: "#ff5a5a", g: "143,211,255", a: "#8fd3ff", c: "#ff5a5a", m: "grid", bed: "pipes", lv: 11, t: "dam" },
    // 管理室：計器の緑
    "kanri-day": { s: "#050d08", w: "#b8f0c6", b: "#effff3", d: "#5b8a69", f: "#123020", k: "#0a1a10", bb: "#5dff9a", bf: "#050d08", wa: "#ff4040", g: "93,255,154", a: "#5dff9a", c: "#ff4040", m: "scope", bed: "electric", lv: 3, t: "dam" },
    // 堤・湖畔
    "kohan-day": { s: "#050b10", w: "#b5cfe0", b: "#eef8ff", d: "#5a7486", f: "#16242f", k: "#0b141b", bb: "#6fb8ff", bf: "#050b10", wa: "#ff6b6b", g: "111,184,255", a: "#6fb8ff", c: "#e8f4ff", m: "sea", bed: "field", lv: 7, t: "dam" },
    // 底の社の跡
    "soko": { s: "#0b0c0d", w: "#d6dbde", b: "#ffffff", d: "#6c7378", f: "#22272a", k: "#121517", bb: "#dfe5e9", bf: "#0b0c0d", wa: "#ff3d6b", g: "223,229,233", a: "#dfe5e9", c: "#ff3d6b", m: "water", bed: "dark", lv: 37, t: "soko" },
    "soko-lit": { s: "#0d0b08", w: "#f3e4c8", b: "#fffaf0", d: "#9a8a6c", f: "#2e2719", k: "#16130c", bb: "#ffe1a8", bf: "#0d0b08", wa: "#9fd8ff", g: "255,225,168", a: "#ffe1a8", c: "#9fd8ff", m: "water", bed: "silence", lv: 37, t: "soko" },
    // 結末
    "end-return": { s: "#f3ede6", w: "#3a3530", b: "#15110d", d: "#8a8077", f: "#d9cfc4", k: "#e8e0d6", bb: "#3a3530", bf: "#f3ede6", wa: "#b8432f", g: "224,168,122", a: "#e0a87a", c: "#6fa8d6", m: "stars", bed: "field", lv: "white", t: "end", light: true },
    "end-return_plus": { s: "#fbf3df", w: "#3b3020", b: "#140f06", d: "#8f7d5c", f: "#e2d2ae", k: "#f0e4c6", bb: "#3b3020", bf: "#fbf3df", wa: "#b8432f", g: "255,184,77", a: "#ffb84d", c: "#ff6fa8", m: "stars", bed: "field", lv: "white", t: "end", light: true },
    "end-keeper": { s: "#000000", w: "#cfcfcf", b: "#ffffff", d: "#666666", f: "#1a1a1a", k: "#0a0a0a", bb: "#e8e8e8", bf: "#000000", wa: "#ff2d55", g: "255,255,255", a: "#ffffff", c: "#ff2d55", m: "dark", bed: "dark", lv: 6, t: "end" },
    "end-substitute": { s: "#05060c", w: "#aab4d4", b: "#eef1ff", d: "#56607e", f: "#161b2e", k: "#0b0e1a", bb: "#ffcf8a", bf: "#05060c", wa: "#ff6b6b", g: "255,207,138", a: "#aab4d4", c: "#ffcf8a", m: "stars", bed: "night", lv: 9, t: "end" },
    "end-fire": { s: "#160502", w: "#ffd2b8", b: "#fff2e6", d: "#a8634a", f: "#3e140a", k: "#200905", bb: "#ff4d1a", bf: "#160502", wa: "#ffd23f", g: "255,77,26", a: "#ff4d1a", c: "#ffd23f", m: "spark", bed: "electric", lv: "run", t: "end" },
    "end-called": { s: "#000a10", w: "#6fc2d6", b: "#dcf8ff", d: "#2e6170", f: "#062029", k: "#021118", bb: "#0a5f70", bf: "#c8f6ff", wa: "#ff3d7f", g: "0,194,214", a: "#00c2d6", c: "#ff3d7f", m: "water", bed: "sea", lv: 7, t: "end" },
    "end-escape": { s: "#0e1114", w: "#cdd4da", b: "#f6f9fb", d: "#6d7882", f: "#222a31", k: "#151a1f", bb: "#b8c4cf", bf: "#0e1114", wa: "#ff8a5c", g: "184,196,207", a: "#b8c4cf", c: "#ff8a5c", m: "grid", bed: "city", lv: 11, t: "end" },
    "end-loop": { s: "#04050a", w: "#8d98b8", b: "#e2e8ff", d: "#47506e", f: "#121628", k: "#090b16", bb: "#2b3555", bf: "#c9d4f5", wa: "#ff3b5c", g: "111,140,255", a: "#6f8cff", c: "#ff3b5c", m: "dark", bed: "dark", lv: 6, t: "end" },
  };

  function palFor(S) {
    if (S.over) return PAL["end-" + S.over] ? "end-" + S.over : "end-loop";
    const r = S.room, a = AREA[r] || "omoya";
    const t = S.phase === "夜" ? "night" : S.phase === "夕" ? "dusk" : "day";
    if (a === "soko") return S.f.mirrorPlaced ? "soko-lit" : "soko";
    if (a === "suido") return "suido";
    if (PAL[a + "-" + t]) return a + "-" + t;
    const room = Kura.DEFS.rooms[r] || {};
    const outdoor = room.indoor === false;
    if (t === "night") return outdoor ? "out-night" : a === "kura" ? "kura-night" : "omoya-night";
    if (t === "dusk" && outdoor) return "out-dusk";
    return PAL[a + "-day"] ? a + "-day" : "omoya-day";
  }

  const REWORD = [["メニュー（⋮）の「ヒントを見る」", "メニュー（≡）の「ヒント」"], ["メニューの「はじめから遊ぶ」", "≡ メニューの「はじめから」"]];

  let game = null, rows = [], turnStart = 0, LOOP = null, statusL = '', statusR = '', metaData = null, fxq = [], saved = null;
  const gap = () => rows.push({ t: 'gap' });
  const note = (t) => rows.push({ t: 'out', ja: String(t), cls: 'note' });
  const ui = {
    say: (text, cls) => {
      let t = String(text);
      for (const [a, b] of REWORD) if (t.includes(a)) t = t.split(a).join(b);
      let c = cls || '';
      if (t.startsWith('【手がかり】')) c = 'clue';
      rows.push({ t: 'out', ja: t, cls: c.trim() });
    },
    gap,
    sep: gap,
    status: (l, r) => { statusL = l || ''; statusR = r || ''; },
    sys: note,
    flash: () => {},
    vibrate: () => { fxq.push({ type: 'shock' }); },
    ended: (id) => { fxq.push({ type: 'end' }); reach(id); },
  };

  // 見た結末・いちばん深いところ・周回（起動画面の札）。はじめからやり直しても残る
  function loadLoop() {
    const base = { v: 1, endings: [], runs: 0, deep: 0 };
    try {
      const v = io.loadLoop();
      if (v && typeof v === 'object' && v.v === 1) {
        const out = Object.assign(base, v);
        out.endings = Array.isArray(out.endings) ? out.endings.filter((id) => ENDINGS.includes(id)) : [];
        out.deep = Math.max(0, Math.min(DEEP.length - 1, out.deep | 0));
        out.runs = Math.max(0, out.runs | 0);
        return out;
      }
    } catch (e) { /* 壊れていたら、はじめから */ }
    return base;
  }
  function saveLoop() { try { io.saveLoop(LOOP); } catch (e) { /* 残らなくても遊べる */ } }
  function writeMeta() {
    metaData = { endings: LOOP.endings.slice(), total: ENDINGS.length, deepest: DEEP[LOOP.deep] || DEEP[0], runs: Math.max(1, LOOP.runs || 0) };
  }
  function reach(id) {
    if (!ENDINGS.includes(id) || LOOP.endings.includes(id)) return;
    LOOP.endings.push(id);
    saveLoop();
    writeMeta();
  }
  function writeSaved() {
    try { io.saveState({ v: 1, state: game.export(), log: rows.slice(-120) }); } catch (e) { /* 残せなくても遊べる */ }
  }
  function sync() {
    const S = game.state();
    const rk = rankOf(S);
    if (rk > LOOP.deep) { LOOP.deep = rk; saveLoop(); writeMeta(); }
  }

  // 命令（label は画面に出す文、cmd は送る命令）。方角・よく使う命令・「動詞 物 物」・「choose 番号」
  const DIRS = { north: 'n', south: 's', east: 'e', west: 'w', up: 'u', down: 'd' };
  const QUICK = { look: 'look', inventory: 'inv', inv: 'inv', wait: 'wait', listen: 'listen', sleep: 'sleep', undo: 'undo' };
  function submit(label, cmd) {
    cmd = String(cmd || label || '').trim();
    if (!cmd) return;
    if (rows.length > 400) { const d = rows.length - 300; rows = rows.slice(-300); turnStart = Math.max(0, turnStart - d); }
    turnStart = rows.length;
    fxq = [];
    const parts = cmd.split(' ');
    const head = parts[0];
    if (head !== 'choose') { gap(); rows.push({ t: 'cmd', ja: String(label || cmd) }); }
    try {
      if (DIRS[head]) game.go(DIRS[head]);
      else if (head === 'choose') { gap(); game.choose(parseInt(parts[1], 10)); }
      else if (head === 'hint') game.hint();
      else if (QUICK[head] && parts.length === 1) game.act(QUICK[head]);
      else game.act(head, parts[1], parts[2]);
    } catch (e) {
      note('（うまく動かなかった。別の言い方で、もう一度）');
    }
    sync();
    writeSaved();
  }

  function status() {
    const S = game.state();
    const P = PAL[palFor(S)] || PAL['omoya-day'];
    let room = statusL || ((Kura.DEFS.rooms[S.room] || {}).name || '');
    if (S.over) { const e = Kura.DEFS.endings[S.over]; room = '結末「' + (e && typeof e.title === 'string' ? e.title : S.over) + '」'; }
    const ex = S.over || S.prompt ? [] : game.exits().map((e) => e.dir);
    const choices = S.over ? [{ label: 'ひとつ戻す', cmd: 'undo' }] : game.choices().map((c) => ({ label: c.label, cmd: 'choose ' + c.id }));
    return { room, info: S.over ? '' : statusR, exits: ex, done: !!S.over, choices, pal: P };
  }

  function start(fresh) {
    rows = []; turnStart = 0; fxq = []; statusL = ''; statusR = '';
    LOOP = loadLoop();
    game = Kura.create(ui);
    let sv = null;
    if (!fresh) { try { sv = io.loadState(); } catch (e) { sv = null; } }
    let resumed = false;
    if (sv && sv.state) {
      try { resumed = !!game.import(sv.state); } catch (e) { resumed = false; }
      if (!resumed) game = Kura.create(ui);
    }
    if (resumed) {
      for (const r of sv.log || []) if (r && typeof r === 'object' && typeof r.t === 'string') rows.push(r);
      if (!rows.length) game.look(true);
      gap();
      note('（前回の続きから）');
      turnStart = rows.length - 1;
    } else {
      LOOP.runs = (LOOP.runs || 0) + 1;
      saveLoop();
      rows.push({ t: 'out', ja: '蔵守', cls: 'title' });
      game.start();
    }
    sync();
    writeMeta();
    writeSaved();
  }

  const verbPattern = (v) => v.id + (v.args >= 1 ? ' %' : '') + (v.args >= 2 ? ' #' : '');
  return {
    get VERBS() { return game.verbs().filter((v) => v.id !== 'undo').map((v) => [v.label, verbPattern(v), v.fmt]); },
    start,
    submit,
    status,
    turn: () => rows.slice(turnStart),
    pastCommands: (n) => rows.slice(0, turnStart).filter((r) => r.t === 'cmd').slice(-n).map((r) => r.ja),
    fx: () => fxq.slice(),
    meta: () => metaData,
    // 動詞ごとに選べるものが違う（verb は [ラベル, 型, 表示]、first は2つ目を選ぶときの1つ目）
    visible: (verb, first) => game.things(verb ? verb[1].split(' ')[0] : 'examine', first ? first.en : null)
      .map((t) => ({ id: t.id, name: t.label, en: String(t.id), held: !!t.held })),
    wordsHere: () => [],
  };
}
