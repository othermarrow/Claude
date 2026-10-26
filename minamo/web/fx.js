/* ミナモ：演出（音・画面の乱れ・波紋・心音・幽霊の入力・起動画面）。
   音は WebAudio で作る（音声ファイルなし）。強い点滅はしない：乱れは短く、明るさは変えない。
   演出の強さ  0: 弱（動く演出なし。音と印字だけ）  1: 標準  2: 強  3: 過剰（excess.js も動く） */
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

  // 低い衝撃音（過剰）
  function boom(gain) {
    const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(24, t + 1.2);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 1.7);
    const s = ac.createBufferSource(); s.buffer = noise(1.2, true);
    const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 140;
    const ng = ac.createGain(); ng.gain.setValueAtTime(gain * 0.8, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    s.connect(lp); lp.connect(ng); ng.connect(master); s.start(t); s.stop(t + 1.2);
  }

  // ジャンプスケアの音（過剰）：雑音の叫びと、ずり落ちる不協和音と、衝撃
  FX.scream = () => {
    if (!live()) return;
    const t = ac.currentTime, s = ac.createBufferSource(); s.buffer = noise(1.0, false);
    const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(2600, t); bp.frequency.exponentialRampToValueAtTime(500, t + 0.9);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.45, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
    s.connect(bp); bp.connect(g); g.connect(master); s.start(t); s.stop(t + 1);
    [233, 247, 349, 370, 523].forEach(f => {
      const o = ac.createOscillator(), og = ac.createGain();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.45, t + 0.9);
      og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.connect(og); og.connect(master); o.start(t); o.stop(t + 0.95);
    });
    boom(0.5);
  };

  // うなりが突然消えて、少しの無音のあと、低い衝撃とともに戻る（過剰）
  FX.dropout = () => {
    if (!drone || !live()) return;
    drone.g.gain.cancelScheduledValues(ac.currentTime);
    drone.g.gain.setTargetAtTime(0, ac.currentTime, 0.015);
    setTimeout(() => {
      if (!live()) return;
      boom(0.35);
      FX.setPhase(phaseNow);
    }, rand(1800, 2800));
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
