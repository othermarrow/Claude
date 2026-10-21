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
  loadState: () => readJson('tanmatsu.json'),
  saveState: (obj) => writeJson('tanmatsu.json', obj)
}

// 時計だけの設定（振動の入／切）
export function loadSettings() {
  try { return readJson('tanmatsu-set.json') || { vibe: true } } catch (e) { return { vibe: true } }
}
export function saveSettings(obj) {
  try { writeJson('tanmatsu-set.json', obj) } catch (e) { /* 残せなくてもよい */ }
}
