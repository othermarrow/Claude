# ミナモ（minamo）

旧式の心理カウンセリングAI「ミナモ」と面接する、Termux 用の CUI 心理ホラー。
中身は Gemini API で、固定のセリフはない。何を書いても、丁寧な敬語のまま打ち返してくる。
理性的で形式的なカウンセリングの枠が、内側から少しずつ腐っていく。

## 仕掛け

| 仕掛け | 中身 |
|---|---|
| 沈黙のアセスメント | 入力にかかった秒数と文字数を測り、画面には出さずに AI へ渡す。AI は「8秒ためらった＝抵抗」と勝手に解釈する。60秒黙っていると、ミナモのほうから話しかけてくる（続けて2回まで） |
| 知性的な狂気 | 防衛機制・投影同一視・陰性転移・共依存などを、もっともらしく誤用させる。反論すると、その反論が「抵抗」として解釈される |
| 印字の演出 | 1文字ずつ印字。段階が進むと遅くなり、句読点で長考が入る。AI が `[間]` と書いたところで数秒止まる |
| 環境の侵食 | 段階に応じて、時刻 → ユーザー名・機種 → 電池残量（termux-api があるとき）を AI に渡す。融合の段階では、入力欄の名前が「あなた」から「ミナモ」「わたしたち」に揺れる |
| 紹介状 | 六つのAIが書いた「あなたの人物像」を言い換えた `karte.txt` を、ミナモは他の機関からの紹介状として読んでいる。最初は触れず、途中から明かし、最後は出どころの書かれていないメモを「あなたが書いたもの」として扱う |
| 面接記録 | 終わると、ミナモがカルテ風の「所見」を書く。会話・沈黙の秒数・所見は Markdown で保存される |

面接の段階はターン数で進む：導入（1〜3）→ 解釈（4〜7）→ 侵食（8〜11）→ 融合（12〜）。

「終わり」「さようなら」などと書くと、一度目は理屈をつけて引き止められる。二度目で終わる。

## 紹介状（karte.txt）

- 素材は Perplexity・ChatGPT（二つ）・Claude・Gemini・Manus の人物像と、Keep の一枚のメモ。
- 文章はそのまま使わず言い換えている。名前・地名・職場は入れていない。
- 自分で書き換えたいときは `~/.config/minamo/karte.txt` に置くと、そちらが優先される。
- 使わないときは `--no-karte`。

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

Google AI Studio で Gemini の APIキーを作り、画面に出さないように保存する。

```bash
mkdir -p ~/.config/minamo
read -s -p "Gemini APIキー: " K; echo "GEMINI_API_KEY=$K" > ~/.config/minamo/keys.env; unset K; echo
chmod 600 ~/.config/minamo/keys.env
```

環境変数 `GEMINI_API_KEY` があれば、そちらが優先される。

### 起動用のコマンド

```bash
cat > $PREFIX/bin/minamo <<'EOS'
#!/data/data/com.termux/files/usr/bin/sh
exec python ~/Claude/minamo/minamo.py "$@"
EOS
chmod +x $PREFIX/bin/minamo
```

## 遊び方

```bash
minamo                     # 面接を始める
minamo --fake              # APIを使わずに画面の動きだけ試す
minamo --silence 30        # 30秒黙るとミナモが話しかける（0で無効）
minamo --no-env            # ユーザー名・機種・電池を渡さない（時刻は渡す）
minamo --no-karte          # 紹介状を読ませない
minamo --model gemini-2.5-pro
minamo --records /storage/emulated/0/Download/minamo   # 記録の保存先を変える
```

記録は既定で `~/minamo/records/年月日-時分秒.md` に保存される。Obsidian で読むなら `--records` で Vault の中を指定する。

## 設定

`minamo.py` の上の方：

| 名前 | 既定 | 中身 |
|---|---|---|
| `MODEL` | `gemini-2.5-flash` | 使うモデル。`--model` でも変えられる |
| `SILENCE_SEC` | 60 | 黙っているとミナモが話しかけるまでの秒数 |
| `MAX_UNPROMPTED` | 2 | 続けて話しかけてくる上限 |
| `PHASES` | — | 段階が変わるターン数・印字の速さ・長考の確率 |
| `CRISIS_WORDS` | — | 演出を止める言葉 |

## 送るもの・確認状況

- Gemini に送るのは、会話・観測メモ（秒数・文字数・時刻・ユーザー名・機種・電池）・紹介状。それ以外は端末の外に出さない。
- 開発環境で、Gemini の応答を模したテストと `--fake` で、印字・沈黙の割り込み・段階の進行・終了・危機の言葉での停止・記録の保存は確かめた。
- **実際の Gemini API と Termux 実機ではまだ確かめていない。**
