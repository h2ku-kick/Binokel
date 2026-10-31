import { Card, RANK_LABEL, RANK_NAME, Rank, Suit } from '../engine/cards';

export const SUIT_COLOR: Record<Suit, string> = {
  E: '#7a4a1c',
  L: '#2c7a35',
  H: '#c3242f',
  S: '#c98a0c',
};

/**
 * Echte Kartenbilder: Liegen Dateien in src/assets/cards/ (z.B. "H-A.jpg", "E-U.png", "back.jpg"),
 * werden sie automatisch statt der gezeichneten Karten verwendet.
 * Namensschema: <Farbe>-<Rang>, Farbe E/L/H/S, Rang A/Z/K/O/U/7.
 */
const IMAGES = import.meta.glob('../assets/cards/*.{jpg,jpeg,png,webp,svg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const IMAGE_BY_KEY: Record<string, string> = {};
for (const [path, url] of Object.entries(IMAGES)) {
  const name = path.split('/').pop()!.replace(/\.[a-z]+$/, '');
  IMAGE_BY_KEY[name] = url;
}

export function hasRealImages(): boolean {
  return Object.keys(IMAGE_BY_KEY).length > 0;
}

/** Farbsymbole des deutschen Blatts als SVG (viewBox 0 0 100 100). */
export function suitSvg(s: Suit, cls = ''): string {
  const inner: Record<Suit, string> = {
    H: `<path d="M50 90C22 68 6 52 6 33 6 18 17 8 30 8c9 0 16 5 20 13 4-8 11-13 20-13 13 0 24 10 24 25 0 19-16 35-44 57z" fill="#c3242f" stroke="#7a1018" stroke-width="2.5"/>
        <path d="M27 19c-7 2-11 8-10 15" stroke="#fff" stroke-opacity=".5" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    L: `<path d="M50 4C70 20 88 40 84 62c-3 15-15 23-28 24v8h-12v-8C31 85 19 77 16 62 12 40 30 20 50 4z" fill="#2c7a35" stroke="#16441b" stroke-width="2.5"/>
        <path d="M50 14v70M50 38l-15-9M50 38l15-9M50 56l-19-11M50 56l19-11M50 72l-14-8M50 72l14-8" stroke="#16441b" stroke-width="3" fill="none" stroke-linecap="round"/>`,
    E: `<path d="M50 2c3 0 4 3 4 6v8h-8V8c0-3 1-6 4-6z" fill="#3d2509"/>
        <ellipse cx="50" cy="63" rx="23" ry="30" fill="#b9792e" stroke="#5a3510" stroke-width="2.5"/>
        <path d="M37 54c1 14 6 25 13 31" stroke="#fff" stroke-opacity=".35" stroke-width="4" fill="none" stroke-linecap="round"/>
        <path d="M19 47c0-21 14-33 31-33s31 12 31 33z" fill="#6b3f14" stroke="#3d2509" stroke-width="2.5"/>
        <path d="M26 42l9-17M38 46l7-30M52 46l-1-30M64 45l-6-27M75 41l-9-16M24 34h52" stroke="#3d2509" stroke-width="2.2" stroke-linecap="round"/>`,
    S: `<circle cx="50" cy="11" r="7" fill="#8c5c04" stroke="#5a3c04" stroke-width="2"/>
        <circle cx="50" cy="54" r="37" fill="#e2a312" stroke="#7a5004" stroke-width="2.5"/>
        <rect x="13" y="42" width="74" height="11" fill="#9b6606"/>
        <path d="M50 65v24" stroke="#3d2602" stroke-width="4" stroke-linecap="round"/>
        <circle cx="50" cy="69" r="7" fill="#3d2602"/>
        <path d="M27 30c6-8 14-12 22-12" stroke="#fff" stroke-opacity=".55" stroke-width="5" fill="none" stroke-linecap="round"/>`,
  };
  return `<svg class="suit ${cls}" viewBox="0 0 100 100" aria-hidden="true">${inner[s]}</svg>`;
}

/** Positionen (in % der Karte) der Farbsymbole für Zahlkarten. */
const PIPS: Partial<Record<Rank, [number, number][]>> = {
  Z: [
    [32, 20], [68, 20], [32, 35], [68, 35], [32, 50], [68, 50], [32, 65], [68, 65], [32, 80], [68, 80],
  ],
  '7': [
    [32, 22], [68, 22], [32, 42], [68, 42], [50, 32], [32, 70], [68, 70],
  ],
};

const CROWN = `<svg class="crown" viewBox="0 0 40 24" aria-hidden="true"><path d="M2 22 5 6l9 9 6-13 6 13 9-9 3 16z" fill="#e2a312" stroke="#7a5004" stroke-width="1.5" stroke-linejoin="round"/></svg>`;

function centerHtml(c: Card): string {
  const s = c.suit;
  if (c.rank === 'A') {
    return `<div class="pips daus">${suitSvg(s, 'pip-big')}${suitSvg(s, 'pip-big')}</div>`;
  }
  const pips = PIPS[c.rank];
  if (pips) {
    return `<div class="pips">${pips
      .map(([x, y], i) => `<span style="left:${x}%;top:${y}%" class="${y > 52 && i > 0 ? 'flip' : ''}">${suitSvg(s, 'pip')}</span>`)
      .join('')}</div>`;
  }
  // Bildkarten
  const top = c.rank === 'U' ? '' : suitSvg(s, 'court-pip');
  const bottom = c.rank === 'U' ? suitSvg(s, 'court-pip') : '';
  return `<div class="court court-${c.rank}">
      ${c.rank === 'K' ? CROWN : ''}
      ${top}
      <span class="courtname">${RANK_NAME[c.rank]}</span>
      ${bottom}
    </div>`;
}

/** Inneres HTML einer Karte (Vorderseite). */
export function cardFaceHtml(c: Card): string {
  const img = IMAGE_BY_KEY[`${c.suit}-${c.rank}`];
  if (img) return `<div class="face photo"><img src="${img}" alt="" draggable="false"></div>`;
  const label = RANK_LABEL[c.rank];
  return `
    <div class="face" style="--suit:${SUIT_COLOR[c.suit]}">
      <div class="frame"></div>
      <div class="corner"><span class="rank">${label}</span>${suitSvg(c.suit, 'mini')}</div>
      ${centerHtml(c)}
      <div class="corner br"><span class="rank">${label}</span>${suitSvg(c.suit, 'mini')}</div>
    </div>`;
}

export function cardBackHtml(): string {
  const img = IMAGE_BY_KEY['back'];
  if (img) return `<div class="back photo"><img src="${img}" alt="" draggable="false"></div>`;
  return `<div class="back"><div class="back-inner"></div></div>`;
}

export function miniCardHtml(c: Card): string {
  return `<span class="minicard" style="--suit:${SUIT_COLOR[c.suit]}"><b>${RANK_LABEL[c.rank]}</b>${suitSvg(c.suit, 'tiny')}</span>`;
}
