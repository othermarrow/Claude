import { makeGamePage } from '../../shared/gamepage'
import { createGame } from '../../shared/engines/miteiko'
import { MITEIKO } from '../../shared/themes'

// 層ごとの色は、HTML 版の CSS と同じ。灯りがないときは、暗闇の色
Page(makeGamePage({
  id: 'miteiko',
  createGame,
  theme: (s) => MITEIKO[s.dark ? 'dark' : s.lv] || MITEIKO[''],
  info: (s) => ({ text: '灯 ' + s.lamp + '　点 ' + s.score, warn: !!s.low }),
  common: [
    ['持ち物', 'inventory'], ['待つ', 'wait'],
    ['耳をすます', 'listen'], ['寝る', 'sleep'],
    ['わからない', 'dunno'], ['遊び方', 'help']
  ]
}))
