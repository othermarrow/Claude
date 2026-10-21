// 端末の夜：ゲーム本体。画面の部品は使わないので、Node でもそのまま動く。
// 四つの記録（フロッピー）と、その外側の「現実」の地の文でできている。

export const EPS = [
  { n: 1, name: '観測所', sub: 'テキストアドベンチャー' },
  { n: 2, name: '手順書', sub: '気象観測装置 KS-2' },
  { n: 3, name: '周波数', sub: '受信機' },
  { n: 4, name: '応答', sub: '無線' }
]

export const ENDINGS = [
  ['hikitsugi', '引き継ぎ'],
  ['kagami', '鏡'],
  ['mumei', '無名'],
  ['sawa', '沢'],
  ['yuki', '雪']
]
const GOOD = ['hikitsugi', 'kagami', 'mumei']

const PROLOGUE = [
  '冬。閉鎖された山の観測所に、あなたは一人で来た。',
  '二十年前の今夜、あなたはこの山で道に迷い、ここの無線に助けられた。',
  '二階の当直室に、古い端末が残っている。電源を入れると、まだ動いた。',
  '机の上に、フロッピーが四枚。'
]

const INTRO = {
  1: ['一枚目のフロッピーには、鉛筆で「観測所」と書いてある。', '差し込むと、黒い画面に緑の文字が流れはじめた。'],
  2: ['二枚目は「手順書」。', '画面に、観測装置の操作盤が描かれた。机の横では、本物の KS-2 が埃をかぶっている。'],
  3: ['三枚目、「周波数」。', '受信機の目盛りが画面に出る。壁の時計は、2時40分を指したまま動いていない。'],
  4: ['四枚目には、何も書かれていない。', '差し込むと、画面が赤くなった。', '《応答》']
}

const OUTRO = {
  1: ['画面の文字が止まった。', 'そのとき、あなたの手首の時計が震えた。ゲームの中の電話と、同じ間合いで。', '階下の電話は、二十年前に線を切られている。'],
  2: ['気づくと、本物の KS-2 のランプも緑になっていた。', '電源コードは、抜けたままなのに。'],
  3: ['応答ボタンを押せば、話せる。', '二十年前の、あの夜と。', 'あなたは四枚目のフロッピーを手に取った。']
}

const ENDING_TEXT = {
  hikitsugi: [
    ['「……宇田川さん。ありがとう。忘れません」', 'voice'],
    ['交信が切れた。窓の外で、雪がやんでいる。', ''],
    ['机の引き出しに、当直日誌が残っていた。最後の頁に、震えた字。', ''],
    ['「12月22日 05:50 遭難者 無事。名を問われ、前任の当直の名を答える。宇田川」', 'print'],
    ['宇田川さんも、誰かの名前を借りていた。', ''],
    ['あなたは日誌の次の行に、今日の日付を書いた。', 'bright']
  ],
  kagami: [
    ['「……え。それ、ぼくの名前です」', 'voice'],
    ['無線は、それきり黙った。窓の外が明るい。', ''],
    ['二十年前、無線の向こうの人は、何と名乗ったのだったか。', ''],
    ['ずっと思い出せなかった。いまは、思い出せる気がする。', 'bright']
  ],
  mumei: [
    ['「……わかりました。じゃあ、朝まで起きていてくれた人、って覚えておきます」', 'voice'],
    ['雪がやんだ。', ''],
    ['あなたは端末の電源を切り、四枚のフロッピーを鞄に入れた。', ''],
    ['名前は、なくてもよかったのだと思う。', 'bright']
  ],
  sawa: [
    ['「……わかった。下りてみる」', 'voice'],
    ['水の音が大きくなり、交信はそこで途切れた。', ''],
    ['手順書の記録紙に、書いてあったのに。', 'warn'],
    ['端末に《記録 4 を、もう一度》と出ている。', 'dim']
  ],
  yuki: [
    ['無線は、朝まで黙っていた。', ''],
    ['目を覚ますと、窓の外は真っ白だった。', ''],
    ['あの夜、宇田川さんは一度も眠らなかったはずだ。', 'warn'],
    ['端末に《記録 4 を、もう一度》と出ている。', 'dim']
  ]
}

// ---------------- 記録 1：観測所（端末の中のテキストアドベンチャー） ----------------

const E1_ROOM = {
  up: { name: '二階・当直室', desc: '当直室。机の上に古い端末。窓の外は横なぐりの雪。机には引き出しがある。下へ階段。' },
  down: { name: '一階・廊下', desc: '暗い廊下。壁に黒い電話。奥に「無線室」の扉。玄関には長靴。上へ階段。' },
  radio: { name: '無線室', desc: '狭い無線室。大きな無線機と、壁に貼られた地図。' }
}

function e1Objects(e) {
  const list = []
  const add = (id, name, acts) => list.push({ id, name, acts })
  if (e.room === 'up') {
    add('window', '窓', [['look', '見る']])
    add('terminal', '端末', [['look', '見る']])
    add('drawer', '引き出し', e.drawer ? [['look', '見る']] : [['open', '開ける']])
    if (e.drawer) add('diary', '当直日誌', [['read', '読む']])
    if (e.drawer && !e.key) add('key', '鍵', [['take', '取る']])
    add('stairs', '階段', [['down', '下りる']])
  } else if (e.room === 'down') {
    add('phone', '電話', e.ring && !e.phone ? [['take', '受話器を取る', '受話器を取る'], ['look', '見る']] : [['look', '見る']])
    add('door', '無線室の扉', e.door ? [['enter', '入る', '無線室に入る']] : [['open', '開ける']])
    add('boots', '長靴', [['look', '見る']])
    add('entrance', '玄関', [['open', '開ける']])
    add('stairs', '階段', [['up', '上る']])
  } else {
    add('radio', '無線機', [['on', '電源を入れる', '無線機の電源を入れる'], ['look', '見る']])
    add('map', '地図', [['look', '見る']])
    add('out', '廊下', [['go', '出る', '廊下に出る']])
  }
  return list
}

// 返り値は、表に出す文の配列。[文, 種類]
function e1Do(g, objId, actId) {
  const e = g.s.e1
  const L = []
  const say = (t, c) => L.push([t, c || ''])
  const k = objId + ':' + actId
  e.turns++
  switch (k) {
    case 'window:look':
      say('雪が横から降っている。ときどき、尾根の線が見える。')
      say('東の端に、小さな赤い灯がひとつ。')
      break
    case 'terminal:look':
      say('古い端末。画面には、いまあなたが読んでいるのと同じ文章が出ている。')
      break
    case 'drawer:open':
      e.drawer = true
      say('引き出しを開けた。当直日誌と、小さな鍵が入っている。')
      break
    case 'drawer:look':
      say(e.key ? '当直日誌が入っている。' : '当直日誌と、小さな鍵。')
      break
    case 'diary:read':
      e.diary = true
      say('「12月21日。当直、宇田川。」', 'print')
      say('「夕方から吹雪。入山届が一件、下山の連絡なし。」', 'print')
      say('「今夜は、無線の前を離れないこと。」', 'print')
      break
    case 'key:take':
      e.key = true
      say('鍵を取った。札に「無線室」。')
      break
    case 'stairs:down':
      e.room = 'down'
      say('階段を下りた。')
      say(E1_ROOM.down.desc)
      if (e.diary && !e.ring) {
        e.ring = true
        say('電話が鳴った。', 'warn')
        g.fx.push('double')
      }
      break
    case 'stairs:up':
      e.room = 'up'
      say('階段を上った。')
      say(E1_ROOM.up.desc)
      break
    case 'phone:look':
      if (e.ring && !e.phone) say('黒い電話が鳴りつづけている。', 'warn')
      else if (e.phone) say('受話器は元に戻した。もう鳴らない。')
      else say('黒い電話。鳴っていない。')
      break
    case 'phone:take':
      e.phone = true
      say('受話器を取った。風の音。')
      say('「……そこに、いますか」', 'voice')
      say('若い声。どこかで聞いたことがある。それきり、切れた。')
      break
    case 'door:open':
      if (!e.key) {
        say('鍵がかかっている。')
      } else {
        e.door = true
        say('鍵を開けた。無線室の扉が、きしんで開いた。')
      }
      break
    case 'door:enter':
      e.room = 'radio'
      say(E1_ROOM.radio.desc)
      break
    case 'boots:look':
      say('雪のついた長靴。まだ濡れている。')
      say('誰かが、さっきまで外にいた。')
      break
    case 'entrance:open':
      say('雪に押されて、玄関は開かない。')
      break
    case 'map:look':
      say('尾根と沢の地図。尾根の東の端に、赤い丸。「避難小屋」。')
      say('沢のほうには、×印がいくつも書き込まれている。')
      break
    case 'out:go':
      e.room = 'down'
      say('廊下に出た。')
      break
    case 'radio:look':
      say('大きな無線機。目盛りの針は、左に倒れたまま。')
      break
    case 'radio:on':
      if (!e.diary) say('電源を入れた。雑音だけ。何を待てばいいのか、まだわからない。')
      else if (!e.phone) say('電源を入れた。雑音だけ。廊下で電話が鳴っている。')
      else {
        say('電源を入れた。ザ……という音。')
        say('目盛りの針が、58.1 のあたりで震えている。')
        say('《記録 1 おわり。次の記録を入れてください》', 'bright')
        e.done = true
        g.fx.push('strong')
      }
      break
    default:
      say('何も起こらない。')
  }
  // 電話が鳴っているあいだは、廊下にいると知らせる
  if (e.ring && !e.phone && e.room === 'down' && k !== 'stairs:down' && k !== 'phone:look') {
    say('電話が鳴りつづけている。', 'dim')
  }
  return L
}

function e1Global(g, id) {
  const e = g.s.e1
  const L = []
  e.turns++
  if (id === 'look') {
    L.push([E1_ROOM[e.room].desc, ''])
  } else if (id === 'wait') {
    L.push(['時間がたつ。雪の音だけがする。', ''])
    if (e.ring && !e.phone) L.push(['どこかで電話が鳴っている。', 'warn'])
  } else if (id === 'raise') {
    e.raised = (e.raised || 0) + 1
    if (e.raised === 1) {
      L.push(['画面から目を上げた。', 'dim'])
      L.push(['当直室。机の上に古い端末。窓の外は横なぐりの雪。', 'dim'])
      L.push(['……ゲームの中と、同じだ。', 'bright'])
    } else {
      L.push(['画面から目を上げた。部屋は、さっきと同じだ。', 'dim'])
    }
  }
  return L
}

// ---------------- 記録 2：手順書（KS-2） ----------------

const MANUAL = [
  ['KS-2 取扱手順（当直用）', '1. 主電源を入れる。ランプが緑になれば正常。'],
  ['手順 2', '2. 校正。ダイヤルを「3」に合わせ、校正ボタンを押す。'],
  ['手順 3', '3. 切替を「風」にし、記録ボタンで日誌に書き写す。'],
  ['手順 4', '4. 切替を「温」にし、同じく記録する。'],
  ['手順 5', '5. 切替を「圧」にし、同じく記録する。'],
  ['手順 6', '6. 紙送りボタンを押し、記録紙を取り出す。'],
  ['手順 7', '7. 異常な表示が出ても、主電源は切らない。無線を確かめること。当直を離れないこと。']
]
const MANUAL_EXTRA = ['裏表紙（手書き）', '記録紙の、最後の行を信じろ。　宇田川']
const MODES = ['風', '温', '圧']
const READ = ['北北西 18m/s', '−14℃', '962hPa']

function e2Screen(e) {
  if (!e.power) return ''
  if (e.done) return 'キ コ エ マ ス カ'
  if (!e.cal) return 'KS-2 READY\n校正してください　DIAL ' + e.dial
  return MODES[e.mode] + '　' + READ[e.mode]
}

function e2Press(g, btn) {
  const e = g.s.e2
  const L = []
  const say = (t, c) => L.push([t, c || ''])
  if (e.done) return L
  if (btn === 'power') {
    if (!e.power) {
      e.power = true
      say('主電源を入れた。ランプが緑になった。')
    } else if (e.cal) {
      say('手順書の 7 を思い出した。主電源は切らない。', 'warn')
    } else {
      e.power = false
      say('主電源を切った。')
    }
  } else if (btn === 'dminus' || btn === 'dplus') {
    e.dial = (e.dial + (btn === 'dplus' ? 1 : 9)) % 10
    say('ダイヤルを ' + e.dial + ' に合わせた。', 'dim')
  } else if (btn === 'cal') {
    if (!e.power) say('電源が入っていない。')
    else if (e.cal) say('校正は済んでいる。')
    else if (e.dial !== 3) {
      say('表示：E3 校正値ちがい', 'warn')
      g.fx.push('light')
    } else {
      e.cal = true
      say('校正した。表示が落ち着いた。')
    }
  } else if (btn === 'mode') {
    e.mode = (e.mode + 1) % 3
    say('切替を「' + MODES[e.mode] + '」にした。', 'dim')
  } else if (btn === 'rec') {
    if (!e.power || !e.cal) say('表示が定まらない。先に校正する。')
    else if (e.rec[e.mode]) say('「' + MODES[e.mode] + '」は書き写してある。')
    else {
      e.rec[e.mode] = true
      say('日誌に書き写した：' + MODES[e.mode] + '　' + READ[e.mode])
      if (e.rec.every(Boolean)) say('三つとも書き写した。', 'bright')
    }
  } else if (btn === 'feed') {
    if (!e.rec.every(Boolean)) {
      say('紙が少し出て、止まった。まだ書き写していない値がある。')
    } else {
      e.done = true
      e.extra = true
      say('記録紙が出てきた。', '')
      say('1999.12.22　02:40', 'print')
      say('風　北北西　18', 'print')
      say('温　−14', 'print')
      say('圧　962', 'print')
      say('沢へ下りるな　尾根を東へ　赤い灯まで', 'bright')
      say('最後の行だけ、手書きだ。あなたの字に、よく似ている。')
      say('表示が勝手に動き出した。「キ コ エ マ ス カ」', 'warn')
      say('《記録 2 おわり》', 'bright')
      g.fx.push('double')
    }
  }
  return L
}

// ---------------- 記録 3：周波数 ----------------

// 周波数は 0.1 刻みの整数で持つ（500 = 50.0）
const STATIONS = [
  { id: 'wx', f: 437, name: '山岳気象', text: '……こちらは山岳気象。今夜半から、尾根筋で猛吹雪。視界はほぼ、ありません。沢筋は、雪崩に注意……' },
  { id: 'num', f: 472, name: '数', text: '……ろく。さん。ろく。くりかえします。ろく、さん、ろく。避難小屋。' },
  { id: 'uda', f: 525, name: '宇田川', text: '宇田川です。今夜は、無線の前から離れません。誰かが聞いているなら、わたしはここにいます。' },
  { id: 'voice', f: 581, name: '声', text: '……きこえますか……沢の音がします……どっちへ行けば……' }
]
export const F_MIN = 400
export const F_MAX = 600

function stationsOn(e) {
  const three = ['wx', 'num', 'uda'].every(id => e.found[id])
  return STATIONS.filter(st => st.id !== 'voice' || three)
}

function hash(a, b) {
  let h = (a * 374761393 + b * 668265263) | 0
  h = (h ^ (h >>> 13)) * 1274126177
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// 近いほど読める。遠いと雑音
function garble(text, d, f) {
  const p = Math.min(0.95, d * 0.28)
  let out = ''
  for (let i = 0; i < text.length; i++) out += hash(i, f) < p ? (hash(f, i) < 0.5 ? 'ザ' : '…') : text[i]
  return out
}

function e3Info(e) {
  let best = null
  let bd = 99
  for (const st of stationsOn(e)) {
    const d = Math.abs(st.f - e.f)
    if (d < bd) { bd = d; best = st }
  }
  const strength = best && bd <= 6 ? Math.max(0, 1 - bd / 6) : 0
  let frag = ''
  if (best && bd === 0) frag = best.text
  else if (best && bd <= 3) frag = garble(best.text, bd, e.f)
  else frag = hash(e.f, 7) < 0.5 ? 'ザ――――' : '……ザ……'
  return { freq: (e.f / 10).toFixed(1), strength, frag, near: best && bd <= 3 ? best : null, dist: bd }
}

function e3Tune(g, delta) {
  const e = g.s.e3
  const L = []
  if (e.done) return L
  e.f = Math.max(F_MIN, Math.min(F_MAX, e.f + delta))
  const info = e3Info(e)
  if (info.dist === 0 && info.near) {
    const st = info.near
    g.fx.push('strong')
    if (!e.found[st.id]) {
      e.found[st.id] = true
      L.push([info.freq + '　' + st.name, 'bright'])
      L.push([st.text, st.id === 'voice' ? 'voice' : ''])
      if (st.id === 'voice') {
        e.done = true
        L.push(['応答ボタンが、赤く光った。', 'warn'])
        L.push(['《記録 3 おわり》', 'bright'])
      } else if (stationsOn(e).length === 4) {
        L.push(['目盛りの上のほうで、何かが目を覚ました気がする。', 'dim'])
      }
    }
  } else if (info.dist === 1) {
    g.fx.push('light')
  }
  return L
}

// ---------------- 記録 4：応答 ----------------

const TALK = {
  home: ['「家の人は？」', '「……家には、誰もいない。だから、山なら誰にも迷惑かけないと思った。……でも、あなたが起きててくれてる。迷惑、かけてるね」'],
  why: ['「どうして、山に？」', '「……わからない。ただ、遠くへ行きたかった。上のほうへ。……変だよね。上に行っても、何もないのに」'],
  morning: ['「朝になったら、どうする？」', '「朝になったら……下りる。下りて、それから……考える。考えるって、いま言えた。少し前は、言えなかった」']
}
const CLOCKS = ['03:50', '04:40', '05:20']

function e4View(e) {
  const v = { clock: e.clock, prompt: [], choices: [], dial: false }
  const P = (t, c) => v.prompt.push([t, c || 'voice'])
  const C = (label, id) => v.choices.push({ label, id })
  switch (e.step) {
    case 'hello':
      P('「……きこえますか。誰か、いますか」')
      C('「きこえる。ここにいる」', 'yes')
      C('（黙っている）', 'silent')
      break
    case 'route':
      P('「よかった……。道がわからない。下のほうで、水の音がする。沢に下りれば、ふもとに出られる？」')
      C('「沢へ下りて」', 'sawa')
      C('「その場で待って」', 'wait')
      C('「尾根を東へ。赤い灯まで」', 'east')
      break
    case 'lock':
      P('「赤い灯……見えた。小屋だ。……でも、扉に鍵がかかってる。数字が三つの鍵」')
      v.dial = true
      break
    case 'inside':
      P('「入れた……。ストーブがある。毛布も。……すごく、眠い」')
      C('「眠っちゃだめだ。話をしよう」', 'talk')
      C('「少し休んで」', 'rest')
      break
    case 'quiet':
      P('……無線の向こうが、静かになった。', '')
      C('「起きて！」', 'wake')
      C('（そのままにする）', 'leave')
      break
    case 'talk':
      P('「……何を話す？」')
      for (const k of Object.keys(TALK)) if (!e.talks.includes(k)) C(TALK[k][0], 'talk:' + k)
      break
    case 'drowsy':
      P('あなたのまぶたも、重くなってきた。無線の向こうは静かだ。', '')
      C('起きている', 'stay')
      C('少し目を閉じる', 'close')
      break
    case 'dawn':
      P('「……窓が、白くなってきた。朝だ」')
      P('「あの。名前を、教えてください。覚えておきたいから」')
      C('「宇田川」', 'uda')
      C('自分の名前を言う', 'self')
      C('言わないでおく', 'none')
      break
  }
  return v
}

function e4Choose(g, id) {
  const e = g.s.e4
  const L = []
  const say = (t, c) => L.push([t, c || ''])
  const me = t => say(t, 'cmd')
  const end = k => { e.ending = k; e.done = true; g.fx.push(GOOD.includes(k) ? 'strong' : 'double') }
  switch (e.step + ':' + id) {
    case 'hello:yes':
      me('「きこえる。ここにいる」')
      e.step = 'route'
      break
    case 'hello:silent':
      me('（黙っている）')
      e.sil++
      if (e.sil >= 2) end('yuki')
      else say('「……誰も、いないのか」', 'voice')
      break
    case 'route:sawa':
      me('「沢へ下りて」')
      end('sawa')
      break
    case 'route:wait':
      me('「その場で待って」')
      say('「……寒い。動かないと、だめな気がする」', 'voice')
      break
    case 'route:east':
      me('「尾根を東へ。赤い灯まで」')
      say('「……東。わかった。歩いてみる」', 'voice')
      e.clock = '03:10'
      e.step = 'lock'
      break
    case 'inside:talk':
    case 'quiet:wake':
      me(id === 'talk' ? '「眠っちゃだめだ。話をしよう」' : '「起きて！」')
      if (id === 'wake') say('「……っ。ごめん。起きた」', 'voice')
      e.step = 'talk'
      break
    case 'inside:rest':
      me('「少し休んで」')
      say('「……うん……」', 'voice')
      e.step = 'quiet'
      break
    case 'quiet:leave':
      me('（そのままにする）')
      end('yuki')
      break
    case 'drowsy:stay':
      me('起きている')
      say('頬をつねった。窓の外で、雪の音。', '')
      e.drowsy = true
      e.step = 'talk'
      break
    case 'drowsy:close':
      me('少し目を閉じる')
      end('yuki')
      break
    case 'dawn:uda':
      me('「宇田川」')
      end('hikitsugi')
      break
    case 'dawn:self':
      me('自分の名前を言った。')
      end('kagami')
      break
    case 'dawn:none':
      me('「名前は、いいよ」')
      end('mumei')
      break
    default:
      if (e.step === 'talk' && id.startsWith('talk:')) {
        const k = id.slice(5)
        if (!TALK[k] || e.talks.includes(k)) break
        me(TALK[k][0])
        say(TALK[k][1], 'voice')
        e.clock = CLOCKS[e.talks.length]
        e.talks.push(k)
        if (e.talks.length === 3) {
          e.clock = '05:50'
          e.step = 'dawn'
        } else if (e.talks.length === 2 && !e.drowsy) e.step = 'drowsy'
      }
  }
  return L
}

function e4Send(g) {
  const e = g.s.e4
  const L = []
  if (e.step !== 'lock') return L
  const code = e.code.join('')
  L.push(['「' + code + '」', 'cmd'])
  if (code === '636') {
    L.push(['「……開いた！」', 'voice'])
    e.clock = '03:30'
    e.step = 'inside'
    g.fx.push('light')
  } else {
    e.wrong++
    L.push(['「……開かない」', 'voice'])
    if (e.wrong >= 3) L.push(['（受信機の、数を読む放送を思い出す）', 'dim'])
  }
  return L
}

// ---------------- 全体 ----------------

function freshEp(n) {
  if (n === 1) return { room: 'up', drawer: false, key: false, diary: false, ring: false, phone: false, door: false, raised: 0, turns: 0, done: false }
  if (n === 2) return { power: false, dial: 0, cal: false, mode: 0, rec: [false, false, false], done: false, extra: false, page: 0 }
  if (n === 3) return { f: 500, found: {}, done: false }
  return { step: 'hello', sil: 0, wrong: 0, code: [0, 0, 0], talks: [], drowsy: false, clock: '02:40', done: false, ending: null }
}

function fresh() {
  return { v: 1, phase: 'prologue', cur: 0, cleared: [false, false, false, false], endings: {}, log: [], past: [] }
}

export function createGame(io) {
  const g = { s: null, fx: [] }

  function save() {
    try { io.saveState(g.s) } catch (e) { /* 残せなくても遊べる */ }
  }
  function show(lines, keepPast) {
    g.s.log = lines.map(l => (Array.isArray(l) ? { ja: l[0], cls: l[1] || '' } : { ja: l, cls: '' }))
    if (!keepPast) g.s.past = []
  }
  function act(fn) {
    g.fx = []
    const L = fn()
    if (L) show(L, true)
    save()
  }
  function record(cmd) {
    g.s.past.push(cmd)
    if (g.s.past.length > 3) g.s.past.shift()
  }

  return {
    EPS,
    ENDINGS,
    MANUAL,
    MANUAL_EXTRA,
    MODES,
    get fx() { return g.fx },
    get state() { return g.s },

    start(reset) {
      g.fx = []
      let s = null
      if (!reset) {
        try { s = io.loadState() } catch (e) { s = null }
      }
      g.s = s && s.v === 1 ? s : fresh()
      if (g.s.phase === 'prologue') show(PROLOGUE)
      save()
    },

    phase() { return g.s.phase },
    cur() { return g.s.cur },
    log() { return g.s.log },
    past() { return g.s.past },
    unlocked(n) { return n === 1 || g.s.cleared[n - 2] },
    cleared(n) { return g.s.cleared[n - 1] },
    endings() { return ENDINGS.filter(([k]) => g.s.endings[k]) },

    // 起動の地の文を読み終えた
    toMenu() {
      g.fx = []
      g.s.phase = 'menu'
      g.s.cur = 0
      show([])
      save()
    },

    // フロッピーを入れる（記録の頭から）
    insert(n) {
      if (!this.unlocked(n)) return
      g.fx = []
      g.s.cur = n
      g.s.phase = 'intro'
      g.s['e' + n] = freshEp(n)
      show(INTRO[n])
      save()
    },

    begin() {
      const n = g.s.cur
      g.fx = []
      g.s.phase = 'play'
      if (n === 1) show([['観測所', 'bright'], [E1_ROOM.up.desc, '']])
      else if (n === 2) show([['KS-2 気象観測装置', 'bright'], ['操作盤と、手順書。手順書の 1 から始める。', '']])
      else if (n === 3) show([['受信機', 'bright'], ['目盛りを回して、聞こえるものを探す。近づくと、手首が震える。', '']])
      else show([['02:40', 'dim']])
      save()
    },

    // 記録を終えて、外側の地の文へ
    finish() {
      const n = g.s.cur
      g.fx = []
      if (n === 4) {
        const k = g.s.e4.ending
        g.s.endings[k] = true
        if (GOOD.includes(k)) g.s.cleared[3] = true
        g.s.phase = 'outro'
        show(ENDING_TEXT[k].concat([['結末：' + ENDINGS.find(x => x[0] === k)[1], 'bright']]))
      } else {
        g.s.cleared[n - 1] = true
        g.s.phase = 'outro'
        show(OUTRO[n])
      }
      save()
    },

    epDone() {
      const n = g.s.cur
      const e = g.s['e' + n]
      return !!(e && e.done)
    },
    ep() { return g.s['e' + g.s.cur] },

    // 記録 1
    e1Room() { return E1_ROOM[g.s.e1.room].name },
    e1Objects() { return e1Objects(g.s.e1) },
    e1Act(obj, a) {
      record(a[2] || obj.name + 'を' + a[1])
      act(() => e1Do(g, obj.id, a[0]))
    },
    e1Global(id, label) {
      record(label)
      act(() => e1Global(g, id))
    },

    // 記録 2
    e2Screen() { return e2Screen(g.s.e2) },
    e2Press(btn) { act(() => e2Press(g, btn)) },
    e2Page(d) {
      const e = g.s.e2
      const n = MANUAL.length + (e.extra ? 1 : 0)
      e.page = (e.page + d + n) % n
      save()
    },
    e2Manual() {
      const e = g.s.e2
      return e.page < MANUAL.length ? MANUAL[e.page] : MANUAL_EXTRA
    },

    // 記録 3
    e3Info() { return e3Info(g.s.e3) },
    e3Tune(d) {
      g.fx = []
      const L = e3Tune(g, d)
      if (L.length) show(L, true)
      save()
      return L.length > 0
    },
    e3Found() { return STATIONS.filter(st => g.s.e3.found[st.id]).map(st => (st.f / 10).toFixed(1) + ' ' + st.name) },

    // 記録 4
    e4View() { return e4View(g.s.e4) },
    e4Choose(id) { act(() => e4Choose(g, id)) },
    e4Dial(i, d) {
      const c = g.s.e4.code
      c[i] = (c[i] + d + 10) % 10
      save()
    },
    e4Send() { act(() => e4Send(g)) }
  }
}
