import { Card, makeDeck, shuffle, sortHand, Suit } from './cards';
import { findMelds, Meld, meldTotal } from './melds';
import { legalCards, Played, roundTen, trickPoints, winningIndex } from './rules';

export type Level = 'normal' | 'hard';
export type PlayerKind = 'local' | 'bot' | 'remote';

export interface PlayerInfo {
  name: string;
  kind: PlayerKind;
  level: Level; // für Bots (und als Ersatz bei Verbindungsabbruch)
}

export type Phase = 'bidding' | 'exchange' | 'melds' | 'playing' | 'roundEnd' | 'gameOver';

export interface PartyResult {
  seats: number[];
  melds: number; // gemeldet
  meldsCount: boolean; // zählt nur mit mindestens einem Stich
  tricks: number; // Augen (gerundet), inkl. letzter Stich und ggf. Gedrücktes
  score: number; // Ergebnis dieser Runde
}

export interface RoundResult {
  declarer: number;
  bid: number;
  trump: Suit | null;
  abgegangen: boolean;
  made: boolean;
  parties: PartyResult[];
}

export interface GameState {
  mode: 3 | 4;
  withSevens: boolean;
  target: number;
  players: PlayerInfo[];
  scores: number[]; // pro Partei
  dealer: number;
  round: number;
  phase: Phase;
  hands: Card[][];
  handCounts: number[];
  dabb: Card[];
  dabbRevealed: boolean;
  discard: Card[];
  bid: number;
  bidder: number;
  turn: number;
  passed: boolean[];
  calls: (string | null)[];
  declarer: number;
  trump: Suit | null;
  melds: Meld[][];
  declarerDecision: 'play' | 'abgehen' | null;
  trick: Played[];
  trickWinner: number;
  leader: number;
  won: Card[][];
  tricksCount: number[];
  lastTrick: Played[];
  history: Played[][];
  ready: boolean[];
  result: RoundResult | null;
  winner: number | null;
  version: number;
}

export type Action =
  | { type: 'bid'; value: number }
  | { type: 'pass' }
  | { type: 'exchange'; discard: string[]; trump: Suit }
  | { type: 'decide'; play: boolean }
  | { type: 'play'; cardId: string }
  | { type: 'collect' }
  | { type: 'ready' };

export const MIN_BID = 150;
export const BID_STEP = 10;

export function partyOf(state: { mode: 3 | 4 }, seat: number): number {
  return state.mode === 4 ? seat % 2 : seat;
}

export function partyCount(state: { mode: 3 | 4 }): number {
  return state.mode === 4 ? 2 : 3;
}

export function partySeats(state: { mode: 3 | 4 }, party: number): number[] {
  return state.mode === 4 ? [party, party + 2] : [party];
}

export function createGame(
  mode: 3 | 4,
  players: PlayerInfo[],
  opts: { target?: number; rnd?: () => number } = {},
): GameState {
  const withSevens = mode === 4;
  const s: GameState = {
    mode,
    withSevens,
    target: opts.target ?? 1000,
    players,
    scores: new Array(partyCount({ mode })).fill(0),
    dealer: Math.floor((opts.rnd ?? Math.random)() * mode),
    round: 0,
    phase: 'bidding',
    hands: [],
    handCounts: [],
    dabb: [],
    dabbRevealed: false,
    discard: [],
    bid: 0,
    bidder: -1,
    turn: 0,
    passed: [],
    calls: [],
    declarer: -1,
    trump: null,
    melds: [],
    declarerDecision: null,
    trick: [],
    trickWinner: -1,
    leader: 0,
    won: [],
    tricksCount: [],
    lastTrick: [],
    history: [],
    ready: [],
    result: null,
    winner: null,
    version: 0,
  };
  deal(s, opts.rnd);
  return s;
}

export function deal(s: GameState, rnd: () => number = Math.random): void {
  const n = s.mode;
  const deck = shuffle(makeDeck(s.withSevens), rnd);
  const perHand = (deck.length - 4) / n;
  s.round += 1;
  s.hands = [];
  for (let i = 0; i < n; i++) s.hands.push(sortHand(deck.slice(i * perHand, (i + 1) * perHand)));
  s.dabb = deck.slice(n * perHand);
  s.dabbRevealed = false;
  s.discard = [];
  s.bid = 0;
  s.bidder = -1;
  s.turn = (s.dealer + 1) % n;
  s.passed = new Array(n).fill(false);
  s.calls = new Array(n).fill(null);
  s.declarer = -1;
  s.trump = null;
  s.melds = new Array(n).fill(null).map(() => []);
  s.declarerDecision = null;
  s.trick = [];
  s.trickWinner = -1;
  s.leader = 0;
  s.won = new Array(n).fill(null).map(() => []);
  s.tricksCount = new Array(n).fill(0);
  s.lastTrick = [];
  s.history = [];
  s.ready = new Array(n).fill(false);
  s.result = null;
  s.phase = 'bidding';
  updateCounts(s);
}

function updateCounts(s: GameState) {
  s.handCounts = s.hands.map((h) => h.length);
}

/** Wer muss gerade etwas tun? (für Bots / Anzeige) */
export function pendingSeats(s: GameState): number[] {
  switch (s.phase) {
    case 'bidding':
    case 'exchange':
      return [s.turn];
    case 'playing':
      return s.trickWinner >= 0 ? [] : [s.turn];
    case 'melds':
    case 'roundEnd':
      return s.ready.map((r, i) => (r ? -1 : i)).filter((i) => i >= 0);
    default:
      return [];
  }
}

export function minNextBid(s: GameState): number {
  return s.bid === 0 ? MIN_BID : s.bid + BID_STEP;
}

/** Wendet eine Aktion an. Gibt einen Fehlertext zurück oder null bei Erfolg. seat = -1 für den Host. */
export function applyAction(s: GameState, seat: number, a: Action, rnd: () => number = Math.random): string | null {
  const n = s.mode;
  const err = (() => {
    switch (a.type) {
      case 'bid':
      case 'pass': {
        if (s.phase !== 'bidding') return 'Nicht in der Reizphase';
        if (seat !== s.turn) return 'Nicht dran';
        if (a.type === 'bid') {
          if (a.value < minNextBid(s) || a.value % BID_STEP !== 0) return 'Ungültiges Gebot';
          s.bid = a.value;
          s.bidder = seat;
          s.calls[seat] = String(a.value);
        } else {
          s.passed[seat] = true;
          s.calls[seat] = 'weg';
        }
        const active = [...Array(n).keys()].filter((i) => !s.passed[i]);
        if (active.length === 0) {
          // Keiner will: neu geben
          s.dealer = (s.dealer + 1) % n;
          deal(s, rnd);
          s.round -= 1;
          return null;
        }
        if (active.length === 1 && s.bid > 0) {
          startExchange(s);
          return null;
        }
        let t = (seat + 1) % n;
        while (s.passed[t]) t = (t + 1) % n;
        s.turn = t;
        return null;
      }
      case 'exchange': {
        if (s.phase !== 'exchange') return 'Nicht in der Drück-Phase';
        if (seat !== s.declarer) return 'Nur der Spieler darf drücken';
        if (a.discard.length !== 4 || new Set(a.discard).size !== 4) return 'Genau 4 Karten drücken';
        const hand = s.hands[seat];
        const disc = a.discard.map((id) => hand.find((c) => c.id === id));
        if (disc.some((c) => !c)) return 'Karte nicht auf der Hand';
        s.discard = disc as Card[];
        s.hands[seat] = sortHand(
          hand.filter((c) => !a.discard.includes(c.id)),
          a.trump,
        );
        s.trump = a.trump;
        for (let i = 0; i < n; i++) {
          s.hands[i] = sortHand(s.hands[i], a.trump);
          s.melds[i] = findMelds(s.hands[i], a.trump, s.withSevens);
        }
        s.calls = new Array(n).fill(null);
        s.ready = new Array(n).fill(false);
        s.declarerDecision = null;
        s.phase = 'melds';
        return null;
      }
      case 'decide': {
        if (s.phase !== 'melds') return 'Nicht in der Meldephase';
        if (seat !== s.declarer) return 'Nur der Spieler entscheidet';
        s.declarerDecision = a.play ? 'play' : 'abgehen';
        s.ready[seat] = true;
        s.calls[seat] = a.play ? 'I spiel!' : 'I gang ab';
        maybeFinishMelds(s);
        return null;
      }
      case 'ready': {
        if (s.phase !== 'melds' && s.phase !== 'roundEnd') return 'Nichts zu bestätigen';
        if (seat < 0 || seat >= n) return 'Ungültiger Platz';
        if (s.phase === 'melds' && seat === s.declarer) return 'Bitte entscheiden';
        s.ready[seat] = true;
        if (s.phase === 'melds') maybeFinishMelds(s);
        else if (s.ready.every(Boolean)) {
          if (s.winner !== null) s.phase = 'gameOver';
          else {
            s.dealer = (s.dealer + 1) % n;
            deal(s, rnd);
          }
        }
        return null;
      }
      case 'play': {
        if (s.phase !== 'playing') return 'Nicht in der Spielphase';
        if (seat !== s.turn || s.trickWinner >= 0) return 'Nicht dran';
        const hand = s.hands[seat];
        const card = hand.find((c) => c.id === a.cardId);
        if (!card) return 'Karte nicht auf der Hand';
        if (!legalCards(hand, s.trick, s.trump!).some((c) => c.id === card.id)) return 'Diese Karte ist nicht erlaubt';
        s.hands[seat] = hand.filter((c) => c.id !== card.id);
        s.trick.push({ seat, card });
        if (s.trick.length === n) {
          s.trickWinner = s.trick[winningIndex(s.trick, s.trump!)].seat;
          s.turn = -1;
        } else {
          s.turn = (seat + 1) % n;
        }
        return null;
      }
      case 'collect': {
        if (s.phase !== 'playing' || s.trickWinner < 0) return 'Kein Stich zum Einsammeln';
        const w = s.trickWinner;
        s.won[w].push(...s.trick.map((p) => p.card));
        s.tricksCount[w] += 1;
        s.lastTrick = s.trick;
        s.history.push(s.trick);
        s.trick = [];
        s.trickWinner = -1;
        s.leader = w;
        s.turn = w;
        if (s.hands.every((h) => h.length === 0)) scoreRound(s, w);
        return null;
      }
    }
  })();
  if (err === null) {
    updateCounts(s);
    s.version += 1;
  }
  return err;
}

function startExchange(s: GameState) {
  s.declarer = s.bidder;
  s.phase = 'exchange';
  s.turn = s.declarer;
  s.dabbRevealed = true;
  s.hands[s.declarer] = sortHand([...s.hands[s.declarer], ...s.dabb]);
}

function maybeFinishMelds(s: GameState) {
  if (!s.ready.every(Boolean) || !s.declarerDecision) return;
  s.calls = new Array(s.mode).fill(null);
  if (s.declarerDecision === 'abgehen') {
    scoreAbgehen(s);
  } else {
    s.phase = 'playing';
    s.leader = s.declarer;
    s.turn = s.declarer;
  }
}

function finishRound(s: GameState, result: RoundResult) {
  s.result = result;
  result.parties.forEach((p, i) => (s.scores[i] += p.score));
  const max = Math.max(...s.scores);
  if (max >= s.target) {
    // Bei Gleichstand gewinnt die Partei des Spielers, sonst die erste mit Höchstwert
    const dp = partyOf(s, s.declarer);
    s.winner = s.scores[dp] === max ? dp : s.scores.indexOf(max);
  }
  s.ready = new Array(s.mode).fill(false);
  s.phase = 'roundEnd';
}

function scoreAbgehen(s: GameState) {
  const dp = partyOf(s, s.declarer);
  const parties: PartyResult[] = [];
  for (let p = 0; p < partyCount(s); p++) {
    const seats = partySeats(s, p);
    const melds = seats.reduce((sum, i) => sum + meldTotal(s.melds[i]), 0);
    parties.push({
      seats,
      melds,
      meldsCount: p !== dp,
      tricks: 0,
      score: p === dp ? -s.bid : melds + 40,
    });
  }
  finishRound(s, {
    declarer: s.declarer,
    bid: s.bid,
    trump: s.trump,
    abgegangen: true,
    made: false,
    parties,
  });
}

function scoreRound(s: GameState, lastWinner: number) {
  const dp = partyOf(s, s.declarer);
  const parties: PartyResult[] = [];
  let made = false;
  for (let p = 0; p < partyCount(s); p++) {
    const seats = partySeats(s, p);
    const melds = seats.reduce((sum, i) => sum + meldTotal(s.melds[i]), 0);
    const tookTrick = seats.some((i) => s.tricksCount[i] > 0);
    let raw = seats.reduce((sum, i) => sum + trickPoints(s.won[i]), 0);
    if (seats.includes(lastWinner)) raw += 10;
    if (p === dp) raw += trickPoints(s.discard);
    const tricks = roundTen(raw);
    const total = tricks + (tookTrick ? melds : 0);
    let score = total;
    if (p === dp) {
      made = total >= s.bid;
      score = made ? total : -2 * s.bid;
    }
    parties.push({ seats, melds, meldsCount: tookTrick, tricks, score });
  }
  finishRound(s, { declarer: s.declarer, bid: s.bid, trump: s.trump, abgegangen: false, made, parties });
}

/** Sicht eines Platzes auf das Spiel (fremde Karten verborgen). seat = -1: Zuschauer. */
export function viewFor(s: GameState, seat: number): GameState {
  const v: GameState = JSON.parse(JSON.stringify(s));
  const reveal = s.phase === 'roundEnd' || s.phase === 'gameOver';
  v.hands = s.hands.map((h, i) => (i === seat || reveal ? h : []));
  if (!s.dabbRevealed) v.dabb = [];
  if (seat !== s.declarer && !reveal) v.discard = [];
  return v;
}

export function legalFor(s: GameState, seat: number): Card[] {
  if (s.phase !== 'playing' || s.turn !== seat || s.trickWinner >= 0) return [];
  return legalCards(s.hands[seat], s.trick, s.trump!);
}
