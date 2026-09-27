// Boucle de jeu : tirage des notes, chrono, score, série, fin de partie.
import { pitchClass, noteName, noteKey } from './music.js';
import { renderStaff } from './staff.js';
import { createInput } from './input.js';
import { recordAnswer, pickWeighted } from './stats.js';
import { NOTES_PER_GAME } from './levels.js';

/**
 * els : { title, progress, score, combo, timer, staff, feedback, input }
 * onAnswered() est appelé après chaque réponse (pour sauvegarder les stats).
 */
export function startGame({ level, pool, data, els, onAnswered, onEnd }) {
  const limitMs = (level.time || 0) * 1000;
  const st = {
    i: 0, score: 0, combo: 0, bestCombo: 0, correct: 0, times: [], missed: [],
    current: null, prevKey: null, t0: 0, raf: 0, timeout: 0, locked: true, over: false,
  };

  els.title.textContent = level.title;
  els.timer.parentElement.hidden = !limitMs;
  const input = createInput(els.input, { mode: data.settings.input, accs: level.accs, onAnswer: answer });
  next();

  function draw(state) {
    const { clef, note } = st.current;
    const color = state === 'ok' ? 'var(--ok)' : state === 'bad' ? 'var(--bad)' : null;
    els.staff.innerHTML = renderStaff({
      layout: level.layout === 'grand' ? 'grand' : clef,
      notes: [{ clef, note, color, cls: state === 'new' ? 'enter' : state }],
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
    st.current = pickWeighted(pool, data.stats, st.prevKey, limitMs);
    st.prevKey = noteKey(st.current.clef, st.current.note);
    st.i++;
    hud();
    draw('new');
    els.feedback.textContent = '';
    els.feedback.className = 'feedback';
    input.reset();
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
    const { clef, note } = st.current;
    const ok = !!a && ('pc' in a ? a.pc === pitchClass(note) : a.letter === note.letter && a.acc === note.acc);
    recordAnswer(data.stats, noteKey(clef, note), ok, ms);

    if (ok) {
      st.correct++;
      st.combo++;
      st.bestCombo = Math.max(st.bestCombo, st.combo);
      st.times.push(ms);
      const speed = limitMs ? Math.round(100 * Math.max(0, 1 - ms / limitMs)) : 0;
      const gain = (100 + speed) * multiplier(st.combo);
      st.score += gain;
      els.feedback.textContent = `${noteName(note)} ✓  +${gain}`;
      els.feedback.className = 'feedback ok';
      draw('ok');
    } else {
      st.combo = 0;
      st.missed.push(st.current);
      els.feedback.textContent = `${a ? 'Non' : 'Temps écoulé'} — c’était ${noteName(note)}`;
      els.feedback.className = 'feedback bad';
      draw('bad');
      input.showAnswer(note);
    }
    hud();
    onAnswered();
    st.timeout = setTimeout(next, ok ? 600 : 1600);
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
