// Tiny Web Audio sound kit: no files to load.
let ac = null;
export function initAudio() {
  if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
  if (ac.state === 'suspended') ac.resume();
}

function tone(freq, start, dur, type = 'sine', vol = 0.15) {
  if (!ac) return;
  const t = ac.currentTime + start;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ac.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export const sfx = {
  dingdong: () => (tone(988, 0, 0.5), tone(784, 0.35, 0.7)),
  alarm: () => [0, 0.18, 0.36].forEach((s) => tone(440, s, 0.14, 'square', 0.08)),
  clear: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.07, 0.25, 'triangle', 0.12)),
  combo: () => tone(1320, 0, 0.12, 'triangle', 0.08),
  zap: () => (tone(1500, 0, 0.1, 'sawtooth', 0.06), tone(300, 0.08, 0.2, 'sawtooth', 0.06)),
  horn: () => (tone(220, 0, 0.6, 'sawtooth', 0.07), tone(277, 0, 0.6, 'sawtooth', 0.05)),
};

// Train rumble: filtered noise that fades out as the train brakes.
export function rumble(sec = 5) {
  if (!ac) return;
  const len = ac.sampleRate * sec;
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(900, ac.currentTime);
  lp.frequency.linearRampToValueAtTime(180, ac.currentTime + sec);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.5, ac.currentTime);
  g.gain.linearRampToValueAtTime(0.0001, ac.currentTime + sec);
  src.connect(lp).connect(g).connect(ac.destination);
  src.start();
}
// MRT-style door chime (three soft descending tones) + pneumatic hiss.
export function doorChime() {
  if (!ac) return;
  [1175, 988, 784].forEach((f, i) => tone(f, i * 0.28, 0.5, 'sine', 0.13));
  const len = ac.sampleRate * 0.7;
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2500;
  const g = ac.createGain();
  g.gain.value = 0.08;
  src.connect(hp).connect(g).connect(ac.destination);
  src.start(ac.currentTime + 0.9);
}
// In-train announcement via the browser's speech engine (prefers an English voice).
export function announce(text) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    const v = speechSynthesis.getVoices();
    u.voice = v.find((x) => /en-(SG|GB)/i.test(x.lang)) || v.find((x) => /^en/i.test(x.lang)) || null;
    u.rate = 0.95;
    u.pitch = 1.05;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch {}
}
