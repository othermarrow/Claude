// 線だけの見た目（ウィザードリィ風）を確かめる
const { chromium } = require('playwright');
const path = require('path');
const OUT = process.env.SHOTS || path.join(__dirname, 'shots');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 411, height: 890 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
  const errors = [];
  let fail = 0; const ok = (c, m) => { console.log((c ? 'ok: ' : 'NG: ') + m); if (!c) fail++; };
  page.on('pageerror', e => errors.push(e.message + '\n' + e.stack));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('file://' + path.join(__dirname, '..', 'backrooms.html'));
  await page.evaluate(() => localStorage.clear());
  await page.reload(); await page.waitForTimeout(400);
  const ev = (f, a) => page.evaluate(f, a);
  const shot = n => page.screenshot({ path: path.join(OUT, n + '.png') });
  const click = async label => { const bs = await page.$$('#ov button'); const tx = []; for (const b of bs) tx.push(await b.innerText()); let i = tx.findIndex(t => t.split('\n')[0].trim() === label); if (i < 0) i = tx.findIndex(t => t.includes(label)); if (i >= 0) { await bs[i].click(); await page.waitForTimeout(80); return; } throw new Error('ボタンなし ' + label); };
  // 画面の明るさ：黒い所の割合と、平均
  const stats = () => ev(() => { const d = RD.ctx.getImageData(0, 0, RD.W, RD.H).data; let blk = 0, sum = 0; for (let i = 0; i < d.length; i += 4) { const v = d[i] + d[i + 1] + d[i + 2]; sum += v; if (v < 40) blk++; } return { black: blk / (d.length / 4), mean: sum / (d.length / 4) / 3 }; });

  // 設定で切りかえる
  await click('設定');
  await click('見た目');
  ok(await ev(() => OPT.wire === 1 && JSON.parse(localStorage.getItem(OPT_KEY)).wire === 1), '設定の「見た目」で線だけになり、保存される');
  await shot('w00_settings');
  await click('戻る');
  await page.waitForTimeout(300);
  const ts = await stats();
  ok(ts.black > 0.6, `タイトルの後ろも線だけ（黒い所 ${(ts.black * 100).toFixed(0)}%）`);
  await shot('w01_title');

  // 5つの層
  await click('はじめから'); await click('進む'); await click('進む');
  for (let lv = 0; lv < 5; lv++) {
    await ev(n => { enterLevel(n, true); startPlay(); S.a = 0.4; S.flash = n === 3; }, lv);
    await page.waitForTimeout(250);
    const st = await stats();
    ok(st.black > 0.5 && st.mean > 1, `第${lv}層：黒い画面に線（黒い所 ${(st.black * 100).toFixed(0)}%・平均 ${st.mean.toFixed(1)}）`);
    await shot(`w1${lv}_level`);
  }
  // 出口の前
  await ev(() => { enterLevel(0, true); startPlay(); DBG.toExit(); const e = WD.exit; S.x -= Math.cos(S.a) * 1.2; S.y -= Math.sin(S.a) * 1.2; if (blocked(S.x, S.y)) { DBG.toExit(); } });
  await page.waitForTimeout(250);
  await shot('w20_exit');
  // 怪物と、拾う物
  await ev(() => { enterLevel(1, true); startPlay(); S.a = 0; S.flash = true; let ex = S.x + 2.5, ey = S.y; if (blocked(ex, ey)) { ex = S.x; ey = S.y + 2.5; S.a = Math.PI / 2; } G.ents = [{ type: 'wander', x: ex, y: ey, st: 'wander', tgt: null, next: null, repath: 0, lost: 0, stepT: 0, sndT: 1, burn: 0 }]; G.spawn = {}; });
  await page.waitForTimeout(250);
  await shot('w21_monster');
  await ev(() => { enterLevel(0, true); startPlay(); G.ents = []; const it = nearbyItems()[0]; if (it) { S.x = it.x - Math.cos(0.3) * 2; S.y = it.y - Math.sin(0.3) * 2; S.a = 0.3; if (blocked(S.x, S.y)) { S.x = it.x - 1.5; S.y = it.y; S.a = 0; } } });
  await page.waitForTimeout(250);
  await shot('w22_item');
  // 速さ
  const ms = await ev(() => { const t0 = performance.now(); for (let i = 0; i < 30; i++) renderFrame(G.t, S, sprites(), frameFx()); return (performance.now() - t0) / 30; });
  ok(ms < 20, `線だけの描画は1フレーム ${ms.toFixed(1)}ms`);
  // 元に戻す
  await ev(() => { OPT.wire = 0; G.needDraw = true; });
  await page.waitForTimeout(250);
  const st2 = await stats();
  ok(st2.black < 0.5, `ふつうの見た目に戻る（黒い所 ${(st2.black * 100).toFixed(0)}%）`);
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'エラーなし');
  await browser.close();
  process.exit(errors.length || fail ? 1 : 0);
})().catch(e => { console.log('例外:', e.message); process.exit(1); });
