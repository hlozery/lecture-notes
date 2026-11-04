// Écoute du piano au micro : niveau sonore, hauteur détectée, notes stables.
import { yin, rms, nearestNote } from './pitch.js';

// Seuils de volume (RMS) selon la sensibilité choisie dans les réglages.
export const SENSITIVITY = { low: 0.03, medium: 0.012, high: 0.005 };

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

export function micErrorMessage(err) {
  if (!navigator.mediaDevices?.getUserMedia) return 'Ce navigateur ne donne pas accès au micro.';
  if (err?.name === 'NotAllowedError') return 'Accès au micro refusé. Autorisez-le dans Réglages › Safari › Micro, puis relancez.';
  if (err?.name === 'NotFoundError') return 'Aucun micro trouvé.';
  return 'Le micro n’a pas pu démarrer.';
}

/**
 * Analyse le son en continu (~30 fois par seconde).
 *  onFrame({ level, pitch }) : à chaque analyse (pitch = { midi, cents, freq } ou null) ;
 *  onNote(pitch) : quand une note reste stable stableMs — une seule fois par attaque,
 *    la même note n'est redonnée qu'après un silence ou une nouvelle frappe.
 * setTuning(cents) change l'accordage sans couper le micro.
 */
export function createListener(ctx, source, { threshold, tuning = 0, stableMs = 120, onFrame, onNote }) {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
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
      if (r && r.clarity > 0.8) pitch = { ...nearestNote(r.freq, tuning), freq: r.freq };
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
    } else if (now - since >= stableMs && emitted !== pitch.midi) {
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
      source.disconnect(analyser);
    },
    setTuning(cents) {
      tuning = cents;
    },
  };
}
