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

const INTRO = 'いつもの廊下を歩いていた。\n足が、床をすり抜けた。\n\n気がつくと、黄色い部屋にいた。\n湿ったカーペットの匂い。蛍光灯のうなり。\n同じような部屋が、どこまでも続いている。\n\n出口は、どこかにあるはずだ。';
const FLAVOR = [
  '湿ったカーペット。終わらない蛍光灯のうなり。\nどこかで、オルゴールが鳴っている。',
  'コンクリートの柱が、暗がりの奥まで並んでいる。\n遠くで、ラジオの音がする。',
  '熱い配管が鳴る。通路は狭く、曲がりくねっている。\n風の音がする方へ。',
  '明かりは、ほとんど消えている。電池を大切に。\n暗がりで、何かが笑った。',
  '水の音。白いタイル。\nここは、静かだ。',
];

function showTitle() {
  G.mode = 'title'; setPlayUI(false);
  newWorld(0, 20261014); G.demoA = 0.3;
  const sv = loadSave();
  ov(`<div class="logo">迷い部屋</div><div class="logo2">― THE BACKROOMS ―</div>
    <p class="story">現実の床を踏み抜いた先には、<br>黄色い部屋が どこまでも続いていた。</p>
    ${sv ? btn('cont', `つづきから<span class="sub">${LEVELS[sv.lv].n}「${LEVELS[sv.lv].name}」</span>`, 'main') : ''}
    ${btn('new', 'はじめから', sv ? '' : 'main')}
    ${btn('how', '遊び方', 'ghost')}${btn('set', '設定', 'ghost')}
    <p class="small">音が出ます。イヤホンをすすめます。${OPT.clears ? `<br>脱出した回数：${OPT.clears}` : ''}</p>
    ${storageOk() ? '' : '<p class="warn">この画面では、記録が保存されないようだ。</p>'}`, {
    cont: () => { audioInit(); S = sv; enterLevel(S.lv, false); startPlay(); },
    new: () => {
      const go = () => { audioInit(); S = newState(); enterLevel(0, true); saveGame(); showIntro(); };
      if (sv) ask('今の記録は消える。はじめからでよいか？', go, showTitle); else go();
    },
    how: () => showHow(showTitle), set: () => showSettings(showTitle),
  }, 'title');
}
function showIntro() {
  G.mode = 'intro'; setPlayUI(false);
  ov(`<p class="story big">${br(INTRO)}</p>${btn('go', '進む', 'main')}`, { go: () => showCard(0) }, 'dark');
}
function showCard(lv) {
  G.mode = 'card'; setPlayUI(false);
  const L = LEVELS[lv];
  sfx('whoosh');
  ov(`<div class="card"><div class="cn">${L.n}</div><div class="cname">${L.name}</div><p>${br(FLAVOR[lv])}</p></div>${btn('go', '進む', 'main')}`, { go: startPlay }, 'dark');
}
function startPlay() {
  ov(''); G.mode = 'play'; setPlayUI(true);
  G.needDraw = true; audioSuspend(false);
}
function showPause() {
  if (G.mode !== 'play') return;
  G.mode = 'pause'; setPlayUI(false); saveGame();
  ov(`<div class="h">一時停止</div>
    <p class="small">${LEVELS[S.lv].n}「${LEVELS[S.lv].name}」　${fmtTime(S.time)}　捕まった回数 ${S.deaths}</p>
    ${btn('back', 'つづける', 'main')}${btn('notes', `拾ったメモ（${S.notes.length}/${NOTES.length}）`)}
    ${btn('how', '遊び方', 'ghost')}${btn('set', '設定', 'ghost')}${btn('title', 'タイトルへ', 'ghost')}`, {
    back: startPlay, notes: () => showNotes(showPause), how: () => showHow(showPause), set: () => showSettings(showPause),
    title: () => { saveGame(); showTitle(); },
  });
}
function fmtTime(s) { s = Math.floor(s); return `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒`; }
function showNotes(back) {
  const list = S.notes.slice().sort((a, b) => a - b).map(i => `<div class="note"><b>${LEVELS[NOTES[i][0]].n}</b>${br(NOTES[i][1])}</div>`).join('') || '<p class="small">まだ拾っていない。</p>';
  ov(`<div class="h">拾ったメモ</div><div class="notes">${list}</div>${btn('back', '戻る')}`, { back });
}
function showNote(i, picked) {
  G.mode = 'note'; setPlayUI(false);
  ov(`<div class="h">${picked ? 'メモを拾った' : 'メモ'}</div><div class="note paper">${br(NOTES[i][1])}</div>${btn('close', '閉じる', 'main')}`, { close: startPlay });
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
    <p class="small">キーボード：WASD・矢印で移動、Shiftで走る、Fでライト、Qで水、Mで地図、Eで出口、Escで一時停止</p>
    </div>${btn('back', '戻る')}`, { back });
}
function showSettings(back) {
  const q = ['低い', '普通', '高い'];
  ov(`<div class="h">設定</div>
    ${btn('q', `画質：${q[OPT.q]}`)}${btn('sens', `向きを変える速さ：${OPT.sens.toFixed(1)}`)}
    ${btn('vol', `音量：${Math.round(OPT.vol * 100)}%`)}${btn('vib', `振動：${OPT.vib ? 'あり' : 'なし'}`)}
    ${btn('del', '記録を消す', 'danger')}${btn('back', '戻る', 'main')}
    <p class="small">動きがかくかくするときは、画質を下げる。</p>`, {
    q: () => { OPT.q = (OPT.q + 1) % 3; saveOpts(); setupRender($('#view'), OPT.q); G.needDraw = true; showSettings(back); },
    sens: () => { OPT.sens = OPT.sens >= 2 ? 0.5 : Math.round((OPT.sens + 0.25) * 100) / 100; saveOpts(); showSettings(back); },
    vol: () => { OPT.vol = OPT.vol >= 1 ? 0 : Math.round((OPT.vol + 0.2) * 10) / 10; saveOpts(); audioVolume(OPT.vol); showSettings(back); },
    vib: () => { OPT.vib = OPT.vib ? 0 : 1; saveOpts(); vibe(40); showSettings(back); },
    del: () => ask('記録を消して、タイトルに戻る。よいか？', () => { clearSave(); S = null; showTitle(); }, () => showSettings(back)),
    back,
  });
}
function gameOver(kind, ent) {
  G.mode = 'over'; setPlayUI(false);
  sfx('caught'); vibe(450);
  const t = kind === 'lost' ? ['正気を失った', '壁紙の模様が、こちらを見ている。\nもう、どちらが部屋なのか分からない。']
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
  if (S.lv >= LEVELS.length - 1) { showEnding(); return; }
  enterLevel(S.lv + 1, true); saveGame(); showCard(S.lv);
}
function showEnding() {
  G.mode = 'end'; setPlayUI(false);
  OPT.clears = (OPT.clears || 0) + 1; saveOpts();
  const stats = `かかった時間：${fmtTime(S.time)}<br>捕まった回数：${S.deaths}<br>拾ったメモ：${S.notes.length} / ${NOTES.length}`;
  clearSave();
  ov(`<p class="story big">${br('扉を開けると、光があふれた。\n\n風の匂い。鳥の声。\nあなたは、外にいた。\n\n……本当に？\n遠くで、蛍光灯のうなりが聞こえた気がした。')}</p>
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
  $('#lvtag').textContent = `${LEVELS[S.lv].n}　${LEVELS[S.lv].name}`;
  const act = $('#act');
  if (G.nearExit && G.mode === 'play') { act.textContent = WD.cfg.exitVerb; act.style.display = 'block'; } else act.style.display = 'none';
  const ar = $('#arrow');
  if (G.hint > 0 && G.mode === 'play') {
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
