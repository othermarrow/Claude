// 怪物の動きと、正気・渇き・電池の減り方を確かめる
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 411, height: 890 }, isMobile: true, hasTouch: true })).newPage();
  const errors = [];
  let fail = 0; const ok = (c, m) => { console.log((c ? 'ok: ' : 'NG: ') + m); if (!c) fail++; };
  page.on('pageerror', e => errors.push(e.message + '\n' + e.stack));
  await page.goto('file://' + path.join(__dirname, '..', 'backrooms.html'));
  await page.evaluate(() => localStorage.clear());
  const ev = (f, a) => page.evaluate(f, a);
  // ゲームを始めて、ゲーム内の時間を早回しする関数を用意
  await ev(() => {
    S = newState(); enterLevel(0, true); startPlay();
    window.sim = (sec, each) => { for (let t = 0; t < sec; t += 0.033) { if (G.mode === 'note') startPlay(); if (G.mode !== 'play') return G.mode; update(0.033); if (each) each(); } if (G.mode === 'note') startPlay(); return G.mode; };
    window.put = (type, d, ang) => {
      const a = S.a + (ang || 0);
      for (let k = d; k > 1; k -= 0.5) { const x = S.x + Math.cos(a) * k, y = S.y + Math.sin(a) * k; if (!isWall(Math.floor(x), Math.floor(y)) && lineOfSight(S.x, S.y, x, y) && (type !== 'grin' || lightAt(x, y) < 0.3)) { G.ents.push({ type, x, y, st: 'wander', tgt: null, next: null, repath: 0, lost: 0, stepT: 0, sndT: 1, burn: 0 }); return k; } }
      return 0;
    };
    window.goDark = () => {   // 近くの暗いマスへ移る（テスト用）
      for (let r = 1; r < 20; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = Math.floor(S.x) + dx, y = Math.floor(S.y) + dy;
        if (isWall(x, y)) continue;
        let ok = true; for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) if (lightAt(x + i + 0.5, y + j + 0.5) > 0.2) ok = false;
        if (ok) { S.x = x + 0.5; S.y = y + 0.5; refreshCaches(S.x, S.y); updateLight(G.t); return lightAt(S.x, S.y); }
      }
      return -1;
    };
    window.freeDir = () => { let best = 0, bd = 0; for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; let d = 0; while (d < 12 && !isWall(Math.floor(S.x + Math.cos(a) * d), Math.floor(S.y + Math.sin(a) * d))) d += 0.25; if (d > bd) { bd = d; best = a; } } S.a = best; return bd; };
  });
  // 1) 徘徊者：見えるところにいれば追ってきて、捕まる
  console.log('  見通し', await ev(() => freeDir()));
  const d0 = await ev(() => put('wander', 6));
  ok(d0 > 2, `徘徊者を ${d0} マス先に置いた`);
  const r1 = await ev(() => sim(12));
  ok(r1 === 'over', '立ち止まっていると捕まる（' + r1 + '）');
  // 2) 走って逃げれば、距離が開く
  await ev(() => { restartLevel(); startPlay(); G.ents = []; freeDir(); });
  await ev(() => { S.a += Math.PI; put('wander', 4, 0); S.a -= Math.PI; });   // 背中側
  await ev(() => { G.ents.forEach(e => { e.x = S.x - Math.cos(S.a) * 4; e.y = S.y - Math.sin(S.a) * 4; }); });
  const res2 = await ev(() => {
    G.keys.w = true; G.run = true;
    const m = sim(1.6, () => { if (G.mode === 'play') { const d = freeDirAhead(); } });
    G.keys.w = false; G.run = false;
    const e = G.ents[0];
    return { m, d: e ? Math.hypot(e.x - S.x, e.y - S.y) : 99 };
    function freeDirAhead() { const a = S.a; if (isWall(Math.floor(S.x + Math.cos(a) * 0.8), Math.floor(S.y + Math.sin(a) * 0.8))) freeDir(); }
  });
  ok(res2.m === 'play', `走って逃げる間は捕まらない（距離 ${res2.d.toFixed(1)}）`);
  // 3) 笑う闇：暗がりで寄ってくる、ライトを向けると逃げて消える
  await ev(() => { enterLevel(3, true); startPlay(); G.ents = []; G.spawn = { grin: 1e9, wander: 1e9 }; });
  const dark = await ev(() => goDark());
  console.log('  第3層のスタートの明るさ', dark.toFixed(2));
  let placed = 0, g1 = -1;
  for (let k = 0; k < 6 && !(placed >= 4 && g1 >= 1 && g1 < placed - 0.5); k++) {
    placed = await ev(() => { if (G.mode !== 'play') startPlay(); G.ents = []; goDark(); freeDir(); return put('grin', 6); });
    g1 = await ev(() => { S.flash = false; sim(0.6); const e = G.ents[0]; return e ? Math.hypot(e.x - S.x, e.y - S.y) : -1; });
  }
  ok(placed > 0 && g1 >= 0 && g1 < placed - 0.5, `笑う闇が暗がりで近づく（${placed} → ${g1.toFixed(1)}）`);
  await ev(() => { const e = G.ents[0]; if (e) S.a = Math.atan2(e.y - S.y, e.x - S.x); S.flash = true; S.bat = 100; });
  const g2 = await ev(() => {
    const e0 = G.ents[0], d0 = e0 ? Math.hypot(e0.x - S.x, e0.y - S.y) : 0;
    sim(0.6, () => { const e = G.ents[0]; if (e) S.a = Math.atan2(e.y - S.y, e.x - S.x); });
    const e1 = G.ents[0];
    return { m: G.mode, st: e1 ? e1.st : 'gone', d0: +d0.toFixed(1), d1: e1 ? +Math.hypot(e1.x - S.x, e1.y - S.y).toFixed(1) : 99 };
  });
  ok(g2.m === 'play' && (g2.st === 'flee' || g2.st === 'gone') && g2.d1 >= g2.d0, `ライトを当てると逃げる（${JSON.stringify(g2)}）`);
  await ev(() => { G.ents = []; });
  // 4) 正気・渇き・電池
  const st = await ev(() => { if (G.mode !== 'play') startPlay(); goDark(); G.ents = []; G.spawn = { grin: 1e9, wander: 1e9 }; S.flash = false; S.san = 100; S.thirst = 100; const m = sim(60); return { m, san: S.san, th: S.thirst, lh: lightAt(S.x, S.y) }; });
  console.log('  ', JSON.stringify(st));
  ok(st.san < 90 && st.san > 50, `暗い所に60秒いると正気が減る（${st.san.toFixed(0)}）`);
  ok(st.th < 96, `渇きが進む（${st.th.toFixed(1)}）`);
  const bt = await ev(() => { S.flash = true; S.bat = 100; S.spare = 1; sim(250); return { bat: S.bat, spare: S.spare, flash: S.flash }; });
  ok(bt.spare === 0 && bt.bat > 50, `電池が切れると予備に替わる（${JSON.stringify(bt)}）`);
  // 5) 第4層では正気が戻る
  const calm = await ev(() => { enterLevel(4, true); startPlay(); S.san = 40; sim(20); return S.san; });
  ok(calm > 45, `白いタイルの部屋で正気が戻る（${calm.toFixed(0)}）`);
  // 6) 出現：第1層では、そのうち徘徊者が現れる
  const sp = await ev(() => { enterLevel(1, true); startPlay(); G.spawn.wander = 0.1; sim(1); return G.ents.length; });
  ok(sp === 1, '第1層で徘徊者が現れる');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'エラーなし');
  await browser.close();
  process.exit(errors.length || fail ? 1 : 0);
})().catch(e => { console.log('例外:', e.message); process.exit(1); });
