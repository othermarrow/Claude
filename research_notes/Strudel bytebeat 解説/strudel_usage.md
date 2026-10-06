# Strudel の bytebeat 実用パターン（コード例・検証・落とし穴）

検証環境: npm から `@strudel/core@1.2.6`（2026-01-17 公開）、`@strudel/mini@1.2.6`、`@strudel/transpiler@1.2.6`、`superdough@1.3.0`（2026-01-18 公開）を入れ、Node 22 でパターンを評価して hap の値（`hap.value`）を確認した。core の `repl.mjs` が読み込む `@kabelsalat/web` は Node で読めないため、スタブに差し替えて評価した。`_scope()` はブラウザ専用の CodeMirror ウィジェットなので、Node では `analyze` を付けるだけのスタブで代用した。**音はまったく聴いていない。** 検証済みなのは「エラーなく評価でき、意図したコントロールが hap に入る」ところまで。

主な一次ソース:
- core のコントロール定義: https://unpkg.com/@strudel/core@1.2.6/controls.mjs
- bytebeat 音源の登録: https://unpkg.com/superdough@1.3.0/synth.mjs
- AudioWorklet 本体: https://unpkg.com/superdough@1.3.0/worklets.mjs
- 文字列の扱い: https://unpkg.com/@strudel/core@1.2.6/pattern.mjs（`reify`）、https://unpkg.com/@strudel/mini@1.2.6/mini.mjs（`miniAllStrings`）、https://unpkg.com/@strudel/transpiler@1.2.6/transpiler.mjs
- テストスナップショット（GitHub ミラー。2025-06 時点のチェックアウトで確認）: https://github.com/tidalcycles/strudel/blob/main/test/__snapshots__/examples.test.mjs.snap
- 開発元の移転先: https://codeberg.org/uzu/strudel（このサンドボックスからは接続がブロックされ、読めなかった）

---

## 1. Strudel のコードベース・リリース・コミュニティにある例

### Takeaway
公式の例は JSDoc にある 2 つだけで、テストスナップショットにも同じ 2 つが入っている: `s("bytebeat").bbexpr('t*(t>>15^t>>66)')` と `note("c3!8".add("{0 0 12 0 7 5 3}%8")).s("bytebeat:5").bbst("<3 1>".mul(10000))._scope()`。使える名前は `byteBeatExpression`/`bbexpr` と `byteBeatStartTime`/`bbst` だけで、**`bb` という別名は存在しない**。コミュニティの具体的なコード例は、検証できる形では見つからなかった。

### Cited Findings
- `byteBeatExpression` の別名は `bbexpr`。JSDoc の例は `s("bytebeat").bbexpr('t*(t>>15^t>>66)')`。登録は `registerControl('byteBeatExpression', 'bbexpr')` — [controls.mjs](https://unpkg.com/@strudel/core@1.2.6/controls.mjs)
- `byteBeatStartTime` の別名は `bbst`。引数の説明は "in samples (t)"。例は `note("c3!8".add("{0 0 12 0 7 5 3}%8")).s("bytebeat:5").bbst("<3 1>".mul(10000))._scope()` — [controls.mjs](https://unpkg.com/@strudel/core@1.2.6/controls.mjs)
- `.bb(...)` は Node での評価で `s(...).bb is not a function` になった。controls.mjs には `bb` の登録がない（実測）— [controls.mjs](https://unpkg.com/@strudel/core@1.2.6/controls.mjs)
- テストスナップショットには `example "byteBeatExpression"`（`s:bytebeat byteBeatExpression:t*(t>>15^t>>66)` が 1 サイクルに 1 イベント）と `example "byteBeatStartTime"`（`note:48 s:bytebeat n:5 byteBeatStartTime:30000` のあと、次のサイクルで `10000` に変わる）が入っている — [examples.test.mjs.snap](https://github.com/tidalcycles/strudel/blob/main/test/__snapshots__/examples.test.mjs.snap)
- `s("bytebeat:N")` で使われる組み込み式 15 個（N は `n % 15` で選ばれる）。0:`(t%255 >= t/255%255)*255`、1:`(t*(t*8%60 <= 300)|(-t)*(t*4%512 < 256))+t/400`、2:`t`、3:`t*(t >> 10^t)`、4:`t&128`、5:`t&t>>8`、6:`((t%255+t%128+...)/3)`、7:`((t%64+t%63.8+...)/1.25)`、8:`(t&(t>>7)-t)`、9:`(sin(t*PI/128)*127+127)`、10〜14 は `t^t/2+t+64` 系。`bbexpr` を指定しなかったときだけ使われる（`const { byteBeatExpression = defaultBeats[n % defaultBeats.length], ... } = value`）— [synth.mjs](https://unpkg.com/superdough@1.3.0/synth.mjs)
- PR「#1357 Byte Beat improvements -> 2」は検索結果の抜粋によると「bytebeat の worklet 処理の簡素化と開始オフセット `.bbst` の追加」。本文は Codeberg がブロックされていて読めなかった — [Codeberg PR #1357](https://codeberg.org/uzu/strudel/pulls/1357)（検索スニペットのみ）
- コミュニティ: BotB Academy に「Strudel (livecoding)」というスレッドがある（[BotB](https://battleofthebits.com/academy/GroupThread/45511/Strudel+(livecoding)/)）。Mirakl の記事タイトルは "Beats, Bytes, and Basslines"（[mirakl.tech](https://mirakl.tech/beats-bytes-and-basslines-an-introduction-to-live-coding-with-strudel-cc-4d378e86d5b7)）。どちらも本文は読めず（BotB は接続ブロック）、bytebeat のコードが載っているかは未確認。

### Inferences
- 公式ドキュメントの例は少ない。実用的な書き方は、ソース（synth.mjs と worklets.mjs）の挙動から組み立てるしかない、というのが現状。
- 依頼文にある `bb` は存在しない別名。解説では使わないこと。

### Gaps
- Codeberg のリリースノート、CHANGELOG、PR #1357 の本文は、ネットワーク制限で読めなかった。bytebeat が入ったバージョンや日付は確定できていない（npm の `superdough@1.3.0` には入っている）。
- club.tidalcycles.org、Mastodon、YouTube 概要欄のコード例は今回取得できていない（検索で出てこなかった）。

---

## 2. 式の受け渡しと引用符: bbexpr はどの文字列を受け取るか

### Takeaway
**strudel.cc の REPL では、ダブルクォート `"..."` とバッククォート `` `...` `` はトランスパイラによってミニ記法として解析される。式に `(`、`&`、`|` などが入るとパースエラーになる。シングルクォート `'...'` だけが素の文字列としてそのまま worklet に届く。** `<>` で式を交互に切り替えるのはミニ記法では書けないので、`cat(...)` や `"<0 1>".pick([...])` を使う。

### Cited Findings
- トランスパイラは、`node.raw[0] === '"'` のリテラル（ダブルクォート）と、タグなしのテンプレートリテラル（バッククォート）を `m('...')`（ミニ記法）に書き換える。シングルクォートはそのまま残す — [transpiler.mjs](https://unpkg.com/@strudel/transpiler@1.2.6/transpiler.mjs)
- 実測（Node + transpiler）:
  - `s("bytebeat").bbexpr('t*(t>>15^t>>66)')` → `{"s":"bytebeat","byteBeatExpression":"t*(t>>15^t>>66)"}`（成功）
  - `.bbexpr("t*(t>>15^t>>66)")` と `` .bbexpr(`t*(t>>15^t>>66)`) `` → `[mini] parse error ... but "(" found.`
  - `.bbexpr("t&t>>8")` → `[mini] parse error ... but "&" found.`
  - `.bbexpr("<'t*(t>>9)' 't&t>>8'>")` → `[mini] parse error ... but "'" found.`（ミニ記法の中で引用符は使えない）
  - `.bbexpr("<t t&t>>8>")` → パースエラー
  - `.bbexpr('<t t&t>>8>')`（シングルクォート）→ **エラーにはならないが**、`"<t t&t>>8>"` という文字列がそのまま式として渡る。交互にはならず、JS としても不正な式になる。
  - `.bbexpr(cat('t*(t>>9)', 't&t>>8'))` → サイクル 0 は `t*(t>>9)`、サイクル 1 は `t&t>>8`（成功）
  - `.bbexpr("<0 1>".pick(['t*(t>>9)', 't & t>>8']))` → サイクルごとに切り替わる（成功。スペース入りの式も保たれる）
  - `.bbexpr('t * (t>>9) & 128')` → スペースを含めてそのまま渡る（成功）
- core の `reify` が文字列をミニ記法で解析するのは `stringParser` が設定されているときだけ。`miniAllStrings()` を呼ぶと設定される — [pattern.mjs](https://unpkg.com/@strudel/core@1.2.6/pattern.mjs), [mini.mjs](https://unpkg.com/@strudel/mini@1.2.6/mini.mjs)
- `@strudel/web` の `initStrudel()` は、`options.miniAllStrings !== false` なら `miniAllStrings()` を呼ぶ。一方 strudel.cc 本体（website）のソースでは `miniAllStrings` を呼んでいない（2025-06 時点の GitHub ミラーで grep した）— [web.mjs](https://github.com/tidalcycles/strudel/blob/main/packages/web/web.mjs)
- 実測: `miniAllStrings()` を有効にすると（`@strudel/web` の既定の状態に相当）、シングルクォートの `.bbexpr('t*(t>>15^t>>66)')` も `[mini] parse error` になった。`.bbexpr(pure('t*(t>>15^t>>66)'))` なら成功した。

### Inferences
- strudel.cc では、式は必ずシングルクォートで書く。式を切り替えたいときは `cat()`、`"<0 1 2>".pick([...])`、`arrange()` のような JS 側の関数で、シングルクォートの文字列を並べる。
- `@strudel/web` で自分のページに埋め込む場合は、`pure('...')` で包むか、`initStrudel({ miniAllStrings: false })` にする（後者は Node での推論で、ブラウザでは未確認）。

### Gaps
- 現行の strudel.cc（Codeberg main、2026 年）の website が今も `miniAllStrings` を呼んでいないかは、Codeberg に接続できず直接は確認できていない。ただし npm の transpiler 1.2.6 の挙動と JSDoc の例（シングルクォート）とは食い違いがない。

---

## 3. 2 つの公式例の評価結果、サウンドエンジンの仕様、落とし穴

### Takeaway
2 つの公式例はどちらも期待どおりの hap を出す。ただし `t` の進む速さは「音高 × 256 / 秒」で、8kHz 固定ではない。`bbst` を付けない場合、`t` は AudioContext の絶対時刻から始まる。出力は `値 & 255` を 8bit とみなして振幅 0.2 にスケールし、±0.4 でクランプしている。

### Cited Findings
- 例 1 の評価結果（実測）: 1 サイクルにつき `{"s":"bytebeat","byteBeatExpression":"t*(t>>15^t>>66)"}` が 1 つ。スナップショットと一致 — [snap](https://github.com/tidalcycles/strudel/blob/main/test/__snapshots__/examples.test.mjs.snap)
- 例 2 の評価結果（`_scope` はスタブ）: `{"note":48,"s":"bytebeat","n":5,"byteBeatStartTime":30000,"analyze":1}` が 1/8 ごとに並び、note は 48/48/60/48/55/53/51/48。サイクル 1 では `byteBeatStartTime:10000`。スナップショットと一致。`bytebeat:5` は `s:"bytebeat"` と `n:5` に分かれる（組み込み式 5 = `t&t>>8`）。
- worklet の計算式: `local_t = (256 / sampleRate) * freq * this.t + initialOffset`。`this.t` はサンプルごとに 1 増える。出力は `(func(local_t) & 255) / 127.5 - 1` に 0.2 を掛け、±0.4 でクランプ — [worklets.mjs](https://unpkg.com/superdough@1.3.0/worklets.mjs)
- つまり 1 秒あたりの t の増え方は `256 × 周波数`。音程の既定は MIDI 36（C2、約 65.41Hz）なので約 16,744/秒。`note("c1")` なら約 8,372/秒、`.freq(31.25)` でちょうど 8,000/秒（古典的な 8kHz bytebeat と同じ速さ）。`getFrequencyFromValue(value, defaultNote = 36)` を使っている — [helpers.mjs](https://unpkg.com/superdough@1.3.0/helpers.mjs), [worklets.mjs](https://unpkg.com/superdough@1.3.0/worklets.mjs)（数値は計算値）
- `byteBeatStartTime` を指定すると `this.t = 0`、`initialOffset = floor(bbst)` になる。指定しないと、最初の処理で `this.t = begin * sampleRate`（AudioContext の絶対時刻）から始まる — [worklets.mjs](https://unpkg.com/superdough@1.3.0/worklets.mjs)
- 式は `new Function(...Math のプロパティ名, 'int', 'window', ...chyx の名前, 't', 'return 0,\n' + code)` でコンパイルされる。`sin`、`PI`、`floor` などは `Math.` なしで使え、`int` は `Math.floor`。補助関数として `bitC`、`br`（ビット反転）、`sinf`、`cosf`、`tanf`（128 ステップで一周）、`regG` がある。dollchan 形式の `eval(unescape(escape\`...\`.replace(/u(..)/g,"$1%")))` も展開される — [worklets.mjs](https://unpkg.com/superdough@1.3.0/worklets.mjs)
- エンベロープ: `getADSRValues([attack, decay, sustain, release], 'linear', [0.001, 0.05, 0.6, 0.01])`。既定ではサスティン 0.6、リリース 0.01 秒 — [synth.mjs](https://unpkg.com/superdough@1.3.0/synth.mjs)
- `byteBeatStartTime` は superdough の「source」パラメータとして登録されている（`{ node: 'source', param: 'byteBeatStartTime' }`）。既定値表では `byteBeatExpression: '0'` — [superdoughdata.mjs](https://unpkg.com/superdough@1.3.0/superdoughdata.mjs), [superdough.mjs](https://unpkg.com/superdough@1.3.0/superdough.mjs)
- `_scope()` は `@strudel/codemirror` の `registerWidget('_scope', ...)` で定義されたインラインウィジェット。`.scope()`/`.tscope()` は `@strudel/webaudio` の `this.analyze(id).draw(...)`。どちらもブラウザ専用で、Node では動かない — [widget.mjs](https://github.com/tidalcycles/strudel/blob/main/packages/codemirror/widget.mjs), [scope.mjs](https://github.com/tidalcycles/strudel/blob/main/packages/webaudio/scope.mjs)

### 落とし穴（ソースからの推論を含む）
- **ダブルクォートやバッククォートで式を書くとミニ記法エラーになる**（実測）。
- **`'<a b>'` のようにシングルクォートの中に `<>` を書いても交互にはならない**（実測）。`cat` や `pick` を使う。
- **`bb` は存在しない**（実測）。
- **`bbst` を省くと、ノートごとに式の途中から鳴り始める**（開始位置が絶対時刻で決まるため）。リズム楽器的に毎回頭から鳴らしたいなら `.bbst(0)` を付ける（ソースからの推論。耳では未確認）。
- **音高を変えると、bytebeat の「テンポ」も変わる**。`t>>13` のような長い周期の構造も、音高に比例して速くなる。原曲の速さに近づけるなら `.freq(31.25)`（8kHz 相当）や `note("c1")` あたりを使う（推論）。
- **値は `&255` で 8bit に切り詰められる**ので、浮動小数を返す式も整数部の下位 8bit で鳴る（ソースより）。式の構文エラーは worklet の中で起きるので、REPL 側のエラー表示に出るかは未確認。
- **音量**: worklet が 0.2 倍・±0.4 クランプをかけているので、ほかの音源より小さめになりうる。`gain` で調整する（推論）。
- **サスティン既定値 0.6**: 長いイベントでもサスティンで鳴り続ける。打楽器的にするなら `.decay(.1).sustain(0)`。

### Gaps
- 実際の音色、音量バランス、`bbst` を付けたときの聴感上の違いは、耳で確認していない。
- worklet 内の構文エラーが UI にどう表示されるかは未確認。

---

## 4. 検証済みのコード例（初級 → 上級。いずれも Node で評価が通り、hap を確認済み。音は未確認）

### Takeaway
以下 8 例はすべて transpiler 1.2.6 + core/mini 1.2.6 でエラーなく評価でき、hap に `s`、`byteBeatExpression`、`byteBeatStartTime`、`note`、各エフェクトのキーが入ることを確認した（`_scope` はスタブ評価）。

### Cited Findings（各例の hap 実測値）
1. 組み込み式を `n` で切り替える（初級）
   ```js
   s("bytebeat").n("<0 2 3 4>").note("c2")
   ```
   hap: `{"s":"bytebeat","n":0,"note":"c2"}`、次のサイクルは `n:2` …
2. `bytebeat:N` の省略形
   ```js
   note("c2").s("bytebeat:3")
   ```
   hap: `{"note":"c2","s":"bytebeat","n":3}`（組み込み式 3 = `t*(t >> 10^t)`）
3. 自作の式（公式 JSDoc 例 + gain）
   ```js
   s("bytebeat").bbexpr('t*(t>>15^t>>66)').gain(.6)
   ```
   hap: `{"s":"bytebeat","byteBeatExpression":"t*(t>>15^t>>66)","gain":0.6}`
4. メロディ + フィルター。`bbst(0)` で毎回頭から鳴らす
   ```js
   note("c2 eb2 g2 bb2").s("bytebeat").bbexpr('t&t>>8').bbst(0).lpf(1800).release(.1)
   ```
   hap: `{"note":"c2",...,"byteBeatStartTime":0,"cutoff":1800,"release":0.1}`（`lpf` は内部で `cutoff` になる）
5. ユークリッドリズム + 減衰エンベロープ + crush + room
   ```js
   note("c1(3,8)").s("bytebeat").bbexpr('t*(t>>5|t>>8)').bbst(0)
     .decay(.15).sustain(0).crush(6).room(.3)
   ```
   hap の発音位置は 0, 3/8, 3/4（3,8 のユークリッド）。キーは `decay`、`sustain:0`、`crush:6`、`room:0.3`
6. 式をサイクルごとに切り替える（`<>` の代わりに pick）+ delay
   ```js
   note("c2*4").s("bytebeat")
     .bbexpr("<0 1 2>".pick(['t*(t>>9)', 't&t>>8', '(t*5&t>>7)|(t*3&t>>10)']))
     .bbst(0).delay(.25).delaytime(.1875)
   ```
   hap: サイクル 0 は `t*(t>>9)` が 4 つ、サイクル 1 は `t&t>>8` …
   代わりに `s("bytebeat").bbexpr(cat('t*(t>>9)', 't&t>>8')).freq(31.25)` でもよい（8kHz 相当の速さ。hap に `freq:31.25`）。
7. 開始位置を切り替え、フィルターを動かし、スコープを表示（上級）
   ```js
   note("<c1 g0>").s("bytebeat").bbexpr('t*((t>>12|t>>8)&63&t>>4)')
     .bbst("<0 65536 131072>").attack(.01).release(.5)
     .lpf(sine.range(400,4000).slow(8)).gain(.7)._scope()
   ```
   hap: サイクル 0 は `byteBeatStartTime:0, cutoff:2200`、サイクル 1 は `byteBeatStartTime:65536, cutoff:3472.79…`
8. ドラムと重ねる（上級）
   ```js
   stack(
     s("bd*4, ~ sd").bank("RolandTR909"),
     note("c2 [~ c2] eb2 [g1 c2]").s("bytebeat").bbexpr('t&t>>8|t*2&t>>6')
       .bbst(0).decay(.2).sustain(.2).lpf(2500).room(.2)
   )
   ```
   評価は成功（`bank` の付いたドラムの hap と bytebeat の hap が並ぶ）。※検証では末尾に `.cpm(32)` を付けたが、テンポは `setcpm(...)` で別に指定するほうが分かりやすい。
- 公式例 2 の `_scope()` 付き版も評価できた（`analyze:1` が付く）— [controls.mjs](https://unpkg.com/@strudel/core@1.2.6/controls.mjs)

### Inferences
- 例 8 の `bank("RolandTR909")` は、strudel.cc の既定のサンプルが読み込まれていないと鳴らない。Node では hap しか確認していない。
- 式の文字列は 1 イベントごとに新しい worklet に送られる（`o.port.postMessage({ codeText, ... })`。[synth.mjs](https://unpkg.com/superdough@1.3.0/synth.mjs)）。なので、式をイベント単位で切り替えても前の音には影響しない、と読める。

### Gaps
- どの例も音は聴いていない。音楽的に良いか、音量が適切かは未確認。
- 検証スクリプトは scratchpad の `bb_usage/h.mjs`（`@kabelsalat/web` をスタブにし、`_scope` もスタブ）。
