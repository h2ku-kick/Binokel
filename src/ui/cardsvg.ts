import { Card, RANK_LABEL, RANK_NAME, Suit } from '../engine/cards';

export const SUIT_COLOR: Record<Suit, string> = {
  E: '#8a5523',
  L: '#2f8a3c',
  H: '#d22f3c',
  S: '#d99a12',
};

/** Farbsymbole des deutschen Blatts als SVG (viewBox 0 0 100 100). */
export function suitSvg(s: Suit, cls = ''): string {
  const inner: Record<Suit, string> = {
    H: `<path d="M50 90C22 68 6 52 6 33 6 18 17 8 30 8c9 0 16 5 20 13 4-8 11-13 20-13 13 0 24 10 24 25 0 19-16 35-44 57z" fill="#d22f3c"/>
        <path d="M28 18c-8 1-13 8-12 16" stroke="#fff" stroke-opacity=".45" stroke-width="5" fill="none" stroke-linecap="round"/>`,
    L: `<path d="M50 4C70 20 88 40 84 62c-3 15-15 23-28 24v6h-12v-6C31 85 19 77 16 62 12 40 30 20 50 4z" fill="#2f8a3c"/>
        <path d="M50 16v68M50 40l-16-10M50 40l16-10M50 58l-20-12M50 58l20-12" stroke="#1d5e27" stroke-width="3.5" fill="none" stroke-linecap="round"/>`,
    E: `<rect x="46" y="4" width="8" height="12" rx="3" fill="#5b3714"/>
        <ellipse cx="50" cy="64" rx="24" ry="30" fill="#c58a3d"/>
        <path d="M34 56c2 14 8 26 16 32" stroke="#fff" stroke-opacity=".35" stroke-width="4" fill="none" stroke-linecap="round"/>
        <path d="M20 46c0-20 14-32 30-32s30 12 30 32z" fill="#7a4a1c"/>
        <path d="M28 40l8-16M40 44l6-28M54 44l-2-28M66 42l-6-24M74 38l-8-14" stroke="#5b3714" stroke-width="3" stroke-linecap="round"/>`,
    S: `<circle cx="50" cy="12" r="7" fill="#b07a08"/>
        <circle cx="50" cy="54" r="38" fill="#e7a917"/>
        <rect x="12" y="42" width="76" height="12" fill="#b07a08"/>
        <circle cx="50" cy="72" r="7" fill="#5a3c04"/>
        <path d="M50 79v13" stroke="#5a3c04" stroke-width="4" stroke-linecap="round"/>
        <path d="M28 30c6-8 14-12 22-12" stroke="#fff" stroke-opacity=".5" stroke-width="5" fill="none" stroke-linecap="round"/>`,
  };
  return `<svg class="suit ${cls}" viewBox="0 0 100 100" aria-hidden="true">${inner[s]}</svg>`;
}

/** Inneres HTML einer Karte (Vorderseite). */
export function cardFaceHtml(c: Card): string {
  const label = RANK_LABEL[c.rank];
  const color = SUIT_COLOR[c.suit];
  const court = c.rank === 'K' || c.rank === 'O' || c.rank === 'U';
  return `
    <div class="face" style="--suit:${color}">
      <div class="corner">
        <span class="rank">${label}</span>
        ${suitSvg(c.suit, 'mini')}
      </div>
      <div class="center ${court ? 'court' : ''}">
        ${suitSvg(c.suit, 'big')}
        ${court ? `<span class="courtname">${RANK_NAME[c.rank]}</span>` : ''}
      </div>
      <div class="corner br">
        <span class="rank">${label}</span>
        ${suitSvg(c.suit, 'mini')}
      </div>
    </div>`;
}

export const CARD_BACK_HTML = `<div class="back"><div class="back-inner"><span>B</span></div></div>`;

export function miniCardHtml(c: Card): string {
  return `<span class="minicard" style="--suit:${SUIT_COLOR[c.suit]}"><b>${RANK_LABEL[c.rank]}</b>${suitSvg(c.suit, 'tiny')}</span>`;
}
