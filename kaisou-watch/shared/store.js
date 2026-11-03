// 状態の保存（時計のアプリ用の /data に置く）。ゲームごとに、ファイル名の頭を変える
import { readFileSync, writeFileSync, statSync } from '@zos/fs'

function readJson(path) {
  if (!statSync({ path })) return null
  const s = readFileSync({ path, options: { encoding: 'utf8' } })
  return s ? JSON.parse(s) : null
}
function writeJson(path, obj) {
  writeFileSync({ path, data: JSON.stringify(obj), options: { encoding: 'utf8' } })
}

// ゲームの io：1 手ごとの状態と、周回の記録（はじめからやり直しても消さない）
export function makeIo(id) {
  return {
    loadState: () => readJson(id + '.json'),
    saveState: (obj) => writeJson(id + '.json', obj),
    loadLoop: () => readJson(id + '-loop.json'),
    saveLoop: (obj) => writeJson(id + '-loop.json', obj)
  }
}

// 起動画面に出す、札の要約（結末の数・いちばん深いところ・何周目か）。ゲームの側が、1 手ごとに書く
export function saveMeta(id, meta) {
  try { writeJson(id + '-meta.json', meta) } catch (e) { /* 残せなくてもよい */ }
}
export function loadMeta(id) {
  try { return readJson(id + '-meta.json') } catch (e) { return null }
}

// 時計だけの設定（振動の入／切）
export function loadSettings() {
  try { return readJson('kaisou-set.json') || { vibe: true } } catch (e) { return { vibe: true } }
}
export function saveSettings(obj) {
  try { writeJson('kaisou-set.json', obj) } catch (e) { /* 残せなくてもよい */ }
}
