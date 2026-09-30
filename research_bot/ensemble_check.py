#!/usr/bin/env python3
"""生成済みカタログを別のモデルで再判定し、判定が割れた抄録を報告する。

旧版からの変更点:
  - 判定プロンプトと分類規則を本判定(judge.py)と同じにした。旧版は
    core/related/off を直接選ばせる別のプロンプトを使っており、不一致の
    多くがモデルの差ではなくプロンプトの差から生じていた。
  - 同名異義語・テーマの定義を索引(JSON)から読む。
  - 一致率と Cohen の κ(core / related / 除外相当 の3区分)を出す。
    2人の評定者の一致度と同じ読み方ができる。
  - 表にタイトルと両モデルの判定メモを載せる。キーだけでは、読み直す
    べきかどうかをその場で判断できなかった。

使い方:
  python ensemble_check.py <テーマ名 | テーマのフォルダ | カタログのパス>
  python ensemble_check.py <テーマ> --model 7      (2本目のモデルを差し替え)
  python ensemble_check.py <テーマ> --dry-run      (APIを呼ばず読み取りだけ確認)
"""

import argparse
import datetime
import os
import sys

import catalog
import config
import judge
import llm

EXCLUDED = "除外相当"     # 2本目のスコアが RELEVANCE_THRESHOLD 未満


def _bucket(cluster: str, score) -> str:
    """κの計算に使う3区分。off と閾値未満はまとめて「除外相当」。"""
    if cluster == "off" or (isinstance(score, int)
                            and score < config.RELEVANCE_THRESHOLD):
        return EXCLUDED
    return cluster


def cohen_kappa(pairs) -> float:
    """[(評定A, 評定B), ...] から Cohen の κ を返す。計算できなければ None。"""
    n = len(pairs)
    if not n:
        return None
    cats = sorted({c for p in pairs for c in p})
    po = sum(1 for a, b in pairs if a == b) / n
    pe = sum((sum(1 for a, _ in pairs if a == c) / n)
             * (sum(1 for _, b in pairs if b == c) / n) for c in cats)
    if pe >= 1.0:
        return None
    return (po - pe) / (1 - pe)


def kappa_label(k) -> str:
    """Landis & Koch (1977) の目安。"""
    if k is None:
        return "算出不可"
    for lim, lab in ((0.0, "一致していない"), (0.20, "わずかに一致"),
                     (0.40, "まずまず一致"), (0.60, "中程度に一致"),
                     (0.80, "かなり一致")):
        if k <= lim:
            return lab
    return "ほぼ完全に一致"


def load_entries(theme: dict) -> tuple:
    """索引(JSON)とカタログ本文から判定対象を組み立てる。(meta, entries)"""
    idx = catalog.load_index(theme["index"])
    abstracts = catalog.read_catalog_abstracts(theme["catalog"]) if theme["catalog"] else {}
    entries = []
    for key, rec in idx["items"].items():
        entries.append({
            "key": key, "title": rec.get("title") or "",
            "src": rec.get("src") or "",
            "content": abstracts.get(key, ""),
            "score_a": rec.get("score") if isinstance(rec.get("score"), int) else None,
            "cluster_a": (rec.get("cluster") or judge.UNJUDGED).strip(),
            "reason_a": rec.get("reason") or "",
        })
    return idx, entries


def run(theme_arg: str, model: str = "", dry_run: bool = False,
        preflight: bool = True) -> str:
    """アンサンブル判定を行い、報告ファイルのパスを返す。"""
    theme = catalog.resolve_theme(theme_arg)
    if not theme["index"]:
        raise FileNotFoundError(f"[index] …json が見つかりません: {theme['dir']}")
    idx, entries = load_entries(theme)
    topic = idx.get("topic") or theme["name"]
    definition = idx.get("theme_definition") or f"{topic} に関する研究"
    homonyms = idx.get("homonyms") or []
    model = model or config.backend_model("ensemble")
    model_a = idx.get("filter_model") or "(記録なし)"

    print(f"[アンサンブル] テーマ: {theme['name']}")
    print(f"[アンサンブル] 対象 {len(entries)}件 / 1本目: {model_a} / 2本目: {model}")
    no_abs = sum(1 for e in entries if not e["content"])
    if no_abs:
        print(f"[警告] カタログ本文から抄録を読めなかった項目: {no_abs}件"
              "(タイトルだけで判定されます)")
    if model == model_a:
        print("[警告] 1本目と同じモデルです。再判定の意味が薄れます。"
              "--model で別系統のモデルを指定してください。")
    if dry_run:
        for e in entries[:3]:
            print("-" * 40)
            print(f"key={e['key']} score={e['score_a']} cluster={e['cluster_a']}")
            print(f"title={e['title'][:80]}")
            print(e["content"][:200])
        print("\n[dry-run] APIは呼んでいません。")
        return ""
    if not entries:
        print("[アンサンブル] 対象がありません。")
        return ""
    if preflight:
        llm.preflight([model])

    hom = judge.homonym_note(homonyms)
    batches = [entries[i:i + config.FILTER_BATCH_SIZE]
               for i in range(0, len(entries), config.FILTER_BATCH_SIZE)]

    def work(batch):
        return judge.judge_batch(batch, topic, definition, hom, model,
                                 max_tokens=config.ENSEMBLE_MAX_TOKENS)

    def on_result(batch, results):
        for e, r in zip(batch, results or []):
            if r and "error" not in r:
                e.update(score_b=r["score"], cluster_b=r["cluster"],
                         reason_b=r["reason"], measured_b=r["measured"])

    llm.run_parallel(work, batches, "再判定中", on_result=on_result)

    got = sum(1 for e in entries if "cluster_b" in e)
    if got == 0:
        # 以前の結果ファイルを空の報告で上書きしないよう、何も書かずに終える
        print(f"[アンサンブル] {model} から1件も判定を得られませんでした。"
              "報告ファイルは書き出していません(前回の結果はそのまま残ります)。")
        print("    応答するモデルを確かめる: python research_bot.py probe")
        return ""
    if got < len(entries) / 2:
        print(f"[警告] 判定を得られたのは {got}/{len(entries)}件だけです。"
              "κ係数などは参考程度に見てください。")

    demote, promote, other, missing, pairs = [], [], [], [], []
    for e in entries:
        if "cluster_b" not in e:
            missing.append(e)
            continue
        a, b = e["cluster_a"], e["cluster_b"]
        e["gap"] = (abs(e["score_a"] - e["score_b"])
                    if e["score_a"] is not None else None)
        e["bucket_b"] = _bucket(b, e["score_b"])
        if a in ("core", "related"):
            pairs.append((a, e["bucket_b"]))
        if a == "core" and e["bucket_b"] == EXCLUDED:
            demote.append(e)
        elif a == "related" and b == "core":
            promote.append(e)
        elif a != e["bucket_b"] or (e["gap"] is not None
                                    and e["gap"] >= config.ENSEMBLE_SCORE_GAP):
            other.append(e)

    agree = sum(1 for a, b in pairs if a == b)
    kappa = cohen_kappa(pairs)
    gaps = [e["gap"] for e in entries if e.get("gap") is not None]
    mean_gap = sum(gaps) / len(gaps) if gaps else None

    out_path = os.path.join(theme["dir"], f"_ensemble__{theme['name']}.md")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("---\n")
        f.write(f"catalog_source: \"{os.path.basename(theme['catalog'] or '')}\"\n")
        f.write(f"model_a: \"{model_a}\"\nmodel_b: \"{model}\"\n")
        f.write(f"checked_at: {datetime.datetime.now().isoformat(timespec='seconds')}\n")
        f.write(f"kappa: {round(kappa, 3) if kappa is not None else 'null'}\n")
        f.write("---\n\n")
        f.write(f"# 判定アンサンブル結果 — {theme['name']}\n\n")
        f.write(f"- 対象抄録: {len(entries)}件 / 2本目の判定取得: "
                f"{len(entries) - len(missing)}件 / 応答欠落: {len(missing)}件\n")
        if pairs:
            line = f"- 分類の一致: {agree}/{len(pairs)}件({agree / len(pairs):.1%})"
            if kappa is not None:
                line += f" / Cohen の κ = {kappa:.2f}({kappa_label(kappa)})"
            f.write(line + "\n")
        if mean_gap is not None:
            f.write(f"- 関連度スコアの差: 平均 {mean_gap:.1f}点\n")
        f.write(f"- 判定基準: 両モデルとも同じプロンプト(関連度{config.CORE_SCORE}以上"
                "かつ実測あり→core、関連度"
                f"{config.RELEVANCE_THRESHOLD}未満→除外相当)\n\n")
        f.write("> [!warning] 不一致は誤りの証拠ではなく、抄録を読み直すべき"
                "箇所の手がかりです。どちらのモデルも「正解」ではありません。\n\n")

        def dump(rows, title, note):
            f.write(f"## {title}({len(rows)}件)\n\n{note}\n\n")
            if not rows:
                f.write("なし。\n\n")
                return
            f.write("| 引用キー | 1本目 | 2本目 | 1本目のメモ | 2本目のメモ | タイトル |\n")
            f.write("|---|---|---|---|---|---|\n")
            for e in sorted(rows, key=lambda x: -(x.get("gap") or 0)):
                t = catalog.cell(e["title"], 50)
                ra = catalog.cell(e["reason_a"] or "-", 40)
                rb = catalog.cell(e.get("reason_b") or "-", 40)
                f.write(f"| [{e['key']}] | {e['cluster_a']} {e['score_a'] if e['score_a'] is not None else '-'} "
                        f"| {e['bucket_b']} {e['score_b']} | {ra} | {rb} | {t} |\n")
            f.write("\n")

        dump(demote, "1. 最優先: 中心クラスタからの除外候補",
             "1本目は core、2本目は無関係または関連度不足と判定した抄録。"
             "中心的な根拠に使う前に抄録を読み直す。")
        dump(promote, "2. 中心クラスタへの昇格候補",
             "1本目は related、2本目は core と判定した抄録。"
             "測定を伴う研究だと確認できたものだけを主要な根拠に加える。")
        dump(other, "3. その他の不一致",
             f"周辺クラスタからの除外候補、およびスコア差"
             f"{config.ENSEMBLE_SCORE_GAP}点以上の不一致。")
        f.write("## 4. 応答が得られなかった抄録\n\n")
        if not missing:
            f.write("なし。\n")
        for e in missing:
            f.write(f"- [{e['key']}](1本目: {e['cluster_a']})\n")

    print(f"[アンサンブル] 出力: {out_path}")
    if kappa is not None:
        print(f"[アンサンブル] 一致率 {agree}/{len(pairs)} / κ={kappa:.2f}"
              f"({kappa_label(kappa)})")
    print(f"[アンサンブル] 除外候補(core→除外相当) {len(demote)}件 ← 最優先で確認 / "
          f"昇格候補 {len(promote)}件 / その他 {len(other)}件 / 欠落 {len(missing)}件")
    return out_path


def main():
    ap = argparse.ArgumentParser(description="別モデルによる判定の再確認")
    ap.add_argument("catalog", help="テーマ名・テーマのフォルダ・カタログのパスのいずれか")
    ap.add_argument("--model", default="",
                    help="2本目のモデル(短い名前か 'ベンダー/モデル名')")
    ap.add_argument("--theme", default=None, help="(旧版との互換用。使われません)")
    ap.add_argument("--dry-run", action="store_true",
                    help="読み取り結果だけ表示しAPIを呼ばない")
    args = ap.parse_args()
    try:
        run(args.catalog, config.resolve_model(args.model), args.dry_run)
    except FileNotFoundError as e:
        print(f"[FATAL] {e}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n[中断] 再判定を中止しました。")
        sys.exit(130)


if __name__ == "__main__":
    main()
