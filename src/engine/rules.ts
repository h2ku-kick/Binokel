import { Card, CARD_POINTS, RANK_STRENGTH, Suit } from './cards';

export interface Played {
  seat: number;
  card: Card;
}

/** Index des aktuell stechenden Eintrags im Stich. Bei gleichen Karten gewinnt die zuerst gespielte. */
export function winningIndex(trick: Played[], trump: Suit): number {
  let best = 0;
  for (let i = 1; i < trick.length; i++) {
    if (beats(trick[i].card, trick[best].card, trump)) best = i;
  }
  return best;
}

/** Schlägt a die (bisher stechende) Karte b? */
export function beats(a: Card, b: Card, trump: Suit): boolean {
  if (a.suit === b.suit) return RANK_STRENGTH[a.rank] > RANK_STRENGTH[b.rank];
  return a.suit === trump;
}

/**
 * Erlaubte Karten nach Binokel-Regeln:
 * Farbzwang, Trumpfzwang und Stichzwang (man muss überstechen, wenn möglich).
 */
export function legalCards(hand: Card[], trick: Played[], trump: Suit): Card[] {
  if (trick.length === 0) return hand.slice();
  const led = trick[0].card.suit;
  const winner = trick[winningIndex(trick, trump)].card;

  const sameSuit = hand.filter((c) => c.suit === led);
  if (sameSuit.length > 0) {
    // Wurde schon gestochen (fremde Farbe mit Trumpf), muss nur bedient werden.
    if (winner.suit !== led) return sameSuit;
    const higher = sameSuit.filter((c) => beats(c, winner, trump));
    return higher.length > 0 ? higher : sameSuit;
  }

  const trumps = hand.filter((c) => c.suit === trump);
  if (trumps.length > 0) {
    const higher = trumps.filter((c) => beats(c, winner, trump));
    return higher.length > 0 ? higher : trumps;
  }

  return hand.slice();
}

export function trickPoints(cards: Card[]): number {
  return cards.reduce((s, c) => s + CARD_POINTS[c.rank], 0);
}

/** Auf Zehner runden (5 wird aufgerundet). */
export function roundTen(n: number): number {
  return Math.round(n / 10) * 10;
}
