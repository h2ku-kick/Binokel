// Karten im deutschen (württembergischen) Blatt.

export type Suit = 'E' | 'L' | 'H' | 'S'; // Eichel, Laub, Herz, Schellen
export type Rank = 'A' | 'Z' | 'K' | 'O' | 'U' | '7'; // Sau, Zehner, König, Ober, Unter, Siebener

export interface Card {
  id: string; // z.B. "H-A-1"
  suit: Suit;
  rank: Rank;
}

export const SUITS: Suit[] = ['E', 'L', 'H', 'S'];
export const RANKS_40: Rank[] = ['A', 'Z', 'K', 'O', 'U'];
export const RANKS_48: Rank[] = ['A', 'Z', 'K', 'O', 'U', '7'];

export const SUIT_NAME: Record<Suit, string> = {
  E: 'Eichel',
  L: 'Laub',
  H: 'Herz',
  S: 'Schellen',
};

export const RANK_NAME: Record<Rank, string> = {
  A: 'Sau',
  Z: 'Zehner',
  K: 'König',
  O: 'Ober',
  U: 'Unter',
  '7': 'Siebener',
};

export const RANK_LABEL: Record<Rank, string> = {
  A: 'A',
  Z: '10',
  K: 'K',
  O: 'O',
  U: 'U',
  '7': '7',
};

/** Augen (Punkte) im Stich. */
export const CARD_POINTS: Record<Rank, number> = {
  A: 11,
  Z: 10,
  K: 4,
  O: 3,
  U: 2,
  '7': 0,
};

/** Stichstärke: höher schlägt niedriger. */
export const RANK_STRENGTH: Record<Rank, number> = {
  A: 6,
  Z: 5,
  K: 4,
  O: 3,
  U: 2,
  '7': 1,
};

export function makeDeck(withSevens: boolean): Card[] {
  const ranks = withSevens ? RANKS_48 : RANKS_40;
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of ranks) {
      for (let copy = 0; copy < 2; copy++) {
        deck.push({ id: `${suit}-${rank}-${copy}`, suit, rank });
      }
    }
  }
  return deck;
}

export function cardFromId(id: string): Card {
  const [suit, rank] = id.split('-') as [Suit, Rank];
  return { id, suit, rank };
}

export function shuffle<T>(arr: T[], rnd: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function cardName(c: Card): string {
  return `${SUIT_NAME[c.suit]}-${RANK_NAME[c.rank]}`;
}

/** Sortierung der Hand: nach Farbe (Trumpf zuerst), dann Stärke absteigend. */
export function sortHand(cards: Card[], trump: Suit | null = null): Card[] {
  const order: Suit[] = ['E', 'L', 'H', 'S'];
  const suitIdx = (s: Suit) => (s === trump ? -1 : order.indexOf(s));
  return cards.slice().sort((a, b) => {
    const d = suitIdx(a.suit) - suitIdx(b.suit);
    if (d !== 0) return d;
    const r = RANK_STRENGTH[b.rank] - RANK_STRENGTH[a.rank];
    if (r !== 0) return r;
    return a.id < b.id ? -1 : 1;
  });
}
