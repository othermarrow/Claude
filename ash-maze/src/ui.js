// ===== 画面の部品 =====
const $ = s => document.querySelector(s);
const UI = { busy: false, playing: false, skip: null, screen: null };
let ACT = {}, PEND = {}, actN = 0;   // PEND: 作ったばかりで、まだ画面に出していないボタン
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function br(s) { return esc(s).replace(/\n/g, '<br>'); }
function b(label, fn, cls, dis) {
  const id = 'a' + (actN++); PEND[id] = fn;
  return `<button class="btn ${cls || ''}" data-a="${id}"${dis ? ' disabled' : ''}>${label}</button>`;
}
function render(html) { ACT = PEND; PEND = {}; $('#app').innerHTML = html; }
document.addEventListener('click', e => {
  if (UI.playing && UI.skip) { UI.skip(); return; }
  if ($('#ov').childElementCount) return;
  const t = e.target.closest('[data-a]');
  if (!t || t.disabled) return;
  const fn = ACT[t.dataset.a];
  if (fn) fn();
});
function vib(ms) { try { if (S && S.opts.vib && navigator.vibrate) navigator.vibrate(ms); } catch (e) { } }
function wait(ms) { return new Promise(r => { const t = setTimeout(r, ms); UI.skip = () => { clearTimeout(t); UI.skip = null; r(); }; }); }

// ---- モーダル ----
function modal(inner, setup) {
  return new Promise(resolve => {
    const ov = $('#ov');
    const box = document.createElement('div');
    box.className = 'modal';
    box.innerHTML = `<div class="mbox">${inner}</div>`;
    ov.appendChild(box);
    const close = v => { box.remove(); resolve(v); };
    setup(box, close);
  });
}
function alertMsg(text, btn) {
  return modal(`<div class="mtext">${br(text)}</div><div class="mbtns"><button class="btn wide" data-v="ok">${btn || 'OK'}</button></div>`,
    (box, close) => box.querySelector('[data-v]').onclick = () => close(true));
}
function askYesNo(text, yes, no) {
  return modal(`<div class="mtext">${br(text)}</div><div class="mbtns row"><button class="btn" data-v="1">${yes || 'はい'}</button><button class="btn" data-v="0">${no || 'いいえ'}</button></div>`,
    (box, close) => box.querySelectorAll('[data-v]').forEach(el => el.onclick = () => close(el.dataset.v === '1')));
}
// opts: [{label, value, dis, sub}] / 戻る付き
function choose(title, opts, cancel) {
  const tt = typeof title === 'object' ? title.html : br(title);
  const items = opts.map((o, i) => `<button class="btn opt" data-i="${i}"${o.dis ? ' disabled' : ''}>${o.label}${o.sub ? `<span class="sub">${o.sub}</span>` : ''}</button>`).join('');
  return modal(`<div class="mtitle">${tt}</div><div class="mlist">${items}</div>` +
    (cancel !== false ? `<div class="mbtns"><button class="btn wide ghost" data-c="1">${cancel || '戻る'}</button></div>` : ''),
    (box, close) => {
      box.querySelectorAll('[data-i]').forEach(el => el.onclick = () => close(opts[+el.dataset.i].value));
      const c = box.querySelector('[data-c]'); if (c) c.onclick = () => close(null);
    });
}
function inputText(title, def, max) {
  return modal(`<div class="mtitle">${br(title)}</div><input class="inp" maxlength="${max || 8}" value="${esc(def || '')}"><div class="mbtns row"><button class="btn" data-v="1">決める</button><button class="btn ghost" data-v="0">戻る</button></div>`,
    (box, close) => {
      const inp = box.querySelector('input');
      setTimeout(() => inp.focus(), 50);
      box.querySelectorAll('[data-v]').forEach(el => el.onclick = () => close(el.dataset.v === '1' ? inp.value.trim() : null));
    });
}
function textArea(title, val, ro) {
  return modal(`<div class="mtitle">${br(title)}</div><textarea class="ta"${ro ? ' readonly' : ''}>${esc(val || '')}</textarea><div class="mbtns row">${ro ? '<button class="btn" data-v="copy">写す</button>' : '<button class="btn" data-v="1">読み込む</button>'}<button class="btn ghost" data-v="0">閉じる</button></div>`,
    (box, close) => {
      const ta = box.querySelector('textarea');
      box.querySelectorAll('[data-v]').forEach(el => el.onclick = () => {
        if (el.dataset.v === 'copy') {
          ta.select();
          try { navigator.clipboard.writeText(ta.value).then(() => el.textContent = '写した', () => { document.execCommand('copy'); el.textContent = '写した'; }); }
          catch (e) { try { document.execCommand('copy'); el.textContent = '写した'; } catch (e2) { } }
          return;
        }
        close(el.dataset.v === '1' ? ta.value : null);
      });
    });
}
async function pickChar(title, chars, sub) {
  if (!chars.length) return null;
  return choose(title, chars.map(c => ({ label: esc(c.name), sub: sub ? sub(c) : `${CLS[c.cls].n} Lv${c.lv} ${statusText(c) || 'HP' + c.hp}`, value: c })));
}

// ---- メッセージ欄 ----
function setMsg(t) { const m = $('#msg'); if (m) m.innerHTML = t ? `<div>${br(t)}</div>` : ''; }
function addMsg(t) {
  const m = $('#msg'); if (!m) return;
  const d = document.createElement('div'); d.innerHTML = br(t); m.appendChild(d);
  while (m.childElementCount > 40) m.firstChild.remove();
  m.scrollTop = m.scrollHeight;
}
const SPEED = [1100, 650, 300];
async function play(list, keep) {
  if (!list || !list.length) return;
  UI.playing = true;
  if (!keep) setMsg('');
  for (const it of list) {
    const t = typeof it === 'string' ? it : it.t;
    addMsg(t);
    if (it.snap) {
      const prev = UI.lastSnap;
      if (prev && it.snap.p.some((p, i) => prev.p[i] && p.hp < prev.p[i].hp)) vib(40);
      applySnap(it.snap);
    }
    await wait(SPEED[S.opts.speed] || 650);
  }
  UI.playing = false; UI.skip = null;
}
function applySnap(sn) {
  UI.lastSnap = sn;
  const el = $('#party'); if (el) el.innerHTML = partyRows(sn.p);
  const g = $('#enemies'); if (g && sn.g) g.innerHTML = enemyRows(sn.g);
}

// ---- パーティ表 ----
function partyRows(snapP) {
  const ps = partyChars();
  if (!ps.length) return '<div class="empty">パーティに誰もいない</div>';
  return ps.map((c, i) => {
    const s = snapP && snapP[i] ? snapP[i] : { hp: c.hp, st: c.status, poison: c.poison };
    const stt = s.st !== 'ok' ? STATUS_N[s.st] : s.poison ? '毒' : '';
    const low = s.st === 'ok' && s.hp < c.mhp * 0.3;
    return `<div class="prow ${s.st !== 'ok' && s.st !== 'sleep' ? 'down' : ''} ${low ? 'low' : ''}" data-ci="${i}">
      <span class="pn">${i + 1}${i < 3 ? '' : '<i>後</i>'} ${esc(c.name)}</span>
      <span class="pc">${ALIGNS[c.al][0]}-${CLS[c.cls].s}${c.lv}</span>
      <span class="pa">${charAC(c) - (typeof B !== 'undefined' && B && B.cs[c.id] ? B.cs[c.id].ac : 0)}</span>
      <span class="ph">${s.hp}/${c.mhp}</span>
      <span class="ps">${stt}</span></div>`;
  }).join('');
}
function partyBox() {
  return `<div class="ptable"><div class="prow head"><span class="pn">名前</span><span class="pc">職</span><span class="pa">AC</span><span class="ph">HP</span><span class="ps">状態</span></div><div id="party">${partyRows()}</div></div>`;
}
function enemyRows(gs) {
  if (!gs.length) return '<div class="erow">敵はいない</div>';
  return gs.map((g, i) => `<div class="erow"><span>${i + 1}) ${esc(g.n)}</span><span>×${g.a}${g.s ? `（眠り${g.s}）` : ''}</span></div>`).join('');
}
function header(title, extra) {
  return `<div class="hdr"><span>${title}</span><span>${extra || ''}</span></div>`;
}
function goldText() { return `所持金 ${S.gold}G`; }

// ---- キャラクターの詳細 ----
function charSheetHtml(c) {
  const race = RACES.find(r => r.id === c.race);
  const next = expNeed(c, c.lv + 1);
  const stat = c.st.map((v, i) => `<div><b>${STATS[i]}</b> ${v}</div>`).join('');
  const m = maxSlots(c, 'm'), p = maxSlots(c, 'p');
  const sl = (a, b) => a.some(v => v) ? a.map((v, i) => `${b[i]}/${v}`).join(' ') : 'なし';
  const sp = knownSpells(c).map(s => s.n).join('・') || 'なし';
  return `<div class="sheet">
    <div class="sh1">${esc(c.name)}${c.honor ? ' ★' : ''}</div>
    <div>${ALIGNS[c.al]}の${race.n}　${CLS[c.cls].n}　レベル${c.lv}</div>
    <div>HP ${c.hp}/${c.mhp}　AC ${charAC(c)}　${statusText(c) || '健康'}</div>
    <div>経験値 ${c.exp}（次まで ${Math.max(0, next - c.exp)}）　倒した数 ${c.kills || 0}</div>
    <div class="stats">${stat}</div>
    <div>魔術 ${sl(c.mp.m, m)}</div><div>祈祷 ${sl(c.mp.p, p)}</div>
    <div class="small">覚えた呪文：${sp}</div>
  </div>`;
}
function itemLine(it) {
  const d = IT[it.id];
  return `${it.eq ? '<b class="eq">装</b>' : '<span class="eq0">・</span>'}${esc(itemName(it))}${it.cur ? '<span class="cur">呪</span>' : ''}<span class="sub">${KIND_N[d.kind]}</span>`;
}
// where: 'town' | 'camp'
async function charSheet(c, where) {
  for (;;) {
    const opts = c.items.map((it, i) => ({ label: itemLine(it), value: i }));
    const r = await choose({ html: charSheetHtml(c) + '<div class="mtitle2">持ち物（押すと使い方を選べる）</div>' }, opts.length ? opts : [{ label: '持ち物はない', value: -1, dis: true }], '閉じる');
    if (r === null) return;
    await itemMenu(c, r, where);
    saveGame();
    if (where === 'camp' && typeof refreshCamp === 'function') refreshCamp();
  }
}
async function itemMenu(c, idx, where) {
  const it = c.items[idx]; if (!it) return;
  const d = IT[it.id];
  const o = [];
  if (EQ_KINDS.includes(d.kind)) o.push(it.eq ? { label: '外す', value: 'un' } : { label: '装備する', value: 'eq', dis: !canEquipCls(c, d) || isDown(c) });
  if (d.use) o.push({ label: '使う', value: 'use', dis: where !== 'camp' || !SP[d.use].w.includes('c') || !canAct(c) });
  if (d.kind !== 'key') o.push({ label: '仲間に渡す', value: 'give', dis: !!it.eq });
  if (!it.idf && d.kind !== 'key') o.push({ label: '司教が鑑定する', value: 'ident' });
  if (d.kind !== 'key') o.push({ label: '捨てる', value: 'drop', dis: !!it.eq });
  const info = it.idf ? itemInfo(d) : 'まだ正体がわからない。';
  const r = await choose(`${itemName(it)}\n${info}`, o);
  if (!r) return;
  if (r === 'eq') await alertMsg(equipItem(c, idx));
  else if (r === 'un') await alertMsg(unequipItem(c, idx));
  else if (r === 'give') {
    const others = (where === 'camp' ? partyChars() : partyChars().concat(S.roster.filter(inTown))).filter(x => x !== c);
    const t = await pickChar('誰に渡す？', others, x => `持ち物 ${x.items.length}/${MAXI}`);
    if (!t) return;
    if (t.items.length >= MAXI) { await alertMsg(`${t.name}は もう持てない。`); return; }
    c.items.splice(idx, 1); t.items.push(it);
    await alertMsg(`${t.name}に 渡した。`);
  } else if (r === 'drop') {
    if (await askYesNo(`${itemName(it)}を 捨てるか？`)) c.items.splice(idx, 1);
  } else if (r === 'ident') {
    const bs = (where === 'camp' ? partyChars() : partyChars().concat(S.roster.filter(inTown))).filter(x => CLS[x.cls].ident && canAct(x));
    if (!bs.length) { await alertMsg('鑑定できる司教がいない。'); return; }
    const bi = bs.length === 1 ? bs[0] : await pickChar('誰が鑑定する？', bs, x => `成功率 ${identifyChance(x)}%`);
    if (!bi) return;
    if (pct(identifyChance(bi))) { it.idf = 1; await alertMsg(`${bi.name}は 鑑定した。\nこれは ${d.n}だ。`); }
    else await alertMsg(`${bi.name}にも わからなかった。`);
  } else if (r === 'use') {
    await useItemCamp(c, idx);
  }
}
function itemInfo(d) {
  const a = [];
  if (d.dmg) a.push(`威力 ${dstr(d.dmg)}`);
  if (d.hit) a.push(`命中 ${d.hit > 0 ? '+' : ''}${d.hit}`);
  if (d.ac) a.push(`AC ${d.ac > 0 ? '-' : '+'}${Math.abs(d.ac)}`);
  if (d.use) a.push(`使うと「${SP[d.use].n}」`);
  if (d.regen) a.push('歩くとHPが回復');
  if (d.drain) a.push('歩くとHPが減る');
  if (d.noPoison) a.push('毒を防ぐ');
  if (d.noDrain) a.push('生気を吸われない');
  if (d.vsU) a.push('不死の敵に強い');
  if (d.vsR) a.push('竜に強い');
  if (d.crit) a.push('急所を突きやすい');
  if (d.curse) a.push('呪われている');
  if (d.kind !== 'key' && d.kind !== 'use') a.push('装備：' + (d.cls === ALLC ? '全員' : d.cls));
  return a.join('　');
}
