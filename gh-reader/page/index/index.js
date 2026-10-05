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
