// Modèle musical : notes, noms français, positions sur la portée.
// Octaves en notation scientifique (Do4 = do du milieu du piano) ; jamais affichées à l'écran.

export const LETTERS = ['Do', 'Ré', 'Mi', 'Fa', 'Sol', 'La', 'Si'];
const SEMITONES = [0, 2, 4, 5, 7, 9, 11];

export const ACC_SYMBOL = { '-1': '♭', 0: '♮', 1: '♯' };
const ACC_NAME = { '-1': 'bémol', 0: '', 1: 'dièse' };

export function note(letter, octave, acc = 0) {
  return { letter, octave, acc };
}

export function diatonic(n) {
  return n.octave * 7 + n.letter;
}

export function fromDiatonic(d, acc = 0) {
  return { letter: ((d % 7) + 7) % 7, octave: Math.floor(d / 7), acc };
}

export function pitchClass(n) {
  return (SEMITONES[n.letter] + n.acc + 12) % 12;
}

export function midi(n) {
  return (n.octave + 1) * 12 + SEMITONES[n.letter] + n.acc;
}

// Ligne du milieu : Si4 en clé de sol, Ré3 en clé de fa.
export const MIDDLE_LINE = { sol: diatonic(note(6, 4)), fa: diatonic(note(1, 3)) };

// Position en demi-interlignes au-dessus (+) ou au-dessous (−) de la ligne du milieu.
// Les 5 lignes de la portée sont aux positions −4, −2, 0, 2, 4.
export function staffPos(n, clef) {
  return diatonic(n) - MIDDLE_LINE[clef];
}

// Lignes supplémentaires nécessaires pour une position donnée.
export function ledgerLines(pos) {
  const lines = [];
  for (let p = 6; p <= pos; p += 2) lines.push(p);
  for (let p = -6; p >= pos; p -= 2) lines.push(p);
  return lines;
}

// Note la plus simple à lire pour une hauteur MIDI (dièses par défaut, bémols si demandé).
export function fromMidi(m, preferFlat = false) {
  const pc = ((m % 12) + 12) % 12;
  const natural = SEMITONES.indexOf(pc);
  const octave = Math.floor(m / 12) - 1;
  if (natural >= 0) return note(natural, octave);
  return preferFlat ? note(SEMITONES.indexOf(pc + 1), octave, -1) : note(SEMITONES.indexOf(pc - 1), octave, 1);
}

export function noteName(n) {
  return n.acc ? `${LETTERS[n.letter]} ${ACC_NAME[n.acc]}` : LETTERS[n.letter];
}

export function shortName(n) {
  return n.acc ? LETTERS[n.letter] + ACC_SYMBOL[n.acc] : LETTERS[n.letter];
}

// Mi♯, Si♯, Do♭, Fa♭ : exclus pour garder le clavier sans ambiguïté.
export function isAmbiguous(n) {
  return (n.acc === 1 && (n.letter === 2 || n.letter === 6)) ||
         (n.acc === -1 && (n.letter === 0 || n.letter === 3));
}

export function noteKey(clef, n) {
  return `${clef}:${diatonic(n)}:${n.acc}`;
}

export function parseKey(key) {
  const [clef, d, acc] = key.split(':');
  return { clef, note: fromDiatonic(Number(d), Number(acc)) };
}
