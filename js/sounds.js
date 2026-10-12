// Sons des coups, synthétisés avec la Web Audio API (aucun fichier à télécharger).

let ctx = null;
let enabled = true;

try {
  enabled = localStorage.getItem('sound') !== 'off';
} catch {
  // Stockage indisponible : son activé par défaut.
}

export function isSoundEnabled() {
  return enabled;
}

export function setSoundEnabled(on) {
  enabled = on;
  try {
    localStorage.setItem('sound', on ? 'on' : 'off');
  } catch {
    // ignoré
  }
}

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** Petit « toc » de pièce en bois : bruit filtré très court + note grave. */
function knock(ac, when, { freq = 1700, gain = 0.5, length = 0.07 } = {}) {
  const buffer = ac.createBuffer(1, Math.ceil(ac.sampleRate * length), ac.sampleRate);
  const ch = buffer.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / ch.length) ** 3;
  const noise = ac.createBufferSource();
  noise.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = 1.2;
  const g = ac.createGain();
  g.gain.value = gain;
  noise.connect(filter).connect(g).connect(ac.destination);
  noise.start(when);

  const osc = ac.createOscillator();
  osc.frequency.setValueAtTime(180, when);
  osc.frequency.exponentialRampToValueAtTime(70, when + length);
  const og = ac.createGain();
  og.gain.setValueAtTime(gain * 0.6, when);
  og.gain.exponentialRampToValueAtTime(0.001, when + length);
  osc.connect(og).connect(ac.destination);
  osc.start(when);
  osc.stop(when + length);
}

function beep(ac, when, freq, length = 0.12, gain = 0.12) {
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = freq;
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, when);
  g.gain.exponentialRampToValueAtTime(0.001, when + length);
  osc.connect(g).connect(ac.destination);
  osc.start(when);
  osc.stop(when + length);
}

/**
 * Joue le son correspondant à un coup.
 * kind : 'move' | 'capture' | 'castle' | 'check' | 'success' | 'fail'
 */
export function playSound(kind) {
  if (!enabled) return;
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.01;
  switch (kind) {
    case 'capture':
      knock(ac, t, { freq: 2600, gain: 0.8, length: 0.09 });
      knock(ac, t + 0.03, { freq: 1200, gain: 0.4 });
      break;
    case 'castle':
      knock(ac, t);
      knock(ac, t + 0.11);
      break;
    case 'check':
      knock(ac, t);
      beep(ac, t + 0.02, 880);
      break;
    case 'success':
      beep(ac, t, 660, 0.12, 0.15);
      beep(ac, t + 0.1, 990, 0.2, 0.15);
      break;
    case 'fail':
      beep(ac, t, 300, 0.18, 0.15);
      beep(ac, t + 0.12, 220, 0.25, 0.15);
      break;
    default:
      knock(ac, t);
  }
}

/** Type de son pour un coup (objet avec san, captured, castle). */
export function moveSoundKind(move) {
  if (move.san.includes('+') || move.san.includes('#')) return 'check';
  if (move.captured) return 'capture';
  if (move.castle) return 'castle';
  return 'move';
}
