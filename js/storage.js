// Sauvegarde locale. Toute erreur de stockage est ignorée : le jeu reste jouable.
const KEY = 'lecture-notes:v1';

function defaults() {
  return {
    mode: 'notes', // onglet de l'accueil : 'notes' | 'chords'
    progress: {}, // { [idNiveau]: { stars, best } }
    stats: {},
    settings: { input: 'buttons', micOctave: 'exact', micSensitivity: 'medium', tuning: 0 },
    free: {
      content: 'notes', clefs: 'sol', ledger: false, accs: 'none', time: 8,
      chordTypes: 'triads', inversions: false, chordAcc: false,
    },
  };
}

export function load() {
  const data = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) {
      if (saved.mode) data.mode = saved.mode;
      Object.assign(data.progress, saved.progress);
      Object.assign(data.stats, saved.stats);
      Object.assign(data.settings, saved.settings);
      Object.assign(data.free, saved.free);
    }
  } catch { /* stockage indisponible */ }
  return data;
}

export function save(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* ignoré */ }
}

export function reset() {
  try { localStorage.removeItem(KEY); } catch { /* ignoré */ }
  return defaults();
}
