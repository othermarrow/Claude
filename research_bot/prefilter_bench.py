#!/usr/bin/env python3
# prefilter_bench.py — 1段目候補モデルの速度と判定を同条件で比べる
import os, sys, time
from openai import OpenAI
import prefilter as pf

MODELS = sys.argv[1:] or [
    "openai/gpt-oss-20b",
    "z-ai/glm-5.3-flash",
    "meta/llama-3.3-70b-instruct",
    "nvidia/nemotron-3-super-120b-a12b",
]
TIMEOUT = float(os.environ.get("BENCH_TIMEOUT", "300"))
THEME = "強度行動障害のある成人に対する構造化支援の効果"
PAPERS = [
    ("Structured teaching for adults with autism and severe challenging "
     "behavior in residential settings",
     "We examined the effects of structured teaching on aggression and "
     "self-injury among adults living in a residential facility."),
    ("視覚的スケジュールが知的障害者の行動問題に与える影響",
     "入所施設で暮らす成人の知的障害者を対象に、視覚的スケジュールの"
     "導入前後で行動問題の頻度を比較した。"),
    ("Corrosion resistance of stainless steel welds in marine environments",
     "Weld samples were exposed to seawater for 12 months."),
    ("Nitrogen fertilization and rice yield in paddy fields",
     "Field trials were conducted across three seasons."),
    ("Sleep problems in adults with autism", ""),
]
EXPECT = "in in off off maybe/in"

client = OpenAI(base_url=pf.BASE_URL, api_key=os.environ["NVIDIA_API_KEY"],
                timeout=TIMEOUT, max_retries=0)
parts = [f"【テーマ】\n{THEME}\n\n【文献】"]
for n, (t, a) in enumerate(PAPERS, 1):
    parts.append(f"[{n}] {t}\n{a or '(抄録なし)'}")
PROMPT = "\n\n".join(parts)

for model in MODELS:
    print(f"\n=== {model}")
    for effort in ("low", None):
        label = f"effort={effort or 'なし'}"
        kw = dict(model=model, temperature=0, max_tokens=pf.MAX_TOKENS,
                  messages=[{"role": "system", "content": pf.SYSTEM_PROMPT},
                            {"role": "user", "content": PROMPT}])
        if effort:
            kw["reasoning_effort"] = effort
        t0 = time.time()
        try:
            res = client.chat.completions.create(**kw)
        except Exception as e:
            status = getattr(e, "status_code", None)
            body = getattr(e, "body", None) or e
            print(f"  {label}: 失敗 {time.time() - t0:.0f}秒 status={status} "
                  f"{str(body)[:200]}")
            if status == 400 and effort:
                continue   # パラメータ拒否 → 付けずに再測定
            break
        ch, u = res.choices[0], res.usage
        det = getattr(u, "completion_tokens_details", None) if u else None
        rt = getattr(det, "reasoning_tokens", None)
        got = pf._parse(ch.message.content)
        v = " ".join(got.get(i, "-") for i in range(1, len(PAPERS) + 1))
        print(f"  {label}: {time.time() - t0:.1f}秒 "
              f"出力{u.completion_tokens if u else '?'}tok"
              f"(うち思考{rt if rt is not None else '?'}) "
              f"finish={ch.finish_reason}")
        print(f"    判定: {v}   (期待: {EXPECT})")
        if not got:
            print(f"    本文先頭: {(ch.message.content or '')[:200]!r}")
        break
