// 時計からわかること（脈・歩数・電池・時刻・つけているか）。読めないものは null のまま
import { HeartRate, Step, Battery, Time, Wear } from '@zos/sensor'

let hr = null, step = null, bat = null, time = null, wear = null
const safe = (f) => { try { return f() } catch (e) { return null } }

export function startSense() {
  hr = safe(() => new HeartRate())
  step = safe(() => new Step())
  bat = safe(() => new Battery())
  time = safe(() => new Time())
  wear = safe(() => new Wear())
}

export function observe() {
  const now = new Date()
  const v = {
    hr: safe(() => hr && (hr.getCurrent() || hr.getLast())),
    steps: safe(() => step && step.getCurrent()),
    battery: safe(() => bat && bat.getCurrent()),
    hour: safe(() => time && time.getHours()),
    minute: safe(() => time && time.getMinutes()),
    worn: safe(() => wear && wear.getStatus())
  }
  if (v.hour == null) { v.hour = now.getHours(); v.minute = now.getMinutes() }
  if (!(v.hr > 0)) v.hr = null
  if (!(v.steps > 0)) v.steps = null
  if (!(v.battery > 0)) v.battery = null
  if (v.worn !== 0 && v.worn !== 1 && v.worn !== 2) v.worn = null
  return v
}
