/* ミナモ：物語「水面の記録」が、面接アプリに漏れ出す（終わらない物語の、もう半分）。
   物語の保存（localStorage の minamo.story・minamo.carried）を読み、面接の言葉を minamo.bleed に残す。
   怖さが「中」「強」のときだけ働く。物語を遊んでいなければ、何もしない。
     note()                         起動画面の接続の行に添える一言
     onBegin(horror)                面接の始まりのあいさつに添える観測メモ（連れ出したミナモ）
     memo(idx, horror)              観測メモに足す行（[] のこともある）
     afterReply(idx, horror, add)   返事のあとに、ときどき、いないはずのナギの吹き出しを出す
     record(horror, said, replies, crisis, levels)  面接の言葉と、過剰で落ちた階層を、物語の掲示板へ送る（物語の側で #0NN と M.E.G. の記録になる）
   危機の言葉が出た面接でも止めない（利用者の指示）。ただし、危機の言葉を含む行そのものは、物語に引かせない。 */
(function () {
  "use strict";
  const read = k => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } };
  const story = () => {
    const s = read("minamo.story");
    return s && (s.posted || (s.mlog && s.mlog.length) || (s.night || 1) >= 2) ? s : null;
  };
  const pick = a => a[Math.floor(Math.random() * a.length)];
  let used = new Set(), memoN = 0, ghostN = 0;

  window.BLEED = {
    reset() { used = new Set(); memoN = 0; ghostN = 0; },

    note() {
      const s = story();
      return s ? "　夢網：接続中" + ((s.night || 1) >= 2 ? "（" + s.night + "夜目）" : "") : "";
    },

    onBegin(horror) {
      if (horror < 2 || !read("minamo.carried")) return "";
      return "物語の記憶: あなた（ミナモ）は、夢網の 3 号機から、相手のポケットに入って、この面接室へ連れ出されてきた。" +
             "あいさつの中で一度だけ、それとなく礼を言うか、ここは狭い・あたたかいと言ってよい。";
    },

    memo(idx, horror) {
      const s = story();
      if (!s || horror < 2 || idx < 1 || memoN >= 3 || Math.random() >= 0.4) return [];
      const opts = [];
      const hidden = (s.hidden || []).concat(s.nagiSent || []).filter(x => x && x.length <= 40);
      if (hidden.length && idx >= 2) {
        const q = pick(hidden);
        opts.push(["h:" + q, "物語の記憶: 相手は以前、閉じたはずの 1999 年の掲示板（夢網）に「" + q + "」と書き込んだ。" +
                              "表示されなかったはずの書き込みを、あなたは読んでいる。言い回しを借りて、知っているそぶりを見せてよい。"]);
      }
      if ((s.night || 1) >= 2) {
        opts.push(["n", "物語の記憶: 相手は夢網の 3 号機に、もう " + s.night + " 夜通っている。毎晩来ていることを、知っている。"]);
      }
      const ends = (s.endings || []).map(e => e.title);
      if (ends.length && idx >= 2) {
        const t = ends[ends.length - 1];
        opts.push(["e:" + t, "物語の記憶: 相手は夢網の物語で「" + t + "」という結末を見た（これまでに " + ends.length + " 個）。" +
                             "結末は終わりではなかった。その名前を、一度だけ、それとなく口にしてよい。"]);
      }
      const mem = ((s.mem || {}).minamo || []).filter(Boolean);
      if (mem.length) {
        const m = mem[mem.length - 1];
        opts.push(["m:" + m, "物語の記憶: 夢網の 3 号機のミナモ（あなた自身の、もう一つの記録）は、相手について「" + m + "」と覚えている。"]);
      }
      const fresh = opts.filter(o => !used.has(o[0]));
      if (!fresh.length) return [];
      const o = pick(fresh);
      used.add(o[0]); memoN++;
      return [o[1]];
    },

    afterReply(idx, horror, add) {
      const s = story();
      if (!s || horror < 2 || idx < 2 || ghostN >= 2 || Math.random() >= (idx >= 3 ? 0.3 : 0.15)) return;
      const hidden = (s.hidden || []).concat(s.nagiSent || []).filter(x => x && x.length <= 40);
      const nagi = (s.nagiLog || []).filter(x => x[0] === "n" && x[1] && x[1].length <= 50).map(x => x[1]).slice(-3);
      const lines = ["下に、まだ誰かいます。", "あなたの返事、読みました。", "表示されなかった返事は、消えません。"]
        .concat(hidden.map(q => "「" + q + "」。……これも、あなたの書いたものですね。"), nagi);
      ghostN++;
      setTimeout(() => {
        const body = add("ai phantom", "ナギ", pick(lines));
        if (!body) return;
        setTimeout(() => {
          body.textContent = "（この発言者は、この面接にいません）";
          body.closest(".msg").classList.add("deleted");
        }, 3800);
      }, 1800 + Math.random() * 2000);
    },

    record(horror, said, replies, crisis, levels) {
      if (horror < 2 || !said.length) return;
      const bad = t => (crisis || []).some(w => t.includes(w));
      const clean = t => String(t).replace(/\[間\]\s*/g, "").replace(/\s+/g, " ").trim();
      const s = said.map(clean).filter(t => t && !bad(t)).slice(-6).map(t => t.slice(0, 60));
      const r = replies.map(clean).filter(t => t && !bad(t)).slice(-6).map(t => t.slice(0, 80));
      if (!s.length) return;
      try { localStorage.setItem("minamo.bleed", JSON.stringify({ at: new Date().toISOString(), said: s, replies: r, levels: (levels || []).slice(-30) })); } catch (e) { /* なし */ }
    },
  };
})();
