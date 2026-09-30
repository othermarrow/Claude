"""prefilter.py の2つの不具合を直す。

1. 抄録を読めていない(実測: 1370件すべて)
   収集側は抄録を "content" に入れているが、prefilter は
   "abstract" / "abs" / "summary" しか見ていなかった。タイトルだけで
   off を付けていたことになる。"content" を最初に見るようにする。
2. レート制限(429)で束ごと諦める
   並列6本・再試行は5秒と10秒の2回だけで、束が次々「全件通過扱い」に
   なっていた。既定の並列を3本に下げ、llm.py の送信間隔の制御
   (REQUESTS_PER_MINUTE)を共有し、429 は 10→20→40→80秒と待つ。

  python patch_prefilter.py          試行のみ
  python patch_prefilter.py --apply  実際に書き込む
"""
import os, shutil, sys

TARGET = "prefilter.py"

# (置換前, 置換後, 適用済みの目印, 見つかるべき回数)
PATCHES = [
    ('"abstract", "abs", "summary")',
     '"content", "abstract", "abs", "summary")',
     '"content", "abstract", "abs", "summary")', 3),

    ('CONCURRENCY = int(os.environ.get("PREFILTER_CONCURRENCY", "6"))',
     'CONCURRENCY = int(os.environ.get("PREFILTER_CONCURRENCY", "3"))',
     '"PREFILTER_CONCURRENCY", "3"', 1),

    ('RETRIES = 3\n',
     'RETRIES = int(os.environ.get("PREFILTER_RETRIES", "5"))\n',
     '"PREFILTER_RETRIES"', 1),

    ('''        if EFFORT and _effort_ok:
            kw["reasoning_effort"] = EFFORT
        try:''',
     '''        if EFFORT and _effort_ok:
            kw["reasoning_effort"] = EFFORT
        if not _throttle():
            return ""
        try:''',
     'if not _throttle():', 1),

    ('''            if status in (429, 500, 502, 503, 504) and attempt < RETRIES:
                wait = 5 * attempt''',
     '''            if status in (429, 500, 502, 503, 504) and attempt < RETRIES:
                # 429 は短い間隔で送り直すほど長引くので、倍々で待つ
                wait = 10 * 2 ** (attempt - 1) if status == 429 else 5 * attempt''',
     'wait = 10 * 2 ** (attempt - 1)', 1),

    ('''def _parse(text):''',
     '''def _throttle():
    """llm.py の送信間隔の制御(全スレッド合計で REQUESTS_PER_MINUTE 以下)を共有する。

    prefilter は独自に API を呼んでおり、この制御を通っていなかったため、
    並列で一斉に送って 429 を連発していた。llm を読み込めない環境
    (prefilter_bench.py を単体で動かす等)では制御なしで続ける。
    """
    try:
        import llm
    except Exception:
        return True
    return llm._throttle()


def _parse(text):''',
     'def _throttle():', 1),
]


def main():
    apply = "--apply" in sys.argv
    if not os.path.exists(TARGET):
        print(f"{TARGET} が見つかりません。同じフォルダで実行してください。")
        return
    text = open(TARGET, encoding="utf-8").read()
    notes, errors = [], []
    for i, (old, new, marker, want) in enumerate(PATCHES, 1):
        if marker in text:
            notes.append(f"  {i}. 適用済み(飛ばします)")
            continue
        c = text.count(old)
        if c != want:
            errors.append(f"  {i}. 目印が{c}回見つかりました({want}回であるべき)。"
                          f"先頭: {old.splitlines()[0][:60]}")
            continue
        text = text.replace(old, new)
        notes.append(f"  {i}. 置換しました")
    try:
        compile(text, TARGET, "exec")
    except SyntaxError as e:
        errors.append(f"  置換後の構文が壊れています: {e.msg} ({e.lineno}行目)")
    print(f"[{TARGET}]")
    print("\n".join(notes))
    if errors:
        print("失敗した箇所があるため、何も書き込みませんでした。")
        print("\n".join(errors))
        return
    if not apply:
        print("問題ありません。書き込むには --apply を付けて再実行してください。")
        return
    bak = TARGET + ".fix.bak"
    if not os.path.exists(bak):
        shutil.copy2(TARGET, bak)
        print(f"控えを作りました: {bak}")
    open(TARGET, "w", encoding="utf-8").write(text)
    print(f"書き込みました: {TARGET}")


if __name__ == "__main__":
    main()
