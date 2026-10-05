// ゲームファイルの読み込みと、状態の保存（時計の /data に置く）
import {
  openAssetsSync,
  statAssetsSync,
  readSync,
  closeSync,
  readFileSync,
  writeFileSync,
  statSync,
  rmSync,
  O_RDONLY
} from '@zos/fs'

export function loadStory() {
  const st = statAssetsSync({ path: 'zork1.z3' })
  if (!st) throw new Error('zork1.z3 がありません。setup.sh を実行してから zeus preview してください')
  const buf = new ArrayBuffer(st.size)
  const fd = openAssetsSync({ path: 'zork1.z3', flag: O_RDONLY })
  readSync({ fd, buffer: buf, options: { offset: 0, length: st.size, position: 0 } })
  closeSync(fd)
  return new Uint8Array(buf)
}

// slot: 'auto'（毎ターン自動）または 'save'（ゲーム内の save 命令）
export function saveState(slot, snap, extra) {
  const { mem, ...rest } = snap
  const m = new Uint8Array(mem) // ArrayBuffer をちょうどの大きさで書くため複製
  writeFileSync({ path: slot + '.mem', data: m.buffer })
  writeFileSync({ path: slot + '.json', data: JSON.stringify({ ...rest, extra: extra || null }), options: { encoding: 'utf8' } })
  return true
}

export function loadState(slot) {
  if (!statSync({ path: slot + '.json' }) || !statSync({ path: slot + '.mem' })) return null
  const json = readFileSync({ path: slot + '.json', options: { encoding: 'utf8' } })
  const mem = readFileSync({ path: slot + '.mem' })
  if (!json || !mem) return null
  const s = JSON.parse(json)
  s.mem = new Uint8Array(mem)
  return s
}

export function clearState(slot) {
  for (const ext of ['.json', '.mem']) {
    if (statSync({ path: slot + ext })) rmSync({ path: slot + ext })
  }
}
