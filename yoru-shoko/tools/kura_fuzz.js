// 使い方: node tools/kura_fuzz.js [ゲーム数] [手数]
// 『蔵守』を、でたらめな操作で遊んで、例外が出ないか・どの結末に着くかを数える。
const { newGame } = require("./kura_test.js");
let seed = 12345;
const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
const games = parseInt(process.argv[2] || "100", 10), steps = parseInt(process.argv[3] || "600", 10);
const ends = {}, errors = {};
let maxDay = 0;
for (let gi = 0; gi < games; gi++) {
  const g = newGame(false);
  try {
    for (let i = 0; i < steps && !g.S.over; i++) {
      const ch = g.choices();
      if (ch.length) { g.choose(ch[rnd(ch.length)].id); continue; }
      const r = rnd(10);
      if (r < 3) { const ex = g.exits(); if (ex.length) g.go(ex[rnd(ex.length)].dir); continue; }
      const verbs = g.verbs().filter(v => v.id !== "count" || true);
      const v = verbs[rnd(verbs.length)];
      if (v.args === 0) { g.act(v.id); continue; }
      const t1 = g.things(v.id);
      if (!t1.length) continue;
      const a = t1[rnd(t1.length)];
      if (v.args === 1) { g.act(v.id, a.id); continue; }
      const t2 = g.things(v.id, a.id).filter(x => x.id !== a.id);
      if (!t2.length) continue;
      g.act(v.id, a.id, t2[rnd(t2.length)].id);
    }
    ends[g.S.over || "未完"] = (ends[g.S.over || "未完"] || 0) + 1;
    maxDay = Math.max(maxDay, g.S.day);
    // 保存と復元の往復
    const g2 = newGame(false);
    if (!g2.load(JSON.parse(JSON.stringify(g.S)))) throw new Error("load に失敗");
    g2.look(true);
  } catch (e) {
    const k = (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : String(e));
    errors[k] = (errors[k] || 0) + 1;
  }
}
console.log("結末:", ends, "最大日数:", maxDay);
console.log("例外:", Object.keys(errors).length ? errors : "なし");
