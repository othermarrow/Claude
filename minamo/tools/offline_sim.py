"""端末内モデル（2026 年版・1996 年版）に、台本どおりに話しかけて、やりとりを表示する。

アプリと同じ観測メモ（段階・消した文字・時刻・端末）をつけて送るので、
オフラインのときにミナモがどう答えるかを、手で打たずに確かめられる。記憶（memory.json）は汚さない。

  python ~/Claude/minamo/tools/offline_sim.py                 # 2026 年版、台本 A
  python ~/Claude/minamo/tools/offline_sim.py --version 1996 --script C
  python ~/Claude/minamo/tools/offline_sim.py --library       # 蔵書（本・Vault のノート）も使う
  python ~/Claude/minamo/tools/offline_sim.py --say "眠れない" --say "先月から" --say "あなたは誰？"
"""

import argparse
import os
import random
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import minamo                       # noqa: E402
from classic import Classic         # noqa: E402
from modern import Memory, Modern   # noqa: E402

SCRIPTS = {
    "A": ["こんばんは", "最近眠れなくて", "仕事が忙しくて、夜になると色々考えてしまう", "上司に怒られたことを思い出します",
          "別に、大したことじゃないです", "たぶん自分が悪いんだと思う", "母にも昔よく怒られていました", "わからない",
          "どうしてそんなことを聞くんですか？", "もう寝たほうがいいですか", "あなたは誰なんですか", "怖くなってきた",
          "私は私です", "誰かに見られている気がする"],
    "B": ["はい", "うん", "別に", "特にないです", "いいえ", "わからない", "はい", "そうですね", "うーん", "べつに", "眠い",
          "はい", "うん", "いや"],
    "C": ["あなたは何ができるの？", "今何時かわかる？", "ここはどこ？", "なんで私のことを知ってるの？", "質問に答えて",
          "あなたは人間？", "このアプリは誰が作ったの", "記録って何の記録？", "消したらどうなるの", "私の名前を言ってみて",
          "出口はどこ？", "あなたはどこにいるの", "もう一人いるの？", "あなたなの？"],
    "D": ["今日は楽しかった", "友達とご飯に行きました", "久しぶりに笑った気がする", "でも帰り道は少し寂しかった",
          "一人暮らしなので", "猫を飼いたいと思ってます", "子どもの頃は犬を飼ってた", "死んじゃったけど",
          "もう平気です", "ありがとう", "楽しい話をしたい", "好きな食べ物は？", "私はカレーが好き", "おやすみなさい"],
    "E": ["これゲームでしょ", "AIのくせに偉そう", "つまらない", "ははは", "……", "見ないで", "ごめん、言いすぎた",
          "本当は怖いんだと思う", "だって夜中に一人だし", "誰かに見られてる気がする", "あなたなの？", "やめて"],
    "F": ["私の名前はユウです", "最近、仕事で失敗してしまって。上司には大丈夫と言われたけど、自分ではすごく気にしています。",
          "夜になると、そのことばかり考えてしまいます。眠れなくて、朝がつらいです。", "先月から", "7", "母です",
          "母はいつも厳しい人でした。褒められた記憶がほとんどありません。", "はい", "わからないけど、たぶんそうかもしれない",
          "いまも、なんとなく見られている気がする", "私の名前を言ってみて", "眠いです", "おやすみなさい"],
}


def memo(turn, erased=0, extra=None):
    """アプリと同じ形の観測メモ。"""
    ph = minamo.PHASES[0]
    for p in minamo.PHASES:
        if turn >= p["turn"]:
            ph = p
    idx = minamo.PHASES.index(ph)
    lines = [f"- 面接段階: {ph['name']}（{idx + 1}/4）、{turn}回目"]
    if extra is None:
        lines.append("- 入力した文字数: 10")
    if erased:
        lines.append(f"- 書きかけて消した文字数: {erased}")
    if idx >= 1:
        lines.append(f"- 現在時刻: 02時{min(59, 10 + turn):02d}分（面接開始から{turn * 2}分）")
    if idx >= 2:
        lines += ["- 端末のユーザー名: u0_a245", "- 端末の機種: XQ-CT44"]
    if idx >= 3:
        lines.append("- 端末の電池: 23%")
    if extra:
        lines.append("- " + extra)
    return "【観測メモ】\n" + "\n".join(lines), idx


def main():
    ap = argparse.ArgumentParser(description="端末内モデルに台本どおり話しかけて、やりとりを見る")
    ap.add_argument("--version", choices=["2026", "1996"], default="2026")
    ap.add_argument("--script", choices=sorted(SCRIPTS), default="A",
                    help="A 眠れない会社員 / B 短い返事 / C 質問ばかり / D 楽しかった日 / E 敵意・メタ / F 名前を名のる")
    ap.add_argument("--say", action="append", help="台本の代わりに、この言葉を順に送る（何度でも）")
    ap.add_argument("--seed", type=int, help="乱数の種（同じ種なら同じ返事）")
    ap.add_argument("--library", action="store_true", help="蔵書（本・Vault のノート）も使う")
    a = ap.parse_args()
    if a.seed is not None:
        random.seed(a.seed)
    lib = minamo.load_library(minamo.LIBRARY_DIRS) if a.library else None
    karte = minamo.load_karte()
    mem = Memory(os.path.join(tempfile.mkdtemp(), "memory.json"))
    eng = Modern(karte, lib, mem) if a.version == "2026" else Classic(karte, lib)

    contents = [{"role": "user", "parts": [{"text": memo(1, extra="面接が始まった。最初のあいさつをすること。")[0]}]}]
    r = eng.ask(contents)
    contents.append({"role": "model", "parts": [{"text": r}]})
    print(f"ミナモ: {r}")
    for k, line in enumerate(a.say or SCRIPTS[a.script]):
        turn = k + 2
        erased = random.choice([0, 0, 0, 7, 12])
        m, idx = memo(turn, erased)
        text = f"{line}\n\n{m}"
        contents.append({"role": "user", "parts": [{"text": text}]})
        sending = contents
        note = minamo.library_note(lib, line, idx) if lib else ""
        if note:
            sending = contents[:-1] + [{"role": "user", "parts": [{"text": f"{text}\n\n{note}"}]}]
        r = eng.ask(sending)
        contents.append({"role": "model", "parts": [{"text": r}]})
        stage = ["導入", "解釈", "侵食", "融合"][idx]
        print(f"\n[{turn} {stage}] あなた: {line}" + (f"（消した{erased}字）" if erased else ""))
        print(f"ミナモ: {r}")
        for ev in getattr(eng, "events", []):
            if ev["type"] == "memory":
                print(f"  ◆ メモリを更新しました：{ev['text']}")


if __name__ == "__main__":
    main()
