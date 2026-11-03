import { makeGamePage } from '../../shared/gamepage'
import { createGame } from '../../shared/engines/yacho'

// 色は HTML 版のレベルごとの色と同じ。停電中は暗くなる
// [背景, 文字, 明るい文字, 薄い文字, 枠, 方角キー, 警告]
const RAW = {
  t0: ['15130a', 'e0cd7a', 'fff3b8', '8f8250', '3f3a22', '1d1b10', 'e88a6a'],
  tm: ['efe6cf', '5a4630', '2a1f12', '8c7a5e', 'd6c8a6', 'e6dbbd', '9b3d1f'],
  t1: ['111315', 'b9c1c6', 'eef2f4', '6d777d', '2a3034', '171b1e', 'e3a07a'],
  t2: ['121015', 'b9aec8', 'ebe4f5', '6f6680', '2c2735', '18151d', 'e3a07a'],
  t3: ['160a09', 'd9a49a', 'ffe0d8', '8e5e56', '3c2320', '1e0f0e', 'ff8f6e'],
  t4: ['e9e7e0', '31363a', '0b0d0f', '727a80', 'c4c2ba', 'dcdad2', '9b2d1f'],
  t5: ['13070a', 'd8b67a', 'fbe6b8', '8b6a44', '3b1e22', '1c0b0f', 'ff8f7a'],
  t6: ['000000', '7a7a7a', 'b5b5b5', '4a4a4a', '1c1c1c', '080808', 'b07070'],
  t7: ['040c15', '8fb4ca', 'd6ecf8', '4f6f84', '16283a', '07131f', 'e3a07a'],
  dark: ['050505', '4a4a4a', '8a8a8a', '333333', '1a1a1a', '0c0c0c', 'b07070']
}

// 確かめたときの、ネオンの二行（HTML 版と同じ）
const TRUISM = {
  wall: ['LOOK. COUNT. THEN JUMP.', '見る。数える。それから、跳ぶ。'],
  crate: ['WHAT ARRIVES UNSEEN LEAVES UNSEEN.', '見ていないあいだに来たものは、見ていないあいだに去る。'],
  arms: ['TWO WARNINGS CAN BOTH BE TRUE.', '食い違う二つの忠告が、どちらも正しいことがある。'],
  growler: ['FIND THE HEAD BEFORE YOU THROW.', '投げる前に、頭がどこかを見る。'],
  smiler: ['THE DARK IS NOT ALWAYS THE DANGER.', '危ないのは、暗さのほうとは限らない。'],
  wretch: ['A SCREAM CAN BE A REQUEST.', '叫びは、頼みであることがある。'],
  faceling: ['THE RULE IS NOT THE ONE IN FRONT OF YOU.', '一般論は、目の前の一人のことではない。'],
  skin: ['DOUBT WHAT YOU SAW, NOT HOW THEY LOOK.', '疑うなら、見た目ではなく、見たことで。'],
  hound: ['DO NOT SHOW YOUR BACK TO WHAT YOU FEAR.', '怖いものに、背中を見せない。'],
  mahjong: ['NOT EVERYTHING NEEDS FINISHING.', '終わらせなくていいものもある。'],
  dark: ['THE THING IN THE DARK WAS AFRAID TOO.', '暗闇の何かも、怖がっていた。'],
  archive: ['WRITE WHAT YOU SAW.', '見たことを、書く。'],
  chair: ['LEAVE SOMETHING FOR THE NEXT ONE.', '次に来る人のために、置いていく。'],
  dive: ['BEYOND HERE, NO ONE HAS LOOKED.', 'ここから先は、まだ誰も見ていない。']
}

Page(makeGamePage({
  id: 'yacho',
  createGame,
  theme: (s) => RAW[s.blackout ? 'dark' : s.theme] || RAW.t0,
  info: (s) => ({
    text: [s.level + '　' + s.cls, '記録 ' + s.rec].concat(s.th ? [s.th] : []).concat(s.inj ? ['けが' + s.inj] : []).join('　'),
    warn: !!(s.hot || s.inj)
  }),
  // 確かめたり終わったりしたとき、その一言を出す
  flash: (fx) => {
    const f = fx.find((e) => (e.type === 'verify' || e.type === 'end') && TRUISM[e.k])
    return f ? TRUISM[f.k] : null
  },
  common: [
    ['持ち物', 'inventory'], ['待つ', 'wait'],
    ['耳をすます', 'listen'], ['寝る', 'sleep'],
    ['野帳', 'book'], ['遊び方', 'help']
  ]
}))
