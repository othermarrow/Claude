import { makeGamePage } from '../../shared/gamepage'
import { createGame } from '../../shared/engines/noclip'
import { NOCLIP } from '../../shared/themes'

// 階層ごとの色は、HTML 版の CSS と同じ（NOCLIP[階層]）。血の色のときは赤みの色に
Page(makeGamePage({
  id: 'noclip',
  createGame,
  theme: (s) => NOCLIP[s.lv] || NOCLIP[''],
  info: (s) => ({
    text: [s.level, s.cls, 'SAN ' + s.san].concat(s.bat != null ? ['電池' + s.bat] : []).join('　'),
    warn: !!s.low
  }),
  common: [
    ['持ち物', 'inventory'], ['待つ', 'wait'],
    ['耳をすます', 'listen'], ['すり抜ける', 'noclip'],
    ['わからない', 'dunno'], ['遊び方', 'help']
  ]
}))
