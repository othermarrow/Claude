# 1 行の式を音に変える Strudel の bytebeat

Strudel の `s("bytebeat")` は、**JavaScript の式 1 つを 1 サンプルごとに計算し、その値の下位 8 ビット（0〜255）を波形として鳴らす**シンセ音色です。式は `bbexpr('...')`（正式名 `byteBeatExpression`）で渡し、式を渡さないときは `bytebeat:N` の N で 15 個の組み込み式から 1 つが選ばれます。古典的な bytebeat では `t` が「1 秒に 8000 ずつ増えるカウンタ」ですが、**Strudel の `t` は「1 秒に 256 × 音の周波数」ずつ増えます**。このため `note()` を変えると、音の高さだけでなく式の中のリズムやメロディの速さも同じ割合で変わります。ネットで見つけた古典の式を本来の速さで鳴らすには、`.freq(31.25)` を付けます（256 × 31.25 = 8000）。`bbst(数値)`（正式名 `byteBeatStartTime`）を付けると、各音符が式の中の決まった位置から鳴り始めます。付けないと、AudioContext が動き始めてからの経過時間で決まる「途中の位置」から鳴ります。実用上いちばん大事な注意は、**式は必ずシングルクォート `'...'` で書く**ことです。ダブルクォートやバッククォートで書くとミニ記法として解析され、エラーになります。また、貼られたドキュメントにある別名 `bb` は、npm の最新版（@strudel/core 1.2.6 / superdough 1.3.0）には存在せず、`.bb()` はエラーになりました。以上は npm の配布ソースを読み、Node で実際に評価して確かめた内容です。**音は一度も聴いていません**。strudel.cc 本体にもこの環境からは接続できませんでした。

## 2011 年、8 kHz で鳴らす 1 行の C プログラムから始まった

bytebeat を始めたのは、フィンランドのデモシーナー **viznut（Ville-Matias Heikkilä）** です。2011 年 9 月 26 日に YouTube 動画「Experimental music from very short C programs」を公開し（[MatrixSynth](https://www.matrixsynth.com/2011/10/experimental-music-from-very-short-c.html)、[HN](https://news.ycombinator.com/item?id=3063359)）、10 月 2 日にブログ記事「Algorithmic symphonies from one line of code — how and why?」を書きました（[countercomplex](http://countercomplex.blogspot.com/2011/10/algorithmic-symphonies-from-one-line-of.html)）。代表例は `main(t){for(t=0;;t++)putchar(t*(((t>>12)|(t>>8))&(63&(t>>4))));}` という C プログラムです。これを `./a.out | aplay` のようにサウンドカードへ流すと、それらしい曲が聞こえます（[cdm.link](https://cdm.link/?p=20898)）。きっかけは、4mat の 23 バイトの C-64 デモ「Wallflower」と、viznut 自身の 16 バイトの VIC-20 での実験だったとされます（[mediacommons](https://mediacommons.org/imr/node/1751)）。その後、pouet.net の掲示板（topic 8357）に多くの人が式を投稿しました。10 月 28 日には解析記事「Some deep analysis of one-line music programs」が出て（[countercomplex](http://countercomplex.blogspot.com/2011/10/some-deep-analysis-of-one-line-music.html)）、12 月 6 日には論文 arXiv:1112.1368「Discovering novel computer music techniques by exploring the space of short computer programs」が投稿されました（[arXiv](https://arxiv.org/abs/1112.1368)）。論文の要旨には「算術演算が 3 つほどしかない無限ループでも、生の PCM として出力すると音楽のようなデータになる」とあり、発見は「単純な試行錯誤」から生まれたと書かれています。ただし、**これらの日付と要旨は検索結果の抜粋から取ったもので、ブログ、論文 PDF、pouet の本文は直接読めていません**。

古典的な bytebeat の約束事は次のとおりです。**整数 `t` を 0 から 1 ずつ増やし、サンプルごとに式を 1 回計算し、下位 8 ビットだけを残して、符号なし 8 ビット・8000 Hz の音として再生します**。その後、ブラウザ向けのツールがこれを引き継ぎました。greggman の HTML5 Bytebeat は README に「*t* is an 8000hz timer」と書いています（[html5bytebeat](https://github.com/greggman/html5bytebeat/blob/master/README.md)）。dollchan Bytebeat Composer は、Bytebeat、Signed Bytebeat、Floatbeat、Funcbeat の 4 つのモードを持っています。Bytebeat モードでは、値 `v` を `(v & 255) / 127.5 - 1` で -1〜1 の音声に変換します（[audio-processor.mjs](https://github.com/SthephanShinkufag/bytebeat-composer/blob/master/src/audio-processor.mjs)）。後で見るとおり、**Strudel の変換式はこの dollchan の Bytebeat モードと同じで、ソースのコメントにも dollchan 系の EnBeat から最適化を持ってきたと書かれています**（[superdough worklets.mjs](https://unpkg.com/superdough@1.3.0/worklets.mjs)）。

## ビット演算子は「数を 2 進数の電球の列として扱う」道具

`t` は、ずっと増え続けるカウンタだと考えてください。2 進数で書くと、`t` は電球が並んだ列です。右端の電球はサンプルごとに点いたり消えたりし、左の電球ほどゆっくり切り替わります。ビット演算子は、この電球の列を操作する道具です。音にとっての意味は、**「`& 255` で 0〜255 に折り返すので、`t` そのものは 256 サンプルごとに上がっては落ちるノコギリ波になる」**という一点から全部導けます。8 kHz で `t*N` と書くと、周波数は N × 8000 / 256 = **31.25 × N Hz** です。N を 2 倍にすると 1 オクターブ上がり、4:5 なら長 3 度、2:3 なら完全 5 度の音程になります（計算値。[arXiv](https://arxiv.org/pdf/1112.1368) の「t* class」の説明は検索結果の抜粋）。

| 演算子 | 平たく言うと | 音での役割（8 kHz の古典の場合） |
|---|---|---|
| `t>>N` | 2^N で割って余りを捨てる。「時計の針を遅くする」 | 2^N サンプルごとに 1 つ進む「シーケンサーの時計」。`t>>10` は約 0.128 秒、`t>>13` は約 1.02 秒、`t>>16` は約 8.2 秒ごとに進む |
| `t<<N` | 2^N 倍する | N オクターブ上げる（`t<<1` は `t*2` と同じ） |
| `a & b` | 両方で点いている電球だけ残す。「ふるい」 | 定数と組むと、出せる音高を限定してメロディを作る。信号どうしだとシェルピンスキー三角形のような倍音になる |
| `a \| b` | どちらかで点いている電球を残す。「重ね合わせ」 | 2 つのパターンを重ねる。`\| t>>4` でゆっくりしたうなりの層を足す |
| `a ^ b` | 違っている電球だけ残す | リングモジュレーションのような金属的な音色 |
| `a % P` | P で割った余り | 2 のべき乗以外の長さのループ（3 拍子など） |
| `条件 ? A : B` | 条件が真なら A、偽なら B | `t&4096 ? A : B` で約 0.5 秒ごとに 2 つの式を切り替える |

**`&` は `|` より、比較や `>>` は `&` より先に計算されます**。強い順に `* / %`、`+ -`、`<< >>`、比較、`&`、`^`、`|`、`?:` で、C と JS で同じです。このため、`t*5&t>>7` は `(t*5)&(t>>7)` と読まれます。古典の式を打ち直して「音が違う」ときは、たいていこの優先順位が原因なので、迷ったら括弧を足してください。具体例で見ると、42 メロディ `t*(42&t>>10)` の `42` は 2 進数で `101010` です。`42 & (t>>10)` は {0, 2, 8, 10, 32, 34, 40, 42} の 8 つの値しか取らないので、**8 kHz では 1 音が 0.256 秒、32 音で一巡し、一巡は 8.192 秒**になります。倍率が 0 になるところは無音です（計算値）。もう 1 つ JS 特有の点として、**シフト量は 32 で割った余りとして扱われます**。このため、公式例の `t>>66` は実際には `t>>2` と同じです（66 mod 32 = 2。JS の仕様からの計算値）。

## Strudel の t は 1 秒に「256 × 周波数」だけ進む

bytebeat 音源は superdough 1.2.3（2025-05-29 公開）で初めて npm 版に入りました。`synth.mjs` に `registerSound('bytebeat', …)` として登録されていて、実際の音は AudioWorklet の `byte-beat-processor` が 1 サンプルずつ計算します（[superdough synth.mjs](https://unpkg.com/superdough@1.3.0/synth.mjs)、[worklets.mjs](https://unpkg.com/superdough@1.3.0/worklets.mjs)）。元になった変更は Codeberg の PR「feat: Byte Beats! #1354」と「Byte Beat improvements -> 2 #1357」です（[#1354](https://codeberg.org/uzu/strudel/pulls/1354)、[#1357](https://codeberg.org/uzu/strudel/pulls/1357)。どちらも検索結果のタイトルと抜粋だけで、本文は読めていません）。worklet の中心部分は次の 3 行です。

```js
const local_t = (256 / sampleRate) * freq * this.t + this.initialOffset; // this.t はサンプルごとに +1
const signal  = (this.func(local_t) & 255) / 127.5 - 1;
const out     = clamp(signal * 0.2, -0.4, 0.4);
```

ここから次の 3 つのことが分かります。1 つ目に、**式の中の `t` は 1 秒あたり 256 × f だけ進みます**（f は音符の周波数）。サンプリングレートは式から消えるので、44.1 kHz でも 48 kHz でも速さは同じです。周波数は `note`、`freq`、`octave` から決まり、何も指定しないと **MIDI 36（C2、約 65.41 Hz）なので約 16,744/秒**です（[helpers.mjs](https://unpkg.com/superdough@1.3.0/helpers.mjs)）。`note("c3")` なら約 33,488/秒、`note("a4")` なら 112,640/秒になります。8 kHz の古典と同じ速さになるのは **f = 8000 / 256 = 31.25 Hz** のときで、`.freq(31.25)` を付ければ古典の式を本来の音程とテンポで鳴らせる計算になります。`note("c1")`（約 32.70 Hz、8,372/秒）はそれより約 4.6% 速くなります。この仕組みでは、`t` そのもの（周期 256 のノコギリ波）が**ちょうど音符の音程で鳴ります**。そして `t>>13` のような遅い構造も音程に比例して速くなります。つまり Strudel の bytebeat は「1 本の式を、音程と一緒に早回し・遅回しする楽器」です。2 つ目に、**出力の振幅は最大でも ±0.2** で、`clamp(±0.4)` は実際には効きません。さらにその後ろで `gain`（既定 0.8）が掛かるので、ほかの音源より小さめに聞こえるはずです。3 つ目に、`t` は小数になります。`& | ^ >>` は内部で整数に変換してから計算しますが、`sin(t)` や `t/255` は小数のまま計算されます。

式は `new Function` でコンパイルされる JavaScript の**式 1 つ**です。`sin`、`cos`、`PI`、`floor`、`abs`、`random` など `Math` のプロパティを `Math.` なしで書けます。`int`（= `Math.floor`）と、dollchan 系の補助関数 `bitC(x,y,z)`（`x&y ? z : 0`）、`br`（ビット反転）、`sinf`/`cosf`/`tanf`（256 ステップで 1 周）、`regG` も使えます（[worklets.mjs](https://unpkg.com/superdough@1.3.0/worklets.mjs)）。**`let x=…;` のような文は書けません**。カンマ演算子、三項演算子、`(()=>{…})()` は使えます。戻り値は 0〜255 の範囲に収まるように書くのが前提です。`sin(...)` を加工せずに返すと、ほぼ 0 か 255 に丸められて意図した波形になりません。プリセット 9 のように `sin(...)*127+127` とします。構文エラーや未定義の変数があっても superdough は `processorerror` を処理していないので、**その音符が黙って無音になる**とソースからは読めます。REPL の画面にエラーが表示されるかは確認できていません。

音量のエンベロープは linear の ADSR で、既定値は attack 0.001、decay 0.05、sustain 0.6、release 0.01 です（[synth.mjs](https://unpkg.com/superdough@1.3.0/synth.mjs)）。`lpf`、`room`、`delay`、`crush`、`_scope()` といった共通のエフェクトや表示は、ほかのシンセと同じように使えます。一方、`penv`、`vib`、`fm` は bytebeat の synth 関数が呼んでいないので、効かないはずです（ソースからの推論）。

## 式は必ずシングルクォートで書く。`bb` という別名はない

strudel.cc の REPL では、トランスパイラが**ダブルクォート `"…"` とバッククォート `` `…` `` の文字列をミニ記法に書き換え、シングルクォート `'…'` の文字列だけを素の文字列のまま残します**（[transpiler.mjs](https://unpkg.com/@strudel/transpiler@1.2.6/transpiler.mjs)）。Node で実際に評価すると、`.bbexpr('t*(t>>15^t>>66)')` は成功しました。一方、同じ式をダブルクォートやバッククォートで書くと `[mini] parse error ... but "(" found.` になり、`.bbexpr("t&t>>8")` も `"&" found` でエラーになりました（Node での実測。[transpiler.mjs](https://unpkg.com/@strudel/transpiler@1.2.6/transpiler.mjs)）。さらに分かりにくい罠として、**`.bbexpr('<t t&t>>8>')` はエラーにならないのに交互にもなりません**。`<t t&t>>8>` という文字列がそのまま「式」として worklet に届き、JS として不正なので無音になる、という読みです。式をサイクルごとに切り替えたいときは、JS 側の関数でシングルクォートの文字列を並べます。`.bbexpr(cat('t*(t>>9)', 't&t>>8'))` と `.bbexpr("<0 1>".pick(['t*(t>>9)', 't & t>>8']))` は、どちらもサイクルごとに切り替わることを確認しました。`pick` の配列の中でも、式はシングルクォートで書いています。なお、`@strudel/web` で自分のページに埋め込む場合は既定で `miniAllStrings()` が有効になり、シングルクォートでもパースエラーになりました。その場合は `pure('...')` で包むと成功しました（[web.mjs](https://github.com/tidalcycles/strudel/blob/main/packages/web/web.mjs)）。strudel.cc 本体だけを使うなら、この点は気にしなくて大丈夫です。

別名について。`@strudel/core` 1.2.6 の登録は `registerControl('byteBeatExpression', 'bbexpr')` と `registerControl('byteBeatStartTime', 'bbst')` の 2 つだけです（[controls.mjs](https://unpkg.com/@strudel/core@1.2.6/controls.mjs)）。**`bb` はどこにも登録されておらず、`.bb(...)` は Node で `s(...).bb is not a function` になりました**。ただし、今の strudel.cc で動いているのは npm に未公開の Codeberg main ブランチかもしれず、そちらに `bb` が追加されている可能性は否定できません。strudel.cc と Codeberg に接続できなかったので、ここは未確認です。確実に動くのは `bbexpr` と `byteBeatExpression` なので、コードではそちらを使ってください。

## `bytebeat:N` は 15 個の組み込み式、`bbst` は「どこから鳴らすか」

`s("bytebeat:5")` は `s:"bytebeat"` と `n:5` に分かれます。`bbexpr` を指定しないときは `defaultBeats[n % 15]` が選ばれ、`bbexpr` を指定すると n に関係なくそちらが優先されます（[synth.mjs](https://unpkg.com/superdough@1.3.0/synth.mjs)）。`bytebeat:15` は 0 番、`bytebeat:20` は 5 番と同じです。負の n や小数の n では式が `0` になり、-0.2 の直流しか出ません（推論）。

| N | 式（ソースのまま） | ソースから読める性格（音は未確認） |
|---|---|---|
| 0 | `(t%255 >= t/255%255)*255` | 0 と 255 を行き来する矩形波で、幅がゆっくり変わる（パルス幅変調のような音） |
| 1 | `(t*(t*8%60 <= 300)\|(-t)*(t*4%512 < 256))+t/400` | 上がるノコギリ波と下がるノコギリ波の切り替え。`t/400` でゆっくりずれていく |
| 2 | `t` | 純粋なノコギリ波。音符の音程そのまま |
| 3 | `t*(t >> 10^t)` | 音程が激しく動く、ノイズに近い音 |
| 4 | `t&128` | 0 と 128 の矩形波（片側に寄った波形） |
| 5 | `t&t>>8` | 「minimal sierpinski harmony」。公式例 2 で使われている |
| 6 | `((t%255+t%128+t%64+t%32+t%16+t%127.8+t%64.8+t%32.8+t%16.8)/3)` | 倍音のノコギリ波を、少しずらして重ねたもの（デチューンのコーラス） |
| 7 | `((t%64+t%63.8+t%64.15+t%64.35+t%63.5)/1.25)` | ほぼ同じ周期のノコギリ波 5 本（スーパーソウ風。4 倍の高さ） |
| 8 | `(t&(t>>7)-t)` | `-` が `&` より先に計算されるので `t&((t>>7)-t)` |
| 9 | `(sin(t*PI/128)*127+127)` | サイン波 |
| 10 | `((t^t/2+t+64*(sin((t*PI/64)+(t*PI/32768))+64))%128*2)` | XOR とサイン波で揺れる音色 |
| 11 | `((t^t/2+t+64*(cos >> 0))%127.85*2)` | `cos >> 0` は 0 になるので、実質 `(t^t/2+t)%127.85*2` |
| 12 | `((t^t/2+t+64)%128*2)` | 10 番から揺れを除いた形 |
| 13 | `(((t * .25)^(t * .25)/100+(t * .25))%128)*2` | t を 1/4 にした XOR 系（周期が 512 になり、1 オクターブ低い） |
| 14 | `((t^t/2+t+64)%7 * 24)` | 7 段の階段状の、ざらついた音 |

`bbst` は、指定すると**その音符の開始時に `t` を 0 に戻し、`floor(bbst)` を周波数で拡大縮小せずに足します**。単位は「式の中の t」で、出力のサンプル数ではありません。指定しないと、音符ごとに新しく作られる worklet ノードが `t = 開始時刻 × sampleRate`（AudioContext が動き始めてからの絶対サンプル数）から計算を始めます（[worklets.mjs](https://unpkg.com/superdough@1.3.0/worklets.mjs)）。このため、**`bbst` なしでは同じ音符を繰り返しても毎回式の違う部分が鳴り、`bbst(0)` を付けると毎回同じ頭（アタック）から鳴ります**。ドラムのように毎回同じ音にしたいなら `bbst(0)`、時間とともに変わっていくテクスチャがほしいなら `bbst` なし、と使い分けます。`bbst` はパターンにもできます。ただし superdough に `byteBeatStartTime` という AudioParam はないので、信号で連続的に動かすモジュレーションは効かないはずです（推論）。

## 公式例 2 つを分解して読む

例 1 の `s("bytebeat").bbexpr('t*(t>>15^t>>66)')` は、1 サイクルに 1 つの音符を出し、その中で式を鳴らし続けます。テストのスナップショットとも一致しました（[examples.test.mjs.snap](https://github.com/tidalcycles/strudel/blob/main/test/__snapshots__/examples.test.mjs.snap)）。`>>` は `^` より先に計算されるので、式は `t*((t>>15)^(t>>66))` です。前に書いたとおり `t>>66` は `t>>2` と同じなので、**実体は `t*((t>>15)^(t>>2))`** です。note がないので C2 が基準になり、`t` は約 16,744/秒で進みます。倍率のうち `t>>15` は約 2 秒ごとに切り替わり、`t>>2` は速く動いて、ざらついた音色の素になります。`bbst` がないので、再生を続けるほど `t` が大きくなり、音色が変わっていくはずです（いずれもソースと JS の仕様からの計算で、音は未確認）。

例 2 の `note("c3!8".add("{0 0 12 0 7 5 3}%8")).s("bytebeat:5").bbst("<3 1>".mul(10000))._scope()` は、評価すると 1/8 サイクルごとに音符が並び、**note は 48, 48, 60, 48, 55, 53, 51, 48** になりました。`{…}%8` は 7 個の値を 8 拍に流し込む書き方なので、2 小節目からは区切りがずれていきます。音色は組み込み式 5 番 `t&t>>8` です。`byteBeatStartTime` はサイクル 0 で 30000、サイクル 1 で 10000 になり、交互に切り替わります（スナップショットと一致）。つまり 1 小節目は式の 30000 の地点から、2 小節目は 10000 の地点から各音が鳴り始めます。`t&t>>8` では `t>>8` の値（30000 付近なら 117 前後、10000 付近なら 39 前後）が「ふるい」の形を決めるので、**同じメロディでも小節ごとに音色が切り替わる**のがこの例の狙いだと読めます。`_scope()` はブラウザ専用の、コードの下に出るオシロスコープ表示です（[widget.mjs](https://github.com/tidalcycles/strudel/blob/main/packages/codemirror/widget.mjs)）。振幅が ±0.2 程度なので、波形は小さめに表示される可能性があります。

## 有名な式は誰のものか：出典つきの一覧

作者は、dollchan Bytebeat Composer の曲ライブラリの記録に従います。このライブラリは、式ごとに pouet のコメント、viznut の式リスト、viznut の動画へのリンクを付けて作者を記録しています（[classic.gz](https://github.com/SthephanShinkufag/bytebeat-composer/blob/master/data/library/classic.gz)）。どれも 8000 Hz 用の式なので、**Strudel で本来の速さで鳴らすには `.freq(31.25)` を付けます**。元の pouet の投稿や viznut の式リストは直接読めていないので、作者はライブラリの記録に依拠しています。

| 式 | 名前 | 作者（ライブラリの記録） | 日付 |
|---|---|---|---|
| `t*(((t>>12)\|(t>>8))&(63&(t>>4)))` | （viznut のブログと動画の代表例） | viznut | 2011-09-18 |
| `t&t>>8` | minimal sierpinski harmony | viznut（miiro の式のリミックス） | — |
| `t*5&(t>>7)\|t*3&(t*4>>10)` | Sierpinski harmony | miiro | 2011-09-30 |
| `(t*5&t>>7)\|(t*3&t>>10)` | Long Sierpinski Harmony | viznut（miiro の式から） | 2011-10-10 |
| `t*(42&t>>10)` | the 42 melody | 特定の作者なし（IRC で複数人が別々に発見） | — |
| `(t*(t>>5\|t>>8))>>(t>>16)` | （無題） | tejeez | 2011-09-18 |
| `t*(((t>>11)&(t>>8))&(123&(t>>3)))` | （無題） | tejeez | 2011-09-18 |
| `((t*(t>>8\|t>>9)&46&t>>8))^(t&t>>13\|t>>6)` | Lost in Space | xpansive | 2011-09-29 |
| `(t>>6\|t\|t>>(t>>16))*10+((t>>11)&7)` | Sin() isn't kosher, people! | viznut | 2011-09-30 |
| `(t>>7\|t\|t>>6)*10+4*(t&t>>13\|t>>6)` | Combined xpansive's and varjohukka's stuff | viznut | 2011-09-30 |
| `(t*((3+(1^t>>10&5))*(5+(3&t>>14))))>>(t>>8&3)` | Another attempt at melody construction | viznut | 2011-10-04 |
| `t*(0xCA98CA98>>(t>>9&30)&15)\|t>>8` | CA98 | rrrola | 2011-10-04 |
| `t*(4+(t>>9)%3)&t/3>>7&224` | I'm late to the party | rrrola | 2011-09-30 |
| `(t&4096)?((t*(t^t%255)\|(t>>4))>>1):(t>>3)\|((t&8192)?t<<2:t)` | Street Surfer | skurk, raer | 2011-09-30 |
| `(t/8)>>(t>>9)*t/((t>>14&3)+4)` | mr. arpeggiator playing a solo | tonic | 2011-10-01 |
| `t%(t/(t>>9\|t>>13))` | （無題） | xpansive | 2012-02-25 |

（表の `\|` は Markdown 用のエスケープです。コピーするときは `|` にしてください。）

いくつか注意があります。よく見かける `t*(t>>5|t>>8)` は単独の作品ではなく、tejeez の `(t*(t>>5|t>>8))>>(t>>16)` の核の部分です。`(t*5&t>>7)|(t*3&t>>10)` は作者なしで紹介されることが多いですが、「miiro の式をもとにした viznut の作品」とするのが正確です。rrrola の CA98 は、16 進定数 `0xCA98CA98` の 4 ビットずつを音高の表として読む書き方で、**決まったメロディを書きたいときの手本**になります。もう 1 つ、viznut の解析記事の抜粋に「`t*(5+((t>>11)&5))` は倍率 4, 5, 8, 9 で E3, G3, C4, D4 の音階になる」という一文が出てきます（[deep analysis](http://countercomplex.blogspot.com/2011/10/some-deep-analysis-of-one-line-music.html)）。しかし `(t>>11)&5` は {0, 1, 4, 5} なので、倍率は実際には 5, 6, 9, 10 です。**抜粋の段階で式か説明が崩れていると判断し、この式はこのレポートでは使いません**。

## そのまま貼れるコード例：初級から上級へ

以下の 1〜8 は @strudel/core・mini・transpiler 1.2.6 で**エラーなく評価でき、意図したコントロールが音符（hap）に入ることを Node で確認したもの**です。音は聴いていません。strudel.cc の編集画面に 1 つずつ貼り、再生ボタン（または Ctrl+Enter）で試してください。

```js
// 1. 組み込み式を n で切り替える（1 サイクルごとに 0→2→3→4 番）
s("bytebeat").n("<0 2 3 4>").note("c2")
```

```js
// 2. bytebeat:N の省略形（3 番 = t*(t >> 10^t)）
note("c2").s("bytebeat:3")
```

```js
// 3. 自分の式（公式例 1 に音量を足したもの）
s("bytebeat").bbexpr('t*(t>>15^t>>66)').gain(.6)
```

```js
// 4. メロディとフィルター。bbst(0) で毎回同じ頭から鳴らす
note("c2 eb2 g2 bb2").s("bytebeat").bbexpr('t&t>>8').bbst(0).lpf(1800).release(.1)
```

```js
// 5. ユークリッドリズム (3,8) と、短く減衰するエンベロープ
note("c1(3,8)").s("bytebeat").bbexpr('t*(t>>5|t>>8)').bbst(0)
  .decay(.15).sustain(0).crush(6).room(.3)
```

5 の `c1(3,8)` は、8 ステップに 3 回を均等に置くユークリッド記法で、発音位置は 0、3/8、3/4 になりました。回転の向きなど詳しいことは、以前のレポート [Strudel ユークリッド記法 解説](<Strudel ユークリッド記法 解説.md>) にあります。

```js
// 6. 式をサイクルごとに切り替える（'<a b>' ではなく pick を使う）
note("c2*4").s("bytebeat")
  .bbexpr("<0 1 2>".pick(['t*(t>>9)', 't&t>>8', '(t*5&t>>7)|(t*3&t>>10)']))
  .bbst(0).delay(.25).delaytime(.1875)
```

```js
// 7. 開始位置の切り替え、ゆっくり動くフィルター、スコープ表示
note("<c1 g0>").s("bytebeat").bbexpr('t*((t>>12|t>>8)&63&t>>4)')
  .bbst("<0 65536 131072>").attack(.01).release(.5)
  .lpf(sine.range(400,4000).slow(8)).gain(.7)._scope()
```

```js
// 8. ドラムと重ねる（strudel.cc の既定のサンプルが読み込まれている前提）
stack(
  s("bd*4, ~ sd").bank("RolandTR909"),
  note("c2 [~ c2] eb2 [g1 c2]").s("bytebeat").bbexpr('t&t>>8|t*2&t>>6')
    .bbst(0).decay(.2).sustain(.2).lpf(2500).room(.2)
)
```

古典の式を「曲」として流したいときは、次のように書くのが理屈に合っています。**この組み合わせ自体は Node で評価していません**。`s("bytebeat").bbexpr(cat(...)).freq(31.25)` が評価できることは確認済みで、`sustain` は普通のコントロールです。

```js
// 9.（未評価）42 メロディを 8 kHz 相当の速さで流しっぱなしにする
s("bytebeat").bbexpr('t*(42&t>>10)').freq(31.25).sustain(1)
```

`bbst` を付けないと、`t` は AudioContext の経過時間 × 8000 になります。音符が切り替わっても式は途切れずに続く計算です。`sustain(1)` は、既定の 0.6 まで音量が下がるのを避けるために付けています。サイクルの境目ごとにエンベロープが掛け直されるので、小さなプツッという音が出るかもしれません。

音作りのコツは 3 つあります。1 つ目は**直流成分（DC オフセット）**です。`t&128` や `t&t>>8` のように 0 が多い式では、波形の平均が負の側に寄ります。そのため、音の出だしと終わりでクリックが出やすくなります。`.hpf(20)` などで低域を切ると軽くなるはずです（未確認）。2 つ目は**音量**です。出力が ±0.2 に抑えられているので、ほかの音と混ぜるときは `gain` や `postgain` で持ち上げます。古典の資料にある「`&128` や `&64` を付けて矩形波にすると、ノコギリ波より澄んだ音になる」というコツも、そのまま使えます（[deep analysis](http://countercomplex.blogspot.com/2011/10/some-deep-analysis-of-one-line-music.html)、検索結果の抜粋）。3 つ目は **CPU 負荷**です。音符ごとに新しい AudioWorklet ノードを作り、1 サンプルごとに JS 関数を呼ぶ作りなので、細かい音符を何重にも重ねたり、`sin` を何重にも入れたりすると、Xperia の Chrome では音切れしやすいと考えられます（実機では未確認）。なお、式は任意の JavaScript として実行されます。他人のコードを貼るときは中身を一度見てください（実行場所は worklet の中なので、ページそのものには触れません）。

## 確認できたこと、できなかったこと

**Node とソースで確認したこと**は次のとおりです。コントロール名と別名（`bbexpr`/`bbst` はあり、`bb` はない）、引用符による成功と失敗、`cat`/`pick` による切り替え、2 つの公式例の評価結果（スナップショットと一致）、例 1〜8 の評価、`t` の速さの式、出力の変換と 0.2 倍、組み込みの 15 式、`bbst` の処理です。いずれも npm の `@strudel/core` 1.2.6（2026-01-17）と `superdough` 1.3.0（2026-01-18）で確かめました。**確認していないこと**も挙げておきます。まず、実際の音（音色、音量のバランス、クリック、`hpf` の効果）は一度も聴いていません。次に、strudel.cc で今動いている版、特に `bb` が追加されていないかは分かりません（strudel.cc と Codeberg に接続できませんでした）。式にエラーがあったとき REPL に表示が出るか、Android の Chrome での負荷も未確認です。歴史の日付、論文の要旨、viznut のコツは検索結果の抜粋から取ったもので、viznut のブログ、arXiv、pouet は開けませんでした。有名な式の作者は dollchan ライブラリの記録に従っています。

## Conclusion

Strudel の bytebeat の本質は、「8 kHz で 1 曲を流すプログラム」だった古典の bytebeat を、**`t` の進み方を音程に結び付けることで、音程のある 1 つの音色に作り変えた**点にあります。このため、同じ式でも 2 通りの使い方ができます。音符の音程と `bbst(0)` で切り出せば「鍵盤で弾ける波形」になり、`.freq(31.25)` と `bbst` なしで流せば「2011 年の作品の再生」になります。どちらで使っているかを意識すると、「音程を変えたらリズムまで変わった」という戸惑いはほとんど解消します。

実際にコードを書くときに効いてくるのは、音そのものより文字列の扱いです。シングルクォートで書くこと、`'<a b>'` ではなく `cat`/`pick` を使うこと、`bb` ではなく `bbexpr` を使うこと。この 3 点を守れば、古典の式も自作の式も、スマホの strudel.cc にそのまま貼って試せます。試すときは、viznut たちと同じように、定数を 1 つずつ変えては聴く方法がいちばんの近道です。
