// Détection de hauteur (algorithme YIN) et conversions fréquence ↔ note MIDI.
// Fonctions pures : testées sur des sons synthétiques dans tests.html.

const A4 = 440;

export function midiToFreq(m) {
  return A4 * 2 ** ((m - 69) / 12);
}

// Note la plus proche d'une fréquence ; tuning = écart d'accordage du piano en cents (+ = piano trop haut).
export function nearestNote(freq, tuning = 0) {
  const m = 69 + 12 * Math.log2(freq / A4) - tuning / 100;
  const midi = Math.round(m);
  return { midi, cents: Math.round((m - midi) * 100) };
}

export function rms(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

/**
 * YIN (de Cheveigné & Kawahara, 2002) : cherche la période qui ressemble le plus au signal décalé.
 * Retourne { freq, clarity } (clarity proche de 1 = son bien périodique) ou null.
 * Plage par défaut : 55 Hz (La1) à 1500 Hz, de quoi couvrir Do2–Do6 avec de la marge.
 */
export function yin(buf, sampleRate, { minFreq = 55, maxFreq = 1500, threshold = 0.15 } = {}) {
  const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
  const tauMax = Math.min(Math.ceil(sampleRate / minFreq), Math.floor(buf.length / 2));
  const w = buf.length - tauMax - 1; // fenêtre comparée ; tauMax + 1 sert à l'interpolation

  // Différence au carré, puis différence normalisée par sa moyenne cumulée.
  const cmnd = new Float32Array(tauMax + 2);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    let sum = 0;
    for (let i = 0; i < w; i++) {
      const x = buf[i] - buf[i + tau];
      sum += x * x;
    }
    running += sum;
    cmnd[tau] = running ? (sum * tau) / running : 1;
  }

  // Premier creux sous le seuil (évite les erreurs « une octave trop grave »).
  let best = -1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
      best = tau;
      break;
    }
  }
  if (best < 0) return null;

  // Interpolation parabolique pour une précision inférieure à l'échantillon.
  const a = cmnd[best - 1], b = cmnd[best], c = cmnd[best + 1];
  const denom = a + c - 2 * b;
  const shift = denom ? (a - c) / (2 * denom) : 0;
  return { freq: sampleRate / (best + shift), clarity: 1 - b };
}
