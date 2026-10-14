// ブラウザで開いて、各層の画面を撮る。エラーが出ないか、描画が重すぎないかも見る
const { chromium } = require('playwright');
const path = require('path');
const OUT = process.env.SHOTS || path.join(__dirname, 'shots');
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 411, height: 890 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  let fail = 0; const ok = (c, m) => { console.log((c ? 'ok: ' : 'NG: ') + m); if (!c) fail++; };
  page.on('pageerror', e => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('file://' + path.join(__dirname, '..', 'backrooms.html'));
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(600);
  const shot = n => page.screenshot({ path: path.join(OUT, n + '.png') });
  const ev = (f, a) => page.evaluate(f, a);
  const click = async label => { const bs = await page.$$('#ov button'); for (const b of bs) if ((await b.innerText()).includes(label)) { await b.click(); await page.waitForTimeout(80); return; } throw new Error('ボタンなし ' + label); };
  await shot('b01_title');
  await click('はじめから'); await shot('b02_intro');
  await click('進む'); await shot('b03_card');
  await click('進む');
  ok(await ev(() => DBG.G.mode === 'play'), '遊べる状態になった');
  // 少し歩く（キーボード）
  await page.keyboard.down('w'); await page.waitForTimeout(900); await page.keyboard.up('w');
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(500); await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(200);
  await shot('b04_level0');
  // 描画の重さ
  const ms = await ev(() => { const t0 = performance.now(); for (let i = 0; i < 20; i++) renderFrame(DBG.G.t, DBG.S, sprites(), frameFx()); return (performance.now() - t0) / 20; });
  console.log('  1フレームの描画:', ms.toFixed(1), 'ms', await ev(() => RD.W + 'x' + RD.H));
  // タッチで歩く（左半分をなぞる）
  const p0 = await ev(() => ({ x: DBG.S.x, y: DBG.S.y }));
  await page.mouse.move(100, 700); await page.mouse.down(); await page.mouse.move(100, 640, { steps: 4 }); await page.waitForTimeout(700); await page.mouse.up();
  const p1 = await ev(() => ({ x: DBG.S.x, y: DBG.S.y }));
  ok(Math.hypot(p1.x - p0.x, p1.y - p0.y) > 0.3, '左半分をなぞると歩く');
  const a0 = await ev(() => DBG.S.a);
  await page.mouse.move(300, 400); await page.mouse.down(); await page.mouse.move(360, 400, { steps: 5 }); await page.mouse.up();
  ok(Math.abs(await ev(() => DBG.S.a) - a0) > 0.1, '右半分をなぞると向きが変わる');
  // 物を拾う：水の上へ移動
  await ev(() => { DBG.S.x = 10.5; DBG.S.y = 7.5; });
  await page.waitForTimeout(200);
  ok(await ev(() => DBG.S.water >= 1), 'スタートのそばの水を拾った');
  await ev(() => { DBG.S.x = 7.5; DBG.S.y = 10.5; });
  await page.waitForTimeout(200);
  ok(await ev(() => DBG.G.mode === 'note' && DBG.S.notes.length === 1), 'メモを拾って読む');
  await shot('b05_note');
  await click('閉じる');
  await ev(() => { DBG.S.x = 8.5; DBG.S.y = 8.5; });
  // 懐中電灯
  await page.tap('#k_light');
  ok(await ev(() => DBG.S.flash), 'ライトをつけた');
  await page.tap('#k_water');
  ok(await ev(() => DBG.S.water === 0), '水を飲んだ');
  // 徘徊者を呼ぶ
  await ev(() => { const e = { type: 'wander', x: DBG.S.x + Math.cos(DBG.S.a) * 3, y: DBG.S.y + Math.sin(DBG.S.a) * 3, st: 'wander', tgt: null, next: null, repath: 0, lost: 0, stepT: 0, sndT: 1, burn: 0 }; if (!isWall(Math.floor(e.x), Math.floor(e.y))) DBG.G.ents.push(e); });
  await page.waitForTimeout(300);
  await shot('b06_wanderer');
  // 出口の前へ
  await ev(() => { DBG.G.ents = []; DBG.toExit(); });
  await page.waitForTimeout(300);
  await shot('b07_exit0');
  ok(await ev(() => DBG.G.nearExit), '出口の前で「入る」が出る');
  await page.tap('#act');
  await page.waitForTimeout(2200);
  ok(await ev(() => DBG.G.mode === 'card' && DBG.S.lv === 1), '出口を通って第1層へ');
  await click('進む');
  // 各層の様子
  for (let lv = 1; lv <= 4; lv++) {
    await ev(n => { DBG.level(n); DBG.S.a = 0.6; }, lv);
    await page.waitForTimeout(400);
    await shot(`b1${lv}_level${lv}`);
    await ev(() => DBG.toExit());
    await page.waitForTimeout(300);
    await shot(`b2${lv}_exit${lv}`);
  }
  // 第3層：ライトと笑う闇
  await ev(() => { DBG.level(3); DBG.S.flash = true; });
  await page.waitForTimeout(300);
  await ev(() => { for (let i = 0; i < 30; i++) if (DBG.spawn('grin')) break; const e = DBG.G.ents[0]; if (e) { e.x = DBG.S.x + Math.cos(DBG.S.a) * 4; e.y = DBG.S.y + Math.sin(DBG.S.a) * 4; } });
  await page.waitForTimeout(200);
  await shot('b30_grin');
  // 捕まる → やり直し
  await ev(() => { DBG.G.ents = [{ type: 'wander', x: DBG.S.x, y: DBG.S.y + 0.1, st: 'chase', tgt: null, next: null, repath: 0, lost: 5, stepT: 0, sndT: 1, burn: 0 }]; });
  await page.waitForTimeout(300);
  ok(await ev(() => DBG.G.mode === 'over'), '捕まると終わり');
  await shot('b31_over');
  await click('この層の最初から');
  ok(await ev(() => DBG.S.deaths === 1 && DBG.G.mode === 'card'), 'この層の最初からやり直し');
  await click('進む');
  // 一時停止 → タイトル → つづきから
  await page.tap('#pausebtn');
  ok(await ev(() => DBG.G.mode === 'pause'), '一時停止');
  await shot('b32_pause');
  await click('タイトルへ');
  await click('つづきから');
  ok(await ev(() => DBG.G.mode === 'play' && DBG.S.lv === 3), 'つづきから第3層');
  // エンディング
  await ev(() => { DBG.level(4); DBG.toExit(); });
  await page.waitForTimeout(200);
  await page.tap('#act');
  await page.waitForTimeout(2200);
  ok(await ev(() => DBG.G.mode === 'end'), 'エンディング');
  await shot('b40_end');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'エラーなし');
  await browser.close();
  process.exit(errors.length || fail ? 1 : 0);
})().catch(e => { console.log('例外:', e.message); process.exit(1); });
