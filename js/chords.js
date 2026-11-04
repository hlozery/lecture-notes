// Accords : qualités, orthographe correcte des notes, renversements, noms français.
import { note, diatonic, fromDiatonic, midi, LETTERS, shortName } from './music.js';

export const QUALITIES = {
  maj: { label: 'Majeur', name: 'majeur', short: '', iv: [0, 4, 7] },
  min: { label: 'mineur', name: 'mineur', short: 'm', iv: [0, 3, 7] },
  dom7: { label: '7', name: '7', short: '7', iv: [0, 4, 7, 10] },
  maj7: { label: 'maj7', name: 'maj7', short: 'maj7', iv: [0, 4, 7, 11] },
  min7: { label: 'm7', name: 'm7', short: 'm7', iv: [0, 3, 7, 10] },
};
export const QUALITY_ORDER = ['maj', 'min', 'dom7', 'maj7', 'min7'];
export const INVERSION_NAMES = ['position fondamentale', '1er renversement', '2e renversement', '3e renversement'];

// Plage de la note la plus grave (une octave à partir de lo) pour rester lisible sur la portée.
const [DO, MI] = [0, 2];
export const CHORD_BASS = { sol: diatonic(note(DO, 4)), fa: diatonic(note(MI, 2)) };

// Notes de l'accord en position fondamentale, empilées en tierces (Ré mineur = Ré Fa La).
export function spellChord(root, quality) {
  const base = midi(root);
  const d0 = diatonic(root);
  return QUALITIES[quality].iv.map((iv, i) => {
    const n = fromDiatonic(d0 + 2 * i);
    n.acc = base + iv - midi(n);
    return n;
  });
}

// Accord renversé et placé dans le registre de la clé ; null si une double altération serait nécessaire.
export function voiceChord(root, quality, inversion, clef) {
  const notes = spellChord(note(root.letter, 4, root.acc), quality);
  if (inversion >= notes.length || notes.some((n) => Math.abs(n.acc) > 1)) return null;
  for (let i = 0; i < inversion; i++) notes[i] = { ...notes[i], octave: notes[i].octave + 1 };
  notes.sort((a, b) => diatonic(a) - diatonic(b));
  const shift = Math.ceil((CHORD_BASS[clef] - diatonic(notes[0])) / 7);
  return notes.map((n) => ({ ...n, octave: n.octave + shift }));
}

export function chordKey(clef, root, quality, inversion) {
  return `ch:${clef}:${root.letter}:${root.acc}:${quality}:${inversion}`;
}

export function makeChordItem(clef, root, quality, inversion) {
  const chord = voiceChord(root, quality, inversion, clef);
  return chord && { kind: 'chord', clef, root, quality, inversion, chord, key: chordKey(clef, root, quality, inversion) };
}

export function parseChordKey(key) {
  const [, clef, letter, acc, quality, inversion] = key.split(':');
  return makeChordItem(clef, { letter: Number(letter), acc: Number(acc) }, quality, Number(inversion));
}

export function isChordKey(key) {
  return key.startsWith('ch:');
}

// « Ré mineur », « Sol 7 », « Si bémol maj7 ».
export function chordName(item) {
  const r = item.root;
  const root = LETTERS[r.letter] + (r.acc === 1 ? ' dièse' : r.acc === -1 ? ' bémol' : '');
  return `${root} ${QUALITIES[item.quality].name}`;
}

// « Rém », « Sol7 », « Si♭maj7 ».
export function chordShort(item) {
  return shortName(item.root) + QUALITIES[item.quality].short;
}
