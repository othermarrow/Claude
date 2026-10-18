// zork-ja/data の辞書（TSV）から、時計用の shared/dict.js を作る。
// 使い方（リポジトリの中で）: node zork-watch/tools/build-dict.js
const fs = require('fs')
const path = require('path')

const DATA = path.join(__dirname, '..', '..', 'zork-ja', 'data')
const OUT = path.join(__dirname, '..', 'shared', 'dict.js')

function readTsv(name) {
  return fs
    .readFileSync(path.join(DATA, name), 'utf8')
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l && !l.startsWith('#') && l.includes('\t'))
    .map((l) => l.split('\t').slice(0, 2))
}

const norm = (s) => s.split(/\s+/).filter(Boolean).join(' ')
const names = {}
for (const [en, ja] of readTsv('names.tsv')) names[norm(en).toLowerCase()] = ja
const msgs = {}
for (const [en, ja] of readTsv('messages.tsv')) msgs[norm(en)] = ja
const patterns = []
for (const [rx, ja] of readTsv('patterns.tsv')) {
  new RegExp(rx) // JS で使えない書き方ならここで止まる
  patterns.push([rx, ja])
}

const verbs = {}
for (const [en, ja] of readTsv('verbs_en.tsv')) verbs[norm(en).toLowerCase()] = ja

const body =
  '// 自動生成（tools/build-dict.js）。直すときは zork-ja/data/*.tsv を直して作り直す。\n' +
  'export const NAMES = ' + JSON.stringify(names) + '\n' +
  'export const MSGS = ' + JSON.stringify(msgs) + '\n' +
  'export const PATTERNS = ' + JSON.stringify(patterns) + '\n' +
  'export const VERBS_EN = ' + JSON.stringify(verbs) + '\n'
fs.writeFileSync(OUT, body)
console.log(`${OUT}: 名前 ${Object.keys(names).length} / 文 ${Object.keys(msgs).length} / パターン ${patterns.length} / 動詞 ${Object.keys(verbs).length}`)
