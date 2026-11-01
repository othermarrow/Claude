// 振動。ノック一回だけ（短く、はっきり）。時計が対応していなければ、何もしない
// （前の版で実機で振動していた呼び方のまま、一回だけにした）
import * as sensor from '@zos/sensor'

let v = null
export function knock() {
  try {
    if (!v) v = new sensor.Vibrator()
    const mode = sensor.VIBRATOR_SCENE_SHORT_STRONG
    if (mode !== undefined && typeof v.setMode === 'function') v.setMode(mode)
    if (mode !== undefined) v.start({ mode })
    else v.start()
  } catch (e) { /* 振動できなくても続ける */ }
}
