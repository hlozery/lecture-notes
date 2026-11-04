// Boucle de jeu : tirage des notes / accords, chrono, score, série, fin de partie.
import { pitchClass, noteName, midi, fromMidi } from './music.js';
import { QUALITY_ORDER, INVERSION_NAMES, chordName } from './chords.js';
import { renderStaff } from './staff.js';
import { createInput, heardChordName } from './input.js';
import { recordAnswer, pickWeighted } from './stats.js';
import { NOTES_PER_GAME } from './levels.js';

export function itemName(item) {
  if (item.kind !== 'chord') return noteName(item.note);
  return item.inversion ? `${chordName(item)} · ${INVERSION_NAMES[item.inversion]}` : chordName(item);
}

function isCorrect(item, a, settings) {
  if (!a) return false;
  if ('chord' in a) return a.chord.ok;
  if (item.kind === 'chord') {
    return a.letter === item.root.letter && a.acc === item.root.acc && a.quality === item.quality;
  }
  if ('midi' in a) {
    return settings.micOctave === 'any' ? a.midi % 12 === pitchClass(item.note) : a.midi === midi(item.note);
  }
  return 'pc' in a ? a.pc === pitchClass(item.note) : a.letter === item.note.letter && a.acc === item.note.acc;
}

// Ce que le micro a entendu, dit simplement (« Fa dièse », « Sol, mais une octave trop bas », « Ré mineur »).
function heardText(a, item) {
  if ('chord' in a) return heardChordName(a.chord.heard, item);
  const n = fromMidi(a.midi, item.note.acc === -1);
  if (a.midi % 12 !== pitchClass(item.note)) return noteName(n);
  const diff = Math.round((a.midi - midi(item.note)) / 12);
  const octaves = Math.abs(diff) > 1 ? `${Math.abs(diff)} octaves` : 'une octave';
  return `${noteName(n)}, mais ${octaves} trop ${diff > 0 ? 'haut' : 'bas'}`;
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
  const qualities = QUALITY_ORDER.filter((q) => chords.some((p) => p.quality === q));
  const chordAccs = uniq(chords.map((p) => p.root.acc));
  if (settings.input === 'mic') {
    // Au piano : un seul micro pour les notes et les accords.
    add('mic', { mode: 'mic', settings, accs: uniq(notes.map((p) => p.note.acc)), chordAccs, qualities });
  } else if (notes.length) add('note', { mode: settings.input, settings, accs: uniq(notes.map((p) => p.note.acc)) });
  if (chords.length && settings.input !== 'mic') {
    add('chord', {
      mode: 'chord',
      accs: chordAccs,
      qualities,
    });
  }
  return {
    show(kind) {
      if (inputs.mic) kind = 'mic';
      for (const [k, input] of Object.entries(inputs)) input.box.hidden = k !== kind;
      inputs[kind].reset();
      return inputs[kind];
    },
    destroy() {
      for (const input of Object.values(inputs)) input.destroy();
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
    current: null, input: null, failed: false, t0: 0, raf: 0, timeout: 0, locked: true, over: false,
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
    st.input.expect?.(st.current);
    st.failed = false;
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
    const ms = performance.now() - st.t0;
    const item = st.current;
    const ok = isCorrect(item, a, data.settings);

    // Micro : une fausse note compte comme une erreur (une seule fois), puis on peut réessayer.
    if (!ok && a?.retry) {
      if (!st.failed) miss(item, ms);
      els.feedback.textContent = `On entend ${heardText(a, item)} — réessaie`;
      els.feedback.className = 'feedback bad';
      draw('bad');
      return;
    }

    st.locked = true;
    cancelAnimationFrame(st.raf);
    if (st.failed) {
      // Déjà comptée comme erreur : on montre la solution ou on valide la correction, sans points.
      els.feedback.textContent = ok ? `${itemName(item)} ✓ (corrigé)` : `Temps écoulé — c’était ${itemName(item)}`;
      els.feedback.className = ok ? 'feedback ok' : 'feedback bad';
      draw(ok ? 'ok' : 'bad');
      if (!ok && item.kind === 'chord') st.input.showAnswer(item.root, item.quality);
      else if (!ok) st.input.showAnswer(item.note);
      st.timeout = setTimeout(next, ok ? 600 : 1600);
      return;
    }
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

  // Erreur enregistrée sans passer à la suite (micro).
  function miss(item, ms) {
    st.failed = true;
    st.combo = 0;
    st.missed.push(item);
    recordAnswer(data.stats, item.key, false, ms);
    hud();
    onAnswered();
  }

  function finish() {
    st.over = true;
    inputs.destroy();
    const avgMs = st.times.length ? st.times.reduce((a, b) => a + b, 0) / st.times.length : 0;
    onEnd({
      correct: st.correct, total: NOTES_PER_GAME, score: st.score,
      bestCombo: st.bestCombo, avgMs, missed: st.missed,
    });
  }

  return {
    stop() {
      st.over = true;
      inputs.destroy();
      cancelAnimationFrame(st.raf);
      clearTimeout(st.timeout);
    },
  };
}

function multiplier(combo) {
  return combo >= 10 ? 3 : combo >= 5 ? 2 : 1;
}
