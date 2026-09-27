// Navigation entre écrans, progression, réglages.
import { LEVELS, RANGES, buildPool, freeLevel, starsFor, isUnlocked } from './levels.js';
import { fromDiatonic, noteKey, parseKey, shortName } from './music.js';
import { renderStaff } from './staff.js';
import { startGame } from './game.js';
import { accuracy, hardest, recentErrorRate } from './stats.js';
import { load, save, reset } from './storage.js';

const $ = (sel) => document.querySelector(sel);
let data = load();
let game = null;
let lastPlay = null;

const gameEls = {
  title: $('#g-title'), progress: $('#g-progress'), score: $('#g-score'), combo: $('#g-combo'),
  timer: $('#g-timer'), staff: $('#g-staff'), feedback: $('#g-feedback'), input: $('#g-input'),
};

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

// ---------- Accueil ----------

function currentLevel() {
  const unlocked = LEVELS.filter((l) => isUnlocked(l.id, data.progress));
  return unlocked.find((l) => !data.progress[l.id]?.stars) || unlocked[unlocked.length - 1];
}

function renderHome() {
  const total = LEVELS.reduce((sum, l) => sum + (data.progress[l.id]?.stars || 0), 0);
  $('#star-total').textContent = `★ ${total} / ${LEVELS.length * 3}`;
  const lvl = currentLevel();
  $('#btn-continue').textContent = `Jouer · Niveau ${lvl.id}`;
  $('#home-staff').innerHTML = renderStaff({
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
  const list = $('#level-list');
  list.innerHTML = '';
  for (const level of LEVELS) {
    const open = isUnlocked(level.id, data.progress);
    const p = data.progress[level.id];
    const li = document.createElement('li');
    li.innerHTML = `
      <button class="level ${open ? '' : 'locked'}" ${open ? '' : 'disabled'}>
        <span class="num">${open ? level.id : '🔒'}</span>
        <span class="info"><strong>${level.title}</strong>
          <small>${level.desc} · ${level.time} s par note</small></span>
        <span class="lvl-stars">${open ? starsHtml(p?.stars || 0) : ''}</span>
      </button>`;
    if (open) li.querySelector('button').addEventListener('click', () => play(level));
    list.append(li);
  }
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

$('#btn-quit').addEventListener('click', () => {
  game?.stop();
  go(typeof lastPlay.level.id === 'number' ? 'levels' : 'home');
});

// ---------- Résultats ----------

function showResults(level, r) {
  const acc = r.correct / r.total;
  const stars = starsFor(acc, r.avgMs, level.time);
  const ranked = typeof level.id === 'number';
  let msg;
  let record = false;
  let unlockedNext = null;

  if (ranked) {
    const prev = data.progress[level.id] || { stars: 0, best: 0 };
    record = prev.best > 0 && r.score > prev.best;
    data.progress[level.id] = { stars: Math.max(prev.stars, stars), best: Math.max(prev.best, r.score) };
    const nextLevel = LEVELS.find((l) => l.id === level.id + 1);
    if (stars > 0 && !prev.stars && nextLevel) unlockedNext = nextLevel;
    save(data);
  }

  if (stars === 0) msg = 'Il faut 85 % de bonnes réponses pour réussir. Encore un essai !';
  else if (unlockedNext) msg = `Bravo ! Niveau ${unlockedNext.id} débloqué : ${unlockedNext.title}.`;
  else if (stars === 3) msg = 'Parfait, précis et rapide !';
  else if (stars === 2) msg = 'Excellent ! Réponds plus vite pour la 3ᵉ étoile.';
  else msg = 'Réussi ! Vise 95 % pour la 2ᵉ étoile.';

  $('#r-title').textContent = level.title;
  $('#r-stars').innerHTML = ranked ? starsHtml(stars) : '';
  $('#r-msg').textContent = ranked ? msg : `${Math.round(acc * 100)} % de bonnes réponses.`;
  $('#r-acc').textContent = `${Math.round(acc * 100)} %`;
  $('#r-time').textContent = r.avgMs ? `${(r.avgMs / 1000).toFixed(1).replace('.', ',')} s` : '—';
  $('#r-combo').textContent = r.bestCombo;
  $('#r-score').textContent = r.score;
  $('#r-score-label').textContent = record ? 'points · record !' : 'points';
  $('#r-score-label').classList.toggle('record', record);

  // Notes ratées, sans doublons, groupées par clé.
  const seen = new Set();
  const missed = r.missed.filter((m) => {
    const k = noteKey(m.clef, m.note);
    return !seen.has(k) && seen.add(k);
  });
  let html = '';
  for (const clef of ['sol', 'fa']) {
    const notes = missed.filter((m) => m.clef === clef).slice(0, 8);
    if (!notes.length) continue;
    html += `<div class="staff-card wide">${renderStaff({ layout: clef, notes, stem: false, spacing: 38, width: 200 })}</div>
      <p class="missed-names">${notes.map((m) => shortName(m.note)).join(' · ')}</p>`;
  }
  $('#r-missed').innerHTML = html ? `<h3>Notes à revoir</h3>${html}` : '';

  const nextLevel = ranked && LEVELS.find((l) => l.id === level.id + 1);
  const btnNext = $('#btn-next');
  btnNext.hidden = !(nextLevel && isUnlocked(nextLevel.id, data.progress));
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

function renderStats() {
  const entries = Object.values(data.stats);
  const n = entries.reduce((a, s) => a + s.n, 0);
  const e = entries.reduce((a, s) => a + s.e, 0);
  $('#s-summary').textContent = n
    ? `${n} notes jouées · ${Math.round((1 - e / n) * 100)} % de réussite`
    : 'Joue quelques parties pour voir tes statistiques.';

  for (const [clef, [lo, hi]] of [['sol', RANGES.solExt], ['fa', RANGES.faExt]]) {
    const notes = [];
    for (let d = lo; d <= hi; d++) {
      const note = fromDiatonic(d);
      notes.push({ clef, note, color: colorFor(data.stats[noteKey(clef, note)]) });
    }
    $(`#s-${clef}`).innerHTML = renderStaff({ layout: clef, notes, stem: false, spacing: 26 });
  }

  const keys = hardest(data.stats, 10);
  $('#s-hard').innerHTML = keys.length
    ? keys.map((key) => {
      const { clef, note } = parseKey(key);
      const s = data.stats[key];
      const miss = s.r.reduce((a, b) => a + b, 0);
      return `<div class="hard">
        ${renderStaff({ layout: clef, notes: [{ clef, note, color: 'var(--bad)' }], width: 170, stem: false })}
        <strong>${shortName(note)}</strong><small>clé de ${clef} · ${miss} erreur${miss > 1 ? 's' : ''} sur ${s.r.length}</small>
      </div>`;
    }).join('')
    : '<p class="muted center">Aucune note difficile pour l’instant. 🎉</p>';
  $('#btn-train').disabled = !keys.length;
}

$('#btn-train').addEventListener('click', () => {
  const pool = hardest(data.stats, 10).map(parseKey);
  if (!pool.length) return;
  const accs = [...new Set(pool.map((p) => p.note.acc))];
  play({ id: 'entrainement', title: 'Notes difficiles', layout: 'single', accs, time: 6 }, pool);
});

// ---------- Mode libre ----------

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

function renderFree() {
  const parse = { ledger: (v) => v === 'true', time: Number };
  for (const seg of document.querySelectorAll('[data-free]')) {
    const field = seg.dataset.free;
    bindSeg(seg, data.free[field], (v) => {
      data.free[field] = parse[field] ? parse[field](v) : v;
      save(data);
      $('#f-ledger-row').hidden = data.free.clefs === 'grand';
    });
  }
  $('#f-ledger-row').hidden = data.free.clefs === 'grand';
}

$('#btn-free-start').addEventListener('click', () => play(freeLevel(data.free)));

// ---------- Réglages ----------

function renderSettings() {
  bindSeg($('#set-input'), data.settings.input, (v) => {
    data.settings.input = v;
    save(data);
  });
}

$('#btn-reset').addEventListener('click', () => {
  if (!confirm('Effacer toute la progression et les statistiques ?')) return;
  const input = data.settings.input;
  data = reset();
  data.settings.input = input;
  save(data);
  go('home');
});

// ---------- Démarrage ----------

go('home');

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
