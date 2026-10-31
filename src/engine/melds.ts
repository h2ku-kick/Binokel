import { Card, Rank, Suit, SUITS, SUIT_NAME } from './cards';

export interface Meld {
  name: string;
  points: number;
  cardIds: string[];
}

function byKey(cards: Card[]): Map<string, Card[]> {
  const m = new Map<string, Card[]>();
  for (const c of cards) {
    const k = c.suit + c.rank;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(c);
  }
  return m;
}

/**
 * Berechnet alle Meldungen einer Hand bei gegebenem Trumpf.
 * Eine Karte darf in verschiedenen Meldearten zählen, aber nicht zweimal in derselben.
 */
export function findMelds(cards: Card[], trump: Suit, withSevens: boolean): Meld[] {
  const map = byKey(cards);
  const get = (s: Suit, r: Rank) => map.get(s + r) ?? [];
  const melds: Meld[] = [];

  // Familien und Paare je Farbe
  for (const s of SUITS) {
    const famRanks: Rank[] = ['A', 'Z', 'K', 'O', 'U'];
    const fam = Math.min(...famRanks.map((r) => get(s, r).length));
    const isTrump = s === trump;
    if (fam === 2) {
      melds.push({
        name: isTrump ? 'Doppelte Trumpf-Familie' : `Doppelte Familie (${SUIT_NAME[s]})`,
        points: isTrump ? 1500 : 1000,
        cardIds: famRanks.flatMap((r) => get(s, r).map((c) => c.id)),
      });
    } else if (fam === 1) {
      melds.push({
        name: isTrump ? 'Trumpf-Familie' : `Familie (${SUIT_NAME[s]})`,
        points: isTrump ? 150 : 100,
        cardIds: famRanks.map((r) => get(s, r)[0].id),
      });
    }
    const pairs = Math.min(get(s, 'K').length, get(s, 'O').length) - fam;
    for (let i = 0; i < pairs; i++) {
      const k = get(s, 'K')[fam + i];
      const o = get(s, 'O')[fam + i];
      melds.push({
        name: isTrump ? 'Trumpf-Paar' : `Paar (${SUIT_NAME[s]})`,
        points: isTrump ? 40 : 20,
        cardIds: [k.id, o.id],
      });
    }
  }

  // Binokel: Laub-Ober + Schellen-Unter
  const lo = get('L', 'O');
  const su = get('S', 'U');
  const bino = Math.min(lo.length, su.length);
  if (bino === 2) {
    melds.push({ name: 'Doppel-Binokel', points: 300, cardIds: [...lo, ...su].map((c) => c.id) });
  } else if (bino === 1) {
    melds.push({ name: 'Binokel', points: 40, cardIds: [lo[0].id, su[0].id] });
  }

  // Vier Gleiche (eine von jeder Farbe)
  const fours: [Rank, string, number][] = [
    ['A', 'Säu', 100],
    ['K', 'Könige', 80],
    ['O', 'Ober', 60],
    ['U', 'Unter', 40],
  ];
  for (const [r, label, pts] of fours) {
    const n = Math.min(...SUITS.map((s) => get(s, r).length));
    if (n === 2) {
      melds.push({
        name: `Acht ${label}`,
        points: pts * 10,
        cardIds: SUITS.flatMap((s) => get(s, r).map((c) => c.id)),
      });
    } else if (n === 1) {
      melds.push({
        name: `Vier ${label}`,
        points: pts,
        cardIds: SUITS.map((s) => get(s, r)[0].id),
      });
    }
  }

  // Dix: Trumpf-Siebener (nur mit 48 Blatt)
  if (withSevens) {
    for (const c of get(trump, '7')) {
      melds.push({ name: 'Dix', points: 10, cardIds: [c.id] });
    }
  }

  return melds;
}

export function meldTotal(melds: Meld[]): number {
  return melds.reduce((s, m) => s + m.points, 0);
}
