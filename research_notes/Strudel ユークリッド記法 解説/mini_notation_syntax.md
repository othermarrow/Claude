# Strudel mini-notation のユークリッドリズム記法（`bd(3,8)` / `bd(3,8,2)` など）

調査日: 2026-10-06

## 調査方法と出典（最初に読む）

- **何を見たか**
  - Strudel のソース: npm で公開されている最新版 `@strudel/core@1.2.6` と `@strudel/mini@1.2.6`（2026-01-17 公開）。中のファイルは `euclid.mjs`、`util.mjs`、`pattern.mjs`、`krill.pegjs`、`mini.mjs`、`test/mini.test.mjs`。
  - GitHub ミラー `tidalcycles/strudel` の、Codeberg 移転直前のコミット `447afbf`（2025-06-19）。このコミットの `website/src/pages/learn/mini-notation.mdx` と `time-modifiers.mdx` も読んだ。これらは strudel.cc の公式ドキュメントのソース。
  - Tidal（Haskell）のソース: `tidalcycles/Tidal` の main（コミット `fefb1c3`、2025-06-13）の `tidal-core/src/Sound/Tidal/UI.hs`、`Bjorklund.hs`、`ParseBP.hs`。
- **実行して確かめたこと**: Node 22 で `@strudel/mini@1.2.6` の `mini()` を使って各パターンを `queryArc(0,1)` し、イベントの開始・終了時刻を出した。以下にある具体的なステップ列とタイミングは、すべてこの実行結果。
- **見られなかったもの**
  - `codeberg.org` と `strudel.cc` は、この環境のネットワークプロキシで遮断されていた。このため、Codeberg の 2026-01 以降の main と、ライブの strudel.cc のページは直接確認していない。npm 1.2.6 が確認できた最新のリリース。
  - GitHub の issue 検索も、この環境では使えなかった。
- **出典 URL**
  - npm パッケージ: https://www.npmjs.com/package/@strudel/core と https://www.npmjs.com/package/@strudel/mini（v1.2.6）
  - Strudel のソース（正本）: https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs と https://codeberg.org/uzu/strudel/src/branch/main/packages/mini/krill.pegjs（1.2.6 のファイルヘッダーに書かれている URL。ネットワークから直接は確認できていない）
  - GitHub ミラー（移転前）: https://github.com/tidalcycles/strudel/blob/447afbfa87f41f83d6a17aa2cd2a21ae4e69dc05/packages/core/euclid.mjs
  - 公式ドキュメントのソース: https://github.com/tidalcycles/strudel/blob/447afbfa87f41f83d6a17aa2cd2a21ae4e69dc05/website/src/pages/learn/mini-notation.mdx（公開ページは https://strudel.cc/learn/mini-notation/）
  - Tidal: https://github.com/tidalcycles/Tidal/blob/main/tidal-core/src/Sound/Tidal/UI.hs と https://github.com/tidalcycles/Tidal/blob/main/tidal-core/src/Sound/Tidal/ParseBP.hs

---

## Q1. 構文と、回転（rotation）の向き

### Takeaway
構文は `要素(pulses, steps)` か `要素(pulses, steps, rotation)`。Strudel が作るステップ列は次のとおり（`x` = 鳴る、`.` = 休み）。
- `(3,8)` と `(3,8,0)` は `x..x..x.`
- `(3,8,2)` は `x.x..x..`

つまり、**Strudel の回転はステップ列を右（後ろ、時間が遅れる向き）へずらす**。Tidal は左へずらすので、向きが逆になる（Q7 を参照）。

### Cited Findings
- PEG の文法: `op_bjorklund = "(" ws p:slice_with_ops ws comma ws s:slice_with_ops ws comma? ws r:slice_with_ops? ws ")"`。中の値は `{ type_: "bjorklund", arguments_: { pulse, step, rotation } }` として要素の ops に追加される。3 番目の引数は省略できる。カンマの前後には空白を入れてよい。 — [krill.pegjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/mini/krill.pegjs)（npm 1.2.6 で確認）
- `mini.mjs` の処理: `rotation` があれば `pat.euclidRot(pulse, step, rotation)`、なければ `pat.euclid(pulse, step)` を呼ぶ。 — [mini.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/mini/mini.mjs)（npm 1.2.6）
- `euclid.mjs` の中身: `_euclidRot = (pulses, steps, rotation) => { const b = bjorklund(pulses, steps); if (rotation) return rotate(b, -rotation); return b; }` — [euclid.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs)
- `util.mjs`: `// rotate array by n steps (to the left)`、`rotate = (arr, n) => arr.slice(n).concat(arr.slice(0, n))`。Strudel はこれに `-rotation` を渡すので、結果として**右回転**になる。 — [util.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/util.mjs)
- 実際に `@strudel/mini@1.2.6` で実行した結果（1 サイクル内のイベント開始時刻）:
  - `"bd(3,8)"` と `"bd(3,8,0)"` → 0, 3/8, 3/4（`x..x..x.`）
  - `"bd(3,8,1)"` → 1/8, 1/2, 7/8（`.x..x..x`）
  - `"bd(3,8,2)"` → 0, 1/4, 5/8（`x.x..x..`）
  - `"bd(3,8,3)"` → `.x.x..x.`
  - `"bd(3,8,-2)"` → 1/8, 1/2, 3/4（`.x..x.x.`）。負の回転は左回転になる。
  - `(3,8,8)` は `(3,8,0)` と同じ。`(3,8,10)` も `x..x..x.` だった。10 は `(3,8,2)` と同じ結果を期待しがちなので注意（推論の項を参照）。
- 単体テスト: `minS('a(3, 8)')` は `['a: 0 - 1/8', 'a: 3/8 - 1/2', 'a: 3/4 - 7/8']`。Toussaint の例の再現テストもあり、たとえば `(5,8)` は `x ~ x x ~ x x ~`、`(3,4)` は `x x x ~` になる（Toussaint の原表は誤りなので訂正した、とテストのコメントにある）。 — [mini.test.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/mini/test/mini.test.mjs)
- 公式ドキュメント（mini-notation の「Euclidian rhythms」節）は、3 つの引数を `beats`、`segments`、`offset` と呼んでいる。`offset` の説明は「the third (optional) parameter controls the starting position for distributing the beats」。例は `s("bd(3,8,0), hh cp")`、`bd(3,8,3)`、`bd(3,8,5)`。回転の向き（左か右か）は文章では書かれていない。 — [mini-notation.mdx](https://github.com/tidalcycles/strudel/blob/447afbfa87f41f83d6a17aa2cd2a21ae4e69dc05/website/src/pages/learn/mini-notation.mdx)
- 公式の time-modifiers ページには対応表がある: `"x".euclid(3,8)` は `"x(3,8)"`、`"x".euclidRot(3,8,1)` は `"x(3,8,1)"`。 — [time-modifiers.mdx](https://github.com/tidalcycles/strudel/blob/447afbfa87f41f83d6a17aa2cd2a21ae4e69dc05/website/src/pages/learn/time-modifiers.mdx)

### Inferences
- 回転 r の結果は「元の列の末尾 r 個を先頭に移したもの」。音で言えば、r ステップぶん遅れて聞こえる。
- `rotate` は `slice(-r)` で実装されているので、|r| ≥ steps のときは期待どおりの剰余（mod）にならない。たとえば `slice(-10)` は配列全体を返すので、`(3,8,10)` は回転なしになる。実用上は 0 ≤ r < steps の範囲で使うのが安全。
- ドキュメントの「starting on position 1」という表現と `bd(3,8,0)` の例は、0 を「回転なし」として説明している。

### Gaps
- Strudel が意図的に Tidal と逆向きにしたのか、それとも不具合なのかを書いた issue や議論は見つけられなかった（GitHub の issue 検索と Codeberg がこの環境で使えなかったため）。

---

## Q2. 負の pulses で反転するか（`"hh(-3,8)"`）

### Takeaway
する。pulses が負なら、`|pulses|` で作ったビット列を反転する。`hh(-3,8)` は `.xx.xx.x` になり、5 回鳴る。

### Cited Findings
- `bjorklund`（1.2.6）の中身: `const inverted = ons < 0; const absOns = Math.abs(ons); ... return inverted ? pattern.map((x) => 1 - x) : pattern;` — [euclid.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs)
- 実行結果:
  - `"hh(-3,8)"` → 1/8, 1/4, 1/2, 5/8, 7/8（`.xx.xx.x`）
  - `"hh(-3,8,2)"` → `.x.xx.xx`。反転したあとで回転がかかる。
- Tidal も同じ考え方: `_euclid n k a | n >= 0 = ... bjorklund (n,k) | otherwise = ... fmap (bool a silence) $ bjorklund (-n, k)` — [Tidal UI.hs](https://github.com/tidalcycles/Tidal/blob/main/tidal-core/src/Sound/Tidal/UI.hs)

### Inferences
- 反転は「表と裏が入れ替わったパターン」として使える。たとえば `"bd(3,8), hh(-3,8)"` と書くと、キックとハイハットが互いの隙間を埋め合う。（この使い方は推論で、ドキュメントの例ではない）

### Gaps
- 公式の mini-notation ドキュメントには、負の pulses についての記述がない。ソースと実行結果でだけ確認した。
- `-0` や、`|pulses| > steps` の負の値（例 `-10,8`）はエラーになる（Q6 を参照）。

---

## Q3. 引数をパターンにできるか

### Takeaway
できる。3 つの引数はどれも `slice_with_ops` なので、`<...>`、`[...]`、`{...}` などの mini-notation をそのまま書ける。`<3 5>` はサイクルごとに切り替わる。`[3 5]` はサイクルの前半と後半で切り替わる。`{3,5}` は両方を重ねた stack になる。

### Cited Findings
- 文法では、p、s、r の 3 つとも `slice_with_ops` になっている。 — [krill.pegjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/mini/krill.pegjs)
- `register()` の動き: 引数が全部定数（pure）なら、そのまま関数を呼ぶ。そうでなければ `left.fmap(mapFn)` に `appLeft` を重ね、最後に `innerJoin`（既定の join）する。つまり、パターン化した引数の値は、イベントごとにその時点の値が使われる。 — [pattern.mjs `register`](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/pattern.mjs)
- 単体テスト: `minS('[a(<3 5>, <8 16>)]*2')` は `minS('a(3,8) a(5,16)')` と等しい。 — [mini.test.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/mini/test/mini.test.mjs)
- 実行結果:
  - `"bd(<3 5>,8)"`: サイクル 0 は (3,8)、サイクル 1 は 1, 5/4, 11/8, 13/8, 7/4 で (5,8) = `x.xx.xx.`
  - `"bd(3,8,<0 2>)"`: サイクル 0 は `x..x..x.`、サイクル 1 は 1, 5/4, 13/8 で `x.x..x..`
  - `"bd(3,<8 16>)"`: サイクル 0 は (3,8)
  - `"bd([3 5],8)"` → 0, 3/8, 5/8, 3/4。前半は (3,8) の 0 と 3/8、後半は (5,8) の 5/8 と 6/8 が出る。
  - `"bd({3,5},8)"` → (3,8) と (5,8) の両方のイベントが出る。0、3/8、3/4 は 2 つ重なる。

### Inferences
- `{3,5}` は「片方を選ぶ」動きではなく、**2 つの結果を重ねる（stack）**。同じ時刻に 2 回鳴るので、音量が上がるなど意図しない結果になりやすい。
- `[3 5]` のように 1 サイクル内で引数が変わると、innerJoin になる。各時間帯で、その時点の引数で作った列の該当部分だけが残る。

### Gaps
- 引数に小数（例 `3.5`）を渡すとエラーになる（Q6 を参照）。整数に丸めることはしない。

---

## Q4. タイミング（要素の時間枠への収まり方）

### Takeaway
ユークリッド列は、その要素に割り当てられた時間枠の中に全ステップが詰め込まれる。`"bd(3,8) sd"` なら、bd は前半 1/2 サイクルに 8 ステップ（1 ステップ = 1/16 サイクル）、sd は後半を占める。各音の長さは 1 ステップぶんになる。

### Cited Findings
- `euclid` の実装は `pat.struct(_euclidRot(...))`。つまり 0/1 の配列を、その要素の時間枠に均等割りの構造として当てはめる。 — [euclid.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs)
- 実行結果:
  - `"bd(3,8) sd"` → bd が 0–1/16、3/16–1/4、3/8–7/16、sd が 1/2–1。予想どおり半分の枠に収まっている。
  - `"bd(3,8)@3 sd"` → bd が 0、9/32、9/16（3/4 サイクルの枠を 8 等分）、sd が 3/4–1
  - `"bd(3,8)*2"` と `"bd(3,8)!2"` → 1 サイクルに (3,8) が 2 回入る（1/16 刻み）
  - `"bd(3,8)"` 単独 → 各イベントの長さは 1/8

### Inferences
- `@`、`*`、`!` などの他の演算子と組み合わせられる。枠の大きさが変わると、ステップの細かさもそれに比例して変わる。

### Gaps
- 1.2.x で追加された「steps」（tactus）機能で `(3,8)` の要素がどう扱われるかは確認していない。`euclid` は `register` で preserveSteps を指定していない。Tidal の `_euclid` は `setSteps k` を設定している。

---

## Q5. 音名・数値・交替 `< >`・サブシーケンスにも使えるか

### Takeaway
使える。`(…)` は値の種類を問わず、どの要素の後ろにも付けられる。

### Cited Findings
- 実行結果:
  - `"c3(3,8)"` → `"c3"` が 0、3/8、3/4
  - `"3(3,8)"` → 数値 3 が同じタイミング
  - `"bd:3(3,8)"` → 値 `["bd",3]`
  - `"bd(3,8):2"` → `["bd",2]`。`:` は後ろに付けても同じになる。
  - `"<bd sd>(3,8)"`: サイクル 0 は bd が 3 回、サイクル 1 は sd が 3 回。交替はサイクル単位で、1 サイクルの中では同じ音が使われる。
  - `"[bd sd](3,8)"` → bd が 0、3/8、sd が 3/4。struct の働きで、元のパターンの各時刻の値が使われる。
- 公式ドキュメントにも音名の例がある: `note("e5(2,8) b4(3,8) d5(2,8) c5(3,8)").slow(2)` — [mini-notation.mdx](https://github.com/tidalcycles/strudel/blob/447afbfa87f41f83d6a17aa2cd2a21ae4e69dc05/website/src/pages/learn/mini-notation.mdx)

### Inferences
- `[bd sd](3,8)` は「bd と sd を交互に鳴らす」動きではない。前半にある鳴りは bd、後半にある鳴りは sd になる。

### Gaps
- なし。

---

## Q6. 境界値（pulses > steps、pulses = 0、steps = 0）

### Takeaway
- pulses = 0 は無音になる。
- pulses = steps は全ステップで鳴る。
- pulses > steps、steps = 0、整数でない pulses は、**JavaScript の例外 `Invalid array length` で評価が失敗する**。Tidal は steps = 0 を無音として扱うので、ここが違う。

### Cited Findings
- `bjorklund` は `Array(offs)`（`offs = steps - |ons|`）と `Array(absOns)` を作る。長さが負や非整数だと RangeError になる。 — [euclid.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs)
- 実行結果:
  - `bd(0,8)` → イベントなし
  - `bd(8,8)` → 8 回
  - `bd(10,8)` → ERROR "Invalid array length"
  - `bd(3,0)` → ERROR "Invalid array length"
  - `bjorklund(3.5,8)` → ERROR
  - `bjorklund(-10,8)` → ERROR
  - `bd(3,8,)`（末尾にカンマ）→ (3,8) として受け付けられる
- Tidal の扱い: `_euclidOff _ 0 _ _ = silence`（steps = 0 は無音）。 — [Tidal UI.hs](https://github.com/tidalcycles/Tidal/blob/main/tidal-core/src/Sound/Tidal/UI.hs)

### Inferences
- REPL で書くと、評価エラーが表示されるはず。ライブコーディング中に `<...>` で steps に 0 が混ざると、その時点のクエリが失敗する可能性がある（REPL の画面での表示は未確認）。

### Gaps
- strudel.cc の REPL 画面で、このエラーが実際にどう表示されるかは確認していない（strudel.cc にアクセスできなかったため）。

---

## Q7. TidalCycles（Haskell）との違い／バージョン差

### Takeaway
基本のアルゴリズム（Bjorklund）と負の pulses による反転は Tidal と同じ。違いは次の 3 つ。
1. **回転の向きが逆**。Tidal は `rotL`（左、早める向き）、Strudel は右。つまり `bd(3,8,2)` の結果が違う。
   - Tidal: `.x..x.x.`
   - Strudel: `x.x..x..`
2. **steps = 0 の扱い**。Tidal は無音、Strudel は例外になる。
3. **Bool パターンの扱い**。Tidal は `t(3,8)` のような Bool パターンでは、休みを無音ではなく False で埋める（`euclidOffBool`）。Strudel のミニ記法にはこの特別扱いがない（ソースで確認した範囲）。

### Cited Findings
- Tidal: `_euclidOff n k s p = setSteps ... $ (rotL $ fromIntegral s % fromIntegral k) (_euclid n k p)`。`rotL` は時間を早める（左回転）。 — [Tidal UI.hs](https://github.com/tidalcycles/Tidal/blob/main/tidal-core/src/Sound/Tidal/UI.hs)
- Tidal ParseBP: 文字・数値・音程などの型の mini-notation では `doEuclid = euclidOff`。Bool では `_euclidOffBool` が `(\a b -> if b then a else not a)` で、休みを反転値で埋める。 — [Tidal ParseBP.hs](https://github.com/tidalcycles/Tidal/blob/main/tidal-core/src/Sound/Tidal/ParseBP.hs)
- Strudel: `rotate(b, -rotation)` で右回転（Q1 参照）。 — [euclid.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs)
- Strudel 内のバージョン差（GitHub 最終版 2025-06 と npm 1.2.6 を diff した結果）:
  - 新しく `bjork`（配列で `[pulses, steps, rot]` を受け取る）と `euclidish`（別名 `eish`）が追加された。
  - `euclidLegatoRot` の回転の実装が変わった。旧版は配列を回転していたが、新版は `.late(rotation/steps)` を使う。どちらも右（遅れる）向き。
  - `bjorklund` の中身は、名前の変更と整理だけで、結果は変わらない。
  - mini の文法（`krill.pegjs`）と `mini.mjs` は、ヘッダーの URL 以外は同じだった。
  - — [npm @strudel/core 1.2.6 euclid.mjs](https://www.npmjs.com/package/@strudel/core) と [GitHub 447afbf euclid.mjs](https://github.com/tidalcycles/strudel/blob/447afbfa87f41f83d6a17aa2cd2a21ae4e69dc05/packages/core/euclid.mjs) の比較

### Inferences
- Tidal 用のコードや資料（Tidal の公式ドキュメントの `bd(3,8,2)` の説明など）をそのまま Strudel に持ち込むと、回転つきのパターンだけ違って聞こえる。Tidal と同じ結果がほしければ、Strudel では回転を `steps - r`（例 `(3,8,6)`）か `-r`（例 `(3,8,-2)`）にする。実行結果で、`(3,8,-2)` が `.x..x.x.` になることは確認済み。
- 1.2.6 以降の Codeberg の main で回転の向きが変更されたかどうかは、未確認。

### Gaps
- Tidal を実際に実行（GHC）しての確認はしていない。Tidal の結果は、ソースの `rotL` から導いたもの。
- Strudel と Tidal の回転の向きの違いについて、コミュニティ（club.tidalcycles.org）や issue で議論されているかどうかは確認できなかった。
- Codeberg の main（2026-01 以降）と、ライブの strudel.cc のドキュメントは、ネットワーク制限で確認できなかった。
