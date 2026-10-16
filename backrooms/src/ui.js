// ===== 画面と操作 =====
const $ = s => document.querySelector(s);
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function br(s) { return esc(s).replace(/\n/g, '<br>'); }

// ---- 重ねる画面 ----
function ov(html, acts, cls) {
  const o = $('#ov');
  o.className = cls || '';
  o.innerHTML = html ? `<div class="panel">${html}</div>` : '';
  o.style.display = html ? 'flex' : 'none';
  o.querySelectorAll('[data-k]').forEach(el => el.addEventListener('click', ev => { ev.stopPropagation(); const f = acts[el.dataset.k]; if (f) f(); }));
}
function ask(text, yes, no) {
  ov(`<p class="story">${br(text)}</p>${btn('y', 'はい', 'main')}${btn('n', 'いいえ', 'ghost')}`, { y: yes, n: no });
}
function btn(k, label, cls) { return `<button class="b ${cls || ''}" data-k="${k}">${label}</button>`; }
let toastT = null;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}
function setPlayUI(on) { document.body.classList.toggle('playing', on); }
function clearToast() { clearTimeout(toastT); $('#toast').classList.remove('show'); }

const INTRO = 'いつもの廊下を歩いていた。\n足が、床をすり抜けた。\n\n気がつくと、黄色い部屋にいた。\n湿ったカーペットの匂い。蛍光灯のうなり。\n同じような部屋が、どこまでも続いている。\n\n出口は、どこかにあるはずだ。';
const FLAVOR = [
  '湿ったカーペット。終わらない蛍光灯のうなり。\nどこかで、オルゴールが鳴っている。',
  'コンクリートの柱が、暗がりの奥まで並んでいる。\n遠くで、ラジオの音がする。',
  '熱い配管が鳴る。通路は狭く、曲がりくねっている。\n風の音がする方へ。',
  '明かりは、ほとんど消えている。電池を大切に。\n暗がりで、何かが笑った。',
  '床が水に沈んでいる。しずくの音。\n上へ続く階段があるらしい。',
  '白線と柱だけが、どこまでも並んでいる。\n遠くで、車の警報が鳴っている。',
  '背表紙の白い本が、天井まで並んでいる。\n時計の音がする。',
  '電源の切れた筐体の列。\nどこかで、電子音のメロディーが流れている。',
  '消毒液の匂い。終わらない廊下。\n心電図の音が、一定の間隔で響く。',
  '水の音。白いタイル。\nここは、静かだ。',
];

function modeLabel(sv) {
  if (sv.mode === 'orig') return `原作版　${fmtTime(sv.time)}`;
  if (THEMES[sv.mode]) { const c = levelCfg(sv.lv, sv.mode); return `${THEMES[sv.mode].title}　${c.n}「${c.name}」`; }
  const c = levelCfg(sv.lv, sv.mode || 'normal');
  return `${sv.mode === 'hard' ? '救いのない版　' : ''}${c.n}「${c.name}」`;
}
function newRun(mode) {
  clearToast(); audioInit(); S = newState(mode); G.warned = false;
  enterLevel(0, true); saveGame(); showIntro();
}
function showTitle() {
  G.mode = 'title'; setPlayUI(false); document.body.dataset.mode = ''; clearToast();
  newWorld(0, 20261014); G.demoA = 0.3;
  const sv = loadSave();
  if (sv && !sv.mode) sv.mode = 'normal';
  const rec = [];
  if (OPT.clears) rec.push(`脱出した回数：${OPT.clears}`);
  if (OPT.hardBest != null) rec.push(`救いのない版：第${OPT.hardBest}層まで`);
  if (OPT.origBest) rec.push(`原作版：${fmtTime(OPT.origBest)} 生き延びた`);
  const start = mode => { if (sv) ask('今の記録は消える。よいか？', () => newRun(mode), showTitle); else newRun(mode); };
  ov(`<div class="logo">迷い部屋</div><div class="logo2">― THE BACKROOMS ―</div>
    <p class="story">現実の床を踏み抜いた先には、<br>黄色い部屋が どこまでも続いていた。</p>
    <div class="bs">${sv ? btn('cont', `つづきから<span class="sub">${modeLabel(sv)}</span>`, 'main wide') : ''}
    ${btn('new', `はじめから<span class="sub">出口を探して、10の層を抜ける</span>`, sv ? '' : 'main')}
    ${btn('more', `ほかの版<span class="sub">救いのない版・原作版・Wiki設定版・五つの報告書・山羊文学版</span>`)}
    ${btn('how', '遊び方', 'ghost')}${btn('set', '設定', 'ghost')}</div>
    <p class="small">音が出ます。イヤホンをすすめます。${rec.length ? '<br>' + rec.join('<br>') : ''}</p>
    ${storageOk() ? (store().kind === 'tasker' ? '<p class="small">記録は Tasker の変数（%BrSave・%BrOpts）に保存する。</p>' : '') : '<p class="warn">この画面では、記録が保存されないようだ。<br>Tasker の WebView の「Allow Phone Access」をオンにすると、保存できるようになる。</p>'}`, {
    cont: () => { audioInit(); S = sv; G.warned = false; enterLevel(S.lv, false); startPlay(); },
    new: () => start('normal'),
    more: () => ov(`<div class="h">ほかの版</div><div class="bs">
      ${btn('hard', `救いのない版<span class="sub">出口の先も、また部屋。死んだら終わり</span>`)}
      ${btn('orig', `原作版<span class="sub">2019年の最初の投稿のとおり。黄色い部屋だけ。出口はない</span>`)}
      ${btn('wiki', `${THEMES.wiki.title}<span class="sub">${THEMES.wiki.sub}</span>`)}
      ${btn('self', `${THEMES.self.title}<span class="sub">${THEMES.self.sub}</span>`)}
      ${btn('yagi', `${THEMES.yagi.title}<span class="sub">${THEMES.yagi.sub}</span>`)}
      ${btn('back', '戻る', 'ghost wide')}</div>`, { hard: () => start('hard'), orig: () => start('orig'), self: () => start('self'), yagi: () => start('yagi'), wiki: () => start('wiki'), back: showTitle }, 'title'),
    how: () => showHow(showTitle), set: () => showSettings(showTitle),
  }, 'title');
}
function showIntro() {
  G.mode = 'intro'; setPlayUI(false);
  if (S.mode === 'orig') {
    ov(`<p class="story big">${br(ORIG_INTRO)}</p>${btn('go', '足を踏み入れる', 'main')}`, { go: () => { sfx('whoosh'); startPlay(); } }, 'dark');
    return;
  }
  const txt = THEMES[S.mode] ? THEMES[S.mode].intro : S.mode === 'hard' ? INTRO + '\n……あるはずだった。' : INTRO;
  const credit = THEMES[S.mode] && THEMES[S.mode].endingSrc && S.mode === 'wiki' ? `<p class="small">${esc(THEMES.wiki.endingSrc)}</p>` : '';
  ov(`<p class="story big">${br(txt)}</p>${credit}${btn('go', '進む', 'main')}`, { go: () => showCard(0) }, 'dark');
}
function showCard(lv) {
  G.mode = 'card'; setPlayUI(false);
  const c = WD.cfg, base = lv % LEVELS.length;
  let fl = FLAVOR[base];
  if (S.mode === 'hard') {
    if (lv >= LEVELS.length || LEVELS[base].calm) fl = H_FLAVOR[base];
    if (lv > 0 && base === 0) fl = '扉を開けると、光があふれた。\n……蛍光灯の光だった。\n\n' + fl;
  }
  let tag = S.mode === 'hard' ? '救いのない版' : '';
  if (THEMES[S.mode]) {
    const L = THEMES[S.mode].levels[lv];
    fl = L.flavor;
    tag = S.mode === 'yagi' ? `――『${L.src}』` : S.mode === 'wiki' ? `${L.en}　生存難易度 ${L.sd}` : `${L.src} の報告書より`;
  }
  sfx('whoosh');
  ov(`<div class="card"><div class="cn">${c.n}</div><div class="cname">${c.name}</div><p>${br(fl)}</p>${tag ? `<div class="small">${esc(tag)}</div>` : ''}</div>${btn('go', '進む', 'main')}`, { go: startPlay }, 'dark');
}
function startPlay() {
  ov(''); G.mode = 'play'; setPlayUI(true); document.body.dataset.mode = S.mode || 'normal';
  G.needDraw = true; audioSuspend(false);
}
function showPause() {
  if (G.mode !== 'play' && G.mode !== 'pause') return;   // 設定・遊び方・メモから戻るときは 'pause' のまま
  G.mode = 'pause'; setPlayUI(false); saveGame();
  const c = WD.cfg;
  const where = S.mode === 'orig' ? `黄色い部屋　${fmtTime(S.time)}` : `${S.mode === 'hard' ? '救いのない版　' : ''}${c.n}「${c.name}」　${fmtTime(S.time)}${S.mode === 'normal' ? `　捕まった回数 ${S.deaths}` : ''}`;
  ov(`<div class="h">一時停止</div>
    <p class="small">${where}</p>
    <div class="bs">${btn('back', 'つづける', 'main wide')}${S.mode === 'orig' ? '' : btn('notes', `拾ったメモ（${S.mode === 'hard' ? S.notes.length : S.notes.length + '/' + noteTotal()}）`)}
    ${btn('how', '遊び方', 'ghost')}${btn('set', '設定', 'ghost')}${btn('title', 'タイトルへ', 'ghost')}</div>`, {
    back: startPlay, notes: () => showNotes(showPause), how: () => showHow(showPause), set: () => showSettings(showPause),
    title: () => { saveGame(); showTitle(); },
  });
}
function noteTotal() { return THEMES[S.mode] ? THEMES[S.mode].levels.reduce((a, L) => a + L.notes.length, 0) : NOTES.length; }
function fmtTime(s) { s = Math.floor(s); return `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒`; }
function showNotes(back) {
  const items = S.notes.map(n => typeof n === 'number' ? { lab: LEVELS[NOTES[n][0]].n, t: NOTES[n][1], k: n } : { lab: n.src || (n.mine ? '見覚えのある字' : ''), t: n.t, k: n.lv != null ? n.lv * 10 + n.i : 0 });
  if (S.mode !== 'hard') items.sort((a, b) => a.k - b.k);
  const list = items.map(n => `<div class="note"><b>${n.lab}</b>${br(n.t)}</div>`).join('') || '<p class="small">まだ拾っていない。</p>';
  ov(`<div class="h">拾ったメモ</div><div class="notes">${list}</div>${btn('back', '戻る')}`, { back });
}
function showNote(text, picked, sub) {
  G.mode = 'note'; setPlayUI(false);
  ov(`<div class="h">${picked ? 'メモを拾った' : 'メモ'}</div>${sub ? `<p class="small">${sub}</p>` : ''}<div class="note paper">${br(text)}</div>${btn('close', '閉じる', 'main')}`, { close: startPlay });
}
function showHow(back) {
  ov(`<div class="h">遊び方</div><div class="how">
    <p><b>画面の左半分</b>を指でなぞると歩く。<b>右半分</b>を左右になぞると向きが変わる。</p>
    <p><b>走</b>：走る（もう一度押すと歩く）。速いが、足音で気づかれる。</p>
    <p><b>灯</b>：懐中電灯。電池が減る。予備の電池は自動で入れ替わる。</p>
    <p><b>水</b>：水を飲む。渇きと正気が戻る。</p>
    <p><b>図</b>：地図の切れ端を使うと、しばらく出口の向きが分かる。</p>
    <p>正気は、暗い所にいたり、何かを見たりすると減る。0になると終わり。喉が渇ききっても減りやすくなる。</p>
    <p>各層のどこかに出口がある。<b>出口の音</b>（オルゴール、ラジオ、風…）が聞こえる方へ。イヤホンだと左右が分かる。</p>
    <p>徘徊者は足音を聞いて寄ってくる。見つかったら走って逃げ、見えない所へ。笑う闇は暗がりにしかいられない。ライトを向けると嫌がる。</p>
    <p>捕まっても、その層の最初からやり直せる。</p>
    <p><b>救いのない版</b>：層は終わらない。光の扉の先も、また黄色い部屋。進むほど暗くなり、怪物は増え、拾える物は減る。水を飲んでも正気は戻らない。捕まったら、そこで終わり。死んだときのことはメモになって、次の自分が拾うことがある。</p>
    <p><b>五つの報告書</b>：5つのAIがあなたについて書いた報告書を、10の層で歩く（1つの報告書に2層ずつ）。床のメモは、その報告書の言葉。追ってくるのは「推測」、暗がりにいるのは「ラベル」。</p>
    <p><b>山羊文学版</b>：山羊文学の作品を、10の層で歩く。床のメモは、作品の言葉。追ってくるのは「山羊」、暗がりにいるのは「笑う山羊」。</p>
    <p>この2つの版では、拾う物はすべて同じ印に見える。拾うまで、水か電池かメモか分からない。</p>
    <p><b>Wiki設定版</b>：2019年の投稿のあと、The Backrooms Wiki で広がった設定で歩く。Level 0「Threshold」から 1・2・3・4・5・6 と下り、Level 26「SS Fun =)」、Level 37「Sublimity」まで9つの Level。水のかわりにアーモンドウォーター（正気がよく戻る）。</p>
    <p>Level 1 では、ときどき灯りがいっせいに消える（フリッカリング）。暗いあいだは明かりをつけず、走らず、緑の非常口の灯りを目指す。スマイラーとデスモスは、光と物音に寄ってくる（ライトを向けても逃げない）。フェイスリングは何もしてこない。Level 6 では明かりがつかない。音を頼りに進む。</p>
    <p class="small">Wiki設定版の設定のもと：The Backrooms Wiki（backrooms-wiki.wikidot.com）の Level 0・1・2・3・4・5・6・26・37 のページ。CC BY-SA 3.0。書いた人の名前は README にある。文章はこのゲームのために書いたもの。</p>
    <p><b>原作版</b>：2019年の最初の投稿に合わせた版。黄色い部屋だけが続き、出口も、持ち物も、正気の表示もない。できるのは歩くことと走ることだけ。しばらくすると「何か」が現れる。それはときどき、あなたの居場所を聞きつける。時間がたつほど、正確に。どれだけ生き延びられるか。</p>
    <p class="small">キーボード：WASD・矢印で移動、Shiftで走る、Fでライト、Qで水、Mで地図、Eで出口、Escで一時停止</p>
    </div>${btn('back', '戻る')}`, { back });
}
function showSettings(back) {
  const q = ['低い', '普通', '高い'];
  ov(`<div class="h">設定</div>
    <div class="bs">${btn('q', `画質：${q[OPT.q]}`)}${btn('sens', `向きを変える速さ：${OPT.sens.toFixed(1)}`)}
    ${btn('vol', `音量：${Math.round(OPT.vol * 100)}%`)}${btn('vib', `振動：${OPT.vib ? 'あり' : 'なし'}`)}
    ${btn('wire', `見た目：${OPT.wire ? '線だけ（ウィザードリィ風）' : 'ふつう'}`)}
    ${btn('icon', `拾う物の絵：${OPT.claude ? 'Claude のマーク' : 'ふつうの絵'}`)}
    ${btn('del', '記録を消す', 'danger')}${btn('back', '戻る', 'main')}</div>
    <p class="small">動きがかくかくするときは、画質を下げる。<br>見た目を「線だけ」にすると、黒い画面に壁のふちだけを線で描く。遊び方は同じ。<br>拾う物の絵は「はじめから」・救いのない版・Wiki設定版で変わる（五つの報告書・山羊文学版はいつも Claude のマーク）。</p>`, {
    q: () => { OPT.q = (OPT.q + 1) % 3; saveOpts(); setupRender($('#view'), OPT.q); G.needDraw = true; showSettings(back); },
    sens: () => { OPT.sens = OPT.sens >= 2 ? 0.5 : Math.round((OPT.sens + 0.25) * 100) / 100; saveOpts(); showSettings(back); },
    vol: () => { OPT.vol = OPT.vol >= 1 ? 0 : Math.round((OPT.vol + 0.2) * 10) / 10; saveOpts(); audioVolume(OPT.vol); showSettings(back); },
    vib: () => { OPT.vib = OPT.vib ? 0 : 1; saveOpts(); vibe(40); showSettings(back); },
    wire: () => { OPT.wire = OPT.wire ? 0 : 1; saveOpts(); G.needDraw = true; showSettings(back); },
    icon: () => { OPT.claude = OPT.claude ? 0 : 1; saveOpts(); G.needDraw = true; showSettings(back); },
    del: () => ask('記録を消して、タイトルに戻る。よいか？', () => { clearSave(); S = null; showTitle(); }, () => showSettings(back)),
    back,
  });
}
function gameOver(kind, ent) {
  G.mode = 'over'; setPlayUI(false); clearToast();
  sfx('caught'); vibe(450);
  if (S.mode === 'orig') {
    const t = S.time;
    OPT.origBest = Math.max(OPT.origBest || 0, Math.floor(t)); saveOpts(); clearSave();
    ov(`<div class="h red">捕まった</div><p class="story">${br('それは、ずっと前から\nあなたの音を聞いていた。')}</p>
      <p class="small">黄色い部屋で生き延びた時間：${fmtTime(t)}<br>いちばん長く生き延びた時間：${fmtTime(OPT.origBest)}</p>
      ${btn('again', 'もう一度', 'main')}${btn('title', 'タイトルへ', 'ghost')}`, { again: () => newRun('orig'), title: () => { S = null; showTitle(); } }, 'over');
    return;
  }
  if (S.mode === 'hard') {
    addGrave(kind); clearSave();
    const h = kind === 'lost' ? ['正気を失った', '壁紙の模様の、ひとつになった。']
      : ent && ent.type === 'grin' ? ['捕まった', '暗闇が耳もとで笑い、\nそれきり、何も見えなくなった。'] : ['捕まった', '背中に、冷たくて長い指が触れた。\nそれきり、蛍光灯のうなりも聞こえなくなった。'];
    ov(`<div class="h red">${h[0]}</div><p class="story">${br(h[1])}</p>
      <p class="small">${WD.cfg.n}まで　${fmtTime(S.time)}<br>あなたの残したメモは、いつか誰かが拾うだろう。</p>
      ${btn('title', 'タイトルへ', 'main')}`, { title: () => { S = null; showTitle(); } }, 'over');
    return;
  }
  const TH = THEMES[S.mode];
  const key = kind === 'lost' ? 'lost' : ent && ent.type === 'grin' ? 'grin' : 'wander', TL = TH && TH.levels[S.lv];
  const t = TH ? ((TL && TL.over && TL.over[key]) || TH.over[key]) : kind === 'lost' ? ['正気を失った', '壁紙の模様が、こちらを見ている。\nもう、どちらが部屋なのか分からない。']
    : ent && ent.type === 'grin' ? ['捕まった', '暗闇が、すぐ耳もとで笑った。'] : ['捕まった', '背中に、冷たくて長い指が触れた。'];
  ov(`<div class="h red">${t[0]}</div><p class="story">${br(t[1])}</p>${btn('retry', 'この層の最初から', 'main')}${btn('title', 'タイトルへ', 'ghost')}`, {
    retry: () => { restartLevel(); showCard(S.lv); },
    title: () => { restartLevel(); showTitle(); },
  }, 'over');
}
function enterExit() {
  if (G.mode !== 'play' || !G.nearExit) return;
  G.mode = 'trans'; G.transT = 0; G.transDone = false; setPlayUI(false);
  sfx('whoosh'); vibe(60);
}
function finishTrans() {
  const last = THEMES[S.mode] ? THEMES[S.mode].levels.length - 1 : LEVELS.length - 1;
  if (S.mode !== 'hard' && S.lv >= last) { showEnding(); return; }
  enterLevel(S.lv + 1, true); saveGame(); showCard(S.lv);
}
function showEnding() {
  G.mode = 'end'; setPlayUI(false);
  OPT.clears = (OPT.clears || 0) + 1; saveOpts();
  const stats = `かかった時間：${fmtTime(S.time)}<br>捕まった回数：${S.deaths}<br>拾ったメモ：${S.notes.length} / ${noteTotal()}`;
  clearSave();
  const TH = THEMES[S.mode];
  const endTxt = TH ? TH.ending : '扉を開けると、光があふれた。\n\n風の匂い。鳥の声。\nあなたは、外にいた。\n\n……本当に？\n遠くで、蛍光灯のうなりが聞こえた気がした。';
  ov(`<p class="story big">${br(endTxt)}</p>${TH && TH.endingSrc ? `<p class="small">${esc(TH.endingSrc)}</p>` : ''}
    <p class="small">${stats}</p>${btn('title', 'タイトルへ', 'main')}`, { title: () => { S = null; showTitle(); } }, 'end');
}

// ---- 画面の上の表示 ----
let hudT = 0;
function hud(dt) {
  hudT -= dt; if (hudT > 0 || !S) return; hudT = 0.12;
  const set = (id, v) => { $(id).style.width = clamp(v, 0, 100) + '%'; };
  set('#b_san', S.san); set('#b_th', S.thirst); set('#b_bat', S.bat); set('#b_st', S.stam);
  $('#b_san').classList.toggle('low', S.san < 30); $('#b_th').classList.toggle('low', S.thirst < 20);
  $('#stamrow').style.opacity = S.stam < 99 ? 1 : 0.35;
  $('#k_run').classList.toggle('on', G.run); $('#k_run').classList.toggle('tired', G.tired);
  $('#k_light').classList.toggle('on', S.flash);
  $('#k_light').querySelector('i').textContent = S.spare ? '+' + S.spare : '';
  $('#k_water').querySelector('i').textContent = S.water; $('#k_water').disabled = !S.water;
  $('#k_map').querySelector('i').textContent = S.maps; $('#k_map').disabled = !S.maps;
  $('#lvtag').textContent = `${WD.cfg.n}　${WD.cfg.name}`;
  const act = $('#act');
  if (G.nearExit && G.mode === 'play') { act.textContent = WD.cfg.exitVerb; act.style.display = 'block'; } else act.style.display = 'none';
  const ar = $('#arrow');
  if (G.hint > 0 && G.mode === 'play' && WD.exit) {
    const ep = exitPoint(), rel = angDiff(Math.atan2(ep.y - S.y, ep.x - S.x), S.a);
    ar.style.display = 'block';
    ar.querySelector('b').style.transform = `rotate(${rel}rad)`;
    ar.querySelector('span').textContent = `出口まで およそ${Math.round(Math.hypot(ep.x - S.x, ep.y - S.y) * 2)}m`;
  } else ar.style.display = 'none';
}

// ---- 操作 ----
const TOUCH = { stick: null, look: null };
function setupInput() {
  const tl = $('#touch'), stick = $('#stick'), knob = $('#knob');
  const R = 52;
  tl.addEventListener('pointerdown', e => {
    if (G.mode !== 'play') return;
    e.preventDefault();
    try { tl.setPointerCapture(e.pointerId); } catch (er) { }
    if (e.clientX < window.innerWidth * 0.5 && !TOUCH.stick) {
      TOUCH.stick = { id: e.pointerId, x: e.clientX, y: e.clientY };
      stick.style.display = 'block'; stick.style.left = e.clientX + 'px'; stick.style.top = e.clientY + 'px';
      knob.style.transform = 'translate(-50%,-50%)';
    } else if (!TOUCH.look) TOUCH.look = { id: e.pointerId, x: e.clientX };
  });
  tl.addEventListener('pointermove', e => {
    if (TOUCH.stick && e.pointerId === TOUCH.stick.id) {
      let dx = e.clientX - TOUCH.stick.x, dy = e.clientY - TOUCH.stick.y;
      const d = Math.hypot(dx, dy); if (d > R) { dx = dx / d * R; dy = dy / d * R; }
      G.in.mx = dx / R; G.in.my = -dy / R;
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    } else if (TOUCH.look && e.pointerId === TOUCH.look.id) {
      G.in.turn += (e.clientX - TOUCH.look.x) * 0.0065 * OPT.sens;
      TOUCH.look.x = e.clientX;
    }
  });
  const end = e => {
    if (TOUCH.stick && e.pointerId === TOUCH.stick.id) { TOUCH.stick = null; G.in.mx = 0; G.in.my = 0; stick.style.display = 'none'; }
    if (TOUCH.look && e.pointerId === TOUCH.look.id) TOUCH.look = null;
  };
  tl.addEventListener('pointerup', end); tl.addEventListener('pointercancel', end);
  const tap = (id, f) => $(id).addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); f(); });
  tap('#k_run', toggleRun); tap('#k_light', toggleFlash); tap('#k_water', drinkWater); tap('#k_map', useMap);
  tap('#act', enterExit); tap('#pausebtn', showPause);
  window.addEventListener('keydown', e => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    G.keys[k] = true;
    if (G.mode === 'play') {
      if (k === 'f') toggleFlash(); else if (k === 'q') drinkWater(); else if (k === 'm') useMap();
      else if (k === 'e' || k === 'Enter') enterExit(); else if (k === 'Escape' || k === 'p') showPause();
      if (k.startsWith('Arrow') || k === ' ') e.preventDefault();
    } else if ((k === 'Escape' || k === 'p') && G.mode === 'pause') startPlay();
  });
  window.addEventListener('keyup', e => { const k = e.key.length === 1 ? e.key.toLowerCase() : e.key; G.keys[k] = false; });
  window.addEventListener('blur', () => { G.keys = {}; });
}
