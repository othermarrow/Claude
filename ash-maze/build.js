// src/ をまとめて、1枚の ash-maze.html を作る（Tasker の WebView でそのまま開ける）
const fs = require('fs'), path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const JS = ['data.js', 'maze.js', 'game.js', 'battle.js', 'view.js', 'ui.js', 'ui_town.js', 'ui_maze.js', 'ui_battle.js', 'main.js'];
const js = JS.map(f => `// ---- ${f} ----\n` + src(f)).join('\n');
const html = src('template.html').replace('/*CSS*/', () => src('style.css')).replace('/*JS*/', () => js.replace(/<\/script/gi, '<\\/script'));
const out = path.join(__dirname, 'ash-maze.html');
fs.writeFileSync(out, html);
console.log('wrote', out, (html.length / 1024).toFixed(1) + 'KB');
