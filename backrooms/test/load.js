// テスト用：src のゲーム本体を Node の中で読み込む
const fs = require('fs'), path = require('path'), vm = require('vm');
function load(files) {
  const ctx = vm.createContext({ console, Math, JSON, Date });
  for (const f of files || ['levels.js', 'world.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), ctx, { filename: f });
  return expr => vm.runInContext(expr, ctx);
}
module.exports = { load };
