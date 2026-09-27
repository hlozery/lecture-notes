// Rendu SVG de la portée : clés, notes, lignes supplémentaires, altérations, grand portée.
import { staffPos, ledgerLines } from './music.js';

const SP = 8; // demi-interligne en px (interligne = 16)
const CLEF_X = 34;
const FIRST_NOTE_X = 96;

// Clé de sol, origine sur la ligne de sol (2e ligne en partant du bas).
const TREBLE = `
  <path d="M3,4 C-6,4 -8,-8 2,-10 C14,-12 20,4 10,14 C0,22 -16,16 -16,0
           C-16,-18 4,-30 10,-44 C14,-54 12,-68 6,-68 C-2,-68 -4,-52 -2,-40
           L6,36 C7,46 -6,48 -8,40"
        fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="-5" cy="39" r="4.2" fill="currentColor"/>`;

// Clé de fa, origine sur la ligne de fa (2e ligne en partant du haut).
const BASS = `
  <circle cx="-9" cy="0" r="6" fill="currentColor"/>
  <path d="M-12,-2 C-11,-15 1,-18 8,-13 C17,-6 16,10 7,20 C0,28 -9,34 -18,41
           C-10,34 -3,27 2,18 C8,8 8,-6 2,-11 C-3,-14 -10,-10 -12,-2 Z" fill="currentColor"/>
  <circle cx="20" cy="-8" r="2.8" fill="currentColor"/>
  <circle cx="20" cy="8" r="2.8" fill="currentColor"/>`;

function sharp(x, y) {
  return `<g stroke="currentColor" stroke-linecap="butt">
    <line x1="${x - 3}" y1="${y - 13}" x2="${x - 3}" y2="${y + 15}" stroke-width="1.6"/>
    <line x1="${x + 3}" y1="${y - 15}" x2="${x + 3}" y2="${y + 13}" stroke-width="1.6"/>
    <line x1="${x - 7}" y1="${y - 2}" x2="${x + 7}" y2="${y - 6}" stroke-width="3.6"/>
    <line x1="${x - 7}" y1="${y + 7}" x2="${x + 7}" y2="${y + 3}" stroke-width="3.6"/>
  </g>`;
}

function flat(x, y) {
  return `<g fill="none" stroke="currentColor" stroke-linecap="round">
    <line x1="${x - 4}" y1="${y - 22}" x2="${x - 4}" y2="${y + 6}" stroke-width="1.8"/>
    <path d="M${x - 4},${y + 6} C${x + 9},${y - 1} ${x + 8},${y - 11} ${x - 4},${y - 2}" stroke-width="2.8"/>
  </g>`;
}

function noteSvg(x, cy, pos, n, { color, cls = '', stem = true }) {
  const y = cy - pos * SP;
  let s = `<g class="note ${cls}"${color ? ` style="color:${color}"` : ''}>`;
  for (const p of ledgerLines(pos)) {
    const ly = cy - p * SP;
    s += `<line x1="${x - 15}" y1="${ly}" x2="${x + 15}" y2="${ly}" stroke="currentColor" stroke-width="1.6"/>`;
  }
  if (n.acc === 1) s += sharp(x - 24, y);
  if (n.acc === -1) s += flat(x - 22, y);
  s += `<ellipse cx="${x}" cy="${y}" rx="8.6" ry="6.4" transform="rotate(-20 ${x} ${y})" fill="currentColor"/>`;
  if (stem) {
    s += pos < 0
      ? `<line x1="${x + 7.8}" y1="${y - 2}" x2="${x + 7.8}" y2="${y - 54}" stroke="currentColor" stroke-width="1.7"/>`
      : `<line x1="${x - 7.8}" y1="${y + 2}" x2="${x - 7.8}" y2="${y + 54}" stroke="currentColor" stroke-width="1.7"/>`;
  }
  return s + '</g>';
}

function staffLines(cy, width) {
  let s = '';
  for (let p = -4; p <= 4; p += 2) {
    s += `<line x1="10" y1="${cy - p * SP}" x2="${width - 6}" y2="${cy - p * SP}" stroke="currentColor" stroke-width="1.3" opacity=".75"/>`;
  }
  return s;
}

function clefSvg(clef, cy) {
  return clef === 'sol'
    ? `<g transform="translate(${CLEF_X} ${cy + 2 * SP})">${TREBLE}</g>`
    : `<g transform="translate(${CLEF_X} ${cy - 2 * SP})">${BASS}</g>`;
}

/**
 * layout : 'sol' | 'fa' | 'grand'
 * notes  : [{ clef, note, color?, cls? }] — en grand portée, clef choisit la portée.
 * width  : largeur minimale ; une note seule est centrée.
 * crop   : recadrer au plus juste (false = cadre fixe, pour que la portée ne bouge pas en jeu).
 */
export function renderStaff({ layout, notes = [], width = 260, spacing = 40, stem = true, crop = true }) {
  const grand = layout === 'grand';
  const cys = grand ? { sol: 92, fa: 220 } : { [layout]: 100 };
  const height = grand ? 316 : 200;
  const w = Math.max(width, FIRST_NOTE_X + notes.length * spacing + 10);
  const xs = notes.length === 1
    ? [Math.round((FIRST_NOTE_X - 20 + w) / 2)]
    : notes.map((_, i) => FIRST_NOTE_X + 8 + i * spacing);

  let body = '';
  for (const [clef, cy] of Object.entries(cys)) body += staffLines(cy, w) + clefSvg(clef, cy);
  if (grand) {
    const top = cys.sol - 4 * SP, bot = cys.fa + 4 * SP, mid = (top + bot) / 2;
    body += `<line x1="10" y1="${top}" x2="10" y2="${bot}" stroke="currentColor" stroke-width="1.6"/>
      <path d="M7,${top} C-2,${top + 22} 8,${mid - 24} 0,${mid} C8,${mid + 24} -2,${bot - 22} 7,${bot}"
            fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`;
  }
  notes.forEach((item, i) => {
    const staff = grand ? item.clef : layout;
    body += noteSvg(xs[i], cys[staff], staffPos(item.note, item.clef), item.note, { color: item.color, cls: item.cls, stem });
  });

  // Portée simple : cadrage vertical au plus juste (clé + notes, hampes comprises).
  let y0 = 0, h = height;
  if (!grand && crop) {
    const cy = cys[layout];
    let top = cy - 64, bottom = cy + 64;
    for (const item of notes) {
      const y = cy - staffPos(item.note, item.clef) * SP;
      const up = stem && staffPos(item.note, item.clef) < 0;
      top = Math.min(top, y - (up ? 60 : 24));
      bottom = Math.max(bottom, y + (stem && !up ? 60 : 12));
    }
    y0 = Math.floor(top);
    h = Math.ceil(bottom) - y0;
  }
  const x0 = grand ? -4 : 4;
  return `<svg class="staff" viewBox="${x0} ${y0} ${w - x0} ${h}" role="img" aria-label="Portée">${body}</svg>`;
}
