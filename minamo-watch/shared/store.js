// 覚えておくこと（何回会ったか・前回の脈・こわい、と押した回数）。時計のアプリ用の /data に置く
import { readFileSync, writeFileSync, statSync } from '@zos/fs'

const PATH = 'minamo-watch.json'
export function load() {
  try {
    if (!statSync({ path: PATH })) return null
    const s = readFileSync({ path: PATH, options: { encoding: 'utf8' } })
    return s ? JSON.parse(s) : null
  } catch (e) { return null }
}
export function save(obj) {
  try { writeFileSync({ path: PATH, data: JSON.stringify(obj), options: { encoding: 'utf8' } }) } catch (e) { /* 残せなくても続ける */ }
}
