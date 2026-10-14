// ===== タイトル・町 =====
document.addEventListener('click', e => {
  const r = e.target.closest('.prow[data-ci]');
  if (!r || UI.busy || UI.playing || $('#ov').childElementCount || !UI.rowClick) return;
  UI.rowClick(+r.dataset.ci);
});

const STORY = '城の地下に広がる「灰の迷宮」。\n王の宝珠を奪った魔導師ヴァルガは、その最も深い10階に潜んでいる。\n王は告げた。宝珠を取り戻した者に、栄誉を与えると。';

function scrTitle() {
  UI.screen = 'title'; UI.rowClick = null;
  const sv = loadGame();
  render(`<div class="title">
    <div class="logo">灰の迷宮</div><div class="logo2">― ASH LABYRINTH ―</div>
    <div class="story">${br(STORY)}</div>
    ${storageOk() ? '' : '<div class="note warn">この画面では 自動保存が使えないようだ。<br>こまめに「町外れ」の「記録を書き出す」で控えを作っておこう。</div>'}
    ${taskerFn('writeFile') ? '<div class="note small">Tasker のファイルにも保存する：Download/ash-maze-save.json</div>' : ''}
    <div class="menu">
      ${sv ? b('つづきから', () => { S = fixState(sv); resume(); }) : ''}
      ${b('はじめから', newGame)}
      ${b('記録を読み込む', importFlow, 'ghost')}
      ${b('遊び方', howTo, 'ghost')}
    </div></div>`);
}
function resume() {
  if (S.inMaze) scrMaze('迷宮の中から 再開した。');
  else scrTown();
}
async function newGame() {
  if (loadGame() && !await askYesNo('今の記録は消える。はじめからでよいか？')) return;
  S = newState();
  saveGame();
  if (await askYesNo('最初の仲間を おまかせで6人作るか？\n（「いいえ」なら訓練場で自分で作る）')) {
    autoParty();
    saveGame();
    await alertMsg('6人の冒険者が 酒場に集まった。\n宿屋や商店で準備をして、町外れから迷宮へ向かおう。');
  } else {
    await alertMsg('まずは訓練場で 冒険者を作ろう。\n作ったら、酒場でパーティに入れる。');
  }
  scrTown();
}
async function importFlow() {
  const t = await textArea('書き出した記録の文字を 貼り付けて「読み込む」を押す。', '', false);
  if (!t) return;
  try {
    S = fixState(importSave(t));
    saveGame();
    await alertMsg('記録を読み込んだ。');
    resume();
  } catch (e) { await alertMsg('読み込めなかった。\n' + e.message); }
}
async function howTo() {
  await alertMsg(`【遊び方】
・町：訓練場で冒険者を作り、酒場で最大6人のパーティを組む。前の3人が戦い、後ろの3人は呪文や道具を使う。
・宿屋：休むと呪文が戻り、経験値がたまっていればレベルが上がる。HPは客室でないと戻らない。
・迷宮：ボタンで前へ進む・向きを変える。地図は自動で記録される。
・扉の奥の部屋には番をする者がいて、倒すと宝箱が出る。宝箱の罠は、盗賊に調べさせてから外すとよい。
・全滅すると、遺体は迷宮に残る。別のパーティで同じ場所へ行けば連れて帰れる。
・寺院で死んだ仲間を生き返らせられるが、失敗すると灰になる。
・記録は自動でこの端末に保存される。「町外れ」から書き出すと控えが作れる。`, 'わかった');
}

function scrTown(note) {
  UI.screen = 'town'; UI.rowClick = i => charSheet(partyChars()[i], 'town').then(() => scrTown());
  render(`${header('城下町', goldText())}${partyBox()}
    <div class="note">${note ? br(note) : 'どこへ行こう？'}</div>
    <div class="menu grid2">
      ${b('酒場', scrTavern)}${b('宿屋', scrInn)}${b('商店', scrShop)}${b('寺院', scrTemple)}${b('訓練場', scrTraining)}${b('町外れ', scrEdge)}
    </div>
    <div class="menu">${b('設定', scrSettings, 'ghost')}</div>`);
}

// ---- 酒場 ----
function scrTavern(note) {
  UI.screen = 'tavern'; UI.rowClick = i => charSheet(partyChars()[i], 'town').then(() => scrTavern());
  const waiting = S.roster.filter(inTown);
  render(`${header('酒場', goldText())}${partyBox()}
    <div class="note">${note ? br(note) : `待っている仲間：${waiting.length}人。名前を押すと詳しく見られる。`}</div>
    <div class="menu grid2">
      ${b('仲間に入れる', tavernAdd, '', S.party.length >= MAXP || !waiting.length)}
      ${b('外す', tavernRemove, '', !S.party.length)}
      ${b('並べ替え', async () => { await reorderParty(); scrTavern(); }, '', S.party.length < 2)}
      ${b('待っている者を見る', async () => { const c = await pickChar('誰を見る？', waiting); if (c) await charSheet(c, 'town'); scrTavern(); }, '', !waiting.length)}
    </div>
    <div class="menu">${b('町に戻る', () => scrTown(), 'ghost')}</div>`);
}
function alignClash(c) {
  const als = partyChars().map(x => x.al);
  return (c.al === 0 && als.includes(2)) || (c.al === 2 && als.includes(0));
}
async function tavernAdd() {
  for (;;) {
    const waiting = S.roster.filter(inTown);
    if (S.party.length >= MAXP || !waiting.length) break;
    const c = await pickChar('誰を仲間に入れる？', waiting, x => `${ALIGNS[x.al]} ${CLS[x.cls].n} Lv${x.lv} ${statusText(x)}`);
    if (!c) break;
    if (alignClash(c)) { await alertMsg('善の者と悪の者は、一緒に行こうとしない。'); continue; }
    S.party.push(c.id); saveGame();
    scrTavern(`${c.name}が 仲間に入った。`);
  }
  scrTavern();
}
async function tavernRemove() {
  const c = await pickChar('誰を外す？', partyChars());
  if (!c) return;
  S.party = S.party.filter(id => id !== c.id); saveGame();
  scrTavern(`${c.name}は 酒場で待つことにした。`);
}
async function reorderParty() {
  const left = partyChars().slice(), order = [];
  while (left.length > 1) {
    const c = await pickChar(`${order.length + 1}番目は誰？\n（1〜3番目が前に出て戦う）`, left);
    if (!c) return;
    order.push(c); left.splice(left.indexOf(c), 1);
  }
  order.push(left[0]);
  S.party = order.map(c => c.id); saveGame();
}

// ---- 宿屋 ----
function innRoomCost() { return partyChars().filter(c => !isDown(c)).reduce((a, c) => a + c.lv * 10, 0); }
function scrInn(note) {
  UI.screen = 'inn'; UI.rowClick = null;
  const cost = innRoomCost();
  render(`${header('宿屋', goldText())}${partyBox()}
    <div class="note">${note ? br(note) : '馬小屋なら ただ。客室ならHPも戻る。\n休むと呪文が戻り、レベルが上がる者がいれば上がる。'}</div>
    <div class="menu">
      ${b('馬小屋で休む（無料）', () => innStay(0), '', !S.party.length)}
      ${b(`客室で休む（${cost}G）`, () => innStay(1), '', !S.party.length || S.gold < cost)}
      ${b('町に戻る', () => scrTown(), 'ghost')}
    </div>`);
}
async function innStay(room) {
  const cost = room ? innRoomCost() : 0;
  if (S.gold < cost) return;
  S.gold -= cost;
  UI.busy = true;
  const msgs = stayInn(room);
  saveGame();
  scrInn(' ');
  await play([room ? '一行は 客室で ぐっすり眠った。' : '一行は 馬小屋の わらの上で眠った。', ...msgs]);
  UI.busy = false;
  scrInn(msgs.filter(m => /レベル|呪文/.test(m)).join('\n') || 'よく休んだ。');
}

// ---- 商店 ----
function shopMembers() { return S.party.length ? partyChars() : S.roster.filter(inTown); }
function scrShop(note) {
  UI.screen = 'shop'; UI.rowClick = null;
  render(`${header('商店', goldText())}${partyBox()}
    <div class="note">${note ? br(note) : '「いらっしゃい。何にする？」'}</div>
    <div class="menu grid2">
      ${b('買う', shopBuy)}${b('売る', shopSell)}${b('鑑定してもらう', shopIdent)}${b('呪いを解く', shopUncurse)}
    </div>
    <div class="menu">${b('町に戻る', () => scrTown(), 'ghost')}</div>`);
}
async function shopBuy() {
  const who = await pickChar('誰が買う？', shopMembers().filter(c => !isGone(c)), c => `持ち物 ${c.items.length}/${MAXI}`);
  if (!who) return;
  for (;;) {
    const list = shopList().sort((a, b) => EQ_KINDS.concat(['use']).indexOf(a.kind) - EQ_KINDS.concat(['use']).indexOf(b.kind) || a.price - b.price);
    const opts = list.map(d => {
      const ok = d.kind === 'use' || canEquipCls(who, d);
      const stock = d.dep ? `　残り${S.shop[d.id]}` : '';
      return { label: `${ok ? '' : '<span class="ng">×</span>'}${d.n}　<b>${d.price}G</b>`, sub: `${KIND_N[d.kind]}　${itemInfo(d)}${stock}`, value: d };
    });
    const d = await choose(`${who.name}が買う（所持金 ${S.gold}G・持ち物 ${who.items.length}/${MAXI}）\n×は${CLS[who.cls].n}には装備できない`, opts);
    if (!d) break;
    if (S.gold < d.price) { await alertMsg('「お金が足りないね」'); continue; }
    if (who.items.length >= MAXI) { await alertMsg(`${who.name}は もう持てない。`); continue; }
    S.gold -= d.price; addItem(who, d.id, 1);
    if (d.dep) S.shop[d.id]--;
    if (EQ_KINDS.includes(d.kind) && canEquipCls(who, d) && await askYesNo(`${d.n}を買った。\nすぐに装備するか？`)) await alertMsg(equipItem(who, who.items.length - 1));
    saveGame();
  }
  scrShop();
}
async function shopSell() {
  const who = await pickChar('誰が売る？', shopMembers().filter(c => c.items.length), c => `持ち物 ${c.items.length}/${MAXI}`);
  if (!who) return;
  for (;;) {
    const opts = who.items.map((it, i) => ({ label: itemLine(it), sub: it.eq ? '装備中' : IT[it.id].kind === 'key' ? '売れない' : `${sellPrice(it)}G${it.idf ? '' : '（正体不明なので安い）'}`, value: i, dis: !!it.eq || IT[it.id].kind === 'key' }));
    if (!opts.length) break;
    const i = await choose(`${who.name}が売る（所持金 ${S.gold}G）`, opts);
    if (i === null) break;
    const it = who.items[i], p = sellPrice(it);
    if (!await askYesNo(`${itemName(it)}を ${p}Gで売るか？`)) continue;
    who.items.splice(i, 1); S.gold += p;
    if (IT[it.id].dep) S.shop[it.id] = (S.shop[it.id] || 0) + 1;
    saveGame();
  }
  scrShop();
}
async function shopIdent() {
  const who = await pickChar('誰の持ち物を鑑定する？', shopMembers().filter(c => c.items.some(i => !i.idf)));
  if (!who) { scrShop('鑑定する物がない。'); return; }
  for (;;) {
    const opts = who.items.map((it, i) => ({ it, i })).filter(o => !o.it.idf).map(o => ({ label: itemLine(o.it), sub: `鑑定料 ${Math.max(10, Math.floor(IT[o.it.id].price / 2))}G`, value: o.i }));
    if (!opts.length) break;
    const i = await choose(`鑑定する（所持金 ${S.gold}G）`, opts);
    if (i === null) break;
    const it = who.items[i], cost = Math.max(10, Math.floor(IT[it.id].price / 2));
    if (S.gold < cost) { await alertMsg('「お金が足りないね」'); continue; }
    S.gold -= cost; it.idf = 1; saveGame();
    await alertMsg(`「これは ${IT[it.id].n}だね」\n${itemInfo(IT[it.id])}`);
  }
  scrShop();
}
async function shopUncurse() {
  const who = await pickChar('誰の呪いを解く？', shopMembers().filter(c => c.items.some(i => i.cur)));
  if (!who) { scrShop('呪われた物を 身につけている者はいない。'); return; }
  const it = who.items.find(i => i.cur), cost = Math.max(100, IT[it.id].price);
  if (!await askYesNo(`${IT[it.id].n}の呪いを解く。品物は なくなる。\n代金は ${cost}G。よいか？`)) return;
  if (S.gold < cost) { await alertMsg('「お金が足りないね」'); return; }
  S.gold -= cost; who.items.splice(who.items.indexOf(it), 1); saveGame();
  scrShop(`${who.name}の呪いが解けた。`);
}

// ---- 寺院 ----
function scrTemple(note) {
  UI.screen = 'temple'; UI.rowClick = null;
  const need = partyChars().concat(S.roster.filter(inTown)).filter(c => templeCost(c) > 0);
  render(`${header('寺院', goldText())}${partyBox()}
    <div class="note">${note ? br(note) : need.length ? '「誰を救いたいのですか？」' : '「今は 救いの要る者は いないようです」'}</div>
    <div class="menu">
      ${b('治療を頼む', templeAsk, '', !need.length)}
      ${b('町に戻る', () => scrTown(), 'ghost')}
    </div>`);
}
async function templeAsk() {
  const need = partyChars().concat(S.roster.filter(inTown)).filter(c => templeCost(c) > 0);
  const c = await pickChar('誰を治療する？', need, x => `${STATUS_N[x.status]}　寄付 ${templeCost(x)}G`);
  if (!c) return;
  const cost = templeCost(c);
  if (S.gold < cost) { await alertMsg(`寄付が ${cost}G 要る。お金が足りない。`); return; }
  if (c.status === 'dead' || c.status === 'ash') {
    if (!await askYesNo(`寄付 ${cost}Gで ${c.name}の蘇生を祈る。\n失敗すると${c.status === 'dead' ? '灰になる' : '永遠に失われる'}。よいか？`)) return;
  }
  S.gold -= cost;
  UI.busy = true;
  scrTemple(' ');
  const msgs = ['僧侶たちが 祈りを捧げている……', ...templeHeal(c)];
  const lost = removeLost();
  saveGame();
  await play(msgs);
  UI.busy = false;
  scrTemple(msgs[msgs.length - 1] + (lost.length ? '\n（名簿から消えた）' : ''));
}

// ---- 訓練場 ----
function scrTraining(note) {
  UI.screen = 'training'; UI.rowClick = null;
  render(`${header('訓練場', goldText())}
    <div class="note">${note ? br(note) : `名簿：${S.roster.length}人`}</div>
    <div class="menu">
      ${b('冒険者を作る', createChar)}
      ${b('おまかせで6人作る', async () => { if (await askYesNo('戦士2・僧侶・盗賊・魔術師・司教の6人を、基本の装備つきで作る。\n（パーティに空きがあれば加える）よいか？')) { autoParty(); saveGame(); scrTraining('6人を作った。'); } })}
      ${b('転職する', classChange, '', !S.roster.length)}
      ${b('名前を変える', rename, '', !S.roster.length)}
      ${b('名簿を見る', rosterView, '', !S.roster.length)}
      ${b('名簿から消す', deleteChar, '', !S.roster.filter(inTown).length)}
      ${b('町に戻る', () => scrTown(), 'ghost')}
    </div>`);
}
function whereText(c) {
  if (c.maze) return `迷宮 B${c.maze.f}F`;
  return S.party.includes(c.id) ? 'パーティ' : '酒場';
}
async function rosterView() {
  const c = await pickChar('名簿', S.roster, x => `${ALIGNS[x.al]} ${CLS[x.cls].n} Lv${x.lv}　${statusText(x) || ''}　${whereText(x)}`);
  if (c) await charSheet(c, 'town');
  scrTraining();
}
async function rename() {
  const c = await pickChar('誰の名前を変える？', S.roster.filter(x => !x.maze));
  if (!c) return;
  const n = await inputText('新しい名前は？（8文字まで）', c.name);
  if (n) { c.name = n; saveGame(); }
  scrTraining();
}
async function deleteChar() {
  const c = await pickChar('誰を名簿から消す？（酒場で待っている者だけ）', S.roster.filter(inTown));
  if (!c) return;
  if (!await askYesNo(`${c.name}を 名簿から消す。\n持ち物も なくなる。本当によいか？`)) return;
  S.roster = S.roster.filter(x => x !== c); saveGame();
  scrTraining(`${c.name}は 去っていった。`);
}
async function classChange() {
  const c = await pickChar('誰が転職する？', S.roster.filter(x => !x.maze && x.status === 'ok'), x => `${CLS[x.cls].n} Lv${x.lv}`);
  if (!c) return;
  const opts = CLASSES.filter(k => k.id !== c.cls).map(k => ({ label: k.n, sub: classOk(k, c.st, c.al) ? '' : '条件が足りない', value: k, dis: !classOk(k, c.st, c.al) }));
  const k = await choose(`${c.name}の新しい職業は？\n転職するとレベル1に戻り、能力値は種族の初期値になる。\nHPと覚えた呪文は残る。装備は外れる。`, opts);
  if (!k) return;
  if (!await askYesNo(`${c.name}を ${k.n}に転職させるか？`)) return;
  for (const s of ['m', 'p']) { const mx = maxSlots(c, s); c.keep[s] = c.keep[s].map((v, i) => Math.max(v, mx[i])); }
  c.cls = k.id; c.lv = 1; c.exp = 0;
  c.st = RACES.find(r => r.id === c.race).base.slice();
  for (const it of c.items) if (!it.cur) it.eq = 0;
  restoreMp(c); saveGame();
  scrTraining(`${c.name}は ${k.n}になった。`);
}

// ---- 冒険者を作る ----
async function createChar() {
  const name = await inputText('名前は？（8文字まで）', '');
  if (!name) return;
  if (S.roster.some(c => c.name === name)) { await alertMsg('同じ名前の者がいる。'); return; }
  const race = await choose('種族は？', RACES.map(r => ({ label: r.n, sub: r.base.map((v, i) => ST_SHORT[i] + v).join(' '), value: r })));
  if (!race) return;
  const al = await choose('性格は？', ALIGNS.map((a, i) => ({ label: a, sub: ['僧侶・司教・君主になれる', '盗賊・侍になれる', '盗賊・忍者・僧侶になれる'][i], value: String(i) })));
  if (al === null) return;
  UI.cr = { name, race, al: +al, bonus: rollBonus(), add: [0, 0, 0, 0, 0, 0] };
  scrAlloc();
}
function crStats() { return UI.cr.race.base.map((v, i) => v + UI.cr.add[i]); }
function scrAlloc() {
  UI.screen = 'alloc'; UI.rowClick = null;
  const cr = UI.cr, st = crStats();
  const left = cr.bonus - cr.add.reduce((a, v) => a + v, 0);
  const ok = CLASSES.filter(k => classOk(k, st, cr.al));
  const rows = STATS.map((n, i) => `<div class="arow"><span class="an">${n}</span><span class="av">${st[i]}</span>
    ${b('－', () => { if (cr.add[i] > 0) { cr.add[i]--; scrAlloc(); } }, 'sm', cr.add[i] <= 0)}
    ${b('＋', () => { if (left > 0 && st[i] < 18) { cr.add[i]++; scrAlloc(); } }, 'sm', left <= 0 || st[i] >= 18)}</div>`).join('');
  const allMax = st.every(v => v >= 18);
  render(`${header('訓練場', '能力を決める')}
    <div class="note">${esc(cr.name)}　${ALIGNS[cr.al]}の${cr.race.n}<br>ボーナス <b class="big">${left}</b> / ${cr.bonus} 点</div>
    <div class="alloc">${rows}</div>
    <div class="note small">なれる職業：${ok.map(k => k.n).join('・') || 'なし'}</div>
    <div class="menu">
      ${b('職業を決める', pickClass, '', !ok.length || (left > 0 && !allMax))}
      ${b('ボーナスを振り直す', () => { cr.bonus = rollBonus(); cr.add = [0, 0, 0, 0, 0, 0]; scrAlloc(); }, 'ghost')}
      ${b('やめる', () => scrTraining(), 'ghost')}
    </div>
    <div class="note small">ボーナスを全部使うと、職業を選べる。君主や忍者には高い能力が要る。振り直しは何度でもできる。</div>`);
}
async function pickClass() {
  const cr = UI.cr, st = crStats();
  const k = await choose('職業は？', CLASSES.map(x => ({ label: x.n, sub: classDesc(x), value: x, dis: !classOk(x, st, cr.al) })));
  if (!k) return;
  const c = newChar(cr.name, cr.race.id, cr.al, st, k.id);
  const g = ri(90, 190);
  S.roster.push(c); S.gold += g;
  let joined = false;
  if (S.party.length < MAXP && !alignClash(c)) { S.party.push(c.id); joined = true; }
  saveGame();
  scrTraining(`${c.name}（${k.n}）が 名簿に加わった。持参金 ${g}G。${joined ? '\nパーティに入った。' : '\n酒場で待っている。'}`);
}
function classDesc(k) {
  return {
    FIG: '戦いの専門家。HPが高い', MAG: '攻撃の呪文を使う。体は弱い', PRI: '回復の呪文を使う。不死の敵をはらう',
    THI: '宝箱の罠を外すのが得意', BIS: '両方の呪文を覚える（遅い）。鑑定ができる', SAM: '強い戦士。魔術の呪文も覚える',
    LOR: '強い戦士。祈祷の呪文も覚える', NIN: '素手で急所を突く。罠も外せる',
  }[k.id];
}
const AUTO_NAMES = ['アレス', 'ボルグ', 'セラ', 'リュカ', 'ミーナ', 'ノエル', 'ガルド', 'エリン', 'トーマ', 'ユーリ', 'カイ', 'リラ', 'ダン', 'フィオ', 'オルン', 'シエラ'];
function autoParty() {
  const spec = [['FIG', 'hum', 1, [0, 3, 4]], ['FIG', 'dwa', 1, [0, 3, 4]], ['PRI', 'dwa', 0, [2, 3, 0]], ['THI', 'hob', 1, [4, 5, 3]], ['MAG', 'elf', 1, [1, 4, 3]], ['BIS', 'elf', 0, [1, 2, 3]]];
  // おまかせの6人には、最初から基本の装備を持たせる
  const gear = { FIG: ['w05', 'a02', 's01'], PRI: ['w03', 'a02', 's01', 'u01'], THI: ['w04', 'a02', 's01'], MAG: ['w02', 'a01'], BIS: ['w02', 'a01'] };
  const used = new Set(S.roster.map(c => c.name));
  for (const [cls, race, al, prio] of spec) {
    const k = CLS[cls], st = RACES.find(r => r.id === race).base.slice();
    let pts = Math.max(rollBonus(), 7);
    for (let i = 0; i < 6; i++) while (st[i] < k.req[i] && pts > 0) { st[i]++; pts--; }
    let guard = 0;
    while (pts > 0 && guard++ < 100) for (const i of prio) if (pts > 0 && st[i] < 18) { st[i]++; pts--; }
    let name = AUTO_NAMES.find(n => !used.has(n)) || ('冒険者' + S.nextId);
    used.add(name);
    const c = newChar(name, race, al, st, cls);
    for (const id of gear[cls]) { addItem(c, id, 1); if (IT[id].kind !== 'use') equipItem(c, c.items.length - 1); }
    S.roster.push(c); S.gold += ri(60, 120);
    if (S.party.length < MAXP && !alignClash(c)) S.party.push(c.id);
  }
}

// ---- 町外れ ----
function scrEdge(note) {
  UI.screen = 'edge'; UI.rowClick = null;
  const able = partyChars().some(canAct);
  render(`${header('町外れ', goldText())}${partyBox()}
    <div class="note">${note ? br(note) : '迷宮の入口が 口を開けている。'}</div>
    <div class="menu">
      ${b('迷宮に入る', enterMaze, '', !able)}
      ${b('記録を書き出す（控え）', async () => { await textArea('この文字を写して、メモ帳などに貼って保存しておく。\n「記録を読み込む」で元に戻せる。', exportSave(), true); })}
      ${b('記録を読み込む', importFlow, 'ghost')}
      ${b('タイトルへ', () => { saveGame(); scrTitle(); }, 'ghost')}
      ${b('町に戻る', () => scrTown(), 'ghost')}
    </div>`);
}
async function enterMaze() {
  if (!partyChars().some(canAct)) return;
  const F = WORLD[1];
  S.inMaze = true; S.rooms = {}; S.guards = {};
  S.pos = { f: 1, x: F.up.x, y: F.up.y, d: 0 };
  markSeen(1, F.up.x, F.up.y);
  saveGame();
  scrMaze('一行は 迷宮へ 足を踏み入れた。');
}

// ---- 設定 ----
function scrSettings() {
  UI.screen = 'settings'; UI.rowClick = null;
  const sp = ['遅い', '普通', '速い'];
  render(`${header('設定', '')}
    <div class="note">文字の速さ：<b>${sp[S.opts.speed]}</b>　振動：<b>${S.opts.vib ? 'あり' : 'なし'}</b><br>（文字が流れている間は、画面を押すと先へ進む）</div>
    <div class="menu">
      ${b('文字の速さを変える', () => { S.opts.speed = (S.opts.speed + 1) % 3; saveGame(); scrSettings(); })}
      ${b('振動を切り替える', () => { S.opts.vib = S.opts.vib ? 0 : 1; saveGame(); scrSettings(); })}
      ${b('遊び方', howTo, 'ghost')}
      ${b('記録を全部消す', async () => {
        if (!await askYesNo('記録を全部消して、タイトルに戻る。\n元に戻せない。本当によいか？')) return;
        try { localStorage.removeItem(SAVE_KEY); } catch (e) { }
        const wf = taskerFn('writeFile'); if (wf) { try { wf(TASKER_FILE, '', false); } catch (e) { } }
        S = null; scrTitle();
      }, 'danger')}
      ${b('戻る', () => S.inMaze ? scrMaze() : scrTown(), 'ghost')}
    </div>`);
}
