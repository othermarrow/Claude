# 階層目録

Backrooms のテキストアドベンチャー4本を、起動画面から選んで遊べるようにしたアプリ（PWA）。
Chrome で「インストール」すると、ホーム画面のアイコンから開ける。4本とも、もとの版より階層を深く、難しくし、目的が分からないように作り直している。演出は、階層ごとに画面全体の色が変わり、走査線・ネオンの格言・背景の線画・bytebeat の音・揺れ・振動が出る。

| 札 | ゲーム | ファイル | 状態 |
|---|---|---|---|
| 記録 01 | 降下記録 | `games/tane-wo-niru.html` | 強化済み（Level 0〜11） |
| 記録 02 | 空欄 | `games/kuuran.html` | 強化済み（裏側 7か所、結末 5） |
| 記録 03 | ノークリップ | `games/noclip.html` | 強化済み（Level 0〜11・37・Fun・!・433 N、結末 6） |
| 記録 04 | 野帳 | `games/yacho.html` | 強化済み（Level 0〜11・433 N・444 N、結末 17） |

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
| `standalone/*-standalone.html` | 各ゲームの HTML 一枚版（下の「HTML 一枚版」） |

### ゲームと起動画面の約束

- 保存：`localStorage["bpwa.<id>.state"]`（id は `koka` `kuuran` `noclip` `yacho`）。
- 札に出す要約：`localStorage["bpwa.<id>.meta"]` に `{"endings": [...], "total": 数, "deepest": "Level 11", "runs": 数, "updated": 時刻}`。
- 各ゲームの ≡ メニューに「起動画面へ」がある。

### fx.js の使い方（ゲームを直すとき）

`FX.level(階層, {a, b, mode, bed})`（`{hum: 0}` だけを渡すと無音）、`FX.bed(環境音)`、`FX.sfx(効果音)`、`FX.flicker(回数)`、`FX.stress(0〜1)`、`FX.shock(1|2)`、`FX.glitch()`、`FX.flash()`、`FX.blackout(ミリ秒)`、`FX.truism(英, 日, 出典)`、`FX.tags([...])`、`FX.vhs(true|false)`、`FX.align(true|false)`、`FX.vibrate(パターン)`、`FX.set("sound"|"vibe"|"motion", 真偽)`。どれも `window.FX &&` で守って呼ぶ。

## HTML 一枚版

`standalone/` の `*-standalone.html` は、演出（fx.js）を中に埋めこんだ一枚のファイル。サーバーなしで、ブラウザや Tasker のシーンで直接開ける（インストールはできない）。起動画面がないので「起動画面へ」ボタンは出ない。

| ファイル | Tasker のシーンで開くときの保存先（変数） |
|---|---|
| `tane-wo-niru-standalone.html`（降下記録） | `/storage/emulated/0/Tasker/koka/koka-data.json`（`%KOKA`） |
| `kuuran-standalone.html`（空欄） | `/storage/emulated/0/Tasker/kuuran2/kuuran2-data.json`（`%KUURAN2`） |
| `noclip-standalone.html`（ノークリップ） | `/storage/emulated/0/Tasker/noclip2/noclip2-data.json`（`%NOCLIP2`） |
| `yacho-standalone.html`（野帳） | `/storage/emulated/0/Tasker/yacho2/yacho2-data.json`（`%YACHO2`） |

- 保存先は、もとの版（`Tasker/tane-wo-niru/`、`Tasker/kuuran/`、`Tasker/noclip/`、`Tasker/yacho/`）とは分けてあるので、もとの版の記録を上書きしない。
- ゲームを直したら、`python3 build_standalone.py tane-wo-niru kuuran noclip yacho` で作り直す。

## 降下記録（強化版）

- 階層：Level 0〜11。Level 0〜6 は、もとの物語の骨組み（記憶のない始まり、配線の塊に「ヨル」と名前をつける、書いて電話をとる、豆を煮る決まりごと、空いた椅子と「わからない」）を残したまま、Backrooms Wiki の各レベルの設定で作り直した。Level 7（海）、8（洞窟）、9（夜の住宅地）、10（麦畑）、11（眠らない街）を足した。
- 増えた仕組み：孤立効果とうなりの高まり（Level 0）、M.E.G. の詰所跡（Level 1）、熱と果てのない黒（Level 2）、点検表（Level 3）、給水器のアーモンド水と塗られていない窓（Level 4）、ビバリールームとボイラー室（Level 5）、点かない懐中電灯と押してはいけないスイッチ（Level 6）、息（海の中）、懐中電灯の電池、ゲームごとに変わる迷路の正解・扉・家の特徴、実体（Deathmoths、Skin-Stealer、Smilers、Hounds、引っかき傷で警告する盲目の実体ほか）、長居の罰。
- 音：部屋ごとに環境音が変わり、扉・物・実体の前ぶれに効果音が鳴り、出来事に合わせて蛍光灯がちらつく。足音は別の階に着いたときだけ。
- 「わからない」は 3回目から正気が減り、深い階では答えが遠回しになる。遊び方の説明は操作だけ。
- 結末は5つ。どれが正解かは、どこにも書いていない。
- 深い階の管理室に「五台の分析機」が「あなた」を標本にしている記録がある。利用者が渡した五つの分析レポートの要点を、名前などを出さずに書き下ろした。

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

## 空欄（強化版）

- もとの骨組み（白い部屋、613 のファイルと五つの欄、曜日が進むこと、校舎の決まり、インコと公衆電話、体温、日曜の配達員と「613」か「　」）を残したまま、建物と「裏側」を Backrooms Wiki と JP Wiki の設定で作り直した。
- 白いのは 613 の部屋だけ。扉の外の建物は夜で、病棟・喫煙所・喫茶・校舎・音楽室・屋上・図書室・土手で配色がはっきり変わる。
- 建物の中：誰ともすれ違わない病棟（孤立効果）、前の人たちの「申し送りノート」、土曜にだけ来る看護師（職員のふりをする Skin-Stealer）、喫煙所の顔のない三人（Facelings）、アーモンドの匂いの水割り、並びに理由のない校舎と二階（JP Level 2 N 風。家庭科室の顔のない子どもたち、図画工作室の笑った風船）。
- 裏側（すり抜けた先）：Level 37（白いタイルのプール）、Level 4（事務所）、Level 9（夜の住宅地）、Level 11（街）、Level Fun、Level 444 N（夕暮れの田園。バス停）。
- 体温が上がると鼓動が鳴る。部屋ごとに環境音が変わり、扉・物・配達員のベル・公衆電話・実体の前ぶれに効果音が鳴る。
- 「わからない」は1日3回までで、聞くたびに体温が上がる。遊び方の説明は操作だけ。結末は5つで、どれが正解かは書いていない。

<details>
<summary>空欄の攻略（ネタばれ）</summary>

| id | 結末 | 条件 |
|---|---|---|
| number | 受け取った | 日曜、配達員に「613」と答える |
| blank | 空欄 | 日曜、配達員に「　」と答える |
| pool | 浮かぶ | 五つの欄が埋まった状態で 615 → 寝る×2 |
| face | 顔 | Level 11 の大通りで待つ×3 |
| dusk | 夕焼け | 五つの欄が埋まったあと、日曜に校舎 → 理科室の前から東 → Level 444 N → 東のバス停 → 座る×2 |

1. 木曜：ベッドを調べる → 北 → 西（申し送りノートを読む）→ 東 → 北 → 西 → 待つ（皆が壁を向く）→ 鍵束を取る → 警備員室の扉を開ける → 北 → DVDプレーヤーを押す → 冷蔵庫を開ける →「エンドロールだけの映画」と言う。
2. 南 → 東 → 東 → スイッチを押す → 弦を取る → 西 → 南 → 611 の扉を開ける → 蛍光灯を消す → 耳をすます。
3. 東 → 東 → 東 → 下 → 鉛筆を取る → 上 → 北（校舎で走る・押す・しゃべると怪物が来て、言葉が分かる）→ 東（教室）→ チョークを取る →「おさない」「はしらない」「しゃべらない」と書く → 答案用紙を取る。
4. 西 → 北 → 東 → ケースを開ける → 弦をバイオリンに入れる → 弾く →「きれい」→「帰る」。
5. 正面玄関のガラスに額をぶつけて 37.0〜37.4℃ にする → 615 を開ける → 夢を書く（どれでもよい）→ 下。
6. 詰所で Scroll Lock を押す → 待つ×2 → 返却口の硬貨を取る → 東 → 笑う顔を調べる → 東 → 待つ → 下。
7. 寝る → 月曜：鏡の破片を取る → 理科室の鍵穴を調べる → のりを取る → パンフレットを折る → 破片を調べる → 寝る。
8. 水曜：配達員のあとで 616 を開ける → しゃべらない家で皿を食べる → 標識を調べて矢印のとおりに×3 → 売店で硬貨を店番に渡す → 東 → 北 → 詰所で日曜の紙をカレンダーに貼る。
9. 視聴覚室で質問を3回言う → 食べた料理を言う → 白い部屋で寝る。
10. 日曜：正面玄関から北 → 配達員に「613」か「　」。

- 寄り道：二階の泣いている子に、光る音符・水筒・硬貨のどれかを渡すと、料理の味を知れる。二階の風船 → Level Fun（裏返しのポスター → Level 4、手すりから下 → Level 37）。土曜の詰所は2手以内に出る。外階段は走って上ると屋上 → 天窓を開ける（熱が下がる）。

</details>

## ノークリップ（強化版）

- もとの骨組み（現実からすり抜けて Level 0 に落ちる始まり、M.E.G. の生存手引き、正気・電池・アーモンド水、記録の書き換わり、前の自分の書きこみと無線の声が残る周回、0 → 7 → 37 と Fun → ! の流れ）を残したまま、Level 0〜7 を Backrooms Wiki の各レベルの設定で作り直し、Level 8〜11 と JP Wiki の 433 N（カプセルホテル）をつないで一本の話にした。
- 各階に、先を行く誰かの同じ字の跡が残っている（水のラベル、身分証の裏、宿帳、帳面、Level 11 の名簿）。周回すると、それが誰の字か分かる。
- 増えた仕組み：ちらつく壁、赤い部屋、穴の部屋、うなりの高まり、マニラの部屋、目を離すと消える木箱、M.E.G. の布の目印、停電中の非常灯、ウレッチになりかけた人、行き止まりの扉「3」「4」、聖所、背後から来るハウンド、扉の声の主、塗られていない窓、エレベーターの「13」、デスモスの巣、ものまね、横倒しの部屋と海の三層（息）、判定機の標本記録。
- 結末は6つ（帰還／崇高／=)／ウレッチ／豊作／地図係）。どれが正解かは書いていない。「わからない」は一つの階で二回までで、聞くたびに正気が減る。
- 部屋ごとに環境音が変わり、扉・鍵・無線・実体の前ぶれと襲撃・結末に効果音が鳴る。足音は新しい階に着いたときだけ。

<details>
<summary>ノークリップの攻略（ネタばれ）</summary>

| id | 結末 | 条件 |
|---|---|---|
| exit | 帰還 | Level 37 の西の浅いプールで排水口を開けて「下」 |
| sublime | 崇高 | Level 37 で長く待つか、眠る |
| party | =) | Level Fun で「はい」と言う、ケーキを食べる、留まる |
| wretch | ウレッチ | 三度倒れる（青いアーモンド水で一つ戻せる） |
| harvest | 豊作 | Level 10 で麦粥を二杯食べるか、二度眠る |
| beta | 地図係 | Level 11 の隊員に「はい」と答える |

- Level 0：「耳をすます」で分かる足音・空調の方角と、カーペットが粘りつく方角を避けて歩く。ちらつく壁が出たら「すり抜ける」。空調の方角で 433 N に迷いこんだら「寝る」。
- Level 1：「振り向く」→ 木箱を開ける → 木箱を調べる → 水と電池を取る。布のメモを読み、布を取って床に置く。東の分所で、ホワイトボードの番号のロッカーから懐中電灯と生存手引きを取る。広間で停電したら、待つか東の非常灯へ。北の配管の通路で灯りを点けて「下」。
- Level 2：東の野営跡で、うずくまる人に水を渡す（してもしなくてもよい。電池がもらえる）。北の分岐で三本の管に触り、冷たい管の方角へ 4回。ハウンドが出たら、調べて（見つめて）から離れる。「3」の扉を開けて（板を外して）「下」。
- Level 3：扉の声には答えず、5手待つ（扉の隙間にアーモンド水を流してもよい）。爪の音がしたら「振り向く」。鉄扉の小部屋で身分証と鍵を取る。発電機室で、身分証の裏に書かれた二つのスイッチだけ上げる。エレベーターに鍵を入れてボタン。
- Level 4：給水器、端末、引き出し、自動販売機。塗られていない窓には触れない。北の「5の扉」（風船の扉は Level Fun へ）。
- Level 5：北 → エレベーター →「5」でリネン室（青い魔法瓶とメモ）→「1」でロビーへ戻る（「13」を押したら、次の手で「1」）。北 → 東のビバリールームで、蓄音機の針が上がるのを待って鍵を取る。西の廊下でボイラー室の扉を開け、西 →「下」。
- Level 6：「耳をすます」で波の方角へ 3回。スイッチを入れてと頼まれても入れない。自分の声がしたら黙って、待つか、そのまま進む。
- Level 7：帳面を読む → ロープを取って結ぶ →「下」で海面 →「下」で三層を潜る。影が通るあいだは待つ。真夜中の層で灯りを点ける（灯りがなければ二手待つ）→「下」で洞窟から Level 8 へ。
- Level 8：上着、標識。蛾の前では灯りを消す。薄い床。
- Level 9：男の血の色を見て入る家を決め、冷蔵庫のメモを読み、裏庭で小道を外れる。
- Level 10：屋根裏の窓で轍の方角を見て、新しい轍をたどる。
- Level 11：青い矢印で基地ベータへ行き、地図を読む。灰色の線の前では動かない。プールの色の矢印へ行って潜る → Level 37。
- Level Fun：「はい」と言わず、ケーキを食べず、「!」の扉へ。Level ! で示された方角へ 5回、最後に北で Level 11 へ出る。

</details>

## 野帳（強化版）

- もとの骨組み（出会うものを観察して野帳に書く、観察 → 見立て → 確かめる、渇きとけが、記録・椅子・記録の外などの結末）を残したまま、Level 0〜7 に Backrooms Wiki の設定を足し、Level 8〜11 と JP Wiki の 433 N（カプセルホテル）・444 N（夕暮れの田園）をつないだ。
- 全体をつなぐ糸として「星の紙片」が14枚ある。前にこの道を歩いた誰かの帳面からちぎれたページで、読むと野帳に写される。書き手が誰かは、どこにも書いていない。
- 増えた仕組み：穴の部屋、照明の消えた区画、B.N.T.G. の出店、工事の黒い影、九番道の標識、白い蛾、肉食の風船、霧、パーティーゴアー、五台の読み取り機、灯りの移るカプセル（433 N）、8手ごとに流れる夕方の放送（444 N）。
- 音は fx.js にまとめた（ゲーム独自の音源は外した）。部屋ごとに環境音が変わり、新しい記録・見立て・確かめ・実体の前ぶれ・結末に効果音が鳴る。渇きやけがで鼓動が速くなる。タップの音はなく、足音もごく一部の場面だけ。
- 結末は17。どれが正解かは書いていない。

<details>
<summary>野帳の攻略（地図の結末まで。ネタばれ）</summary>

- Level 0：カーペットを調べる。耳をすまし、うなりの薄い方角へ3回進んで木の扉へ。戸棚を開け、野帳・青いアーモンド水・缶詰を取り、書き置きと星の紙片を読む。赤い戸口・穴の集まった側・空調の方角を避けて歩く。ちらつく壁を3回観察し、「いまは消えている」ときに飛びこむ。（空調の方角へ2回続けて歩くと 433 N。灯りのカプセルを観察し、2手待って灯りが移るのを見て、もう一度観察してから、そのカプセルに入って寝る → Level 1）
- Level 1：メモを読み、水を飲んで空き瓶を戻し、がれきからバールを取る。緑の灯りを見つめて東へ。紙片を読み、北の基地アルファで受付に2回話しかけ、待っている人・掲示板・食堂の順に回る。柱の区画で、振り向いて出た木箱を観察してから中身を取る。停電したら音がするまで待ち、懐中電灯を点けてすぐ消し、壁に触って東へ。南の計器の通路でグラウラーを3回観察し、バールを投げて南へ。
- Level 2：工具箱からケミカルライト。北の基地跡で紙片を読む（飲みかけの瓶は飲まない）。ボトルを持ったままウレッチを3回観察し、アーモンド水を床に置き、続けて青い瓶を置く。東の暗がりで光る顔を観察し、灯りを点けて消し、待ってから東へ。「4」の扉へ。
- Level 4：窓は観察するだけ。北の廊下でハウンドを3回観察し、見つめてから北の基地オメガへ。棚と紙片を読む（保管係に野帳を渡すと結末「記録」）。南・南・見る・東の階段室から下へ。
- Level 5：ハウスキーピングの隊員に話しかけ、紙片を読む。ビバリールームの麻雀を観察する。扉を開けつづけてボイラー室へ。炉に耳をすまして下へ。
- Level 6：耳をすまして波の方角へ。何かにぶつかったら離れてから話しかける。静かな部屋のスイッチは押さない。階段の紙片を指で読んで下へ。
- Level 7：紙片を読み、ロープで下へ降りて海を観察。上に戻って防水の箱から発炎筒を取る。下へ3回降りて深みへ。懐中電灯を点け、暗い水を観察して、洞窟の口の方角へ。
- Level 8：看板と紙片を読む。壁ぎわの人を3回観察し、つなぎを取る。北へ。標識を観察し、3手待って崩れるのを見たら、もう一度観察する。続き番号で鷲の印の標識へ3回。前哨地で掲示・蛾番・スープ・寝る。北の洞で灯りを消し、瓶を置いて待つ。蛾が回る床へ。
- Level 9：東の家でメモ・紙片・缶詰・リモコン。風船を3回観察する。霧が濃くなるまで待ち、霧を観察したら家に戻り、霧が引くまで待つ。リモコンを投げて東へ。裏庭では小道以外の方角へ。
- Level 10：納屋で日記を読む（粥は食べない）。麦の穂を置いて観察する。池で水を飲み、紙片を読み、池を観察して2回飛びこむ → 444 N。
- 444 N：北の辻で紙片を読む（山には入らない）。南のため池で旋律を待ち、流れているあいだに観察し、終わるのを見る。次の旋律のあいだに飛びこむと Level 10 に戻る。西のわだちを観察し、立て札を読み、北へ歩きつづける。
- Level 11：ベンチのメモと貼り紙を読む。東のパーティー会場で、衝立を押し、2回待ち、また衝立を押して西へ。工事の柵を観察・待つ・観察。北の基地ベータで掲示・地図係・紙片・読み取り機を読み、野帳を地図係に渡す → 結末「地図」。
- ほかの結末：マニラの部屋の戸棚に野帳を入れる（椅子）、Level 7 の深みで下へ2回（記録の外）、444 N で石段を2回上る（山）、ほか赤・窓・十三階・スイッチ・眠り・巣・小道・粥・菜の花・出口・=)・ウレッチ。

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

### 空欄で使った Backrooms Wiki の記事

| 記事 | 作者（各ページの「Cite this page as」の表記） |
|---|---|
| [Level 0 - "Threshold"](https://backrooms-wiki.wikidot.com/level-0) | DivineAtlas, DrAkimoto, and RobertGoerman |
| [Level 4 - "Abandoned Office"](https://backrooms-wiki.wikidot.com/level-4) | u/M654zy on Reddit |
| [Level 9 - "The Suburbs"](https://backrooms-wiki.wikidot.com/level-9) | Stretchsterz |
| [Level 11 - "The City That Never Sleeps"](https://backrooms-wiki.wikidot.com/level-11) | Greggita Mahayfaio, inspired by the original Level 11 by nerdykiddo4884 |
| [Level 26 - "The SS Fun =)"](https://backrooms-wiki.wikidot.com/level-26) | Robert Goerman and MC_Crafter_24_7 |
| [Level 37 - "Sublimity"](https://backrooms-wiki.wikidot.com/level-37) | egglord |
| [Entity 3 - "Smilers"](https://backrooms-wiki.wikidot.com/entity-3) | Palico22, rewritten by Stretchsterz |
| [Entity 9 - "Facelings"](https://backrooms-wiki.wikidot.com/entity-9) | Original co authors: Jo and Higher Being Love Cereal!. Original collaborators: Backrooms explorers Reddit. Author of first rewrite: 1000dumplings. Author of current rewrite: Nikuchan |
| [Entity 10 - "Skin-Stealer"](https://backrooms-wiki.wikidot.com/entity-10) | Original author is AndromedaMapping1; Rewritten by 1000dumplings |
| [Entity 67 - "Partygoers =)"](https://backrooms-wiki.wikidot.com/entity-67) | Robert Goerman and MC_Crafter_24_7 |
| [Object 1 - "Almond Water"](https://backrooms-wiki.wikidot.com/object-1) | Natedagreat563 |
| [The M.E.G.](https://backrooms-wiki.wikidot.com/the-m-e-g) | Greggita Mahayfaio, Natedagreat563, Orb1t41, Poliacci, Positive123, Praetor3005, Robert Goerman, Reyday, Snomwriting and Squibblezombie |

- 空欄で参考にした JP Wiki の記事：「Level 2 N」（https://japan-backrooms-wiki.wikidot.com/level-2-n ）、「Level 444 N」（https://japan-backrooms-wiki.wikidot.com/level-444-n ）。場所の設定だけを借り、文章は使っていない（ライセンスの表記は未確認）。

### ノークリップで使った Backrooms Wiki の記事

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
| [Level 26 - "The SS Fun =)"](https://backrooms-wiki.wikidot.com/level-26)（Level Fun の本文） | Robert Goerman and MC_Crafter_24_7 |
| [Level 37 - "Sublimity"](https://backrooms-wiki.wikidot.com/level-37) | egglord |
| [Entity 3 - "Smilers"](https://backrooms-wiki.wikidot.com/entity-3) | Palico22, rewritten by Stretchsterz |
| [Entity 4 - "Deathmoths"](https://backrooms-wiki.wikidot.com/entity-4) | DrAkimoto |
| [Entity 8 - "Hound"](https://backrooms-wiki.wikidot.com/entity-8) | Palico 22, rewritten by 1000dumplings |
| [Entity 9 - "Facelings"](https://backrooms-wiki.wikidot.com/entity-9) | Original co authors: Jo and Higher Being Love Cereal!. Original collaborators: Backrooms explorers Reddit. Author of first rewrite: 1000dumplings. Author of current rewrite: Nikuchan |
| [Entity 10 - "Skin-Stealer"](https://backrooms-wiki.wikidot.com/entity-10) | Original author is AndromedaMapping1; Rewritten by 1000dumplings |
| [Entity 67 - "Partygoers =)"](https://backrooms-wiki.wikidot.com/entity-67) | Robert Goerman and MC_Crafter_24_7 |
| [Entity 110 - "Carnivorous Balloons"](https://backrooms-wiki.wikidot.com/entity-110) | Nukboi |
| [Object 1 - "Almond Water"](https://backrooms-wiki.wikidot.com/object-1) | Natedagreat563 |
| [The M.E.G.](https://backrooms-wiki.wikidot.com/the-m-e-g) | Greggita Mahayfaio, Natedagreat563, Orb1t41, Poliacci, Positive123, Praetor3005, Robert Goerman, Reyday, Snomwriting and Squibblezombie |

- 作者を確かめられなかったもの：[Entities](https://backrooms-wiki.wikidot.com/entities)（一覧ページ）、Entity 2 "The Windows" と Entity 15 "Wretches"（一覧・各レベルの記事・検索の要約から設定を借りた）、Level "Run For Your Life!"（読めた本文が「まだないページ」だった）。
- JP Wiki の「Level 433 N」（https://japan-backrooms-wiki.wikidot.com/level-433-n ）：場所の設定だけを借り、文章は使っていない（ライセンスの表記は未確認）。

### 野帳で使った Backrooms Wiki の記事

ノークリップの表にある記事のうち Level 0〜11、Entity 3・4・8・9・10・67・110、Object 1、The M.E.G. に加えて、次の記事。

| 記事 | 作者（各ページの「Cite this page as」の表記） |
|---|---|
| [The Manila Room](https://backrooms-wiki.wikidot.com/manila-room) | Br Miller & Neptunium |
| [Entity 15 - "Wretches"](https://backrooms-wiki.wikidot.com/entity-15) | Stretchsterz and etoisle |

- The Manila Room と Entity 15 は、この環境からページを直接開けず、作者名は検索結果の表記による。
- JP Wiki の「Level 433 N」（https://japan-backrooms-wiki.wikidot.com/level-433-n ）、「Level 444 N」（https://japan-backrooms-wiki.wikidot.com/level-444-n ）：場所の設定だけを借り、文章は使っていない（ライセンスの表記は未確認）。444 N の放送で鳴るのは短い五音音階のフレーズで、曲そのものではない。

### そのほかに参考にしたもの

- The Backrooms JP Wiki「Level 1 N」（https://japan-backrooms-wiki.wikidot.com/level-1-n ）：Level 11 の地下鉄の駅の様子だけを借りた。ライセンスの表記を確認できていないので、文章は使っていない。
- 日本語版ウィキペディア「リミナルスペース」「アナログホラー」：The Backrooms の始まり（2019年の投稿、2022年からの Kane Pixels の映像）を確かめるのに使った。
- 利用者が渡した zip（Backrooms-Database-Archives）にあった実体：ライセンスの表記がないので、名前も文章も使わず、「壁の引っかき傷の警告 → 止まって黙る」という仕掛けの発想だけを使った。
- Internet Archive にある Backrooms の記録映像：ビデオカメラの記録の見た目（`FX.vhs`）の参考にした。
- 演出の水準は、利用者が別の AI で作った派手版の「降下記録」に合わせた。派手版の物語の文章は使っていない。


## 確認したこと

- 起動画面：Playwright（Chromium、幅 390px）で開き、エラーが出ないこと、Service Worker が登録されること、オフラインでも開けること、Chrome がインストールできると判定すること（試験用の画面ではシークレット扱いになるので、その理由だけが出た）を確かめた。
- 降下記録：Playwright で、5つの結末すべてに命令だけでたどり着けること、Level 0〜11 を全部通ること、21種類の失敗が前ぶれのあとで起き、そのあとも遊び続けられること、ランダムな命令 36,000 回で例外が出ないこと、幅 360px でも ≡ が押せること、古い保存があっても壊れずにはじめからになることを確かめた。
- 空欄：Playwright で、5つの結末すべてに命令だけでたどり着けること、裏側と新しい部屋を通ること、13種類の失敗が前ぶれのあとで起き、翌朝から続けられること、ランダムな命令 72,000 回で例外が出ないこと、fx.js が読めなくても遊べること、古い保存（一つ前の版）から続きを遊べることを確かめた。
- ノークリップ：6つの結末すべてに命令だけでたどり着けること（道筋を変えて各結末 250〜300回）、18種類の失敗に前ぶれがあり続けて遊べること、ランダムな命令 75,000 回以上で例外が出ないこと、ゲーム本体（ENGINE）が画面やブラウザの機能に触らないこと、古い保存が壊れないことを確かめた。
- 野帳：17の結末と 433 N・444 N を通る道筋（20通り）に命令だけでたどり着けること、23種類の失敗に前ぶれがあり続けて遊べること、ランダムな命令 130,000 回で例外が出ないこと、時計版の切り出し（`yacho-watch/tools/build-engine.js`）がこの版でもエラーなく動くことを確かめた（時計版は今も `yacho/yacho.html` から作っている）。
- 音：環境音と効果音がエラーなく鳴り、音が割れないこと（ピークが 0.25 未満）をブラウザの中で測った。スピーカーでどう聞こえるかは確かめていない。
- **実機（Xperia 1 IV の Chrome）では、まだ確かめていない。** インストールできるか、Termux を止めたあとにホーム画面から開けるか、音・振動が出るかは、未確認。
