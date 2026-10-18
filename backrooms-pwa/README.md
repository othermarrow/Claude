# 階層目録

Backrooms のテキストアドベンチャー4本を、起動画面から選んで遊べるようにしたアプリ（PWA）。
Chrome で「インストール」すると、ホーム画面のアイコンから開ける。4本とも、もとの版より階層を深く、難しくし、目的が分からないように作り直している。演出は、階層ごとに画面全体の色が変わり、走査線・ネオンの格言・背景の線画・bytebeat の音・揺れ・振動が出る。

| 札 | ゲーム | ファイル | 状態 |
|---|---|---|---|
| 記録 01 | 降下記録 | `games/tane-wo-niru.html` | 強化済み（Level 0〜11） |
| 記録 02 | 空欄 | `games/kuuran.html` | 強化中 |
| 記録 03 | ノークリップ | `games/noclip.html` | 強化中 |
| 記録 04 | 野帳 | `games/yacho.html` | 強化中 |

もとの版（`tane-wo-niru/` `kuuran/` `noclip/` `yacho/`）はそのまま残してある。こちらは別の保存場所を使うので、もとの版の続きとはつながらない。

## インストールのしかた（スマホだけでできる）

PWA は `https://` か `http://localhost` で開いたときだけインストールできる。リポジトリが非公開なので、Termux の中で小さなサーバーを動かして、同じスマホの Chrome から開く。

1. Termux で、ブランチを取ってきてサーバーを動かす。

   ```sh
   cd ~/Claude
   git fetch origin ccr-d4f31da7-u5hlbp
   git checkout ccr-d4f31da7-u5hlbp
   git pull origin ccr-d4f31da7-u5hlbp
   sh backrooms-pwa/serve.sh
   ```

   「Chrome で http://localhost:8080/ を開いてください」と出たら、Termux はそのままにしておく。

2. Chrome で `http://localhost:8080/` を開く。
3. 起動画面の「ホーム画面にインストール」を押す。ボタンが出ないときは、Chrome 右上の ⋮ から「アプリをインストール」または「ホーム画面に追加」を選ぶ。
4. インストールが済んだら、Termux のサーバーは Ctrl+C で止めてよい。一度開いたファイルはアプリの中に取っておかれるので、次からはホーム画面のアイコンだけで開ける（はず。下の「確認したこと」を参照）。

### 新しい版にするとき

手順 1 をもう一度やり、サーバーが動いているあいだにアプリを一度開く。開くたびにまずサーバーから新しいファイルを取りにいき、取れなかったときだけ取っておいたものを使う作りになっている。

### 注意

- 遊んだ記録は、Chrome の中の `localhost:8080` という場所に保存される。ポート番号（8080）を変えると、記録が見えなくなる。
- Chrome の「サイトのデータを削除」をすると、記録も消える。
- `serve.sh` は `127.0.0.1` でだけ待つので、同じ Wi-Fi のほかの端末からは見えない。

## 設定

起動画面の下に「音」「振動」「動き」の切り替えがある。4本のゲームでも同じ設定が使われる（localStorage の `bpwa.settings`）。「動き」を切ると、揺れ・明滅・背景の動きが止まる。端末の「視覚効果を減らす」設定がオンのときも止まる。

## 中身

| ファイル | 役目 |
|---|---|
| `index.html` | 起動画面。札を押すとゲームへ。各ゲームの結末の数・いちばん深い階層・周回数を札に出す |
| `fx.js` | 共通の演出。蛍光灯のうなりと階層ごとの環境音（15種）、効果音（20種）、鼓動、背景の線画（13星座・波形・海・洞窟の雫・住宅地・麦畑・街など）、走査線、ネオンの格言、揺れ、閃光、停電、記録映像ふうの表示、bytebeat の音、振動（タップしたときの音は出さない） |
| `games/*.html` | 4本のゲーム。どれも HTML 一枚で、`../fx.js` を読む（読めなくても遊べる） |
| `manifest.webmanifest` | アプリの名前・アイコン・色 |
| `sw.js` | オフラインでも開けるようにする仕組み（Service Worker）。ファイルを足したら `FILES` に足し、`VERSION` を上げる |
| `icons/` | アイコン（192px、512px、マスク用 512px） |
| `serve.sh` | Termux で動かすサーバー（`python3 -m http.server 8080 --bind 127.0.0.1`） |
| `build_standalone.py` | ゲームに fx.js を埋めこんで、HTML 一枚で開ける版を `standalone/` に作る |
| `standalone/tane-wo-niru-standalone.html` | 降下記録の HTML 一枚版（下の「降下記録だけを遊ぶ」） |

### ゲームと起動画面の約束

- 保存：`localStorage["bpwa.<id>.state"]`（id は `koka` `kuuran` `noclip` `yacho`）。
- 札に出す要約：`localStorage["bpwa.<id>.meta"]` に `{"endings": [...], "total": 数, "deepest": "Level 11", "runs": 数, "updated": 時刻}`。
- 各ゲームの ≡ メニューに「起動画面へ」がある。

### fx.js の使い方（ゲームを直すとき）

`FX.level(階層, {a, b, mode, bed})`（`{hum: 0}` だけを渡すと無音）、`FX.bed(環境音)`、`FX.sfx(効果音)`、`FX.flicker(回数)`、`FX.stress(0〜1)`、`FX.shock(1|2)`、`FX.glitch()`、`FX.flash()`、`FX.blackout(ミリ秒)`、`FX.truism(英, 日, 出典)`、`FX.tags([...])`、`FX.vhs(true|false)`、`FX.align(true|false)`、`FX.vibrate(パターン)`、`FX.set("sound"|"vibe"|"motion", 真偽)`。どれも `window.FX &&` で守って呼ぶ。

## 降下記録（強化版）

- 階層：Level 0〜11。Level 0〜6 は、もとの物語の骨組み（記憶のない始まり、配線の塊に「ヨル」と名前をつける、書いて電話をとる、豆を煮る決まりごと、空いた椅子と「わからない」）を残したまま、Backrooms Wiki の各レベルの設定で作り直した。Level 7（海）、8（洞窟）、9（夜の住宅地）、10（麦畑）、11（眠らない街）を足した。
- 増えた仕組み：孤立効果とうなりの高まり（Level 0）、M.E.G. の詰所跡（Level 1）、熱と果てのない黒（Level 2）、点検表（Level 3）、給水器のアーモンド水と塗られていない窓（Level 4）、ビバリールームとボイラー室（Level 5）、点かない懐中電灯と押してはいけないスイッチ（Level 6）、息（海の中）、懐中電灯の電池、ゲームごとに変わる迷路の正解・扉・家の特徴、実体（Deathmoths、Skin-Stealer、Smilers、Hounds、引っかき傷で警告する盲目の実体ほか）、長居の罰。
- 音：部屋ごとに環境音が変わり、扉・足音・物・実体の前ぶれに効果音が鳴り、出来事に合わせて蛍光灯がちらつく。
- 「わからない」は 3回目から正気が減り、深い階では答えが遠回しになる。遊び方の説明は操作だけ。
- 結末は5つ。どれが正解かは、どこにも書いていない。
- 深い階の管理室に「五台の分析機」が「あなた」を標本にしている記録がある。利用者が渡した五つの分析レポートの要点を、名前などを出さずに書き下ろした。

### 降下記録だけを遊ぶ（HTML 一枚版）

`standalone/tane-wo-niru-standalone.html` は、演出（fx.js）を中に埋めこんだ一枚のファイル。サーバーなしで、ブラウザや Tasker のシーンで直接開ける（インストールはできない）。起動画面がないので「起動画面へ」ボタンは出ない。

- Tasker のシーンで開くときの保存先は `/storage/emulated/0/Tasker/koka/koka-data.json`（変数 `%KOKA`）。もとの「降下記録」の保存（`Tasker/tane-wo-niru/`）とは分けてある。
- ゲームを直したら、`python3 build_standalone.py tane-wo-niru` で作り直す。

<details>
<summary>降下記録の攻略（ネタばれ）</summary>

| id | 結末 | 条件 |
|---|---|---|
| wake | 目を開ける | Level 6：空いた椅子に座って「わからない」 |
| swap | 交代した | Level 6：人影に触る、照明のスイッチを二度押す、または静かな部屋で正気 0 |
| field | 麦の家 | Level 10：納屋で二度眠る |
| exit | 番号のない出口 | Level 11：バリケードを二度越えようとする |
| sleep | 消灯 | Level 11：312号室で眠る |

- Level 0：耳をすまし、うなりの強い方角へ進みつづける（遠ざかりつづけると赤い部屋、穴の部屋で下へ行くと落ちる）→ 灯りの消えた区画で濡れた紙切れを読む → 下。
- Level 1：北（詰所）→ ロッカーを開け、懐中電灯・手袋・バールを取る → 南 → 木箱を開けてアーモンド水 → 東 → 手袋を身につけ、断熱扉を開ける → 東 → 霜のない箱を開けて鍵を取る（灯りが消える。懐中電灯を点ける）→ 西×3 → 鍵を鍵穴に入れる → 下。
- Level 2：東 → バルブを閉める → 錆びた缶を開けて手紙を取る → 西 → 北×3 → 配線の塊に名前をつける → 下（窓のある扉は開けない）。
- Level 3：どれかの変電室の扉を開ける → 点検する場所を一度ずつ確かめる（二度目は場所が増える）→「もういい」と言う → 西 → 札のない扉を開ける → 下（黒い管に触らない、通路で立ち止まらない）。
- Level 4：東・東（会議室）→ 白い紙と鉛筆を取る → 西 → 北（給湯室）→ 耳をすます → 書く → 南・西 → 内線電話を取る → 下（塗られていない窓に近づかない）。
- Level 5：北（ビバリールーム）→ 耳をすまし、機械の音がする壁の扉へ（ボイラー室）→ 懐中電灯を消す → 豆の袋を鍋に入れる → かき混ぜる×6（振り向かない、声を出さない、止めない）→ 炉の火を消す → 下。
- Level 6：北 → 原稿を読む → 南 → 下（波の音のほう）。ここで空いた椅子に座って「わからない」なら結末「目を開ける」、人影に触れるかスイッチを二度押すと「交代した」。
- Level 7：呼び鈴を取る → 東（落ちる）→ 息を吸う → 下 → 呼び鈴を鳴らす → 下・下・下 → 懐中電灯を点ける → 下 → 北。
- Level 8：東 → リュックを開け、電池を取って懐中電灯に入れる（手帳・カメラも）→ 西 → 北 → 各段で標識を読み、矢印の方角へ（番号はでたらめ。翅の段では灯りを消してから進み、引っかき傷の段では待つ）→ 道の終わりで待つ・待つ。
- Level 9：三軒の家を調べ、一軒だけ違う家に入る（引き出しの電池、冷蔵庫の水）→ 北 → 灯りを消して白い歯を見つめる → 北 → 唸り声が聞こえたらすぐ隠れる → 東（チョークの絵のとおり草の中へ）。
- Level 10：麦を取る → 北（納屋）→ 西・西・西・西。
- Level 11：北 → 東 → 東 → 郵便受けを開けて 312の鍵を取る（自販機の水も）→ 上 → 312の扉を開ける → 分電盤を押す → カーテンを閉める → 麦の穂（または戸棚を開ける・閉める・開けるで届く豆の袋）を小鍋に入れる → コンロを点ける → かき混ぜる×6（戸を叩かれても開けない・答えない）→ 火を消す → 眠る。
- 管理室の十三星座盤を回すと月がそろい、正気が戻る。

</details>

## もとにしたものとライセンス

The Backrooms は、2019年に匿名掲示板 4chan に投稿された黄色い部屋の写真と、「現実からすり抜けると、ここに出る」という書きこみから広まった共同創作。このアプリの各ゲームは、Backrooms Wiki の記事の内容を日本語に翻案した部分を含む。もとの記事のライセンス（CC BY-SA 3.0）に合わせて、`backrooms-pwa/` の中身も **CC BY-SA 3.0**（https://creativecommons.org/licenses/by-sa/3.0/ ）で公開する。

### 降下記録で使った Backrooms Wiki の記事

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
| [Level 8 - "Cave Systems"](https://backrooms-wiki.wikidot.com/level-8) | C-Graph and kai4C |
| [Level 9 - "The Suburbs"](https://backrooms-wiki.wikidot.com/level-9) | Stretchsterz |
| [Level 10 - "Bumper Crop"](https://backrooms-wiki.wikidot.com/level-10) | scutoid studios & egglord |
| [Level 11 - "The City That Never Sleeps"](https://backrooms-wiki.wikidot.com/level-11) | Greggita Mahayfaio, inspired by the original Level 11 by nerdykiddo4884 |
| [Entity 3 - "Smilers"](https://backrooms-wiki.wikidot.com/entity-3) | Palico22, rewritten by Stretchsterz |
| [Entity 4 - "Deathmoths"](https://backrooms-wiki.wikidot.com/entity-4) | DrAkimoto |
| [Entity 8 - "Hound"](https://backrooms-wiki.wikidot.com/entity-8) | Palico 22, rewritten by 1000dumplings |
| [Entity 10 - "Skin-Stealer"](https://backrooms-wiki.wikidot.com/entity-10) | Original author is AndromedaMapping1; Rewritten by 1000dumplings |
| [Object 1 - "Almond Water"](https://backrooms-wiki.wikidot.com/object-1) | Natedagreat563 |
| [The M.E.G.](https://backrooms-wiki.wikidot.com/the-m-e-g) | Greggita Mahayfaio, Natedagreat563, Orb1t41, Poliacci, Positive123, Praetor3005, Robert Goerman, Reyday, Snomwriting and Squibblezombie |

- 記事は 2026年10月に、利用者が保存したページの本文で読んだ。wiki のページは書き直されることがあり、今の版と食い違うところがあるかもしれない。
- 記事にない細かい決まりごと（ヨル、点検表、豆を煮る決まりごと、九番目の道の迷路、息の数え方、312号室の手順など）は、このゲームで足したもの。

### そのほかに参考にしたもの

- The Backrooms JP Wiki「Level 1 N」（https://japan-backrooms-wiki.wikidot.com/level-1-n ）：Level 11 の地下鉄の駅の様子だけを借りた。ライセンスの表記を確認できていないので、文章は使っていない。
- 日本語版ウィキペディア「リミナルスペース」「アナログホラー」：The Backrooms の始まり（2019年の投稿、2022年からの Kane Pixels の映像）を確かめるのに使った。
- 利用者が渡した zip（Backrooms-Database-Archives）にあった実体：ライセンスの表記がないので、名前も文章も使わず、「壁の引っかき傷の警告 → 止まって黙る」という仕掛けの発想だけを使った。
- Internet Archive にある Backrooms の記録映像：ビデオカメラの記録の見た目（`FX.vhs`）の参考にした。
- 演出の水準は、利用者が別の AI で作った派手版の「降下記録」に合わせた。派手版の物語の文章は使っていない。

空欄・ノークリップ・野帳で使う記事は、強化が済んだらここに足す。

## 確認したこと

- 起動画面：Playwright（Chromium、幅 390px）で開き、エラーが出ないこと、Service Worker が登録されること、オフラインでも開けること、Chrome がインストールできると判定すること（試験用の画面ではシークレット扱いになるので、その理由だけが出た）を確かめた。
- 降下記録：Playwright で、5つの結末すべてに命令だけでたどり着けること、Level 0〜11 を全部通ること、21種類の失敗が前ぶれのあとで起き、そのあとも遊び続けられること、ランダムな命令 36,000 回で例外が出ないこと、幅 360px でも ≡ が押せること、古い保存があっても壊れずにはじめからになることを確かめた。
- 音：環境音と効果音がエラーなく鳴り、音が割れないこと（ピークが 0.25 未満）をブラウザの中で測った。スピーカーでどう聞こえるかは確かめていない。
- **実機（Xperia 1 IV の Chrome）では、まだ確かめていない。** インストールできるか、Termux を止めたあとにホーム画面から開けるか、音・振動が出るかは、未確認。
