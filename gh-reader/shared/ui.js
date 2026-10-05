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
