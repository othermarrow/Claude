// 10階のボスを倒して、町に戻るとエンディングになるか
const { chromium } = require('playwright');
const path = require('path');
const OUT = process.env.SHOTS || path.join(__dirname, 'shots');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 411, height: 890 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  await page.goto('file://' + path.join(__dirname, '..', 'ash-maze.html'));
  const ev = f => page.evaluate(f);
  let fail = 0; const ok = (c, m) => { console.log((c ? 'ok: ' : 'NG: ') + m); if (!c) fail++; };
  const found = await ev(() => {
    S = newState(); S.opts.speed = 2; autoParty();
    const gear = { FIG: ['w21', 'a14', 's07', 'h05', 'g03', 'r05'], PRI: ['w17', 'a10', 's05', 'h02', 'r06'], THI: ['w18', 'a13', 's03', 'r06'], MAG: ['w19', 'a12', 'h03', 'r06'], BIS: ['w19', 'a12', 'h03', 'r06'] };
    for (const c of partyChars()) {
      for (let l = 1; l < 20; l++) { c.exp = expNeed(c, l + 1); levelUp(c); }
      c.items = []; for (const id of gear[c.cls]) { addItem(c, id, 1); equipItem(c, c.items.length - 1); }
      restoreMp(c); c.hp = c.mhp;
    }
    // 番人の部屋の入口のとなりに立つ
    const F = WORLD[10], room = F.rooms[F.guardRoom];
    for (const c of room.cells) {
      const x = c % MW, y = (c / MW) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (!inb(nx, ny) || F.room[ci(nx, ny)] === F.guardRoom) continue;
        const v = getW(F, x, y, d);
        if (v === W_DOOR || v === W_OPEN) { S.inMaze = true; S.deepest = 10; S.pos = { f: 10, x: nx, y: ny, d: (d + 2) & 3 }; scrMaze(); return true; }
      }
    }
    return false;
  });
  ok(found, 'ボスの部屋の入口を見つけた');
  await page.keyboard.press('ArrowUp');
  let sawBoss = false;
  for (let i = 0; i < 3000; i++) {
    await page.waitForTimeout(3);
    if (await ev(() => UI.playing)) { await page.mouse.click(5, 5); continue; }
    if (await page.$eval('#ov', el => el.childElementCount > 0)) {
      const t = await page.$eval('#ov', el => el.innerText);
      if (/ヴァルガ/.test(t)) sawBoss = true;
      const bs = await page.$$('#ov .modal:last-child button:not([disabled])');
      if (bs.length) await bs[0].click();
      continue;
    }
    const scr = await ev(() => UI.screen);
    if (scr === 'battle') {
      await ev(() => { for (const c of partyChars()) { if (c.status === 'dead') c.status = 'ok'; if (c.hp < c.mhp / 2) c.hp = c.mhp; } });   // テスト用に回復
      const bs = await page.$$('#cmd button:not([disabled])');
      for (const b of bs) if ((await b.innerText()).includes('戦う')) { await b.click(); break; }
      if (bs.length && !(await page.$('#ov .modal'))) { const d = await page.$$('#cmd button:not([disabled])'); for (const b of d) if ((await b.innerText()).includes('防御')) { await b.click(); break; } }
      continue;
    }
    if (scr === 'maze' && await ev(() => S.boss === 1 || !B)) { if (await ev(() => S.boss === 1)) break; }
  }
  console.log(await ev(() => JSON.stringify({ scr: UI.screen, boss: S.boss, B: !!B, party: partyChars().map(c => c.status + c.hp), msg: ($('#msg') || {}).innerText })));
  ok(sawBoss, 'ヴァルガが現れた');
  ok(await ev(() => S.boss === 1), 'ヴァルガを倒した');
  ok(await ev(() => partyChars().some(c => c.items.some(i => i.id === 'k04'))), '王の宝珠を手に入れた');
  await ev(() => returnTown());
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, '21_ending.png') });
  ok(await ev(() => S.cleared === 1 && partyChars().every(c => c.honor)), 'エンディング：★がついた');
  const txt = await page.$eval('#app', e => e.innerText);
  ok(/玉座に戻った/.test(txt), 'エンディングの文が出た');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'エラーなし');
  await browser.close();
  process.exit(errors.length || fail ? 1 : 0);
})().catch(e => { console.log('例外:', e.message); process.exit(1); });
