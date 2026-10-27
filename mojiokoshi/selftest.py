"""通信せずにできる自己点検。python mojiokoshi.py selftest で走る。

API キーも通信も使わない。ffmpeg があれば、合成した音で区切り方も確かめる。
"""

import os
import shutil
import tempfile
import traceback

import asr
import audio
import config
import mojiokoshi as mj
import textproc as tp

_results = []


def check(name):
    def deco(fn):
        _results.append((name, fn))
        return fn
    return deco


@check("表記の揺れ(句読点・カタカナ・フィラー)をそろえて比べる")
def _():
    a = tp.norm("えー、今日は、ペクスを使いました。")
    b = tp.norm("今日はぺくすを使いました")
    assert a == b, (a, b)
    if tp._KAKASI is not None:
        assert tp.ratio(tp.norm("子供が来た"), tp.norm("こどもが来た")) == 1.0


@check("Parakeet の1字ごとの空白を取る・繰り返しを畳む・効果音の表記を消す")
def _():
    assert tp.clean_asr_text("き ょ う は 晴 れ") == "きょうは晴れ"
    assert tp.clean_asr_text("はい。はい。はい。はい。はい。わかりました") == "はい。はい。わかりました"
    assert tp.clean_asr_text("♪(音楽)こんにちは") == "こんにちは"


@check("用語・漢字の羅列(Parakeet の単語ブーストの暴走)を見分け、普通の文は残す")
def _():
    g = tp.Glossary.parse("山田\n東棟\n西棟\n主任")
    k = g.kanji_set()
    assert tp.junk_reason("大東棟大山田大大主任大大西棟大大", k)
    assert tp.junk_reason("大山田大大山田大山田", k)
    for ok in ("11月最終土曜日", "強度行動障害支援者養成研修", "13時半それ15時半", "山田さんが来た"):
        assert tp.junk_reason(ok, k) is None, ok
    assert tp.clean_asr_text("大山田Толедожените.はい") == "大山田はい"


@check("フィラーだけを消す(「あの人」は残す)")
def _():
    assert tp.strip_fillers("えー、あのー、あの人が、えっと来ました") == "あの人が、来ました"


@check("用語集の読み込みと直し方")
def _():
    g = tp.Glossary.parse("# メモ\n強度行動障害\nPECS(ペクス)\nぺくす、ペクス → PECS\n支援 → 行動支援\n")
    assert g.terms == ["強度行動障害", "PECS", "行動支援"], g.terms
    assert g.apply_rules("ぺくすと支援と行動支援") == "PECSと行動支援と行動支援"
    assert g.whisper_prompt().startswith("強度行動障害、PECS")


@check("どの候補にも無い言葉に〔?〕を付ける")
def _():
    asr_ns = [tp.norm("午後は散歩に行く予定です"), tp.norm("午後は散歩にいく予定です")]
    t, n = tp.mark_unsupported("午後は散歩に行く予定です。そして宇宙人が来ました。", asr_ns, [])
    assert n == 1 and config.UNCERTAIN_MARK in t, t
    t, n = tp.mark_unsupported("午後は散歩に行く予定です。", asr_ns, [])
    assert n == 0, t


@check("統合の点数: 足した言葉・落とした言葉で下がる")
def _():
    asr_ns = [tp.norm("午後は散歩に行く予定です。記録は毎日つけます")]
    cons = asr_ns[0]
    good = tp.score_merge(tp.norm("午後は散歩に行く予定です。記録は毎日つけます。"), asr_ns, cons, [])[0]
    added = tp.score_merge(tp.norm("午後は散歩に行く予定です。宇宙人も来ます。記録は毎日つけます。"), asr_ns, cons, [])[0]
    dropped = tp.score_merge(tp.norm("午後は散歩に行く予定です。"), asr_ns, cons, [])[0]
    assert good > added and good > dropped, (good, added, dropped)


@check("校正の検証: 要約・言葉の追加・記号の削除は使わない")
def _():
    src = "えー、午後は散歩に行く予定です。記録は〔?〕毎日つけてください。"
    ok, _ = mj.proof_ok(src, "午後は散歩に行く予定です。記録は〔?〕毎日つけてください。", [])
    assert ok
    assert not mj.proof_ok(src, "要するに散歩の話です。", [])[0]
    assert not mj.proof_ok(src, "午後は散歩に行く予定です。記録は毎日つけてください。", [])[0]
    assert not mj.proof_ok(src, "午後は散歩に行く予定です。記録は〔?〕毎日つけてください。夕方は買い物にも行きます。", [])[0]


@check("言葉を削った統合・校正は使わない")
def _():
    full = "午後は散歩に行く予定です。記録は毎日つけてください。夕方は買い物に行きます。"
    assert not mj.proof_ok(full, "午後は散歩に行く予定です。記録は毎日つけてください。", [])[0]
    assert mj.proof_ok("えー、" + full, full, [])[0]
    c = {"id": 0, "start": 0, "end": 30, "speech": 20, "ratio": 0.7, "silent": False}
    row = {"chunk": c, "texts": {"A": full}, "norms": {"A": tp.norm(full)}, "medoid": "A",
           "consensus": tp.norm(full), "notes": {}, "dropped": {}}
    it = {"id": 0, "h": "h"}
    merges = {"m": {"chunks": {"0": {"h": "h", "text": "午後は散歩に行く予定です。"}}}}
    ch = mj.choose({}, {0: row}, merges, [it], tp.Glossary())
    assert ch[0]["by"] == "ASR:A" and ch[0]["text"] == full, ch


@check("NVIDIA(Riva)の protobuf の組み立てと読み取り")
def _():
    g = tp.Glossary.parse("強度行動障害")
    e = dict(name="t", kind="riva", language_code="ja-JP", glossary=True)
    cfg = asr.pb_parse(asr.riva_config(e, g, 1))
    assert cfg[1] == [1] and cfg[2] == [16000] and cfg[3] == [b"ja-JP"] and cfg[8] == [1]
    ctx = asr.pb_parse(cfg[6][0])
    assert ctx[1] == ["強度行動障害".encode()] and abs(ctx[4][0] - config.RIVA_BOOST) < 1e-6
    word = asr.pb_int(1, 1500) + asr.pb_int(2, 2300) + asr.pb_str(3, "はい")
    alt = asr.pb_str(1, "は い") + asr.pb_bytes(3, word)
    res = asr.pb_bytes(1, alt)
    msg = asr.pb_bytes(1, res)
    framed = asr.grpc_frame(msg)
    assert asr.grpc_unframe(framed + framed) == [msg, msg]
    units = asr.parse_riva_results(asr.pb_parse(msg)[1])
    assert units[0]["start"] == 1.5 and units[0]["end"] == 2.3 and units[0]["text"] == "は い"


@check("Gemini の応答(単語の時刻と本文の位置)の読み取り")
def _():
    j = {"steps": [{"type": "model_output", "content": [{"type": "text", "text": "はい。そうです。", "annotations": [
        {"type": "word_info", "text": "はい", "start_offset": "0.5s", "end_offset": "0.9s", "start_index": 0},
        {"type": "word_info", "text": "そうです", "start_offset": "1.2s", "end_offset": "1.8s", "start_index": 3}]}]}]}
    text, words = asr.parse_interaction(j)
    assert text == "はい。そうです。" and words == [(0.5, 0.9, "はい。"), (1.2, 1.8, "そうです。")], words


@check("つないで送った音声の時刻を、区間ごとに振り分ける")
def _():
    grp = [{"id": 1, "start": 10.0, "end": 20.0, "speech": 8}, {"id": 2, "start": 30.0, "end": 40.0, "speech": 8}]
    layout = [(0.0, 10.0, 10.0), (10.4, 20.4, 30.0)]
    units = [{"start": 1, "end": 2, "text": "前"}, {"start": 12, "end": 13, "text": "後"}]
    out = mj.distribute(units, grp, layout)
    assert out[0][0]["text"] == "前" and out[0][0]["start"] == 11.0
    assert out[1][0]["text"] == "後" and abs(out[1][0]["start"] - 31.6) < 0.01
    out = mj.distribute([{"start": 0, "end": 20, "text": "一つ目です。二つ目です。", "timed": False}], grp, layout)
    assert out[0][0]["text"] == "一つ目です。" and out[1][0]["text"] == "二つ目です。"


@check("文の途中で切れた区間は、次の区間と同じ段落にする")
def _():
    P = [({"start": 0, "end": 40}, "午後は散歩に"), ({"start": 40, "end": 80}, "行きます。"), ({"start": 80, "end": 90}, "次。")]
    paras = mj.make_paragraphs(P)
    assert [t for _, t in paras] == ["午後は散歩に行きます。", "次。"], paras


@check("声の検出と区切り(合成した音。ffmpeg が要る)")
def _():
    if not shutil.which("ffmpeg"):
        print("    (ffmpeg が無いので飛ばした)")
        return
    with tempfile.TemporaryDirectory() as td:
        # 0〜20秒に断続音、20〜30秒は無音、30〜75秒に断続音
        expr = "+".join(f"between(t,{t},{t + 1.6})" for t in list(range(0, 20, 2)) + list(range(30, 75, 2)))
        src = os.path.join(td, "s.wav")
        audio.ffmpeg("-f", "lavfi", "-i", f"aevalsrc='0.3*sin(2*PI*220*t)*({expr})':s=16000:d=75",
                     "-f", "lavfi", "-i", "anoisesrc=color=pink:amplitude=0.005:d=75:r=16000",
                     "-filter_complex", "amix=inputs=2:normalize=0", "-ac", "1", src)
        base = os.path.join(td, "b.wav")
        audio.decode(src, base)
        lv = audio.frame_levels(base, os.path.join(td, "lv.txt"))
        vad = audio.detect_speech(lv)
        chunks = audio.make_chunks(lv, vad, audio.wav_duration(base))
        silent = [c for c in chunks if c["silent"]]
        voiced = [c for c in chunks if not c["silent"]]
        assert any(c["start"] < 25 < c["end"] for c in silent), chunks
        assert all(c["end"] - c["start"] <= config.CHUNK_MAX_SEC + 0.01 for c in voiced), chunks
        assert abs(chunks[-1]["end"] - 75) < 0.1 and chunks[0]["start"] == 0.0
        path, pcm, layout = audio.build_request_audio(base, [(c["start"], c["end"]) for c in voiced],
                                                      os.path.join(td, "r"), "flac")
        assert os.path.exists(path) and len(pcm) > 0 and len(layout) == len(voiced)


def run():
    ok = 0
    for name, fn in _results:
        try:
            fn()
            print(f"✓ {name}")
            ok += 1
        except Exception:
            print(f"✗ {name}")
            traceback.print_exc()
    print(f"\n{ok}/{len(_results)} 通過" + ("" if tp._KAKASI else "(pykakasi なし)"))
    return ok == len(_results)


if __name__ == "__main__":
    import sys
    sys.exit(0 if run() else 1)
