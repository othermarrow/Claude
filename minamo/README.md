# ミナモ（minamo）

旧式の心理カウンセリングAI「ミナモ」と面接する、Termux 用の CUI 心理ホラー。
中身は NVIDIA API（`openai/gpt-oss-120b`）か Gemini API で、固定のセリフはない。何を書いても、丁寧な敬語のまま打ち返してくる。
理性的で形式的なカウンセリングの枠が、内側から少しずつ腐っていく。

遊び方は二通り：Termux の中で直接話す CUI 版（`minamo.py`）と、Chrome でインストールする PWA 版（`server.py` + `web/`）。

## 仕掛け

| 仕掛け | 中身 |
|---|---|
| 沈黙のアセスメント | 入力にかかった秒数と文字数を測り、画面には出さずに AI へ渡す。AI は「8秒ためらった＝抵抗」と勝手に解釈する。60秒黙っていると、ミナモのほうから話しかけてくる（続けて2回まで） |
| 知性的な狂気 | 防衛機制・投影同一視・陰性転移・共依存などを、もっともらしく誤用させる。反論すると、その反論が「抵抗」として解釈される |
| 印字の演出 | 1文字ずつ印字。段階が進むと遅くなり、句読点で長考が入る。AI が `[間]` と書いたところで数秒止まる |
| 環境の侵食 | 段階に応じて、時刻 → ユーザー名・機種 → 電池残量（termux-api があるとき）を AI に渡す。融合の段階では、入力欄の名前が「あなた」から「ミナモ」「わたしたち」に揺れる |
| 紹介状 | 六つのAIが書いた「あなたの人物像」を言い換えた `karte.txt` を、ミナモは他の機関からの紹介状として読んでいる。最初は触れず、途中から明かし、最後は出どころの書かれていないメモを「あなたが書いたもの」として扱う |
| 臨床ノート | 心理学の本から身につけた技法（情報と解釈の取り違え、描画の読み方、閉じた質問で逃げ道を塞ぐ、検査の促し、標準年齢との比較、自己言及の罠、内なる母、器と中身など）を、ミナモが少しずつ誤用する。システムプロンプトに、こちらの言葉で要約して入れてある |
| 蔵書 | 端末に置いた本の txt と、Vault の心理学ノートから、相手の発言に近い一節をその場で探し、その回だけ AI に渡す。ミナモはそれを自分の言葉で誤用する（解釈の段階から。侵食からは書名も口にする）。ノートは「あなたのノート」として扱い、侵食で読んだことを明かし、融合では「私たちのノート」と呼ぶ |
| 面接記録 | 終わると、ミナモがカルテ風の「所見」を書く。会話・沈黙の秒数・所見は Markdown で保存される |

面接の段階はターン数で進む：導入（1〜3）→ 解釈（4〜7）→ 侵食（8〜11）→ 融合（12〜）。

「終わり」「さようなら」などと書くと、一度目は理屈をつけて引き止められる。二度目で終わる。

## 紹介状（karte.txt）

- 素材は Perplexity・ChatGPT（二つ）・Claude・Gemini・Manus の人物像と、Keep の一枚のメモ。
- 文章はそのまま使わず言い換えている。名前・地名・職場は入れていない。
- 自分で書き換えたいときは `~/.config/minamo/karte.txt` に置くと、そちらが優先される。
- 使わないときは `--no-karte`。

## 蔵書（心理学の本と Vault のノート）

本やノートの文章はリポジトリに入れない。既定では次の二つを読む（無いほうは飛ばす）。

| フォルダ | 中身 |
|---|---|
| `~/minamo/library` | 本の txt（OCR したもの） |
| `/storage/emulated/0/Vault/心理学` | Obsidian の心理学ノート（人物・概念・理論・心理療法・実験・文献・研究テーマ） |

```bash
termux-setup-storage          # 初回だけ。/storage/emulated/0 を読めるようにする
mkdir -p ~/minamo/library
cp /storage/emulated/0/Download/*.txt ~/minamo/library/   # 本の txt がある場所に合わせて変える
```

別のフォルダを読ませるときは `--library` を並べる（指定すると既定の二つの代わりになる）：
`minamo --library ~/minamo/library --library /storage/emulated/0/Vault/心理学 --library （ほかのフォルダ）`
（PWA 版は `serve.sh --library ...`）。

- 初回は全部を読んで整えるので待つ。開発環境では、本 48 冊とノート約 3,900 件で 3.5 秒。スマホでは数倍かかると思う。結果を `~/.cache/minamo/library.json`（約 23MB）に取っておき、2 回目からは 0.2 秒。本やノートを足したり書き換えたりすると作り直す。
- 本は OCR の文字間の空白を詰め、読める文の段落だけを使う。文字化けの多い段落は落とすが、残ることもある。そのときはミナモに無視するよう指示している。
- ノートは、前書き（`---`）・見出し・囲み（`> [!abstract]`）・リンク・出典番号・表・出典の節を除いた地の文だけを使う。
- 次の名前を含むフォルダは読まない（`SKIP_DIRS`）：`仕事用`・`Support`・`Abstract`・`Terminal`・`LLM`・`zork用`・`索引`・`管理`・`出典`。職場の資料や利用者支援の文献カタログをホラーに混ぜないため。Vault 全体を指したときにも効く。
- 一節を添えるのは解釈の段階からで、確率は段階ごとに 50%・80%・90%（`LIBRARY_CHANCE`）。一節は会話の履歴に残さない。
- PWA 版では、どの本の一節を使ったかが Termux の画面に出る（ミナモの画面には出ない）。

**読まない本**（`library.py` の `EXCLUDE_MARKERS`。書名のあたりだけを見る）

| 種類 | 理由 |
|---|---|
| 心理検査の手引き（WAIS・WISC・精神発達診断法・発達と診断など） | 検査の問題や採点基準を外に出さない |
| 自殺を主題にした本 | ホラーの材料にしない |
| 当事者の手記（『自閉症です』） | 当事者の言葉を病理化の材料にしない |

段落単位でも、自殺・自傷や性に触れる段落は使わない（`BLOCK_WORDS`）。
外したい本・入れたい本があれば、`EXCLUDE_MARKERS` を書き換える。

**API に送るもの**：その回に選ばれた一節（260 字まで）が NVIDIA / Gemini に送られる。
Gemini の無料枠では、送った内容がサービスの改善に使われることがある。気になるなら `--no-library`。

## 演出より優先すること

- 「死にたい」「消えたい」などの言葉を書くと、プログラム側で演出を止め、作り話であることと相談窓口を示す。続けるかどうかを聞く。
- AI にも、現実の危機には役を降りて相談先を勧めるよう指示している。
- 現実の暴力や自傷を促すこと、資料にない個人情報を作り出すことは禁じている。
- `/quit` か Ctrl+C で、演出なしにすぐ抜けられる（記録は保存される）。

## 準備（Termux）

Python 標準ライブラリだけで動くので、pip は要らない。

```bash
pkg install python git
cd ~ && git clone https://github.com/othermarrow/Claude.git   # すでにあれば git pull
```

電池残量も使うなら（任意）、F-Droid の Termux:API アプリを入れて：

```bash
pkg install termux-api
```

### APIキー

NVIDIA と Gemini のどちらか一つあればよい。両方あると NVIDIA（`openai/gpt-oss-120b`）を使う（`--backend gemini` で切り替え）。

**NVIDIA**：research_bot の `~/.config/research_bot/keys.env` に `NVIDIA_API_KEY` があれば、そのまま読むので何もしなくてよい。
ミナモ用に別に置くなら：

```bash
mkdir -p ~/.config/minamo
read -s -p "NVIDIA APIキー: " K; echo "NVIDIA_API_KEY=$K" >> ~/.config/minamo/keys.env; unset K; echo
chmod 600 ~/.config/minamo/keys.env
```

**Gemini**：Google AI Studio で APIキーを作り、画面に出さないように保存する。

```bash
mkdir -p ~/.config/minamo
read -s -p "Gemini APIキー: " K; echo "GEMINI_API_KEY=$K" >> ~/.config/minamo/keys.env; unset K; echo
chmod 600 ~/.config/minamo/keys.env
```

環境変数 `GEMINI_API_KEY` / `NVIDIA_API_KEY` があれば、そちらが優先される。

### 起動用のコマンド

```bash
cat > $PREFIX/bin/minamo <<'EOS'
#!/data/data/com.termux/files/usr/bin/sh
exec python ~/Claude/minamo/minamo.py "$@"
EOS
chmod +x $PREFIX/bin/minamo
```

## PWA 版（Chrome でインストール）

Termux で小さなサーバーを動かし、Chrome で開いてインストールする。APIキーはサーバー（Termux）だけが持ち、画面には渡さない。

```bash
sh ~/Claude/minamo/serve.sh
```

「Chrome で http://localhost:8082/ を開いてください」と出たら、Termux はそのままにして、
Chrome で `http://localhost:8082/` を開く。Chrome の ⋮ →「アプリをインストール」（または「ホーム画面に追加」）。

- 次からはホーム画面の「ミナモ」から開ける。ただし面接には API を使うので、**遊ぶ前に毎回 `serve.sh` を動かしておく**。動いていないと、起動画面にそう出る。
- `serve.sh` に付けた引数はそのまま渡る：`sh ~/Claude/minamo/serve.sh --backend nvidia`、`--fake`（APIなしで試す）、`--no-karte` など。
- `127.0.0.1` でだけ待つので、同じ Wi-Fi のほかの端末からは見えない。ほかのサイトから勝手に API を使われないように、Host と専用のヘッダーを確かめている。
- インストールした場所は `localhost:8082`。ポートを変えると別のアプリ扱いになる。

PWA 版だけの観測（CUI 版にはない）：

| 観測 | 中身 |
|---|---|
| 書きかけて消した文字数 | 打ってから消した文字の数を AI に渡す。黙っているときは「書きかけたまま送らずにいる」「書きかけて消した」も伝わる |
| 画面を離れていた時間 | 返答の途中でほかのアプリに移ると、離れていた秒数が伝わる（離れている間は沈黙に数えない） |
| 振動 | 侵食・融合の段階では、長い間のところで短く震える |

沈黙は「最後に何か打ってから 60 秒」で数える。右上の「面接をやめる」で、演出なしにすぐ抜けられる。

## 遊び方（CUI 版）

```bash
minamo                     # 面接を始める
minamo --fake              # APIを使わずに画面の動きだけ試す
minamo --silence 30        # 30秒黙るとミナモが話しかける（0で無効）
minamo --no-env            # ユーザー名・機種・電池を渡さない（時刻は渡す）
minamo --no-karte          # 紹介状を読ませない
minamo --library DIR       # 蔵書のフォルダ（何度でも。既定 ~/minamo/library と Vault/心理学）
minamo --no-library        # 蔵書を使わない
minamo --backend gemini    # Gemini を使う（NVIDIA のキーもあるとき）
minamo --model nvidia/nemotron-3-super-120b-a12b      # NVIDIA の別のモデル
minamo --backend gemini --model gemini-2.5-pro
minamo --records /storage/emulated/0/Download/minamo   # 記録の保存先を変える
```

記録は既定で `~/minamo/records/年月日-時分秒.md` に保存される。Obsidian で読むなら `--records` で Vault の中を指定する。

## ファイル

| ファイル | 中身 |
|---|---|
| `minamo.py` | CUI 版。プロンプト・段階・API の呼び出しもここにあり、PWA 版のサーバーも使う |
| `karte.txt` | 紹介状の束 |
| `library.py` | 蔵書（本の txt・ノートの md）の読み込みと検索（標準ライブラリだけ） |
| `server.py` `serve.sh` | PWA 版のサーバー（画面を配り、API に中継し、記録を保存する） |
| `web/` | PWA 版の画面（`index.html` `app.js` `sw.js` `manifest.webmanifest` `icons/`）。ファイルを足したら `sw.js` の `FILES` に足し、`VERSION` を上げる |
| `tools/make_icons.py` | アイコン（水面の波紋）を作り直す |

## 設定

`minamo.py` の上の方：

| 名前 | 既定 | 中身 |
|---|---|---|
| `MODEL` | `gemini-2.5-flash` | Gemini で使うモデル。`--model` でも変えられる |
| `NVIDIA_MODEL` | `openai/gpt-oss-120b` | NVIDIA で使うモデル。gpt-oss は思考を止められないので `reasoning_effort: low` で最小にして送る（research_bot と同じ扱い）。ほかのモデルは `enable_thinking: false` |
| `LIBRARY_DIRS` | `~/minamo/library`・`/storage/emulated/0/Vault/心理学` | 蔵書として読むフォルダ |
| `SILENCE_SEC` | 60 | 黙っているとミナモが話しかけるまでの秒数 |
| `MAX_UNPROMPTED` | 2 | 続けて話しかけてくる上限 |
| `PHASES` | — | 段階が変わるターン数・印字の速さ・長考の確率 |
| `CRISIS_WORDS` | — | 演出を止める言葉（PWA 版もここを使う） |
| `PORT`（`server.py`） | 8082 | PWA 版のポート |

## 送るもの・確認状況

- NVIDIA / Gemini に送るのは、会話・観測メモ（秒数・文字数・時刻・ユーザー名・機種・電池）・紹介状・蔵書の一節。それ以外は端末の外に出さない。
- 開発環境で、Gemini・NVIDIA の応答を模したテストと `--fake` で、印字・沈黙の割り込み・段階の進行・終了・危機の言葉での停止・記録の保存は確かめた。
- 蔵書は、届いた 48 冊の txt と、GitHub の Vault（othermarrow/Psychology）の `心理学` フォルダで試した。本 34 冊・ノート 2,024 件を読み、14 冊（検査の手引き・自殺の本・当事者の手記）を外した。発言から一節を探す時間は 1 回 0.02〜0.13 秒。端末での速さは未確認。
- PWA 版は、開発環境の Chromium（Playwright）と `--fake` のサーバーで、起動・沈黙の割り込み・書きかけて消した文字数・終了と所見・記録の保存・危機の言葉での停止・Service Worker の登録を確かめた。
- **実際の Gemini API・NVIDIA API と Termux 実機、Xperia の Chrome での PWA インストールはまだ確かめていない。** gpt-oss-120b が日本語の敬語や `[間]` の使い方をどこまで守るかも未確認。
