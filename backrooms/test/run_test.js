// 自動操縦で、第0層から第4層の出口まで歩き通せるか（怪物も出る）
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 411, height: 890 }, isMobile: true, hasTouch: true })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message + '\n' + e.stack));
  await page.goto('file://' + path.join(__dirname, '..', 'backrooms.html'));
  await page.evaluate(() => localStorage.clear());
  const seeds = (process.env.SEEDS || '1,2,3').split(',').map(Number);
  let fail = 0;
  for (const seed of seeds) {
    const r = await page.evaluate(([seed, WANDER, MODE]) => {
      S = newState(MODE); S.seed = seed; enterLevel(0, true); startPlay();
      const NLV = THEMES[MODE] ? THEMES[MODE].levels.length : LEVELS.length;
      const log = [];
      for (let lv = 0; lv < NLV; lv++) {
        let t = 0, stuck = 0, last = { x: S.x, y: S.y };
        const ex = WD.exit;
        while (t < 240 + WANDER) {
          if (G.mode === 'note') startPlay();
          if (G.mode === 'over') { log.push(`L${lv}:${S.san <= 0 ? '正気0' : '捕まった'}@${t.toFixed(0)}s`); restartLevel(); startPlay(); t = Math.max(t, WANDER); }
          if (G.mode !== 'play') break;
          // 次のマスへ向かう
          const fx = Math.floor(S.x), fy = Math.floor(S.y);
          if (t < WANDER) {   // 寄り道：ふらふら歩く
            if (!G.wd || Math.random() < 0.01 || blocked(S.x + Math.cos(S.a) * 0.4, S.y + Math.sin(S.a) * 0.4)) { S.a += (Math.random() - 0.5) * 3; G.wd = 1; }
            G.keys.w = true; G.run = G.fear > 0.2 && S.stam > 10;
            if (lightAt(S.x, S.y) < 0.2 && !S.flash && (S.bat > 0 || S.spare)) toggleFlash();
            if (S.thirst < 40 && S.water) drinkWater();
            if (S.san < 40 && S.water) drinkWater();
            update(0.033); t += 0.033; last = { x: S.x, y: S.y }; continue;
          }
          const nx = nextStep(fx, fy, ex.fx, ex.fy, 90);
          let tx, ty;
          if (nx) { tx = nx.x + 0.5; ty = nx.y + 0.5; } else { tx = ex.fx + 0.5; ty = ex.fy + 0.5; }
          if (fx === ex.fx && fy === ex.fy) { S.a = Math.atan2(ex.wy - ex.fy, ex.wx - ex.fx); }
          else S.a = Math.atan2(ty - S.y, tx - S.x);
          G.keys.w = !(fx === ex.fx && fy === ex.fy);
          G.run = G.fear > 0.2 && S.stam > 10;
          if (S.thirst < 40 && S.water) drinkWater();
          if (lightAt(S.x, S.y) < 0.2 && !S.flash && (S.bat > 0 || S.spare)) toggleFlash();
          update(0.033); t += 0.033;
          if (G.nearExit) { enterExit(); finishTrans(); if (G.mode === 'card') startPlay(); log.push(`L${lv}:${t.toFixed(0)}s 正気${S.san.toFixed(0)} 水分${S.thirst.toFixed(0)} 怪物${G.ents.length} 水${S.water} 電池${S.spare}`); break; }
          if (Math.hypot(S.x - last.x, S.y - last.y) < 0.002) stuck++; else stuck = 0;
          last = { x: S.x, y: S.y };
          if (stuck > 150) { log.push(`L${lv}:動けない (${S.x.toFixed(1)},${S.y.toFixed(1)})`); return { log, done: false }; }
        }
        if (G.mode === 'end') return { log, done: true };
        if (t >= 240 + WANDER) { log.push(`L${lv}:時間切れ`); return { log, done: false }; }
      }
      return { log, done: G.mode === 'end', deaths: S && S.deaths };
    }, [seed, +(process.env.WANDER || 0), process.env.MODE || 'normal']);
    console.log(`種${seed}:`, r.done ? 'クリア' : '失敗', r.log.join(' / '));
    if (!r.done) fail++;
  }
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'エラーなし');
  await browser.close();
  process.exit(errors.length || fail ? 1 : 0);
})().catch(e => { console.log('例外:', e.message); process.exit(1); });
