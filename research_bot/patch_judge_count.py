"""判定の応答が毎回1件少ない(6件中5件)問題を直す。judge.py のみ対象。

実測: nemotron-3-super は6件を渡すと index 0〜4 の5件で配列を閉じる。
プロンプトに「ちょうどN件、index 0〜N-1」と明記すると6件そろった
(guided_json は config で無効なので、効いたのはプロンプトの一文)。
guided_json を有効にしたときにも件数が守られるよう、スキーマにも
minItems / maxItems を入れておく。

  python patch_judge_count.py          試行のみ
  python patch_judge_count.py --apply  実際に書き込む
"""
import os, shutil, sys

TARGET = "judge.py"
MARKER = "_count_note(len(batch))"

OLD = '''    prompt = FILTER_PROMPT.format(topic=topic, definition=definition,
                                  homonym_note=hom, listing=_listing(batch))
    raw = ""
    for attempt in range(config.JUDGE_BATCH_RETRIES + 1):
        raw = llm.ask(prompt, model, schema=FILTER_SCHEMA, max_tokens=max_tokens)'''

NEW = '''    prompt = FILTER_PROMPT.format(topic=topic, definition=definition,
                                  homonym_note=hom, listing=_listing(batch))
    prompt += _count_note(len(batch))
    # guided_json を使う場合にも件数を強制する(使わない場合は無害)
    schema = dict(FILTER_SCHEMA, minItems=len(batch), maxItems=len(batch))
    raw = ""
    for attempt in range(config.JUDGE_BATCH_RETRIES + 1):
        raw = llm.ask(prompt, model, schema=schema, max_tokens=max_tokens)'''

OLD2 = '''def judge_batch(batch, topic, definition, hom, model, max_tokens=None):'''
NEW2 = '''def _count_note(n: int) -> str:
    """件数をプロンプトの末尾で明示する。

    実測: nemotron-3-super は件数の明示が無いと、6件のバッチで最後の1件を
    書かずに配列を閉じた(毎回 index 0〜4)。再送しても同じで、全バッチの
    6件目が未判定になっていた。この一文で6件そろうことを確かめてある。
    """
    return (f"\\n\\nThere are exactly {n} candidate papers (index 0 to {n - 1}). "
            f"Your array must contain exactly {n} entries.")


def judge_batch(batch, topic, definition, hom, model, max_tokens=None):'''


def main():
    apply = "--apply" in sys.argv
    if not os.path.exists(TARGET):
        print(f"{TARGET} が見つかりません。同じフォルダで実行してください。")
        return
    text = open(TARGET, encoding="utf-8").read()
    if MARKER in text:
        print("適用済みです。何もしません。")
        return
    for old in (OLD, OLD2):
        c = text.count(old)
        if c != 1:
            print(f"目印が{c}回見つかりました(1回であるべき)。書き込みません。")
            print("  先頭: " + old.splitlines()[0][:70])
            return
    text = text.replace(OLD, NEW, 1).replace(OLD2, NEW2, 1)
    try:
        compile(text, TARGET, "exec")
    except SyntaxError as e:
        print(f"置換後の構文が壊れています: {e.msg} ({e.lineno}行目)。書き込みません。")
        return
    if not apply:
        print("問題ありません。書き込むには --apply を付けて再実行してください。")
        return
    bak = TARGET + ".count.bak"
    if not os.path.exists(bak):
        shutil.copy2(TARGET, bak)
        print(f"控えを作りました: {bak}")
    open(TARGET, "w", encoding="utf-8").write(text)
    print(f"書き込みました: {TARGET}")


if __name__ == "__main__":
    main()
