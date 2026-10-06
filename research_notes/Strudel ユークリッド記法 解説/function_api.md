# Strudel のユークリッド関連関数 API リファレンス（ソースで確認済み）

**調査方法と制約（最初に読むこと）**
- 確認に使ったのは、npm で公開されている `@strudel/core@1.2.6` と `@strudel/mini@1.2.6`（2026-01-17 公開。調査日 2026-10-06 時点の npm 最新版）のソースです。package.json の repository は `git+https://codeberg.org/uzu/strudel.git`。 — [npm @strudel/core](https://www.npmjs.com/package/@strudel/core)
- この環境からは strudel.cc、codeberg.org、uzu.lurk.org に届きませんでした（egress proxy で遮断）。`raw.githubusercontent.com/tidalcycles/strudel/main/...` は 404 でした（Codeberg へ移った後の状態と推測。未確認）。そのため **strudel.cc の Web 上のリファレンスは直接読めていません**。ただし strudel.cc の関数リファレンスは、ソースの JSDoc コメント（`@name`、`@param`、`@example`）から作られています。以下で「JSDoc」と書いたものは、そのリファレンスの元テキストです。
- 下に出てくる時刻（cycle 内の分数）は、Node.js 22 で `@strudel/core` と `@strudel/mini` を読み込み、`queryArc` を実際に実行して得た値です（`miniAllStrings()` で文字列をミニ記法として扱わせて実行。REPL と同じ扱い）。音は鳴らしていないので、**音として確認したものはありません**。
- 主な一次ソースのファイルは `packages/core/euclid.mjs`、`packages/core/pattern.mjs`（`register`）、`packages/core/util.mjs`（`rotate`）、`packages/core/test/euclid.test.js`、`packages/mini/mini.mjs` です。以下、[euclid.mjs] のように略して書きます。参照 URL は [Codeberg: packages/core/euclid.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs) です。読んだのは npm tarball の中身で、内容は同じファイルのはずです（main ブランチの最新と完全に一致するかは未確認）。

## Q1. 現在の Strudel にあるユークリッド関連関数と、そのシグネチャ

### Takeaway
1.2.6 で定義されているのは `euclid`、`euclidRot`（別名 `euclidrot`）、`euclidLegato`、`euclidLegatoRot`、`euclidish`（別名 `eish`）、`bjork` の 6 種類（名前は 8 個）です。Tidal にある `euclidOff`／`eoff`、`euclidOffFull`、`euclidFull`、`euclidInv` は **Strudel にはありません**。

### Cited Findings
- `euclid(pulses, steps)`：`pat.struct(_euclidRot(pulses, steps, 0))` で定義されています。つまり「Bjorklund で作った 0/1 配列を struct に渡す」だけの関数です。JSDoc の例は `note("c3").euclid(3,8)`（キューバのトレシージョ）。 — [euclid.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs)
- `euclidRot(pulses, steps, rotation)`：`register(['euclidrot', 'euclidRot'], ...)` で登録されています。**`euclidrot`（全部小文字）も同じ関数の別名**です。JSDoc の例は `note("c3").euclidRot(3,16,14)`（ブラジルのサンバ）。 — [euclid.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs)
- `euclidLegato(pulses, steps)`：`register(['euclidLegato'], function (pulses, steps, pat) {...})` なので、取る引数は 2 つです。JSDoc には `@param rotation` も書かれていますが、実装は受け取りません（ドキュメント側の不整合）。例は `note("c3").euclidLegato(3,8)`。 — [euclid.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs)
- `euclidLegatoRot(pulses, steps, rotation)`：例は `note("c3").euclidLegatoRot(3,5,2)`。 — [euclid.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs)
- `euclidish(pulses, steps, groove)`（別名 `eish`）：groove が 0 なら `euclid` と同じ、1 なら等間隔の pulse になり、その間を連続的に変化させます。JSDoc には「`sound("bd").euclidish(3,8,0)` は `sound("bd").euclid(3,8)` と同じ、`euclidish(3,8,1)` は `sound("bd bd bd")` と同じ。Malcom Braff の仕事に触発された」とあります。例は `sound("hh").euclidish(7,12,sine.slow(8)).pan(sine.slow(8))`。実装は `_morph(bjorklund(pulses, steps), new Array(pulses).fill(1), perc)` の後に `.setSteps(steps)` です。 — [euclid.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs)
- `bjork(euc)`：配列 `[pulses, steps = pulses, rot = 0]` を 1 つの引数として受け取ります。**JSDoc がない**ので、関数リファレンスには載っていないと考えられます（Web 上では未確認）。 — [euclid.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs)
- `bjorklund(ons, steps)` はパターン関数ではなく、0/1 の配列を返すユーティリティです（`export const bjorklund`）。テストでは `bjorklund(3,8)` → `[1,0,0,1,0,0,1,0]`、`bjorklund(5,8)` → `[1,0,1,1,0,1,1,0]`、`bjorklund(-3,8)` → `[0,1,1,0,1,1,0,1]`。 — [euclid.test.js](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/test/euclid.test.js)
- 実行して確かめたこと：`Pattern.prototype` に `euclid`、`euclidRot`、`euclidrot`、`euclidLegato`、`euclidLegatoRot`、`euclidish`、`eish`、`bjork` は存在しました。`euclidOff`、`euclidOffFull`、`euclidFull`、`euclidInv` は `undefined` でした（@strudel/core 1.2.6 をローカルで実行）。 — [npm @strudel/core 1.2.6](https://www.npmjs.com/package/@strudel/core)
- 比較のための Tidal 側の定義：`euclidOff`／`eoff`（`_euclidOff n k s p = ... (rotL $ fromIntegral s % fromIntegral k) (_euclid n k p)`）、`euclidInv`（`_euclid (-n) k a`）、`euclidFull n k pa pb = stack [euclid n k pa, euclidInv n k pb]`。 — [Tidal UI.hs](https://raw.githubusercontent.com/tidalcycles/Tidal/main/tidal-core/src/Sound/Tidal/UI.hs)
- JSDoc のコメントブロックには、世界の伝統リズムの例が並んでいます：(2,5) Khafif-e-ramal、(3,4) クンビア／カリプソ、(3,7) ルチェニツァ、(3,8) トレシージョ、(4,9) トルコの Aksak、(5,8) シンキージョ、(5,12) Venda、(5,16) ボサノバ、(7,12) 西アフリカのベル、`euclidRot(7,16,14)` サンバ、`euclidRot(11,24,14)` と `euclidRot(13,24,5)` アカ・ピグミー など。 — [euclid.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs)

### Inferences
- Tidal の関数の代わりになる書き方（いずれも実行して出力を確認済み）：
  - `euclidInv(3,8)` → pulses を負にします：`s("hh").euclid(-3,8)`。結果は onset 1/8, 2/8, 4/8, 5/8, 7/8（反転パターン）。
  - `euclidFull(3,8,a,b)` → `stack(a.euclid(3,8), b.euclid(-3,8))`。
  - `euclidOff(3,8,2)`（Tidal の左回転）→ `euclid(3,8).early(2/8)` か `euclidRot(3,8,-2)`（下の Q2 を参照）。
- `euclidLegato` に 3 つ目の引数を渡す書き方は JSDoc を読むと誤解しやすいです。回転させたいときは `euclidLegatoRot` を使います。

### Gaps
- Codeberg の main ブランチが 1.2.6 より新しく、関数が追加されているかどうかは、codeberg.org に届かなかったため確認できていません。
- strudel.cc/functions のページそのものは読めていません（`bjork` が載っていないことも推測です）。

## Q2. euclidLegato の違いと、euclidRot の回転方向

### Takeaway
`euclidLegato` は各 onset の長さを「次の onset の直前まで」に伸ばし、隙間をなくします。`euclidRot` の回転は**右回り（後ろへずらす）**で、`euclid(p,s).late(r/s)` と同じ結果になります。これは **Tidal の `x(3,8,2)`（`rotL`、前へずらす）と逆方向**で、注意が必要です。

### Cited Findings
- `_euclidRot` は `rotate(b, -rotation)` を呼びます。`rotate = (arr, n) => arr.slice(n).concat(arr.slice(0, n))` なので、n が負のときは配列の末尾が先頭に回ってきます。つまり右回転です。 — [euclid.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs)、[util.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/util.mjs)
- 公式テストもこの挙動を期待値にしています：`fastcat('a').euclidRot(3, 8, 2)` → `['0/1 → 1/8: a', '1/4 → 3/8: a', '5/8 → 3/4: a']`。元の x..x..x.（0, 3/8, 6/8）が x.x..x..（0, 2/8, 5/8）になります。 — [euclid.test.js](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/test/euclid.test.js)
- 実行して確かめた結果：`euclidRot(3,8,2)` = `euclid(3,8).late(2/8)` = 0, 1/4, 5/8。`euclid(3,8).early(2/8)` = `euclidRot(3,8,-2)` = 1/8, 1/2, 3/4。 — [npm @strudel/core 1.2.6](https://www.npmjs.com/package/@strudel/core)
- Tidal の定義は `rotL $ s % k`（左回転、つまり前へずらす）。そのため Tidal で `"bd(3,8,2)"` と書くと onset は 1/8, 4/8, 6/8 になると計算できます（Tidal は実行していません。定義から求めた値）。 — [Tidal UI.hs](https://raw.githubusercontent.com/tidalcycles/Tidal/main/tidal-core/src/Sound/Tidal/UI.hs)
- ミニ記法の第 3 引数も `euclidRot` を通ります。`mini.mjs` は `case 'bjorklund'` の中で、rotation があれば `pat.euclidRot(pulse, step, rotation)` を、なければ `pat.euclid(pulse, step)` を呼びます。つまり `"bd(3,8,2)"` も右回転です。 — [mini.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/mini/mini.mjs)
- `_euclidLegato` の処理：`pulses < 1` なら `silence` を返します。そうでなければ 0/1 配列を `'1'` で区切り、各区間の長さ（その 1 と後ろに続く 0 の数）を `timeCat` の重みにします。その後 `.late(Fraction(rotation).div(steps))` で回転させます。 — [euclid.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs)
- 実行して確かめた結果：`euclidLegato(3,8)` = 0–3/8, 3/8–3/4, 3/4–1（隙間なし）。`euclidLegatoRot(3,8,2)` = 0–1/4, 1/4–5/8, 5/8–1（1 つ目は 6/8 から 1 周して戻ってくる音の後半部分。onset はやはり後ろへずれています）。比べると `euclid(3,8)` はどの音も長さ 1/8 です。 — [npm @strudel/core 1.2.6](https://www.npmjs.com/package/@strudel/core)
- `euclidLegato(-3,8)` と `euclidLegato(0,8)` は無音でした（`pulses < 1` の分岐）。これに対して `euclid(-3,8)` は反転パターンを返すので、**負の pulses は euclidLegato では使えません**。 — [euclid.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs)

### Inferences
- `euclidLegato` が変えるのはイベント（hap）の長さです。シンセ（`s("sawtooth")` など）ではこれが音の長さになり、ベースのように音を伸ばしたいパートに向いています。サンプルは hap の長さに関係なく最後まで再生されるのが普通で、長さで切るには `.clip(1)` などが要ると考えられます。ただしこれは superdough の挙動で、**今回は確認していません**。
- Tidal の曲を移植するときは、回転の値を `steps - r` にするか、`euclidRot(p,s,-r)` を使えば Tidal と同じ位置になります。

### Gaps
- 公式ドキュメントやフォーラムが Strudel と Tidal の回転方向の違いを説明しているかは、strudel.cc と uzu.lurk.org に届かず確認できていません（検索結果に「Euclid legato without silence」というスレッドがあったが本文は未読 — [uzu.lurk.org](https://uzu.lurk.org/t/euclid-legato-without-silence/2754)）。

## Q3. 引数をパターンにできるか（例：`.euclid("<3 5>", 8)`）

### Takeaway
できます。すべて `register()` で登録されているので、引数は自動でパターンとして扱われます。`"<3 5>"` のように cycle ごとに切り替えたり、`"3 5"` のように 1 cycle の中で切り替えたりできます。ミニ記法の中でも `"bd(<3 5>,8,<0 2>)"` のように書けます。

### Cited Findings
- `register(name, func, patternify = true, ...)` は各引数を `reify` してパターンにします。すべて pure なら関数をそのまま呼び、そうでなければ `appLeft` と `innerJoin` で組み合わせます。 — [pattern.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/pattern.mjs)
- 実行して確かめた結果：`a.euclid("<3 5>",8)` は cycle 0 で 3 拍（0, 3/8, 6/8）、cycle 1 で 5 拍（0, 2/8, 3/8, 5/8, 6/8）。`euclid(3,"<8 16>")`、`euclidRot(3,8,"<0 2>")`、`euclidLegato("<3 5>",8)` も cycle ごとに切り替わりました。`euclid("3 5",8)` は前半が (3,8)、後半が (5,8) の部分を切り出したもので、0, 3/8, 5/8, 6/8 になりました。 — [npm @strudel/core 1.2.6](https://www.npmjs.com/package/@strudel/core)
- `bjork` は配列を 1 つの引数として受け取ります。arity が 2 の関数では、引数が 1 つでなければ `sequence(...args)` にまとめられる、という特別な扱いがあります（`if (arity === 2 && args.length !== 1)`）。 — [pattern.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/pattern.mjs)
- 範囲外の値：`bjorklund` は `Array(absOns)` と `Array(steps - absOns)` で配列を作るので、pulses が steps を超える場合（例 `(10,8)`）、steps が 0 の場合、小数の場合は `RangeError: Invalid array length` になりました（ローカル実行で確認）。 — [euclid.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs)

### Inferences
- REPL では、ダブルクォートの文字列（とバッククォート）がミニ記法として解釈されます（Strudel のトランスパイラの仕様。今回は `miniAllStrings()` で同じ状態にして確認。トランスパイラ本体のソースは読んでいません）。シングルクォートの `'<3 5>'` は解釈されない可能性があるので、例ではダブルクォートを使うのが安全です。
- 引数をパターンにするとき、pulses が steps を超える値が入るとエラーで止まります。

### Gaps
- REPL 上でエラーがどう表示されるか（パターンごと止まるのか、その cycle だけ無音になるのか）は確認していません。

## Q4. struct("x(3,8)") / mask / stack による重ね方

### Takeaway
`euclid` は内部で `struct` を呼んでいるので、`.struct("x(3,8)")` とほぼ同じです。違いは、元のパターンの値をどこから取るかです。`mask("1(3,8)")` は元のリズムを残したまま、ユークリッドで選んだ位置だけを通します。

### Cited Findings
- `euclid` の実装は `pat.struct(<0/1 配列>)` です。 — [euclid.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs)
- 実行して確かめた結果：
  - `n("0 1").struct("x(3,8)")` → 0/8:n0, 3/8:n0, 6/8:n1。元のパターンの値が、その時刻に合わせて取り出されます。
  - `note("c3 e3 g3").euclid(5,8)` → c3, c3, e3, e3, g3。onset の時刻にある値が使われます。
  - `s("hh*8").mask("1(3,8)")` と `mask("x(3,8)")` は、どちらも 0, 3/8, 6/8 の hh だけを残しました。
  - ミニ記法 `"{a b c}(3,8)"` → a, b, c が順に 1 つずつ当たります。
  - `"bd(3,8) ~ sd(2,8,1)"` → ユークリッドはそれぞれの 1/3 の区間の中で展開されます（bd: 0, 1/8, 1/4、sd: 17/24, 7/8）。
  
  — [npm @strudel/core / @strudel/mini 1.2.6](https://www.npmjs.com/package/@strudel/mini)
- ミニ記法 `(p,s,r)` は parser の `bjorklund` 演算子が `euclid` か `euclidRot` に変換します。 — [mini.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/mini/mini.mjs)

### Inferences
- 使い分けの目安：
  - 値の列にリズムだけを付けたい → `.euclid()` か `.struct("x(…)")`
  - 細かく刻むハイハットを間引きたい → `.mask("1(…)")`
  - 1 つのミニ記法の中で済ませたい → `"bd(3,8)"`

### Gaps
- なし（ここまでの挙動はすべて実行で確認しました）。

## Q5. 正しい stack の例（bd/sd/hh/bass）と、誤ったコードの直し方

### Takeaway
`.euclidLegato?.() ?? ...` は 2 つの理由で誤りです。(1) Strudel では `euclidLegato` は常に存在するので、オプショナルチェーンで存在を確かめる意味がありません。(2) 引数なしで呼ぶと `.euclidLegato() expects 2 inputs but got 0.` という例外になります。正しくは引数を 2 つ渡し、回転させたいときは `euclidLegatoRot` を使います。

### Cited Findings
- `s("bd").euclidLegato?.()` を実行すると、`.euclidLegato() expects 2 inputs but got 0.` というエラーで止まりました（`??` の右辺には進みません）。 — [npm @strudel/core 1.2.6](https://www.npmjs.com/package/@strudel/core)
- 次のパターン（`.scale` を除いた形）を `@strudel/core` で評価し、cycle 0 と 1 のイベントが期待どおりに出ることを確認しました：bd = 0, 3/8, 3/4／sd = 0, 1/2（`euclidRot(2,8,4)`）／hh = 11 拍と 13 拍が交互／bass = cycle 0 で c2 を 3 音（隙間なし）、cycle 1 で eb2 を 5 音。 — [npm @strudel/core 1.2.6](https://www.npmjs.com/package/@strudel/core)

正しい例（strudel.cc の REPL に貼るもの。評価が通ることは Node で確認済み。**音は未確認**。`setcps` と `.bank` は REPL／webaudio 側の機能で、core だけでは評価していません）：

```js
setcps(0.5)
stack(
  // キック：トレシージョ（3,8）
  s("bd").euclid(3, 8),
  // スネア：(2,8) を 4 step 後ろへずらしたもの（Strudel の回転は後ろ方向）
  s("sd").euclidRot(2, 8, 4),
  // ハイハット：16 分の刻みを (11,16) と (13,16) で交互に間引く
  s("hh*16").mask("1(<11 13>,16)").gain(0.6),
  // ベース：onset から次の onset まで音を伸ばす。拍数は cycle ごとに 3 と 5
  note("<c2 eb2 g1 bb1>").euclidLegato("<3 5>", 8)
    .s("sawtooth").lpf(600)
)
```

ミニ記法だけで書く場合：

```js
stack(
  s("bd(3,8)"),
  s("sd(2,8,4)"),          // = s("sd").euclidRot(2,8,4)
  s("hh(<11 13>,16)").gain(0.6),
  note("<c2 eb2 g1 bb1>").euclidLegatoRot(3, 8, 2).s("sawtooth").lpf(600)
)
```

### Inferences
- `.euclidLegato?.() ?? fallback` で意図していたのが「なければ別の書き方を使う」なら、Strudel ではそもそも必要ありません。ただ、Tidal の euclidFull のように「onset と onset の間を埋める」ことが目的だったなら、`stack(a.euclid(3,8), b.euclid(-3,8))` が代わりの書き方です。
- `lpf` は内部で `cutoff` コントロールとして出力されます（実行結果の値が `{"cutoff":600}` だったため）。

### Gaps
- `setcps`、`.bank()`、サンプル名 `bd`／`sd`／`hh` が既定のサンプルセットで鳴るかは、ブラウザで確かめていません（一般的なチュートリアルの書き方に合わせています）。

## Q6. ユークリッドと一緒に使える関連関数（簡単に）

### Takeaway
回転には `early`／`late`、手数を増やすには `ply`、周期ごとの回転には `iter`、拍子の違うパートを重ねるには `polymeter`（ミニ記法では `{…}`）、拍の位置を揺らすには `euclidish` が使えます。いずれも core にあることを確認しました。

### Cited Findings
- core 1.2.6 の `Pattern.prototype` にあることを確かめた関数：`ply`、`iter`、`iterBack`、`early`、`late`、`mask`、`struct`、`swingBy`、`off`、`inv`、`pace`、`segment`、`rev`、`palindrome`、`chunk`、`every`、`firstOf`、`degradeBy`、`sometimesBy`。`polymeter` と `arrange` はメソッドではなく、export された関数としてだけ存在します。 — [npm @strudel/core 1.2.6](https://www.npmjs.com/package/@strudel/core)
- 実行して確かめた結果：
  - `euclid(3,8).ply(2)` → 各 onset が 1/16 の 2 連打になる。
  - `euclid(3,8).iter(4)` の cycle 1 → 9/8, 3/2, 7/4（1/4 前へずれる）。
  - `polymeter(mini('a b c'), mini('d e'))` → 1 cycle に 6 step、a b c a b c と d e d e d e が重なる。
  - `euclid(3,8).fast(2)` → 1 cycle に 6 拍。
  
  — [npm @strudel/core 1.2.6](https://www.npmjs.com/package/@strudel/core)
- `euclidish(3,8,0.5)` → 0, 17/48, 17/24。`euclidish(3,8,1)` → 0, 1/3, 2/3。0 から 1 の間で、ユークリッドから等間隔へ連続的に変わります。 — [euclid.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs)

### Inferences
- `s("bd(3,8)").every(4, x => x.late(1/8))` のように、何 cycle かに 1 回だけ回転させる書き方も使えるはずですが、この形は評価していません。

### Gaps
- `polymeter` の引数の細かい扱い（steps をそろえる仕組み、`pace` との組み合わせ）は今回は調べていません。
