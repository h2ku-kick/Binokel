import { describe, expect, it } from 'vitest';
import { cardFromId, Card } from '../src/engine/cards';
import { findMelds, meldTotal } from '../src/engine/melds';
import { legalCards, Played } from '../src/engine/rules';
import { applyAction, createGame, GameState, pendingSeats, PlayerInfo, viewFor } from '../src/engine/game';
import { decide, sampleHands } from '../src/ai/ai';

const c = (id: string): Card => cardFromId(id);
const ids = (cs: Card[]) => cs.map((x) => x.id).sort();

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

describe('Meldungen', () => {
  it('Familie, Paar, Binokel, Vier Säu', () => {
    const hand = ['H-A-0', 'H-Z-0', 'H-K-0', 'H-O-0', 'H-U-0', 'H-K-1', 'H-O-1', 'L-O-0', 'S-U-0', 'E-A-0', 'L-A-0', 'S-A-0'].map(c);
    const melds = findMelds(hand, 'H', false);
    const names = melds.map((m) => m.name).sort();
    expect(names).toEqual(['Binokel', 'Trumpf-Familie', 'Trumpf-Paar', 'Vier Säu'].sort());
    expect(meldTotal(melds)).toBe(150 + 40 + 40 + 100);
  });
  it('Nicht-Trumpf-Familie und Doppel-Binokel', () => {
    const hand = ['E-A-0', 'E-Z-0', 'E-K-0', 'E-O-0', 'E-U-0', 'L-O-0', 'L-O-1', 'S-U-0', 'S-U-1'].map(c);
    expect(meldTotal(findMelds(hand, 'H', false))).toBe(100 + 300);
  });
  it('Dix nur mit 48 Blatt', () => {
    const hand = [c('H-7-0')];
    expect(meldTotal(findMelds(hand, 'H', true))).toBe(10);
    expect(meldTotal(findMelds(hand, 'H', false))).toBe(0);
  });
});

describe('Stichregeln', () => {
  const trick = (...xs: [number, string][]): Played[] => xs.map(([seat, id]) => ({ seat, card: c(id) }));
  it('Farbzwang mit Überstechen', () => {
    const hand = ['E-A-0', 'E-U-0', 'H-A-0'].map(c);
    expect(ids(legalCards(hand, trick([0, 'E-K-0']), 'H'))).toEqual(['E-A-0']);
  });
  it('Bedienen ohne Überstechen wenn nicht möglich', () => {
    const hand = ['E-O-0', 'E-U-0', 'H-A-0'].map(c);
    expect(ids(legalCards(hand, trick([0, 'E-K-0']), 'H'))).toEqual(['E-O-0', 'E-U-0']);
  });
  it('Trumpfzwang mit Übertrumpfen', () => {
    const hand = ['H-A-0', 'H-U-0', 'S-A-0'].map(c);
    expect(ids(legalCards(hand, trick([0, 'E-K-0'], [1, 'H-O-0']), 'H'))).toEqual(['H-A-0']);
  });
  it('Bereits gestochen: nur bedienen', () => {
    const hand = ['E-U-0', 'E-A-1'].map(c);
    expect(ids(legalCards(hand, trick([0, 'E-K-0'], [1, 'H-U-0']), 'H'))).toEqual(['E-A-1', 'E-U-0']);
  });
});

function players(n: number, level: 'normal' | 'hard'): PlayerInfo[] {
  return new Array(n).fill(0).map((_, i) => ({ name: `Bot ${i}`, kind: 'bot', level }));
}

function runGame(mode: 3 | 4, level: 'normal' | 'hard', seed: number): GameState {
  const r = rng(seed);
  const s = createGame(mode, players(mode, level), { rnd: r, target: level === 'hard' ? 400 : 1000 });
  let guard = 0;
  while (s.phase !== 'gameOver' && guard++ < 20000) {
    if (s.phase === 'playing' && s.trickWinner >= 0) {
      expect(applyAction(s, -1, { type: 'collect' }, r)).toBeNull();
      continue;
    }
    const seat = pendingSeats(s)[0];
    const view = viewFor(s, seat);
    const a = decide(view, seat, level, r);
    const err = applyAction(s, seat, a, r);
    expect(err).toBeNull();
  }
  return s;
}

describe('Komplette Spiele mit Bots', () => {
  it('3 Spieler normal', () => {
    const s = runGame(3, 'normal', 1);
    expect(s.phase).toBe('gameOver');
    expect(s.winner).not.toBeNull();
  });
  it('4 Spieler (Kreuzbinokel) normal', () => {
    const s = runGame(4, 'normal', 7);
    expect(s.phase).toBe('gameOver');
  });
  it('3 Spieler schwer', () => {
    const s = runGame(3, 'hard', 3);
    expect(s.phase).toBe('gameOver');
  }, 60000);
  it('4 Spieler schwer', () => {
    const s = runGame(4, 'hard', 5);
    expect(s.phase).toBe('gameOver');
  }, 60000);
});

describe('Kartenverteilung für schwere KI', () => {
  it('respektiert Kartenanzahl', () => {
    const r = rng(11);
    const s = createGame(3, players(3, 'normal'), { rnd: r });
    // bis in die Spielphase
    while (s.phase !== 'playing') {
      const seat = pendingSeats(s)[0];
      applyAction(s, seat, decide(viewFor(s, seat), seat, 'normal', r), r);
    }
    const v = viewFor(s, 1);
    const hands = sampleHands(v, 1, r);
    for (let i = 0; i < 3; i++) expect(hands[i].length).toBe(s.hands[i].length);
    const all = new Set(hands.flat().map((x) => x.id));
    expect(all.size).toBe(hands.flat().length);
  });
});
