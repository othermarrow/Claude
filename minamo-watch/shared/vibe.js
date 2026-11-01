// 振動。pulse は、脈のような二回。時計が対応していなければ、何もしない
import * as sensor from '@zos/sensor'

let v = null
function once(strong) {
  try {
    if (!v) v = new sensor.Vibrator()
    const mode = strong ? sensor.VIBRATOR_SCENE_SHORT_STRONG : sensor.VIBRATOR_SCENE_SHORT_LIGHT
    if (mode !== undefined && typeof v.setMode === 'function') v.setMode(mode)
    if (mode !== undefined) v.start({ mode })
    else v.start()
  } catch (e) { /* 振動できなくても続ける */ }
}
export function buzz(strong) { once(strong) }
export function pulse() { once(true); setTimeout(() => once(false), 280) }
