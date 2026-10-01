# Claude オススメのコネクタとスキル(使い方ガイド)

スマホ(Xperia 1 IV)+ Termux + Obsidian で、臨床・研究・ミニアプリ開発をする前提で、
使って効果の大きいコネクタとスキルをまとめたもの。

- **コネクタ** … Claude が外部サービス(PubMed、GitHub など)を直接読み書きできるようにする接続。
  claude.ai の「設定 → コネクタ」で有効にする。
- **スキル** … 特定の作業のやり方を Claude に覚えさせた手順書。
  依頼文に合うと自動で使われる。Claude Code では `/スキル名` で明示的に呼べる。

> ⚠️ **個人情報の扱い**
> 施設利用者の氏名・記録・ケース情報は、どのコネクタにも渡さない。
> 事例を相談するときは、匿名化・一般化してから貼る。

---

## 1. オススメのコネクタ

### ★★★ PubMed(文献検索)

医学・心理学の論文を検索し、抄録やメタデータ、オープンアクセスなら本文まで読める。

**使い方の例**
```
強度行動障害の成人に対する PBS(ポジティブ行動支援)の効果研究を、
直近10年で PubMed から探して、研究デザイン別に表にして。
```
```
PMID 12345678 の論文の方法と結果を要約して。関連論文も3本出して。
```

**コツ**
- 「直近◯年」「RCT のみ」「レビュー論文」など条件を書くと絞り込みが正確になる。
- 気になった論文は「関連論文を探して」で芋づる式に広げられる。

### ★★★ Scite(引用の裏取り)

論文が他の論文から「支持」「反論」「言及」されているかを見られる。
**根拠を確かめる・存在しない引用を防ぐ**のに強い。

**使い方の例**
```
「応用行動分析は強度行動障害の自傷を減らす」という主張を、
Scite で支持・反論の両方の文献から検証して。APA 形式で参考文献をつけて。
```
```
この DOI の論文は撤回や訂正が出ていない?その後どう引用されてる?
```

**コツ**
- PubMed で見つけて → Scite で評価、の2段構えがおすすめ。
- 文献リストは Scite の書誌整形機能で作らせると書誌情報が正確。

### ★★★ GitHub(このリポジトリ管理)

`othermarrow/Claude` のコードを読み書きし、ブランチ・PR を作れる。
PC がなくても、スマホの Claude アプリから開発を進められる。

**使い方の例**
```
othermarrow/Claude に zepp_timer というフォルダを作って、
Amazfit Balance 2 用のタイマーミニアプリの雛形を置いて PR にして。
```
```
research_bot の README を読んで、使い方を短くまとめて。
```

**コツ**
- 「プロジェクトごとにフォルダを作る」とリポジトリ直下の `CLAUDE.md` に書いておくと、毎回言わなくて済む(→ 3章 C)。
- PR を作った後「この PR を見張って」と頼むと、CI 失敗やレビューに自動で対応してくれる。

### ★★ Claude Docs(共有ドキュメント)

Claude が直接書き込み・更新できるドキュメント。Word / PDF / Markdown に書き出せる。

**使い方の例**
```
支援会議用に「行動観察記録の取り方」の研修資料を Doc で作って。
```
```
この Doc を Markdown で書き出して(→ Obsidian に取り込む)。
```

**コツ**
- Markdown で書き出せば、そのまま Obsidian Vault(`/storage/emulated/0/Vault`)に置ける。

### ★ その他(必要に応じて)

| コネクタ | 向いている用途 |
|---|---|
| Google Drive / Gmail / カレンダー | 予定の確認、資料の検索。「朝のブリーフィング」(morning スキル)と組み合わせると便利 |
| Anthropic Economic Index | AI の利用動向の統計。研修や講演のネタ探しに |

---

## 2. オススメのスキル

### claude.ai / Claude アプリで使うスキル

| スキル | 何ができるか | 依頼文の例 |
|---|---|---|
| **deep-research** | 複数の情報源を調べて、長めの調査レポートにまとめる | 「強度行動障害の支援に関する国内外のガイドラインを比較調査して」 |
| **pdf** | PDF の読み取り・結合・分割・OCR・作成 | 「この論文 PDF の表を抜き出して」 |
| **xlsx** | Excel / CSV の整理・集計・グラフ | 「この行動記録 CSV を時間帯別に集計してグラフにして」 |
| **docx** | Word ファイルの作成・編集 | 「提出用に Word 形式で報告書を作って」 |
| **pptx** | PowerPoint の作成 | 「研修用スライドを .pptx で10枚」 |
| **docs** | 共有・編集できるドキュメント | 「マニュアルを Doc で作って」 |
| **dataviz** | 見やすいグラフ・ダッシュボード | 「ABC 記録の推移をグラフにして」 |
| **skill-creator** | 自分専用のスキルを作る | 「Termux 用のコードを cat EOF で書くスキルを作って」 |
| **morning** | 予定やメールから朝のまとめを作る | 「朝のブリーフィングを毎朝作るようにして」 |

### Claude Code(このリポジトリでの開発)で使うスキル

| スキル | 何ができるか | 使い方 |
|---|---|---|
| **/init** | リポジトリを読んで `CLAUDE.md` を作る | 最初に1回実行 |
| **/code-review** | 変更内容のバグを探す | PR を出す前に `/code-review` |
| **/simplify** | コードを読みやすく整理 | 動いたあとに `/simplify` |
| **/security-review** | セキュリティ上の問題を点検 | API キーを扱うコードのあとに |
| **/loop** | 定期的に同じ作業を繰り返す | `/loop 30m CI の状況を確認して` |
| **/session-start-hook** | クラウド環境の起動時に依存関係を自動で入れる | Python ツールのテストを毎回動かしたいとき |

---

## 3. 組み合わせ技(おすすめワークフロー)

### A. 文献レビュー → Obsidian

1. **PubMed** で検索
2. **Scite** で支持・反論と撤回の有無を確認
3. **docs** で文献まとめを作成 → Markdown で書き出して Download に保存
4. Termux で Vault に移動(初回だけ `termux-setup-storage` でストレージ権限を許可)

```bash
cat << 'EOF' > ~/move_note.sh
#!/data/data/com.termux/files/usr/bin/bash
# Download に落とした Markdown を Obsidian Vault の文献フォルダへ移動
SRC=/storage/emulated/0/Download
DST=/storage/emulated/0/Vault/文献
mkdir -p "$DST"
mv "$SRC"/*.md "$DST"/ && echo "移動しました: $DST"
EOF
chmod +x ~/move_note.sh
```

実行: `~/move_note.sh`

※ 大量の文献を集めるときは、このリポジトリの [`research_bot`](../research_bot/) も併用できる。

### B. Amazfit Balance 2 のミニアプリ開発

1. Claude アプリで「`othermarrow/Claude` に `◯◯` フォルダを作ってミニアプリを書いて」と依頼(**GitHub**)
2. PR をマージしたら、Termux で取得してプレビュー:

```bash
cat << 'EOF' > ~/zepp_pull.sh
#!/data/data/com.termux/files/usr/bin/bash
# 使い方: ~/zepp_pull.sh フォルダ名
if [ ! -d ~/Claude ]; then
  git clone https://github.com/othermarrow/Claude.git ~/Claude
fi
cd ~/Claude && git pull
cd "$1" && zeus preview
EOF
chmod +x ~/zepp_pull.sh
```

実行: `~/zepp_pull.sh zepp_timer`

3. 動作を見て修正を依頼 → `/code-review` で点検 → マージ → 2 に戻る。

### C. 自分の前提を毎回伝えなくて済むようにする

リポジトリ直下に `CLAUDE.md` を置くと、Claude Code が毎回読み込む。例:

```bash
cat << 'EOF' > ~/Claude/CLAUDE.md
# このリポジトリのルール
- プロジェクトごとにフォルダを作り、各フォルダに README.md を置く
- 説明・コメントは日本語
- Termux で実行するコードは cat << 'EOF' 形式で示す
- Amazfit Balance 2(Zepp OS)向けアプリは zeus preview で確認する
EOF
```

作ったら `git add CLAUDE.md && git commit -m "CLAUDE.md 追加" && git push` で反映。

さらに **skill-creator** で「Zepp OS ミニアプリ作成スキル」などを作っておくと、
API の書き方や注意点を毎回説明しなくてよくなる。

---

## 4. 困ったとき

| 症状 | 対処 |
|---|---|
| コネクタが使われない | 依頼文にサービス名を入れる(「PubMed で」「Scite で」) |
| スキルが使われない | スキル名か用途をはっきり書く(「PDF スキルで」「.xlsx で」) |
| 引用が怪しい | 「Scite で実在と撤回の有無を確認して」と追加で頼む |
| Gemini と使い分けたい | 文献の裏取り・GitHub 連携は Claude、Google 系サービス中心の作業は Gemini、が目安 |
