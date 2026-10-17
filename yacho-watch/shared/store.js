// 状態の保存（時計のアプリ用の /data に置く）
import { readFileSync, writeFileSync, statSync } from '@zos/fs'

function readJson(path) {
  if (!statSync({ path })) return null
  const s = readFileSync({ path, options: { encoding: 'utf8' } })
  return s ? JSON.parse(s) : null
}
function writeJson(path, obj) {
  writeFileSync({ path, data: JSON.stringify(obj), options: { encoding: 'utf8' } })
}

export const io = {
  loadState: () => readJson('yacho.json'),
  saveState: (obj) => writeJson('yacho.json', obj),
  // 周回の記録（「椅子」で置いていった野帳など）。はじめからやり直しても消さない
  loadLoop: () => readJson('yacho-loop.json'),
  saveLoop: (obj) => writeJson('yacho-loop.json', obj)
}

// 時計だけの設定（振動の入／切）
export function loadSettings() {
  try { return readJson('yacho-set.json') || { vibe: true } } catch (e) { return { vibe: true } }
}
export function saveSettings(obj) {
  try { writeJson('yacho-set.json', obj) } catch (e) { /* 残せなくてもよい */ }
}
