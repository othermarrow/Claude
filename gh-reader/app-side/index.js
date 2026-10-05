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
