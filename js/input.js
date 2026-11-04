// Zone de réponse : boutons Do Ré Mi… (+ barre ♭ ♮ ♯, + qualité d'accord) ou mini clavier de piano.
import { LETTERS, ACC_SYMBOL, pitchClass, fromMidi, noteName, shortName, midi } from './music.js';
import { QUALITIES, chordName } from './chords.js';
import { thresholdFor, openMicrophone, createListener, micErrorMessage } from './mic.js';
import { judgeChord, heardPcs } from './chord-detect.js';

const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11];
// Touche noire → position (en largeurs de touche blanche) de sa frontière gauche.
const BLACK_KEYS = [{ pc: 1, at: 1 }, { pc: 3, at: 2 }, { pc: 6, at: 4 }, { pc: 8, at: 5 }, { pc: 10, at: 6 }];

/**
 * mode : 'buttons' | 'keyboard' | 'chord' (nommer l'accord) | 'mic' (notes et accords joués au piano).
 * onAnswer reçoit { letter, acc } (boutons), { pc } (clavier), { letter, acc, quality } (accord),
 * ou au micro { midi, retry } (note) et { chord: verdict, retry } (accord, voir chord-detect.js).
 * Chaque zone a reset(), showAnswer() et destroy() ; le micro a aussi expect(item).
 * Pour le micro, accs = altérations des notes, chordAccs / qualities = celles des accords (secours).
 */
export function createInput(container, { mode, accs, chordAccs, qualities, settings, onAnswer }) {
  container.innerHTML = '';
  container.className = `input input-${mode}`;
  if (mode === 'keyboard') return keyboard(container, onAnswer);
  if (mode === 'mic') return micInput(container, { accs, chordAccs, qualities, settings, onAnswer });
  return buttons(container, accs, mode === 'chord' ? qualities : null, onAnswer);
}

// Volume (RMS) → décibels, et position sur la jauge (de −80 à 0 dB).
export function levelToDb(level) {
  return 20 * Math.log10(level || 1e-8);
}

export function levelToPercent(level) {
  return Math.max(0, Math.min(100, ((levelToDb(level) + 80) / 80) * 100));
}

export function meterHtml() {
  return '<div class="meter"><div class="meter-fill"></div><div class="meter-mark"></div></div>';
}

// Nom d'une note (0–11) entendue dans un accord : orthographe de l'accord attendu si elle en fait partie.
function pcName(pc, item) {
  const inChord = item?.chord?.find((n) => pitchClass(n) === pc);
  return shortName(inChord || fromMidi(60 + pc, item?.root?.acc !== 1));
}

// Accord reconnu par le micro, nommé avec des bémols sauf si l'accord attendu a des dièses.
export function heardChordName(heard, item) {
  return chordName({ root: fromMidi(60 + heard.pc, item.root.acc !== 1), quality: heard.quality });
}

// Jauge + ce qu'on entend en direct. Notes : onAnswer({ midi, retry: true }) ;
// accords : onAnswer({ chord: verdict, retry: true }) avec le verdict de chord-detect.js.
function micInput(container, { accs, chordAccs, qualities, settings, onAnswer }) {
  const threshold = thresholdFor(settings);
  container.innerHTML = `${meterHtml()}<p class="mic-heard">Ouverture du micro…</p>`;
  const fill = container.querySelector('.meter-fill');
  const heard = container.querySelector('.mic-heard');
  container.querySelector('.meter-mark').style.left = `${levelToPercent(threshold)}%`;

  let mic = null, listener = null, closed = false, fallback = null;
  let item = null; // la note ou l'accord affiché
  let hint = ''; // indication en cours (accord juste mais mauvaise basse)
  let expected = () => false; // la note affichée, pour la valider plus vite
  const isChord = () => item?.kind === 'chord';
  const idle = () => { heard.textContent = isChord() ? 'Joue l’accord au piano 🎹' : 'Joue la note au piano 🎹'; };

  function apply() {
    if (!listener || !item) return;
    if (!isChord()) return listener.setChord(null);
    const target = {
      rootPc: pitchClass(item.root), quality: item.quality, bassPc: pitchClass(item.chord[0]),
    };
    const checkBass = settings.micOctave !== 'any';
    const bass = shortName(item.chord[0]);
    listener.setChord((analysis) => {
      const verdict = judgeChord(analysis, target, { checkBass });
      // Bon accord, mauvaise basse : simple indication, pas une erreur (souvent l'accord précédent qui résonne).
      if (verdict?.heard?.inversionOnly) {
        hint = `Bon accord — mets ${bass} à la basse`;
        return null;
      }
      hint = '';
      return verdict;
    });
  }

  openMicrophone({ boost: settings.micBoost !== 'off' })
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
        onChordFrame(analysis) {
          const pcs = analysis ? heardPcs(analysis) : [];
          if (!analysis) hint = '';
          if (hint) heard.textContent = hint;
          else if (pcs.length) heard.textContent = `On entend : ${pcs.map((pc) => pcName(pc, item)).join(' · ')}`;
          else idle();
        },
        onChord: (verdict) => onAnswer({ chord: verdict, retry: true }),
      });
      apply();
    })
    .catch((err) => {
      if (closed) return;
      // Micro indisponible : on répond avec les boutons pour cette partie (noms des notes et des accords).
      container.innerHTML = `<p class="mic-error">${micErrorMessage(err)}</p>`;
      container.className = 'input input-buttons';
      const box = (b) => { const el = document.createElement('div'); container.append(el); return b(el); };
      fallback = {
        note: box((el) => buttons(el, accs || [0], null, onAnswer)),
        chord: qualities?.length ? box((el) => buttons(el, chordAccs || [0], qualities, onAnswer)) : null,
        show() {
          const chord = isChord() && this.chord;
          [...container.children].slice(1).forEach((el, i) => { el.hidden = chord ? i === 0 : i === 1; });
          return chord ? this.chord : this.note;
        },
      };
      fallback.show();
    });

  return {
    reset() {
      if (fallback) return fallback.show().reset();
      if (mic) idle();
    },
    showAnswer(n, q) {
      if (fallback) return fallback.show().showAnswer(n, q);
      heard.textContent = `C’était ${q ? chordName({ root: n, quality: q }) : noteName(n)}`;
    },
    // Élément à jouer. Note : MIDI exact, ou n'importe quelle octave selon le réglage.
    // Accord : ses notes, et la bonne note à la basse si l'octave doit être exacte.
    expect(it) {
      item = it;
      if (!isChord()) {
        const target = midi(it.note);
        expected = settings.micOctave === 'any' ? (m) => (m - target) % 12 === 0 : (m) => m === target;
      }
      apply();
      if (fallback) fallback.show();
      else if (mic) idle();
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
