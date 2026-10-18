# 野帳

Backrooms Wiki（backrooms-wiki.wikidot.com）の記事をもとにしたテキストアドベンチャー。
黄色い部屋（Level 0）に落ち、Level 7 の海まで降りていく。そのあいだに出会うものを「観察」して、小さな野帳に書きとめていく。

- ファイル：`yacho.html`（HTML 一枚。外から読みこむのは DotGothic16 フォントだけで、読めなくても遊べる）
- 操作：「降下記録」「空欄」「ノークリップ」と同じ（状態行・「命令を作る」・十字キー・よく使う6ボタン・≡ メニュー・自動保存）
- 文章：標準語。wiki の記事の内容を日本語で書き直している（引用ではなく翻案）。謎解きの組み立てはこのゲーム独自のもの

## 野帳のしくみ

wiki の記事は、同じ実体について版ごとに書いてあることが食い違っていることがある。このゲームでは、その食い違いをそのまま残している。

- 掲示板や棚の記事、人の話は「読んだ」として、出どころつきで野帳に入る。
- 「観察する」と、自分で見たことが入る。きっかけ（A）・行動（B）・その後（C）の三つがそろうと、見立てが立つ。
- 見立てどおりにやってうまくいくと「確かめた」になる。観察せずにたまたまうまくいったときは、「理由は見ていない」と書かれる。
- 確かめようのないものは「分からない」と書く。

たとえば Level 1 の掲示には「ウレッチは人ではない。声が分かっても、関わるな」とあり、基地オメガの第15記事には「元は人。初めの段階なら戻る見込みがある」とある。どちらが正しいかは、自分で見て決める。

## 遊び方

1. スマホのブラウザ、または Tasker のシーン（WebView）で `yacho.html` を開く。
2. 「命令を作る」→ 動詞 → 物（「言う」ならことば）の順にタップする。入力欄に日本語で書いてもよい（例：`ちらつく壁を観察する`／`ボトルを置く`／`ハウンドを見つめる`）。
3. 困ったら「野帳」。最後の行に「次に見ること」が出る。

### Tasker で開く

1. Termux で置き場所を作ってコピーする。

   ```sh
   mkdir -p /storage/emulated/0/Tasker/yacho
   cd ~/Claude
   git fetch origin ccr-d4f31da7-u5hlbp
   git checkout ccr-d4f31da7-u5hlbp
   cp yacho/yacho.html /storage/emulated/0/Tasker/yacho/
   ```

2. 「降下記録」と同じようにシーンを作り、WebView の Source を `file:///storage/emulated/0/Tasker/yacho/yacho.html` にする（Mode は `URI`。Allow Phone Access と Allow Universal Access はオン。シーン表示は Activity, Full Window）。

### Tasker を使わずに開く

Download フォルダに `yacho.html` を置いて、Termux で次を実行してから、Chrome で `http://localhost:8000/yacho.html` を開く（遊んでいるあいだは Termux を閉じない）。

```sh
cd /storage/emulated/0/Download
python3 -m http.server 8000
```

## 音と演出

- 音はブラウザの中で作っている（音声ファイルは使わない）。ブラウザの決まりで、画面に最初に触れたときから鳴る。≡ メニューの「音と振動」で切れる（切ったことは次に開いたときも覚えている）。
- 場所ごとの音：Level 0 は蛍光灯のうなり（ときどき急に大きくなり、画面も細かく震える）。マニラの部屋ではうなりが消えて、静かなピアノ。Level 1 は弱いうなりと、ときどき管の鳴る音。停電中は無音になり、腕が近づくとこすれる音だけがする。Level 2 は機械の低い音。Level 3 はうなりと電気のはぜる音。Level 4 は空調の音。Level 5 は壁の向こうのくぐもったピアノと、ボイラー室のごうごういう音。Level 6 はほとんど無音。Level 7 は波。
- 出来事の音と画面：照明がまたたくと、うなりが途切れて画面がちらつく。停電で画面が暗くなる。けがをすると画面がゆがみ、短いノイズが鳴って、スマホが振動する（振動はブラウザや Tasker が対応している場合だけ）。野帳に書くと鉛筆の音。「確かめた」ときは小さなチャイムと、ネオンの二行（英語と日本語。このゲームで書き下ろしたもの）が出る。
- 走査線と周辺減光を、薄くかけている。
- 演出の方向は、利用者が見せてくれた別の HTML（走査線・画面のゆがみ・ネオンの警句・ビットビートの効果音）を参考にした。

## 保存

- localStorage の `yacho.state`。周回の記録は `yacho.state.loop`（はじめからやり直しても残る）。
- Tasker のシーンでは `/storage/emulated/0/Tasker/yacho/yacho-data.json` にも書き、書いたあとで変数 `%YACHO` を 1 にする。

## 時計版について

ゲーム本体（`// ==== ENGINE BEGIN ====` から `// ==== ENGINE END ====` まで）は画面に触らないように書いてある。
Amazfit Balance 2 版は `yacho-watch/` にある（このゲーム本体を自動で抜き出して使う）。

<details>
<summary>しくみと手順（ネタばれ）</summary>

| 項目 | 内容 |
|---|---|
| 渇き | 一手ごとに増える（ボイラー室では速い）。50 で「渇き」、90 で発疹（ウレッチ化の一段目）、130 でことばが「水」しか出なくなる（二段目）、170 で結末。アーモンド水で大きく下がる（二段目からは発疹が残る）。青いアーモンド水は 0 に戻す。缶詰、食堂のスープ、安全な場所で眠るのでも下がる |
| けが | 三度で倒れ、近くの安全な場所（基地など）で目を覚ます。眠ると治る |
| 野帳 | マニラの部屋の戸棚か、基地アルファの受付でもらえる。持つ前に見たことも、取ったときに書きこまれる |
| 周回 | 「椅子」の結末で置いていった野帳が、次の周回のマニラの部屋の戸棚に入っている |
| 結末 | 記録／椅子／記録の外／ウレッチ／赤／窓／十三階／スイッチ |

- Level 0：カーペットを調べる。「耳をすます」でうなりの薄い方角へ進みつづけると、茶色い壁の木の扉（マニラの部屋）。戸棚から野帳・青いアーモンド水・缶詰、書き置きを読む → 外へ出て、ちらつく壁を観察（三拍ごとに一拍消える）→ 「いまは消えている」ときに飛びこむ。赤い戸口には近づかない
- Level 1：メモを読む。目印（緑の非常口の灯り、橙色の布）を「見つめる」とそちらへ歩ける。東の通路の先が基地アルファ（受付で懐中電灯、待っている人から青い瓶、掲示板）。振り向くと木箱が出る。中を見てから手を入れる（見ずに手を入れるとガラスで切る）。停電したら、こすれる音がしたときだけ灯りを点けてすぐ消し、壁に触って東の非常口へ。がれきの下にバール。南の計器の通路のグラウラーは、観察してから重い物（バール・缶詰）を投げ、ふらついているうちに南へ。黄色い壁紙の柱に飛びこむと Level 0 に戻る
- Level 2：工具箱にケミカルライト。北の「生き残り」の基地跡の人は、ボトルを持って観察する → 手渡しせず床に置く。青い瓶を置くと、話せるまで戻り、基地アルファへ帰る。東の灯りの少ない区画の光る顔は、灯りを消して静かに抜ける（灯りを投げて囮にしてもよい）。突き当たりの「4」の扉が Level 4。「3」の扉はバールで板をはがせる
- Level 3：基地ガンマの門で衛兵に指を刺してもらう。柱の陰の厚着の人は、観察してから衛兵に伝える（話しかけすぎると襲われる）。西のエレベーターへ向かうと顔なしが三人出る → 北の聖所へ逃げこみ、去るまで待つ → エレベーター（Level 4 か 5）
- Level 4：塗られていない窓は離れて観察するだけ（二度近づくと結末）。北の廊下のハウンドは、観察してから見つめ、止まっているうちに北の基地オメガへ。保管係に野帳を渡すと「記録」。階段室の扉は、目を離すと消える（「見る」で戻る）
- Level 5：ハウスキーピングの隊員と話す。ビバリールームの麻雀は観察して放っておく。たくさんの扉を開けているとボイラー室に出る。炉に耳をすます。管のアーモンド水が飲める。銅の籠の 13 より上は押さない
- Level 6：耳をすまして波の方角へ。何かにぶつかったら、離れるか黙って待つ → 小さな声で話しかける（いきなり触ると逃げられる）。静かな部屋のスイッチは入れない（二度押すと結末）
- Level 7：ロープで水面へ。海を観察する。上へ戻れば帰り道。手を放すと「記録の外」

</details>

## もとにした記事とライセンス

このゲームの文章は、Backrooms Wiki の次の記事の内容を日本語に翻案している。もとの記事のライセンス（CC BY-SA 3.0）に合わせて、`yacho/` の中身も **CC BY-SA 3.0**（https://creativecommons.org/licenses/by-sa/3.0/ ）で公開する。

| 記事 | 作者（各ページの「Cite this page as」の表記） |
|---|---|
| [Level 0 - "Threshold"](https://backrooms-wiki.wikidot.com/level-0) | DivineAtlas, DrAkimoto, and RobertGoerman |
| [Level 1 - "Habitable Zone"](https://backrooms-wiki.wikidot.com/level-1) | Praetor3005 and DivineAtlas |
| [Level 2 - "Abandoned Utility Halls"](https://backrooms-wiki.wikidot.com/level-2) | Greggita Mahayfaio |
| [Level 3 - "Electrical Station"](https://backrooms-wiki.wikidot.com/level-3) | Natedagreat563 |
| [Level 4 - "Abandoned Office"](https://backrooms-wiki.wikidot.com/level-4) | u/M654zy on Reddit |
| [Level 5 - "Terror Hotel"](https://backrooms-wiki.wikidot.com/level-5) | Stretchsterz |
| [Level 6 - "Lights Out"](https://backrooms-wiki.wikidot.com/level-6) | Bart0nius |
| [Level 7 - "Thalassophobia"](https://backrooms-wiki.wikidot.com/level-7) | Bart0nius |
| [The Manila Room](https://backrooms-wiki.wikidot.com/manila-room) | Br Miller & Neptunium |
| [Entity 3 - "Smilers"](https://backrooms-wiki.wikidot.com/entity-3) | Palico22, rewritten by Stretchsterz |
| [Entity 8 - "Hound"](https://backrooms-wiki.wikidot.com/entity-8) | Palico 22, rewritten by 1000dumplings |
| [Entity 9 - "Facelings"](https://backrooms-wiki.wikidot.com/entity-9) | Original co authors: Jo and Higher Being Love Cereal!. Original collaborators: Backrooms explorers Reddit. First rewrite: 1000dumplings. Current rewrite: Nikuchan |
| [Entity 10 - "Skin-Stealer"](https://backrooms-wiki.wikidot.com/entity-10) | AndromedaMapping1; rewritten by 1000dumplings |
| [Entity 15 - "Wretches"](https://backrooms-wiki.wikidot.com/entity-15) | Stretchsterz and etoisle |
| [Object 1 - "Almond Water"](https://backrooms-wiki.wikidot.com/object-1) | Natedagreat563 |
| [The M.E.G.](https://backrooms-wiki.wikidot.com/the-m-e-g) | Greggita Mahayfaio, Natedagreat563, Orb1t41, Poliacci, Positive123, Praetor3005, Robert Goerman, Reyday, Snomwriting and Squibblezombie |

- 実体の番号（第1記事「人間」、第2記事「窓」、第81記事「エレベーター」など）は、wiki の実体一覧による。
- 記事は 2026年10月に読んだ。Level 0〜7、実体 3・8・9・10、Object 1、The M.E.G. は、利用者が保存したページの本文で読んだ。The Manila Room と Entity 15 は、この環境からページを直接開けなかったため、検索結果の要約で読んだ（作者名も検索結果の表記）。
- wiki のページは書き直されることがある。今の版と食い違っているところがあるかもしれない。
- 記事にない細かい決まりごと（停電中の腕の動き方、ちらつく壁の拍、ハウンドを観察する場面のワンダラー、レベル6でぶつかる人、スイッチを入れたあとのことなど）は、このゲームで足したもの。

## 確認したこと

- Node.js でゲーム本体だけを動かし、八つの結末すべてにたどり着けること、本道（基地オメガで野帳を渡す）を配置を変えて 40 回通しで遊べること、周回で前の野帳が戸棚に入ることを確かめた。「命令を作る」と同じ候補からランダムに選んだ命令を約 10 万回送り、例外やおかしな表示は出なかった。
- Chromium（スマホ幅 412px）で、ボタン操作・「命令を作る」・入力欄・レベルごとの色・はみ出しがないことを確かめた。
- Chromium で、音が場所ごとに切り替わること（出力の音量を測った）、停電中と「音と振動：切」で無音になること、「確かめた」ときにネオンの二行が出て消えることを確かめた。実際に耳で聞いての調整はしていない。
- 実機（Xperia 1 IV のブラウザ、Tasker のシーン）では、音・振動を含めて、まだ確かめていない。
