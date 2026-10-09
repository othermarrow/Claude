# 脳内バックルーム(brain-zork)

あなたのものの考え方を、どこまでも続く黄色い部屋(Backrooms)として描いたテキストアドベンチャー。
見た目と操作は Zork 日本語版(`zork-ja/` のブラウザ版)と同じで、「命令を作る」と十字キーで遊べる。

## 素材

- Vault(othermarrow/Psychology)の `Abstract/report/` にある文献レポートの見出し
  (見通し支援、機能アセスメント、インフォーマルなアセスメント、愛着支援、キーパーソン支援、
  24時間以上続く多動の医学的評価 など)と、各レポートに共通する「一致点と対立点」「エビデンスの限界」
  「今後の展望」という構成。
- Claude との会話で分かったこと(Xperia・Termux など)。
- 施設の利用者さんに関わることは入れていない。

## 階層

| 階層 | 場所 | 元になった考え |
|---|---|---|
| Level 0 | 概観の黄色い部屋 | どのレポートにもある見出しの並び |
| Level 1 | 見通しの倉庫 | 見通し支援(置くだけでは働かない) |
| Level 2 | 機能の配管 | 機能アセスメント(自動強化、機能は固定した属性ではない) |
| Level 3 | 代理報告の電話室 | インフォーマルなアセスメント(誰の報告を信じるか) |
| Level 4 | 待合室(安全地帯) | 愛着支援・キーパーソン支援(安全基地) |
| Level 5 | 除外診断の病棟 | 医学的評価(既存の診断が原因探索を止める) |
| 出口 | 「今後の展望」の扉 | 各レポートの「今後の展望」 |

五つの断片(スケジュールカード・機能の札・観察ノート・あたたかい鍵・身体のカルテ)を扉に入れると脱出できる。
「正気度」が 0 になっても死にはせず、待合室(まだ行っていなければ黄色い部屋)で目を覚ます。

## 遊び方

- claude.ai のページ: https://claude.ai/artifact/N77A16nBGL5Dt17AxDcwWz(本人だけが開ける。Chrome の「ホーム画面に追加」でアプリのように起動できる)
- Tasker のシーンで遊ぶときは `brain-zork-standalone.html` を Webビューで開く。
  手順は `zork-ja/README.md` の「Tasker のシーンで遊ぶ」と同じで、置き場所だけ変える。

```bash
mkdir -p /storage/emulated/0/Tasker/brain-zork
cp /storage/emulated/0/Download/brain-zork-standalone.html /storage/emulated/0/Tasker/brain-zork/brain-zork.html
```

Webビューの「電話へのアクセスを許可」をオンにすると、途中の状態が
`Tasker/brain-zork/brain-zork-data.json` に残る(Tasker の変数 `%BRAINZORK` も使う)。

## ファイル

| ファイル | 役割 |
|---|---|
| `brain-zork.html` | ゲーム本体(claude.ai に公開する形) |
| `build.py` | `brain-zork-standalone.html`(Tasker やブラウザで直接開く形)を作る |
| `brain-zork-standalone.html` | Tasker のシーン用 |

## 確認できていること・いないこと

- 開発環境の Chromium(スマホの画面サイズ)で、最初から脱出まで通しで遊べた。
  「命令を作る」・日本語の命令・英語の命令・続きから再開が動いた。
- Tasker の実機と claude.ai の中では、まだ確かめていない。
