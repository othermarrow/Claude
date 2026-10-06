# Strudel のユークリッド記法を、回転の向きまで正しく理解する

`"bd(3,8)"` は「8 ステップの中に 3 回の音を、できるだけ均等に置く」という意味で、Strudel は `x..x..x.`（間隔 3-3-2、キューバのトレシージョ）を作る。3 番目の引数 `"bd(3,8,2)"` は回転（ずらし）で、**Strudel 1.2.6 ではステップ列を右（後ろ、遅れる向き）へ 2 つずらし、`x.x..x..` になる**。TidalCycles は逆に左へずらして `.x..x.x.` になるので、Tidal 向けの資料をそのまま貼ると、回転つきのパターンだけ違って聞こえる。ミニ記法の `(p,s)` は内部で `.euclid(p,s)`、`(p,s,r)` は `.euclidRot(p,s,r)` に置き換えられる。関数としては、このほかに音を次の拍まで伸ばす `euclidLegato` / `euclidLegatoRot`、ユークリッドから等間隔へ連続的に変化させる `euclidish`（別名 `eish`）、配列を 1 つ受け取る `bjork` がある。pulses を負にすると鳴る所と休む所が反転し、引数には `<3 5>` のようなパターンも書ける。一方、pulses が steps より大きい場合、steps が 0 の場合、小数を渡した場合は、エラーで止まる。この会話の以前の回答にあった 2 つの誤り（回転の向きと、`.euclidLegato?.() ?? ...` という無効なコード）は、下の「訂正」の節で直す。以下の挙動の記述は、npm の `@strudel/core@1.2.6` / `@strudel/mini@1.2.6` を Node 22 で実際に実行して確かめたもの。ただし、**strudel.cc の REPL で音を聞いての確認はしていない**。

## 確認の範囲：Node で確かめたこと、確かめていないこと

この解説は、2026-10-06 時点で npm の最新版だった `@strudel/core@1.2.6` と `@strudel/mini@1.2.6`（2026-01-17 公開）のソースを読み、Node 22 で `mini("…").queryArc(0,1)` などを実行して、各イベントの開始時刻と終了時刻を取り出して作った（[npm @strudel/core](https://www.npmjs.com/package/@strudel/core)、[npm @strudel/mini](https://www.npmjs.com/package/@strudel/mini)）。本文で **【Node で確認】** と書いたものは、この実行で出た値。

逆に、次のことは確認できていない。**【未確認】** と書いたものがこれにあたる。まず、**音は一度も鳴らしていない**。strudel.cc と codeberg.org（Strudel の正本リポジトリ）は、調査環境のネットワークで遮断されていた。そのため、ライブの strudel.cc の画面、関数リファレンスのページ、2026-01 以降の Codeberg の main ブランチは見ていない（1.2.6 より後に回転の向きが変わった可能性は残る）。**Toussaint の原論文の PDF も直接は読めていない**。論文の内容は、Tidal のドキュメントのソース、論文の結果を再現する JS ライブラリのテストデータ、検索結果の抜粋を通しての間接的な確認にとどまる。Tidal（Haskell）も実行しておらず、Tidal の結果はソースの定義から求めた値である。

## 訂正：(3,8,2) は x.x..x..、正しい euclidLegato の書き方

### 誤り (a)：「回転は Tidal と同じく左」は誤り

以前のチャットでは「回転は Tidal と同じく左向きで、`(3,8,2)` は `.x..x.x.`」と説明した。これは **Strudel では誤り**。Strudel の `_euclidRot` は `rotate(b, -rotation)` を呼ぶ。`rotate` 自体は `arr.slice(n).concat(arr.slice(0, n))` という左回転の関数だが、そこに `-rotation` を渡すので、結果は **右回転** になる（[euclid.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs)、[util.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/util.mjs)）。Strudel 自身の単体テストも `euclidRot(3, 8, 2)` の onset を 0、1/4、5/8、つまり `x.x..x..` としている（[euclid.test.js](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/test/euclid.test.js)）。ミニ記法の `"bd(3,8,2)"` も `mini.mjs` の中で `euclidRot` に変換されるので、同じ右回転になる（[mini.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/mini/mini.mjs)）。

【Node で確認】した値は次のとおり。`"bd(3,8)"` と `"bd(3,8,0)"` は `x..x..x.`、`"bd(3,8,1)"` は `.x..x..x`、**`"bd(3,8,2)"` は `x.x..x..`**、`"bd(3,8,3)"` は `.x.x..x.`。負の回転 `"bd(3,8,-2)"` は左回転になり、`.x..x.x.` になった。Tidal のドキュメントは、3 番目の数を「moving the pattern left by the number of steps」と説明し、`(3,8,2)` を `~ x ~ ~ x ~ x ~` としている（[Tidal docs source](https://raw.githubusercontent.com/tidalcycles/tidal-doc/main/docs/reference/mini_notation.md)）。Tidal の実装も左回転の `rotL` を使っている（[Tidal UI.hs](https://github.com/tidalcycles/Tidal/blob/main/tidal-core/src/Sound/Tidal/UI.hs)）。**以前の回答の `.x..x.x.` は、Tidal の結果を Strudel の結果として書いてしまったもの**だった。

Strudel で Tidal と同じ位置にしたいときは、回転を負にする（`(3,8,-2)`）か、`steps - r` を使う（`(3,8,6)`）。言い換えると、Strudel の `(3,8,2)` は「元のパターンを 2/8 サイクル遅らせたもの」で、`s("bd").euclid(3,8).late(2/8)` と同じ。これも【Node で確認】済み。

### 誤り (b)：`.euclidLegato?.() ?? ...` は動かない

以前の回答には `.euclidLegato?.() ?? ...` というコードがあった。これは 2 つの理由で無効。1 つ目に、Strudel 1.2.6 では `euclidLegato` は常に存在するので、オプショナルチェーン（`?.`）で存在を確かめる意味がない。2 つ目に、引数なしで呼ぶと **`.euclidLegato() expects 2 inputs but got 0.` という例外で止まり、`??` の右側には進まない**【Node で確認】（[npm @strudel/core 1.2.6](https://www.npmjs.com/package/@strudel/core)）。正しくは引数を 2 つ渡し、回転させたいときは `euclidLegatoRot` を使う。

次のコードは、`setcps` を除いた部分を `@strudel/core` で評価し、サイクル 0 と 1 のイベントが期待どおりに出ることを確かめたもの【Node で確認】。bd は 0、3/8、3/4。sd は 0、1/2。hh は 11 拍と 13 拍が交互。bass はサイクル 0 で c2 が隙間なく 3 音、サイクル 1 で eb2 が 5 音。**音は【未確認】**で、`setcps` と既定のサンプル `bd` / `sd` / `hh` がブラウザで鳴るかも確かめていない。strudel.cc にそのまま貼れる。

```js
setcps(0.5)
stack(
  // キック：トレシージョ（3,8）
  s("bd").euclid(3, 8),
  // スネア：(2,8) を 4 ステップ後ろへずらしたもの（Strudel の回転は後ろ向き）
  s("sd").euclidRot(2, 8, 4),
  // ハイハット：16 分の刻みを (11,16) と (13,16) で交互に間引く
  s("hh*16").mask("1(<11 13>,16)").gain(0.6),
  // ベース：各音を次の音の直前まで伸ばす。拍数はサイクルごとに 3 と 5
  note("<c2 eb2 g1 bb1>").euclidLegato("<3 5>", 8)
    .s("sawtooth").lpf(600)
)
```

ミニ記法を中心に書くと、次のようになる。

```js
stack(
  s("bd(3,8)"),
  s("sd(2,8,4)"),          // = s("sd").euclidRot(2,8,4)
  s("hh(<11 13>,16)").gain(0.6),
  note("<c2 eb2 g1 bb1>").euclidLegatoRot(3, 8, 2).s("sawtooth").lpf(600)
)
```

以前のコードの狙いが「鳴る所と鳴る所の間を埋める」こと（Tidal の `euclidFull` のような使い方）だったなら、`stack(a.euclid(3,8), b.euclid(-3,8))` が代わりになる。

## ミニ記法 `(pulses, steps, rotation)` の仕組み

文法（`krill.pegjs`）では、要素の直後に `"(" pulse "," step ","? rotation? ")"` を書く。3 つの引数はどれもミニ記法の式として読まれ、カンマの前後には空白を入れてよい（[krill.pegjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/mini/krill.pegjs)）。公式ドキュメントでは、3 つの引数を `beats`、`segments`、`offset` と呼んでいる。ただし、offset がどちら向きにずれるかは文章では書かれていない（[mini-notation.mdx](https://github.com/tidalcycles/strudel/blob/447afbfa87f41f83d6a17aa2cd2a21ae4e69dc05/website/src/pages/learn/mini-notation.mdx)）。内部では `euclid` が `pat.struct(0/1 の配列)` を呼ぶだけなので、**ユークリッド列は、その要素に割り当てられた時間枠の中に詰め込まれる**。【Node で確認】した例を挙げる。`"bd(3,8)"` だけなら各音の長さは 1/8 サイクル。`"bd(3,8) sd"` なら bd の 8 ステップは前半 1/2 サイクルに入る（1 ステップ = 1/16、onset は 0、3/16、3/8）。`"bd(3,8)@3 sd"` なら 3/4 サイクルを 8 等分する。`"bd(3,8)*2"` なら 1 サイクルに (3,8) が 2 回入る（[euclid.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs)）。

`(…)` は値の種類を問わず、どの要素にも付けられる。`"c3(3,8)"`（音名）、`"3(3,8)"`（数値）、`"bd:3(3,8)"`、`"bd(3,8):2"` はどれも動いた【Node で確認】。公式ドキュメントにも `note("e5(2,8) b4(3,8) d5(2,8) c5(3,8)").slow(2)` という例がある（[mini-notation.mdx](https://github.com/tidalcycles/strudel/blob/447afbfa87f41f83d6a17aa2cd2a21ae4e69dc05/website/src/pages/learn/mini-notation.mdx)）。間違えやすいのは中身が複数ある場合。`"<bd sd>(3,8)"` は、サイクルごとに bd が 3 回、sd が 3 回と交互になる。一方 `"[bd sd](3,8)"` は「bd と sd を交互に鳴らす」のではなく、**前半にある鳴り（0、3/8）は bd、後半にある鳴り（3/4）は sd** になる。各 onset の時刻に元のパターンにある値が使われるため。`"{a b c}(3,8)"` なら a、b、c が順に 1 つずつ当たる。

**引数自体もパターンにできる**。`"bd(<3 5>,8)"` はサイクルごとに (3,8) と (5,8) が入れ替わる。`"bd(3,8,<0 2>)"` は回転だけを切り替える。`"bd([3 5],8)"` は前半を (3,8)、後半を (5,8) で作り、onset は 0、3/8、5/8、3/4 になる。注意したいのは `"bd({3,5},8)"` で、これは片方を選ぶのではなく **(3,8) と (5,8) を重ねる（stack する）**。0、3/8、3/4 では 2 回重なって鳴る（いずれも【Node で確認】）。公式テストも `'[a(<3 5>, <8 16>)]*2'` が `'a(3,8) a(5,16)'` と等しいことを確かめている（[mini.test.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/mini/test/mini.test.mjs)）。

**pulses を負にすると反転する**。`bjorklund` は `ons < 0` のとき、`|ons|` で作った列の 0 と 1 を入れ替える（[euclid.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs)）。`"hh(-3,8)"` は `.xx.xx.x`（5 回鳴る）になり、`"hh(-3,8,2)"` は反転してから回転して `.x.xx.xx` になる【Node で確認】。ただし、**`euclidLegato(-3,8)` は無音**になる（`pulses < 1` なら silence を返す分岐があるため）。

境界の値には注意が要る。`bd(0,8)` は無音、`bd(8,8)` は 8 回鳴る。一方、**`bd(10,8)`（pulses > steps）、`bd(3,0)`（steps = 0）、小数の pulses は、`RangeError: Invalid array length` で評価が止まる**【Node で確認】。Tidal は steps = 0 を無音として扱う（[Tidal UI.hs](https://github.com/tidalcycles/Tidal/blob/main/tidal-core/src/Sound/Tidal/UI.hs)）ので、ここも Strudel と違う。また、回転は内部で剰余（mod）を取らないので、**`(3,8,10)` は `(3,8,2)` にはならず、回転なしの `x..x..x.` になった**【Node で確認】。回転の値は 0 以上 steps 未満で使うのが安全。strudel.cc の画面でこれらのエラーがどう表示されるかは【未確認】。

## 関数版：euclid / euclidRot / euclidLegato / euclidish / bjork

1.2.6 の `Pattern.prototype` に実在することを確かめた関数は、`euclid`、`euclidRot`（全部小文字の別名 `euclidrot` もある）、`euclidLegato`、`euclidLegatoRot`、`euclidish`（別名 `eish`）、`bjork` の 6 種類。**Tidal の `euclidOff`、`euclidOffFull`、`euclidFull`、`euclidInv` は、どれも `undefined` だった**【Node で確認】（[euclid.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs)）。公式ドキュメントの対応表では、`"x".euclid(3,8)` が `"x(3,8)"`、`"x".euclidRot(3,8,1)` が `"x(3,8,1)"` にあたる（[time-modifiers.mdx](https://github.com/tidalcycles/strudel/blob/447afbfa87f41f83d6a17aa2cd2a21ae4e69dc05/website/src/pages/learn/time-modifiers.mdx)）。

| 関数 | 引数 | 何をするか | Node での結果（1 サイクル内の時刻） |
|---|---|---|---|
| `euclid` | pulses, steps | 0/1 配列を `struct` で当てはめる | `(3,8)` → 0, 3/8, 3/4（各音の長さ 1/8） |
| `euclidRot` / `euclidrot` | pulses, steps, rotation | 右回転つき（= `.late(r/steps)`） | `(3,8,2)` → 0, 1/4, 5/8 |
| `euclidLegato` | pulses, steps | 各音を次の onset の直前まで伸ばす | `(3,8)` → 0–3/8, 3/8–3/4, 3/4–1 |
| `euclidLegatoRot` | pulses, steps, rotation | legato に右回転を加えたもの | `(3,8,2)` → 0–1/4, 1/4–5/8, 5/8–1 |
| `euclidish` / `eish` | pulses, steps, groove | groove 0 でユークリッド、1 で等間隔 | `(3,8,0.5)` → 0, 17/48, 17/24／`(3,8,1)` → 0, 1/3, 2/3 |
| `bjork` | `[pulses, steps, rot]` の配列 1 つ | 配列で指定する版（JSDoc なし） | （存在のみ確認） |

`euclidLegato` の JSDoc には `@param rotation` と書かれているが、実装は引数を 2 つしか受け取らない。**回転したいときは `euclidLegatoRot` を使う**（[euclid.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs)）。`euclidLegato` が変えるのはイベントの長さなので、`s("sawtooth")` のようなシンセでは音が伸びる。サンプルで長さを切るには `.clip(1)` などが要ると考えられるが、これは音の出る側（superdough）の挙動で【未確認】。同じ JSDoc には、サンバの例として `euclidRot(3,16,14)` が書かれているが、同じファイルの一覧表では `(7,16,14)` なので、`3` は書き間違いと見られる。

使い分けの目安は次のとおり（いずれも【Node で確認】）。値の並びにリズムだけ付けたいなら `.euclid()` か `.struct("x(…)")`。たとえば `note("c3 e3 g3").euclid(5,8)` は c3, c3, e3, e3, g3 になる。細かい刻みを間引きたいなら `.mask("1(…)")`。`s("hh*8").mask("1(3,8)")` は 0、3/8、6/8 の hh だけを残す。Tidal の関数の代わりは、`euclidInv` が `euclid(-3,8)`、`euclidFull(3,8,a,b)` が `stack(a.euclid(3,8), b.euclid(-3,8))`、`euclidOff(3,8,2)` が `euclidRot(3,8,-2)` か `euclid(3,8).early(2/8)`。組み合わせると便利な関数として、`ply`、`iter`、`early` / `late`、`polymeter` が core にあることも確認した。`euclid(3,8).iter(4)` は 2 サイクル目に 1/4 前へずれる。

引数をパターンにするときは、`.euclid("<3 5>", 8)` のように **ダブルクォート** で書く。REPL ではダブルクォートとバッククォートの文字列がミニ記法として解釈されるため。ただし、トランスパイラ本体のソースは読んでおらず、Node では `miniAllStrings()` で同じ状態を作って確かめただけ。

## (1,8)〜(8,8) と (1,16)〜(16,16) の全パターン

下の表は、`@strudel/core@1.2.6` と `@strudel/mini@1.2.6` を Node で実行し、`mini("x(k,n)").queryArc(0,1)` の onset 位置を記録したもの【Node で確認】。回転はなし（rotation = 0）。`x` = 鳴る、`.` = 休み。「間隔」は各 onset から次の onset までのステップ数（最後は次サイクルの頭まで）。音で聞いての確認はしていない。

| 記法 | パターン | 間隔 |
|---|---|---|
| `(1,8)` | `x.......` | 8 |
| `(2,8)` | `x...x...` | 4-4 |
| `(3,8)` | `x..x..x.` | 3-3-2 |
| `(4,8)` | `x.x.x.x.` | 2-2-2-2 |
| `(5,8)` | `x.xx.xx.` | 2-1-2-1-2 |
| `(6,8)` | `x.xxx.xx` | 2-1-1-2-1-1 |
| `(7,8)` | `xxxxxxx.` | 1-1-1-1-1-1-2 |
| `(8,8)` | `xxxxxxxx` | 1-1-1-1-1-1-1-1 |

| 記法 | パターン | 間隔 |
|---|---|---|
| `(1,16)` | `x...............` | 16 |
| `(2,16)` | `x.......x.......` | 8-8 |
| `(3,16)` | `x....x....x.....` | 5-5-6 |
| `(4,16)` | `x...x...x...x...` | 4-4-4-4 |
| `(5,16)` | `x..x..x..x..x...` | 3-3-3-3-4 |
| `(6,16)` | `x..x.x..x..x.x..` | 3-2-3-3-2-3 |
| `(7,16)` | `x..x.x.x..x.x.x.` | 3-2-2-3-2-2-2 |
| `(8,16)` | `x.x.x.x.x.x.x.x.` | 2-2-2-2-2-2-2-2 |
| `(9,16)` | `x.xx.x.x.xx.x.x.` | 2-1-2-2-2-1-2-2-2 |
| `(10,16)` | `x.xx.x.xx.xx.x.x` | 2-1-2-2-1-2-1-2-2-1 |
| `(11,16)` | `x.xx.xx.xx.xx.xx` | 2-1-2-1-2-1-2-1-2-1-1 |
| `(12,16)` | `x.xxx.xxx.xxx.xx` | 2-1-1-2-1-1-2-1-1-2-1-1 |
| `(13,16)` | `x.xxxx.xxxx.xxxx` | 2-1-1-1-2-1-1-1-2-1-1-1-1 |
| `(14,16)` | `x.xxxxxxx.xxxxxx` | 2-1-1-1-1-1-1-2-1-1-1-1-1-1 |
| `(15,16)` | `xxxxxxxxxxxxxxx.` | 1-1-1-1-1-1-1-1-1-1-1-1-1-1-2 |
| `(16,16)` | `xxxxxxxxxxxxxxxx` | 1-1-1-1-1-1-1-1-1-1-1-1-1-1-1-1 |

表を読むときのポイントは 3 つある。1 つ目に、**間隔は常に 2 種類（⌈n/k⌉ と ⌊n/k⌋）しか現れず**、それがなるべく均等に散らばる。2 つ目に、k と n の最大公約数が 1 より大きい組は、短いパターンの繰り返しになる。たとえば `(4,16)` は 4 つ打ち、`(6,16)` は (3,8) の 2 回分（を回転したもの）、`(6,8)` は (3,4) の 2 回分。最初から最後まで非対称な「長・短」の感じがほしいなら、(3,8)、(5,8)、(5,16)、(7,16)、(9,16) のように **互いに素な組** を選ぶ（[euclid.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs) の `bjorklund` を実行して確認）。3 つ目に、`(7,8)` や `(15,16)` のように k が n に近いと、Strudel は休みを **末尾** に置く（`xxxxxxx.`）。Toussaint の論文の表記は `x.xxxxxx` のように回転した形なので、見た目が違う（後述）。

## Bjorklund のアルゴリズムと Toussaint の伝統リズム

この方法は、Eric Bjorklund が中性子加速器（SNS）の制御用パルスを均等に配置するために作ったアルゴリズムに由来する（[Demaine ほか "The Distance Geometry of Music"](https://arxiv.org/pdf/0705.4085) 経由の要約。Bjorklund の技術ノート自体は【未読】）。Godfried Toussaint は 2005 年の Bridges 会議の論文「The Euclidean Algorithm Generates Traditional Musical Rhythms」で、このアルゴリズムがユークリッドの互除法と同じ構造をしており、アフリカやキューバなどの伝統的なリズム（timeline）を多く生み出すことを示した（[Bridges archive](https://archive.bridgesmathart.org/2005/bridges2005-47.html)。**PDF 本体は【未読】**）。Strudel の実装は、Rohan Drape の Haskell ライブラリから移植したと書かれている（[euclid.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs)）。

手順は、余りを割り振っていく互除法そのもの。E(3,8) なら、まず `[1][1][1] | [0][0][0][0][0]` から始める。1 に 0 を 1 つずつ付けて `[10][10][10] | [0][0]` にする。残りの 0 をさらに付けて `[100][100] | [10]` にする。余りのグループが 1 つになったら止め、左から読むと `10010010` = `x..x..x.` になる。E(5,8) は同じ手順で `x.xx.xx.` になる。どちらも Strudel の単体テストの期待値と一致する（[euclid.test.js](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/test/euclid.test.js)）。多くの実装が間違える難しいケースとして知られる E(5,13) も、`x..x.x..x.x..` で正しく出た（[brianhouse/bjorklund](https://github.com/brianhouse/bjorklund)、[euclidean-rhythms](https://github.com/mkontogiannis/euclidean-rhythms)）。

Strudel と Tidal のドキュメントには、Toussaint に由来する伝統リズムの一覧が同じ文面で載っている。(3,8) キューバのトレシージョ、(5,8) キューバのシンキージョ、(2,5) 13 世紀ペルシャの Khafif-e-ramal、(3,4) コロンビアのクンビア、(4,9) トルコの Aksak、(5,12) 南アフリカ Venda の手拍子、(5,16) ブラジルのボサノバの「necklace」、(7,12) 西アフリカのベル、(9,16) 中央アフリカ共和国、(7,16,14) ブラジルのサンバ、(11,24,14) と (13,24,5) アカ・ピグミー、などがある（[Tidal docs source](https://raw.githubusercontent.com/tidalcycles/tidal-doc/main/docs/reference/mini_notation.md)、[euclid.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs)）。論文の結果を再現するライブラリのテストデータと比べると、Strudel の出力は大部分が同じ文字列だった。違ったのは (2,3)、(3,4)、(5,6)、(7,8) の 4 つで、これらは **同じリズムを回転した形** だった（Strudel は `xxx.`、論文は `x.xx`）（[patterns.ts](https://github.com/mkontogiannis/euclidean-rhythms/blob/master/src/patterns.ts)）。実装によって回転が論文とずれることは、実装者の間でも知られている（[brianhouse/bjorklund](https://github.com/brianhouse/bjorklund)）。

ここでも回転の向きが問題になる。一覧にある回転の値（14、5、2）は、**左向きにずらす Tidal の約束で書かれている**。Strudel 1.2.6 に貼ると逆向きに回る。リズムの輪（necklace）としては同じでも、1 拍目との位置関係が変わる。Strudel では `(7,16,14)` が `.x.x.x..x.x.x.x.` になった【Node で確認】。Tidal の「左へ 14」は 16 ステップの中では「右へ 2」と同じなので、Strudel で Tidal の (7,16,14) を再現するには `(7,16,2)` か `(7,16,-14)` と書けばよい、という計算になる。ただしこれは定義から導いた推論で、Tidal も REPL も実行していない【未確認】。

## 結論

Strudel のユークリッド記法は Tidal から受け継いだものだが、「Tidal と同じ」と考えて使うと、**回転とエラー処理の 2 点**でつまずく。回転は右向き（遅れる向き）で剰余を取らず、範囲外の値は無音ではなくエラーになる。この 2 点を除けば、ミニ記法の `(p,s,r)` は `euclid` / `euclidRot` の書き換えにすぎない。そのため、引数のパターン化、負の pulses での反転、`@` や `*` との組み合わせは、そのまま同じように使える。

実際の使い方としては、上の表から互いに素な組を選んで主役のリズム（timeline）にするとよい。1 つのパートに `(k,n)`、もう 1 つにその反転 `(-k,n)` を当てると、隙間を埋め合う 2 声ができる。さらに回転を `"<0 2 4>"` のようにパターンにすると、同じ輪のまま強拍の位置だけが動く。ここまでの記述は Node 上の計算で確かめたものなので、**最終的には strudel.cc で実際に耳で確かめてほしい**。特に、1.2.6 より後に回転の向きが変わっていないかは確認が必要。`"bd(3,8,2)"` を鳴らして、1 拍目に音があれば（`x.x..x..`）この解説のとおりの挙動である。
