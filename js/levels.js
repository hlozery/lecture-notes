// Définition des niveaux (données) et construction du réservoir de notes / d'accords.
import { note, diatonic, fromDiatonic, isAmbiguous, noteKey } from './music.js';
import { QUALITY_ORDER, makeChordItem } from './chords.js';

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

// layout : 'single' (une portée, clé selon l'élément) ou 'grand' (grand portée sol + fa).
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

const NAT = [DO, RE, MI, FA, SOL, LA, SI].map((letter) => ({ letter, acc: 0 }));
const ALT = [[SI, -1], [MI, -1], [LA, -1], [RE, -1], [FA, 1], [DO, 1]].map(([letter, acc]) => ({ letter, acc }));
const TRIADS = ['maj', 'min'];
const SEVENTHS = ['dom7', 'maj7', 'min7'];

export const CHORD_LEVELS = [
  { id: 'c1', title: 'Accords majeurs', desc: 'Clé de sol, position fondamentale', layout: 'single',
    chords: { clefs: ['sol'], roots: NAT, qualities: ['maj'], inversions: [0] }, time: 12 },
  { id: 'c2', title: 'Accords mineurs', desc: 'Clé de sol, position fondamentale', layout: 'single',
    chords: { clefs: ['sol'], roots: NAT, qualities: ['min'], inversions: [0] }, time: 12 },
  { id: 'c3', title: 'Majeur ou mineur ?', desc: 'Clé de sol, trouver la couleur de l’accord', layout: 'single',
    chords: { clefs: ['sol'], roots: NAT, qualities: TRIADS, inversions: [0] }, time: 10 },
  { id: 'c4', title: 'Accords en clé de fa', desc: 'Majeurs et mineurs', layout: 'single',
    chords: { clefs: ['fa'], roots: NAT, qualities: TRIADS, inversions: [0] }, time: 10 },
  { id: 'c5', title: 'Fondamentales altérées', desc: 'Si♭, Mi♭, La♭, Ré♭, Fa♯, Do♯', layout: 'single',
    chords: { clefs: ['sol', 'fa'], roots: [...NAT, ...ALT], qualities: TRIADS, inversions: [0] }, time: 10 },
  { id: 'c6', title: '1er renversement', desc: 'La tierce passe à la basse', layout: 'single',
    chords: { clefs: ['sol', 'fa'], roots: NAT, qualities: TRIADS, inversions: [0, 1] }, time: 10 },
  { id: 'c7', title: 'Tous les renversements', desc: 'Fondamentale, 1er et 2e renversements', layout: 'single',
    chords: { clefs: ['sol', 'fa'], roots: [...NAT, ...ALT], qualities: TRIADS, inversions: [0, 1, 2] }, time: 9 },
  { id: 'c8', title: 'Accords de septième', desc: '7, maj7 et m7 en position fondamentale', layout: 'single',
    chords: { clefs: ['sol', 'fa'], roots: NAT, qualities: SEVENTHS, inversions: [0] }, time: 12 },
  { id: 'c9', title: 'Septièmes renversées', desc: 'Tous les accords, tous les renversements', layout: 'single',
    chords: { clefs: ['sol', 'fa'], roots: [...NAT, ...ALT], qualities: QUALITY_ORDER, inversions: [0, 1, 2, 3] }, time: 10 },
  { id: 'c10', title: 'Maître des accords', desc: 'Tout mélangé, 6 secondes', layout: 'single',
    chords: { clefs: ['sol', 'fa'], roots: [...NAT, ...ALT], qualities: QUALITY_ORDER, inversions: [0, 1, 2, 3] }, time: 6 },
];

// Tous les éléments possibles d'un niveau : notes { kind, clef, note, key } et/ou accords (voir chords.js).
export function buildPool(level) {
  const pool = [];
  for (const [clef, [lo, hi]] of Object.entries(level.ranges || {})) {
    for (let dia = lo; dia <= hi; dia++) {
      for (const acc of level.accs) {
        const n = fromDiatonic(dia, acc);
        if (!isAmbiguous(n)) pool.push({ kind: 'note', clef, note: n, key: noteKey(clef, n) });
      }
    }
  }
  if (level.chords) {
    const { clefs, roots, qualities, inversions } = level.chords;
    for (const clef of clefs) {
      for (const root of roots) {
        for (const quality of qualities) {
          for (const inv of inversions) {
            const item = makeChordItem(clef, root, quality, inv);
            if (item) pool.push(item);
          }
        }
      }
    }
  }
  return pool;
}

// Niveau personnalisé du mode libre : notes, accords ou les deux.
export function freeLevel(f) {
  const level = { id: 'libre', title: 'Mode libre', layout: f.clefs === 'grand' ? 'grand' : 'single', time: f.time };
  if (f.content !== 'chords') {
    const ranges = {};
    if (f.clefs === 'grand') {
      ranges.sol = RANGES.solGrand;
      ranges.fa = RANGES.faGrand;
    } else {
      if (f.clefs !== 'fa') ranges.sol = f.ledger ? RANGES.solExt : RANGES.solIn;
      if (f.clefs !== 'sol') ranges.fa = f.ledger ? RANGES.faExt : RANGES.faIn;
    }
    const accMap = { none: [0], sharps: [0, 1], flats: [0, -1], both: [-1, 0, 1] };
    level.ranges = ranges;
    level.accs = accMap[f.accs] || [0];
  }
  if (f.content !== 'notes') {
    const typeMap = { triads: TRIADS, sevenths: SEVENTHS, all: QUALITY_ORDER };
    level.chords = {
      clefs: f.clefs === 'sol' || f.clefs === 'fa' ? [f.clefs] : ['sol', 'fa'],
      roots: f.chordAcc ? [...NAT, ...ALT] : NAT,
      qualities: typeMap[f.chordTypes] || TRIADS,
      inversions: f.inversions ? [0, 1, 2, 3] : [0],
    };
  }
  return level;
}

// 0 à 3 étoiles selon la précision et la vitesse moyenne des bonnes réponses.
export function starsFor(accuracy, avgMs, timeSec) {
  if (accuracy < PASS_RATE) return 0;
  if (accuracy < 0.95) return 1;
  if (timeSec && avgMs < timeSec * 500) return 3;
  return 2;
}

// Un niveau est ouvert si c'est le premier de sa liste ou si le précédent a au moins une étoile.
export function isUnlocked(level, list, progress) {
  const i = list.indexOf(level);
  return i === 0 || (progress[list[i - 1]?.id]?.stars || 0) > 0;
}
