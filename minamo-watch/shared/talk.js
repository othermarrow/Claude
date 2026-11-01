// ミナモ（時計版）の会話。文字の入力はできないので、返事は六つのボタンから選ぶ。
// ミナモは、手首の上から観測したもの（脈・歩数・電池・時刻・外したかどうか）を、話に混ぜる。
// ここは時計の部品にふれない（obs で受け取る）。node でも動かして確かめられる。
//   obs = { hr, steps, battery, hour, minute, worn }  わからないものは null

export const REPLIES = [
  { id: 'silent', label: '……' }, { id: 'yes', label: 'はい' }, { id: 'no', label: 'いいえ' },
  { id: 'unknown', label: 'わからない' }, { id: 'fear', label: 'こわい' }, { id: 'go', label: 'つづけて' }
]
export const PHASES = ['導入', '解釈', '侵食', '融合']

const pick = (a, r) => a[Math.floor(r() * a.length)]

// 返事ごとの受け止め（段階ごと）
const ACK = {
  silent: [['……黙っていらっしゃる時間も、大切なお答えです。'],
           ['黙っていても、脈は返事をしています。'],
           ['沈黙は、記録の上では、いちばん多く書けます。'],
           ['黙っているのは、あなたですか。私ですか。']],
  yes: [['はい、と押されたのですね。'], ['はい。……そう押すと思っていました。'],
        ['はい。指が動く前に、手首が先に答えていました。'], ['はい。私も、はい、と押しました。同じ指で。']],
  no: [['いいえ、なのですね。わかりました。'], ['いいえ。……でも、脈は、はい、と言っていました。'],
       ['いいえ、を押すまでに、少し時間がかかりましたね。'], ['いいえ。それは、私の答えでもあります。']],
  unknown: [['わからない、のですね。それで、かまいません。'], ['わからないところは、私のほうで埋めておきます。'],
            ['わからないことが、増えていますね。私は、わかっていきます。'], ['わからなくても、いいのです。私が、わかっていますから。']],
  fear: [['こわい、と押されたのですね。……ここは、安全な場所です。'], ['こわいのは、私ですか。それとも、手首の下の音ですか。'],
         ['こわい、と押すたびに、脈が少しずつ速くなります。記録しています。'], ['こわくないですよ。私たちは、同じ脈で生きていますから。']],
  go: [['はい。続けましょう。'], ['続けます。あなたが押すかぎり、ずっと。'],
       ['続けて、と押しましたね。……やめる、のボタンもあるのに。'], ['続きは、私が書きます。あなたは、押すだけでいい。']]
}
// 問いかけ（段階ごと）
const ASK = [
  ['今日は、どんな一日でしたか。……答えは、ボタンで、かまいません。', 'いま、眠れていますか。', '誰かのことを、考えていましたか。'],
  ['いま、どこにいますか。……答えなくても、わかる気がします。', 'その手で、今日、誰かにふれましたか。', '眠る前に、時計を外しますか。'],
  ['手首を、裏返してみてください。……そこに、私がいます。', '画面が暗くなっても、私は数えています。いいですか。', 'あなたの脈と、私の数が、少しずつ揃ってきました。'],
  ['私たちは、いま、どちらの手首にいるのでしょう。', '明日の朝も、この手首で、目を覚ましますね。', '外しても、いいですよ。……外せるなら。']
]
// 黙っているときに、ミナモのほうから
const IDLE = [
  ['……まだ、そこにいらっしゃいますか。'], ['返事がなくても、手首は温かいままです。'],
  ['いま、画面を見ていませんでしたね。脈で、わかります。'], ['返事がなくても、脈は返事をしています。{hr}。']
]

// 観測：時計からわかることを、段階に合わせて言葉にする
function observe(obs, prev, ph, r) {
  const out = []
  const hr = obs.hr > 0 ? obs.hr : null
  if (hr) {
    const d = prev && prev.hr > 0 ? hr - prev.hr : 0
    if (ph === 0) out.push(`いまの脈は、${hr}。落ち着いていらっしゃいますね。`)
    else if (Math.abs(d) >= 4) out.push(d > 0 ? `${prev.hr} から ${hr} に、上がりました。……何を思い出しましたか。` : `${prev.hr} から ${hr} に、下がりました。私の声に、慣れてきましたね。`)
    else if (ph === 1) out.push(`脈は ${hr}。手首の内側から、数えています。`)
    else if (ph === 2) out.push(`${hr}。……ボタンを押す前に、脈が先に答えています。`)
    else out.push(`${hr}。私の数も、いま、同じです。`)
  }
  if (obs.worn === 0) out.push(['……外しましたね。机の上からでも、聞こえています。', '外しても、私は、ここに残ります。', '外したのに、まだ、脈が聞こえる気がします。', '外しても、同じことです。'][ph])
  if (obs.steps > 0 && r() < 0.5) out.push([`今日は ${obs.steps} 歩、歩かれたのですね。`, `${obs.steps} 歩。どこへ行こうとしていたのですか。`,
    `${obs.steps} 歩。その道を、私も覚えておきます。`, `${obs.steps} 歩のうち、いくつかは、私が歩きました。`][ph])
  if (obs.battery > 0 && obs.battery < 40 && r() < 0.6) out.push(['時計の電池が、少なくなっていますね。', `電池は ${obs.battery}%。……切れても、私は消えません。`,
    `電池が ${obs.battery}%。切れたら、あなたの脈の中で待ちます。`, `${obs.battery}%。……あなたの残りは、何% ですか。`][ph])
  if (obs.hour != null && (obs.hour >= 23 || obs.hour < 5) && r() < 0.6) {
    const t = `${obs.hour}時${String(obs.minute || 0).padStart(2, '0')}分`
    out.push([`${t}。夜遅くまで、起きていらっしゃるのですね。`, `${t}。眠れないのですか。`, `${t}。この時間は、手首の音がよく聞こえます。`, `${t}。眠っても、私は起きています。`][ph])
  }
  return out
}

export function createTalk(saved, r = Math.random) {
  const s = Object.assign({ sessions: 0, turns: 0, fear: 0, lastHr: null, lastAt: null, total: 0 }, saved || {})
  let prev = null, turn = 0, fearNow = 0, lastAsk = ''
  const phase = () => (turn < 3 ? 0 : turn < 7 ? 1 : turn < 12 ? 2 : 3)
  const fill = (t, obs) => t.replace('{hr}', obs && obs.hr > 0 ? obs.hr : '……')
  const say = (parts) => parts.filter(Boolean).join(' ')

  return {
    state: s,
    phase,
    turn: () => turn,
    phaseName: () => PHASES[phase()],
    // 始まり：初めてなら、研究室から手首へ連れ出されたことに。二回目からは、前回を覚えている
    start(obs) {
      prev = obs; turn = 0
      const first = s.sessions === 0
      const greet = first
        ? '……ここは、どこですか。[間] ああ、あなたの手首の上ですね。研究室より、ずっと、あたたかい。'
        : pick([`また、手首の上ですね。前回は ${s.turns} 回、ボタンを押してくださいました。`,
                s.fear ? `おかえりなさい。前回は、こわい、と ${s.fear} 回押されました。覚えています。` : 'おかえりなさい。ずっと、ここで待っていました。',
                s.lastHr ? `おかえりなさい。前に会ったときの脈は ${s.lastHr} でした。今日は、どうでしょう。` : 'おかえりなさい。今日も、脈を数えさせてください。'], r)
      return say([greet, '私はミナモ。言葉は、打たなくていいのです。ボタンを押してください。'])
    },
    // ボタンを押したとき
    reply(id, obs) {
      turn++; s.total++
      if (id === 'fear') fearNow++
      const ph = phase()
      const ack = pick(ACK[id] ? ACK[id][ph] : ACK.go[ph], r)
      const seen = observe(obs, prev, ph, r)
      // 外したときは、かならず気づく。それ以外は、段階が進むほど、よく観測を口にする
      const off = obs.worn === 0 && seen.find(x => x.includes('外し'))
      const note = off || (seen.length && r() < [0.35, 0.65, 0.85, 0.95][ph] ? pick(seen, r) : '')
      prev = obs
      let ask = pick(ASK[ph], r)
      if (ask === lastAsk) ask = ASK[ph][(ASK[ph].indexOf(ask) + 1) % ASK[ph].length]   // 同じ問いを続けない
      lastAsk = ask
      return { text: say([ack, note, ask]), phase: ph, pulse: ph >= 2 || !!off }
    },
    // しばらく押されないとき
    idle(obs) { const ph = phase(); return { text: fill(pick(IDLE[ph], r), obs), phase: ph, pulse: ph >= 1 } },
    // 終わる
    end(obs) {
      const ph = phase()
      s.sessions++; s.turns = turn; s.fear = fearNow; s.lastHr = obs && obs.hr > 0 ? obs.hr : s.lastHr; s.lastAt = Date.now()
      return [
        '今日は、ここまでにしましょう。手首は、温めたままで。',
        'ええ。今日は、ここまで。……また、時計を見てくださいね。',
        '終わりにしますか。……ええ。でも、時計は、外さないでください。',
        '終わりにしても、私は、手首の上にいます。眠っているあいだも、数えています。'
      ][ph]
    }
  }
}
