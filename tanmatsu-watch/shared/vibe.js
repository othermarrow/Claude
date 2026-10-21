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

// ゲームの出来事（light / strong / double）に合わせて震える
export function feel(fx) {
  if (fx.includes('double')) {
    buzz(true)
    setTimeout(() => buzz(true), 350)
  } else if (fx.includes('strong')) buzz(true)
  else if (fx.includes('light')) buzz(false)
}
