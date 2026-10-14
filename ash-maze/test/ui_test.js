// ブラウザで ash-maze.html を開き、ボタンを押して遊ばせる（スマホの画面の大きさで）
const { chromium } = require('playwright');
const path = require('path');
const OUT = process.env.SHOTS || path.join(__dirname, 'shots');
const STEPS = +(process.env.STEPS || 400);
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 411, height: 890 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('file://' + path.join(__dirname, '..', 'ash-maze.html'));
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  const shot = n => page.screenshot({ path: path.join(OUT, n + '.png') });
  const modalOpen = () => page.$eval('#ov', el => el.childElementCount > 0);
  const modalText = () => page.$eval('#ov', el => el.innerText);
  const clickModal = async (label) => {
    const btns = await page.$$('#ov .modal:last-child button:not([disabled])');
    for (const b of btns) { const t = (await b.innerText()).trim(); if (!label || t.startsWith(label)) { await b.click(); return true; } }
    return false;
  };
  const clickBtn = async (label) => {
    const btns = await page.$$('#app button:not([disabled])');
    for (const b of btns) { const t = (await b.innerText()).trim(); if (t.includes(label)) { await b.click(); return true; } }
    return false;
  };
  const settle = () => page.waitForTimeout(30);
  await shot('01_title');
  await clickBtn('はじめから'); await settle();
  await clickModal('はい'); await settle();
  await clickModal('OK'); await settle();
  await shot('02_town');
  // 設定で文字を速く
  await clickBtn('設定'); await clickBtn('文字の速さ'); await clickBtn('文字の速さ'); await clickBtn('戻る');
  // 商店で買い物
  await clickBtn('商店'); await clickBtn('買う'); await settle();
  await clickModal(); await settle();   // 1人目
  await shot('03_shop');
  await clickModal('戻る'); await settle();
  await clickBtn('町に戻る');
  await clickBtn('町外れ'); await clickBtn('迷宮に入る'); await settle();
  await shot('04_maze');
  let battles = 0, chests = 0, shotBattle = false, shotChest = false, wiped = false, mapShot = false;
  for (let i = 0; i < STEPS; i++) {
    await page.waitForTimeout(5);
    // 文字が流れている間は押して進める
    const playing = await page.evaluate(() => UI.playing);
    if (playing) { await page.mouse.click(5, 5); continue; }
    if (await modalOpen()) {
      const t = await modalText();
      if (/宝箱がある/.test(t)) { chests++; if (!shotChest) { await shot('07_chest'); shotChest = true; } await clickModal('開ける'); continue; }
      if (/戻るか|上るか|下りるか|飲むか|連れて/.test(t)) { await clickModal('いいえ'); continue; }
      if (/どの敵/.test(t)) { await clickModal('1)') || await clickModal('2)'); continue; }
      const btns = await page.$$('#ov .modal:last-child button:not([disabled])');
      if (btns.length) await btns[0].click();
      continue;
    }
    const scr = await page.evaluate(() => UI.screen);
    if (scr === 'battle') {
      const has = await page.$('#cmd button');
      if (has) {
        if (!shotBattle) { await shot('05_battle'); shotBattle = true; battles++; }
        if (!(await clickBtn('戦う'))) { if (!(Math.random() < 0.7 && await clickBtn('呪文'))) await clickBtn('防御'); }
      }
      continue;
    }
    if (scr === 'maze') {
      if (!mapShot && i > 150) { mapShot = true; await clickBtn('地図'); await settle(); await shot('06_map'); await clickBtn('戻る'); continue; }
      const r = Math.random();
      if (r < 0.7) await page.keyboard.press('ArrowUp');
      else if (r < 0.85) await page.keyboard.press('ArrowLeft');
      else await page.keyboard.press('ArrowRight');
      continue;
    }
    if (scr === 'town') { wiped = true; await shot('08_after'); break; }
    if (scr === 'camp') { await clickBtn('出発する'); continue; }
  }
  const st = await page.evaluate(() => ({ pos: S.pos, steps: S.steps, battles: S.battles, gold: S.gold, party: partyChars().map(c => `${c.name} ${c.cls}${c.lv} ${c.hp}/${c.mhp} ${c.status} exp${c.exp}`) }));
  console.log(JSON.stringify(st, null, 1));
  console.log('chests', chests, 'wiped/town', wiped);
  // キャンプと状態表示
  if (!wiped && (await page.evaluate(() => UI.screen)) === 'maze') {
    await clickBtn('キャンプ'); await settle(); await shot('09_camp');
    await page.click('.prow[data-ci="0"]'); await settle(); await shot('10_sheet');
  }
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'エラーなし');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
