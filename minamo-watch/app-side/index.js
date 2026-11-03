// スマホの Zepp アプリの中で動く部分（サイドサービス）。
// 時計から Bluetooth で届いたものを、同じスマホの Termux で動いているミナモのサーバーへ渡す。
//   時計 → ここ → POST http://127.0.0.1:9090/api/watch → 返事を時計へ
// サーバーが動いていなければ、時計は自分だけで話す（ここは { ok: false } を返すだけ）。
import { BaseSideService, settingsLib } from '@zeppos/zml/base-side'

const DEFAULT_URL = 'http://127.0.0.1:9090'
let last = ''

function base() {
  return String(settingsLib.getItem('url') || DEFAULT_URL).trim().replace(/\/+$/, '') || DEFAULT_URL
}
function stamp() {
  const d = new Date()
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}
// 設定画面（Zepp アプリ → minamo → 設定）に、つながっているかを出す。変わったときだけ書く
function status(text, always) {
  if (text === last && !always) return
  last = text
  try { settingsLib.setItem('status', `${text}（${stamp()}）`) } catch (e) { /* なくてもよい */ }
}

async function post(params) {
  const res = await fetch({
    url: base() + '/api/watch',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Minamo': '1' },
    body: JSON.stringify(params),
    timeout: 15000
  })
  let body = res.body
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch (e) { body = {} }
  }
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`)
  return body || {}
}

AppSideService(
  BaseSideService({
    onInit() {},
    onRun() {},
    onDestroy() {},
    onSettingsChange() {},
    onRequest(req, res) {
      if (req.method !== 'WATCH') {
        res('unknown method')
        return
      }
      const p = req.params || {}
      post(p)
        .then((data) => {
          status(data && data.boot ? 'スマホのミナモ（mo）が起きて、つながりました' : 'スマホのミナモとつながっています', p.ev === 'start' || !!(data && data.boot))
          res(null, data)
        })
        .catch((e) => {
          const why = (e && e.message) || String(e)
          status(`スマホのミナモに届きません：${why}。Termux で mo を動かしてください`, true)
          res(null, { ok: false, error: why })
        })
    }
  })
)
