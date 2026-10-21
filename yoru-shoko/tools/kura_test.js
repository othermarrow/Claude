// 使い方: node tools/kura_test.js [走査名]
// 『蔵守』を、エンジンだけで（画面なしで）通して遊んで、結末に着けるかを確かめる。
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const dir = path.join(__dirname, "..", "kura");
const ctx = { console, module: {} };
vm.createContext(ctx);
for (const f of ["engine.js", "house.js", "village.js", "night.js", "extra.js"]) {
  vm.runInContext(fs.readFileSync(path.join(dir, f), "utf8").replace(/^const Kura =/m, "var Kura ="), ctx, { filename: f });
}
const Kura = ctx.Kura;
function newGame(verbose) {
  const out = [];
  const ui = {
    say: (t, c) => { out.push(t); if (verbose) console.log((c ? "[" + c + "] " : "") + t); },
    gap: () => { if (verbose) console.log(""); }, sep: () => { if (verbose) console.log("-----"); },
    status: () => {}, sys: t => out.push(t), vibrate: () => {},
    ended: (id, title) => { ui.endedId = id; },
  };
  const g = Kura.create(ui);
  g.start();
  g.out = out; g.ui = ui; g.Kura = Kura;
  return g;
}
module.exports = { Kura, newGame };

if (require.main === module) {
  const walk = require("./kura_walk.js");
  walk.run(newGame, process.argv[2] || "return", process.argv.includes("-v"), Kura);
}
