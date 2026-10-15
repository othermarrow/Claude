// 保存先を確かめる：localStorage が使えない WebView（Tasker）で、Tasker の変数に保存できるか
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.join(__dirname, '..', 'backrooms.html');
// localStorage を使えなくする
const NO_LS = `Storage.prototype.setItem = function () { throw new Error('DOM storage disabled'); }; Storage.prototype.getItem = function () { return null; };`;
// Tasker の global()・setGlobal() のかわり。値は window.name に入れて、読み込み直しても残す
const TASKER = `(function () { const db = () => { try { return JSON.parse(window.name || '{}'); } catch (e) { return {}; } };
  window.__tk = () => { window.global = n => { const v = db()[n]; return v == null ? '%' + n : v; }; window.setGlobal = (n, v) => { const d = db(); d[n] = String(v); window.name = JSON.stringify(d); }; };
})();`;
(async () => {
  const browser = await chromium.launch();
  let fail = 0; const ok = (c, m) => { console.log((c ? 'ok: ' : 'NG: ') + m); if (!c) fail++; };
  const errors = [];
  const open = async (init) => {
    const ctx = await browser.newContext({ viewport: { width: 411, height: 890 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(init);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(URL); await page.waitForTimeout(300);
    return page;
  };
  const ovText = p => p.$eval('#ov', e => e.innerText);
  const click = async (page, label) => { const bs = await page.$$('#ov button'); for (const b of bs) if ((await b.innerText()).includes(label)) { await b.click(); await page.waitForTimeout(80); return; } throw new Error('ボタンなし ' + label); };

  // 1) Tasker の関数がはじめからある
  let page = await open(NO_LS + TASKER + 'window.__tk();');
  ok(await page.evaluate(() => store().kind) === 'tasker', 'localStorage が使えないとき、Tasker の変数を使う');
  let t = await ovText(page);
  ok(/Tasker の変数/.test(t) && !/保存されないようだ/.test(t), 'タイトルに「Tasker の変数に保存する」と出る');
  await click(page, '設定'); await click(page, '見た目'); await click(page, '戻る');
  await click(page, 'はじめから'); await click(page, '進む'); await click(page, '進む');
  await page.evaluate(() => { S.x += 0.5; S.water = 2; showPause(); });
  const saved = await page.evaluate(() => JSON.parse(window.name));
  ok(saved.BrSave && JSON.parse(saved.BrSave).water === 2 && JSON.parse(saved.BrOpts).wire === 1, '一時停止で %BrSave に、設定は %BrOpts に入る');
  await page.reload(); await page.waitForTimeout(300);
  t = await ovText(page);
  ok(/つづきから/.test(t) && await page.evaluate(() => OPT.wire === 1), '読み込み直しても、つづきと設定が残っている');
  await click(page, 'つづきから');
  ok(await page.evaluate(() => G.mode === 'play' && S.water === 2), 'つづきから遊べる');
  await page.evaluate(() => { clearSave(); });
  ok(await page.evaluate(() => loadSave() === null), '記録を消すと、%BrSave も空になる');
  await page.context().close();

  // 2) Tasker の関数があとから用意される
  page = await open(NO_LS + TASKER + 'setTimeout(() => window.__tk(), 300);');
  t = await ovText(page);
  ok(/保存されないようだ/.test(t), 'はじめは「保存されない」と出る');
  await page.waitForTimeout(1200);
  t = await ovText(page);
  ok(/Tasker の変数/.test(t) && !/保存されないようだ/.test(t), '1秒後に Tasker の変数が見つかり、タイトルが出し直される');
  await page.context().close();

  // 3) どちらもない
  page = await open(NO_LS);
  t = await ovText(page);
  ok(/保存されないようだ/.test(t) && /Allow Phone Access/.test(t), 'どちらも使えないときは、「保存されない」と直し方が出る');
  await click(page, 'はじめから'); await click(page, '進む'); await click(page, '進む');
  ok(await page.evaluate(() => { for (let i = 0; i < 60; i++) update(0.033); return G.mode === 'play'; }), '保存できなくても遊べる');
  await page.context().close();

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'エラーなし');
  await browser.close();
  process.exit(errors.length || fail ? 1 : 0);
})().catch(e => { console.log('例外:', e.message); process.exit(1); });
