// 起動画面：階層目録の札（記録 01・02・04・06）。押すと、そのゲームの画面が開く。
// 札の下に、結末の数・いちばん深いところ・何周目か（ゲームの側が、1 手ごとに書いたもの）。
import * as hmUI from '@zos/ui'
import { scrollTo } from '@zos/page'
import { push } from '@zos/router'
import { setWakeUpRelaunch } from '@zos/display'
import { W, Canvas, CW } from '../shared/ui'
import { loadMeta } from '../shared/store'

const BG = 0x07090b
const TEXT = 0xc9d1d3
const DIM = 0x6f7a7e

// [id, 記録の番号, 題, 副題, 一行, 札の色]
const CARDS = [
  ['noclip', '記録 01', 'ノークリップ', 'NOCLIP', 'すり抜けた先に、誰かの手引きが一冊。', 0x00f5d4],
  ['yacho', '記録 02', '野帳', 'FIELD NOTES', '見たものを、ただ書きとめる。', 0x3fa9ff],
  ['kuuran2', '記録 04', '空欄_2', 'BLANK_2', '白い部屋。欄を埋めるのは、誰の字か。', 0xe8f0ff],
  ['hikae', '記録 06', '控室', 'ANTEROOM', '署名した覚えのない同意書の、控えが一枚。', 0xbfe8d0]
]

Page({
  state: {},

  onInit() {
    const st = this.state
    st.canvas = new Canvas()
    try { setWakeUpRelaunch({ relaunch: true }) } catch (e) { /* なくてもよい */ }
  },

  build() {
    this.state.built = true
    this.render()
  },

  // ゲームから戻ったときに、札の要約を読み直す
  onShow() {
    if (this.state.built) this.render()
  },

  open(id) {
    try { push({ url: 'page/' + id + '/index' }) } catch (e) { hmUI.showToast({ text: '開けませんでした' }) }
  },

  render() {
    const st = this.state
    const cv = st.canvas
    cv.clear()
    const bg = cv.add(hmUI.widget.FILL_RECT, { x: 0, y: 0, w: W, h: 480, color: BG })
    let y = 44
    y = cv.text(y, '階層目録', { size: 34, color: TEXT, center: true, gap: 0 })
    y = cv.text(y, 'CATALOGUE OF FLOORS', { size: 16, color: DIM, center: true, gap: 18 })

    for (const [id, no, ja, en, p, c] of CARDS) {
      const m = loadMeta(id)
      const cardH = m ? 150 : 128
      cv.add(hmUI.widget.FILL_RECT, { x: 24, y, w: W - 48, h: cardH, color: 0x10161a, radius: 18 })
      cv.add(hmUI.widget.FILL_RECT, { x: 24, y, w: 8, h: cardH, color: c })
      cv.add(hmUI.widget.TEXT, { x: 48, y: y + 8, w: CW, h: 24, text: no + '　' + en, text_size: 17, color: DIM })
      cv.add(hmUI.widget.TEXT, { x: 48, y: y + 32, w: CW, h: 38, text: ja, text_size: 30, color: c })
      cv.add(hmUI.widget.TEXT, { x: 48, y: y + 72, w: CW, h: 28, text: p, text_size: 19, color: TEXT })
      if (m) {
        const line = [m.total ? '結末 ' + m.endings + '/' + m.total : '', m.deepest ? '最深 ' + m.deepest : '', m.runs > 1 ? m.runs + '周目' : '']
          .filter(Boolean).join('　')
        if (line) cv.add(hmUI.widget.TEXT, { x: 48, y: y + 104, w: CW, h: 26, text: line, text_size: 18, color: DIM })
      }
      // 札ぜんたいを押せるように、透明のボタンを重ねる
      cv.add(hmUI.widget.BUTTON, {
        x: 24, y, w: W - 48, h: cardH, radius: 18, normal_color: 0x000000, press_color: 0x1f2a30, alpha: 0, text: '',
        click_func: () => this.open(id)
      })
      y += cardH + 14
    }
    y = cv.text(y + 4, '記録 03「未定稿」と 05「蔵守」は、まだ時計にありません（スマホの階層目録で遊べます）。', { size: 17, color: DIM, center: true, gap: 8 })
    bg.setProperty(hmUI.prop.MORE, { x: 0, y: 0, w: W, h: Math.max(480, y + 80) })
    scrollTo({ y: 0 })
  }
})
