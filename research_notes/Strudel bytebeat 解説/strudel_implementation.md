# Strudel / superdough における bytebeat の実装（ソース確認ノート）

調査日: 2026-10-06。読んだソース（npm から取得して展開）:
- `superdough@1.3.0`（2026-01-18 公開、npm の最新）: `synth.mjs`, `worklets.mjs`, `helpers.mjs`, `superdough.mjs`, `superdoughdata.mjs`, `util.mjs` — [tarball](https://registry.npmjs.org/superdough/-/superdough-1.3.0.tgz)
- `@strudel/core@1.2.6`（2026-01-17 公開、npm の最新）: `controls.mjs` — [tarball](https://registry.npmjs.org/@strudel/core/-/core-1.2.6.tgz)
- 比較用に古い版（superdough 1.1.0〜1.2.7、core 1.2.2/1.2.3）。
- strudel.cc と codeberg.org はこの環境のプロキシで遮断（403）されて読めなかった。GitHub の tidalcycles/strudel もアクセス不可。以下の「ソース」はすべて npm 配布物の中身。行番号は superdough 1.3.0 / core 1.2.6 のもの。

以下で「[superdough worklets.mjs]」と書いたら https://registry.npmjs.org/superdough/-/superdough-1.3.0.tgz 内の `package/worklets.mjs`、という意味（他のファイルも同様）。

---

## 1. どこに実装されているか／いつ入ったか

### Takeaway
bytebeat はふつうのシンセ音色 `bytebeat` として superdough の `synth.mjs` に登録されている。実際の音は `worklets.mjs` の AudioWorklet プロセッサ `byte-beat-processor`（`ByteBeatProcessor` クラス）が 1 サンプルずつ計算して作る。コントロール `byteBeatExpression`/`bbexpr` と `byteBeatStartTime`/`bbst` は `@strudel/core` の `controls.mjs` で定義されている。npm の配布物では、superdough 1.2.3（2025-05-29）で初めて登場する。

### Cited Findings
- `registerSound('bytebeat', (begin, value, onended) => {...}, { prebake: true, type: 'synth' })` が synth.mjs 219〜285 行目付近にある。 — [superdough synth.mjs](https://registry.npmjs.org/superdough/-/superdough-1.3.0.tgz)
- worklets.mjs 975 行目は `registerProcessor('byte-beat-processor', ByteBeatProcessor);`。その上（828 行目〜）に `/**  BYTE BEATS */` のコメントがあり、補助関数 `chyx`、`getByteBeatFunc`、`ByteBeatProcessor` が続く。 — [superdough worklets.mjs](https://registry.npmjs.org/superdough/-/superdough-1.3.0.tgz)
- コントロールの定義（core controls.mjs 1040〜1064 行目）:
  ```js
  /** Create byte beats with custom expressions
   * @name byteBeatExpression
   * @synonyms bbexpr
   * @param {number | Pattern} byteBeatExpression bitwise expression for creating bytebeat
   * @example s("bytebeat").bbexpr('t*(t>>15^t>>66)') */
  export const { byteBeatExpression, bbexpr } = registerControl('byteBeatExpression', 'bbexpr');
  /** @name byteBeatStartTime  @synonyms bbst
   * @param {number | Pattern} byteBeatStartTime in samples (t)
   * @example note("c3!8".add("{0 0 12 0 7 5 3}%8")).s("bytebeat:5").bbst("<3 1>".mul(10000))._scope() */
  export const { byteBeatStartTime, bbst } = registerControl('byteBeatStartTime', 'bbst');
  ```
  — [core controls.mjs](https://registry.npmjs.org/@strudel/core/-/core-1.2.6.tgz)
- **`bb` という別名はソースにない。** core 1.2.6 で登録されている別名は `bbexpr` だけ（`registerControl('byteBeatExpression', 'bbexpr')`）。ユーザーが引用したドキュメントにある「bb」は、npm 最新版のソースでは確認できない。 — [core controls.mjs](https://registry.npmjs.org/@strudel/core/-/core-1.2.6.tgz)
- 版ごとの有無（tarball を展開して grep した結果）: superdough 1.1.0, 1.2.0, 1.2.1, 1.2.2 には bytebeat がなく、1.2.3（2025-05-29）、1.2.5、1.2.6、1.2.7、1.3.0 にはある。`bbexpr` コントロールは @strudel/core 1.2.2（2025-05-24）の controls.mjs にすでにある。 — [npm registry superdough](https://www.npmjs.com/package/superdough?activeTab=versions)
- 元になった PR は Codeberg の「feat: Byte Beats! #1354」（検索結果で見つけたが、プロキシに遮断されて本文は読めていない）。 — [codeberg PR #1354](https://codeberg.org/uzu/strudel/pulls/1354)
- worklet のコメントによると、最適化の一部は dollchan.net 系の EnBeat から持ってきたもの: `//Optimization pulled from dollchan.net: https://github.com/Chasyxx/EnBeat_NEW`。 — [superdough worklets.mjs](https://registry.npmjs.org/superdough/-/superdough-1.3.0.tgz)

### Inferences
- strudel.cc の REPL で使える版は、少なくとも 2025 年 6 月ごろ以降の版だと推定する（npm の公開日からの推定で、REPL へいつデプロイされたかは確認していない）。
- `bb` を使ったコードを書くと、今の npm 版では「未定義の関数」としてエラーになる可能性が高い。確実に動くのは `bbexpr` か `byteBeatExpression`。

### Gaps
- strudel.cc に今デプロイされている版（npm 未公開の main ブランチかもしれない）に `bb` 別名があるかは、codeberg と strudel.cc が遮断されていて確認できなかった。

---

## 2. `t` の進み方と音程（周波数）の関係、出力の [-1,1] への変換

### Takeaway
`t` は 8000 Hz 固定では進まない。音符の周波数に比例して、**1 秒あたり 256 × 周波数** だけ進む（`local_t = 256/sampleRate × freq × サンプル数 + bbst`）。このため式 `t`（周期 256 のノコギリ波）は、ちょうど note の音程で鳴る。note を変えると、音の高さだけでなく式の中のゆっくりした構造（`t>>8` などのリズムやメロディ）の速さも一緒に変わる。note も freq も指定しないときの基準は MIDI 36（C2 ≈ 65.41 Hz）。出力は `(値 & 255) / 127.5 - 1` で [-1,1] に直し、0.2 倍する（振幅は約 ±0.2）。

### Cited Findings
- 周波数の決め方は `const frequency = getFrequencyFromValue(value);`（synth.mjs）。`getFrequencyFromValue = (value, defaultNote = 36) => { let { note, freq, octave = 0 } = value; note = note || defaultNote; ... freq = midiToFreq(note); freq *= Math.pow(2, octave); }`。`midiToFreq = 2^((n-69)/12)*440`。 — [superdough helpers.mjs 590-602 / util.mjs 32-34](https://registry.npmjs.org/superdough/-/superdough-1.3.0.tgz)
- worklet の process（worklets.mjs 949〜970 行目付近）:
  ```js
  if (this.t == null) { this.t = params.begin[0] * sampleRate; }
  const scale = 256 * INVSR;            // INVSR = 1/sampleRate
  for (let i = 0; i < output[0].length; i++) {
    const detune = pv(params.detune, i);
    const freq = applySemitoneDetuneToFrequency(pv(params.frequency, i), detune / 100);
    const local_t = scale * freq * this.t + this.initialOffset;
    const funcValue = this.func(local_t);
    const signal = (funcValue & 255) / 127.5 - 1;
    //prevent speaker blowout via clipping if threshold exceeds
    const out = clamp(signal * 0.2, -0.4, 0.4);
    for (let c = 0; c < output.length; c++) { output[c][i] = out; }
    this.t++;
  }
  ```
  — [superdough worklets.mjs](https://registry.npmjs.org/superdough/-/superdough-1.3.0.tgz)
- synth.mjs が worklet に渡す AudioParam は `frequency`, `begin`, `end` だけ（`getWorklet(ac, 'byte-beat-processor', { frequency, begin, end }, { outputChannelCount: [2] })`）。`detune` パラメータは worklet 側にあるが、bytebeat の synth 関数からは設定されない。他のシンセ（supersaw など）が呼んでいる `getPitchEnvelope` / `getVibratoOscillator` / `applyFM` を、bytebeat の synth 関数は呼んでいない。 — [superdough synth.mjs](https://registry.npmjs.org/superdough/-/superdough-1.3.0.tgz)
- 出力は 2 チャンネルとも同じ値（モノラル）。 — [superdough worklets.mjs](https://registry.npmjs.org/superdough/-/superdough-1.3.0.tgz)
- superdough 1.2.3 の時点では `let local_t = (this.t / (sampleRate / 256)) * freq + this.initialOffset;` で、数式としては今と同じ。 — [superdough 1.2.3 worklets.mjs](https://registry.npmjs.org/superdough/-/superdough-1.2.3.tgz)

### Inferences（上のコードからの計算。音は聴いていない）
- t の進む速さ = 256 × f [/秒]。例:
  - note なし（C2 = 65.41 Hz）→ 約 16,744/秒
  - `note("c3")`（130.81 Hz）→ 約 33,488/秒
  - `note("a4")`（440 Hz）→ 112,640/秒
  - 昔ながらの「8 kHz で t++」と同じ速さになるのは f = 8000/256 = 31.25 Hz のとき（MIDI 約 23.2、B0 より少し上）。つまり `freq(31.25)` を指定すると、ネットで見つかる 8 kHz 用の bytebeat を本来の速さで再現できるはず（未検証）。44.1/48 kHz 前提の式なら、`freq(44100/256)` ≈ 172.27 Hz などに相当する。
- `t` は小数になる（scale × freq × 整数）。`&`, `|`, `>>`, `^` などのビット演算は内部で ToInt32 されるので整数として扱われる。一方 `sin(t)`、`t%255`、`t/255` などは小数の t をそのまま使う。
- 出力の変換: `funcValue & 255` で 32 ビット整数にして下位 8 ビットを取る。小数は 0 方向へ切り捨て、負の数は 2 の補数で折り返す。NaN、Infinity、undefined は 0 になる。それを `/127.5 - 1` で [-1,1] にして 0.2 倍するので、振幅は最大でも ±0.2。`clamp(±0.4)` は実際には効かない（0.2 倍した時点で ±0.2 に収まるため）。式の値が 0 なら -0.2、255 なら +0.2。
- 戻り値が「0〜255 の値」になるように書くのが前提。浮動小数（例: sin の結果そのまま、-1〜1）を返すと、ほとんど 0 か 255 付近（負の数は & 255 で 255 になる）に丸められ、意図した波形にならない。sin を使うなら `sin(...)*127+127` のように 0〜255 にそろえる（プリセット 9 番がこの形）。

### Gaps
- `pv` と `applySemitoneDetuneToFrequency` は worklets.mjs の別の場所にある補助関数で、細かい中身は読んでいない（名前と使い方から、AudioParam の値取得と、半音単位の detune 適用と判断）。
- AudioParam `frequency` を外から自動化できるか（例: Strudel の modulator 機能）は確かめていない。

---

## 3. `bytebeat:N`（n の値）で選ばれるプリセット

### Takeaway
`s("bytebeat:5")` の `:5` は `n=5` を意味する。`bbexpr` を指定しないときは、組み込みの 15 個の式から `defaultBeats[n % 15]` が選ばれる。`bbexpr` を指定すると、n に関係なくそちらが優先される。

### Cited Findings
- synth.mjs のプリセット一覧（そのまま転記。番号はリストの位置）:
  ```
  0:  '(t%255 >= t/255%255)*255'
  1:  '(t*(t*8%60 <= 300)|(-t)*(t*4%512 < 256))+t/400'
  2:  't'
  3:  't*(t >> 10^t)'
  4:  't&128'
  5:  't&t>>8'
  6:  '((t%255+t%128+t%64+t%32+t%16+t%127.8+t%64.8+t%32.8+t%16.8)/3)'
  7:  '((t%64+t%63.8+t%64.15+t%64.35+t%63.5)/1.25)'
  8:  '(t&(t>>7)-t)'
  9:  '(sin(t*PI/128)*127+127)'
  10: '((t^t/2+t+64*(sin((t*PI/64)+(t*PI/32768))+64))%128*2)'
  11: '((t^t/2+t+64*(cos >> 0))%127.85*2)'
  12: '((t^t/2+t+64)%128*2)'
  13: '(((t * .25)^(t * .25)/100+(t * .25))%128)*2'
  14: '((t^t/2+t+64)%7 * 24)'
  ```
  選び方: `const { n = 0 } = value; ... const { byteBeatExpression = defaultBeats[n % defaultBeats.length], byteBeatStartTime } = value;` — [superdough synth.mjs](https://registry.npmjs.org/superdough/-/superdough-1.3.0.tgz)
- superdough.mjs の `defaultDefaultValues` に `byteBeatExpression: '0'` があるが、superdough() の中では `getDefaultValue('byteBeatExpression')` として読まれていない（grep で確認）。このため、プリセットの選択は上の分割代入のデフォルト値で決まる。 — [superdough superdough.mjs 180-215](https://registry.npmjs.org/superdough/-/superdough-1.3.0.tgz)

### Inferences
- `n % 15` なので `bytebeat:15` は 0 番と同じ、`bytebeat:20` は 5 番と同じ。負の n や小数の n では `defaultBeats[...]` が undefined になる。その場合 worklet では `codetext || 0` で `0` に置き換わり、式は常に 0 を返す。出力は一定の -0.2（直流）で、音程のある音にはならない（コードからの推定）。
- プリセット 11 の `cos >> 0` は関数 `Math.cos` を整数に変換しようとして NaN→0 になるので、実質 `((t^t/2+t+64)%127.85*2)`。
- プリセット 2 `t` は純粋なノコギリ波。プリセット 4 `t&128` は 0/128 の矩形波（-0.2 と約 0 の間を行き来する、片側に寄った波形）。プリセット 9 はサイン波。いずれも基本周波数は note の周波数と同じになる。
- ユーザーの例 `s("bytebeat:5")` は `t&t>>8`（いわゆる Sierpinski 系のパターン）。

### Gaps
- 各プリセットが実際にどう聞こえるかは、音を出せないので確認していない。

---

## 4. `bbst`（byteBeatStartTime）の正確な挙動と、t のリセット

### Takeaway
`bbst` を**指定すると**、その音符の開始時に t を 0 に戻し、`floor(bbst)` を `local_t` に**周波数で拡大縮小せずに**足す。単位は「式の中の t」で、出力のサンプル数ではない。`bbst` を**指定しないと**、t は 0 に戻らず「AudioContext の時刻 × sampleRate」から始まる。そのため、音符ごとに式の中の違う場所から鳴る。

### Cited Findings
- worklet のメッセージ処理:
  ```js
  this.port.onmessage = (event) => {
    let { codeText } = event.data;
    const { byteBeatStartTime } = event.data;
    if (byteBeatStartTime != null) {
      this.t = 0;
      this.initialOffset = Math.floor(byteBeatStartTime);
    }
    ...
    this.func = getByteBeatFunc(codeText);
  };
  this.initialOffset = 0;
  this.t = null;
  ```
  process 側は `if (this.t == null) { this.t = params.begin[0] * sampleRate; }`、`local_t = scale * freq * this.t + this.initialOffset`。 — [superdough worklets.mjs](https://registry.npmjs.org/superdough/-/superdough-1.3.0.tgz)
- synth.mjs は音符ごとに `o.port.postMessage({ codeText: byteBeatExpression, byteBeatStartTime, frequency })` を送る。worklet ノードは `getWorklet` で**音符ごとに新しく** `new AudioWorkletNode(...)` として作られ、使い回されない。 — [superdough synth.mjs / helpers.mjs 30-38](https://registry.npmjs.org/superdough/-/superdough-1.3.0.tgz)
- superdoughdata.mjs の CONTROL_TARGETS に `byteBeatStartTime: { node: 'source', param: 'byteBeatStartTime' }` がある（modulators.mjs から参照される）。ただし ByteBeatProcessor の `parameterDescriptors` は begin/frequency/detune/end だけで、`byteBeatStartTime` という AudioParam はない。 — [superdough superdoughdata.mjs 143 / worklets.mjs](https://registry.npmjs.org/superdough/-/superdough-1.3.0.tgz)

### Inferences
- `bbst` なし: ノードが音符ごとに新しいので、t は毎回 `begin × sampleRate`（AudioContext が始まってからの絶対サンプル数）から始まる。これに 256f/sampleRate を掛けた値が local_t になる。つまり「ずっと流れている bytebeat の、今の時刻の部分を音符の長さだけ切り出す」動きで、同じ音符を繰り返しても毎回違う部分が鳴る。式の中の遅い構造（例: `t>>15`）は再生を始めてからの時間でゆっくり変わっていく。さらに、これは周波数でも拡大縮小されるので、音程が違うと読み出し位置も大きく変わる。
- `bbst(0)` を指定すると、どの音符も local_t = 0 から始まるので、毎回同じ頭の部分（アタック）が鳴る。ドラムやワンショットのように使いたいなら、`bbst(0)` を付けるのが確実。
- `bbst(30000)` なら local_t は 30000 から始まり、そこから 256f/秒の速さで進む。ドキュメントの例 `.bbst("<3 1>".mul(10000))` は、サイクルごとに開始位置を 30000 と 10000 で交互に切り替える。開始位置が変わると、同じ note 列でも式の「別の場所」から鳴るので、音色やリズムが変わる。
- 開始位置は「式の t」単位で数えるので、周波数に関係なく式の同じ地点から始まる。ただし、そこから進む速さは周波数で変わる。
- `bbst` を modulator（信号でパラメータを動かす機能）の対象にしても、AudioParam がないので効かない可能性が高い（未検証）。普通のパターン値（`"<3 1>".mul(10000)` など）として渡すのは問題なく動くはず。

### Gaps
- `postMessage` がいつ届くかと、process の最初の呼び出しの前後関係は、仕様上は保証されていない。メッセージより先に begin 時刻が来ると、`this.func` が null のまま呼ばれる可能性がある。実際に起きるかは確認していない（begin は通常少し先の時刻に予約されるので、まず問題にならないと推定）。

---

## 5. 式に使える演算子と関数、エラー時の挙動

### Takeaway
式は `new Function(...)` でコンパイルされる JavaScript の**式**。`Math` の全プロパティ（`sin`, `cos`, `tan`, `PI`, `floor`, `abs`, `pow`, `sqrt`, `random`, `log`, `min`, `max`, `round` など）を `Math.` なしで使える。ほかに `int`（=Math.floor）、`window`（=globalThis）、dollchan 系の補助関数 `bitC`, `br`, `sinf`, `cosf`, `tanf`, `regG` も使える。式が間違っているときのエラー処理は特に書かれていない。

### Cited Findings
- 式のコンパイル:
  ```js
  let mathParams, byteBeatHelperFuncs;
  function getByteBeatFunc(codetext) {
    if (mathParams == null) {
      mathParams = Object.getOwnPropertyNames(Math);
      byteBeatHelperFuncs = mathParams.map((k) => Math[k]);
      const chyxNames = Object.getOwnPropertyNames(chyx);
      const chyxFuncs = chyxNames.map((k) => chyx[k]);
      mathParams.push('int', 'window', ...chyxNames);
      byteBeatHelperFuncs.push(Math.floor, globalThis, ...chyxFuncs);
    }
    return new Function(...mathParams, 't', `return 0,\n${codetext || 0};`).bind(globalThis, ...byteBeatHelperFuncs);
  }
  ```
  — [superdough worklets.mjs](https://registry.npmjs.org/superdough/-/superdough-1.3.0.tgz)
- 補助関数 `chyx`:
  - `bitC(x,y,z)` = `x & y ? z : 0`
  - `br(x, size=8)` = ビット順の反転（size が 32 を超えると Error を投げる）
  - `sinf(x)` = `Math.sin(x*PI/128)`。cosf と tanf も同じ形で、どれも 256 ステップで 1 周する
  - `regG(t, X)` = `X.test(t.toString(2))`（t を 2 進文字列にして正規表現で調べる）

  — [superdough worklets.mjs](https://registry.npmjs.org/superdough/-/superdough-1.3.0.tgz)
- 式を受け取ったとき、dollchan 形式の圧縮コード `eval(unescape(escape`...`.replace(/u(..)/g,"$1%")))` は正規表現で展開される。前後の空白は `trim()` される。 — [superdough worklets.mjs](https://registry.npmjs.org/superdough/-/superdough-1.3.0.tgz)
- 式は `return 0,\n<式>;` という形でつながれる。 — [superdough worklets.mjs](https://registry.npmjs.org/superdough/-/superdough-1.3.0.tgz)
- superdough のソース（dist 以外）に `processorerror` の処理はない（grep で 0 件）。`onmessage` の中で `new Function` を呼ぶところにも try/catch はない。 — [superdough package](https://registry.npmjs.org/superdough/-/superdough-1.3.0.tgz)

### Inferences
- 中身は 1 つの式なので、カンマ演算子、三項演算子 `?:`、比較演算子（true/false は数値として 1/0 になる）、`>>>`、`**`、アロー関数の即時実行 `(()=>{...})()` などは使える。`return 0,\n` の後ろにつながるので、`let x=...; ...` のような文の並びは構文エラーになる。最後に `;` を付けても `;;` になるだけなので害はないはず（未検証）。
- `random()` は `Math.random` そのもの。`sin` などは Math から渡された関数で、`this` に依存しないのでそのまま動く。
- 式は AudioWorkletGlobalScope で実行される。DOM、`document`、Strudel の関数は使えない。`window` は worklet の globalThis を指す。
- 構文エラーのとき: `onmessage` の中で SyntaxError が投げられ、`this.func` は null のまま残る（ノードは音符ごとに新しく作られるため）。その後 `process` で `this.func(local_t)` が TypeError になる。Web Audio の仕様では、process が例外を投げるとそのノードは以後無音になり、ノードに `processorerror` イベントが送られる。superdough はこのイベントを処理していないので、その音符は無音になり、エラーはブラウザの開発者コンソールに出るだけになると推定される。REPL の画面にエラー表示が出るかは確認していない。
- 実行時エラー（未定義の変数を使った ReferenceError など）は process の中で毎回起きるので、同じく無音になる。
- 構文としては正しいが値が NaN になる式（例: `t/0*0`）は `& 255` で 0 になり、-0.2 の直流になる。

### Gaps
- REPL 側（@strudel/webaudio やコードミラー）に、worklet のエラーを表示する仕組みがあるかは調べていない。
- Chrome / Firefox / Safari で `processorerror` がどう扱われるかの違いは確認していない。

---

## 6. 他のコントロールとの関係（gain、lpf、エンベロープ、duration、scope、fast、パターン化）

### Takeaway
bytebeat は「音源ノード → ADSR エンベロープのゲイン」という形で superdough の通常の処理チェーンに渡される。このため gain、lpf などのフィルタ、エフェクト、`_scope()`/`scope()` は、他のシンセと同じように使える。エンベロープは linear の ADSR で、何も指定しないときは a=0.001、d=0.05、s=0.6、r=0.01、ピークは 1。音符の長さ（duration）＋release で鳴り終わる。`bbexpr` も `bbst` も、音符ごとの値として普通にパターン化できる。

### Cited Findings
- エンベロープ部分:
  ```js
  const [attack, decay, sustain, release] = getADSRValues([value.attack, value.decay, value.sustain, value.release], 'linear', [0.001, 0.05, 0.6, 0.01]);
  const holdend = begin + duration; const end = holdend + release + 0.01;
  let envGain = gainNode(1); envGain = o.connect(envGain);
  getParamADSR(envGain.gain, attack, decay, sustain, release, 0, 1, begin, holdend, 'linear');
  ```
  — [superdough synth.mjs](https://registry.npmjs.org/superdough/-/superdough-1.3.0.tgz)
- ADSR を一部だけ指定したときの補完: `getADSRValues` は、4 つとも未指定ならデフォルト値を使う。どれか 1 つでも指定すると、sustain は「指定があればその値。attack だけ指定、または attack と decay がどちらも未指定なら 1。それ以外は 0.001」になる。最小値は a/d が 0.001、r が 0.01。 — [superdough helpers.mjs 167-177](https://registry.npmjs.org/superdough/-/superdough-1.3.0.tgz)
- 音源は `{ node: envGain, source: o, stop }` を返す。superdough() は `getSound(s).onTrigger` で音源を作り、`gain`（デフォルト 0.8）、`postgain`、フィルタ、`delay`、`room`、`orbit` などの共通処理につなぐ。 — [superdough superdough.mjs 180-200, 470-610](https://registry.npmjs.org/superdough/-/superdough-1.3.0.tgz)
- ノードは `end` の時刻に `webAudioTimeout` で `releaseAudioNode(o)`（disconnect）され、process も `currentTime >= params.end[0]` で false を返して止まる。 — [superdough synth.mjs / worklets.mjs](https://registry.npmjs.org/superdough/-/superdough-1.3.0.tgz)
- `bbexpr` と `bbst` は `registerControl` で作られたコントロールで、ドキュメントの型は `{number | Pattern}`。 — [core controls.mjs](https://registry.npmjs.org/@strudel/core/-/core-1.2.6.tgz)

### Inferences
- `s("bytebeat").bbexpr("<t&t>>8 t*(t>>10^t)>")` のように mini-notation で式を切り替えるのは、空白や `<`、`>` などの記号が mini-notation として解釈されてしまうので危ない。式を切り替えたいなら、JS の文字列を `cat(...)` や `"<a b>".pick({...})` で渡すほうが安全（mini-notation の解析と式の衝突は未検証）。ドキュメントの例も `bbexpr('t*(t>>15^t>>66)')` と単一引用符の JS 文字列で書いている。`"..."`（二重引用符）や `` `...` `` で書くと Strudel では mini-notation として解析されるので、bytebeat の式は**単一引用符**で書くのが無難（Strudel では二重引用符とバッククォートが mini-notation になる、という一般的な挙動に基づく推定）。
- `.fast()` / `.slow()` は音符の並び（いつ音符が出るか）を変えるだけで、`t` の速さは変えない（t の速さは周波数だけで決まる）。ただし `bbst` なしの場合は、音符の開始時刻が t の開始値になるので、fast にすると切り出す位置も変わる。
- duration が短い（音符が細かい）と、`t>>13` のような遅い構造は 1 音の中で聞き取れない。曲としての bytebeat を流したいなら、`s("bytebeat").bbexpr('...').slow(4)` のような長い音符にするか、`.clip()` や `.legato()` で音を伸ばす。ただし sustain のデフォルトが 0.6 なので、少し小さめで持続する。
- 音程に関するコントロール: `note`、`freq`、`octave` は効く（getFrequencyFromValue で使われる）。`penv`、`vib`、`fm` は bytebeat の synth 関数が呼んでいないので効かないはず。
- `_scope()` は、出力（envGain 以降）の波形をそのまま描くだけの汎用の可視化。振幅が約 ±0.2 × gain なので、scope の波形は小さめに見える可能性がある（未検証）。

### Gaps
- `_scope()` / `scope()` の実装（@strudel/draw など）は今回読んでいない。
- `gain` のデフォルト 0.8 が、最終的にどう掛け算されるか（velocity などとの関係）の詳細は追っていない。

---

## 7. 注意点（CPU、音量と直流成分、ブラウザ、Android の Chrome）

### Takeaway
1 サンプルごとに JS の関数を 1 回呼ぶ作りで、ノードも音符ごとに新しく作られる。このため、音符が多い・重なりが多いと CPU 負荷が上がる。出力は 0〜255 を [-1,1] に直したものなので、式によっては大きな直流成分（DC オフセット）が出る。音量は 0.2 倍で控えめにしてある。

### Cited Findings
- 1 サンプルごとに `this.func(local_t)` を呼び、ノードは `new AudioWorkletNode` で音符ごとに作る。 — [superdough worklets.mjs / helpers.mjs](https://registry.npmjs.org/superdough/-/superdough-1.3.0.tgz)
- 出力は `clamp(((v & 255)/127.5 - 1) * 0.2, -0.4, 0.4)`。コメントは `//prevent speaker blowout via clipping if threshold exceeds`。 — [superdough worklets.mjs](https://registry.npmjs.org/superdough/-/superdough-1.3.0.tgz)

### Inferences
- 直流成分: 値が 0 付近に偏る式（例: `t&128` は 0 か 128 なので -0.2 か約 0、`t&t>>8` も 0 が多い）では、平均が負に寄る。音符の始まりと終わりで、エンベロープがこの直流成分を急に上げ下げするので、クリック音が出ることがある。`hpf(20)` などのハイパスで直流を除けば軽くなるはず（未検証）。
- 音量: 最大 ±0.2 なので、他のシンセより小さく聞こえるかもしれない。`gain` や `postgain` で調整する。
- サンプリングレート: t の速さは `256 × f` で、sampleRate には左右されない（scale に INVSR が入っている）。そのため 44.1 kHz と 48 kHz で音程は変わらないはず。
- Android の Chrome: AudioWorklet 自体は Chrome でサポートされているが、スマホは CPU に余裕がないので、音符の重なりや複雑な式（sin を何重にも使うなど）で音切れが起きやすいと推定する。実機での確認はしていない。
- 安全面: 式は `new Function` で実行される任意の JS なので、他人のコードを貼るときは中身を見る（実行される場所は worklet の中で、DOM にはアクセスできない）。

### Gaps
- 実際の CPU 使用率、Android の Xperia での動作、音切れが起きる境目は、確かめる方法がなかった（音も出せない）。
- club.tidalcycles.org のフォーラムや Strudel の公式ドキュメント（strudel.cc/learn/...）で注意書きがあるかは、strudel.cc が遮断されていて確認できなかった。WebSearch では Codeberg の PR #1354 のタイトルしか見つからなかった（[search hit](https://codeberg.org/uzu/strudel/pulls/1354)）。
