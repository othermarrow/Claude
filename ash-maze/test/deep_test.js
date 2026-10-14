// 強いパーティで深い階まで歩かせ、珍しい場面でも止まらないか確かめる
const { chromium } = require('playwright');
const path = require('path');
const OUT = process.env.SHOTS || path.join(__dirname, 'shots');
const STEPS = +(process.env.STEPS || 3000);
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 411, height: 890 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('file://' + path.join(__dirname, '..', 'ash-maze.html'));
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const ev = f => page.evaluate(f);
  // 強いパーティを作る
  await ev(() => {
    S = newState(); S.opts.speed = 2;
    autoParty();
    const gear = { FIG: ['w21', 'a11', 's07', 'h05', 'g03'], PRI: ['w17', 'a10', 's05', 'h02'], THI: ['w18', 'a13', 's03'], MAG: ['w19', 'a12', 'h03'], BIS: ['w19', 'a12', 'h03'] };
    for (const c of partyChars()) {
      for (let l = 1; l < 14; l++) { c.exp = expNeed(c, l + 1); levelUp(c); }
      c.items = []; for (const id of gear[c.cls]) { addItem(c, id, 1); equipItem(c, c.items.length - 1); }
      addItem(c, 'u06', 1);
      if (c.cls === 'FIG') { addItem(c, 'k01', 1); addItem(c, 'k02', 1); }
      restoreMp(c); c.hp = c.mhp;
    }
    S.gold = 100000;
    saveGame(); scrTown();
  });
  const modalText = () => page.$eval('#ov', el => el.innerText);
  const clickIn = async (scope, label) => {
    const bs = await page.$$(`${scope} button:not([disabled])`);
    for (const b of bs) { const t = (await b.innerText()).trim(); if (!label || t.startsWith(label)) { await b.click(); return true; } }
    if (scope.startsWith('#ov') && bs.length) { await bs[0].click(); return true; }
    return false;
  };
  const seen = new Set();
  const note = k => { if (!seen.has(k)) { seen.add(k); console.log('  場面:', k); } };
  await clickIn('#app', '町外れ'); await clickIn('#app', '迷宮に入る');
  let lastFloor = 1, townVisits = 0;
  for (let i = 0; i < STEPS; i++) {
    await page.waitForTimeout(3);
    if (await ev(() => UI.playing)) { await page.mouse.click(5, 5); continue; }
    if (await page.$eval('#ov', el => el.childElementCount > 0)) {
      const t = await modalText();
      const M = '#ov .modal:last-child';
      if (/宝箱がある/.test(t)) { note('宝箱'); await clickIn(M, Math.random() < 0.5 ? '罠を調べる' : '開ける'); continue; }
      if (/どの罠だと思う/.test(t)) { await clickIn(M); continue; }
      if (/町へ戻るか/.test(t)) { await clickIn(M, 'いいえ'); continue; }
      if (/上るか/.test(t)) { await clickIn(M, Math.random() < 0.2 ? 'はい' : 'いいえ'); continue; }
      if (/下りるか/.test(t)) { note('下り階段'); await clickIn(M, 'はい'); continue; }
      if (/飲むか/.test(t)) { note('泉'); await clickIn(M, 'はい'); continue; }
      if (/亡骸/.test(t)) { note('亡骸@B' + await ev(() => S.pos.f) + 'F'); await clickIn(M, 'はい'); continue; }
      if (/床が抜けた/.test(t)) note('落とし戸');
      if (/別の場所/.test(t)) note('テレポーター');
      if (/石壁/.test(t)) note('石壁の文字');
      if (/ヴァルガ/.test(t)) note('ボス');
      if (/盗賊の頭|鎧の騎士|黒い巨人/.test(t)) note('番人');
      if (/全滅/.test(t)) note('全滅@B' + await ev(() => S.pos.f) + 'F');
      await clickIn(M);
      continue;
    }
    const scr = await ev(() => UI.screen);
    if (scr === 'battle') {
      if (await page.$('#cmd button')) {
        const r = Math.random();
        if (r < 0.35 && await clickIn('#cmd', '呪文')) { note('呪文'); continue; }
        if (r < 0.45 && await clickIn('#cmd', '道具')) continue;
        if (r < 0.5 && await clickIn('#cmd', '解呪')) continue;
        if (!(await clickIn('#cmd', '戦う'))) await clickIn('#cmd', '防御');
      }
      continue;
    }
    if (scr === 'maze') {
      const f = await ev(() => S.pos.f);
      if (f !== lastFloor) { lastFloor = f; note('B' + f + 'F'); }
      // 弱ったら全快させる（テスト用）
      await ev(() => { for (const c of partyChars()) { if (c.lv < 10) continue; if (isDown(c)) { c.status = 'ok'; } c.hp = Math.max(c.hp, Math.floor(c.mhp / 2)); c.poison = 0; if (S.steps % 40 === 0) restoreMp(c); } });
      // 目的地（番人の部屋 → 下り階段）へ向かう。ときどき寄り道する
      const dir = await ev(() => {
        S.light = Math.max(S.light, 50);
        const F = WORLD[S.pos.f];
        let goal = null;
        if (F.guardRoom >= 0 && GUARDS[S.pos.f] && guardActive(S.pos.f)) goal = F.rooms[F.guardRoom].cells[0];
        else if (F.down) goal = ci(F.down.x, F.down.y);
        if (goal === null) return -1;
        const dist = bfs(F, goal % MW, (goal / MW) | 0, { keys: 1 });
        const here = dist[ci(S.pos.x, S.pos.y)];
        for (let d = 0; d < 4; d++) {
          const nx = S.pos.x + DX[d], ny = S.pos.y + DY[d];
          if (!inb(nx, ny) || !passable(getW(F, S.pos.x, S.pos.y, d), { keys: 1 })) continue;
          if (dist[ci(nx, ny)] >= 0 && dist[ci(nx, ny)] < here) return d;
        }
        return -1;
      });
      if (dir >= 0 && Math.random() < 0.85) {
        const cur = await ev(() => S.pos.d);
        const diff = (dir - cur + 4) % 4;
        if (diff === 0) await page.keyboard.press('ArrowUp');
        else if (diff === 1) await page.keyboard.press('ArrowRight');
        else if (diff === 3) await page.keyboard.press('ArrowLeft');
        else await page.keyboard.press('ArrowDown');
        continue;
      }
      const r = Math.random();
      if (r < 0.75) await page.keyboard.press('ArrowUp');
      else if (r < 0.87) await page.keyboard.press('ArrowLeft');
      else if (r < 0.99) await page.keyboard.press('ArrowRight');
      else await page.keyboard.press('s');
      continue;
    }
    if (scr === 'town' || scr === 'title') {
      townVisits++; note('町に戻った');
      if (await ev(() => S && S.cleared)) { note('クリア'); break; }
      await ev(() => {
        if (!partyChars().length || !partyChars().some(canAct)) {
          S.party = [];
          for (const c of S.roster) if (!c.maze && c.lv >= 10) { c.status = 'ok'; c.hp = c.mhp; if (S.party.length < 6) S.party.push(c.id); }
          if (!S.party.length) autoParty();
        }
        for (const c of partyChars()) { if (c.lv >= 10) { c.status = 'ok'; c.hp = c.mhp; restoreMp(c); } }
        scrEdge();
      });
      await clickIn('#app', '迷宮に入る');
      continue;
    }
    if (scr === 'camp') { await clickIn('#app', '出発する'); continue; }
    if (scr === 'map') { await clickIn('#app', '戻る'); continue; }
    // エンディングなど
    await clickIn('#app');
  }
  console.log(await ev(() => JSON.stringify(S.roster.map(c => [c.name, c.lv, c.status, c.maze ? c.maze.f + ':' + c.maze.x + ',' + c.maze.y : (S.party.includes(c.id) ? 'party' : 'town')]))));
  const st = await ev(() => ({ f: S.pos.f, deepest: S.deepest, steps: S.steps, battles: S.battles, boss: S.boss, guardDone: S.guardDone, cleared: S.cleared }));
  console.log(JSON.stringify(st));
  await page.screenshot({ path: path.join(OUT, '20_deep.png') });
  console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 5).join('\n') : 'エラーなし');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.log('例外:', e.message); process.exit(1); });
