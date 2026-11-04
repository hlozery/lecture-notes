// Reconnaissance d'accords au micro : spectre → pics → « chroma » (énergie des 12 notes de la gamme)
// → comparaison avec les modèles des accords du jeu. Fonctions pures, testées dans tests.html.
import { QUALITIES, QUALITY_ORDER } from './chords.js';

// Transformée de Fourier (radix 2, en place). n doit être une puissance de 2.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

// Amplitude du spectre (fenêtre de Hann).
export function spectrum(buf) {
  const n = buf.length;
  const re = new Float32Array(n), im = new Float32Array(n);
  for (let i = 0; i < n; i++) re[i] = buf[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  fft(re, im);
  const mag = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

// Pics du spectre entre minFreq et maxFreq, à plus de −30 dB du plus fort ; fréquence affinée par interpolation.
export function findPeaks(mag, sampleRate, { minFreq = 60, maxFreq = 2100, floor = 0.03 } = {}) {
  const binHz = sampleRate / (2 * mag.length);
  const lo = Math.max(2, Math.floor(minFreq / binHz)), hi = Math.min(mag.length - 2, Math.ceil(maxFreq / binHz));
  let max = 0;
  for (let i = lo; i <= hi; i++) max = Math.max(max, mag[i]);
  if (!max) return [];
  const peaks = [];
  for (let i = lo; i <= hi; i++) {
    const m = mag[i];
    if (m < max * floor || m <= mag[i - 1] || m < mag[i + 1]) continue;
    const a = Math.log(mag[i - 1] + 1e-12), b = Math.log(m), c = Math.log(mag[i + 1] + 1e-12);
    const d = a + c - 2 * b;
    const shift = d ? (a - c) / (2 * d) : 0;
    peaks.push({ freq: (i + shift) * binHz, mag: m });
  }
  return peaks;
}

// Amplitudes compressées (racine) : une note jouée plus fort n'écrase pas les autres.
export const COMPRESS = 0.5;

// Pic qui n'est qu'un harmonique (3, 5, 6 ou 7 fois la fréquence) d'un pic plus grave et plus fort :
// il colore le son mais ne prouve pas que la note est jouée (la quinte d'un Do joué seul, par exemple).
const HARMONIC_RANKS = [3, 5, 6, 7];
// Force d'une note grave : son pic ou celui de son octave (le micro de l'iPhone capte mal les fondamentales graves).
function strength(q, peaks) {
  const octave = peaks.find((o) => Math.abs(o.freq / (2 * q.freq) - 1) < 0.012);
  return Math.max(q.mag, octave ? octave.mag : 0);
}
function isHarmonic(p, lower, peaks) {
  return lower.some((q) => p.mag <= strength(q, peaks) * 0.7 && HARMONIC_RANKS.some((k) => {
    const r = p.freq / (q.freq * k);
    return r > 0.99 && r < 1.025; // les harmoniques du piano sont un peu trop hauts
  }));
}

/**
 * Chroma : énergie de chaque note (0 = Do … 11 = Si), toutes octaves confondues ;
 * fund : la même sans les pics qui ne sont que des harmoniques d'autres notes ;
 * bass : la note la plus grave nettement présente (pour vérifier le renversement).
 */
export function chromaFromPeaks(peaks, tuning = 0) {
  const chroma = new Array(12).fill(0);
  const fund = new Array(12).fill(0);
  const max = Math.max(0, ...peaks.map((p) => p.mag));
  const strong = peaks.filter((p) => p.mag >= max * 0.1);
  let bass = null;
  for (const p of peaks) {
    const m = 69 + 12 * Math.log2(p.freq / 440) - tuning / 100;
    const midi = Math.round(m);
    const strongLow = bass === null && p.mag >= max * 0.15;
    if (Math.abs(m - midi) > 0.4) {
      // Entre deux notes : bruit, harmonique décalé, ou deux notes graves à un demi-ton
      // confondues dans le spectre — dans ce dernier cas la basse est la plus grave des deux.
      if (strongLow) bass = ((Math.floor(m) % 12) + 12) % 12;
      continue;
    }
    const pc = ((midi % 12) + 12) % 12;
    const v = p.mag ** COMPRESS;
    chroma[pc] += v;
    if (!isHarmonic(p, strong.filter((q) => q.freq < p.freq), peaks)) fund[pc] += v;
    if (strongLow) bass = pc;
  }
  return { chroma, fund, bass };
}

export function analyzeChord(buf, sampleRate, tuning = 0) {
  return chromaFromPeaks(findPeaks(spectrum(buf), sampleRate), tuning);
}

// Modèle d'un accord : chaque note avec ses harmoniques (amplitude 1/k), ramenées sur les 12 notes.
const HARMONIC_PCS = [0, 0, 7, 0, 4, 7, 10, 0]; // harmoniques 1 à 8 : octave, quinte, tierce, septième…
const HARMONIC_W = HARMONIC_PCS.map((_, k) => (1 / (k + 1)) ** COMPRESS);
function template(pcs) {
  const t = new Array(12).fill(0);
  for (const pc of pcs) HARMONIC_PCS.forEach((off, k) => { t[(pc + off) % 12] += HARMONIC_W[k]; });
  return t;
}

export function chordPcs(rootPc, quality) {
  return QUALITIES[quality].iv.map((iv) => (rootPc + iv) % 12);
}

// Les 60 accords possibles (12 fondamentales × 5 qualités).
const CANDIDATES = [];
for (let pc = 0; pc < 12; pc++) {
  for (const quality of QUALITY_ORDER) {
    const pcs = chordPcs(pc, quality);
    CANDIDATES.push({ pc, quality, pcs, t: template(pcs) });
  }
}

function cosine(a, b) {
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < 12; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
}

// Toutes les notes de l'accord sont bien là : au moins 30 % de la plus forte,
// dont la moitié au moins ne s'explique pas par les harmoniques des autres notes.
export const TONE_RATIO = 0.3;
function allPresent({ chroma, fund }, pcs) {
  const max = Math.max(...chroma);
  return max > 0 && pcs.every((pc) => chroma[pc] >= max * TONE_RATIO && fund[pc] >= max * TONE_RATIO / 2);
}

// Notes entendues (pour l'affichage en direct), selon les mêmes critères.
export function heardPcs(analysis) {
  return [...Array(12).keys()].filter((pc) => allPresent(analysis, [pc]));
}

// Accord entendu : parmi ceux dont toutes les notes sont là, le plus complet (Do 7 plutôt que Do majeur
// quand le Si bémol est bien présent), puis le plus ressemblant. { pc, quality, pcs, score } ou null.
export function bestChord(analysis) {
  const { chroma } = analysis;
  let best = null;
  for (const c of CANDIDATES) {
    if (!allPresent(analysis, c.pcs)) continue;
    const score = cosine(chroma, c.t);
    if (!best || c.pcs.length > best.pcs.length || (c.pcs.length === best.pcs.length && score > best.score)) {
      best = { pc: c.pc, quality: c.quality, pcs: c.pcs, score };
    }
  }
  return best;
}

export const MIN_SCORE = 0.75;

/**
 * Verdict pour l'accord attendu { rootPc, quality, bassPc } :
 *  { ok: true } si c'est lui (et la bonne note à la basse si checkBass),
 *  { ok: false, heard: { pc, quality } } si on reconnaît nettement un autre accord,
 *  null si on ne sait pas encore (accord incomplet, son confus).
 */
export function judgeChord(analysis, expected, { checkBass = false } = {}) {
  const { bass } = analysis;
  const best = bestChord(analysis);
  if (!best || best.score < MIN_SCORE) return null;
  const same = best.pc === expected.rootPc && best.quality === expected.quality;
  // Basse à un demi-ton d'une autre note de l'accord (maj7 au 3e renversement) : dans le grave,
  // les deux se confondent dans le spectre, on accepte donc la note juste au-dessus.
  const bassOk = bass === expected.bassPc || (bass === (expected.bassPc + 1) % 12 && best.pcs.includes(bass));
  if (same && (!checkBass || bassOk)) return { ok: true };
  return { ok: false, heard: { pc: best.pc, quality: best.quality, bass, inversionOnly: same } };
}
