import * as hmUI from '@zos/ui'
import { replace } from '@zos/router'
import { BasePage } from '@zeppos/zml/base-page'
import { W, H, MARGIN, CW, addText, addButton } from '../../shared/ui'

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
    state: { path: '', page: 0, status: null },
    onInit(params) {
      let p = {}
      try {
        p = JSON.parse(params || '{}')
      } catch (e) {}
      this.state.path = p.path || ''
      this.state.page = p.page || 0
      this.state.reload = !!p.reload
    },
    build() {
      const name = this.state.path.split('/').pop().replace(/\.md$/i, '')
      this.state.titleY = addText(50, name, { size: 24, color: 0x8b949e, center: true, gap: 0 }).y
      this.state.status = addText(H / 2 - 30, '読み込み中…', { size: 28, color: 0x999999, center: true }).widget
      this.load()
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
    showError(msg) {
      this.state.status.setProperty(hmUI.prop.TEXT, msg)
      addButton(H / 2 + 110, '再読込', () => this.go(this.state.page, true))
    },
    go(page, reload = false) {
      replace({ url: 'page/viewer/index', params: JSON.stringify({ path: this.state.path, page, reload }) })
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
      // 丸画面の下端で切れないよう余白
      hmUI.createWidget(hmUI.widget.FILL_RECT, { x: 0, y, w: W, h: 140, color: 0x000000 })
    }
  })
)
