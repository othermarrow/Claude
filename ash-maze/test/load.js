// テスト用：src のゲーム本体を Node の中で読み込む
const fs = require('fs'), path = require('path'), vm = require('vm');
function load(files) {
  const ctx = vm.createContext({ console, Math, JSON, Date, setTimeout, clearTimeout });
  const list = files || ['data.js', 'maze.js', 'game.js', 'battle.js'];
  for (const f of list) {
    const p = path.join(__dirname, '..', 'src', f);
    if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f });
  }
  return (expr) => vm.runInContext(expr, ctx);
}
module.exports = { load };
