#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
catalog_diff.py
research_bot.py が出力する [index] <テーマ>.json を世代間で比較し、
前回からの変化(新規・消滅・クラスタ変更・スコア変動)を報告する。

初回はスナップショットを保存するだけ。効果は2回目の生成から。

  python catalog_diff.py                テーマ一覧(記録の有無つき)
  python catalog_diff.py <テーマ>        前回との差分を出す
  python catalog_diff.py <テーマ> --save-only   比較せず記録だけ更新
"""

import os
import re
import sys
import shutil
import argparse

import catalog
import config

SNAP_DIR = config.SNAP_DIR
SCORE_GAP = config.DIFF_SCORE_GAP


def slugify(name):
    """テーマ名をファイル名に使える形にする。日本語はそのまま残す。"""
    s = re.sub(r"[/\\:*?\"<>|]", "_", name)
    return s.strip() or "unnamed"


def snapshot_path(theme_name: str) -> str:
    """旧方式(フォルダ名ごと)の記録の場所。"""
    return os.path.join(SNAP_DIR, slugify(theme_name) + ".json")


def snapshot_path_for(theme_name: str, index: dict) -> str:
    """このテーマの前回分の記録の場所。

    収集をやり直すと catalog.build_paths は「テーマ_1」「テーマ_2」と
    新しいフォルダを作る。旧版はフォルダ名ごとに記録していたため、
    再生成するたびに「前回の記録なし」となり、差分が一度も出なかった。
    フォルダ名ではなくテーマ文(索引の topic)を鍵にする。
    """
    topic = ((index or {}).get("topic") or "").strip()
    key = catalog._sanitize_core(topic.splitlines()[0]) if topic else theme_name
    return os.path.join(SNAP_DIR, slugify(key) + ".json")


def cluster_of(rec):
    return (rec.get("cluster") or "未判定").strip()


def build_doi_map(items):
    """DOIから引用キーを引く表。キーが変わった論文の追跡に使う。"""
    m = {}
    for key, rec in items.items():
        doi = (rec.get("doi") or "").strip().lower()
        if doi and doi not in ("なし", "none", "-"):
            m[doi] = key
    return m


def compare(old, new):
    o_items, n_items = old["items"], new["items"]
    o_doi, n_doi = build_doi_map(o_items), build_doi_map(n_items)

    o_keys, n_keys = set(o_items), set(n_items)

    # DOI一致でキーが変わったものを対応づける
    renamed = {}
    for doi, ok in o_doi.items():
        nk = n_doi.get(doi)
        if nk and nk != ok and ok not in n_keys:
            renamed[ok] = nk
    # DOIの無い文献はタイトルで対応づける。これが無いと、キーが変わった
    # だけの同じ論文が「新規」と「消滅」に1件ずつ数えられていた。
    n_title = {}
    for k, rec in n_items.items():
        tk = catalog.title_key(rec.get("title"))
        if tk and k not in o_keys:
            n_title.setdefault(tk, k)
    taken = set(renamed.values())
    for ok in sorted(o_keys - n_keys):
        if ok in renamed:
            continue
        nk = n_title.get(catalog.title_key(o_items[ok].get("title")))
        if nk and nk not in taken:
            renamed[ok] = nk
            taken.add(nk)

    added, removed = [], []
    cluster_changed, score_changed = [], []

    renamed_new = set(renamed.values())
    for k in sorted(n_keys - o_keys):
        if k in renamed_new:
            continue
        added.append((k, n_items[k]))

    for k in sorted(o_keys - n_keys):
        if k in renamed:
            continue
        removed.append((k, o_items[k]))

    # 共通分（キー変更を含む）の変化
    pairs = [(k, k) for k in sorted(o_keys & n_keys)]
    pairs += sorted(renamed.items())
    for ok, nk in pairs:
        orec, nrec = o_items[ok], n_items[nk]
        oc, nc = cluster_of(orec), cluster_of(nrec)
        os_, ns_ = orec.get("score"), nrec.get("score")
        if oc != nc:
            cluster_changed.append((ok, nk, orec, nrec))
        elif (isinstance(os_, int) and isinstance(ns_, int)
              and abs(os_ - ns_) >= SCORE_GAP):
            score_changed.append((ok, nk, orec, nrec))

    return {
        "added": added,
        "removed": removed,
        "cluster_changed": cluster_changed,
        "score_changed": score_changed,
        "renamed": renamed,
    }


def cluster_counts(items):
    c = {}
    for rec in items.values():
        k = cluster_of(rec)
        c[k] = c.get(k, 0) + 1
    return c


def fmt_counts(c):
    return " / ".join(f"{k}: {v}件" for k, v in sorted(c.items()))


def write_report(path, theme, old, new, diff):
    o_items, n_items = old["items"], new["items"]
    with open(path, "w", encoding="utf-8") as f:
        f.write("---\n")
        f.write(f"topic: {theme}\n")
        f.write(f"previous_generated_at: {old.get('generated_at', '不明')}\n")
        f.write(f"current_generated_at: {new.get('generated_at', '不明')}\n")
        f.write("---\n\n")
        f.write(f"# カタログ差分 — {theme}\n\n")
        f.write(f"- 前回: {len(o_items)}件（{fmt_counts(cluster_counts(o_items))}）\n")
        f.write(f"- 今回: {len(n_items)}件（{fmt_counts(cluster_counts(n_items))}）\n")
        f.write(f"- 新規: {len(diff['added'])}件 / "
                f"消滅: {len(diff['removed'])}件 / "
                f"分類変更: {len(diff['cluster_changed'])}件 / "
                f"スコア変動: {len(diff['score_changed'])}件\n\n")
        om, nm = old.get("filter_model") or "", new.get("filter_model") or ""
        if om and nm and om != nm:
            f.write(f"> [!warning] 判定モデルが変わっています({om} → {nm})。"
                    "分類変更・スコア変動の多くはモデルの違いによるもので、"
                    "文献の中身が変わったわけではない可能性があります。\n\n")
        f.write("> [!tip] 新規と分類変更だけを読めば、"
                "前回のレポートを見直すべきかが判断できます。\n\n")

        f.write(f"## 1. 新規に加わった抄録（{len(diff['added'])}件）\n\n")
        if not diff["added"]:
            f.write("なし。\n\n")
        else:
            f.write("| 引用キー | 分類 | スコア | 年 | タイトル |\n")
            f.write("|---|---|---|---|---|\n")
            for k, r in sorted(diff["added"],
                               key=lambda x: (cluster_of(x[1]) != "core",
                                              -(x[1].get("score") or 0))):
                t = catalog.cell(r.get("title"), 60)
                f.write(f"| [{k}] | {cluster_of(r)} | {r.get('score', '-')} "
                        f"| {r.get('year', '-')} | {t} |\n")
            f.write("\n")

        f.write(f"## 2. 分類が変わった抄録（{len(diff['cluster_changed'])}件）\n\n")
        if not diff["cluster_changed"]:
            f.write("なし。\n\n")
        else:
            f.write("| 引用キー | 前回 | 今回 | スコア変化 |\n")
            f.write("|---|---|---|---|\n")
            for ok, nk, orec, nrec in diff["cluster_changed"]:
                key = f"[{ok}]" if ok == nk else f"[{ok}] → [{nk}]"
                f.write(f"| {key} | {cluster_of(orec)} | {cluster_of(nrec)} "
                        f"| {orec.get('score', '-')} → {nrec.get('score', '-')} |\n")
            f.write("\n")

        f.write(f"## 3. 消滅した抄録（{len(diff['removed'])}件）\n\n")
        f.write("前回のレポートで引用していた場合、"
                "その根拠が今回のカタログには存在しません。\n\n")
        if not diff["removed"]:
            f.write("なし。\n\n")
        else:
            f.write("| 引用キー | 前回の分類 | スコア | タイトル |\n")
            f.write("|---|---|---|---|\n")
            for k, r in diff["removed"]:
                t = catalog.cell(r.get("title"), 60)
                f.write(f"| [{k}] | {cluster_of(r)} | {r.get('score', '-')} | {t} |\n")
            f.write("\n")

        f.write(f"## 4. スコアが動いた抄録（{len(diff['score_changed'])}件）\n\n")
        f.write(f"分類は同じだが、関連度が{SCORE_GAP}点以上変化したもの。\n\n")
        if not diff["score_changed"]:
            f.write("なし。\n")
        else:
            f.write("| 引用キー | 分類 | 前回 | 今回 |\n")
            f.write("|---|---|---|---|\n")
            for ok, nk, orec, nrec in diff["score_changed"]:
                f.write(f"| [{nk}] | {cluster_of(nrec)} "
                        f"| {orec.get('score', '-')} | {nrec.get('score', '-')} |\n")

        if diff["renamed"]:
            f.write(f"\n## 5. 引用キーが変わった抄録（{len(diff['renamed'])}件）\n\n")
            f.write("DOIまたはタイトルが同一のため同じ論文と判断しました。"
                    "前回のレポートの引用キーは書き換えが必要です。\n\n")
            for ok, nk in sorted(diff["renamed"].items()):
                f.write(f"- [{ok}] → [{nk}]\n")


def run(theme_arg: str, save_only: bool = False) -> str:
    """差分を取り、報告ファイルのパスを返す(記録だけした場合は空文字)。"""
    theme = catalog.resolve_theme(theme_arg)
    if not theme["index"]:
        raise FileNotFoundError(f"[index] …json が見つかりません: {theme['dir']}")
    new = catalog.load_index(theme["index"])
    os.makedirs(SNAP_DIR, exist_ok=True)
    snap = snapshot_path_for(theme["name"], new)
    legacy = snapshot_path(theme["name"])
    prev = snap if os.path.exists(snap) else (legacy if os.path.exists(legacy) else "")

    if save_only or not prev:
        shutil.copy2(theme["index"], snap)
        print(f"[差分] スナップショットを記録しました: {len(new['items'])}件"
              f"({fmt_counts(cluster_counts(new['items']))})")
        if not save_only:
            print("[差分] 前回の記録がないため比較はしていません。"
                  "次回の生成時から差分が出ます。")
        return ""

    old = catalog.load_index(prev)
    if old.get("generated_at") == new.get("generated_at"):
        print(f"[差分] 前回と同じ生成時刻です({new.get('generated_at')})。"
              "カタログが再生成されていません。")
        return ""

    diff = compare(old, new)
    out_path = os.path.join(theme["dir"], f"_diff__{theme['name']}.md")
    write_report(out_path, theme["name"], old, new, diff)
    shutil.copy2(theme["index"], snap)

    print(f"[差分] 前回 {len(old['items'])}件 → 今回 {len(new['items'])}件 / "
          f"新規 {len(diff['added'])}件 / 消滅 {len(diff['removed'])}件 / "
          f"分類変更 {len(diff['cluster_changed'])}件 / "
          f"スコア変動 {len(diff['score_changed'])}件"
          + (f" / 引用キー変更 {len(diff['renamed'])}件" if diff["renamed"] else ""))
    print(f"[差分] 出力: {out_path}")
    return out_path


def main():
    ap = argparse.ArgumentParser(description="カタログの世代間差分")
    ap.add_argument("theme", nargs="?",
                    help="テーマ名(カタログのフォルダ名)。省略時は一覧表示")
    ap.add_argument("--save-only", action="store_true",
                    help="比較せずスナップショットだけ更新する")
    args = ap.parse_args()

    if not args.theme:
        print("テーマ一覧:")
        for d in catalog.list_themes():
            t = catalog.resolve_theme(d)
            try:
                idx = catalog.load_index(t["index"]) if t["index"] else {}
            except (OSError, ValueError):
                idx = {}
            has = (os.path.exists(snapshot_path_for(d, idx))
                   or os.path.exists(snapshot_path(d)))
            print(f"  [{'記録あり' if has else '未記録'}] {d}")
        return
    try:
        run(args.theme, args.save_only)
    except (FileNotFoundError, ValueError) as e:
        print(f"[FATAL] {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
