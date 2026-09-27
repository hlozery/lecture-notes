// Définition des niveaux (données) et construction du réservoir de notes.
import { note, diatonic, fromDiatonic, isAmbiguous } from './music.js';

const [DO, RE, MI, FA, SOL, LA, SI] = [0, 1, 2, 3, 4, 5, 6];
const d = (letter, octave) => diatonic(note(letter, octave));

export const RANGES = {
  solIn: [d(MI, 4), d(FA, 5)],
  solExt: [d(LA, 3), d(DO, 6)],
  faIn: [d(SOL, 2), d(LA, 3)],
  faExt: [d(MI, 2), d(MI, 4)],
  solGrand: [d(DO, 4), d(DO, 6)],
  faGrand: [d(DO, 2), d(DO, 4)],
};

export const NOTES_PER_GAME = 20;
export const PASS_RATE = 0.85;

// layout : 'single' (une portée, clé selon la note) ou 'grand' (grand portée sol + fa).
export const LEVELS = [
  { id: 1, title: 'Clé de sol', desc: 'Les notes dans la portée', layout: 'single',
    ranges: { sol: RANGES.solIn }, accs: [0], time: 8 },
  { id: 2, title: 'Clé de fa', desc: 'Les notes dans la portée', layout: 'single',
    ranges: { fa: RANGES.faIn }, accs: [0], time: 8 },
  { id: 3, title: 'Sol : lignes supplémentaires', desc: 'Au-dessus et au-dessous de la portée', layout: 'single',
    ranges: { sol: RANGES.solExt }, accs: [0], time: 7 },
  { id: 4, title: 'Fa : lignes supplémentaires', desc: 'Au-dessus et au-dessous de la portée', layout: 'single',
    ranges: { fa: RANGES.faExt }, accs: [0], time: 7 },
  { id: 5, title: 'Sol et fa mélangées', desc: 'La clé change à chaque note', layout: 'single',
    ranges: { sol: RANGES.solExt, fa: RANGES.faExt }, accs: [0], time: 6 },
  { id: 6, title: 'Les dièses', desc: 'Clé de sol avec des ♯', layout: 'single',
    ranges: { sol: RANGES.solIn }, accs: [0, 1], time: 6 },
  { id: 7, title: 'Les bémols', desc: 'Clé de fa avec des ♭', layout: 'single',
    ranges: { fa: RANGES.faIn }, accs: [0, -1], time: 6 },
  { id: 8, title: 'Dièses et bémols', desc: 'Les deux clés, toutes les altérations', layout: 'single',
    ranges: { sol: RANGES.solExt, fa: RANGES.faExt }, accs: [-1, 0, 1], time: 5 },
  { id: 9, title: 'Grand portée', desc: 'Comme sur une vraie partition de piano', layout: 'grand',
    ranges: { sol: RANGES.solGrand, fa: RANGES.faGrand }, accs: [0], time: 5 },
  { id: 10, title: 'Maître du piano', desc: 'Grand portée, altérations, 3 secondes', layout: 'grand',
    ranges: { sol: RANGES.solGrand, fa: RANGES.faGrand }, accs: [-1, 0, 1], time: 3 },
];

// Toutes les notes possibles d'un niveau : [{ clef, note }].
export function buildPool(level) {
  const pool = [];
  for (const [clef, [lo, hi]] of Object.entries(level.ranges)) {
    for (let dia = lo; dia <= hi; dia++) {
      for (const acc of level.accs) {
        const n = fromDiatonic(dia, acc);
        if (!isAmbiguous(n)) pool.push({ clef, note: n });
      }
    }
  }
  return pool;
}

// Niveau personnalisé du mode libre.
export function freeLevel({ clefs, ledger, accs, time }) {
  const ranges = {};
  if (clefs === 'grand') {
    ranges.sol = RANGES.solGrand;
    ranges.fa = RANGES.faGrand;
  } else {
    if (clefs !== 'fa') ranges.sol = ledger ? RANGES.solExt : RANGES.solIn;
    if (clefs !== 'sol') ranges.fa = ledger ? RANGES.faExt : RANGES.faIn;
  }
  const accMap = { none: [0], sharps: [0, 1], flats: [0, -1], both: [-1, 0, 1] };
  return {
    id: 'libre', title: 'Mode libre', layout: clefs === 'grand' ? 'grand' : 'single',
    ranges, accs: accMap[accs] || [0], time,
  };
}

// 0 à 3 étoiles selon la précision et la vitesse moyenne des bonnes réponses.
export function starsFor(accuracy, avgMs, timeSec) {
  if (accuracy < PASS_RATE) return 0;
  if (accuracy < 0.95) return 1;
  if (timeSec && avgMs < timeSec * 500) return 3;
  return 2;
}

export function isUnlocked(id, progress) {
  return id === 1 || (progress[id - 1]?.stars || 0) > 0;
}
