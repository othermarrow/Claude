import * as hmUI from '@zos/ui'
import { getDeviceInfo } from '@zos/device'

export const { width: W, height: H } = getDeviceInfo()
export const MARGIN = Math.round(W * 0.09)
export const CW = W - MARGIN * 2

export function textHeight(text, size, width) {
  const r = hmUI.getTextLayout(text || ' ', { text_size: size, text_width: width, wrapped: 1 })
  return (r && r.height) || size + 8
}

// 作った部品を覚えておき、画面を作り直すときにまとめて消す
export class Canvas {
  constructor() {
    this.items = []
  }

  add(type, opt) {
    const w = hmUI.createWidget(type, opt)
    this.items.push(w)
    return w
  }

  clear() {
    for (const w of this.items) hmUI.deleteWidget(w)
    this.items = []
  }

  // 折り返しテキストを置いて、次の y を返す
  text(y, text, opt = {}) {
    const size = opt.size || 26
    const x = MARGIN + (opt.indent || 0)
    const w = CW - (opt.indent || 0)
    const h = textHeight(text, size, w) + 4
    this.add(hmUI.widget.TEXT, {
      x, y, w, h,
      text,
      text_size: size,
      color: opt.color === undefined ? 0xffffff : opt.color,
      align_h: opt.center ? hmUI.align.CENTER_H : hmUI.align.LEFT,
      text_style: hmUI.text_style.WRAP
    })
    return y + h + (opt.gap === undefined ? 6 : opt.gap)
  }

  button(x, y, w, h, text, onClick, opt = {}) {
    return this.add(hmUI.widget.BUTTON, {
      x, y, w, h,
      radius: opt.radius === undefined ? Math.min(20, h / 2) : opt.radius,
      normal_color: opt.color === undefined ? 0x333333 : opt.color,
      press_color: 0x777777,
      text,
      text_size: opt.size || 24,
      color: opt.textColor === undefined ? 0xffffff : opt.textColor,
      click_func: onClick
    })
  }
}
