#!/data/data/com.termux/files/usr/bin/bash
# GH Reader (Amazfit Balance 2 用 GitHub 閲覧ミニアプリ) を ~/gh-reader に作成する
# 使い方: bash setup.sh && cd ~/gh-reader && npm i && zeus preview
set -e
APP=~/gh-reader
mkdir -p $APP/page/index $APP/page/viewer $APP/page/offline $APP/app-side $APP/setting $APP/shared $APP/assets/common.r
cd $APP

cat > app.json <<'EOF'
{
  "configVersion": "v3",
  "app": {
    "appId": 1098765,
    "appName": "GH Reader",
    "appType": "app",
    "version": {
      "code": 2,
      "name": "1.1.0"
    },
    "icon": "icon.png",
    "vender": "zepp",
    "description": "Read GitHub repository files on the watch"
  },
  "permissions": [
    "data:os.device.info",
    "device:os.local_storage"
  ],
  "runtime": {
    "apiVersion": {
      "compatible": "3.0",
      "target": "3.0",
      "minVersion": "3.0"
    }
  },
  "targets": {
    "common": {
      "module": {
        "page": {
          "pages": [
            "page/index/index",
            "page/viewer/index",
            "page/offline/index"
          ]
        },
        "app-side": {
          "path": "app-side/index"
        },
        "setting": {
          "path": "setting/index"
        }
      },
      "platforms": [
        {
          "st": "r",
          "dw": 480
        }
      ]
    }
  },
  "i18n": {
    "ja-JP": {
      "appName": "GH Reader"
    },
    "en-US": {
      "appName": "GH Reader"
    }
  },
  "defaultLanguage": "en-US",
  "debug": false
}
EOF

cat > package.json <<'EOF'
{
  "name": "gh-reader",
  "version": "1.0.0",
  "private": true,
  "main": "app.js",
  "dependencies": {
    "@zeppos/zml": "^0.0.43"
  },
  "devDependencies": {
    "@zeppos/device-types": "^4.0.0"
  }
}
EOF

cat > app.js <<'EOF'
import { BaseApp } from '@zeppos/zml/base-app'

App(BaseApp({ globalData: {}, onCreate() {}, onDestroy() {} }))
EOF

cat > app-side/index.js <<'EOF'
import { BaseSideService, settingsLib } from '@zeppos/zml/base-side'
import { parseMarkdown, paginate } from '../shared/markdown'

const API = 'https://api.github.com'
const TEXT_EXT = /\.(md|markdown|txt|py|js|ts|json|sh|ya?ml|csv|html?|css|toml|ini|log)$/i
const cache = {} // path -> pages (サイドサービスが生きている間だけ)
let treeCache = null // { key, at, entries }
let ctimes = null // path -> 作成日時(ms)。作成日は変わらないので settingsStorage に永続化

function conf() {
  return {
    owner: (settingsLib.getItem('owner') || 'othermarrow').trim(),
    repo: (settingsLib.getItem('repo') || 'Psychology').trim(),
    branch: (settingsLib.getItem('branch') || '').trim(),
    token: (settingsLib.getItem('token') || '').trim(),
    offline: (settingsLib.getItem('offline') || 'Abstract/report').trim().replace(/^\/+|\/+$/g, '')
  }
}

function repoUrl(c) {
  return `${API}/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`
}

function encPath(path) {
  return path
    .split('/')
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
    .join('/')
}

function header(h, name) {
  if (!h) return undefined
  if (typeof h.get === 'function') return h.get(name)
  for (const k of Object.keys(h)) if (k.toLowerCase() === name) return h[k]
  return undefined
}

function json(body) {
  return typeof body === 'string' ? JSON.parse(body) : body
}

async function request(url, raw) {
  const c = conf()
  if (!c.owner || !c.repo) throw new Error('スマホのZeppアプリで owner/repo を設定してください')
  const headers = {
    Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
    'User-Agent': 'zepp-gh-reader',
    'X-GitHub-Api-Version': '2022-11-28'
  }
  if (c.token) headers.Authorization = `Bearer ${c.token}`

  const res = await fetch({ url, method: 'GET', headers, timeout: 20000 })
  if (res.status === 401) throw new Error('トークンが無効です (401)')
  if (res.status === 403) throw new Error('アクセス拒否/回数制限 (403)')
  if (res.status === 404) throw new Error('見つかりません (404)\n非公開リポジトリならトークンが必要')
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`)
  return res
}

async function contents(path, raw) {
  const c = conf()
  const sub = encPath(path)
  let url = `${repoUrl(c)}/contents${sub ? '/' + sub : ''}`
  if (c.branch) url += `?ref=${encodeURIComponent(c.branch)}`
  return (await request(url, raw)).body
}

// ---- 作成日 ----
function ctKey() {
  const c = conf()
  return `ctime:${c.owner}/${c.repo}`
}

function loadCt() {
  if (!ctimes) {
    try {
      ctimes = JSON.parse(settingsLib.getItem(ctKey()) || '{}')
    } catch (e) {
      ctimes = {}
    }
  }
  return ctimes
}

function saveCt() {
  settingsLib.setItem(ctKey(), JSON.stringify(ctimes))
}

// そのパスを最初に追加したコミットの日時（フォルダは中身が最初に入った日時）
async function fetchCreated(path) {
  const c = conf()
  let url = `${repoUrl(c)}/commits?path=${encodeURIComponent(path)}&per_page=1`
  if (c.branch) url += `&sha=${encodeURIComponent(c.branch)}`
  let res = await request(url)
  const h = res.headers
  if (!h || (typeof h.get !== 'function' && !Object.keys(h).length)) {
    // ヘッダーが取れない環境では、直近100件の中で一番古いものを使う
    res = await request(url.replace('per_page=1', 'per_page=100'))
  } else {
    const m = String(header(res.headers, 'link') || '').match(/[?&]page=(\d+)[^>]*>;\s*rel="last"/)
    if (m) res = await request(`${url}&page=${m[1]}`)
  }
  const list = json(res.body)
  if (!Array.isArray(list) || !list.length) return 0
  const cm = list[list.length - 1].commit
  return Date.parse((cm.author && cm.author.date) || cm.committer.date) || 0
}

async function pool(items, n, fn) {
  let i = 0
  const worker = async () => {
    while (i < items.length) {
      const it = items[i++]
      try {
        await fn(it)
      } catch (e) {}
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
}

// 未取得の作成日を取ってきて保存する
async function fillCreated(paths) {
  const ct = loadCt()
  const missing = paths.filter((p) => !ct[p])
  if (!missing.length || !conf().token) return
  await pool(missing, 6, async (p) => {
    const t = await fetchCreated(p)
    if (t) ct[p] = t
  })
  saveCt()
}

// フォルダが先、それぞれ作成日の新しい順（不明は最後）、同じなら名前順
function sortItems(items) {
  items.sort((a, b) => b.d - a.d || (b.c || 0) - (a.c || 0) || a.n.localeCompare(b.n))
  return items
}

// ---- フォルダ一覧 ----
async function listDir(path, withDates) {
  const body = json(await contents(path, false))
  if (!Array.isArray(body)) throw new Error('フォルダではありません')
  const entries = body
    .filter((e) => !e.name.startsWith('.'))
    .filter((e) => e.type === 'dir' || (e.type === 'file' && TEXT_EXT.test(e.name)))
  if (withDates) await fillCreated(entries.map((e) => e.path))
  const ct = loadCt()
  const items = entries.map((e) => ({ n: e.name, d: e.type === 'dir' ? 1 : 0, c: ct[e.path] || 0 }))
  const pending = conf().token ? items.filter((i) => !i.c).length : 0
  return { items: sortItems(items), pending }
}

// ---- リポジトリ全体のファイル一覧（ランダム・オフライン用） ----
async function tree() {
  const c = conf()
  const key = `${c.owner}/${c.repo}@${c.branch}`
  if (treeCache && treeCache.key === key && Date.now() - treeCache.at < 5 * 60 * 1000) return treeCache.entries
  let ref = c.branch
  if (!ref) ref = json((await request(repoUrl(c))).body).default_branch
  const body = json((await request(`${repoUrl(c)}/git/trees/${encodeURIComponent(ref)}?recursive=1`)).body)
  const entries = (body.tree || [])
    .filter((e) => e.type === 'blob')
    .map((e) => e.path)
    .filter((p) => !p.split('/').some((s) => s.startsWith('.')))
  treeCache = { key, at: Date.now(), entries }
  return entries
}

function under(paths, folder) {
  return folder ? paths.filter((p) => p.startsWith(folder + '/')) : paths
}

async function randomNote(folder) {
  const notes = under(await tree(), folder).filter((p) => /\.(md|markdown)$/i.test(p))
  if (!notes.length) throw new Error('ノートがありません')
  return { path: notes[Math.floor(Math.random() * notes.length)] }
}

// オフライン用フォルダの全ファイル（folder からの相対パスと作成日）
async function offlineList() {
  const { offline } = conf()
  const files = under(await tree(), offline).filter((p) => TEXT_EXT.test(p))
  await fillCreated(files)
  const ct = loadCt()
  return {
    folder: offline,
    items: files.map((p) => ({ p: offline ? p.slice(offline.length + 1) : p, c: ct[p] || 0 }))
  }
}

async function rawText(path) {
  const body = await contents(path, true)
  return typeof body === 'string' ? body : JSON.stringify(body, null, 2)
}

async function readFile(path, page) {
  if (!cache[path]) {
    const isMd = /\.(md|markdown)$/i.test(path)
    cache[path] = paginate(parseMarkdown(await rawText(path), isMd))
  }
  const pages = cache[path]
  const p = Math.max(0, Math.min(page || 0, pages.length - 1))
  return { page: p, pages: pages.length, blocks: pages[p] }
}

AppSideService(
  BaseSideService({
    onInit() {},
    onRun() {},
    onDestroy() {},
    onSettingsChange({ key } = {}) {
      if (key && key.startsWith('ctime:')) return
      for (const k of Object.keys(cache)) delete cache[k]
      treeCache = null
      ctimes = null
    },
    onRequest(req, res) {
      const p = req.params || {}
      let job
      if (req.method === 'LIST') {
        job = listDir(p.path || '', !!p.dates)
      } else if (req.method === 'FILE') {
        if (p.reload) delete cache[p.path]
        job = readFile(p.path, p.page)
      } else if (req.method === 'RANDOM') {
        job = randomNote(p.path || '')
      } else if (req.method === 'OFFLINE_LIST') {
        job = offlineList()
      } else if (req.method === 'RAW') {
        job = rawText(p.path).then((text) => ({ text }))
      } else {
        res('unknown method')
        return
      }
      job
        .then((data) => res(null, data))
        .catch((e) => res(null, { error: (e && e.message) || String(e) }))
    }
  })
)
EOF

cat > setting/index.js <<'EOF'
// スマホの Zepp アプリ → GH Reader → 設定 で表示される画面
const FIELDS = [
  { key: 'owner', label: 'Owner (ユーザー名)', placeholder: 'othermarrow' },
  { key: 'repo', label: 'Repository', placeholder: 'Psychology' },
  { key: 'branch', label: 'Branch (空欄=デフォルト)', placeholder: 'main' },
  { key: 'offline', label: 'オフライン用フォルダ', placeholder: 'Abstract/report' }
]

AppSettingsPage({
  build(props) {
    const st = props.settingsStorage
    const rows = FIELDS.map((f) =>
      View({ style: { marginBottom: '14px' } }, [
        TextInput({
          label: f.label,
          placeholder: f.placeholder,
          value: st.getItem(f.key) || '',
          subStyle: { color: '#333', fontSize: '14px' },
          onChange: (val) => st.setItem(f.key, (val || '').trim())
        })
      ])
    )

    const hasToken = !!st.getItem('token')
    rows.push(
      View({ style: { marginBottom: '14px' } }, [
        TextInput({
          label: `Token ${hasToken ? '(設定済み・上書きで変更)' : '(非公開リポジトリ用)'}`,
          placeholder: 'github_pat_...',
          value: '',
          subStyle: { color: '#333', fontSize: '14px' },
          onChange: (val) => st.setItem('token', (val || '').trim())
        })
      ])
    )
    if (hasToken) {
      rows.push(
        Button({
          label: 'トークンを削除',
          style: { fontSize: '12px', borderRadius: '30px', background: '#D85E33', color: 'white' },
          onClick: () => st.setItem('token', '')
        })
      )
    }
    rows.push(
      Text(
        { paragraph: true, style: { fontSize: '12px', color: '#888', marginTop: '16px' } },
        'トークンは GitHub > Settings > Developer settings > Fine-grained tokens で、対象リポジトリのみ・Contents: Read-only で作成してください。作成日順の並べ替えにはトークンが必要です。'
      )
    )

    return View({ style: { padding: '12px 20px' } }, rows)
  }
})
EOF

cat > shared/markdown.js <<'EOF'
// Markdown -> 表示ブロック (Terminal/md_reader_server.py の parse_markdown を移植)
const INLINE = [
  [/!\[[^\]]*\]\([^)]*\)/g, ''],
  [/!\[\[[^\]]*\]\]/g, ''],
  [/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2'],
  [/\[\[([^\]]+)\]\]/g, '$1'],
  [/\[([^\]]+)\]\([^)]*\)/g, '$1'],
  [/\*\*(.+?)\*\*/g, '$1'],
  [/__(.+?)__/g, '$1'],
  [/\*(.+?)\*/g, '$1'],
  [/`([^`]+)`/g, '$1'],
  [/<[^>]+>/g, '']
]

function clean(text) {
  let t = text
  for (const [re, rep] of INLINE) t = t.replace(re, rep)
  return t.trim()
}

export function parseMarkdown(raw, isMarkdown = true) {
  const lines = String(raw).replace(/\r\n?/g, '\n').split('\n')
  const blocks = []

  if (!isMarkdown) {
    // md 以外はそのままコード表示
    let buf = []
    const flushCode = () => {
      if (buf.length) blocks.push({ t: 'code', x: buf.join('\n') })
      buf = []
    }
    for (const l of lines) {
      buf.push(l)
      if (buf.length >= 20) flushCode()
    }
    flushCode()
    return blocks
  }

  let i = 0
  // YAML frontmatter を読み飛ばす
  if (lines[0] && lines[0].trim() === '---') {
    const end = lines.indexOf('---', 1)
    if (end > 0) i = end + 1
  }

  let para = []
  const flush = () => {
    if (para.length) {
      const x = clean(para.join(' '))
      if (x) blocks.push({ t: 'p', x })
    }
    para = []
  }

  for (; i < lines.length; i++) {
    const line = lines[i].replace(/\t/g, '    ')
    const s = line.trim()

    if (/^(```|~~~)/.test(s)) {
      flush()
      const fence = s.slice(0, 3)
      const code = []
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence); i++) {
        code.push(lines[i])
      }
      if (code.length) blocks.push({ t: 'code', x: code.join('\n') })
      continue
    }
    if (!s) {
      flush()
      continue
    }
    let m = s.match(/^(#{1,6})\s+(.*)/)
    if (m) {
      flush()
      blocks.push({ t: 'h' + Math.min(m[1].length, 3), x: clean(m[2]) })
      continue
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(s)) {
      flush()
      blocks.push({ t: 'hr', x: '' })
      continue
    }
    const lv = Math.min(Math.floor((line.length - line.trimStart().length) / 2), 3)
    m = s.match(/^[-*+]\s+(\[[ xX]\]\s+)?(.*)/)
    if (m) {
      flush()
      const box = m[1] ? (/x/i.test(m[1]) ? '☑ ' : '☐ ') : ''
      blocks.push({ t: 'li', l: lv, x: box + clean(m[2]) })
      continue
    }
    m = s.match(/^(\d+)[.)]\s+(.*)/)
    if (m) {
      flush()
      blocks.push({ t: 'li', l: lv, n: m[1], x: clean(m[2]) })
      continue
    }
    m = s.match(/^>\s?(.*)/)
    if (m) {
      flush()
      const x = clean(m[1].replace(/^\[![^\]]+\]\s*/, ''))
      if (x) blocks.push({ t: 'q', x })
      continue
    }
    if (/^\|.*\|$/.test(s)) {
      flush()
      if (/^\|[\s:|-]+\|$/.test(s)) continue // 表の区切り行
      const cells = s.slice(1, -1).split('|').map((c) => clean(c)).filter(Boolean)
      blocks.push({ t: 'p', x: cells.join(' / ') })
      continue
    }
    para.push(s)
  }
  flush()
  return blocks
}

// ブロック列を BLE で送りやすいサイズに分割
export function paginate(blocks, maxChars = 1800) {
  const pages = []
  let cur = []
  let size = 0
  for (const b of blocks) {
    let x = b.x
    // 巨大ブロックは分割
    while (x.length > maxChars) {
      if (cur.length) {
        pages.push(cur)
        cur = []
        size = 0
      }
      pages.push([{ ...b, x: x.slice(0, maxChars) }])
      x = x.slice(maxChars)
    }
    if (!x) continue
    const nb = { ...b, x }
    if (size + x.length > maxChars && cur.length) {
      pages.push(cur)
      cur = []
      size = 0
    }
    cur.push(nb)
    size += x.length + 10
  }
  if (cur.length) pages.push(cur)
  return pages.length ? pages : [[{ t: 'p', x: '(空のファイル)' }]]
}
EOF

cat > shared/ui.js <<'EOF'
import * as hmUI from '@zos/ui'
import { getDeviceInfo } from '@zos/device'

export const { width: W, height: H } = getDeviceInfo()
export const MARGIN = Math.round(W * 0.09)
export const CW = W - MARGIN * 2

export function textHeight(text, size, width) {
  const r = hmUI.getTextLayout(text || ' ', { text_size: size, text_width: width, wrapped: 1 })
  return (r && r.height) || size + 8
}

// 折り返しテキストを置いて、次の y を返す
export function addText(y, text, opt = {}) {
  const size = opt.size || 28
  const x = MARGIN + (opt.indent || 0)
  const w = CW - (opt.indent || 0)
  const h = textHeight(text, size, w) + 6
  if (opt.bg !== undefined) {
    hmUI.createWidget(hmUI.widget.FILL_RECT, {
      x: x - 10, y: y - 6, w: w + 20, h: h + 12, radius: 12, color: opt.bg
    })
  }
  const t = hmUI.createWidget(hmUI.widget.TEXT, {
    x, y, w, h,
    text,
    text_size: size,
    color: opt.color === undefined ? 0xffffff : opt.color,
    align_h: opt.center ? hmUI.align.CENTER_H : hmUI.align.LEFT,
    text_style: hmUI.text_style.WRAP
  })
  return { widget: t, y: y + h + (opt.bg !== undefined ? 12 : 0) + (opt.gap === undefined ? 10 : opt.gap) }
}

export function addButton(y, text, onClick, color = 0x0366d6) {
  const bw = Math.round(W * 0.56)
  hmUI.createWidget(hmUI.widget.BUTTON, {
    x: (W - bw) / 2, y, w: bw, h: 64, radius: 32,
    normal_color: color, press_color: 0x444444,
    text, text_size: 28,
    click_func: onClick
  })
  return y + 64 + 14
}

export function formatDate(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  const z = (n) => (n < 10 ? '0' : '') + n
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
}

// 一覧の1行（名前 + 作成日）。タップで onClick。次の y を返す
export function addItem(y, { name, dir, date, color }, onClick) {
  const size = 28
  const label = (dir ? '▸ ' : '') + name
  const th = textHeight(label, size, CW - 24)
  const dh = date ? 26 : 0
  const h = th + dh + 30
  const bg = hmUI.createWidget(hmUI.widget.FILL_RECT, {
    x: MARGIN, y, w: CW, h, radius: 16, color: color !== undefined ? color : dir ? 0x1f2d3d : 0x222222
  })
  const t = hmUI.createWidget(hmUI.widget.TEXT, {
    x: MARGIN + 12, y: y + 15, w: CW - 24, h: th,
    text: label, text_size: size,
    color: dir ? 0x79c0ff : 0xffffff,
    text_style: hmUI.text_style.WRAP
  })
  const ws = [bg, t]
  if (date) {
    ws.push(hmUI.createWidget(hmUI.widget.TEXT, {
      x: MARGIN + 12, y: y + 15 + th, w: CW - 24, h: dh,
      text: date, text_size: 20, color: 0x8b949e
    }))
  }
  for (const w of ws) w.addEventListener(hmUI.event.CLICK_UP, onClick)
  return y + h + 12
}

// 丸画面の下端で最後の項目が切れないよう余白
export function addBottomSpace(y) {
  hmUI.createWidget(hmUI.widget.FILL_RECT, { x: 0, y, w: W, h: 140, color: 0x000000 })
}

export function toast(text) {
  hmUI.showToast({ text })
}

export function parseParams(params) {
  try {
    return JSON.parse(params || '{}') || {}
  } catch (e) {
    return {}
  }
}
EOF

cat > shared/offline.js <<'EOF'
// 時計の中（ミニアプリの /data）に保存したオフライン用データ
import { readFileSync, writeFileSync, rmSync, statSync } from '@zos/fs'

const INDEX = 'off_index.json'

export function readIndex() {
  try {
    const s = readFileSync({ path: INDEX, options: { encoding: 'utf8' } })
    return s ? JSON.parse(s) : null
  } catch (e) {
    return null
  }
}

export function readText(f) {
  try {
    return readFileSync({ path: f, options: { encoding: 'utf8' } }) || ''
  } catch (e) {
    return ''
  }
}

function removeGen(gen) {
  for (let i = 0; i < 10000; i++) {
    const f = `off_${gen}_${i}.txt`
    if (!statSync({ path: f })) break
    rmSync({ path: f })
  }
}

// スマホ経由でオフライン用フォルダを丸ごと取り込む。
// 世代を交互に使い、索引を書き終えてから古い世代を消すので、途中で切れても前のデータは残る
export async function sync(vm, onProgress) {
  const list = await vm.request({ method: 'OFFLINE_LIST', params: {} }, { timeout: 180000 })
  if (list.error) throw new Error(list.error)
  const old = readIndex()
  const gen = old && old.gen === 1 ? 0 : 1
  removeGen(gen) // 前回中断したときの残り
  const items = []
  for (let i = 0; i < list.items.length; i++) {
    const it = list.items[i]
    onProgress && onProgress(i + 1, list.items.length, it.p)
    const r = await vm.request({ method: 'RAW', params: { path: list.folder + '/' + it.p } }, { timeout: 120000 })
    if (r.error) throw new Error(`${it.p}: ${r.error}`)
    const f = `off_${gen}_${i}.txt`
    writeFileSync({ path: f, data: r.text, options: { encoding: 'utf8' } })
    items.push({ p: it.p, c: it.c, f })
  }
  writeFileSync({
    path: INDEX,
    data: JSON.stringify({ gen, folder: list.folder, at: Date.now(), items }),
    options: { encoding: 'utf8' }
  })
  if (old) removeGen(old.gen === 1 ? 1 : 0)
  return items.length
}
EOF

cat > page/index/index.js <<'EOF'
import * as hmUI from '@zos/ui'
import { push, replace } from '@zos/router'
import { BasePage } from '@zeppos/zml/base-page'
import { H, addText, addButton, addItem, addBottomSpace, formatDate, parseParams, toast } from '../../shared/ui'

Page(
  BasePage({
    state: { path: '', noDates: false, status: null },
    onInit(params) {
      const p = parseParams(params)
      this.state.path = p.path || ''
      this.state.noDates = !!p.nd
    },
    build() {
      const { path } = this.state
      const name = path ? path.split('/').pop() : 'GitHub'
      addText(40, name, { size: 30, color: 0x58a6ff, center: true, gap: 0 })
      this.state.status = addText(H / 2 - 30, '読み込み中…', { size: 28, color: 0x999999, center: true }).widget
      this.load()
    },
    load() {
      this.request({ method: 'LIST', params: { path: this.state.path } })
        .then((data) => {
          if (data.error) return this.showError(data.error)
          this.render(data.items || [], data.pending || 0)
        })
        .catch((e) => this.showError('スマホと通信できません\n' + ((e && e.message) || '')))
    },
    showError(msg) {
      this.state.status.setProperty(hmUI.prop.TEXT, msg)
      let y = addButton(H / 2 + 110, '再読込', () => replace({ url: 'page/index/index', params: JSON.stringify({ path: this.state.path }) }))
      addButton(y, 'オフラインで読む', () => push({ url: 'page/offline/index', params: '{}' }), 0x2d333b)
    },
    // 作成日が未取得のものがあれば取りに行き、取れたら並べ直す
    fetchDates() {
      this.request({ method: 'LIST', params: { path: this.state.path, dates: 1 } }, { timeout: 180000 })
        .then((data) => {
          if (data.error) return toast(data.error)
          replace({ url: 'page/index/index', params: JSON.stringify({ path: this.state.path, nd: 1 }) })
        })
        .catch(() => toast('作成日を取得できませんでした'))
    },
    render(items, pending) {
      this.state.status.setProperty(hmUI.prop.VISIBLE, false)
      let y = 100
      if (pending && !this.state.noDates) {
        y = addText(y, `作成日を取得中… (${pending}件)`, { size: 22, color: 0xd29922, center: true }).y
        this.fetchDates()
      }
      if (!this.state.path) {
        y = addItem(y, { name: 'オフライン (端末内)', color: 0x2d333b }, () =>
          push({ url: 'page/offline/index', params: '{}' })
        )
      }
      if (!items.length) {
        y = addText(y + 20, '(表示できるファイルなし)', { size: 28, color: 0x999999, center: true }).y
      }
      for (const it of items) {
        const full = this.state.path ? this.state.path + '/' + it.n : it.n
        y = addItem(y, { name: it.n, dir: it.d, date: formatDate(it.c) }, () => {
          if (it.d) push({ url: 'page/index/index', params: JSON.stringify({ path: full }) })
          else push({ url: 'page/viewer/index', params: JSON.stringify({ path: full, page: 0 }) })
        })
      }
      y = addButton(y + 10, 'ランダムノート', () => this.random(), 0x6e40c9)
      addBottomSpace(y)
    },
    random() {
      toast('選んでいます…')
      this.request({ method: 'RANDOM', params: { path: this.state.path } })
        .then((data) => {
          if (data.error) return toast(data.error)
          push({ url: 'page/viewer/index', params: JSON.stringify({ path: data.path, page: 0 }) })
        })
        .catch(() => toast('スマホと通信できません'))
    }
  })
)
EOF

cat > page/viewer/index.js <<'EOF'
import * as hmUI from '@zos/ui'
import { replace } from '@zos/router'
import { BasePage } from '@zeppos/zml/base-page'
import { H, MARGIN, CW, addText, addButton, addBottomSpace, parseParams } from '../../shared/ui'
import { parseMarkdown, paginate } from '../../shared/markdown'
import { readText } from '../../shared/offline'

const STYLE = {
  h1: { size: 36, color: 0xffd33d, gap: 16 },
  h2: { size: 32, color: 0x79c0ff, gap: 12 },
  h3: { size: 30, color: 0x56d364, gap: 10 },
  p: { size: 28, color: 0xffffff, gap: 14 },
  li: { size: 28, color: 0xe6e6e6, gap: 8 },
  q: { size: 26, color: 0xbbbbbb, gap: 12, bg: 0x1a1a2a },
  code: { size: 22, color: 0x7ee787, gap: 14, bg: 0x161b22 }
}

Page(
  BasePage({
    state: { path: '', page: 0, f: '', status: null },
    onInit(params) {
      const p = parseParams(params)
      this.state.path = p.path || ''
      this.state.page = p.page || 0
      this.state.reload = !!p.reload
      this.state.f = p.f || '' // 指定があれば時計内のファイル（オフライン）
    },
    build() {
      const name = this.state.path.split('/').pop().replace(/\.md$/i, '')
      this.state.titleY = addText(50, name, { size: 24, color: 0x8b949e, center: true, gap: 0 }).y
      this.state.status = addText(H / 2 - 30, '読み込み中…', { size: 28, color: 0x999999, center: true }).widget
      if (this.state.f) this.loadLocal()
      else this.load()
    },
    loadLocal() {
      const { f, path, page } = this.state
      const text = readText(f)
      if (!text) return this.showError('端末内のファイルを読めません\nもう一度同期してください', false)
      const pages = paginate(parseMarkdown(text, /\.(md|markdown)$/i.test(path)))
      const p = Math.max(0, Math.min(page, pages.length - 1))
      this.render({ blocks: pages[p], page: p, pages: pages.length })
    },
    load() {
      const { path, page, reload } = this.state
      this.request({ method: 'FILE', params: { path, page, reload } })
        .then((data) => {
          if (data.error) return this.showError(data.error)
          this.render(data)
        })
        .catch((e) => this.showError('スマホと通信できません\n' + ((e && e.message) || '')))
    },
    showError(msg, retry = true) {
      this.state.status.setProperty(hmUI.prop.TEXT, msg)
      if (retry) addButton(H / 2 + 110, '再読込', () => this.go(this.state.page, true))
    },
    go(page, reload = false) {
      const { path, f } = this.state
      replace({ url: 'page/viewer/index', params: JSON.stringify({ path, f, page, reload }) })
    },
    render({ blocks, page, pages }) {
      this.state.status.setProperty(hmUI.prop.VISIBLE, false)
      let y = Math.max(this.state.titleY + 16, 110)

      if (page > 0) y = addButton(y, '◀ 前へ', () => this.go(page - 1), 0x333333)

      for (const b of blocks) {
        if (b.t === 'hr') {
          hmUI.createWidget(hmUI.widget.FILL_RECT, { x: MARGIN, y: y + 8, w: CW, h: 2, color: 0x444444 })
          y += 26
          continue
        }
        const s = STYLE[b.t] || STYLE.p
        let text = b.x
        let indent = 0
        if (b.t === 'li') {
          indent = (b.l || 0) * 24
          text = (b.n ? b.n + '. ' : '・') + b.x
        }
        y = addText(y, text, { size: s.size, color: s.color, gap: s.gap, indent, bg: s.bg }).y
      }

      y += 10
      addText(y, `${page + 1} / ${pages}`, { size: 24, color: 0x8b949e, center: true, gap: 10 })
      y += 44
      if (page < pages - 1) y = addButton(y, '次へ ▶', () => this.go(page + 1))
      addBottomSpace(y)
    }
  })
)
EOF

cat > page/offline/index.js <<'EOF'
import * as hmUI from '@zos/ui'
import { push, replace } from '@zos/router'
import { setPageBrightTime } from '@zos/display'
import { BasePage } from '@zeppos/zml/base-page'
import { addText, addButton, addItem, addBottomSpace, formatDate, parseParams, toast } from '../../shared/ui'
import { readIndex, sync } from '../../shared/offline'

Page(
  BasePage({
    state: { path: '', syncing: false, status: null },
    onInit(params) {
      this.state.path = parseParams(params).path || ''
    },
    build() {
      const idx = readIndex()
      const { path } = this.state
      const title = path ? path.split('/').pop() : (idx && idx.folder.split('/').pop()) || 'オフライン'
      let y = addText(40, title, { size: 30, color: 0x58a6ff, center: true, gap: 0 }).y
      y = Math.max(y + 10, 100)

      if (!path) {
        const info = idx ? `端末内 ${idx.items.length}件・同期 ${formatDate(idx.at)}` : 'まだ同期していません'
        y = addText(y, info, { size: 22, color: 0x8b949e, center: true }).y
        this.state.status = addText(y, ' ', { size: 22, color: 0xd29922, center: true, gap: 0 }).widget
        y += 34
        y = addButton(y, '同期する', () => this.doSync(), 0x238636)
      }
      if (!idx) {
        addText(y + 10, 'スマホとつながっているときに「同期する」を押すと、設定したフォルダを時計に保存します。', {
          size: 24, color: 0x999999
        })
        return
      }

      // このフォルダ直下のフォルダとファイル
      const prefix = path ? path + '/' : ''
      const dirs = {}
      const files = []
      for (const it of idx.items) {
        if (!it.p.startsWith(prefix)) continue
        const rest = it.p.slice(prefix.length)
        const i = rest.indexOf('/')
        if (i >= 0) {
          // フォルダの作成日 = 中身で一番古いもの
          const d = rest.slice(0, i)
          const c = it.c || Infinity
          dirs[d] = dirs[d] === undefined ? c : Math.min(dirs[d], c)
        } else {
          files.push(it)
        }
      }
      const dirList = Object.keys(dirs).map((n) => ({ n, c: dirs[n] === Infinity ? 0 : dirs[n] }))
      dirList.sort((a, b) => b.c - a.c || a.n.localeCompare(b.n))
      files.sort((a, b) => (b.c || 0) - (a.c || 0) || a.p.localeCompare(b.p))

      for (const d of dirList) {
        y = addItem(y, { name: d.n, dir: 1, date: formatDate(d.c) }, () =>
          push({ url: 'page/offline/index', params: JSON.stringify({ path: prefix + d.n }) })
        )
      }
      for (const it of files) {
        y = addItem(y, { name: it.p.slice(prefix.length), date: formatDate(it.c) }, () => this.open(it))
      }
      const notes = idx.items.filter((it) => it.p.startsWith(prefix) && /\.(md|markdown)$/i.test(it.p))
      if (notes.length) {
        y = addButton(y + 10, 'ランダムノート', () => this.open(notes[Math.floor(Math.random() * notes.length)]), 0x6e40c9)
      }
      addBottomSpace(y)
    },
    open(it) {
      push({ url: 'page/viewer/index', params: JSON.stringify({ path: it.p, f: it.f, page: 0 }) })
    },
    doSync() {
      if (this.state.syncing) return
      this.state.syncing = true
      setPageBrightTime({ brightTime: 600000 }) // 同期中は画面を消さない
      const st = this.state.status
      st.setProperty(hmUI.prop.TEXT, '一覧を取得中…')
      sync(this, (i, n) => st.setProperty(hmUI.prop.TEXT, `同期中 ${i} / ${n}`))
        .then((n) => {
          toast(`${n}件を保存しました`)
          replace({ url: 'page/offline/index', params: '{}' })
        })
        .catch((e) => {
          this.state.syncing = false
          toast('同期に失敗しました')
          st.setProperty(hmUI.prop.TEXT, '失敗: ' + ((e && e.message) || 'スマホと通信できません'))
        })
    }
  })
)
EOF

base64 -d > assets/common.r/icon.png <<'EOF'
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
SUVORK5CYII=
EOF

echo "作成完了: $APP"
echo "次: cd ~/gh-reader && npm i && zeus preview"
