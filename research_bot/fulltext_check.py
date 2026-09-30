#!/usr/bin/env python3
"""[index] <テーマ>.json の core 文献について全文へのアクセス可否を調べ、
Obsidian で開けるリンク一覧(_fulltext__<テーマ>.md)を書き出す。

本体は fulltext.py の check_access()。旧来のコマンド(bash の check()
関数など)から呼べるよう、このファイル名と引数を残している。

  python fulltext_check.py <テーマ>                 core のみ
  python fulltext_check.py <テーマ> --cluster all   全件
  python fulltext_check.py <テーマ> --fetch         A判定の全文XMLを保存

区分:
  A) Europe PMC が OA として全文配布しているもの(API取得可)
  B) 無料で読めるが API 取得は不可(リンクを開く)
  C) OA版が見つからない
B は権利上の理由から自動取得しない。
"""

import argparse
import sys

import fulltext


def main():
    ap = argparse.ArgumentParser(description="全文アクセス可否の一覧")
    ap.add_argument("theme", help="テーマ名・テーマのフォルダ・カタログのパスのいずれか")
    ap.add_argument("--cluster", default="core",
                    help="対象クラスタ(既定: core、all で全件)")
    ap.add_argument("--fetch", action="store_true",
                    help="A判定のものだけ全文XMLを保存する")
    args = ap.parse_args()
    try:
        fulltext.check_access(args.theme, args.cluster, args.fetch)
    except (FileNotFoundError, ValueError) as e:
        print(f"[FATAL] {e}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n[中断] 照会を中止しました。")
        sys.exit(130)


if __name__ == "__main__":
    main()
