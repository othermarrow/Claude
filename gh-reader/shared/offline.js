// 時計の中（ミニアプリの /data）に保存したオフライン用データ
import { readFileSync, writeFileSync, rmSync, statSync } from '@zos/fs'

const INDEX = 'off_index.json'

export function readIndex() {
  try {
    const s = readFileSync({ path: INDEX, options: { encoding: 'utf8' } })
    return s ? JSON.parse(s) : null
  } catch (e) {
    return null
  }
}

export function readText(f) {
  try {
    return readFileSync({ path: f, options: { encoding: 'utf8' } }) || ''
  } catch (e) {
    return ''
  }
}

function removeGen(gen) {
  for (let i = 0; i < 10000; i++) {
    const f = `off_${gen}_${i}.txt`
    if (!statSync({ path: f })) break
    rmSync({ path: f })
  }
}

// スマホ経由でオフライン用フォルダを丸ごと取り込む。
// 世代を交互に使い、索引を書き終えてから古い世代を消すので、途中で切れても前のデータは残る
export async function sync(vm, onProgress) {
  const list = await vm.request({ method: 'OFFLINE_LIST', params: {} }, { timeout: 180000 })
  if (list.error) throw new Error(list.error)
  const old = readIndex()
  const gen = old && old.gen === 1 ? 0 : 1
  removeGen(gen) // 前回中断したときの残り
  const items = []
  for (let i = 0; i < list.items.length; i++) {
    const it = list.items[i]
    onProgress && onProgress(i + 1, list.items.length, it.p)
    const r = await vm.request({ method: 'RAW', params: { path: list.folder + '/' + it.p } }, { timeout: 120000 })
    if (r.error) throw new Error(`${it.p}: ${r.error}`)
    const f = `off_${gen}_${i}.txt`
    writeFileSync({ path: f, data: r.text, options: { encoding: 'utf8' } })
    items.push({ p: it.p, c: it.c, f })
  }
  writeFileSync({
    path: INDEX,
    data: JSON.stringify({ gen, folder: list.folder, at: Date.now(), items }),
    options: { encoding: 'utf8' }
  })
  if (old) removeGen(old.gen === 1 ? 1 : 0)
  return items.length
}
