import { makeGamePage } from '../../shared/gamepage'
import { createGame } from '../../shared/engines/kuramori'

// 場所と時刻ごとの色は、HTML 版の表と同じ（エンジンの側が選んで、s.pal で渡す）。
// PAL は { s 背景, w 文字, b 明るい字, d 淡い字, f 罫, k キー, wa 警告 }（#つきの 16 進）
const hex = (c) => String(c || '#000000').replace('#', '')
Page(makeGamePage({
  id: 'kuramori',
  createGame,
  theme: (s) => {
    const P = s.pal || { s: '#120e09', w: '#e3d3b4', b: '#fff7e8', d: '#8c7a5e', f: '#3a3023', k: '#1b150e', wa: '#ff5b4a' }
    return [hex(P.s), hex(P.w), hex(P.b), hex(P.d), hex(P.f), hex(P.k), hex(P.wa)]
  },
  info: (s) => ({ text: s.info || '', warn: false }),
  common: [
    ['手がかり', 'notes'], ['ひとつ戻す', 'undo'],
    ['持ち物', 'inventory'], ['待つ', 'wait'],
    ['耳をすます', 'listen'], ['ヒント', 'hint']
  ]
}))
