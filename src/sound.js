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
