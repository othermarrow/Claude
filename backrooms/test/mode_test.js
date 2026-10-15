// 救いのない版と原作版を確かめる
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
  const click = async label => { const bs = await page.$$('#ov button'); for (const b of bs) if ((await b.innerText()).includes(label)) { await b.click(); await page.waitForTimeout(80); return; } throw new Error('ボタンなし ' + label); };
  await ev(() => { window.sim = (sec, each) => { for (let t = 0; t < sec; t += 0.033) { if (G.mode === 'note') startPlay(); if (G.mode !== 'play') return G.mode; update(0.033); if (each) each(); } return G.mode; }; });
  await shot('m01_title');

  // ---- 原作版 ----
  await click('ほかの版');
  await shot('m00_more');
  await click('原作版');
  await shot('m02_orig_intro');
  await click('足を踏み入れる');
  ok(await ev(() => G.mode === 'play' && S.mode === 'orig'), '原作版が始まる');
  ok(await ev(() => WD.exit === null && exitPoint() === null), '出口がない');
  ok(await ev(() => { let n = 0; for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) n += chunkAt(i, j).items.length; return n === 0; }), '拾える物がない');
  ok(await ev(() => getComputedStyle($('#hud')).display === 'none' && getComputedStyle($('#k_water')).display === 'none' && getComputedStyle($('#k_run')).display !== 'none'), '表示は「走」と一時停止だけ');
  await ev(() => { S.a = 0.7; });
  await page.waitForTimeout(300);
  await shot('m03_orig_play');
  // 「何か」が現れて、こちらの音を聞いている
  const sp = await ev(() => { const m = sim(75); const e = G.ents[0]; return { m, n: G.ents.length, st: e && e.st, d: e && Math.hypot(e.x - S.x, e.y - S.y), san: S.san, th: S.thirst }; });
  ok(sp.n === 1 && (sp.st === 'hunt' || sp.st === 'chase' || sp.m === 'over'), `75秒たつと「何か」が現れて、こちらへ向かう（${JSON.stringify(sp)}）`);
  ok(sp.san === 100 && sp.th === 100, '正気・渇きは減らない（表示もない）');
  // 遠くへ逃げても、いつのまにか近くにいる
  const far = await ev(() => { if (G.mode !== 'play') return -1; const e = G.ents[0]; e.x = S.x + 60; e.y = S.y; sim(0.2); const e2 = G.ents[0]; return e2 ? Math.hypot(e2.x - S.x, e2.y - S.y) : -2; });
  ok(far > 0 && far < 25, `離れすぎると、近くに戻ってくる（${far.toFixed ? far.toFixed(1) : far}）`);
  // 時間がたつと、画面が黄色く
  ok(await ev(() => frameFx().yellow > 0), '時間がたつと、黄色一色に近づく');
  // 立ち止まっていれば、いずれ捕まる
  const end = await ev(() => { if (G.mode !== 'play') return G.mode; const m = sim(240); return m; });
  ok(end === 'over', '立ち止まっていると、いずれ捕まる（' + end + '）');
  await shot('m04_orig_over');
  ok(await ev(() => OPT.origBest > 70 && !loadSave()), '生き延びた時間が記録され、途中の記録は消える');
  await click('タイトルへ');

  // ---- 救いのない版 ----
  await click('ほかの版');
  await click('救いのない版');
  await click('進む'); await click('進む');
  ok(await ev(() => G.mode === 'play' && S.mode === 'hard' && WD.cfg.n === '第0層'), '救いのない版が始まる');
  // 出口を5回くぐる → 第5層は、また黄色い部屋
  for (let i = 0; i < 5; i++) {
    await ev(() => { DBG.toExit(); update(0.01); enterExit(); finishTrans(); });
    if (i === 4) await shot('m05_hard_card5');
    await click('進む');
  }
  const c5 = await ev(() => ({ lv: S.lv, n: WD.cfg.n, name: WD.cfg.name, amb: WD.cfg.amb, ents: WD.cfg.ents, desat: WD.cfg.desat, mode: G.mode }));
  ok(c5.lv === 5 && c5.name === '黄色い部屋' && c5.mode === 'play', `光の扉の先は第5層「黄色い部屋」（${c5.n}）`);
  ok(c5.amb < LEVELS_AMB0() && c5.ents.wander.max >= 2 && c5.ents.grin && c5.desat > 0, `2周目は暗く、怪物が多い（${JSON.stringify(c5.ents)}）`);
  function LEVELS_AMB0() { return 0.16; }
  await ev(() => { S.a = 0.7; }); await page.waitForTimeout(300);
  await shot('m06_hard_level5');
  // 水を飲んでも正気は戻らない
  const dr = await ev(() => { S.water = 1; S.san = 50; S.thirst = 50; drinkWater(); return { san: S.san, th: S.thirst }; });
  ok(dr.san === 50 && dr.th === 80, `水で正気は戻らない（${JSON.stringify(dr)}）`);
  // 死んだら終わり：記録が消え、メモが残る
  await ev(() => { G.ents = [{ type: 'wander', x: S.x, y: S.y + 0.1, st: 'chase', tgt: null, next: null, repath: 0, lost: 5, stepT: 0, sndT: 1, burn: 0 }]; update(0.03); });
  ok(await ev(() => G.mode === 'over' && !loadSave() && OPT.hardBest === 5 && OPT.graves.length === 1), '捕まると終わり（やり直しなし）。第5層までと記録');
  await shot('m07_hard_over');
  ok(!(await page.$$eval('#ov button', bs => bs.some(b => b.innerText.includes('最初から')))), 'やり直しのボタンがない');
  await click('タイトルへ');
  await shot('m08_title_records');
  // 次の救いのない版で、前の自分のメモを拾う
  const g = await ev(() => {
    S = newState('hard'); enterLevel(0, true); startPlay();
    for (let i = 0; i < 20; i++) { pickUp({ id: 'test' + i, t: 'note', x: 0, y: 0 }); startPlay(); if (S.notes.some(n => n.mine)) break; }
    return S.notes.find(n => n.mine);
  });
  ok(g && /第5層まで来た/.test(g.t), '前に死んだ自分のメモを拾う：' + (g && g.t.split('\n')[0]));
  // ---- 五つの報告書・山羊文学版 ----
  for (const [mode, label, monster, first] of [['self', '五つの報告書', 'sp_wander', 'エラーから直す部屋'], ['yagi', '山羊文学版', 'sp_goat', '地下室の山羊']]) {
    await ev(() => { clearSave(); S = null; showTitle(); });
    await click('ほかの版'); await click(label);
    await shot(`m1_${mode}_intro`);
    await click('進む');
    ok(await ev(() => WD.cfg.name), `${label}：第0層の札が出る`);
    await shot(`m1_${mode}_card0`);
    await click('進む');
    ok(await ev(f => G.mode === 'play' && WD.cfg.name === f && WD.cfg.itemSpr === 'sp_claude', first), `${label}：第0層「${first}」が始まり、拾う物は印`);
    // 印の前に立って撮る
    await ev(() => { const it = nearbyItems()[0]; if (it) { S.x = it.x - Math.cos(0.3) * 2; S.y = it.y - Math.sin(0.3) * 2; S.a = 0.3; if (blocked(S.x, S.y)) { S.x = it.x - 1.5; S.y = it.y; S.a = 0; } } });
    await page.waitForTimeout(300);
    await shot(`m1_${mode}_play`);
    // メモを拾う → その層の言葉
    const n = await ev(() => { pickUp({ id: 'tn1', t: 'note', x: 0, y: 0 }); const t = $('#ov').innerText; startPlay(); return { t, n: S.notes.length, src: S.notes[0] && S.notes[0].src }; });
    ok(n.n === 1 && n.src, `${label}：メモを拾う（${n.src}）${n.t.replace(/\s+/g, ' ').slice(0, 40)}`);
    // 怪物の絵
    const spr = await ev(() => { G.ents = [{ type: 'wander', x: S.x + 3, y: S.y, st: 'wander', tgt: null, next: null, repath: 0, lost: 0, stepT: 0, sndT: 1, burn: 0 }]; return sprites().find(o => o.h > 1).spr; });
    ok(spr === monster, `${label}：追ってくるものの絵（${spr}）`);
    await ev(() => { S.a = 0; G.ents[0].x = S.x + 2.5; G.ents[0].y = S.y; if (blocked(G.ents[0].x, G.ents[0].y)) { G.ents[0].x = S.x; G.ents[0].y = S.y + 2.5; S.a = Math.PI / 2; } });
    await page.waitForTimeout(250);
    await shot(`m1_${mode}_monster`);
    // 捕まったときの文
    await ev(() => { G.ents = [{ type: 'wander', x: S.x, y: S.y + 0.1, st: 'chase', tgt: null, next: null, repath: 0, lost: 5, stepT: 0, sndT: 1, burn: 0 }]; update(0.03); });
    const ov1 = await page.$eval('#ov', e => e.innerText);
    ok(/最初から/.test(ov1) && (mode === 'self' ? /要約/.test(ov1) : /山羊/.test(ov1)), `${label}：捕まったときの文（やり直せる）`);
    await click('この層の最初から'); await click('進む');
    // 5つの層を通ってエンディング
    for (let lv = 0; lv < 5; lv++) { await ev(() => { DBG.toExit(); update(0.01); enterExit(); finishTrans(); }); if (lv < 4) await click('進む'); }
    const end = await page.$eval('#ov', e => e.innerText);
    ok(await ev(() => G.mode === 'end'), `${label}：エンディング`);
    ok(mode === 'self' ? /記録にないことは/.test(end) : /幕が上がる/.test(end), `${label}：エンディングの文`);
    await shot(`m1_${mode}_end`);
    await click('タイトルへ');
  }
  // 山羊文学版の各層の札
  const names = await ev(() => [0, 1, 2, 3, 4].map(i => levelCfg(i, 'yagi').name + '/' + levelCfg(i, 'self').name));
  console.log('  層の名前:', names.join(' | '));
  // ふつうの版は、これまでどおり第4層の先でエンディング
  const nm = await ev(() => { S = newState('normal'); enterLevel(4, true); startPlay(); DBG.toExit(); update(0.01); enterExit(); finishTrans(); return G.mode; });
  ok(nm === 'end', 'ふつうの版は第4層の先でエンディング');
  // ふつうの版・救いのない版でも、拾う物を Claude のマークにできる（設定で切りかえ）
  for (const md of ['normal', 'hard']) {
    const ic = await ev(m => {
      S = newState(m); enterLevel(0, true); startPlay();
      const pick = () => { const o = sprites().find(o => o.h < 0.5); return o && o.spr; };
      const a = pick(); OPT.claude = 0; const b = pick(); OPT.claude = 1;
      return { a, b, n: nearbyItems().length };
    }, md);
    ok(ic.n > 0 && ic.a === 'sp_claude' && /^sp_(water|battery|map|note)$/.test(ic.b), `${md}：拾う物はClaudeのマーク、設定で元の絵に戻せる（${ic.a} / ${ic.b}）`);
  }
  await ev(() => { G.mode = 'title'; showSettings(showTitle); });
  const s1 = await page.$eval('#ov', e => e.innerText); await click('拾う物の絵');
  const s2 = await page.$eval('#ov', e => e.innerText);
  ok(/拾う物の絵：Claude のマーク/.test(s1) && /拾う物の絵：ふつうの絵/.test(s2) && await ev(() => OPT.claude === 0 && JSON.parse(localStorage.getItem(OPT_KEY)).claude === 0), '設定の「拾う物の絵」で切りかわり、保存される');
  await shot('m1_settings');
  await click('拾う物の絵');
  // 一時停止から開いた画面の「戻る」で、一時停止に戻れる
  await ev(() => { S = newState('normal'); enterLevel(0, true); startPlay(); });
  for (const [label, back] of [['設定', '戻る'], ['遊び方', '戻る'], ['拾ったメモ', '戻る']]) {
    await ev(() => showPause());
    await click(label); await click(back);
    const t = await page.$eval('#ov', e => e.innerText);
    ok(/一時停止/.test(t) && await ev(() => G.mode === 'pause'), `一時停止 → ${label} → 「${back}」で一時停止に戻る`);
    await click('つづける');
    ok(await ev(() => G.mode === 'play'), `　そのあと「つづける」で遊びに戻る`);
  }
  // ふつうの版で、マークの前に立って撮る
  await ev(() => { S = newState('normal'); enterLevel(0, true); startPlay(); const it = nearbyItems()[0]; if (it) { S.x = it.x - Math.cos(0.3) * 2; S.y = it.y - Math.sin(0.3) * 2; S.a = 0.3; if (blocked(S.x, S.y)) { S.x = it.x - 1.5; S.y = it.y; S.a = 0; } } });
  await page.waitForTimeout(300);
  await shot('m1_normal_claude');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'エラーなし');
  await browser.close();
  process.exit(errors.length || fail ? 1 : 0);
})().catch(e => { console.log('例外:', e.message); process.exit(1); });
