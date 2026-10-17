// 振動。時計が対応していなければ、何もしない
import * as sensor from '@zos/sensor'

let v = null
export function buzz(strong) {
  try {
    if (!v) v = new sensor.Vibrator()
    const mode = strong ? sensor.VIBRATOR_SCENE_SHORT_STRONG : sensor.VIBRATOR_SCENE_SHORT_LIGHT
    if (mode !== undefined && typeof v.setMode === 'function') v.setMode(mode)
    if (mode !== undefined) v.start({ mode })
    else v.start()
  } catch (e) { /* 振動できなくても遊べる */ }
}
