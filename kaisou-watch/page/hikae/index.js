import { makeGamePage } from '../../shared/gamepage'
import { createGame } from '../../shared/engines/hikae'
import { HIKAE } from '../../shared/themes'

// 区画ごとの色は、HTML 版の CSS と同じ（HIKAE[区画]）
Page(makeGamePage({
  id: 'hikae',
  createGame,
  theme: (s) => HIKAE[s.area] || HIKAE[''],
  info: (s) => ({
    text: ['記録 ' + s.rec].concat(s.label ? ['「' + s.label + '」'] : []).join('　'),
    warn: s.stage >= 2
  }),
  common: [
    ['持ち物', 'inventory'], ['待つ', 'wait'],
    ['やめる', 'stop'], ['尋ねる', 'ask'],
    ['耳をすます', 'listen'], ['わからない', 'dunno']
  ]
}))
