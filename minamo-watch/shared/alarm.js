// アプリを閉じているあいだに、minamo が時計を起こす（@zos/alarm。device:os.alarm の許可）
//   59：毎時 59 分の合図（閉じるたびに、次の xx:59:00 に一回だけ予約し直す）
//   mono：画面が消えて閉じたあと、1〜10 分で独り言を話しに来る
// 開いているあいだは、予約を全部消す（合図は画面の時計が出す）
import { set, cancel, getAllAlarms } from '@zos/alarm'
import { clockParts } from './sense'

const URL = 'page/talk/index'
const safe = (f) => { try { return f() } catch (e) { return null } }

export function cancelAll() {
  const ids = safe(() => getAllAlarms()) || []
  for (const id of ids) safe(() => cancel(id))
}

// 次の xx:59:00 までの秒数
export function secTo59() {
  const { m, s } = clockParts()
  let sec = ((59 - m + 60) % 60) * 60 - s
  if (sec <= 0) sec += 3600
  return sec
}

function arm(delay, param) {
  return safe(() => set({ url: URL, delay: Math.max(30, Math.round(delay)), param, store: true })) || 0
}

// 閉じるときに呼ぶ。h59：閉じていても 59 分に合図するか。monoSec：独り言の予約（0 ならしない）
export function rearm(h59, monoSec) {
  cancelAll()
  const t59 = secTo59()
  if (h59) arm(t59, '59')
  // 59 分の合図と同じころなら、独り言は合図にまかせる
  if (monoSec > 0 && !(h59 && Math.abs(monoSec - t59) < 45)) arm(monoSec, 'mono')
}
