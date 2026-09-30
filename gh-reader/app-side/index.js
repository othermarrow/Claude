import { BaseSideService, settingsLib } from '@zeppos/zml/base-side'
import { parseMarkdown, paginate } from '../shared/markdown'

const API = 'https://api.github.com'
const TEXT_EXT = /\.(md|markdown|txt|py|js|ts|json|sh|ya?ml|csv|html?|css|toml|ini|log)$/i
const cache = {} // path -> pages (サイドサービスが生きている間だけ)

function conf() {
  return {
    owner: (settingsLib.getItem('owner') || 'othermarrow').trim(),
    repo: (settingsLib.getItem('repo') || 'Psychology').trim(),
    branch: (settingsLib.getItem('branch') || '').trim(),
    token: (settingsLib.getItem('token') || '').trim()
  }
}

function encPath(path) {
  return path
    .split('/')
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
    .join('/')
}

async function gh(path, raw) {
  const c = conf()
  if (!c.owner || !c.repo) throw new Error('スマホのZeppアプリで owner/repo を設定してください')
  const sub = encPath(path)
  let url = `${API}/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents${sub ? '/' + sub : ''}`
  if (c.branch) url += `?ref=${encodeURIComponent(c.branch)}`
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
  return res.body
}

async function listDir(path) {
  let body = await gh(path, false)
  if (typeof body === 'string') body = JSON.parse(body)
  if (!Array.isArray(body)) throw new Error('フォルダではありません')
  const items = body
    .filter((e) => !e.name.startsWith('.'))
    .filter((e) => e.type === 'dir' || (e.type === 'file' && TEXT_EXT.test(e.name)))
    .map((e) => ({ n: e.name, d: e.type === 'dir' ? 1 : 0 }))
  items.sort((a, b) => b.d - a.d || a.n.localeCompare(b.n))
  return items
}

async function readFile(path, page) {
  if (!cache[path]) {
    let body = await gh(path, true)
    if (typeof body !== 'string') body = JSON.stringify(body, null, 2)
    const isMd = /\.(md|markdown)$/i.test(path)
    cache[path] = paginate(parseMarkdown(body, isMd))
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
    onSettingsChange() {
      for (const k of Object.keys(cache)) delete cache[k]
    },
    onRequest(req, res) {
      const p = req.params || {}
      let job
      if (req.method === 'LIST') {
        job = listDir(p.path || '').then((items) => ({ items, repo: conf().repo }))
      } else if (req.method === 'FILE') {
        if (p.reload) delete cache[p.path]
        job = readFile(p.path, p.page)
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
