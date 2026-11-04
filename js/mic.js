// Écoute du piano au micro : niveau sonore, hauteur détectée, notes stables.
import { yin, rms, nearestNote } from './pitch.js';
import { analyzeChord } from './chord-detect.js';

// Seuils de volume (RMS, mesuré après filtrage) selon la sensibilité choisie (−34 dB à −70 dB).
export const SENSITIVITY = { low: 0.02, medium: 0.004, high: 0.001, max: 0.0003 };

// Filtres appliqués avant l'analyse : les notes du jeu (Do2–Do6) vivent entre 65 et ~1 000 Hz ;
// on retire le grondement grave et le souffle aigu, qui brouillent la détection (mesuré dans tests.html).
export const FILTERS = [['highpass', 60], ['highpass', 60], ['lowpass', 2000], ['lowpass', 2000]];

// Netteté minimale d'une hauteur détectée (1 = son parfaitement périodique).
export const MIN_CLARITY = 0.8;

// Justesse exigée pour une note seule : écart maximal (cents) avec la note la plus proche.
export const PRECISION = { loose: 50, normal: 35, strict: 20 };
// Délai avant de compter une fausse note : durée de tenue (ms) d'une autre note,
// et nombre d'analyses de suite (~90 ms chacune) pour un autre accord. « Long » aide avec la pédale.
export const PATIENCE = {
  short: { stableMs: 120, chordFrames: 4 },
  normal: { stableMs: 180, chordFrames: 6 },
  long: { stableMs: 450, chordFrames: 11 },
};
// Options d'écoute tirées des réglages.
export function listenOptions(settings) {
  return {
    threshold: thresholdFor(settings),
    tuning: settings.tuning || 0,
    tolerance: PRECISION[settings.micPrecision] || PRECISION.loose,
    ...(PATIENCE[settings.micPatience] || PATIENCE.normal),
  };
}

// Seuil effectif : mesuré dans la pièce (« auto ») ou choisi parmi les niveaux.
export function thresholdFor(settings) {
  if (settings.micSensitivity === 'auto' && settings.micThreshold) return settings.micThreshold;
  return SENSITIVITY[settings.micSensitivity] || SENSITIVITY.medium;
}

/**
 * Ouvre le micro. À appeler pendant un geste de l'utilisateur (toucher) : iOS n'autorise
 * le démarrage du son que dans ce cas, d'où la création du contexte audio avant l'attente.
 * boost : laisser l'iPhone amplifier le micro (traitement « voix », comme pendant un appel).
 * Sans lui, le son est brut mais souvent très faible sur iPhone.
 */
export async function openMicrophone({ boost = true } = {}) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  ctx.resume();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: boost, noiseSuppression: false, autoGainControl: boost },
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
  return Math.min(SENSITIVITY.low, Math.max(0.0002, p90 * 1.5));
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
 * Mode accord (setChord(judge)) : toutes les ~90 ms, le spectre est comparé à l'accord attendu.
 *  judge(analyse) → { ok: true } | { ok: false, heard } | null (voir chord-detect.js) ;
 *  onChordFrame(analyse) pour l'affichage, onChord(verdict) une fois par attaque, quand le
 *  verdict est stable : 2 analyses de suite pour le bon accord, chordFrames pour un autre accord
 *  (~0,5 s par défaut : le temps que l'accord précédent, s'il résonne encore, ne fausse plus l'écoute).
 * tolerance : écart maximal en cents pour reconnaître une note seule (au-delà : rien).
 * withChords : en mode notes, analyse aussi le spectre et le passe à onChordFrame (écran de test).
 *  setChord(null) revient aux notes seules.
 * setTuning(cents) et setThreshold(rms) changent les réglages sans couper le micro.
 */
export const CHORD_FFT = 16384; // ~0,34 s de son : de quoi séparer deux notes graves voisines
export function createListener(ctx, source, {
  threshold, tuning = 0, fastMs = 60, stableMs = 180, chordFrames = 6, tolerance = 50,
  isExpected = () => false, onFrame, onNote, onChordFrame, onChord, withChords = false,
}) {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  const big = ctx.createAnalyser();
  big.fftSize = CHORD_FFT;
  const filters = FILTERS.map(([type, freq]) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    return f;
  });
  [source, ...filters, analyser].reduce((from, to) => from.connect(to));
  filters.at(-1).connect(big);
  const buf = new Float32Array(analyser.fftSize);
  const bigBuf = new Float32Array(big.fftSize);
  let raf = 0, lastTick = 0;
  let candidate = null, since = 0;
  let emitted = null, floor = Infinity;
  let judge = null, lastChord = 0, run = { key: null, n: 0 }, chordDone = false;
  let hold = false; // après un changement note ↔ accord : attendre une nouvelle frappe

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (now - lastTick < 30) return;
    lastTick = now;
    analyser.getFloatTimeDomainData(buf);
    const level = rms(buf);

    // Nouvelle frappe : le volume remonte nettement après avoir baissé.
    floor = Math.min(floor, level);
    if (level > floor * 1.8 || level < threshold) hold = false;
    if (level > floor * 1.8) {
      emitted = null;
      chordDone = false;
    }
    if (judge) return chordFrame(now, level);

    let pitch = null;
    if (level >= threshold) {
      const r = yin(buf, ctx.sampleRate);
      if (r && r.clarity >= MIN_CLARITY) {
        const n = nearestNote(r.freq, tuning);
        if (Math.abs(n.cents) <= tolerance) pitch = { ...n, freq: r.freq };
      }
    }
    onFrame?.({ level, pitch });
    if (withChords) chordDisplay(now, level);

    if (!pitch) {
      candidate = null;
      if (level < threshold) emitted = null;
      return;
    }
    if (pitch.midi !== candidate) {
      candidate = pitch.midi;
      since = now;
    } else if (!hold && now - since >= (isExpected(pitch.midi) ? fastMs : stableMs) && emitted !== pitch.midi) {
      emitted = pitch.midi;
      floor = level;
      onNote?.(pitch);
    }
  }

  // Écran de test : notes et accord entendus, sans rien valider.
  function chordDisplay(now, level) {
    if (level < threshold) return onChordFrame?.(null);
    if (now - lastChord < 90) return;
    lastChord = now;
    big.getFloatTimeDomainData(bigBuf);
    onChordFrame?.(analyzeChord(bigBuf, ctx.sampleRate, tuning));
  }

  function chordFrame(now, level) {
    onFrame?.({ level, pitch: null });
    if (level < threshold) {
      run = { key: null, n: 0 };
      chordDone = false;
      onChordFrame?.(null);
      return;
    }
    if (now - lastChord < 90) return;
    lastChord = now;
    big.getFloatTimeDomainData(bigBuf);
    const analysis = analyzeChord(bigBuf, ctx.sampleRate, tuning);
    onChordFrame?.(analysis);
    const verdict = judge(analysis);
    const key = verdict && (verdict.ok ? 'ok' : `${verdict.heard.pc}:${verdict.heard.quality}:${verdict.heard.bass}`);
    run = key === run.key ? { key, n: run.n + 1 } : { key, n: 1 };
    if (key && !hold && !chordDone && run.n >= (verdict.ok ? 2 : chordFrames)) {
      chordDone = true;
      floor = level;
      onChord?.(verdict);
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
    // Accord attendu (fonction de jugement) ou null pour revenir aux notes.
    // Un accord encore tenu ne compte pas pour le suivant : il faut le rejouer.
    setChord(fn) {
      if (!fn !== !judge) {
        hold = true;
        floor = Infinity;
      }
      judge = fn;
      run = { key: null, n: 0 };
      candidate = null;
    },
  };
}
