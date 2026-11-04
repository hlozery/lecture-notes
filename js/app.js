// Navigation entre écrans, onglets Notes / Accords, progression, réglages.
import { LEVELS, CHORD_LEVELS, RANGES, buildPool, freeLevel, starsFor, isUnlocked } from './levels.js';
import { fromDiatonic, fromMidi, noteName, noteKey, parseKey, shortName } from './music.js';
import { nearestNote } from './pitch.js';
import { thresholdFor, thresholdFromNoise, openMicrophone, createListener, micErrorMessage } from './mic.js';
import { levelToPercent, levelToDb, meterHtml } from './input.js';
import { QUALITIES, QUALITY_ORDER, INVERSION_NAMES, makeChordItem, parseChordKey, isChordKey, chordShort, chordName } from './chords.js';
import { renderStaff } from './staff.js';
import { startGame } from './game.js';
import { accuracy, hardest, recentErrorRate } from './stats.js';
import { load, save, reset, MIC_DEFAULTS } from './storage.js';
import { bestChord, heardPcs } from './chord-detect.js';

const $ = (sel) => document.querySelector(sel);
let data = load();
let game = null;
let lastPlay = null;

const gameEls = {
  title: $('#g-title'), progress: $('#g-progress'), score: $('#g-score'), combo: $('#g-combo'),
  timer: $('#g-timer'), staff: $('#g-staff'), feedback: $('#g-feedback'), input: $('#g-input'),
};

const chordMode = () => data.mode === 'chords';
const levelList = () => (chordMode() ? CHORD_LEVELS : LEVELS);

function show(id) {
  document.querySelectorAll('.screen').forEach((s) => { s.hidden = s.id !== id; });
  window.scrollTo(0, 0);
}

const renderers = { home: renderHome, levels: renderLevels, stats: renderStats, free: renderFree, settings: renderSettings };

function go(id) {
  renderers[id]?.();
  show(id);
}

document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-go]');
  if (nav) go(nav.dataset.go);
});

function bindSeg(seg, value, onChange) {
  const buttons = [...seg.querySelectorAll('button')];
  const mark = (v) => buttons.forEach((b) => b.classList.toggle('selected', b.dataset.value === String(v)));
  mark(value);
  seg.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    mark(b.dataset.value);
    onChange(b.dataset.value);
  };
}

// ---------- Accueil ----------

function currentLevel() {
  const list = levelList();
  const unlocked = list.filter((l) => isUnlocked(l, list, data.progress));
  return unlocked.find((l) => !data.progress[l.id]?.stars) || unlocked[unlocked.length - 1];
}

function renderHome() {
  const list = levelList();
  const total = list.reduce((sum, l) => sum + (data.progress[l.id]?.stars || 0), 0);
  $('#star-total').textContent = `★ ${total} / ${list.length * 3}`;
  $('#btn-continue').textContent = `Jouer · Niveau ${list.indexOf(currentLevel()) + 1}`;
  bindSeg($('#mode-tabs'), data.mode, (v) => {
    data.mode = v;
    save(data);
    renderHome();
  });

  const [DO, FA, SOL, LA] = [0, 3, 4, 5];
  $('#home-staff').innerHTML = chordMode()
    ? renderStaff({
      layout: 'grand', stem: false, width: 300, spacing: 48,
      notes: [
        makeChordItem('fa', { letter: DO, acc: 0 }, 'maj', 0),
        makeChordItem('fa', { letter: LA, acc: 0 }, 'min', 1),
        makeChordItem('sol', { letter: FA, acc: 0 }, 'maj', 2),
        makeChordItem('sol', { letter: SOL, acc: 0 }, 'dom7', 0),
      ],
    })
    : renderStaff({
      layout: 'grand', stem: false, width: 300, spacing: 36,
      notes: [
        { clef: 'fa', note: fromDiatonic(RANGES.faIn[0] + 2) },
        { clef: 'fa', note: fromDiatonic(RANGES.faIn[0] + 6) },
        { clef: 'sol', note: fromDiatonic(RANGES.solIn[0] + 1) },
        { clef: 'sol', note: fromDiatonic(RANGES.solIn[0] + 3) },
        { clef: 'sol', note: fromDiatonic(RANGES.solIn[0] + 5) },
      ],
    });
}

$('#btn-continue').addEventListener('click', () => play(currentLevel()));

// ---------- Niveaux ----------

function starsHtml(n) {
  return [1, 2, 3].map((i) => `<span class="${i <= n ? 'on' : ''}">★</span>`).join('');
}

function renderLevels() {
  const list = levelList();
  $('#levels-title').textContent = chordMode() ? 'Niveaux · Accords' : 'Niveaux · Notes';
  const ol = $('#level-list');
  ol.innerHTML = '';
  list.forEach((level, i) => {
    const open = isUnlocked(level, list, data.progress);
    const p = data.progress[level.id];
    const li = document.createElement('li');
    li.innerHTML = `
      <button class="level ${open ? '' : 'locked'}" ${open ? '' : 'disabled'}>
        <span class="num">${open ? i + 1 : '🔒'}</span>
        <span class="info"><strong>${level.title}</strong>
          <small>${level.desc} · ${level.time} s ${level.chords ? 'par accord' : 'par note'}</small></span>
        <span class="lvl-stars">${open ? starsHtml(p?.stars || 0) : ''}</span>
      </button>`;
    if (open) li.querySelector('button').addEventListener('click', () => play(level));
    ol.append(li);
  });
}

// ---------- Jeu ----------

function play(level, pool = buildPool(level)) {
  lastPlay = { level, pool };
  game?.stop();
  show('game');
  game = startGame({
    level, pool, data, els: gameEls,
    onAnswered: () => save(data),
    onEnd: (result) => showResults(level, result),
  });
}

const rankedList = (level) => [LEVELS, CHORD_LEVELS].find((list) => list.includes(level));

$('#btn-quit').addEventListener('click', () => {
  game?.stop();
  go(rankedList(lastPlay.level) ? 'levels' : 'home');
});

// ---------- Résultats ----------

function showResults(level, r) {
  const acc = r.correct / r.total;
  const stars = starsFor(acc, r.avgMs, level.time);
  const list = rankedList(level);
  const nextLevel = list?.[list.indexOf(level) + 1];
  let msg;
  let record = false;
  let unlockedNext = null;

  if (list) {
    const prev = data.progress[level.id] || { stars: 0, best: 0 };
    record = prev.best > 0 && r.score > prev.best;
    data.progress[level.id] = { stars: Math.max(prev.stars, stars), best: Math.max(prev.best, r.score) };
    if (stars > 0 && !prev.stars && nextLevel) unlockedNext = nextLevel;
    save(data);
  }

  if (stars === 0) msg = 'Il faut 85 % de bonnes réponses pour réussir. Encore un essai !';
  else if (unlockedNext) msg = `Bravo ! Niveau ${list.indexOf(unlockedNext) + 1} débloqué : ${unlockedNext.title}.`;
  else if (stars === 3) msg = 'Parfait, précis et rapide !';
  else if (stars === 2) msg = 'Excellent ! Réponds plus vite pour la 3ᵉ étoile.';
  else msg = 'Réussi ! Vise 95 % pour la 2ᵉ étoile.';

  $('#r-title').textContent = level.title;
  $('#r-stars').innerHTML = list ? starsHtml(stars) : '';
  $('#r-msg').textContent = list ? msg : `${Math.round(acc * 100)} % de bonnes réponses.`;
  $('#r-acc').textContent = `${Math.round(acc * 100)} %`;
  $('#r-time').textContent = r.avgMs ? `${(r.avgMs / 1000).toFixed(1).replace('.', ',')} s` : '—';
  $('#r-combo').textContent = r.bestCombo;
  $('#r-score').textContent = r.score;
  $('#r-score-label').textContent = record ? 'points · record !' : 'points';
  $('#r-score-label').classList.toggle('record', record);

  // Éléments ratés, sans doublons, groupés par clé (notes puis accords).
  const seen = new Set();
  const missed = r.missed.filter((m) => !seen.has(m.key) && seen.add(m.key));
  let html = '';
  for (const kind of ['note', 'chord']) {
    for (const clef of ['sol', 'fa']) {
      const items = missed.filter((m) => m.clef === clef && (m.kind === 'chord') === (kind === 'chord')).slice(0, kind === 'chord' ? 5 : 8);
      if (!items.length) continue;
      html += `<div class="staff-card wide">${renderStaff({ layout: clef, notes: items, stem: false, spacing: kind === 'chord' ? 44 : 38, width: 200 })}</div>
        <p class="missed-names">${items.map((m) => (m.kind === 'chord' ? chordShort(m) : shortName(m.note))).join(' · ')}</p>`;
    }
  }
  $('#r-missed').innerHTML = html ? `<h3>À revoir</h3>${html}` : '';

  const btnNext = $('#btn-next');
  btnNext.hidden = !(nextLevel && isUnlocked(nextLevel, list, data.progress));
  btnNext.onclick = () => play(nextLevel);
  show('results');
}

$('#btn-replay').addEventListener('click', () => play(lastPlay.level, lastPlay.pool));

// ---------- Statistiques ----------

function colorFor(s) {
  const a = accuracy(s);
  if (a === null) return 'var(--muted)';
  if (recentErrorRate(s) === 0 && a >= 0.9) return 'var(--ok)';
  return recentErrorRate(s) >= 0.4 ? 'var(--bad)' : 'var(--warn)';
}

const keepForMode = () => (chordMode() ? isChordKey : (key) => !isChordKey(key));

function tile(label, entries) {
  const n = entries.reduce((a, s) => a + s.n, 0);
  const e = entries.reduce((a, s) => a + s.e, 0);
  const value = n ? `${Math.round((1 - e / n) * 100)} %` : '—';
  return `<div class="tile" style="--c:${n ? colorFor({ n, e, r: entries.flatMap((s) => s.r) }) : 'var(--muted)'}">
    <strong>${value}</strong><span>${label}</span></div>`;
}

function renderStats() {
  const chords = chordMode();
  const keep = keepForMode();
  const own = Object.entries(data.stats).filter(([key]) => keep(key));
  const n = own.reduce((a, [, s]) => a + s.n, 0);
  const e = own.reduce((a, [, s]) => a + s.e, 0);
  $('#s-summary').textContent = n
    ? `${n} ${chords ? 'accords' : 'notes'} joués · ${Math.round((1 - e / n) * 100)} % de réussite`
    : 'Joue quelques parties pour voir tes statistiques.';
  $('#s-notes-overview').hidden = chords;
  $('#s-chords-overview').hidden = !chords;
  $('#s-hard-title').textContent = chords ? 'Accords difficiles' : 'Notes difficiles';
  $('#btn-train').textContent = chords ? 'Entraîner mes accords difficiles' : 'Entraîner mes notes difficiles';

  if (chords) {
    const byField = (i, v) => own.filter(([key]) => key.split(':')[i] === String(v)).map(([, s]) => s);
    $('#s-qualities').innerHTML = QUALITY_ORDER.map((q) => tile(QUALITIES[q].label, byField(4, q))).join('');
    $('#s-inversions').innerHTML = [0, 1, 2, 3].map((inv) => tile(inv ? INVERSION_NAMES[inv] : 'fondamentale', byField(5, inv))).join('');
  } else {
    for (const [clef, [lo, hi]] of [['sol', RANGES.solExt], ['fa', RANGES.faExt]]) {
      const notes = [];
      for (let d = lo; d <= hi; d++) {
        const note = fromDiatonic(d);
        notes.push({ clef, note, color: colorFor(data.stats[noteKey(clef, note)]) });
      }
      $(`#s-${clef}`).innerHTML = renderStaff({ layout: clef, notes, stem: false, spacing: 26 });
    }
  }

  const keys = hardest(data.stats, 10, keep);
  $('#s-hard').innerHTML = keys.length
    ? keys.map((key) => {
      const item = chords ? parseChordKey(key) : { kind: 'note', ...parseKey(key) };
      const s = data.stats[key];
      const miss = s.r.reduce((a, b) => a + b, 0);
      return `<div class="hard">
        ${renderStaff({ layout: item.clef, notes: [{ ...item, color: 'var(--bad)' }], width: 170, stem: false })}
        <strong>${chords ? chordShort(item) : shortName(item.note)}</strong>
        <small>${chords && item.inversion ? INVERSION_NAMES[item.inversion] + ' · ' : ''}clé de ${item.clef} · ${miss} erreur${miss > 1 ? 's' : ''} sur ${s.r.length}</small>
      </div>`;
    }).join('')
    : `<p class="muted center">Aucun${chords ? ' accord difficile' : 'e note difficile'} pour l’instant. 🎉</p>`;
  $('#btn-train').disabled = !keys.length;
}

$('#btn-train').addEventListener('click', () => {
  const chords = chordMode();
  const pool = hardest(data.stats, 10, keepForMode())
    .map((key) => (chords ? parseChordKey(key) : { kind: 'note', key, ...parseKey(key) }))
    .filter(Boolean);
  if (!pool.length) return;
  const title = chords ? 'Accords difficiles' : 'Notes difficiles';
  play({ id: 'entrainement', title, layout: 'single', time: chords ? 10 : 6 }, pool);
});

// ---------- Mode libre ----------

function renderFree() {
  const parse = { ledger: (v) => v === 'true', inversions: (v) => v === 'true', chordAcc: (v) => v === 'true', time: Number };
  const refresh = () => {
    const f = data.free;
    $('#f-notes-opts').hidden = f.content === 'chords';
    $('#f-chord-opts').hidden = f.content === 'notes';
    $('#f-ledger-row').hidden = f.clefs === 'grand';
  };
  for (const seg of document.querySelectorAll('[data-free]')) {
    const field = seg.dataset.free;
    bindSeg(seg, data.free[field], (v) => {
      data.free[field] = parse[field] ? parse[field](v) : v;
      save(data);
      refresh();
    });
  }
  refresh();
}

$('#btn-free-start').addEventListener('click', () => play(freeLevel(data.free)));

// ---------- Réglages ----------

const INPUT_HELP = {
  buttons: 'Touche le nom de la note. Les accords se répondent toujours par leur nom (fondamentale + type).',
  keyboard: 'Une touche noire vaut le dièse comme le bémol (Do♯ = Ré♭). Les accords se répondent par leur nom.',
  mic: 'Joue la note ou l’accord sur ton piano, l’iPhone écoute. Une fausse note compte comme une erreur, mais tu peux corriger. '
    + 'Accords : joue toutes les notes ensemble ; avec « Octave : Exacte », il faut aussi le bon renversement (la bonne note à la basse).',
};

const PRECISION_HELP = {
  loose: 'Souple : une note un peu fausse est quand même reconnue (piano désaccordé).',
  normal: 'Normale : une note trop fausse est ignorée.',
  strict: 'Stricte : seule une note bien juste est reconnue. Accorde d’abord le micro sur ton piano (« jouer un La »).',
};
const PATIENCE_HELP = {
  short: 'Court : une fausse note compte tout de suite.',
  normal: 'Normal : une fausse note doit tenir un court instant avant de compter.',
  long: 'Long : laisse le temps à la note précédente de s’éteindre. Utile avec la pédale.',
};

function renderSettings() {
  const s = data.settings;
  const refresh = () => {
    $('#set-mic-precision-help').textContent = PRECISION_HELP[s.micPrecision] || PRECISION_HELP.loose;
    $('#set-mic-patience-help').textContent = PATIENCE_HELP[s.micPatience] || PATIENCE_HELP.normal;
    $('#set-input-help').textContent = INPUT_HELP[s.input];
    $('#set-mic').hidden = s.input !== 'mic';
    $('#set-mic-help').textContent = s.micSensitivity === 'auto' && !s.micThreshold
      ? 'Auto : règle-la d’abord dans « Tester le micro » (2 secondes de silence). En attendant : Moyenne.'
      : 'Si la jauge ne dépasse pas le trait quand tu joues doucement, augmente la sensibilité, ou choisis Auto.';
  };
  const bind = (sel, field) => bindSeg($(sel), s[field], (v) => {
    s[field] = v;
    save(data);
    refresh();
  });
  bind('#set-input', 'input');
  bind('#set-mic-octave', 'micOctave');
  bind('#set-mic-sensitivity', 'micSensitivity');
  bind('#set-mic-boost', 'micBoost');
  bind('#set-mic-inversion', 'micInversion');
  bind('#set-mic-precision', 'micPrecision');
  bind('#set-mic-patience', 'micPatience');
  refresh();
}

// ---------- Test du micro et accordage ----------

let tuner = null;

function tuningText(c) {
  if (!c) return 'Accordage : La = 440 Hz.';
  return `Accordage : ${c > 0 ? '+' : ''}${c} cents (piano un peu ${c > 0 ? 'haut' : 'bas'}).`;
}

async function openTuner() {
  show('tuner');
  $('#t-meter').innerHTML = meterHtml();
  const fill = $('#t-meter .meter-fill');
  const status = $('#t-status');
  $('#t-note').textContent = '—';
  $('#t-chord').textContent = '\u00a0';
  status.className = 'center small';
  status.textContent = 'Ouverture du micro…';
  const actions = ['#btn-calibrate', '#btn-measure-noise'].map((sel) => $(sel));
  actions.forEach((b) => { b.disabled = true; });

  const session = { calibrating: null, measuring: null, threshold: thresholdFor(data.settings) };
  showThreshold(session.threshold);
  tuner = session;
  try {
    session.mic = await openMicrophone({ boost: data.settings.micBoost !== 'off' });
  } catch (err) {
    status.textContent = micErrorMessage(err);
    status.className = 'center small mic-error';
    return;
  }
  if (tuner !== session) return session.mic.close();
  status.textContent = tuningText(data.settings.tuning);
  actions.forEach((b) => { b.disabled = false; });

  session.listener = createListener(session.mic.ctx, session.mic.source, {
    threshold: session.threshold,
    tuning: data.settings.tuning,
    withChords: true,
    // Notes et accord entendus, pour vérifier la reconnaissance des accords.
    onChordFrame(analysis) {
      if (!analysis) return; // silence : on garde le dernier accord affiché
      const pcs = heardPcs(analysis);
      const chord = pcs.length >= 3 && bestChord(analysis);
      const names = pcs.map((pc) => shortName(fromMidi(60 + pc, true))).join(' · ');
      $('#t-chord').textContent = pcs.length < 3 ? '\u00a0'
        : `Accord : ${chord ? chordName({ root: fromMidi(60 + chord.pc, true), quality: chord.quality }) : '?'} (${names})`;
      if (pcs.length >= 3) $('#t-note').textContent = '—'; // plusieurs notes : pas de note seule
    },
    onFrame({ level, pitch }) {
      fill.style.width = `${levelToPercent(level)}%`;
      fill.classList.toggle('on', level >= session.threshold);
      // Niveau en chiffres (le pic récent, plus lisible qu'une valeur qui saute), pour comparer les réglages.
      session.peak = Math.max(level, (session.peak || 0) * 0.97);
      const db = Math.round(levelToDb(session.peak));
      const fmt = (n) => String(n).replace('-', '−');
      $('#t-level').textContent = `Niveau : ${db < -80 ? 'moins de −80' : fmt(db)} dB · seuil : ${fmt(Math.round(levelToDb(session.threshold)))} dB`;
      // Sensibilité auto : environ 2 secondes de niveaux mesurés en silence.
      if (session.measuring) {
        session.measuring.push(level);
        if (session.measuring.length >= 60) finishNoiseMeasure(session);
      }
      if (!pitch) return;
      $('#t-note').textContent = noteName(fromMidi(pitch.midi));
      $('#t-needle').style.left = `${50 + pitch.cents}%`;
      $('#t-cents').textContent = `${pitch.cents > 0 ? '+' : ''}${pitch.cents} cents`;
      // Accordage : écarts mesurés sur un La (sans correction), pendant environ une seconde de son.
      const cal = session.calibrating;
      if (cal) {
        const raw = nearestNote(pitch.freq);
        if (raw.midi % 12 === 9) cal.push(raw.cents);
        if (cal.length >= 30) finishCalibration(cal);
      }
    },
  });
}

function finishCalibration(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  setTuning(Math.max(-50, Math.min(50, median)));
}

function showThreshold(threshold) {
  $('#t-meter .meter-mark').style.left = `${levelToPercent(threshold)}%`;
}

function finishNoiseMeasure(session) {
  const threshold = thresholdFromNoise(session.measuring);
  session.measuring = null;
  session.threshold = threshold;
  session.listener.setThreshold(threshold);
  showThreshold(threshold);
  data.settings.micSensitivity = 'auto';
  data.settings.micThreshold = threshold;
  save(data);
  $('#t-status').textContent = 'Sensibilité réglée sur le bruit de la pièce ✓ Joue doucement pour vérifier que la jauge passe le trait.';
}

function setTuning(cents) {
  data.settings.tuning = cents;
  save(data);
  if (tuner) {
    tuner.calibrating = null;
    tuner.listener?.setTuning(cents);
  }
  $('#t-status').textContent = `${tuningText(cents)} Enregistré ✓`;
}

function closeTuner() {
  if (!tuner) return;
  tuner.listener?.stop();
  tuner.mic?.close();
  tuner = null;
}

$('#btn-tuner').addEventListener('click', openTuner);
$('#btn-tuner-back').addEventListener('click', () => {
  closeTuner();
  go('settings');
});
$('#btn-calibrate').addEventListener('click', () => {
  if (!tuner?.listener) return;
  tuner.calibrating = [];
  $('#t-status').textContent = 'Joue un La et laisse-le sonner…';
});
$('#btn-tuning-reset').addEventListener('click', () => setTuning(0));
$('#btn-measure-noise').addEventListener('click', () => {
  if (!tuner?.listener) return;
  tuner.measuring = [];
  $('#t-status').textContent = 'Silence pendant 2 secondes… (ne joue pas)';
});

$('#btn-mic-defaults').addEventListener('click', () => {
  if (!confirm('Remettre les réglages du micro par défaut ? (sensibilité, accordage, justesse…)')) return;
  Object.assign(data.settings, MIC_DEFAULTS);
  delete data.settings.micThreshold;
  save(data);
  renderSettings();
});

$('#btn-reset').addEventListener('click', () => {
  if (!confirm('Effacer toute la progression et les statistiques ?')) return;
  const { settings, mode } = data;
  data = reset();
  data.settings = settings;
  data.mode = mode;
  save(data);
  go('home');
});

// ---------- Démarrage ----------

go('home');

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
