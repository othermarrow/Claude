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
