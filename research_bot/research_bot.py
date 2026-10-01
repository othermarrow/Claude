"""心理学領域の文献収集からレポート用カタログ生成まで。

  python research_bot.py                     query.js のテーマで収集
  python research_bot.py "テーマを文章で"     テーマを直接指定して収集
  python research_bot.py --resume            中断したところから再開
  python research_bot.py --model 2           判定モデルを差し替えて収集

  python research_bot.py check <テーマ>       事後チェック3種をまとめて実行
  python research_bot.py ensemble <テーマ>    別モデルで判定を再確認
  python research_bot.py fulltext <テーマ>    core 文献の全文アクセス可否
  python research_bot.py diff <テーマ>        前回のカタログとの差分
  python research_bot.py relink <レポート>    生成済みレポートの引用キーを検証
  python research_bot.py unwikilink <パス>   フロントマターの[[リンク]]を文字列に
  python research_bot.py themes              テーマ一覧と各チェックの有無
  python research_bot.py models              使えるモデルの一覧(名前の確認)
  python research_bot.py probe               モデルが今応答するかを確かめる
  python research_bot.py bench               1段目(prefilter)の候補モデルを比べる

<テーマ> はフォルダ名・フォルダのパス・カタログのパスのどれでもよい。

テーマはキーワードの羅列ではなく文章で書いてよい。文章から検索のファセットを
取り出し、同義語を展開し、データベース別の検索式を組み立てる。

【ファイルの役割】
  config.py        設定(保存先・モデル・閾値・同義語辞書など)。値はここだけで変える
  research_bot.py  入口(このファイル)。収集の流れと各コマンド
  searchplan.py    テーマ文 → ファセット → データベース別の検索式
  sources.py       各データベースの検索・引用連鎖・撤回確認・OAの所在
  judge.py         抄録をLLMに読ませる処理(1段目の粗選別・関連度判定・設計の抽出・再判定)
  fulltext.py      本文(Methods章)での確認と、全文アクセス可否の一覧
  catalog.py       カタログ・索引・レポート生成プロンプトの書き出し、差分、relink
  llm.py           LLMへの問い合わせ(再試行・送信間隔・応答のJSON読み取り)

【処理の流れ】
  1 ファセット抽出 → MeSH照合 → 検索式
  2 各DBを検索(精度重視→感度重視の2〜3段)
  3 引用連鎖
  4 1段目の粗選別 → 関連度判定 → 未判定の再判定 → 中心クラスタの調整
  5 研究設計・参加者・場面の抽出
  6 撤回の確認・OA全文の所在 → 本文(Methods章)で設計を確かめ直す
  7 カタログ出力(レポート生成プロンプトも)
  8 check(アンサンブル判定・全文アクセス可否・前回との差分)

【中断復帰】
Termuxはwake lockを取っていても端末の再起動・電池切れ・OSによるプロセス
終了で落ちることがある。テーマごとに途中経過を <出力先>/.checkpoint/ へ
書き出しており、--resume で続きから走らせる。判定は20バッチごとに
保存されるので、失うのは最後の20バッチ分だけ。Ctrl-C でも保存してから止まる。
"""

import argparse
import atexit
import datetime
import hashlib
import json
import os
import re
import subprocess
import sys

import time

from tqdm import tqdm

import catalog
import config
import fulltext
import judge
import llm
import searchplan
import sources

HERE = os.path.dirname(os.path.abspath(__file__))

collected = []
_by_key = {}          # 重複判定のキー → collected の要素

# 抄録が短くて捨てた件の集計。DB名 → 内訳。
short_stats = {}
short_seen = set()

_filter_model_override = ""


def active_planning_model() -> str:
    return config.PLANNING_MODEL


def active_filter_model() -> str:
    return _filter_model_override or config.FILTER_MODEL


# ==========================================
# 中断復帰(チェックポイント)
# ==========================================
# 段階。あとの段階ほど進んでいる。
STAGES = ["collected", "judging", "judged", "extracted", "refined"]


def _checkpoint_path(output_dir: str, topic: str) -> str:
    d = os.path.join(output_dir, config.CHECKPOINT_DIRNAME)
    h = hashlib.sha1(topic.strip().encode("utf-8")).hexdigest()[:12]
    return os.path.join(d, f"{h}.json")


def checkpoint_exists(output_dir: str, topic: str) -> bool:
    return os.path.exists(_checkpoint_path(output_dir, topic))


def save_checkpoint(output_dir, topic, stage, plan=None, plan_text="",
                    search_log=None, collected_count=None, cluster_note=""):
    """途中経過を書き出す。一時ファイルへ書いてから置き換えるので、
    書き込み中に落ちても前回のチェックポイントは壊れない。"""
    path = _checkpoint_path(output_dir, topic)
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({
                "version": 2, "topic": topic, "stage": stage,
                # 再開時に判定モデルが入れ替わっていないか確かめるために残す
                "filter_model": active_filter_model(),
                "updated_at": datetime.datetime.now().isoformat(timespec="seconds"),
                "plan": plan or {}, "plan_text": plan_text,
                "search_log": search_log or [],
                "collected_count": (len(collected) if collected_count is None
                                    else collected_count),
                "cluster_note": cluster_note,
                "items": collected,
            }, f, ensure_ascii=False)
        os.replace(tmp, path)
    except Exception as e:
        tqdm.write(f"  [!] チェックポイントを保存できませんでした: "
                   f"{type(e).__name__}: {e}")


def load_checkpoint(output_dir, topic):
    path = _checkpoint_path(output_dir, topic)
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
    except Exception as e:
        print(f"[警告] チェックポイントを読めませんでした({type(e).__name__})。"
              f"最初から実行します: {path}")
        return None
    if (d.get("topic") or "").strip() != topic.strip():
        print("[警告] チェックポイントのテーマが一致しません。最初から実行します。")
        return None
    if d.get("stage") not in STAGES:
        print("[警告] チェックポイントの段階が読めません。最初から実行します。")
        return None
    return d


def restore_checkpoint(state) -> int:
    """チェックポイントの内容を収集リストへ戻す。戻り値は件数。"""
    collected.clear()
    _by_key.clear()
    for it in state.get("items") or []:
        collected.append(it)
        _register(it, *_dedupe_keys(it.get("title"), it.get("doi")))
    return len(collected)


def clear_checkpoint(output_dir, topic):
    try:
        os.remove(_checkpoint_path(output_dir, topic))
    except OSError:
        pass


def stage_reached(state, name: str) -> bool:
    if not state:
        return False
    try:
        return STAGES.index(state.get("stage")) >= STAGES.index(name)
    except ValueError:
        return False


# ==========================================
# Termuxスリープ対策
# ==========================================
def acquire_wake_lock():
    try:
        subprocess.run(["termux-wake-lock"], check=False, capture_output=True)
        print("[System] Wake Lock(スリープ防止)を有効化しました。")
    except Exception:
        pass


def release_wake_lock():
    try:
        subprocess.run(["termux-wake-unlock"], check=False, capture_output=True)
        print("\n[System] Wake Lockを解除しました。")
    except Exception:
        pass


# ==========================================
# 収集
# ==========================================
def _record_short(src, title, text):
    """抄録が短くて捨てた件を記録する。同一タイトルは二重に数えない。"""
    tk = catalog.title_key(str(title or ""))
    if tk:
        if tk in short_seen:
            return
        short_seen.add(tk)
    s = short_stats.setdefault(src, {"empty": 0, "short": 0, "would_keep": 0,
                                     "lengths": [], "samples": []})
    if not text:
        s["empty"] += 1
        return
    s["short"] += 1
    s["lengths"].append(len(text))
    ref = (config.SHORT_REFERENCE_LENGTH_JA if catalog.is_cjk(text)
           else config.SHORT_REFERENCE_LENGTH)
    if len(text) >= ref:
        s["would_keep"] += 1
        if len(s["samples"]) < 3:
            s["samples"].append(
                (len(text), catalog.clean_abstract(str(title or ""))[:60]))


def report_short_abstracts() -> list:
    """抄録が理由で捨てた件数をDB別に表示し、検索の記録用の行を返す。"""
    if not short_stats:
        return []
    empty = sum(v["empty"] for v in short_stats.values())
    short = sum(v["short"] for v in short_stats.values())
    would = sum(v["would_keep"] for v in short_stats.values())
    head = (f"抄録を理由に収集段階で除外: 抄録なし {empty}件 / 短すぎ {short}件 "
            f"(閾値 EN {config.MIN_ABSTRACT_LENGTH}字 / "
            f"JA {config.MIN_ABSTRACT_LENGTH_JA}字)")
    print(f"\n[収集] {head}")
    lines = [head]
    for src, v in sorted(short_stats.items(), key=lambda x: -x[1]["short"]):
        if not (v["empty"] or v["short"]):
            continue
        med = sorted(v["lengths"])[len(v["lengths"]) // 2] if v["lengths"] else 0
        msg = (f"  {src}: 抄録なし {v['empty']}件 / 短すぎ {v['short']}件"
               + (f" (中央値 {med}字 / 参照閾値なら {v['would_keep']}件は拾えた)"
                  if v["lengths"] else ""))
        print(msg)
        lines.append(msg)
        for ln, t in v["samples"]:
            print(f"      例 {ln}字: {t}")
    if would:
        note = (f"参照閾値(EN {config.SHORT_REFERENCE_LENGTH}字 / "
                f"JA {config.SHORT_REFERENCE_LENGTH_JA}字)まで下げると計 {would}件が"
                "加わる。config.py の MIN_ABSTRACT_LENGTH / MIN_ABSTRACT_LENGTH_JA"
                "(または同名の環境変数)で変更できる。")
        print(f"[収集] {note}")
        lines.append(note)
    return lines


def _dedupe_keys(title, doi) -> tuple:
    """重複排除に使う (正規化DOI, タイトルの指紋) を返す。

    add_item とチェックポイントからの復元で同じ規則を使う必要があるため
    切り出してある。ずれると、再開後に同じ論文を二重に集めてしまう。
    タイトルの指紋はカタログの引用キーレジストリと同じもの(catalog.title_key)。
    """
    doi_norm = ""
    if doi:
        doi_norm = re.sub(r"^https?://(dx\.)?doi\.org/", "", str(doi).strip().lower())
        doi_norm = re.sub(r"^doi:\s*", "", doi_norm).strip("/ ")
    return doi_norm, catalog.title_key(str(title or "")) or None


def _register(item, doi_norm, title_key):
    for k in (f"d:{doi_norm}" if doi_norm else None, title_key):
        if k:
            _by_key.setdefault(k, item)


# 重複だったときに、既存の記録へ補う項目。最初に拾ったDBが持っていない
# 情報を、後から来たDBが持っていることが多い(例: PubMed由来は被引用数を
# 持たず、引用連鎖のシードに選ばれなかった。OpenAlex由来はPMCIDを持つ)。
_ENRICH_FIELDS = ("doi", "pmcid", "cited_by", "openalex_id", "venue",
                  "peer_reviewed")


def _enrich(existing: dict, new: dict) -> None:
    for f in _ENRICH_FIELDS:
        if existing.get(f) in (None, "", []) and new.get(f) not in (None, "", []):
            existing[f] = new[f]
    if not existing.get("authors") and new.get("authors"):
        existing["authors"] = new["authors"]


def add_item(src, title, year, content, url=None, doi=None, authors=None,
             venue=None, pmcid=None, openalex_id=None, cited_by=None,
             peer_reviewed=None) -> bool:
    """収集リストに1件加える。重複していれば既存の記録を補ってFalseを返す。"""
    text = catalog.clean_abstract(content)
    limit = (config.MIN_ABSTRACT_LENGTH_JA if catalog.is_cjk(text)
             else config.MIN_ABSTRACT_LENGTH)
    if len(text) < limit:
        _record_short(src, title, text)
        return False
    # タイトルもHTMLタグ・実体参照を含むことがある(Wiley系の <scp> 等)。
    # クリーニングしないと正規化ハッシュが食い違い、重複排除をすり抜ける。
    title = catalog.clean_abstract(title) or None
    doi_norm, title_key = _dedupe_keys(title, doi)
    if not doi_norm and not title_key:
        return False

    new = {
        "src": src, "title": title or "Untitled",
        "year": str(year) if year else "Unknown", "content": text,
        "url": url or "No URL", "doi": doi_norm or None,
        "authors": [str(a).strip() for a in (authors or []) if a and str(a).strip()],
        "venue": venue, "pmcid": sources.normalize_pmcid(pmcid) or None,
        "openalex_id": openalex_id, "cited_by": cited_by,
        "peer_reviewed": peer_reviewed,
    }
    # DOIが違ってもタイトルが完全一致すれば同じ論文とみなす
    dup = (_by_key.get(f"d:{doi_norm}") if doi_norm else None) or \
          (_by_key.get(title_key) if title_key else None)
    if dup is not None:
        _enrich(dup, new)
        # 補ったDOIや、表記の違うタイトルでも次から同じ記録に行き着くように
        _register(dup, dup.get("doi") or "", title_key)
        return False

    collected.append(new)
    _register(new, doi_norm, title_key)
    return True


# ==========================================
# テーマの読み込み
# ==========================================
def read_topic() -> str:
    """テーマファイルを読む。文章でもキーワード列でもよい。"""
    qf = config.QUERY_FILE
    os.makedirs(os.path.dirname(qf), exist_ok=True)
    if not os.path.exists(qf):
        with open(qf, "w", encoding="utf-8") as f:
            f.write("// 調べたいことを文章で書いてください。\n"
                    "// 例: 強度行動障害のある人への機能的アセスメントに基づく支援は、\n"
                    "//     入所施設の現場でどこまで実行可能かを知りたい。\n"
                    "const topic = `\n"
                    "強度行動障害のある人への支援\n"
                    "`;\n")
        print(f"[{qf}] を作成しました。テーマを書いて再実行してください。")
        sys.exit()
    with open(qf, encoding="utf-8") as f:
        raw = f.read()
    raw = re.sub(r"/\*.*?\*/", "", raw, flags=re.DOTALL)
    m = re.search(r"`([^`]*)`", raw, re.S)   # バッククォートの複数行
    if m:
        body = m.group(1)
    else:
        lines = []
        for line in raw.splitlines():
            s = re.sub(r"^(let|const|var|export)\s+[A-Za-z0-9_]+\s*=\s*", "",
                       line.split("//")[0].strip()).strip(" \"';,[]{}`")
            if s:
                lines.append(s)
        body = "\n".join(lines)
    body = "\n".join(l.strip() for l in (body or "").splitlines() if l.strip())
    return body or "強度行動障害のある人への支援"


# ==========================================
# 事後チェック
# ==========================================
def run_checks(theme_arg: str, ensemble_model: str = "", skip=()) -> None:
    # ensemble_model は利用者が明示したときだけ渡す。空なら ENSEMBLE_MODEL を使い、
    # それが本判定の途中の切り替えで使われていれば、再判定の順番で次のモデルにする。
    """アンサンブル判定・全文アクセス可否・差分を続けて実行する。

    旧版は bash の check() 関数を `bash -ic` で呼んでいた。.bashrc の
    読み込み方に左右され、CATALOG_ROOT も受け取る側に届いていなかった。
    同じプロセスの中で直接呼ぶ。1つが失敗しても残りは続ける。
    """
    steps = [
        ("ensemble", "アンサンブル判定",
         # モデルの確認は呼び出し元(search / check)で済ませてある
         lambda: judge.run_ensemble(theme_arg, ensemble_model, preflight=False)),
        ("fulltext", "全文アクセス可否",
         lambda: fulltext.check_access(theme_arg)),
        ("diff", "前回との差分", lambda: catalog.run_diff(theme_arg)),
    ]
    for key, label, fn in steps:
        if key in skip:
            continue
        print(f"\n===== check: {label} =====")
        try:
            fn()
        except KeyboardInterrupt:
            print(f"\n[中断] {label}を中止しました。残りのチェックも行いません。")
            return
        except SystemExit as e:
            print(f"[警告] {label}を実行できませんでした: {e}")
        except Exception as e:
            print(f"[警告] {label}で問題が起きました({type(e).__name__}: {e})。"
                  "残りのチェックは続けます。")


# ==========================================
# 収集コマンド
# ==========================================
def cmd_search(args):
    global _filter_model_override
    llm.STOP.clear()
    if args.model:
        _filter_model_override = config.resolve_model(args.model)
    ensemble_choice = config.resolve_model(args.ensemble_model)   # 明示した場合だけ
    ensemble_model = ensemble_choice or config.ENSEMBLE_MODEL
    do_check = config.RUN_CHECK_AFTER_SEARCH and not args.no_check

    topic = args.topic or read_topic()
    named_plan = None
    if isinstance(args.reuse_plan, str):
        # --reuse-plan <フォルダ名>: その回の検索計画で取り直す。テーマ文も
        # その回のものにそろえる。実測: テーマファイルが別のテーマに書き
        # 換わっていて、「インフォーマルなアセスメント」の名前のカタログに
        # 週間スケジュールの検索計画で集めた文献が入った。
        try:
            named_plan = catalog.plan_of_theme(args.reuse_plan, args.output_dir)
        except FileNotFoundError as e:
            raise SystemExit(f"[エラー] --reuse-plan: {e}\n"
                             "        テーマの一覧: python research_bot.py themes")
        plan_topic = named_plan[2]
        if plan_topic and plan_topic != topic.strip():
            if args.topic:
                raise SystemExit(
                    f"[エラー] --reuse-plan で指定した回({named_plan[1]})のテーマ文と、"
                    "指定したテーマ文が違います。\n"
                    f"        その回のテーマ文: {plan_topic.splitlines()[0]}\n"
                    "        その回を取り直すならテーマ文を省き、別のテーマなら "
                    "--reuse-plan を外してください。")
            print(f"[情報] --reuse-plan で指定した回({named_plan[1]})のテーマ文で"
                  "収集します(テーマファイルの「"
                  f"{topic.splitlines()[0]}」ではなく)。\n")
            topic = plan_topic
    print("=== 学術リサーチ ===")
    print(f"\n【テーマ】\n{topic}\n")
    # 古いファイルのコピーを使っていて修正が反映されていなかった事例が
    # あったため、主要な設定値を起動時に必ず表示する。
    print(f"[設定] PLANNING={active_planning_model()} / FILTER={active_filter_model()}"
          + (f" / ENSEMBLE={ensemble_model}" if do_check else ""))
    print(f"[設定] BATCH={config.FILTER_BATCH_SIZE} / "
          f"並列={config.CONCURRENCY} / 送信上限={config.REQUESTS_PER_MINUTE}回/分 / "
          f"温度={config.TEMPERATURE} / MAX_TOKENS={config.MAX_TOKENS}")
    print(f"[設定] CORE_SCORE={config.CORE_SCORE} / "
          f"RELEVANCE_THRESHOLD={config.RELEVANCE_THRESHOLD} / "
          f"MIN_ABSTRACT_LENGTH={config.MIN_ABSTRACT_LENGTH}(EN)/"
          f"{config.MIN_ABSTRACT_LENGTH_JA}(JA)")
    use_prefilter = config.PREFILTER_MODE != "off"
    print(f"[設定] PREFILTER_MODE={config.PREFILTER_MODE}"
          + (f" / PREFILTER={config.PREFILTER_MODEL}" if use_prefilter else "")
          + "\n")

    # 数時間の処理を始める前に、モデル名の誤りをここで止める
    llm.preflight([active_planning_model(), active_filter_model()]
                  + ([config.PREFILTER_MODEL] if use_prefilter else [])
                  + ([ensemble_model] if do_check else []))

    acquire_wake_lock()
    atexit.register(release_wake_lock)
    os.makedirs(args.output_dir, exist_ok=True)

    # --- 中断復帰 ---
    state = None
    if args.resume:
        state = load_checkpoint(args.output_dir, topic)
        if state is None:
            print("[情報] このテーマのチェックポイントが無いため、最初から実行します。\n")
        else:
            n = restore_checkpoint(state)
            print(f"[再開] {state.get('updated_at')} 時点の状態から再開します"
                  f"(段階: {state['stage']} / 収集済み {n}件)\n")
            prev = state.get("filter_model")
            if prev and prev != active_filter_model():
                print(f"[警告] 前回の判定は {prev} で行われています"
                      f"(今回は {active_filter_model()})。判定済みの分は"
                      "再判定されないため、1つのカタログに2つのモデルの判定が"
                      "混ざります。揃えたい場合は中断して")
                print(f"         --model {prev}")
                print("       を付け直すか、最初から取り直してください。\n")
    elif checkpoint_exists(args.output_dir, topic):
        print("[情報] このテーマには中断時のチェックポイントがあります。"
              "続きから実行するには --resume を付けてください。\n")

    plan, plan_text, search_log = None, "", []
    cluster_note = ""
    collected_count = 0

    def _save(stage):
        save_checkpoint(args.output_dir, topic, stage, plan=plan,
                        plan_text=plan_text, search_log=search_log,
                        collected_count=collected_count, cluster_note=cluster_note)

    if state is not None:
        plan = state.get("plan") or {}
        plan_text = state.get("plan_text") or ""
        search_log = list(state.get("search_log") or [])
        cluster_note = state.get("cluster_note") or ""
        collected_count = state.get("collected_count") or len(collected)
        plan.setdefault("definition", f"{topic} に関する研究")
        print("[1-3] 検索と引用連鎖はチェックポイントから復元しました。")
    else:
        reuse = (args.reuse_plan if args.reuse_plan is not None
                 else config.REUSE_SEARCH_PLAN)
        if named_plan:
            prev_plan, prev_from = named_plan[0], named_plan[1]
        else:
            prev_plan, prev_from = (catalog.find_previous_plan(topic, args.output_dir)
                                    if reuse else (None, ""))
        if prev_plan:
            # 同じ計画で検索すれば、前回との差分が「新しく出た文献」になる
            print(f"[1/7] 前回の収集({prev_from})の検索計画を使います"
                  "(作り直すには --replan)。")
            plan = prev_plan
            search_log.append(f"検索計画: 前回の収集({prev_from})のものを使用")
        else:
            if reuse:
                print("[情報] このテーマ文で前に収集した検索計画が見つからないため、"
                      "新しく作ります。")
            # --- 1. ファセット抽出 ---
            print("[1/7] テーマを検索のファセットへ分解しています...")
            # 1回しか呼ばないので、失敗したらすぐ代わりのモデルへ移る
            facet_raw, _used = llm.ask_fallback(searchplan.facet_prompt(topic),
                                                active_planning_model(), any_error=True)
            if llm.is_error(facet_raw):
                print(f"[警告] ファセット抽出に失敗しました: {facet_raw}")
                print("       テーマ文をそのまま検索語として使う縮退動作になります。")
            plan = searchplan.parse_facet_response(facet_raw, topic)
            facets = plan.get("facets") or []
            if (not llm.is_error(facet_raw) and len(facets) == 1
                    and facets[0].get("name") == "topic"
                    and topic in (facets[0].get("en") or [])):
                print(f"[警告] ファセット抽出の応答がJSONとして解釈できず、単一"
                      f"ファセットへ縮退しました。AIの生応答(先頭300字): "
                      f"{facet_raw[:300]!r}")
            mesh_cand = [m for f in facets for m in (f.get("mesh") or [])]
            if mesh_cand:
                kept_mesh = searchplan.apply_validated_mesh(
                    plan, sources.validate_mesh_terms(mesh_cand))
                print(f"[統制語] MeSH候補 {len(mesh_cand)}件のうち {kept_mesh}件を採用しました。")

        passes = searchplan.build_query_passes(plan)
        plan_text = searchplan.describe_plan(plan, passes[0][1])
        print("\n" + "=" * 60)
        print(plan_text)
        print("=" * 60)

        # --- 2. 検索 ---
        print(f"\n[2/7] データベースを検索しています({len(passes)}段階)...")
        sources.test_openalex_connection()
        for label, queries in passes:
            if (label == "core" and config.CORE_PASS_SKIP_AT
                    and len(collected) >= config.CORE_PASS_SKIP_AT):
                note = (f"{label}: 省略(既に{len(collected)}件集まっているため。"
                        "中核ファセット単独の検索は概念だけ一致する文献を招く)")
                tqdm.write(f"\n--- {label} --- 省略しました\n  → {note}")
                search_log.append(note)
                continue
            tqdm.write(f"\n--- {label} ---")
            totals = sources.run_searches(queries, add_item,
                                          include_japanese=not args.no_japanese)
            search_log.append(f"{label}: " + " / ".join(f"{k} {v}件"
                                                        for k, v in totals.items()))
            tqdm.write(f"  → 累計 {len(collected)}件")

        if not collected:
            print("\n【終了】データが見つかりませんでした。テーマの表現を変えて試してください。")
            return

        # --- 3. 引用連鎖 ---
        if args.hops > 0:
            print("\n[3/7] 引用連鎖で中核文献を補います...")
            before = len(collected)
            seeds = sorted(collected, key=lambda x: -(x.get("cited_by") or 0))
            rounds = sources.snowball(seeds, add_item, hops=args.hops,
                                      max_seeds=args.seeds)
            for r in rounds:
                search_log.append(f"引用連鎖 第{r['hop']}世代: シード{r['seeds']}件 → "
                                  f"後方{r['backward']}件 / 前方{r['forward']}件")
            print(f"   → 引用連鎖で {len(collected) - before}件 追加(計 {len(collected)}件)")
        else:
            print("\n[3/7] 引用連鎖は無効です(--hops 0)。")

        collected_count = len(collected)
        print(f"\n   収集・重複排除後の総数: {collected_count}件")
        search_log += report_short_abstracts()
        _save("collected")

    # --- 4〜6. 判定・抽出・本文確認 ---
    # Ctrl-C でも、その時点の段階でチェックポイントを保存してから止まる。
    current = "judging"
    try:
        if stage_reached(state, "judged"):
            print("\n[4/7] 関連度の判定はチェックポイントから復元しました。")
            kept, excluded = judge.split_by_threshold(collected)
        else:
            print("\n[4/7] 関連度とクラスタを判定しています...")
            to_judge = judge.prefilter(collected, f"{topic}\n{plan['definition']}",
                                       tag=topic)
            t_judge = time.time()
            judge.judge_relevance(
                to_judge, topic, plan["definition"], plan.get("homonyms"),
                active_filter_model(), save=lambda: _save("judging"))
            if not args.no_rescue:
                judge.rescue_unjudged(collected, topic, plan["definition"],
                                      plan.get("homonyms"), active_filter_model(),
                                      save=lambda: _save("judging"))
            back, looked = judge.second_look(
                collected, topic, plan["definition"], plan.get("homonyms"),
                active_filter_model(), save=lambda: _save("judging"))
            if looked:
                search_log.append(
                    f"除外の再確認: {config.OFF_SCORE + 1}〜"
                    f"{config.RELEVANCE_THRESHOLD - 1}点の {looked}件を判定し直し、"
                    f"{back}件を採用に戻した(2回のどちらかで"
                    f"{config.RELEVANCE_THRESHOLD}点以上なら採用。判定メモに"
                    "「再確認で採用」と残る)")
            kept, excluded = judge.split_by_threshold(collected)
            used = {}
            for it in collected:
                if it.get("judge_model"):
                    used[it["judge_model"]] = used.get(it["judge_model"], 0) + 1
            if len(used) > 1:
                print(f"   → 判定に使ったモデル: {catalog.models_label(used)}"
                      "(途中で代わりのモデルへ切り替えました)")
            judge.prefilter_audit(collected, time.time() - t_judge, len(to_judge))
            if not kept:
                print("\n【終了】判定の結果、論文が残りませんでした。")
                return
            cluster_note = judge.rebalance_clusters(kept)
            _save("judged")
        current = "judged"

        if args.no_extract:
            print("\n[5/7] 研究設計の抽出は行いません(--no-extract)。")
        elif stage_reached(state, "extracted"):
            print("\n[5/7] 研究設計の抽出はチェックポイントから復元しました。")
        else:
            print("\n[5/7] 研究設計・参加者・場面を抽出しています...")
            judge.annotate_features(kept, topic, plan["definition"],
                                    active_filter_model(),
                                    checkpoint=lambda: _save("judged"))
            _save("extracted")
        current = "extracted"

        if stage_reached(state, "refined"):
            print("\n[6/7] 撤回確認・OA・本文確認はチェックポイントから復元しました。")
        else:
            print("\n[6/7] 撤回の有無とOA全文の所在を調べています...")
            sources.annotate_retractions(kept)
            core_first = sorted(kept, key=lambda x: (x.get("cluster") != "core",
                                                     -(x.get("relevance_score") or 0)))
            oa = sources.annotate_open_access(core_first, limit=config.OA_LOOKUP_LIMIT)
            if oa:
                print(f"   → {oa}件はオープンアクセス全文が読めます。")
            if args.no_fulltext or args.no_extract:
                print("   本文での確認は行いません"
                      + ("(--no-fulltext)。" if args.no_fulltext else "(抽出なし)。"))
            else:
                fulltext.refine_with_fulltext(kept, topic, plan["definition"],
                                              active_filter_model())
            _save("refined")
    except KeyboardInterrupt:
        _save(current)
        print("\n\n[中断] ここまでの結果を保存しました。"
              "続きから実行するには --resume を付けてください。")
        return

    if not kept:
        print("\n【終了】判定の結果、論文が残りませんでした。")
        return

    # --- 7. 出力 ---
    # 出力フォルダはここで初めて作る。先に作ると、途中で落ちるたびに
    # 空のフォルダ(テーマ_1、テーマ_2 …)が積み上がる。
    paths = catalog.build_paths(args.output_dir, topic.splitlines()[0])
    print("\n[7/7] カタログを出力しています...")
    stats = catalog.build_catalog(kept, {
        "topic": topic, "definition": plan["definition"],
        "homonyms": plan.get("homonyms") or [],
        "filter_model": active_filter_model(), "plan": plan,
        "plan_text": plan_text, "search_log": search_log,
        "cluster_note": cluster_note, "core_score": config.CORE_SCORE,
        "counts": {"collected": collected_count, "excluded": len(excluded),
                   "final": len(kept)},
    }, paths)
    judge.write_reject_log(paths["excluded"], excluded,
                           f"# 関連度不足による除外 (スコア {config.RELEVANCE_THRESHOLD} 未満)")
    clear_checkpoint(args.output_dir, topic)

    theme_name = os.path.basename(paths["_folder"])
    print("\n【完了】")
    print(f"■ 出力フォルダ: {paths['_folder']}")
    print(f"■ カタログ(レポート生成に使う): {os.path.basename(paths['catalog'])}")
    print(f"■ レポート生成プロンプト:         {os.path.basename(stats['prompt_path'])}")
    if stats.get("unjudged"):
        print(f"■ 未判定(本体から分離):           "
              f"{os.path.basename(paths['unjudged'])} ({stats['unjudged']}件)")
    print(f"■ 検索の記録:                     {os.path.basename(paths['searchlog'])}")
    print(f"■ 引用キー索引:                   {os.path.basename(paths['index'])}")
    print(f"■ 除外ログ:                       {os.path.basename(paths['excluded'])}")
    print("\n次の手順:")
    if os.path.exists(os.path.join(HERE, "generate_report.py")):
        print(f"  python generate_report.py \"{paths['_folder']}\"")
    else:
        print(f"  {os.path.basename(stats['prompt_path'])} の手順どおり、カタログと"
              "プロンプトを Claude か Gemini に貼ってレポートを書かせる。")
    print(f"  レポートを {config.REPORT_DIR} に保存したら、")
    print("  python research_bot.py relink <レポート> で引用キーを検証する。")

    if do_check:
        run_checks(paths["_folder"], ensemble_choice)
    else:
        print(f"\n事後チェックは省略しました。あとで実行: "
              f"python research_bot.py check \"{theme_name}\"")


# ==========================================
# その他のコマンド
# ==========================================
def cmd_relink(args):
    cats = catalog.load_catalogs(args.catalog_dir)
    targets = []
    # フォルダも渡せる(直下の.mdすべて。サブフォルダは辿らない)
    for r in args.reports:
        if not os.path.exists(r):
            print(f"[警告] 見つかりません: {r}")
            continue
        if os.path.isdir(r):
            found = sorted(os.path.join(r, n) for n in os.listdir(r) if n.endswith(".md"))
            if not found:
                print(f"[警告] フォルダ内に.mdファイルがありません: {r}")
                continue
            print(f"[情報] フォルダ内の.mdファイル{len(found)}件を対象にします: {r}")
            targets.extend(found)
        else:
            targets.append(r)
    results = [catalog.relink_report(r, cats, args.min_rate, args.apply) for r in targets]
    print("\n" + "=" * 62)
    for res in results:
        print(f"[{res['status']}] {res['name']}")
        print(f"    引用キー {res['keys']}件 / 照合率 {res['rate']:.1%} / 生成元 {res['catalog']}")
        if res["unresolved"] and res["status"].startswith("特定"):
            shown = ", ".join(res["unresolved"][:8])
            print(f"    ⚠️ カタログに無いキー {len(res['unresolved'])}件: {shown}"
                  + (" …" if len(res["unresolved"]) > 8 else ""))
    print("=" * 62)
    if not args.apply:
        print("試行のみ。書き込むには --apply を付けてください。")


def _theme_or_exit(arg):
    try:
        return catalog.resolve_theme(arg)
    except FileNotFoundError as e:
        print(f"[エラー] {e}")
        print("        テーマ一覧: python research_bot.py themes")
        sys.exit(1)


def cmd_check(args):
    t = _theme_or_exit(args.theme)
    skip = set()
    if args.no_ensemble:
        skip.add("ensemble")
    choice = config.resolve_model(args.model)   # 明示した場合だけ
    ens = choice or config.ENSEMBLE_MODEL
    if "ensemble" not in skip:
        llm.preflight([ens])
    run_checks(t["dir"], choice, skip)


def cmd_ensemble(args):
    t = _theme_or_exit(args.theme)
    try:
        judge.run_ensemble(t["dir"], config.resolve_model(args.model), args.dry_run)
    except KeyboardInterrupt:
        print("\n[中断] 再判定を中止しました。")


def cmd_fulltext(args):
    t = _theme_or_exit(args.theme)
    try:
        fulltext.check_access(t["dir"], args.cluster, args.fetch)
    except KeyboardInterrupt:
        print("\n[中断] 照会を中止しました。")


def cmd_diff(args):
    t = _theme_or_exit(args.theme)
    catalog.run_diff(t["dir"], args.save_only)


def cmd_unwikilink(args):
    if not os.path.exists(args.path):
        print(f"[エラー] 見つかりません: {args.path}")
        sys.exit(1)
    catalog.unwikilink(args.path, args.apply)


def cmd_themes(args):
    names = catalog.list_themes(args.output_dir)
    if not names:
        print(f"カタログがありません: {args.output_dir}")
        return
    print(f"テーマ一覧({args.output_dir}):")
    print("  件数  core  生成日      E F D  テーマ")
    for n in names:
        t = catalog.resolve_theme(n, args.output_dir)
        cnt = core = "-"
        date = "-"
        snap = False
        if t["index"]:
            try:
                d = catalog.load_index(t["index"])
                items = d["items"]
                cnt = len(items)
                core = sum(1 for v in items.values() if v.get("cluster") == "core")
                date = (d.get("generated_at") or "-")[:10]
                snap = catalog.has_snapshot(t["name"], d)
            except (OSError, ValueError):
                pass
        mark = lambda p: "✓" if os.path.exists(os.path.join(t["dir"], p)) else "-"
        e = mark(f"_ensemble__{n}.md")
        f = mark(f"_fulltext__{n}.md")
        dflag = "✓" if os.path.exists(os.path.join(t["dir"], f"_diff__{n}.md")) \
            else ("記" if snap else "-")
        print(f"  {str(cnt):>4}  {str(core):>4}  {date:10}  {e} {f} {dflag}  {n}")
    print("\n  E=アンサンブル判定 F=全文アクセス D=差分(記=記録のみ)")


def _require_key():
    if not llm.have_api_key():
        print(f"[エラー] {llm.KEY_NAME} が設定されていません。")
        sys.exit(1)


def cmd_probe(args):
    _require_key()
    models = [config.resolve_model(m) for m in (args.model or [])] or \
        list(dict.fromkeys([config.FILTER_MODEL, config.ENSEMBLE_MODEL]))
    if args.variants:
        llm.probe_variants(models, args.timeout)
        return
    llm.probe(models, args.timeout, args.tokens)


def cmd_bench(args):
    _require_key()
    models = ([config.resolve_model(m) for m in (args.model or [])]
              or list(config.PREFILTER_BENCH_MODELS))
    judge.bench_prefilter(models, args.timeout)


def cmd_models(args):
    _require_key()
    avail = llm.list_models()
    if avail is None:
        print("[エラー] モデル一覧を取得できませんでした。")
        sys.exit(1)
    print(f"利用できるモデル: {len(avail)}件\n")
    print("■ config.py の設定")
    for name in ("PLANNING_MODEL", "FILTER_MODEL", "ENSEMBLE_MODEL", "PREFILTER_MODEL"):
        m = getattr(config, name)
        print(f"  {'✓' if m in avail else '✗ 見つからない'}  {name:15} {m}")
    print("\n■ --model の短い名前")
    in_order = set(config.fallback_models()) | set(config.fallback_models("ensemble"))
    for k, m in config.MODEL_PRESETS.items():
        note = "" if m in in_order else "  (自動の切り替え先には入れていない)"
        print(f"  {'✓' if m in avail else '✗'}  {k}  {m}{note}")
    if args.all or args.grep:
        pat = (args.grep or "").lower()
        rows = sorted(m for m in avail if pat in m.lower())
        print(f"\n■ 一覧{'(' + args.grep + ' を含む)' if pat else ''}: {len(rows)}件")
        for m in rows:
            print(f"  {m}")
    else:
        print("\n全件を見るには --all、絞り込むには --grep nemotron のように指定。")


# ==========================================
# エントリポイント
# ==========================================
SUBCOMMANDS = ("search", "relink", "check", "ensemble", "fulltext", "diff",
               "unwikilink", "themes", "models", "probe", "bench")


def main():
    ap = argparse.ArgumentParser(description="心理学領域の文献収集とレポート用カタログ生成")
    sub = ap.add_subparsers(dest="command")

    ps = sub.add_parser("search", help="文献を収集してカタログを作る(既定)")
    ps.add_argument("topic", nargs="?", default=None,
                    help="テーマを文章で指定。省略時は query.js を読む")
    ps.add_argument("--output-dir", default=config.CATALOG_ROOT)
    ps.add_argument("--hops", type=int, default=config.SNOWBALL_HOPS,
                    help=f"引用連鎖の世代数。0で無効(既定: {config.SNOWBALL_HOPS})")
    ps.add_argument("--seeds", type=int, default=config.SNOWBALL_SEEDS,
                    help=f"引用連鎖のシード数(既定: {config.SNOWBALL_SEEDS})")
    ps.add_argument("--no-japanese", action="store_true", help="日本語DBを検索しない")
    ps.add_argument("--no-extract", action="store_true",
                    help="研究設計・参加者・場面の抽出を行わない")
    ps.add_argument("--no-fulltext", action="store_true",
                    help="本文(Methods章)での設計の確認を行わない")
    ps.add_argument("--no-rescue", action="store_true",
                    help="未判定の抄録を判定し直す処理を行わない")
    ps.add_argument("--resume", action="store_true",
                    help="前回の中断地点から再開する")
    ps.add_argument("--reuse-plan", dest="reuse_plan", nargs="?", const=True,
                    default=None, metavar="フォルダ名",
                    help="同じテーマ文の前回の検索計画を使う(差分を見たいとき)。"
                         "フォルダ名を続けると、その回の検索計画を使う")
    ps.add_argument("--replan", dest="reuse_plan", action="store_const", const=False,
                    help="検索計画を AI に作り直させる(config.REUSE_SEARCH_PLAN が"
                         " True でも)")
    ps.add_argument("--model", default="", metavar="名前",
                    help="判定モデルを差し替える(短い名前: "
                         + " / ".join(config.MODEL_PRESETS)
                         + "、または 'ベンダー/モデル名')。既定は "
                         + config.FILTER_MODEL)
    ps.add_argument("--ensemble-model", default="", metavar="名前",
                    help="事後チェックの再判定モデル。既定は " + config.ENSEMBLE_MODEL)
    ps.add_argument("--no-check", action="store_true",
                    help="完了後の事後チェック(アンサンブル・全文・差分)を行わない")
    ps.set_defaults(func=cmd_search)

    pr = sub.add_parser("relink", help="生成済みレポートの引用キーを検証する")
    pr.add_argument("reports", nargs="+")
    pr.add_argument("--catalog-dir", default=config.CATALOG_ROOT)
    pr.add_argument("--min-rate", type=float, default=config.RELINK_MIN_RATE,
                    help="生成元を宣言していないレポートの推定に使う照合率の足切り")
    pr.add_argument("--apply", action="store_true")
    pr.set_defaults(func=cmd_relink)

    pc = sub.add_parser("check", help="事後チェック3種(アンサンブル・全文・差分)")
    pc.add_argument("theme")
    pc.add_argument("--model", default="", help="再判定モデル")
    pc.add_argument("--no-ensemble", action="store_true",
                    help="アンサンブル判定を省く(APIを使わない2種だけ実行)")
    pc.set_defaults(func=cmd_check)

    pe = sub.add_parser("ensemble", help="別モデルで判定を再確認する")
    pe.add_argument("theme")
    pe.add_argument("--model", default="", help="再判定モデル")
    pe.add_argument("--dry-run", action="store_true")
    pe.set_defaults(func=cmd_ensemble)

    pf = sub.add_parser("fulltext", help="core 文献の全文アクセス可否")
    pf.add_argument("theme")
    pf.add_argument("--cluster", default="core", help="core / related / all")
    pf.add_argument("--fetch", action="store_true", help="A判定の全文XMLを保存する")
    pf.set_defaults(func=cmd_fulltext)

    pd = sub.add_parser("diff", help="前回のカタログとの差分")
    pd.add_argument("theme")
    pd.add_argument("--save-only", action="store_true",
                    help="比較せず記録(スナップショット)だけ更新する")
    pd.set_defaults(func=cmd_diff)

    pw = sub.add_parser("unwikilink",
                        help="フロントマターの[[ウィキリンク]]を文字列にする")
    pw.add_argument("path", help=".md ファイル、またはフォルダ(下位も含む)")
    pw.add_argument("--apply", action="store_true",
                    help="実際に書き換える(元の内容は .bak に残す)")
    pw.set_defaults(func=cmd_unwikilink)

    pt = sub.add_parser("themes", help="テーマ一覧")
    pt.add_argument("--output-dir", default=config.CATALOG_ROOT)
    pt.set_defaults(func=cmd_themes)

    pm = sub.add_parser("models", help="利用できるモデルの一覧")
    pm.add_argument("--all", action="store_true")
    pm.add_argument("--grep", default="")
    pm.set_defaults(func=cmd_models)

    pp = sub.add_parser("probe", help="モデルが今応答するかを短い問い合わせで確かめる")
    pp.add_argument("--model", action="append", metavar="名前",
                    help="確かめるモデル(複数回指定可)。省略時は判定用と再判定用")
    pp.add_argument("--timeout", type=int, default=60, help="1回あたりの上限秒数")
    pp.add_argument("--variants", action="store_true",
                    help="本文が空のモデル向け。思考・返答の長さ・temperature を"
                         "変えた8通りを試し、本文が出る設定を探す")
    pp.add_argument("--tokens", type=int, default=64,
                    help="返答の長さの上限(既定64。本文が空なら増やして確かめる)")
    pp.set_defaults(func=cmd_probe)

    pb = sub.add_parser("bench", help="1段目(prefilter)の候補モデルを同じ問題で比べる")
    pb.add_argument("--model", action="append", metavar="名前",
                    help="比べるモデル(複数回指定可)。省略時は config の PREFILTER_BENCH_MODELS")
    pb.add_argument("--timeout", type=float, default=300, help="1回あたりの上限秒数")
    pb.set_defaults(func=cmd_bench)

    argv = sys.argv[1:]
    # サブコマンド名が無ければ search として扱う(テーマ文の直接指定に対応)
    if not argv:
        args = ap.parse_args(["search"])
    elif argv[0] in SUBCOMMANDS or argv[0] in ("-h", "--help"):
        args = ap.parse_args(argv)
    else:
        args = ap.parse_args(["search"] + argv)
    args.func(args)


if __name__ == "__main__":
    main()
