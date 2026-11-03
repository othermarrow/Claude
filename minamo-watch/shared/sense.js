// 時計からわかること。読めないもの（時計が対応していない・許可がない・まだ測っていない）は null のまま。
//   脈（いま・安静時）・歩数・カロリー・距離・立った時間・電池・時刻・つけているか
//   睡眠（昨夜の長さ・深い眠り・点数・途中で目覚めた回数と最初の時刻・いま眠っているか・昼寝）
//   ストレス（いま・今日いちばん高かった時刻）・血中酸素・手首の温度
//   気圧・高度・周りの明るさ・手首の揺れ（加速度）・今日の天気（最高・最低）・年齢とニックネーム
import {
  HeartRate, Step, Battery, Time, Wear, Calorie, Distance, Stand, Sleep, Stress,
  BloodOxygen, BodyTemperature, Barometer, Screen, Accelerometer, Weather, Geolocation
} from '@zos/sensor'
import { getProfile } from '@zos/user'
import { readFileSync, writeFileSync, statSync } from '@zos/fs'

const safe = (f) => { try { return f() } catch (e) { return null } }
const num = (v, lo, hi) => (typeof v === 'number' && isFinite(v) && v >= lo && v <= hi ? v : null)
const S = {}
let hrNow = null, shake = 0, shakeN = 0, shakeAt = 0, motion = null, lastAcc = null
let onHr = null, onAcc = null, profile = null, sleepAt = 0, sleepCache = null
let fix = null, geoT = 0, geoStop = 0, geoOn = null   // 時計の GPS の最後の位置（lat・lon・取れた時刻）
let geoSt = 'idle'                                    // 'on' 測定中・'none' 取れなかった・'off' 使えない（許可がない・時計に付いていない）

export function startSense() {
  for (const [k, C] of [['hr', HeartRate], ['step', Step], ['bat', Battery], ['time', Time], ['wear', Wear],
    ['cal', Calorie], ['dist', Distance], ['stand', Stand], ['sleep', Sleep], ['stress', Stress],
    ['spo2', BloodOxygen], ['temp', BodyTemperature], ['baro', Barometer], ['screen', Screen],
    ['acc', Accelerometer], ['weather', Weather]]) {
    S[k] = safe(() => new C())
  }
  // 開いているあいだは、脈を続けて測る（いまの脈）
  onHr = () => { const v = safe(() => S.hr.getCurrent()); if (v > 0) hrNow = v }
  safe(() => S.hr.onCurrentChange(onHr))
  // 手首の揺れ：前の値との差を足していき、観測のたびに読んでゼロに戻す
  onAcc = () => {
    const a = safe(() => S.acc.getCurrent())
    if (!a) return
    if (lastAcc) { shake += Math.abs(a.x - lastAcc.x) + Math.abs(a.y - lastAcc.y) + Math.abs(a.z - lastAcc.z); shakeN++ }
    lastAcc = a
  }
  safe(() => S.acc.onChange(onAcc))
  safe(() => S.acc.start())
  safe(() => S.sleep.updateInfo())
  profile = safe(() => getProfile())
  S.geo = safe(() => new Geolocation())
  tryFix()
}

// 時計の GPS：電池のため、一度取れたら 6 時間おき。取れなかった（屋内など）ときだけ 15 分後に測り直す（一回は最長 5 分）。
// 最後の位置は時計に残す（アプリを開き直しても、6 時間以内なら測らない）。
// 位置は 3 桁（約 100 メートル）に丸める。スマホのミナモの外には出ない
const GEO_FILE = 'minamo-geo.json', GEO_EVERY = 6 * 3600000, GEO_RETRY = 900000
function loadFix() {
  try {
    if (!statSync({ path: GEO_FILE })) return null
    const j = JSON.parse(readFileSync({ path: GEO_FILE, options: { encoding: 'utf8' } }))
    return j && typeof j.lat === 'number' && typeof j.lon === 'number' && typeof j.at === 'number' ? j : null
  } catch (e) { return null }
}
function tryFix() {
  if (!S.geo) return
  clearTimeout(geoT); clearTimeout(geoStop)
  if (!fix) fix = loadFix()
  if (fix && Date.now() - fix.at < GEO_EVERY) { geoT = setTimeout(tryFix, GEO_EVERY - (Date.now() - fix.at)); return }
  const done = () => { safe(() => S.geo.offChange(geoOn)); safe(() => S.geo.stop()); geoOn = null; if (geoSt === 'on') geoSt = 'none' }
  geoOn = () => {
    if (safe(() => S.geo.getStatus()) !== 'A') return
    const la = safe(() => S.geo.getLatitude({ format: 'DD' })), lo = safe(() => S.geo.getLongitude({ format: 'DD' }))
    if (typeof la === 'number' && typeof lo === 'number' && Math.abs(la) <= 90 && Math.abs(lo) <= 180 && (la !== 0 || lo !== 0)) {
      fix = { lat: Math.round(la * 1000) / 1000, lon: Math.round(lo * 1000) / 1000, at: Date.now() }
      try { writeFileSync({ path: GEO_FILE, data: JSON.stringify(fix), options: { encoding: 'utf8' } }) } catch (e) { /* 残せなくても続ける */ }
      clearTimeout(geoStop); clearTimeout(geoT)
      geoT = setTimeout(tryFix, GEO_EVERY)
      done()
    }
  }
  try { S.geo.onChange(geoOn); S.geo.start(); geoSt = 'on' } catch (e) { geoSt = 'off'; geoOn = null; geoT = setTimeout(tryFix, GEO_RETRY); return }
  geoOn()
  geoStop = setTimeout(done, 300000)            // 冷えた状態からは、位置が取れるまで数分かかることがある
  geoT = setTimeout(tryFix, GEO_RETRY)          // 取れなければ、15 分後にもう一度（取れたら、上で 6 時間後に替わる）
}

// 時計の GPS の様子（画面の見出しと、スマホの mo log に出す）：fix 取れた・on 測定中・none 取れなかった・off 使えない
export function geoState() {
  if (fix && Date.now() - fix.at < 6 * 3600000) return 'fix'
  return geoSt === 'idle' ? 'on' : geoSt
}

export function stopSense() {
  clearTimeout(geoT); clearTimeout(geoStop)
  safe(() => S.geo.offChange(geoOn)); safe(() => S.geo.stop())
  safe(() => S.hr.offCurrentChange(onHr))
  safe(() => S.acc.offChange(onAcc))
  safe(() => S.acc.stop())
}

const hm = (m) => `${Math.floor(m / 60) % 24}時${String(m % 60).padStart(2, '0')}分`

// 睡眠は、時計が 30 分おきに更新する。読むのも 5 分に一度でよい
function sleepInfo() {
  if (sleepCache && Date.now() - sleepAt < 300000) return sleepCache
  sleepAt = Date.now()
  const info = safe(() => S.sleep.getInfo()) || {}
  const out = {
    sleepTotal: num(info.totalTime, 1, 1440), sleepDeep: num(info.deepTime, 0, 1440),
    sleepScore: num(info.score, 1, 100), sleepStart: num(info.startTime, 0, 2880), sleepEnd: num(info.endTime, 0, 2880),
    sleepWakes: null, sleepWakeAt: null, sleepRem: null
  }
  const C = safe(() => S.sleep.getStageConstantObj()) || {}
  const stages = safe(() => S.sleep.getStage()) || []
  if (Array.isArray(stages) && stages.length && C.WAKE_STAGE !== undefined) {
    const wakes = stages.filter((s) => s.model === C.WAKE_STAGE && s.start > (info.startTime || 0) && s.stop < (info.endTime || 1e9))
    out.sleepWakes = wakes.length
    out.sleepWakeAt = wakes.length ? hm(wakes[0].start) : null
    out.sleepRem = stages.filter((s) => s.model === C.REM_STAGE).reduce((a, s) => a + Math.max(0, s.stop - s.start), 0) || null
  }
  const naps = safe(() => S.sleep.getNap()) || []
  out.nap = Array.isArray(naps) ? naps.reduce((a, n) => a + (n.length || 0), 0) || null : null
  sleepCache = out
  return out
}

// 今日のストレスのいちばん高かった時刻（1 時間ごとの平均から）
function stressPeak() {
  const byHour = safe(() => S.stress.getTodayByHour()) || []
  let best = -1, at = null
  byHour.forEach((v, h) => { if (v > best) { best = v; at = h } })
  return best > 0 ? { stressMax: best, stressMaxAt: at } : {}
}

export function observe() {
  const now = new Date()
  const spo2 = safe(() => S.spo2.getCurrent()) || {}
  const temp = safe(() => S.temp.getCurrent()) || {}
  const fc = safe(() => S.weather.getForecastWeather()) || {}
  const today = (fc.forecastData && fc.forecastData.data && fc.forecastData.data[0]) || {}
  const lux = safe(() => S.screen.getLight())
  // 揺れは 5 秒以上ためてから読む（一回あたりの平均の変化。単位は cm/s²。目安は実機で確かめていない）
  if (shakeN >= 5 && Date.now() - shakeAt > 5000) {
    const avg = shake / shakeN
    motion = avg < 2 ? 'still' : avg > 40 ? 'move' : avg > 6 ? 'tremble' : null
    shake = 0; shakeN = 0; shakeAt = Date.now()
  }
  const v = Object.assign({
    hr: num(hrNow || safe(() => S.hr.getLast()), 25, 230),
    hrRest: num(safe(() => S.hr.getResting()), 25, 200),
    steps: num(safe(() => S.step.getCurrent()), 1, 300000),
    cal: num(safe(() => S.cal.getCurrent()), 1, 20000),
    dist: num(safe(() => S.dist.getCurrent()), 1, 500000),
    stand: num(safe(() => S.stand.getCurrent()), 1, 24),
    battery: num(safe(() => S.bat.getCurrent()), 1, 100),
    hour: safe(() => S.time.getHours()), minute: safe(() => S.time.getMinutes()),
    worn: safe(() => S.wear.getStatus()),
    sleeping: safe(() => S.sleep.getSleepingStatus()),
    stress: num((safe(() => S.stress.getCurrent()) || {}).value, 1, 100),
    spo2: num(spo2.value, 70, 100),
    temp: num(temp.current, 25, 43),
    pressure: num(safe(() => S.baro.getAirPressure()), 300, 1100),
    alt: num(safe(() => S.baro.getAltitude()), -500, 9000),
    light: num(lux, 0, 200000),
    shake: motion,
    high: num(today.high, -60, 60), low: num(today.low, -60, 60),
    age: num(profile && profile.age, 1, 120),
    nick: profile && typeof profile.nickName === 'string' ? profile.nickName.slice(0, 12) : null
  }, sleepInfo(), stressPeak())
  v.geo = geoState()
  if (fix) { v.lat = fix.lat; v.lon = fix.lon; v.gpsAge = Math.min(1440, Math.round((Date.now() - fix.at) / 60000)) }
  if (v.hour == null) { v.hour = now.getHours(); v.minute = now.getMinutes() }
  if (v.worn !== 0 && v.worn !== 1 && v.worn !== 2 && v.worn !== 3) v.worn = null
  if (v.sleeping !== 0 && v.sleeping !== 1) v.sleeping = null
  if (typeof v.temp === 'number') v.temp = Math.round(v.temp * 10) / 10
  if (typeof v.alt === 'number') v.alt = Math.round(v.alt)
  if (typeof v.pressure === 'number') v.pressure = Math.round(v.pressure)
  return v
}

// いまの時・分・秒（時計の表示と、59 分の合図に使う）
export function clockParts() {
  const t = S.time, d = new Date()
  const h = safe(() => t.getHours()), m = safe(() => t.getMinutes()), sec = safe(() => t.getSeconds())
  return { h: h == null ? d.getHours() : h, m: m == null ? d.getMinutes() : m, s: sec == null ? d.getSeconds() : sec }
}

// 画面が消えているか（画面が消えて 10 秒たつと、時計はアプリを閉じる。そのとき onDestroy で使う）
export function screenOff() {
  return safe(() => S.screen.getStatus()) === 2
}

// 時計の表示用：一行目に日付と曜日（yyyy/mm/dd（月））、二行目に時刻（hh:mm:ss）
const WEEK = ['月', '火', '水', '木', '金', '土', '日']        // Zepp の getDay() は 1 が月曜
export function clockLines() {
  const t = S.time, d = new Date(), p = (n) => String(n).padStart(2, '0')
  const y = safe(() => t.getFullYear()) || d.getFullYear()
  const mo = safe(() => t.getMonth()) || d.getMonth() + 1
  const da = safe(() => t.getDate()) || d.getDate()
  const wd = safe(() => t.getDay())
  const w = wd >= 1 && wd <= 7 ? WEEK[wd - 1] : WEEK[(d.getDay() + 6) % 7]
  const { h, m, s } = clockParts()
  return { date: `${y}/${p(mo)}/${p(da)}（${w}）`, time: `${p(h)}:${p(m)}:${p(s)}` }
}

// 時計の表示用（yyyy/mm/dd hh:mm:ss。一行のとき）
export function clockText() {
  const t = S.time, d = new Date()
  const y = safe(() => t.getFullYear()) || d.getFullYear()
  const mo = safe(() => t.getMonth()) || d.getMonth() + 1
  const da = safe(() => t.getDate()) || d.getDate()
  const h = safe(() => t.getHours()), mi = safe(() => t.getMinutes()), s = safe(() => t.getSeconds())
  const p = (n) => String(n).padStart(2, '0')
  return `${y}/${p(mo)}/${p(da)} ${p(h == null ? d.getHours() : h)}:${p(mi == null ? d.getMinutes() : mi)}:${p(s == null ? d.getSeconds() : s)}`
}
