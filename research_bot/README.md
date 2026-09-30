# 抄録カタログ作成ツール(research_bot)

テーマ文から文献を集め、関連度を判定し、レポート生成用の抄録カタログと
レポート生成プロンプトを作る。NVIDIA の無料 API(build.nvidia.com)で動く。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `config.py` | **設定はすべてここ**。よく変える設定ほど上にある(冒頭に目次) |
| `research_bot.py` | 入口。収集〜カタログ出力〜事後チェックと、すべてのコマンド |
| `searchplan.py` | テーマ文 → ファセット → DB 別の検索式 |
| `sources.py` | 各 DB の検索・引用連鎖・撤回確認・OA の所在 |
| `judge.py` | 抄録を LLM に読ませる処理(1段目の粗選別・関連度判定・設計の抽出・別モデルでの再判定) |
| `fulltext.py` | 本文(Methods 章)での確認と、全文アクセス可否の一覧 |
| `catalog.py` | カタログ・索引・レポート生成プロンプトの書き出し、前回との差分、relink |
| `llm.py` | API 呼び出し(送信間隔・モデル名の事前確認・再試行・自動切り替え・JSON の回収) |

すべて同じフォルダに置いて実行する。

## 準備(初回だけ)

```bash
pip install openai requests tqdm pypdf
pip install pyyaml        # unwikilink を使うときだけ
mkdir -p ~/.config/research_bot
cat > ~/.config/research_bot/keys.env << 'EOF'
NVIDIA_API_KEY=nvapi-ここにキー
OPENALEX_API_KEY=ここにキー
ACADEMIC_CONTACT_EMAIL=メールアドレス
EOF
chmod 600 ~/.config/research_bot/keys.env
```

`.bashrc` の `export` でも動くが、`keys.env` に書いておけば、`.bashrc` を読まない
起動のしかた(ウィジェット等)でもキーが届く。既に環境変数があればそちらが優先される。
任意のキー: `NCBI_API_KEY`(PubMed)・`S2_API_KEY`(Semantic Scholar)・`CINII_APPID`(CiNii)。

最初にモデル名を確認しておく:

```bash
python research_bot.py models
```

✗ が付いたモデルは使えない。`config.py` の名前を直すか `--model` で別のものを指定する。

## 使い方

```bash
python research_bot.py                      # query.js のテーマで収集
python research_bot.py "テーマを文章で"      # テーマを直接指定
python research_bot.py --resume             # 中断したところから再開
python research_bot.py --model 2            # 判定モデルを差し替え(短い名前は下の表)

python research_bot.py themes               # テーマ一覧(チェック済みかどうか)
python research_bot.py check <テーマ>        # 事後チェック3種をまとめて
python research_bot.py ensemble <テーマ>     # 別モデルで再判定
python research_bot.py fulltext <テーマ> --fetch   # 全文の所在(A は XML も保存)
python research_bot.py diff <テーマ>         # 前回との差分
python research_bot.py relink <レポート> --apply   # 引用キーの検証
python research_bot.py unwikilink <パス> --apply   # フロントマターの[[リンク]]を文字列に

python research_bot.py models               # 使えるモデルの一覧
python research_bot.py probe                # モデルが今応答するか(1分ほど)
python research_bot.py bench                # 1段目の候補モデルを同じ問題で比べる
```

`<テーマ>` はフォルダ名・フォルダのパス・カタログのパスのどれでもよい。
`--apply` を付けないコマンドは、書き換えずに結果を表示するだけ。

収集が終わると事後チェック(アンサンブル判定・全文アクセス可否・差分)が
続けて自動で走る。止めたいときは `--no-check`。

### レポートの作り方

1. Claude か Gemini の新しい会話に `[catalog] テーマ.md` を添付する
2. あれば `_ensemble__テーマ.md` と `_fulltext__テーマ.md` も添付する
3. 最後に `[report_prompt] テーマ.md` の `---` 以降を貼る
4. できたレポートを保存し、`python research_bot.py relink <レポート> --apply` で引用キーを検証する

## 処理の流れ

1. ファセット抽出 → MeSH の照合 → 検索式
2. 各 DB を検索(精度重視 → 感度重視)
3. 引用連鎖
4. 1段目の粗選別 → 関連度判定 → 未判定の再判定 → 中心クラスタの調整
5. 研究設計・参加者・場面の抽出
6. 撤回の確認・OA の所在 → **本文(Methods 章)で設計を確かめ直す**
7. カタログ出力(レポート生成プロンプトも)
8. 事後チェック

途中で Ctrl-C を押すと、その時点までの結果を保存してから止まる。`--resume` で続きから。

## モデルの短い名前と自動切り替え

`--model` に渡せる短い名前は、有用な順に番号を振ってある。

| 番号 | モデル |
|---|---|
| 1 | nvidia/nemotron-3-super-120b-a12b |
| 2 | nvidia/nemotron-3.5-lightning-30b-a3b |
| 3 | z-ai/glm-5.3-flash |
| 4 | google/gemma-4-31b-it |
| 5 | openai/gpt-oss-20b |
| 6 | meta/muse-glimmer-30b |
| 7 | nvidia/nemotron-3-nano-omni-30b-a3b-reasoning |

判定の途中でモデルが応答しなくなると、`config.py` の切り替えの順番に従って
次のモデルへ自動で切り替え、残りを続ける。

- 関連度判定・抽出(`FALLBACK_ORDER`): 1 → 2 → 3 → 4 → 5 → 6 → 7(同じ系統を先に)
- 再判定(`ENSEMBLE_FALLBACK_ORDER`): 4 → 3 → 5 → 6 → 2 → 1 → 7(別系統を先に。1本目に使ったモデルは飛ばす)
- 空の `()` にすると切り替えない

切り替えが起きた回は、カタログ冒頭・各抄録・索引・レポート生成プロンプトに
どのモデルで判定したかが記録される。

## 出力(テーマのフォルダ内)

| ファイル | 中身 |
|---|---|
| `[catalog] テーマ.md` | 抄録カタログ本体(レポート生成に使う) |
| `[report_prompt] テーマ.md` | レポート生成の指示書 |
| `[index] テーマ.json` | 引用キー索引(判定モデル・判定メモも記録) |
| `[unjudged] テーマ.md` | 判定できなかった抄録と、その理由 |
| `[searchlog] テーマ.md` | 検索の記録 |
| `[excluded] テーマ.log` | 関連度不足で除外したもの |
| `[urls] テーマ.txt` | URL の一覧 |
| `_ensemble__テーマ.md` | 別モデルとの不一致・一致率・κ係数 |
| `_fulltext__テーマ.md` | core 文献の全文アクセス可否(A/B/C) |
| `_diff__テーマ.md` | 前回カタログとの差分 |

1段目の除外ログは `~/.local/share/research_prefilter/`、差分用の前回の記録は
`~/.local/share/research_snapshots/` に置かれる(Vault の外)。

## 主な設定(config.py)

| 項目 | 既定 | 意味 |
|---|---|---|
| `CATALOG_ROOT` | …/Vault/Abstract/catalog | カタログの保存先 |
| `FILTER_MODEL` | nemotron-3-super-120b-a12b | 関連度判定・抽出のモデル |
| `ENSEMBLE_MODEL` | gemma-4-31b-it | 再判定のモデル(判定モデルとは別系統にする) |
| `PREFILTER_MODE` | dryrun | 1段目の粗選別。on で除外、off で使わない |
| `FALLBACK_ORDER` | 1〜7 | 応答しなくなったときの切り替えの順番 |
| `RELEVANCE_THRESHOLD` | 70 | これ未満は除外 |
| `CORE_SCORE` | 90 | core とする関連度 |
| `MIN_ABSTRACT_LENGTH` | 400(日本語 150) | 抄録の下限 |
| `REQUESTS_PER_MINUTE` | 35 | 1分あたりの送信上限。429 が続けば下げる |
| `TEMPERATURE` | 0.0 | 判定の揺れを抑える |

同じ名前の環境変数で一時的に変えられる(モデル名を除く)。

```bash
PREFILTER_MODE=on python research_bot.py
FILTER_BATCH_SIZE=4 python research_bot.py --resume
```

## 更新のしかた

送られてきた zip を Download に置いて:

```bash
bash ~/update_research_bot.sh
```

## 旧版からの変更(2026年9月)

- 14ファイルを8ファイルに統合した。`extract.py`・`jsonparse.py`・`prefilter.py`・
  `ensemble_check.py`・`fulltext_check.py`・`catalog_diff.py`・`generate_report.py` は無い
- 単独で動かしていた再判定・全文・差分は `research_bot.py` のサブコマンドになった。
  `.bashrc` に旧ファイルを呼ぶ `check()` 関数が残っていれば、
  `python ~/research_bot/research_bot.py check "$1"` に置き換える
- OpenRouter への切り替えは廃止した(NVIDIA のみ)
