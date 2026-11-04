// Boucle de jeu : tirage des notes / accords, chrono, score, série, fin de partie.
import { pitchClass, noteName } from './music.js';
import { QUALITY_ORDER, INVERSION_NAMES, chordName } from './chords.js';
import { renderStaff } from './staff.js';
import { createInput } from './input.js';
import { recordAnswer, pickWeighted } from './stats.js';
import { NOTES_PER_GAME } from './levels.js';

export function itemName(item) {
  if (item.kind !== 'chord') return noteName(item.note);
  return item.inversion ? `${chordName(item)} · ${INVERSION_NAMES[item.inversion]}` : chordName(item);
}

function isCorrect(item, a) {
  if (!a) return false;
  if (item.kind === 'chord') {
    return a.letter === item.root.letter && a.acc === item.root.acc && a.quality === item.quality;
  }
  return 'pc' in a ? a.pc === pitchClass(item.note) : a.letter === item.note.letter && a.acc === item.note.acc;
}

// Zone de réponse adaptée à chaque type d'élément présent dans la partie.
function createInputs(container, pool, settings, onAnswer) {
  container.innerHTML = '';
  const uniq = (xs) => [...new Set(xs)];
  const notes = pool.filter((p) => p.kind !== 'chord');
  const chords = pool.filter((p) => p.kind === 'chord');
  const inputs = {};
  const add = (kind, opts) => {
    const box = document.createElement('div');
    container.append(box);
    inputs[kind] = { box, ...createInput(box, { onAnswer, ...opts }) };
  };
  if (notes.length) add('note', { mode: settings.input, accs: uniq(notes.map((p) => p.note.acc)) });
  if (chords.length) {
    add('chord', {
      mode: 'chord',
      accs: uniq(chords.map((p) => p.root.acc)),
      qualities: QUALITY_ORDER.filter((q) => chords.some((p) => p.quality === q)),
    });
  }
  return {
    show(kind) {
      for (const [k, input] of Object.entries(inputs)) input.box.hidden = k !== kind;
      inputs[kind].reset();
      return inputs[kind];
    },
  };
}

/**
 * els : { title, progress, score, combo, timer, staff, feedback, input }
 * onAnswered() est appelé après chaque réponse (pour sauvegarder les stats).
 */
export function startGame({ level, pool, data, els, onAnswered, onEnd }) {
  const limitMs = (level.time || 0) * 1000;
  const st = {
    i: 0, score: 0, combo: 0, bestCombo: 0, correct: 0, times: [], missed: [],
    current: null, input: null, t0: 0, raf: 0, timeout: 0, locked: true, over: false,
  };

  els.title.textContent = level.title;
  els.timer.parentElement.hidden = !limitMs;
  const inputs = createInputs(els.input, pool, data.settings, answer);
  // Notes et accords mélangés : une chance sur deux pour chaque type, quel que soit leur nombre.
  const byKind = ['note', 'chord'].map((k) => pool.filter((p) => (p.kind === 'chord') === (k === 'chord'))).filter((g) => g.length);
  next();

  function draw(state) {
    const item = st.current;
    const color = state === 'ok' ? 'var(--ok)' : state === 'bad' ? 'var(--bad)' : null;
    els.staff.innerHTML = renderStaff({
      layout: level.layout === 'grand' ? 'grand' : item.clef,
      notes: [{ ...item, color, cls: state === 'new' ? 'enter' : state }],
      width: 210,
      crop: false,
    });
  }

  function hud() {
    els.progress.textContent = `${Math.min(st.i, NOTES_PER_GAME)} / ${NOTES_PER_GAME}`;
    els.score.textContent = st.score;
    const mult = multiplier(st.combo);
    els.combo.textContent = mult > 1 ? `Série ${st.combo} · ×${mult}` : st.combo > 1 ? `Série ${st.combo}` : '';
    els.combo.classList.toggle('hot', mult > 1);
  }

  function next() {
    if (st.i >= NOTES_PER_GAME) return finish();
    const group = byKind[Math.floor(Math.random() * byKind.length)];
    st.current = pickWeighted(group, data.stats, st.current?.key, limitMs);
    st.i++;
    hud();
    draw('new');
    els.feedback.textContent = '';
    els.feedback.className = 'feedback';
    st.input = inputs.show(st.current.kind === 'chord' ? 'chord' : 'note');
    st.locked = false;
    st.t0 = performance.now();
    if (limitMs) tick();
  }

  function tick() {
    const elapsed = performance.now() - st.t0;
    const left = Math.max(0, 1 - elapsed / limitMs);
    els.timer.style.transform = `scaleX(${left})`;
    els.timer.classList.toggle('low', left < 0.3);
    if (left <= 0) answer(null);
    else st.raf = requestAnimationFrame(tick);
  }

  function answer(a) {
    if (st.locked || st.over) return;
    st.locked = true;
    cancelAnimationFrame(st.raf);
    const ms = performance.now() - st.t0;
    const item = st.current;
    const ok = isCorrect(item, a);
    recordAnswer(data.stats, item.key, ok, ms);

    if (ok) {
      st.correct++;
      st.combo++;
      st.bestCombo = Math.max(st.bestCombo, st.combo);
      st.times.push(ms);
      const speed = limitMs ? Math.round(100 * Math.max(0, 1 - ms / limitMs)) : 0;
      const gain = (100 + speed) * multiplier(st.combo);
      st.score += gain;
      els.feedback.textContent = `${itemName(item)} ✓  +${gain}`;
      els.feedback.className = 'feedback ok';
      draw('ok');
    } else {
      st.combo = 0;
      st.missed.push(item);
      els.feedback.textContent = `${a ? 'Non' : 'Temps écoulé'} — c’était ${itemName(item)}`;
      els.feedback.className = 'feedback bad';
      draw('bad');
      if (item.kind === 'chord') st.input.showAnswer(item.root, item.quality);
      else st.input.showAnswer(item.note);
    }
    hud();
    onAnswered();
    // Un peu plus de temps pour lire la correction d'un accord.
    st.timeout = setTimeout(next, ok ? 600 : item.kind === 'chord' ? 2200 : 1600);
  }

  function finish() {
    st.over = true;
    const avgMs = st.times.length ? st.times.reduce((a, b) => a + b, 0) / st.times.length : 0;
    onEnd({
      correct: st.correct, total: NOTES_PER_GAME, score: st.score,
      bestCombo: st.bestCombo, avgMs, missed: st.missed,
    });
  }

  return {
    stop() {
      st.over = true;
      cancelAnimationFrame(st.raf);
      clearTimeout(st.timeout);
    },
  };
}

function multiplier(combo) {
  return combo >= 10 ? 3 : combo >= 5 ? 2 : 1;
}
