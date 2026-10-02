import * as hmUI from '@zos/ui'
import { push } from '@zos/router'
import { BasePage } from '@zeppos/zml/base-page'
import { W, H, MARGIN, CW, addText, addButton, textHeight, toast } from '../../shared/ui'

function parse(params) {
  try {
    return JSON.parse(params || '{}')
  } catch (e) {
    return {}
  }
}

Page(
  BasePage({
    state: { path: '', status: null },
    onInit(params) {
      this.state.path = parse(params).path || ''
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
          this.render(data.items || [])
        })
        .catch((e) => this.showError('スマホと通信できません\n' + ((e && e.message) || '')))
    },
    showError(msg) {
      this.state.status.setProperty(hmUI.prop.TEXT, msg)
      addButton(H / 2 + 110, '再読込', () => {
        this.state.status.setProperty(hmUI.prop.TEXT, '読み込み中…')
        this.load()
      })
    },
    render(items) {
      this.state.status.setProperty(hmUI.prop.VISIBLE, false)
      if (!items.length) {
        addText(H / 2 - 30, '(表示できるファイルなし)', { size: 28, color: 0x999999, center: true })
        return
      }
      let y = 100
      const size = 28
      for (const it of items) {
        const label = (it.d ? '▸ ' : '') + it.n
        const h = textHeight(label, size, CW - 24) + 30
        const bg = hmUI.createWidget(hmUI.widget.FILL_RECT, {
          x: MARGIN, y, w: CW, h, radius: 16, color: it.d ? 0x1f2d3d : 0x222222
        })
        const t = hmUI.createWidget(hmUI.widget.TEXT, {
          x: MARGIN + 12, y: y + 15, w: CW - 24, h: h - 30,
          text: label, text_size: size,
          color: it.d ? 0x79c0ff : 0xffffff,
          text_style: hmUI.text_style.WRAP
        })
        const full = this.state.path ? this.state.path + '/' + it.n : it.n
        const open = () => {
          if (it.d) push({ url: 'page/index/index', params: JSON.stringify({ path: full }) })
          else push({ url: 'page/viewer/index', params: JSON.stringify({ path: full, page: 0 }) })
        }
        bg.addEventListener(hmUI.event.CLICK_UP, open)
        t.addEventListener(hmUI.event.CLICK_UP, open)
        y += h + 12
      }
      // 丸画面の下端で最後の項目が切れないよう余白
      hmUI.createWidget(hmUI.widget.FILL_RECT, { x: 0, y, w: W, h: 120, color: 0x000000 })
    }
  })
)
