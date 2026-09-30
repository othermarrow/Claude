"""LLMの応答からJSONのレコード配列を取り出す。

厳密な json.loads は応答全体が正しいJSONであることを要求するため、
本体は正しく書けているのに前後に余計なものが付いただけで全滅する。
実測した失敗の大半はこの型だった。

  [{...}]\\n]                     末尾に余分な閉じ括弧
  [{...}]}                        同上
  [{...}]\\n[{...}]               同じ配列を2回出力
  [{...}], [{...}]                同上(カンマ区切り)
  [{...}]\\n\\nNote: Only one ... JSONの後ろに英語の説明文
  [{...}]\\nfalse: 対象外分野...   JSONの後ろに崩れた続き

いずれも先頭の完全なJSON値だけを読めば救える。読めない場合でも、
完結している {...} を1件ずつ拾えば、途中で切れた応答から手前の分だけ
回収できる。6件のバッチが1件の破損で全滅するのを防ぐのが目的。

なお「応答が閉じ括弧なしで終わっている＝max_tokens不足」という従来の
診断は、上記の型では誤診になる。JSONは完結していて、その後ろに
余計なものが付いているだけだからである。
"""

import json
import re

_FENCE_RE = re.compile(r"```(?:json)?", re.IGNORECASE)


def _clean(raw: str) -> str:
    return _FENCE_RE.sub("", raw or "").strip()


def _as_records(value) -> list:
    """JSON値をレコードの配列にそろえる。単一オブジェクトも1件の配列とみなす。"""
    if isinstance(value, list):
        return [v for v in value if isinstance(v, dict)]
    if isinstance(value, dict):
        return [value]
    return []


def _salvage_objects(s: str) -> list:
    """完結している {...} を先頭から順に拾う。文字列の中の括弧は数えない。"""
    out, depth, start, in_str, esc = [], 0, None, False, False
    for i, ch in enumerate(s):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            if depth:
                depth -= 1
                if depth == 0 and start is not None:
                    try:
                        v = json.loads(s[start:i + 1])
                    except ValueError:
                        v = None
                    if isinstance(v, dict):
                        out.append(v)
                    start = None
    return out


def parse_json_array(raw: str):
    """応答からレコードの配列を取り出す。戻り値は (records, mode)。

    mode は記録用で、次の値を取る。
      strict  … 応答全体がそのままJSONだった
      prefix  … 先頭のJSONだけを読み、後ろの余分を捨てた
      salvage … 完結しているオブジェクトだけを拾った(途中で切れた応答)
      empty   … 応答が空
      fail    … 読み取れなかった
    records が空なら読み取れなかったということ。
    """
    s = _clean(raw)
    if not s:
        return [], "empty"

    try:
        recs = _as_records(json.loads(s))
        if recs:
            return recs, "strict"
    except ValueError:
        pass

    # 先頭の完全なJSON値だけを読む。後ろに何が付いていても無視する。
    dec = json.JSONDecoder()
    truncated_array = False
    for opener in ("[", "{"):
        i = s.find(opener)
        if i < 0:
            continue
        try:
            value, _ = dec.raw_decode(s, i)
        except ValueError:
            # 配列を開いたのに閉じられない＝応答が途中で切れている。
            truncated_array = truncated_array or opener == "["
            continue
        recs = _as_records(value)
        if not recs:
            continue
        if not truncated_array:
            return recs, "prefix"
        # 途中で切れた配列では、先頭の {…} を1件読んで打ち切ると、その後ろに
        # 完結して並んでいるオブジェクトを取りこぼす。実測: 6件バッチが2件目の
        # 途中で切れた応答から1件しか回収できず、残り5件が未判定になっていた。
        salvaged = _salvage_objects(s)
        if len(salvaged) > len(recs):
            return salvaged, "salvage"
        return recs, "prefix"

    recs = _salvage_objects(s)
    if recs:
        return recs, "salvage"
    return [], "fail"


def index_records(records: list, batch_size: int) -> dict:
    """レコードを index → レコード の辞書にする。

    index が欠けている、文字列になっている、といった応答が実測であった。
    1件だけの応答で index が無い場合は 0 とみなす(再判定は1件ずつ投げる
    ため、この形が出やすい)。

    件数がバッチと一致し、どのレコードにも index が無い場合は、出力順が
    入力順と同じだとみなして位置で対応づける。以前は batch_size == 1 の
    ときしか救えず、6件バッチで index を省いた「JSONとしては完全に正しい
    応答」が返ると6件とも未判定になっていた。判定の指示は必ず index を
    書かせているが、守られないことがある。
    """
    if (records and len(records) == batch_size
            and not any("index" in r for r in records)):
        return dict(enumerate(records))

    m = {}
    for r in records:
        if "index" not in r and len(records) == 1 and batch_size == 1:
            m[0] = r
            continue
        try:
            m[int(r["index"])] = r
        except (KeyError, TypeError, ValueError):
            continue
    return m
