/* ミナモ：演出（音・画面の乱れ・波紋・心音・幽霊の入力・起動画面）。
   音は WebAudio で作る（音声ファイルなし）。強い点滅はしない：乱れは短く、明るさは変えない。
   演出の強さ  0: 弱（動く演出なし。音と印字だけ）  1: 標準  2: 強  3: 過剰（excess.js も動く。面接室が Backrooms になり、階層を落ちていく） */
(function () {
  "use strict";

  const FX = {};
  const rand = (a, b) => a + Math.random() * (b - a);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let level = 2, soundOn = true, calm = false, ver = "2026", phaseNow = 0;
  let ac = null, master = null, drone = null, clickBuf = null;

  FX.configure = o => {
    level = o.level; soundOn = o.sound;
    document.body.dataset.fx = ["low", "mid", "high", "excess"][level];
    if (!soundOn && ac) ac.suspend().catch(() => {});
  };
  FX.level = () => level;
  // 版：2026 はうなりを控えめに明るく（段階が進むと 1996 と同じ濃さに近づく）
  FX.setVersion = v => { ver = v; document.body.dataset.ver = v; };

  // ---------- 音 ----------
  function noise(sec, brown) {
    const n = Math.floor(ac.sampleRate * sec), buf = ac.createBuffer(1, n, ac.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return buf;
  }

  // 低い持続音：二つの近い周波数のうなりと、こもった雑音。融合では三全音が加わる
  function startDrone() {
    const g = ac.createGain(); g.gain.value = 0;
    const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 180;
    lp.connect(g); g.connect(master);
    const o1 = ac.createOscillator(), o2 = ac.createOscillator(), o3 = ac.createOscillator();
    o1.frequency.value = 55; o2.frequency.value = 55.6; o3.frequency.value = 77.8;
    const g3 = ac.createGain(); g3.gain.value = 0;
    o1.connect(lp); o2.connect(lp); o3.connect(g3); g3.connect(lp);
    const nz = ac.createBufferSource(); nz.buffer = noise(4, true); nz.loop = true;
    const ng = ac.createGain(); ng.gain.value = 0.5; nz.connect(ng); ng.connect(lp);
    const lfo = ac.createOscillator(), lg = ac.createGain();
    lfo.frequency.value = 0.07; lg.gain.value = 40; lfo.connect(lg); lg.connect(lp.frequency);
    [o1, o2, o3, nz, lfo].forEach(x => x.start());
    drone = { g, lp, g3 };
  }

  FX.audioStart = () => {
    if (!soundOn) return;
    try {
      if (!ac) {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        master = ac.createGain(); master.gain.value = 0.9; master.connect(ac.destination);
        clickBuf = noise(0.03, false);
        startDrone();
      }
      ac.resume().catch(() => {});
    } catch (e) { ac = null; }
  };
  const live = () => ac && soundOn && !calm && ac.state === "running";

  function tone(freq, dur, type, gain, at) {
    if (!live()) return;
    const t = at || ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    o.type = type || "sine"; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain || 0.08, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  FX.beep = () => tone(880, 0.06, "square", 0.03);
  // 2026 年版の通知音（メッセージの着信・記憶の更新）
  FX.pop = (high) => {
    if (!live()) return;
    const t = ac.currentTime;
    tone(high ? 1320 : 990, 0.09, "sine", 0.05, t);
    tone(high ? 1760 : 1320, 0.12, "sine", 0.04, t + 0.07);
  };

  // 相棒の明るい音（過剰）：上がっていく四つの音。sad なら、遅く、少し低くずれる
  FX.jingle = sad => {
    if (!live()) return;
    const t = ac.currentTime, notes = [784, 988, 1175, 1568], step = sad ? 0.22 : 0.09;
    notes.forEach((f, i) => tone(sad ? f * (1 - 0.03 * i) : f, sad ? 0.3 : 0.12, "square", 0.025, t + i * step));
  };

  FX.click = () => {
    if (!live()) return;
    const t = ac.currentTime, s = ac.createBufferSource(); s.buffer = clickBuf;
    const bp = ac.createBiquadFilter(); bp.type = "bandpass";
    bp.frequency.value = rand(1800, 3200); bp.Q.value = 4;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    s.connect(bp); bp.connect(g); g.connect(master); s.start(t); s.stop(t + 0.04);
  };

  // 心音：低い二つの鼓動。強さは沈黙の深さ（0〜1）。過剰では左右の耳を行き来する
  FX.heartbeat = strength => {
    if (!live()) return;
    const t = ac.currentTime;
    let out = master;
    if (level >= 3 && ac.createStereoPanner) {
      out = ac.createStereoPanner();
      out.pan.value = Math.sin(t * 1.3) * 0.9;
      out.connect(master);
    }
    [0, 0.28].forEach((dt, i) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.setValueAtTime(60, t + dt); o.frequency.exponentialRampToValueAtTime(32, t + dt + 0.18);
      const peak = (i ? 0.16 : 0.24) * (0.4 + strength);
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.exponentialRampToValueAtTime(peak, t + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.25);
      o.connect(g); g.connect(out); o.start(t + dt); o.stop(t + dt + 0.3);
    });
  };

  // ---------- 過剰の音（古いパソコンとブラウン管・画面が消える・足音） ----------
  // 机の上の古いパソコン：ファンのこもった風の音、電源の低いうなり、ブラウン管の細く高い鳴き。
  // ときどき、ディスクがカリカリと読む（Stories Untold の、画面の前の部屋）
  let crt = null, crtLevel = 0;
  function ensureCrt() {
    if (crt || !ac) return;
    const g = ac.createGain(); g.gain.value = 0; g.connect(master);
    const fan = ac.createBufferSource(); fan.buffer = noise(3, false); fan.loop = true;
    const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 420; bp.Q.value = 0.8;
    const fg = ac.createGain(); fg.gain.value = 0.35;
    fan.connect(bp); bp.connect(fg); fg.connect(g); fan.start();
    [[60, 0.25], [180, 0.08]].forEach(([f, v]) => {
      const o = ac.createOscillator(); o.frequency.value = f;
      const og = ac.createGain(); og.gain.value = v;
      o.connect(og); og.connect(g); o.start();
    });
    const w = ac.createOscillator(); w.frequency.value = 15734;     // 水平走査の鳴き（聞こえない人もいる）
    const wg = ac.createGain(); wg.gain.value = 0.04;
    w.connect(wg); wg.connect(g); w.start();
    crt = { g };
    seek();
  }
  // ディスクを読む音：短いカチカチが、数回続く
  function seek() {
    setTimeout(() => {
      if (live() && crtLevel > 0) {
        const t0 = ac.currentTime, n = 2 + Math.floor(Math.random() * 5);
        for (let i = 0; i < n; i++) {
          const t = t0 + i * rand(0.04, 0.12), src = ac.createBufferSource(); src.buffer = noise(0.015, false);
          const hp = ac.createBiquadFilter(); hp.type = "bandpass"; hp.frequency.value = rand(1800, 3200); hp.Q.value = 4;
          const g = ac.createGain(); g.gain.setValueAtTime(0.02 + crtLevel * 0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.015);
          src.connect(hp); hp.connect(g); g.connect(master); src.start(t); src.stop(t + 0.02);
        }
      }
      seek();
    }, rand(3000, 9000));
  }
  FX.setCrt = v => {
    crtLevel = v;
    if (!ac) return;
    ensureCrt();
    crt.g.gain.setTargetAtTime(calm ? 0 : v * 0.09, ac.currentTime, 1.2);
  };
  // 足音：遠ざかっていく（near なら、暗がりで近づいてくる）。左右に動く
  FX.steps = near => {
    if (!live()) return;
    const t0 = ac.currentTime, side = Math.random() < 0.5 ? -1 : 1;
    for (let i = 0; i < 6; i++) {
      const t = t0 + i * rand(0.48, 0.58), k = near ? (i + 1) / 6 : 1 - i / 6;
      const s = ac.createBufferSource(); s.buffer = noise(0.14, true);
      const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 180 + 300 * k;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.03 + 0.2 * k, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      let out = master;
      if (ac.createStereoPanner) { out = ac.createStereoPanner(); out.pan.value = side * (near ? 1 - k : k * 0.3 + 0.6); out.connect(master); }
      s.connect(lp); lp.connect(g); g.connect(out); s.start(t); s.stop(t + 0.15);
    }
  };
  // 画面が消える：ブラウン管の電源が落ちる「ピュン」と、パチパチという静電気。うなりも消える
  FX.screenOff = () => {
    if (!live()) return;
    const t = ac.currentTime;
    if (crt) { crt.g.gain.cancelScheduledValues(t); crt.g.gain.setTargetAtTime(0, t, 0.15); }
    if (drone) { drone.g.gain.cancelScheduledValues(t); drone.g.gain.setTargetAtTime(0, t, 0.6); }
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(2200, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.3);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.4);
    const src = ac.createBufferSource(); src.buffer = noise(0.6, false);
    const hp = ac.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 3000;
    const ng = ac.createGain(); ng.gain.setValueAtTime(0.025, t + 0.05); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);
    src.connect(hp); hp.connect(ng); ng.connect(master); src.start(t + 0.05); src.stop(t + 0.7);
  };
  // 画面が点く：消磁の「ボワン」と、リレーのカチッ
  FX.screenOn = () => {
    if (!live()) return;
    const t = ac.currentTime;
    tone(1200, 0.03, "square", 0.03);
    const o = ac.createOscillator(), lp = ac.createBiquadFilter(), g = ac.createGain();
    o.type = "sawtooth"; o.frequency.value = 60; lp.type = "lowpass"; lp.frequency.value = 400;
    g.gain.setValueAtTime(0.0001, t + 0.05); g.gain.exponentialRampToValueAtTime(0.12, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(lp); lp.connect(g); g.connect(master); o.start(t + 0.05); o.stop(t + 0.95);
    setTimeout(() => { FX.setCrt(crtLevel); FX.setPhase(phaseNow); }, 700);
  };

  // ---------- Backrooms の環境音（過剰）：階層ごとに鳴り分け、ゆっくり入れ替わる ----------
  // hum 蛍光灯の唸り／office 空調／pipes 配管と蒸気／electric 電気室／hotel 遠いワルツ／dark ほぼ無音と息
  // sea 遠い波／cave 水滴と岩／crickets 夜の虫／wind 麦畑の風／city 遠い車／alarm 警報／party 歪んだオルゴール
  let amb = null;
  const node = (type, f, q) => { const x = ac.createBiquadFilter(); x.type = type; x.frequency.value = f; if (q) x.Q.value = q; return x; };
  const gainOf = v => { const g = ac.createGain(); g.gain.value = v; return g; };
  function buildAmb(kind, out) {
    const stop = [], timers = [];
    const run = n => { n.start(); stop.push(n); return n; };
    const noiseTo = (type, f, q, v, brown) => {
      const s = ac.createBufferSource(); s.buffer = noise(3, brown); s.loop = true;
      const fl = node(type, f, q), g = gainOf(v);
      s.connect(fl); fl.connect(g); g.connect(out); run(s); return { g, fl };
    };
    const osc = (f, type, v, through) => {
      const o = ac.createOscillator(); o.type = type || "sine"; o.frequency.value = f;
      const g = gainOf(v); o.connect(through || g); if (through) through.connect(g); g.connect(out); run(o); return { o, g };
    };
    const lfo = (param, rate, depth) => { const o = ac.createOscillator(), g = gainOf(depth); o.frequency.value = rate; o.connect(g); g.connect(param); run(o); };
    const every = (min, max, fn) => { const t = { id: 0 }; const go = () => { t.id = setTimeout(() => { if (live()) fn(); go(); }, rand(min, max)); }; go(); timers.push(t); };
    const note = (f, dur, type, v, lp) => {
      const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain(), fl = node("lowpass", lp || 1200);
      o.type = type || "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(fl); fl.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
    };
    const burst = (f, q, v, dur) => {
      const t = ac.currentTime, s = ac.createBufferSource(); s.buffer = noise(dur + 0.05, false);
      const fl = node("bandpass", f, q), g = ac.createGain();
      g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(fl); fl.connect(g); g.connect(out); s.start(t); s.stop(t + dur + 0.05);
    };
    if (kind === "hum") {                                   // Level 0：蛍光灯
      osc(120, "sawtooth", 0.5, node("bandpass", 120, 4)); osc(240, "sawtooth", 0.25, node("bandpass", 240, 6));
      const z = osc(120, "square", 0.05, node("highpass", 2400)); lfo(z.g.gain, 0.23, 0.04);
    } else if (kind === "office") {                         // Level 1・4：空調
      noiseTo("lowpass", 700, 0, 0.35); osc(50, "sine", 0.08);
      every(9000, 20000, () => note(rand(900, 1300), 0.08, "square", 0.01));
    } else if (kind === "pipes") {                          // Level 2：配管と蒸気、ときどき金属音
      noiseTo("lowpass", 200, 0, 0.9, true); const h = noiseTo("bandpass", 4000, 1, 0.05); lfo(h.g.gain, 0.1, 0.04);
      every(5000, 12000, () => { note(rand(70, 110), 0.6, "triangle", 0.12, 600); note(rand(300, 500), 0.4, "square", 0.02, 900); });
    } else if (kind === "electric") {                       // Level 3：機械の唸りと火花
      osc(60, "sawtooth", 0.4, node("lowpass", 400)); noiseTo("highpass", 6000, 0, 0.03);
      every(1500, 6000, () => burst(rand(2500, 4500), 3, 0.06, rand(0.03, 0.12)));
    } else if (kind === "hotel") {                          // Level 5：遠いホールのワルツ（三拍子、短調）
      noiseTo("lowpass", 300, 0, 0.25, true);
      const bars = [[220, 261.6, 329.6], [196, 246.9, 293.7], [174.6, 220, 261.6], [164.8, 207.7, 246.9]];
      let k = 0;
      every(1700, 1900, () => { const b = bars[k++ % bars.length]; b.forEach((f, i) => setTimeout(() => live() && note(f * (i ? 1 : 0.5), 0.5, "triangle", 0.025, 700), i * 520)); });
    } else if (kind === "dark") {                           // Level 6：ほぼ無音。近くで、息
      noiseTo("lowpass", 120, 0, 0.2, true);
      every(4000, 7000, () => {
        const t = ac.currentTime, s = ac.createBufferSource(); s.buffer = noise(2.4, false);
        const fl = node("bandpass", 900, 1), g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 1.1); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.3);
        s.connect(fl); fl.connect(g); g.connect(out); s.start(t); s.stop(t + 2.4);
      });
    } else if (kind === "sea") {                            // Level 7：扉の外の、遠い波
      const w = noiseTo("lowpass", 500, 0, 0.3); lfo(w.g.gain, 0.08, 0.25); lfo(w.fl.frequency, 0.08, 250);
      osc(38, "sine", 0.06);
    } else if (kind === "cave") {                           // Level 8：岩の響きと水滴
      noiseTo("lowpass", 150, 0, 0.35, true);
      every(1800, 5000, () => [[0, 0.05], [0.28, 0.02], [0.56, 0.008]].forEach(([dt, v]) =>
        setTimeout(() => { if (!live()) return; const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
          o.frequency.setValueAtTime(1500, t); o.frequency.exponentialRampToValueAtTime(600, t + 0.07);
          g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
          o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.1); }, dt * 1000)));
    } else if (kind === "crickets") {                       // Level 9：夜の虫と、遠い犬
      noiseTo("lowpass", 250, 0, 0.12, true);
      every(700, 1600, () => [0, 0.07, 0.14].forEach(dt => setTimeout(() => live() && note(rand(4100, 4400), 0.05, "sine", 0.012, 8000), dt * 1000)));
      every(15000, 30000, () => note(rand(380, 460), 0.25, "sawtooth", 0.01, 700));
    } else if (kind === "wind") {                           // Level 10：麦畑を渡る風
      const w = noiseTo("bandpass", 400, 0.5, 0.35); lfo(w.fl.frequency, 0.05, 200); lfo(w.g.gain, 0.12, 0.15);
    } else if (kind === "city") {                           // Level 11：遠い車と、だれも鳴らさないクラクション
      noiseTo("lowpass", 250, 0, 0.5, true);
      every(8000, 16000, () => note(rand(300, 360), 0.8, "sawtooth", 0.02, 900));
    } else if (kind === "alarm") {                          // Level !：ゆっくりした警報
      const s = osc(700, "square", 0.025, node("lowpass", 1500)); lfo(s.o.frequency, 0.5, 120);
    } else if (kind === "party") {                          // Level Fun =)：少し狂ったオルゴール
      const tune = [523.3, 659.3, 784, 659.3, 698.5, 880, 784, 0, 523.3, 587.3, 659.3, 523.3];
      let k = 0;
      every(330, 360, () => { const f = tune[k++ % tune.length]; if (f) note(f * (1 + rand(-0.03, 0.03)), 0.3, "triangle", 0.03, 3000); });
    }
    return { stop, timers };
  }
  // kind が空なら止める
  FX.amb = kind => {
    if (!ac || (amb && amb.kind === kind)) return;
    const t = ac.currentTime;
    if (amb) {
      const old = amb;
      old.g.gain.cancelScheduledValues(t); old.g.gain.setTargetAtTime(0, t, 0.6);
      old.parts.timers.forEach(x => clearTimeout(x.id));
      setTimeout(() => old.parts.stop.forEach(n => { try { n.stop(); } catch (e) { /* もう止まっている */ } }), 3000);
      amb = null;
    }
    if (!kind || !soundOn) return;
    const g = ac.createGain(); g.gain.value = 0; g.connect(master);
    g.gain.setTargetAtTime(calm ? 0 : 0.11, t, 1.5);
    amb = { kind, g, parts: buildAmb(kind, g) };
  };
  // すり抜け：床の下へ落ちていく風の音と、着地の衝撃。環境音は、いったん消える
  function boom(gain) {
    const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(24, t + 1.2);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 1.7);
  }
  FX.noclip = short => {
    if (!live()) return;
    const t = ac.currentTime, d = short ? 0.8 : 1.3;
    if (amb) { amb.g.gain.cancelScheduledValues(t); amb.g.gain.setTargetAtTime(0, t, 0.08); }
    const s = ac.createBufferSource(); s.buffer = noise(d + 0.1, false);
    const lp = ac.createBiquadFilter(); lp.type = "lowpass";
    lp.frequency.setValueAtTime(4000, t); lp.frequency.exponentialRampToValueAtTime(150, t + d);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(short ? 0.12 : 0.22, t + d * 0.8);
    g.gain.setValueAtTime(0.0001, t + d);
    s.connect(lp); lp.connect(g); g.connect(master); s.start(t); s.stop(t + d + 0.1);
    setTimeout(() => { if (live()) boom(short ? 0.3 : 0.45); }, d * 1000);
  };

  // 段階が変わるとき：雑音が膨らんで、切れる
  FX.swell = () => {
    if (!live()) return;
    const t = ac.currentTime, s = ac.createBufferSource(); s.buffer = noise(1.4, false);
    const lp = ac.createBiquadFilter(); lp.type = "lowpass";
    lp.frequency.setValueAtTime(300, t); lp.frequency.exponentialRampToValueAtTime(4000, t + 1.2);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 1.15);
    g.gain.setValueAtTime(0.0001, t + 1.2);
    s.connect(lp); lp.connect(g); g.connect(master); s.start(t); s.stop(t + 1.3);
  };

  // モデムの接続音（ダイヤル → 応答音 → ネゴシエーションの雑音）
  FX.modem = () => {
    if (!live()) return;
    const t = ac.currentTime;
    const dtmf = [[697, 1209], [770, 1336], [852, 1477], [941, 1336], [697, 1336], [770, 1209]];
    dtmf.forEach((p, i) => p.forEach(f => tone(f, 0.09, "sine", 0.03, t + i * 0.13)));
    tone(2100, 0.7, "sine", 0.035, t + 0.95);
    const s = ac.createBufferSource(); s.buffer = noise(1.3, false);
    const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 2;
    bp.frequency.setValueAtTime(1200, t + 1.7); bp.frequency.linearRampToValueAtTime(2400, t + 2.9);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t + 1.7);
    g.gain.exponentialRampToValueAtTime(0.05, t + 1.75); g.gain.setValueAtTime(0.05, t + 2.85);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.0);
    s.connect(bp); bp.connect(g); g.connect(master); s.start(t + 1.7); s.stop(t + 3.05);
    [1.8, 2.1, 2.4, 2.65].forEach(dt => tone(rand(900, 1900), 0.12, "sawtooth", 0.015, t + dt));
  };

  // ---------- 段階 ----------
  FX.setPhase = idx => {
    phaseNow = idx;
    document.body.dataset.phase = String(idx);
    if (!drone || !ac) return;
    const t = ac.currentTime;
    const soft = ver === "2026" ? [0.35, 0.5, 0.8, 1][idx] : 1;
    drone.g.gain.setTargetAtTime(calm ? 0 : [0.05, 0.07, 0.09, 0.11][idx] * soft, t, 1.5);
    drone.lp.frequency.setTargetAtTime([180, 240, 320, 420][idx] * (ver === "2026" ? 1.6 : 1), t, 2);
    drone.g3.gain.setTargetAtTime(idx >= 3 ? 0.35 : 0, t, 3);
  };
  FX.fade = sec => {
    if (drone && ac) drone.g.gain.setTargetAtTime(0, ac.currentTime, (sec || 2) / 3);
  };
  // 演出を止める（危機の言葉・すぐに抜けるとき）。resume で戻す
  FX.pause = () => {
    calm = true; document.body.dataset.calm = "1"; FX.setSilence(0);
    if (drone && ac) drone.g.gain.setTargetAtTime(0, ac.currentTime, 0.1);
    if (crt && ac) crt.g.gain.setTargetAtTime(0, ac.currentTime, 0.1);
    if (amb && ac) amb.g.gain.setTargetAtTime(0, ac.currentTime, 0.1);
  };
  FX.resume = idx => { calm = false; delete document.body.dataset.calm; FX.setPhase(idx); };
  FX.suspend = hidden => {
    if (!ac) return;
    (hidden ? ac.suspend() : ac.resume()).catch(() => {});
  };

  // ---------- 画面 ----------
  FX.setSilence = s => document.documentElement.style.setProperty("--silence", calm ? 0 : s.toFixed(3));

  FX.glitch = ms => {
    if (level === 0 || calm) return;
    document.body.classList.remove("glitch");
    void document.body.offsetWidth;
    document.body.classList.add("glitch");
    setTimeout(() => document.body.classList.remove("glitch"), Math.min(ms || 260, 500));
  };

  // 水面の波紋（ミナモが間を置くたび）
  FX.ripple = () => {
    if (level === 0 || calm) return;
    const r = document.createElement("div");
    r.className = "ripple";
    r.style.top = rand(35, 60) + "%"; r.style.left = rand(35, 65) + "%";
    document.body.appendChild(r);
    setTimeout(() => r.remove(), 3000);
  };

  FX.mirror = el => {
    if (level < 2 || calm || !el) return;
    el.classList.add("mirror");
    setTimeout(() => el.classList.remove("mirror"), 700);
  };

  // 消した文字が、取り消し線つきで浮かんで消える
  FX.floatErased = (text, anchor) => {
    if (level === 0 || calm || !text.trim()) return;
    const r = anchor.getBoundingClientRect(), f = document.createElement("span");
    f.className = "erased-float"; f.textContent = text.slice(0, 24);
    f.style.left = Math.max(8, Math.min(r.left + rand(0, r.width * 0.6), innerWidth - 120)) + "px";
    f.style.top = (r.top - 8) + "px";
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 2600);
  };

  // 融合：だれも触っていない入力欄に、文字が打たれて消える
  FX.ghostType = async (input, text, token) => {
    if (level === 0 || calm) return;
    input.classList.add("ghost");
    for (const ch of text) {
      if (token.stop) break;
      input.value += ch;
      await sleep(rand(180, 320));
    }
    if (!token.stop) await sleep(1300);
    while (!token.stop && input.value) {
      input.value = input.value.slice(0, -1);
      await sleep(rand(70, 120));
    }
    input.classList.remove("ghost");
  };

  FX.toast = text => {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = text; t.classList.add("on");
    clearTimeout(FX._toast);
    FX._toast = setTimeout(() => t.classList.remove("on"), 3200);
  };

  FX.vibrate = p => { if (level >= 1 && !calm && navigator.vibrate) navigator.vibrate(p); };

  // 画面を消さない（沈黙のあいだに画面が暗くならないように）
  let lock = null;
  FX.wakeLock = async on => {
    try {
      if (on && "wakeLock" in navigator && !document.hidden) lock = await navigator.wakeLock.request("screen");
      else if (!on && lock) { await lock.release(); lock = null; }
    } catch (e) { lock = null; }
  };

  // ---------- 起動画面 ----------
  // lines: [文字列, "beep" | "modem" | 待ち時間(ms)]
  FX.boot = async (el, lines) => {
    el.hidden = false; el.classList.remove("out"); el.textContent = "";
    const pre = document.createElement("pre"); el.appendChild(pre);
    for (const [text, how] of lines) {
      if (how === "modem") {
        pre.textContent += text;
        FX.modem();
        for (let i = 0; i < 12; i++) { pre.textContent += "▒"; await sleep(250); }
        pre.textContent += "\n";
        continue;
      }
      for (const ch of text) { pre.textContent += ch; await sleep(level === 0 ? 4 : 14); }
      pre.textContent += "\n";
      if (how === "beep") FX.beep();
      await sleep(typeof how === "number" ? how : 120);
    }
    await sleep(700);
    el.classList.add("out");
    await sleep(800);
    el.hidden = true;
  };

  window.FX = FX;
})();
