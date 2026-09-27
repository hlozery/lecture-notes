// Zone de réponse : boutons Do Ré Mi… (+ barre ♭ ♮ ♯) ou mini clavier de piano.
import { LETTERS, ACC_SYMBOL, pitchClass } from './music.js';

const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11];
// Touche noire → position (en largeurs de touche blanche) de sa frontière gauche.
const BLACK_KEYS = [{ pc: 1, at: 1 }, { pc: 3, at: 2 }, { pc: 6, at: 4 }, { pc: 8, at: 5 }, { pc: 10, at: 6 }];

/**
 * onAnswer reçoit { letter, acc } (boutons) ou { pc } (clavier).
 */
export function createInput(container, { mode, accs, onAnswer }) {
  container.innerHTML = '';
  container.className = `input input-${mode}`;
  return mode === 'keyboard' ? keyboard(container, onAnswer) : buttons(container, accs, onAnswer);
}

function press(el, handler) {
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); handler(); });
}

function buttons(container, accs, onAnswer) {
  let acc = 0;
  const accButtons = {};
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
    press(b, () => onAnswer({ letter, acc }));
    grid.append(b);
    return b;
  });
  container.append(grid);

  function select(a) {
    acc = a;
    for (const [k, b] of Object.entries(accButtons)) b.classList.toggle('selected', Number(k) === a);
  }
  select(0);

  return {
    reset() {
      select(0);
      container.querySelectorAll('.correct').forEach((b) => b.classList.remove('correct'));
    },
    showAnswer(n) {
      noteButtons[n.letter].classList.add('correct');
      if (n.acc) accButtons[n.acc]?.classList.add('correct');
    },
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
  };
}
