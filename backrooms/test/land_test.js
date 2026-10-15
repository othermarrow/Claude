// 横向きの画面を確かめる（Xperia 1 IV を横にしたときの大きさ 960×411）
const { chromium } = require('playwright');
const path = require('path');
const OUT = process.env.SHOTS || path.join(__dirname, 'shots');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 960, height: 411 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  let fail = 0; const ok = (c, m) => { console.log((c ? 'ok: ' : 'NG: ') + m); if (!c) fail++; };
  page.on('pageerror', e => errors.push(e.message + '\n' + e.stack));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('file://' + path.join(__dirname, '..', 'backrooms.html'));
  await page.evaluate(() => localStorage.clear());
  await page.reload(); await page.waitForTimeout(400);
  const ev = (f, a) => page.evaluate(f, a);
  const shot = n => page.screenshot({ path: path.join(OUT, n + '.png') });
  // 重ねる画面が、スクロールしなくても全部見えて、いちばん下のボタンが押せるか
  const fits = async (name, scroll) => {
    await page.waitForTimeout(120);
    const r = await ev(() => {
      const p = document.querySelector('#ov .panel'), bs = [...p.querySelectorAll('button')], last = bs[bs.length - 1];
      const rc = last.getBoundingClientRect(), hit = document.elementFromPoint(rc.left + rc.width / 2, rc.top + rc.height / 2);
      return { sh: p.scrollHeight, ch: p.clientHeight, bottom: rc.bottom, vh: innerHeight, hit: hit === last || last.contains(hit), label: last.innerText.split('\n')[0] };
    });
    if (scroll) ok(r.sh > r.ch, `${name}：長いので、中をスクロールして読む（${r.sh}/${r.ch}）`);
    else ok(r.sh <= r.ch + 1 && r.bottom <= r.vh && r.hit, `${name}：画面に収まり「${r.label}」が押せる（${r.sh}/${r.ch}）`);
    return r;
  };
  await fits('タイトル'); await shot('l01_title');
  await ev(() => document.querySelector('[data-k="more"]').click()); await fits('ほかの版');
  await ev(() => showSettings(showTitle)); await fits('設定（タイトルから）'); await shot('l02_settings');
  await ev(() => showHow(showTitle)); await fits('遊び方', true);
  await ev(() => { S = newState('normal'); enterLevel(0, true); saveGame(); showTitle(); }); await fits('タイトル（つづきあり）');
  await ev(() => showIntro()); await fits('はじまりの文');
  await ev(() => showCard(0)); await fits('層の札');
  await ev(() => { startPlay(); S.a = 0.4; }); await page.waitForTimeout(200); await shot('l03_play');
  ok(await ev(() => RD.W > RD.H && RD.pl > 1), `横向きの視野が広い（${await ev(() => Math.round(Math.atan(RD.pl) * 360 / Math.PI))}°）`);
  // 遠くの壁の高さが、画面の高さに対してどれくらいか（横向きで壁が画面を埋めつくさない）
  ok(await ev(() => WH * RD.vs / 2 < RD.H), '2マス先の壁は、画面の高さに収まる');
  await ev(() => { S.notes = [0, 1, 2, 3, 4, 5, 6, 7]; showPause(); }); await fits('一時停止'); await shot('l04_pause');
  await ev(() => showSettings(showPause)); await fits('設定（一時停止から）');
  await ev(() => showNotes(showPause)); await fits('拾ったメモ（8枚）', true);
  await ev(() => { startPlay(); gameOver('wander'); }); await fits('捕まった');
  for (const m of ['self', 'yagi']) {
    await ev(md => { S = newState(md); enterLevel(4, true); startPlay(); DBG.toExit(); update(0.01); enterExit(); finishTrans(); }, m);
    await fits(`エンディング（${m}）`);
  }
  await ev(() => { S = newState('hard'); enterLevel(0, true); startPlay(); gameOver('wander'); }); await fits('救いのない版の終わり');
  // 線だけ・怪物
  await ev(() => { OPT.wire = 1; S = newState('normal'); enterLevel(1, true); startPlay(); S.a = 0; S.flash = true; let ex = S.x + 2.5, ey = S.y; if (blocked(ex, ey)) { ex = S.x; ey = S.y + 2.5; S.a = Math.PI / 2; } G.ents = [{ type: 'wander', x: ex, y: ey, st: 'wander', tgt: null, next: null, repath: 0, lost: 0, stepT: 0, sndT: 1, burn: 0 }]; G.spawn = {}; });
  await page.waitForTimeout(250); await shot('l05_wire_monster');
  await ev(() => { OPT.wire = 0; G.ents = []; });
  // 遊んでいる途中で、縦 → 横 → 縦に回す
  await page.setViewportSize({ width: 411, height: 960 }); await page.waitForTimeout(500);
  ok(await ev(() => RD.H > RD.W && Math.abs(RD.vs - RD.W / RD.pl) < 1e-6), '縦にすると、縦向きの描き方に戻る');
  await page.setViewportSize({ width: 960, height: 411 }); await page.waitForTimeout(500);
  ok(await ev(() => RD.W > RD.H && G.mode === 'play'), '横に戻しても、そのまま遊べる');
  const ms = await ev(() => { const t0 = performance.now(); for (let i = 0; i < 20; i++) renderFrame(G.t, S, sprites(), frameFx()); return (performance.now() - t0) / 20; });
  ok(ms < 20, `横向きの描画は1フレーム ${ms.toFixed(1)}ms`);
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'エラーなし');
  await browser.close();
  process.exit(errors.length || fail ? 1 : 0);
})().catch(e => { console.log('例外:', e.message); process.exit(1); });
