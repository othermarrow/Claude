// 町の機能を順に押して確かめる（スマホの画面の大きさで）
const { chromium } = require('playwright');
const path = require('path');
const OUT = process.env.SHOTS || path.join(__dirname, 'shots');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 411, height: 890 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  let fail = 0;
  const ok = (c, m) => { console.log((c ? 'ok: ' : 'NG: ') + m); if (!c) fail++; };
  page.on('pageerror', e => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const url = 'file://' + path.join(__dirname, '..', 'ash-maze.html');
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const shot = n => page.screenshot({ path: path.join(OUT, n + '.png') });
  const ev = (f, a) => page.evaluate(f, a);
  const wait = (ms = 40) => page.waitForTimeout(ms);
  const btn = async (label, scope = '#app') => {
    const bs = await page.$$(`${scope} button:not([disabled])`);
    for (const b of bs) if ((await b.innerText()).replace(/\s+/g, ' ').trim().includes(label)) { await b.click(); await wait(); return true; }
    throw new Error('ボタンがない: ' + label + ' / ' + (await Promise.all(bs.map(b => b.innerText()))).join('|'));
  };
  const mbtn = label => btn(label, '#ov .modal:last-child');
  const untilIdle = async () => { for (let i = 0; i < 400; i++) { if (!(await ev(() => UI.playing))) return; await page.mouse.click(5, 5); await wait(10); } };
  const fill = async v => { await page.fill('#ov input', v); };

  // はじめから（おまかせなし）
  await btn('はじめから'); await mbtn('いいえ'); await mbtn('OK');
  ok(await ev(() => UI.screen === 'town' && S.roster.length === 0), 'はじめから → 町（仲間なし）');
  // 訓練場で作る
  await btn('訓練場'); await btn('冒険者を作る');
  await fill('テスト侍'); await mbtn('決める');
  await mbtn('人間'); await mbtn('善');
  // ボーナスを確実に足りるようにする
  await ev(() => { UI.cr.bonus = 30; scrAlloc(); });
  for (let i = 0; i < 7; i++) await btn('＋');   // 力
  await shot('11_alloc');
  // 残りを全部割り振る
  await ev(() => { const cr = UI.cr; cr.add = [7, 3, 4, 6, 2, 8]; scrAlloc(); });
  await btn('職業を決める');
  await mbtn('侍');
  ok(await ev(() => S.roster.length === 1 && S.roster[0].cls === 'SAM' && S.party.length === 1), '侍を作るとパーティに入る');
  await btn('おまかせで6人作る'); await mbtn('はい');
  ok(await ev(() => S.roster.length === 7 && S.party.length === 6), 'おまかせで6人追加（パーティは6人まで）');
  await btn('町に戻る');
  // 酒場：外して入れ替える
  await btn('酒場'); await btn('外す'); await mbtn('テスト侍');
  ok(await ev(() => S.party.length === 5), '酒場で1人外す');
  await btn('仲間に入れる'); await mbtn('テスト侍'); await wait(); await page.keyboard.press('Escape');
  // tavernAdd はループするので戻る
  if (await ev(() => $('#ov').childElementCount)) await mbtn('戻る');
  ok(await ev(() => S.party.length === 6), '酒場で入れ直す');
  await btn('並べ替え');
  for (let i = 0; i < 5; i++) { const bs = await page.$$('#ov .modal:last-child .mlist button'); await bs[bs.length - 1].click(); await wait(); }
  ok(await ev(() => S.party.length === 6), '並べ替え');
  await btn('町に戻る');
  // 商店で買って装備
  await ev(() => { S.gold = 5000; scrTown(); });
  await btn('商店'); await btn('買う'); await mbtn(await ev(() => partyChars()[0].name));
  await mbtn('板金鎧'); await mbtn('はい'); await mbtn('OK');
  const ac = await ev(() => charAC(partyChars()[0]));
  await mbtn('戻る');
  ok(ac <= 5, '板金鎧を買って装備（AC ' + ac + '）');
  await ev(() => addItem(partyChars()[0], 'w01', 1));
  await btn('売る'); await mbtn(await ev(() => partyChars()[0].name));
  const n0 = await ev(() => partyChars()[0].items.length);
  const sellable = await page.$$('#ov .modal:last-child .mlist button:not([disabled])');
  await sellable[0].click(); await wait(); await mbtn('はい'); await mbtn('戻る');
  ok(await ev(() => partyChars()[0].items.length) === n0 - 1, '1つ売る');
  await btn('町に戻る');
  // 寺院：死んだ仲間を生き返らせる
  const dn = await ev(() => { const c = partyChars().find(x => x.cls === 'FIG' && x.name !== 'テスト侍'); c.status = 'dead'; c.hp = 0; setRng(() => 0.01); scrTown(); return c.name; });
  await btn('寺院'); await btn('治療を頼む');
  await mbtn(dn); await mbtn('はい'); await untilIdle();
  await ev(() => setRng(Math.random));
  ok(await ev(n => S.roster.find(c => c.name === n).status === 'ok', dn), '寺院で蘇生');
  await shot('12_temple');
  await btn('町に戻る');
  // 宿屋：レベルアップ
  await ev(() => { const c = partyChars()[0]; c.exp = expNeed(c, 3); scrTown(); });
  await btn('宿屋'); await btn('客室で休む'); await untilIdle();
  ok(await ev(() => partyChars()[0].lv === 3), '宿屋でLv3に上がる');
  await shot('13_inn');
  await btn('町に戻る');
  // 転職
  await btn('訓練場'); await btn('転職する');
  await mbtn('テスト侍');
  await mbtn('戦士'); await mbtn('はい');
  ok(await ev(() => S.roster.find(c => c.name === 'テスト侍').cls === 'FIG'), '侍 → 戦士に転職');
  await btn('名簿を見る'); await mbtn('テスト侍'); await shot('14_sheet'); await mbtn('閉じる');
  await btn('町に戻る');
  // 迷宮でキャンプ → 灯火
  await ev(() => { const m = partyChars().find(c => c.cls === 'MAG'); m.lv = 3; m.exp = expNeed(m, 3); restoreMp(m); scrTown(); });
  await btn('町外れ'); await btn('迷宮に入る');
  ok(await ev(() => S.inMaze && UI.screen === 'maze'), '迷宮に入る');
  await btn('キャンプ'); await btn('呪文を唱える');
  await mbtn(await ev(() => partyChars().find(c => c.cls === 'MAG').name));
  await mbtn('灯火'); await untilIdle();
  ok(await ev(() => S.light > 0), '灯火で明るくなる');
  await shot('15_camp');
  await btn('出発する');
  await shot('16_maze_light');
  // 書き出し → 読み込み
  const code = await ev(() => exportSave());
  await ev(() => { S.gold = 1; });
  await ev(() => { S = fixState(importSave(exportSave())); });
  ok(code.length > 100 && await ev(() => S.gold === 1), '記録の書き出しと読み込み');
  // 再読み込みで続きから
  await ev(() => saveGame());
  await page.reload();
  await btn('つづきから');
  ok(await ev(() => UI.screen === 'maze' && S.inMaze), '再読み込みしても 迷宮の中から再開');
  // 戦闘画面（強制的に出す）
  await ev(() => { battleFlow(randomEncounter(3), { chest: true }); });
  await wait(200); await untilIdle();
  await shot('17_battle_f3');
  await btn('呪文').catch(() => {});
  await wait(100); await shot('18_spell_list');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'エラーなし');
  await browser.close();
  process.exit(errors.length || fail ? 1 : 0);
})().catch(e => { console.log('例外:', e.message); process.exit(1); });
