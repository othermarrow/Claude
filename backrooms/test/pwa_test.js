// アプリとして入れる版（pwa/）を確かめる：入れられるか、サーバーを止めても開けるか、新しい版に入れかわるか
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..', 'pwa');
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript', '.png': 'image/png' };
let override = null;   // index.html を差しかえて、新しい版を出したことにする
const serve = port => new Promise(res => {
  const s = http.createServer((q, r) => {
    let f = decodeURIComponent(q.url.split('?')[0]); if (f === '/') f = '/index.html';
    const p = path.join(DIR, path.normalize(f));
    if (!p.startsWith(DIR) || !fs.existsSync(p)) { r.writeHead(404); r.end(); return; }
    let body = fs.readFileSync(p);
    if (f === '/index.html' && override) body = Buffer.from(override(body.toString()));
    r.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); r.end(body);
  });
  s.listen(port, '127.0.0.1', () => res(s));
});
const pngSize = f => { const b = fs.readFileSync(path.join(DIR, f)); return b.slice(1, 4).toString() === 'PNG' ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null; };
// 全画面で開いたことにする。画面を消さない仕組みは、呼ばれたかを数えるだけのかわりにする
const INIT = `(() => {
  const mm = window.matchMedia.bind(window);
  window.matchMedia = q => /display-mode/.test(q) ? { matches: true, media: q, addEventListener() { }, removeEventListener() { } } : mm(q);
  window.__wl = { req: 0, rel: 0 };
  Object.defineProperty(navigator, 'wakeLock', { value: { request: () => { __wl.req++; const l = new EventTarget(); l.release = () => { __wl.rel++; return Promise.resolve(); }; return Promise.resolve(l); } } });
})();`;

(async () => {
  let fail = 0; const ok = (c, m) => { console.log((c ? 'ok: ' : 'NG: ') + m); if (!c) fail++; };
  const PORT = 18765, URL = `http://127.0.0.1:${PORT}/`;
  let server = await serve(PORT);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 411, height: 890 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const ovText = () => page.$eval('#ov', e => e.innerText);
  const click = async label => { const bs = await page.$$('#ov button'); const tx = []; for (const b of bs) tx.push(await b.innerText()); let i = tx.findIndex(t => t.split('\n')[0].trim() === label); if (i < 0) i = tx.findIndex(t => t.includes(label)); if (i < 0) throw new Error('ボタンなし ' + label); await bs[i].click(); await page.waitForTimeout(80); };

  // ファイル
  const tasker = fs.readFileSync(path.join(__dirname, '..', 'backrooms.html'), 'utf8');
  ok(!/serviceWorker|manifest\.json/.test(tasker), 'Tasker 用の backrooms.html には、アプリ用の仕組みが入っていない');
  ok(JSON.stringify(pngSize('icon-192.png')) === '[192,192]' && JSON.stringify(pngSize('icon-512.png')) === '[512,512]', 'アイコンは 192×192 と 512×512 の PNG');

  await page.goto(URL);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 5000 });
  ok(true, 'sw.js が入り、ページを受け持つ');
  const cdp = await ctx.newCDPSession(page);
  const man = await cdp.send('Page.getAppManifest');
  ok(man.errors.length === 0 && /"display": "fullscreen"/.test(man.data), 'manifest.json が読めて、全画面で開く設定 ' + JSON.stringify(man.errors));
  const inst = await cdp.send('Page.getInstallabilityErrors');
  ok(inst.installabilityErrors.length === 0, 'Chrome がアプリとして入れられると判断する ' + JSON.stringify(inst.installabilityErrors));
  ok(/はじめから/.test(await ovText()), 'タイトルが出る');

  // 「アプリとして入れる」ボタン（Chrome の beforeinstallprompt のかわりを送る）
  ok(!/アプリとして入れる/.test(await ovText()), 'Chrome が知らせてくるまでは、入れるボタンは出ない');
  await page.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => { window.__prompted = true; }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e); });
  ok(/アプリとして入れる/.test(await ovText()), '知らせが来ると、タイトルに「アプリとして入れる」が出る');
  await click('設定'); await click('戻る');
  ok(/アプリとして入れる/.test(await ovText()), '設定から戻っても出ている');
  await click('アプリとして入れる'); await page.waitForTimeout(100);
  ok(await page.evaluate(() => window.__prompted === true) && !/アプリとして入れる/.test(await ovText()), '押すと Chrome の確認が出て、ボタンは消える');

  // 遊ぶ・画面を消さない・戻る操作
  await click('はじめから'); await click('進む'); await click('進む');
  ok(await page.evaluate(() => G.mode === 'play'), '遊べる');
  await page.waitForTimeout(1300);
  ok(await page.evaluate(() => __wl.req === 1), '遊んでいる間は、画面を消さないように頼む');
  await page.touchscreen.tap(200, 300); await page.waitForTimeout(50);
  ok(await page.evaluate(() => G.mode === 'play'), '画面に触れても遊びつづける');
  const len = await page.evaluate(() => history.length);
  await page.goBack({ waitUntil: 'commit', timeout: 2000 }).catch(() => { });
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => G.mode === 'pause') && page.url() === URL, '戻る操作では閉じずに、一時停止になる（履歴 ' + len + '）');
  await page.waitForTimeout(1200);
  ok(await page.evaluate(() => __wl.rel === 1), '一時停止すると、画面を消してよいことに戻す');
  await click('つづける'); await page.touchscreen.tap(200, 300);
  await page.evaluate(() => { S.water = 3; saveGame(); });

  // サーバーを止めても開ける
  await new Promise(r => server.close(r)); server = null;
  await page.reload(); await page.waitForTimeout(400);
  ok(/つづきから/.test(await ovText()) && await page.evaluate(() => typeof G === 'object'), 'サーバーを止めても開けて、つづきが残っている');
  await click('つづきから');
  ok(await page.evaluate(() => G.mode === 'play' && S.water === 3), 'つづきから遊べる');

  // 新しい版：サーバーを動かすと入れかわり、止めてもその新しい版のまま
  override = s => s.replace('<title>迷い部屋</title>', '<title>迷い部屋 v2</title>');
  server = await serve(PORT);
  await page.reload(); await page.waitForTimeout(400);
  ok(await page.title() === '迷い部屋 v2', 'サーバーが新しい版を出していれば、新しい版で開く');
  await page.waitForTimeout(300);
  await new Promise(r => server.close(r)); server = null;
  await page.reload(); await page.waitForTimeout(400);
  ok(await page.title() === '迷い部屋 v2', 'そのあとサーバーを止めても、新しい版のまま開く');

  ok(errors.length === 0, 'エラーなし ' + errors.join(' / '));
  await browser.close();
  console.log(fail ? `NG ${fail}` : 'all ok');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
