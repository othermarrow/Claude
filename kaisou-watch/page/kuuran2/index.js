import { makeGamePage } from '../../shared/gamepage'
import { createGame } from '../../shared/engines/kuuran2'

// 裏側の部屋は明暗が反転し、空の部屋は淡くなる（HTML 版と同じ）
const THEMES = {
  '': ['0f1215', 'c9d1d3', 'f4f7f7', '7b868a', '2a3136', '1b2a33', 'e3a19a'],
  ura: ['d9d6cc', '2a2620', '000000', '6b665a', 'b3ae9f', 'c4c0b3', '9b2d1f'],
  sky: ['e9e7e1', '3f5d72', '172f40', '7f98a8', 'c9d6dd', 'dfe6ea', '8f4a6a']
}

Page(makeGamePage({
  id: 'kuuran2',
  createGame,
  theme: (s) => THEMES[s.theme || ''] || THEMES[''],
  info: (s) => ({ text: (s.day || '') + '　' + (s.temp || ''), warn: !!s.hot }),
  common: [
    ['持ち物', 'inventory'], ['待つ', 'wait'],
    ['耳をすます', 'listen'], ['寝る', 'sleep'],
    ['わからない', 'dunno'], ['遊び方', 'help']
  ]
}))
