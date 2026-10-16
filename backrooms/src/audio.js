// ===== 音（Web Audio で合成する。音のファイルは使わない） =====
const AU = { ctx: null, on: false };

function audioInit() {
  if (AU.ctx) { if (AU.ctx.state === 'suspended') AU.ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  const ctx = new AC();
  AU.ctx = ctx;
  AU.master = ctx.createGain(); AU.master.gain.value = OPT.vol;
  const comp = ctx.createDynamicsCompressor();
  AU.master.connect(comp); comp.connect(ctx.destination);
  AU.dry = ctx.createGain(); AU.dry.connect(AU.master);
  AU.rev = ctx.createConvolver(); AU.revGain = ctx.createGain(); AU.revGain.gain.value = 0.35;
  AU.rev.connect(AU.revGain); AU.revGain.connect(AU.master);
  // 白いノイズ
  const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), nd = nb.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  AU.noise = nb;
  // 蛍光灯のうなり（60Hzとその倍音、ジーという高い音）
  AU.hum = ctx.createGain(); AU.hum.gain.value = 0; AU.hum.connect(AU.dry); AU.hum.connect(AU.rev);
  [[60, 0.5, 'sine'], [120, 0.32, 'sine'], [180, 0.12, 'sawtooth'], [240, 0.05, 'square']].forEach(([f, gn, ty]) => {
    const o = ctx.createOscillator(); o.type = ty; o.frequency.value = f;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const g = ctx.createGain(); g.gain.value = gn; o.connect(lp); lp.connect(g); g.connect(AU.hum); o.start();
  });
  const bz = ctx.createBufferSource(); bz.buffer = nb; bz.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3600; bp.Q.value = 6;
  const bg = ctx.createGain(); bg.gain.value = 0.05; bz.connect(bp); bp.connect(bg); bg.connect(AU.hum); bz.start();
  // 風・水の音（層によって使う）
  const amb = ctx.createBufferSource(); amb.buffer = nb; amb.loop = true;
  AU.ambF = ctx.createBiquadFilter(); AU.ambF.type = 'lowpass'; AU.ambF.frequency.value = 500;
  AU.amb = ctx.createGain(); AU.amb.gain.value = 0;
  amb.connect(AU.ambF); AU.ambF.connect(AU.amb); AU.amb.connect(AU.dry); amb.start();
  // 出口の音の通り道（左右・距離・壁ごしのこもり）
  AU.bPan = ctx.createStereoPanner(); AU.bLP = ctx.createBiquadFilter(); AU.bLP.type = 'lowpass'; AU.bLP.frequency.value = 4000;
  AU.bGain = ctx.createGain(); AU.bGain.gain.value = 0;
  AU.bGain.connect(AU.bLP); AU.bLP.connect(AU.bPan); AU.bPan.connect(AU.dry); AU.bPan.connect(AU.rev);
  AU.bNext = 0; AU.bStep = 0;
  AU.heartNext = 0; AU.halluNext = ctx.currentTime + 12;
  AU.on = true;
}
function audioVolume(v) { if (AU.master) AU.master.gain.setTargetAtTime(v, AU.ctx.currentTime, 0.05); }
function makeImpulse(sec) {
  const ctx = AU.ctx, len = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
  return b;
}
function audioLevel(cfg) {
  if (!AU.on) return;
  AU.rev.buffer = makeImpulse(cfg.reverb);
  const t = AU.ctx.currentTime;
  AU.ambF.frequency.setValueAtTime(cfg.beacon === 'wind' ? 380 : cfg.calm ? 900 : 300, t);
  AU.amb.gain.setTargetAtTime(cfg.calm ? 0.05 : cfg.beacon === 'wind' ? 0.03 : 0.012, t, 0.5);
  AU.bNext = t + 1;
}
function audioSuspend(on) { if (AU.ctx) { if (on) AU.ctx.suspend(); else AU.ctx.resume(); } }

// 単発の音
function tone(f, dur, gain, type, dest, when, f2) {
  const ctx = AU.ctx, t = when || ctx.currentTime;
  const o = ctx.createOscillator(); o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(dest || AU.dry); o.start(t); o.stop(t + dur + 0.05);
  return g;
}
function noiseHit(dur, gain, ftype, freq, q, dest, when, pan) {
  const ctx = AU.ctx, t = when || ctx.currentTime;
  const s = ctx.createBufferSource(); s.buffer = AU.noise; s.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ctx.createBiquadFilter(); f.type = ftype; f.frequency.value = freq; if (q) f.Q.value = q;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g);
  if (pan != null) { const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); g.connect(p); p.connect(dest || AU.dry); p.connect(AU.rev); }
  else { g.connect(dest || AU.dry); g.connect(AU.rev); }
  s.start(t, Math.random()); s.stop(t + dur + 0.05);
}
function sfx(name, o) {
  if (!AU.on) return;
  o = o || {};
  const t = AU.ctx.currentTime;
  switch (name) {
    case 'step': {
      // 自分の足音は控えめに（前の半分くらい）。走ると少し大きくなる
      const sf = { carpet: [380, 0.045], concrete: [1300, 0.055], metal: [2200, 0.05], tile: [2000, 0.05], water: [700, 0.05], wood: [600, 0.05] }[o.surf] || [800, 0.05];
      noiseHit(0.08, sf[1] * (o.loud ? 1.45 : 1), o.surf === 'metal' ? 'bandpass' : 'lowpass', sf[0], o.surf === 'metal' ? 2 : 0);
      if (o.surf === 'metal') tone(420 + Math.random() * 80, 0.1, 0.008, 'triangle');
      if (o.surf === 'water') noiseHit(0.14, 0.03, 'bandpass', 1400 + Math.random() * 500, 3, null, t + 0.03);
      break;
    }
    case 'pick': tone(880, 0.12, 0.12, 'sine', null, t, 1320); tone(1320, 0.2, 0.06, 'sine', null, t + 0.08); break;
    case 'drink': for (let i = 0; i < 4; i++) noiseHit(0.08, 0.12, 'bandpass', 600 + i * 90, 3, null, t + i * 0.16); break;
    case 'click': noiseHit(0.03, 0.25, 'highpass', 3000, 0, null, t); break;
    case 'zap': noiseHit(0.05, 0.08, 'bandpass', 2400, 2, null, t, o.pan); break;
    case 'whoosh': {
      const s = AU.ctx.createBufferSource(); s.buffer = AU.noise;
      const f = AU.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(200, t); f.frequency.exponentialRampToValueAtTime(4000, t + 1.2); f.frequency.exponentialRampToValueAtTime(100, t + 2.4);
      const g = AU.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 1.0); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.5);
      s.connect(f); f.connect(g); g.connect(AU.dry); g.connect(AU.rev); s.start(t); s.stop(t + 2.6);
      break;
    }
    case 'caught':
      noiseHit(1.2, 0.9, 'lowpass', 900, 0, null, t);
      tone(70, 1.6, 0.6, 'sawtooth', null, t, 40); tone(110, 1.2, 0.3, 'square', null, t, 55);
      break;
    case 'thump': {   // 怪物の足音
      const p = o.pan || 0, g = o.gain || 0.3;
      const pn = AU.ctx.createStereoPanner(); pn.pan.value = clamp(p, -1, 1); pn.connect(AU.dry); pn.connect(AU.rev);
      tone(52, 0.22, g, 'sine', pn, t, 38);
      noiseHit(0.12, g * 0.5, 'lowpass', 220, 0, pn, t);
      break;
    }
    case 'giggle': {
      const p = o.pan || 0, g = o.gain || 0.2;
      for (let i = 0; i < 4; i++) noiseHit(0.07, g, 'bandpass', 2300 + Math.random() * 900, 7, null, t + i * 0.11, p);
      tone(620, 0.4, g * 0.25, 'triangle', null, t, 540);
      break;
    }
    case 'hiss': noiseHit(0.5, o.gain || 0.2, 'highpass', 4000, 0, null, t, o.pan); break;
    case 'heart': tone(48, 0.16, 0.5, 'sine', null, t, 40); tone(44, 0.16, 0.38, 'sine', null, t + 0.2, 38); break;
    case 'knock': for (let i = 0; i < 3; i++) noiseHit(0.08, 0.25, 'bandpass', 500, 2, null, t + i * 0.22, o.pan); break;
  }
}

// 毎フレーム：うなりの大きさ、出口の音、心臓の音、幻聴
const MELODY = {
  musicbox: { notes: [659, 784, 988, 880, 784, 659, 587, 659, 0, 0], gap: 0.42, type: 'sine', dur: 1.4, g: 0.5 },
  radio: { notes: [392, 0, 440, 494, 0, 440, 392, 0, 0, 0, 0, 0], gap: 0.5, type: 'square', dur: 0.35, g: 0.14, noisy: 1 },
  wind: { notes: [0], gap: 2, type: 'sine', dur: 0, g: 0, wind: 1 },
  ding: { notes: [1319, 1047, 0, 0, 0, 0, 0, 0], gap: 0.45, type: 'sine', dur: 1.6, g: 0.45 },
  chord: { notes: [523, 659, 784, 988, 0, 0, 0, 0, 0, 0], gap: 0.6, type: 'triangle', dur: 3.5, g: 0.18 },
  drip: { notes: [1760, 0, 2093, 0, 0, 1568, 0, 0, 2349, 0, 1976, 0, 0, 0], gap: 0.3, type: 'sine', dur: 0.22, g: 0.32 },
  alarm: { notes: [880, 660, 880, 660, 880, 660, 880, 660, 0, 0, 0, 0, 0], gap: 0.2, type: 'square', dur: 0.18, g: 0.07 },
  clock: { notes: [[2400, 0.04, 0.16, 'triangle'], [1800, 0.04, 0.16, 'triangle'], [2400, 0.04, 0.16, 'triangle'], [1800, 0.04, 0.16, 'triangle'], [2400, 0.04, 0.16, 'triangle'], [1800, 0.04, 0.16, 'triangle'], [523, 2.2, 0.3, 'sine'], 0], gap: 0.5, type: 'sine', dur: 0.1, g: 0.2 },
  chip: { notes: [523, 659, 784, 1047, 784, 659, 523, 0, 587, 698, 880, 1175, 880, 0, 0, 0], gap: 0.15, type: 'square', dur: 0.13, g: 0.06 },
  monitor: { notes: [1000, 0, 0, 0, 0], gap: 0.24, type: 'sine', dur: 0.11, g: 0.3 },
  party: { notes: [784, 784, 880, 784, 1047, 988, 0, 784, 784, 880, 784, 1175, 1047, 0, 0, 0, 0], gap: 0.32, type: 'triangle', dur: 0.4, g: 0.15 },   // 「ハッピーバースデー」（作者不明の古い歌）
};
function audioUpdate(info) {
  if (!AU.on) return;
  const ctx = AU.ctx, t = ctx.currentTime, cfg = WD.cfg;
  AU.hum.gain.setTargetAtTime(0.06 * cfg.hum * clamp(info.lightHere * 1.3, 0.05, 1.2), t, 0.3);
  // 出口
  const m = MELODY[cfg.beacon] || MELODY.wind;
  const vol = cfg.beacon ? Math.pow(clamp(1 - info.exitDist / (cfg.beaconRange || 38), 0, 1), 1.6) : 0;
  AU.bGain.gain.setTargetAtTime(vol, t, 0.2);
  AU.bPan.pan.setTargetAtTime(clamp(info.exitPan, -1, 1) * 0.85, t, 0.15);
  AU.bLP.frequency.setTargetAtTime(info.exitLos ? 5000 : 650, t, 0.3);
  if (m.wind && cfg.beacon) AU.amb.gain.setTargetAtTime(0.025 + vol * 0.12, t, 0.4);
  if (t >= AU.bNext && vol > 0.005) {
    const nt = m.notes[AU.bStep % m.notes.length]; AU.bStep++;
    const f = Array.isArray(nt) ? nt[0] : nt, dur = Array.isArray(nt) ? nt[1] : m.dur, gg = Array.isArray(nt) ? nt[2] : m.g, ty = Array.isArray(nt) ? nt[3] : m.type;
    if (f) {
      tone(f, dur, gg, ty, AU.bGain, t);
      if (ty === 'sine') tone(f * 2, dur * 0.5, gg * 0.25, 'sine', AU.bGain, t);
      if (m.noisy) noiseHit(0.4, 0.06, 'bandpass', 1800, 1, AU.bGain, t);
    }
    if (m.noisy && Math.random() < 0.4) noiseHit(0.3, 0.05, 'bandpass', 2500, 1, AU.bGain, t + 0.1);
    AU.bNext = t + m.gap;
  } else if (t >= AU.bNext) AU.bNext = t + 0.3;
  // 心臓
  if (info.fear > 0.05 && t >= AU.heartNext) {
    sfx('heart'); if (OPT.vib) vibe(25);
    AU.heartNext = t + lerp(1.1, 0.42, clamp(info.fear, 0, 1));
  }
  // 正気が減ると、ないはずの音がする
  if (info.sanity < 35 && t >= AU.halluNext) {
    const r = Math.random(), pan = Math.random() * 2 - 1;
    if (r < 0.4) sfx('knock', { pan }); else if (r < 0.7) sfx('thump', { pan, gain: 0.25 }); else sfx('giggle', { pan, gain: 0.08 });
    AU.halluNext = t + 6 + Math.random() * 12 * (info.sanity / 35 + 0.3);
  }
}
