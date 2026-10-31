// 使い方: node tools/play.js ゲームファイル "命令1" "命令2" ...
const fs = require("fs");
const { ZVM } = require("../zvm.js");
const [file, ...cmds] = process.argv.slice(2);
const vm = new ZVM(fs.readFileSync(file), {
  out: s => process.stdout.write(s),
  clear: () => process.stdout.write("\n----\n"),
  save: s => { vm.lastSave = s; return true; },
  restore: () => vm.lastSave,
});
let st = vm.run();
for (const c of cmds) {
  if (st.type === "quit") break;
  const up = vm.upperLines().filter(Boolean);
  if (up.length) console.log("[上] " + up.join(" / "));
  if (vm.status) console.log("[状態] " + JSON.stringify(vm.status));
  process.stdout.write("\n> " + c + "\n");
  if (st.type === "char") vm.submitChar(c.charCodeAt(0) || 13); else vm.submitLine(c);
  st = vm.run();
}
console.log("\n[終了状態] " + st.type);
