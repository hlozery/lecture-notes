// Écoute du piano au micro : niveau sonore, hauteur détectée, notes stables.
import { yin, rms, nearestNote } from './pitch.js';

// Seuils de volume (RMS, mesuré après filtrage) selon la sensibilité choisie (−34 dB à −62 dB).
export const SENSITIVITY = { low: 0.02, medium: 0.006, high: 0.002, max: 0.0008 };

// Filtres appliqués avant l'analyse : les notes du jeu (Do2–Do6) vivent entre 65 et ~1 000 Hz ;
// on retire le grondement grave et le souffle aigu, qui brouillent la détection (mesuré dans tests.html).
export const FILTERS = [['highpass', 60], ['highpass', 60], ['lowpass', 2000], ['lowpass', 2000]];

// Netteté minimale d'une hauteur détectée (1 = son parfaitement périodique).
export const MIN_CLARITY = 0.8;

// Seuil effectif : mesuré dans la pièce (« auto ») ou choisi parmi les niveaux.
export function thresholdFor(settings) {
  if (settings.micSensitivity === 'auto' && settings.micThreshold) return settings.micThreshold;
  return SENSITIVITY[settings.micSensitivity] || SENSITIVITY.medium;
}

/**
 * Ouvre le micro. À appeler pendant un geste de l'utilisateur (toucher) : iOS n'autorise
 * le démarrage du son que dans ce cas, d'où la création du contexte audio avant l'attente.
 */
export async function openMicrophone() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  ctx.resume();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    await ctx.resume();
    return {
      ctx,
      source: ctx.createMediaStreamSource(stream),
      close() {
        stream.getTracks().forEach((t) => t.stop());
        ctx.close();
      },
    };
  } catch (err) {
    ctx.close();
    throw err;
  }
}

// Sensibilité automatique : seuil à 1,5 fois le bruit de la pièce (90e centile des niveaux mesurés en silence).
// Le bruit seul n'est de toute façon pas pris pour une note (voir tests.html).
export function thresholdFromNoise(levels) {
  const sorted = [...levels].sort((x, y) => x - y);
  const p90 = sorted[Math.floor(sorted.length * 0.9)] || 0;
  return Math.min(SENSITIVITY.low, Math.max(0.0004, p90 * 1.5));
}

export function micErrorMessage(err) {
  if (!navigator.mediaDevices?.getUserMedia) return 'Ce navigateur ne donne pas accès au micro.';
  if (err?.name === 'NotAllowedError') return 'Accès au micro refusé. Autorise-le dans Réglages › Safari › Micro, puis relance.';
  if (err?.name === 'NotFoundError') return 'Aucun micro trouvé.';
  return 'Le micro n’a pas pu démarrer.';
}

/**
 * Analyse le son en continu (~30 fois par seconde).
 *  onFrame({ level, pitch }) : à chaque analyse (pitch = { midi, cents, freq } ou null) ;
 *  onNote(pitch) : quand une note reste stable — une seule fois par attaque,
 *    la même note n'est redonnée qu'après un silence ou une nouvelle frappe.
 *  isExpected(midi) : la note attendue est acceptée vite (fastMs) ; une autre note doit tenir
 *    plus longtemps (stableMs) pour qu'un accroc à l'attaque ne compte pas comme une fausse note.
 * setTuning(cents) et setThreshold(rms) changent les réglages sans couper le micro.
 */
export function createListener(ctx, source, {
  threshold, tuning = 0, fastMs = 60, stableMs = 180, isExpected = () => false, onFrame, onNote,
}) {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  const filters = FILTERS.map(([type, freq]) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    return f;
  });
  [source, ...filters, analyser].reduce((from, to) => from.connect(to));
  const buf = new Float32Array(analyser.fftSize);
  let raf = 0, lastTick = 0;
  let candidate = null, since = 0;
  let emitted = null, floor = Infinity;

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (now - lastTick < 30) return;
    lastTick = now;
    analyser.getFloatTimeDomainData(buf);
    const level = rms(buf);

    // Nouvelle frappe : le volume remonte nettement après avoir baissé.
    floor = Math.min(floor, level);
    if (emitted !== null && level > floor * 1.8) emitted = null;

    let pitch = null;
    if (level >= threshold) {
      const r = yin(buf, ctx.sampleRate);
      if (r && r.clarity >= MIN_CLARITY) pitch = { ...nearestNote(r.freq, tuning), freq: r.freq };
    }
    onFrame?.({ level, pitch });

    if (!pitch) {
      candidate = null;
      if (level < threshold) emitted = null;
      return;
    }
    if (pitch.midi !== candidate) {
      candidate = pitch.midi;
      since = now;
    } else if (now - since >= (isExpected(pitch.midi) ? fastMs : stableMs) && emitted !== pitch.midi) {
      emitted = pitch.midi;
      floor = level;
      onNote?.(pitch);
    }
  }
  raf = requestAnimationFrame(loop);

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(raf);
      source.disconnect(filters[0]);
    },
    setTuning(cents) {
      tuning = cents;
    },
    setThreshold(rmsLevel) {
      threshold = rmsLevel;
    },
  };
}
