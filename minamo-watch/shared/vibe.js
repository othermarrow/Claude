// 振動。ノック一回だけ（短く、はっきり）。時計が対応していなければ、何もしない。
// 前の版は、振動の種類の渡し方が合っておらず、時計の既定の長い振動になっていた（利用者の報告）。
//   1. 新しい時計（API 3.6 以上）：getType() の「強く短い」を、場面の列で渡す
//   2. それ以外：setMode({ mode }) で「強く短い（20ms）」を選んでから start()
//   3. どちらでも、100ms たったら必ず止める（長い振動になっても、ノック一回の長さで切る）
import * as sensor from '@zos/sensor'

let v = null, stopT = 0
const safe = (f) => { try { f(); return true } catch (e) { return false } }

export function knock() {
  try {
    if (!v) v = new sensor.Vibrator()
  } catch (e) { return }
  safe(() => v.stop())
  let started = false
  const T = typeof v.getType === 'function' ? (() => { try { return v.getType() } catch (e) { return null } })() : null
  if (T && T.STRONG_SHORT !== undefined) started = safe(() => v.start([{ type: T.STRONG_SHORT, duration: 30 }]))
  if (!started) {
    const mode = sensor.VIBRATOR_SCENE_SHORT_STRONG
    if (mode !== undefined) safe(() => v.setMode({ mode }))
    started = safe(() => v.start())
  }
  clearTimeout(stopT)
  stopT = setTimeout(() => safe(() => v.stop()), 100)
}
