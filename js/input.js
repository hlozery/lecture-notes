// Zone de réponse : boutons Do Ré Mi… (+ barre ♭ ♮ ♯, + qualité d'accord) ou mini clavier de piano.
import { LETTERS, ACC_SYMBOL, pitchClass, fromMidi, noteName, midi } from './music.js';
import { QUALITIES } from './chords.js';
import { thresholdFor, openMicrophone, createListener, micErrorMessage } from './mic.js';

const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11];
// Touche noire → position (en largeurs de touche blanche) de sa frontière gauche.
const BLACK_KEYS = [{ pc: 1, at: 1 }, { pc: 3, at: 2 }, { pc: 6, at: 4 }, { pc: 8, at: 5 }, { pc: 10, at: 6 }];

/**
 * mode : 'buttons' | 'keyboard' | 'mic' | 'chord' (les accords se nomment toujours avec les boutons).
 * onAnswer reçoit { letter, acc } (boutons), { pc } (clavier), { midi, retry } (micro)
 * ou { letter, acc, quality } (accord). Chaque zone a reset(), showAnswer() et destroy().
 */
export function createInput(container, { mode, accs, qualities, settings, onAnswer }) {
  container.innerHTML = '';
  container.className = `input input-${mode}`;
  if (mode === 'keyboard') return keyboard(container, onAnswer);
  if (mode === 'mic') return micInput(container, accs, settings, onAnswer);
  return buttons(container, accs, mode === 'chord' ? qualities : null, onAnswer);
}

// Volume (RMS) → position sur la jauge, en décibels de −70 à 0.
export function levelToPercent(level) {
  return Math.max(0, Math.min(100, ((20 * Math.log10(level || 1e-7) + 70) / 70) * 100));
}

export function meterHtml() {
  return '<div class="meter"><div class="meter-fill"></div><div class="meter-mark"></div></div>';
}

// Jauge + note entendue en direct ; les notes jouées sont envoyées à onAnswer({ midi, retry: true }).
function micInput(container, accs, settings, onAnswer) {
  const threshold = thresholdFor(settings);
  container.innerHTML = `${meterHtml()}<p class="mic-heard">Ouverture du micro…</p>`;
  const fill = container.querySelector('.meter-fill');
  const heard = container.querySelector('.mic-heard');
  container.querySelector('.meter-mark').style.left = `${levelToPercent(threshold)}%`;
  const idle = () => { heard.textContent = 'Joue la note au piano 🎹'; };

  let mic = null, listener = null, closed = false, fallback = null;
  let expected = () => false; // la note affichée, pour la valider plus vite
  openMicrophone()
    .then((m) => {
      if (closed) return m.close();
      mic = m;
      idle();
      listener = createListener(m.ctx, m.source, {
        threshold,
        tuning: settings.tuning || 0,
        onFrame({ level, pitch }) {
          fill.style.width = `${levelToPercent(level)}%`;
          fill.classList.toggle('on', level >= threshold);
          if (pitch) heard.textContent = `On entend : ${noteName(fromMidi(pitch.midi))}`;
        },
        isExpected: (m) => expected(m),
        onNote: (pitch) => onAnswer({ midi: pitch.midi, retry: true }),
      });
    })
    .catch((err) => {
      if (closed) return;
      // Micro indisponible : on répond avec les boutons pour cette partie.
      container.innerHTML = `<p class="mic-error">${micErrorMessage(err)}</p>`;
      container.className = 'input input-buttons';
      fallback = buttons(container, accs, null, onAnswer);
    });

  return {
    reset() {
      if (fallback) return fallback.reset();
      if (mic) idle();
    },
    showAnswer(n) {
      if (fallback) return fallback.showAnswer(n);
      heard.textContent = `C’était ${noteName(n)}`;
    },
    // Note à jouer : MIDI exact, ou n'importe quelle octave selon le réglage.
    expect(n) {
      const target = midi(n);
      expected = settings.micOctave === 'any' ? (m) => (m - target) % 12 === 0 : (m) => m === target;
    },
    // Peut être appelé plusieurs fois (fin de partie, puis nouvelle partie).
    destroy() {
      if (closed) return;
      closed = true;
      listener?.stop();
      mic?.close();
    },
  };
}

function press(el, handler) {
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); handler(); });
}

function buttons(container, accs, qualities, onAnswer) {
  let acc = 0;
  let quality = qualities?.[0];
  const accButtons = {};
  const qualityButtons = {};
  if (qualities?.length > 1) {
    const bar = document.createElement('div');
    bar.className = 'quality-bar';
    for (const q of qualities) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'quality-btn';
      b.textContent = QUALITIES[q].label;
      press(b, () => selectQuality(q));
      qualityButtons[q] = b;
      bar.append(b);
    }
    container.append(bar);
  }
  if (accs.some((a) => a !== 0)) {
    const bar = document.createElement('div');
    bar.className = 'acc-bar';
    for (const a of [-1, 0, 1].filter((x) => accs.includes(x))) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'acc-btn';
      b.textContent = ACC_SYMBOL[a];
      b.setAttribute('aria-label', { '-1': 'bémol', 0: 'bécarre', 1: 'dièse' }[a]);
      press(b, () => select(a));
      accButtons[a] = b;
      bar.append(b);
    }
    container.append(bar);
  }
  const grid = document.createElement('div');
  grid.className = 'note-grid';
  const noteButtons = LETTERS.map((name, letter) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'note-btn';
    b.textContent = name;
    press(b, () => onAnswer(qualities ? { letter, acc, quality } : { letter, acc }));
    grid.append(b);
    return b;
  });
  container.append(grid);

  function select(a) {
    acc = a;
    for (const [k, b] of Object.entries(accButtons)) b.classList.toggle('selected', Number(k) === a);
  }
  function selectQuality(q) {
    quality = q;
    for (const [k, b] of Object.entries(qualityButtons)) b.classList.toggle('selected', k === q);
  }
  select(0);
  if (qualities) selectQuality(qualities[0]);

  return {
    reset() {
      select(0);
      if (qualities) selectQuality(qualities[0]);
      container.querySelectorAll('.correct').forEach((b) => b.classList.remove('correct'));
    },
    // n : la note, ou la fondamentale d'un accord ; q : la qualité de l'accord.
    showAnswer(n, q) {
      noteButtons[n.letter].classList.add('correct');
      if (n.acc) accButtons[n.acc]?.classList.add('correct');
      if (q) qualityButtons[q]?.classList.add('correct');
    },
    destroy() {},
  };
}

function keyboard(container, onAnswer) {
  const kb = document.createElement('div');
  kb.className = 'keyboard';
  const keys = {};
  WHITE_PCS.forEach((pc, i) => {
    const k = document.createElement('button');
    k.type = 'button';
    k.className = 'key white';
    k.innerHTML = `<span>${LETTERS[i]}</span>`;
    press(k, () => onAnswer({ pc }));
    keys[pc] = k;
    kb.append(k);
  });
  for (const { pc, at } of BLACK_KEYS) {
    const k = document.createElement('button');
    k.type = 'button';
    k.className = 'key black';
    k.style.left = `calc(${(at / 7) * 100}% - 6.5%)`;
    k.setAttribute('aria-label', 'touche noire');
    press(k, () => onAnswer({ pc }));
    keys[pc] = k;
    kb.append(k);
  }
  container.append(kb);

  return {
    reset() {
      kb.querySelectorAll('.correct').forEach((k) => k.classList.remove('correct'));
    },
    showAnswer(n) {
      keys[pitchClass(n)].classList.add('correct');
    },
    destroy() {},
  };
}
