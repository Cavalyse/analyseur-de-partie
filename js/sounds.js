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

/**
 * « Toc » doux de pièce en bois posée sur l'échiquier : quelques sinusoïdes très amorties
 * (comme un bloc de bois), filtrées pour adoucir les aigus. `pitch` décale la hauteur.
 */
function wood(ac, when, { pitch = 1, gain = 0.3 } = {}) {
  const out = ac.createGain();
  out.gain.value = gain;
  const lowpass = ac.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 2200;
  lowpass.connect(out).connect(ac.destination);

  // [fréquence, amplitude relative, durée d'extinction en secondes]
  const partials = [[310, 1, 0.11], [740, 0.45, 0.06], [1520, 0.12, 0.03]];
  for (const [freq, amp, decay] of partials) {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq * pitch;
    const env = ac.createGain();
    env.gain.setValueAtTime(0.0001, when);
    env.gain.linearRampToValueAtTime(amp, when + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0001, when + decay);
    osc.connect(env).connect(lowpass);
    osc.start(when);
    osc.stop(when + decay + 0.02);
  }
}

/** Note douce (onde triangle) pour les sons de réussite et d'échec de l'entraînement. */
function note(ac, when, freq, length = 0.25, gain = 0.07) {
  const osc = ac.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  const env = ac.createGain();
  env.gain.setValueAtTime(0.0001, when);
  env.gain.linearRampToValueAtTime(gain, when + 0.015);
  env.gain.exponentialRampToValueAtTime(0.0001, when + length);
  osc.connect(env).connect(ac.destination);
  osc.start(when);
  osc.stop(when + length + 0.02);
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
      wood(ac, t, { pitch: 0.9, gain: 0.38 });
      wood(ac, t + 0.035, { pitch: 1.15, gain: 0.22 });
      break;
    case 'castle':
      wood(ac, t, { pitch: 1 });
      wood(ac, t + 0.1, { pitch: 0.92 });
      break;
    case 'check':
      wood(ac, t, { pitch: 1.2, gain: 0.34 });
      break;
    case 'success':
      note(ac, t, 784);
      note(ac, t + 0.11, 1175, 0.35);
      break;
    case 'fail':
      note(ac, t, 392, 0.22);
      note(ac, t + 0.12, 330, 0.3);
      break;
    default:
      wood(ac, t);
  }
}

/** Type de son pour un coup (objet avec san, captured, castle). */
export function moveSoundKind(move) {
  if (move.san.includes('+') || move.san.includes('#')) return 'check';
  if (move.captured) return 'capture';
  if (move.castle) return 'castle';
  return 'move';
}
