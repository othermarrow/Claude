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
  loadState: () => readJson('kuuran.json'),
  saveState: (obj) => writeJson('kuuran.json', obj),
  // 周回の記録。はじめからやり直しても消さない
  loadLoop: () => readJson('kuuran-loop.json'),
  saveLoop: (obj) => writeJson('kuuran-loop.json', obj)
}
