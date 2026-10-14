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
python research_bot.py --reuse-plan         # 前回と同じ検索計画で収集(差分を見たいとき)

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
python research_bot.py plan "テーマ" --model 6      # 検索計画だけ作る(計画のモデルの比較用。検索・判定はしない。--queries で検索式も)
                                                  # 作った計画は残り、同じテーマ文の次の収集はその計画で検索する(作り直すなら --replan)
```

`<テーマ>` はフォルダ名・フォルダのパス・カタログのパスのどれでもよい。
`--apply` を付けないコマンドは、書き換えずに結果を表示するだけ。

収集が終わると事後チェック(アンサンブル判定・全文アクセス可否・差分)が
続けて自動で走る。止めたいときは `--no-check`。

### 同じテーマを取り直すとき

検索計画(ファセット・検索式・テーマの定義)は、毎回 AI が作り直す。同じ
テーマ文でもファセットが変わることがあり、そのときの差分は「新しく出た
文献」ではなく「検索の仕方の違い」になる(実測: 2回目に「入所施設・日本」の
ファセットが AND で加わり、前回の文献の7割が入れ替わった)。

新しく出た文献だけを見たいときは `--reuse-plan` を付ける。前回の収集の
索引に残した検索計画をそのまま使う。いつもそうしたいなら `config.py` の
`REUSE_SEARCH_PLAN = True`(1回だけ作り直すなら `--replan`)。検索計画を
索引に残すようにした版より前の収集からは使えない。

前回ではなく特定の回の計画を使うときは、フォルダ名を続ける。

```bash
python research_bot.py --reuse-plan 重度知的障害者に対する1週間のスケジュール提示支援_1
```

テーマ文は2行目以降も AI に渡る(フォルダ名に使うのは1行目だけ)。集めたい
範囲を2行目に書き足すと、検索語とテーマの定義に反映されやすい。

### レポートの作り方

1. Claude か Gemini の新しい会話に `[catalog] テーマ.md` を添付する
2. あれば `_ensemble__テーマ.md` と `_fulltext__テーマ.md` も添付する
3. 最後に `[report_prompt] テーマ.md` の `---` 以降を貼る
4. できたレポートを保存し、`python research_bot.py relink <レポート> --apply` で引用キーを検証する

## 処理の流れ

1. ファセット抽出 → MeSH の照合 → 検索式
2. 各 DB を検索(精度重視 → 感度重視)
3. 引用連鎖
4. 1段目の粗選別 → 関連度判定 → 未判定の再判定 → 除外の中間帯の再確認 → 採用分(1本目が判定できたもの)を別系統の2つのモデルでも判定 → 3つの点数の中央値で中心クラスタを決める
5. 研究設計・参加者・場面の抽出
6. 撤回の確認・OA の所在 → **本文(Methods 章)で設計を確かめ直す**
7. カタログ出力(レポート生成プロンプトも)
8. 事後チェック

途中で Ctrl-C を押すと、その時点までの結果を保存してから止まる。`--resume` で続きから。

## モデルの短い名前と自動切り替え

`--model` に渡せる短い名前は、有用な順に番号を振ってある。

| 番号 | モデル |
|---|---|
| 1 | nvidia/nemotron-3-ultra-550b-a55b(2026-10-03 まで super。super は提供終了) |
| 2 | nvidia/nemotron-3.5-lightning-30b-a3b |
| 3 | openai/gpt-oss-20b |
| 4 | google/gemma-4-31b-it |
| 5 | meta/muse-glimmer-30b |
| 6 | z-ai/glm-5.3-flash |
| 7 | nvidia/nemotron-3-nano-omni-30b-a3b-reasoning |
| 8 | google/diffusiongemma-26b-a4b-it(拡散方式。未評価) |

判定の途中でモデルが応答しなくなると、`config.py` の切り替えの順番に従って
次のモデルへ自動で切り替え、残りを続ける。

- 関連度判定・抽出(`FALLBACK_ORDER`): 1 だけ。1 が休んでいる間は代わりを
  使わず、10分ごとに試し直して戻るのを待つ(戻らなければ止まるので `--resume`)。
  2(lightning)に切り替えた回は寛大すぎて、カタログが無関係な文献で膨らんだ
  (2本目・3本目が共に除外相当とした107件のうち90件が lightning の採用分)。
  3(gpt-oss)は厳しすぎて、切り替えた分だけ取りこぼす(どちらも 1 が super だったころの実測)
- 再判定(`ENSEMBLE_FALLBACK_ORDER`): 3 → 8 → 4 → 1(別系統を先に。1本目に使ったモデルは飛ばす)
- 8 は、思考を止めると本文が空になるため、思考ありで呼ぶ
  (`THINKING_REQUIRED_MODELS`)。再判定の切り替え先と、3つ目の判定
  (`ENSEMBLE_SECOND_MODEL`)に使う。1本目の切り替え先には入れていない
- 5・6・7 はどちらの順番にも入れていない(`--model` では使える)。5 は思考を
  止められず、思考ありで呼ぶと82件の再判定に832秒かかった(gpt-oss は35秒)。
  質は他と同じだが応答の形も崩れて実用にならない。6 は思考を止められず
  1バッチに4分以上かかり、7 は関連の明らかな文献にもプロンプトの例の理由を
  そのまま写した。切り替え先が尽きた分は未判定として残り、あとで判定し直す
  (質の悪い判定が混ざるより良い)
- gemma(4)は 2026-09 に応答しない状態が続いたため、どちらの順番でも後ろにしてある
- 空の `()` にすると切り替えない
- 「応答しない」には、時間切れのほか、429(混雑)で再試行を使い切った場合も
  含む。送信上限を最低まで下げても 429 が続くのは、そのモデルが混んでいるため
- 応答しなくなったモデルは `DEAD_MODEL_COOLDOWN`(600秒)休ませてから1回だけ
  試し直し、応答すれば元のモデルに戻る。試し直しの1件が応答するまで、他の
  並列の問い合わせは代わりのモデルで続ける
- 切り替え先がすべて休んでいるときは、どれかが戻るまで待つ。どのモデルも
  試し直して応答しなければ、ここまでの結果を保存して止まる。時間をおいて
  `--resume` で続きから
- 思考を止める指定が効かないモデル(実測では glm-5.3-flash)は、思考が
  `THINKING_RUNAWAY_CHARS`(4000字)を超えた時点で見切って次へ移る(戻さない)
- 判定の理由に例の枠(「同名異義語: 〇〇」)が残ったものは、抄録を読まずに例を
  写したとみなして使わず、1件ずつ判定し直す
- 判定・抽出の各行にタイトルの書き出しを書かせ、番号がずれていればタイトルで
  付け替える。「この番号の論文は無い」と答えた分は判定し直す(モデルが1件
  読み落とすと、以降の判定が1件ずつ別の論文に付いていた)
- 再判定で判定できなかった分は一度やり直す(切り替わっていれば切り替え先で、
  切り替わっていなければ1件ずつ)

切り替えが起きた回は、カタログ冒頭・各抄録・索引・レポート生成プロンプトに
どのモデルで判定したかが記録される。

### 判定モデルの替えどき

NVIDIA 側でモデルの提供が終わると、呼び出しが 410 Gone になり、収集の最初の
モデル確認で止まる(2026-10-03 に nemotron-3-super がこうなった)。`config.py` の
該当する設定を `python research_bot.py models` で ✓ の付くモデルに替える。

1本目(`FILTER_MODEL`)を替えたら、前の回のカタログを新しいモデルで再判定し、
前のモデルと点の付け方が近いかを確かめる。再判定は前の結果を上書きするので、
先に控えを取る:

```
rb ensemble <前の回のテーマ名> --model 1
```

再判定の報告の「採否の一致」「関連度スコアの差」を見る。差が大きいと、同じ
テーマでも前の回と採用の線がずれる(参考: 2本目の gpt-oss は super より平均
16〜30点厳しかった)。

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
| `_ensemble__テーマ.md` | 別モデルとの不一致・採否の一致・一致率・κ係数(1本目の分類が偏るときは κ が低く出やすい旨を注記) |
| `_fulltext__テーマ.md` | core 文献の全文アクセス可否(A/B/C) |
| `_diff__テーマ.md` | 前回カタログとの差分 |

1段目の除外ログは `~/.local/share/research_prefilter/`、差分用の前回の記録は
`~/.local/share/research_snapshots/` に置かれる(Vault の外)。

引用キーのレジストリ `[keyring] research.json` は、テーマのフォルダではなく
`CATALOG_ROOT` の直下に1つだけあり、全テーマで共有する(同じ論文に同じキー、
別の論文に別のキー)。保存のたびに控え `[keyring] research.json.bak`(本体と
同じ内容)も書く。

本体が壊れて読めないときは、書き換えずに止まり、控えから戻す `cp` のコマンドを
表示する。収集を始める前と、出力フォルダを作る直前に確かめる。出力の手前で
止まった回は途中経過が残っているので、戻したあと `--resume` を付ければ、判定を
やり直さずに出力だけする。

## 主な設定(config.py)

| 項目 | 既定 | 意味 |
|---|---|---|
| `CATALOG_ROOT` | …/Vault/Abstract/catalog | カタログの保存先 |
| `FILTER_MODEL` | nemotron-3-ultra-550b-a55b | 関連度判定・抽出のモデル(2026-10-03 に super の提供が終わり、ultra に替えた) |
| `ENSEMBLE_MODEL` | gpt-oss-20b | 再判定のモデル(判定モデルとは別系統にする) |
| `ENSEMBLE_SECOND_MODEL` | diffusiongemma | 再判定の3つ目のモデル。2本目と3本目が両方とも除外相当にした文献を報告の最優先に出す(`--model` を指定した再判定では使わない。空文字で無効) |
| `PREFILTER_MODE` | off | 1段目の粗選別。dryrun で試す、on で除外(取りこぼしが出たため既定は off) |
| `REUSE_SEARCH_PLAN` | False | 同じテーマ文の前回の検索計画を使う(`--reuse-plan` / `--replan`) |
| `FALLBACK_ORDER` | 1 | 応答しなくなったときの切り替えの順番(関連度判定は代わりを使わず待つ) |
| `DEAD_MODEL_COOLDOWN` | 600 | 応答しなくなったモデルを試し直すまでの秒数(0で試し直さない) |
| `EUROPEPMC_TIMEOUT` | 60 | Europe PMC の待ち時間(長い検索式は20秒で返らなかった) |
| `RELEVANCE_THRESHOLD` | 70 | これ未満は除外。判定の手引きの「隣接する研究」の帯(70〜89)もこの値から始まる |
| `SECOND_LOOK` | True | 除外した中間帯(21〜69点)を組み合わせを変えてもう一度判定し、採用相当なら戻す(判定の回ごとの揺れ対策。件数は検索の記録に残る) |
| `CORE_SCORE` | 90 | core とする関連度 |
| `CONSENSUS_CORE` | True | 採用した文献を `ENSEMBLE_MODEL` と `ENSEMBLE_SECOND_MODEL` でも判定し、3つの点数の中央値と「実測あり」の多数決で中心クラスタを決める(採否は1本目のまま)。1つのモデルの外れた点数に引かれないよう平均ではなく中央値。カタログの関連度は中央値になり、各項目に内訳が付く。check の再判定はこの結果を使い回す。False で1本目の点数だけで決める |
| `PLANNING_THINKING` | True | 検索計画を作るモデルに思考させる。ultra で比べると、思考ありのほうが指示に従い(広すぎる診断名を出さない)、同名異義語も挙げた。ultra は思考ありで約1分半。glm-5.3-flash は思考が600秒を超えて計画を返せなかった |
| `CONSENSUS_EXCLUDE` | True | 1本目が採用しても2本目・3本目が共に70点未満とした文献を除外する(3つのうち2つが除外)。除外ログに「多数決で除外」と残る。カタログを絞るため。近縁の研究も数件外れうる。`CONSENSUS_EXCLUDE=false rbrun …` で1回だけ無効にできる |
| `CORE_MIN_ITEMS` | 5 | core がこれ未満のとき基準を緩める。中央値の回は、中央値80点以上で過半数が実測ありとしたものを件数によらずすべて core とする(75点には下りない) |
| `MIN_ABSTRACT_LENGTH` | 400(日本語 150) | 抄録の下限 |
| `REQUESTS_PER_MINUTE` | 35 | 1分あたりの送信上限。429 が返ると自動で下げ、成功が続くと戻す(`ADAPTIVE_RPM`) |
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

## 修正(2026-10-15)

- 引用キーのレジストリが読めないとき、空として続け、収集の最後に今回のキーだけで
  上書きしていた(全テーマ分の記録が消える)。読めなければ止まり、控えから戻せる
- 除外の再確認の途中で止めると、1回目の点数が2回目の点数で上書きされたまま
  残っていた。1回目の判定を保ち、再開しても同じ文献を見直さない
- 関連度(score)を書かなかった判定を0点(除外)にしていた。未判定にして、
  あとで1件ずつ判定し直す
- 1本目が判定できなかった文献が、2本目・3本目の点数だけで core に入る、または
  多数決で除外されることがあった。別系統の判定に回さない(GitHub の main の
  2026-10-02 の修正と同じ。端末の版に入っていなかった)
- 再判定の報告(`_ensemble_`)の「中心クラスタからの除外候補」に3本目の点数が
  無く、3本目だけが閾値を下回った文献が「related 80 / related 80」という理由の
  読めない行になっていた。中央値で中心クラスタを決めた回は、3つの点数・中央値・
  閾値を下回ったモデルのメモを並べる
- κ を算出できないとき、欠落0件の回でも「応答欠落が多い回に起きやすい」と出て
  いた。実際の理由(1本目の分類がすべて related で、core の基準を満たした文献が
  無い、など)を書く
- テーマ文を2行以上にすると、レポート生成プロンプトが指示するファイル名に
  2行目以降まで入っていた。フォルダ名と同じく1行目だけを使う

## 旧版からの変更(2026年9月)

- 14ファイルを8ファイルに統合した。`extract.py`・`jsonparse.py`・`prefilter.py`・
  `ensemble_check.py`・`fulltext_check.py`・`catalog_diff.py`・`generate_report.py` は無い
- 単独で動かしていた再判定・全文・差分は `research_bot.py` のサブコマンドになった。
  `.bashrc` に旧ファイルを呼ぶ `check()` 関数が残っていれば、
  `python ~/research_bot/research_bot.py check "$1"` に置き換える
- OpenRouter への切り替えは廃止した(NVIDIA のみ)
