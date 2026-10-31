import { Card, CARD_POINTS, makeDeck, RANK_STRENGTH, shuffle, Suit, SUITS } from '../engine/cards';
import { findMelds, meldTotal } from '../engine/melds';
import {
  Action,
  GameState,
  Level,
  legalFor,
  minNextBid,
  partyOf,
} from '../engine/game';
import { beats, legalCards, Played, roundTen, trickPoints, winningIndex } from '../engine/rules';

// ---------------------------------------------------------------------------
// Bewertung von Händen
// ---------------------------------------------------------------------------

/** Grobe Schätzung der Augen, die eine Hand mit diesem Trumpf in Stichen holt. */
export function estimateTricks(hand: Card[], trump: Suit, mode: 3 | 4): number {
  let est = 10;
  const trumps = hand.filter((c) => c.suit === trump);
  const hasTrumpA = trumps.some((c) => c.rank === 'A');
  for (const c of trumps) {
    if (c.rank === 'A') est += 24;
    else if (c.rank === 'Z') est += hasTrumpA ? 15 : 9;
    else est += 6;
  }
  if (trumps.length >= 5) est += (trumps.length - 4) * 10;
  for (const s of SUITS) {
    if (s === trump) continue;
    const cs = hand.filter((c) => c.suit === s);
    const aces = cs.filter((c) => c.rank === 'A').length;
    if (aces >= 1) est += 18;
    if (aces >= 2) est += 10;
    if (aces >= 1 && cs.some((c) => c.rank === 'Z')) est += 8;
    if (cs.length === 0 && trumps.length >= 3) est += 8; // Fehlfarbe zum Stechen
  }
  return mode === 4 ? est * 0.85 : est;
}

export function evalHand(hand: Card[], trump: Suit, mode: 3 | 4, withSevens: boolean): number {
  return meldTotal(findMelds(hand, trump, withSevens)) + estimateTricks(hand, trump, mode);
}

/** Beste Kombination aus Trumpf und 4 gedrückten Karten (gierig). */
export function bestExchange(
  hand: Card[],
  mode: 3 | 4,
  withSevens: boolean,
): { trump: Suit; discard: Card[]; value: number } {
  let best: { trump: Suit; discard: Card[]; value: number } | null = null;
  for (const trump of SUITS) {
    const meldIds = new Set(findMelds(hand, trump, withSevens).flatMap((m) => m.cardIds));
    const suitLen = (s: Suit) => hand.filter((c) => c.suit === s).length;
    const keep = (c: Card) => {
      let v: number;
      if (c.suit === trump) v = 30 + RANK_STRENGTH[c.rank] * 3;
      else if (c.rank === 'A') v = 25;
      else if (c.rank === 'Z') v = hand.some((x) => x.suit === c.suit && x.rank === 'A') ? 15 : 4;
      else v = RANK_STRENGTH[c.rank] * 0.5;
      if (meldIds.has(c.id)) v += 40;
      if (c.suit !== trump) {
        v -= CARD_POINTS[c.rank] * 0.6; // Gedrücktes zählt für den Spieler
        if (suitLen(c.suit) <= 2) v -= 3;
      }
      return v;
    };
    const sorted = hand.slice().sort((a, b) => keep(a) - keep(b));
    const discard = sorted.slice(0, 4);
    const kept = sorted.slice(4);
    const value = evalHand(kept, trump, mode, withSevens) + trickPoints(discard);
    if (!best || value > best.value) best = { trump, discard, value };
  }
  return best!;
}

// ---------------------------------------------------------------------------
// Spielzüge (Heuristik)
// ---------------------------------------------------------------------------

interface PlayCtx {
  mode: 3 | 4;
  trump: Suit;
  declarer: number;
}

function friends(ctx: PlayCtx, a: number, b: number): boolean {
  if (a === b) return true;
  if (ctx.mode === 4) return a % 2 === b % 2;
  return a !== ctx.declarer && b !== ctx.declarer;
}

/** Heuristischer Kartenzug. */
export function heuristicCard(
  ctx: PlayCtx,
  seat: number,
  hand: Card[],
  trick: Played[],
  played: Set<string> | null,
): Card {
  const legal = legalCards(hand, trick, ctx.trump);
  if (legal.length === 1) return legal[0];
  const { trump, mode } = ctx;
  const pts = (c: Card) => CARD_POINTS[c.rank];
  const str = (c: Card) => RANK_STRENGTH[c.rank] + (c.suit === trump ? 10 : 0);
  const lowest = (cs: Card[]) => cs.slice().sort((a, b) => pts(a) - pts(b) || str(a) - str(b))[0];

  if (trick.length === 0) {
    const myTrumps = hand.filter((c) => c.suit === trump);
    const isDeclSide = friends(ctx, seat, ctx.declarer);
    // Freie Säu ausspielen
    const aces = legal.filter((c) => c.rank === 'A' && c.suit !== trump);
    if (aces.length) return aces[0];
    // Trumpf ziehen, wenn stark
    if (isDeclSide && myTrumps.length >= Math.ceil(hand.length / 2)) {
      return myTrumps.slice().sort((a, b) => str(b) - str(a))[0];
    }
    // Zehner, deren Sau schon gefallen ist (beide), sind sicher
    if (played) {
      const safeTens = legal.filter(
        (c) =>
          c.rank === 'Z' &&
          c.suit !== trump &&
          played.has(`${c.suit}-A-0`) &&
          played.has(`${c.suit}-A-1`),
      );
      if (safeTens.length) return safeTens[0];
    }
    const nonTrump = legal.filter((c) => c.suit !== trump && c.rank !== 'Z');
    return lowest(nonTrump.length ? nonTrump : legal);
  }

  const wi = winningIndex(trick, trump);
  const winner = trick[wi];
  const isLast = trick.length === mode - 1;
  const friendWinning = friends(ctx, seat, winner.seat);
  const winning = legal.filter((c) => beats(c, winner.card, trump));
  const trickPts = trickPoints(trick.map((p) => p.card));

  if (friendWinning) {
    const safe =
      isLast ||
      (winner.card.suit === trump && RANK_STRENGTH[winner.card.rank] >= 5) ||
      (winner.card.rank === 'A' && winner.card.suit === trick[0].card.suit);
    if (safe) {
      // Schmieren: viele Augen dazugeben, aber keine Trumpf-Sau verschwenden
      const cand = legal.filter((c) => !(c.suit === trump && c.rank === 'A'));
      const pool = cand.length ? cand : legal;
      return pool.slice().sort((a, b) => pts(b) - pts(a) || str(a) - str(b))[0];
    }
    return lowest(legal);
  }

  if (winning.length) {
    if (isLast) {
      return winning.slice().sort((a, b) => pts(b) - (b.suit === trump ? str(b) : 0) - (pts(a) - (a.suit === trump ? str(a) : 0)))[0];
    }
    const strongest = winning.slice().sort((a, b) => str(b) - str(a))[0];
    if (strongest.rank === 'A' || trickPts >= 10) return strongest;
    return winning.slice().sort((a, b) => str(a) - str(b))[0];
  }
  return lowest(legal);
}

// ---------------------------------------------------------------------------
// Verdeckte Karten zufällig verteilen (für die schwere KI)
// ---------------------------------------------------------------------------

function voidsFromHistory(tricks: Played[][], trump: Suit, n: number): Set<Suit>[] {
  const voids: Set<Suit>[] = new Array(n).fill(null).map(() => new Set<Suit>());
  for (const t of tricks) {
    if (!t.length) continue;
    const led = t[0].card.suit;
    for (let i = 1; i < t.length; i++) {
      const { seat, card } = t[i];
      if (card.suit !== led) {
        voids[seat].add(led);
        if (card.suit !== trump) voids[seat].add(trump);
      }
    }
  }
  return voids;
}

/** Erzeugt vollständige Hände aller Spieler (Index n = gedrückte Karten), konsistent mit dem Wissen von `seat`. */
export function sampleHands(v: GameState, seat: number, rnd: () => number = Math.random): Card[][] {
  const n = v.mode;
  const deck = makeDeck(v.withSevens);
  const known = new Set<string>();
  v.hands[seat].forEach((c) => known.add(c.id));
  v.history.flat().forEach((p) => known.add(p.card.id));
  v.trick.forEach((p) => known.add(p.card.id));
  const iAmDecl = seat === v.declarer;
  if (iAmDecl) v.discard.forEach((c) => known.add(c.id));

  const capacity = v.handCounts.slice();
  capacity[seat] = 0;
  const discardSlot = n; // virtueller Platz für die gedrückten Karten
  capacity.push(iAmDecl || v.declarer < 0 || v.phase === 'bidding' ? 0 : 4);
  if (v.phase === 'bidding' || v.phase === 'exchange') {
    // Dabb noch nicht beim Spieler: als eigener Platz
    if (!v.dabbRevealed) capacity[discardSlot] = 4;
  }

  const result: Card[][] = new Array(n + 1).fill(null).map(() => []);
  result[seat] = v.hands[seat].slice();
  const unknown = deck.filter((c) => !known.has(c.id));
  const assigned = new Set<string>();
  const give = (slot: number, c: Card) => {
    result[slot].push(c);
    capacity[slot] -= 1;
    assigned.add(c.id);
  };

  // Gemeldete Karten sind öffentlich
  if (v.phase !== 'bidding' && v.phase !== 'exchange') {
    v.melds.forEach((ms, i) => {
      if (i === seat) return;
      const ids = new Set(ms.flatMap((m) => m.cardIds));
      for (const c of unknown) {
        if (ids.has(c.id) && !assigned.has(c.id) && capacity[i] > 0) give(i, c);
      }
    });
  }
  // Dabb-Karten: beim Spieler oder gedrückt
  if (v.dabbRevealed && !iAmDecl && v.declarer >= 0) {
    for (const c of shuffle(v.dabb, rnd)) {
      if (assigned.has(c.id) || !unknown.some((u) => u.id === c.id)) continue;
      const opts = [v.declarer, discardSlot].filter((s) => capacity[s] > 0);
      if (opts.length) give(opts[Math.floor(rnd() * opts.length)], c);
    }
  }

  const voids = v.trump ? voidsFromHistory([...v.history, v.trick], v.trump, n) : null;
  const rest = unknown.filter((c) => !assigned.has(c.id));
  for (let attempt = 0; attempt < 30; attempt++) {
    const cap = capacity.slice();
    const out: Card[][] = result.map((r) => r.slice());
    let ok = true;
    const ignoreVoids = attempt >= 25;
    // Karten mit wenigen Möglichkeiten zuerst
    const cards = shuffle(rest, rnd);
    for (const c of cards) {
      const slots = [];
      for (let s = 0; s <= n; s++) {
        if (s === seat || cap[s] <= 0) continue;
        if (!ignoreVoids && voids && s < n && voids[s].has(c.suit)) continue;
        slots.push(s);
      }
      if (!slots.length) {
        ok = false;
        break;
      }
      // Gewichtet nach freier Kapazität
      const total = slots.reduce((a, s) => a + cap[s], 0);
      let r = rnd() * total;
      let pick = slots[0];
      for (const s of slots) {
        r -= cap[s];
        if (r <= 0) {
          pick = s;
          break;
        }
      }
      out[pick].push(c);
      cap[pick] -= 1;
    }
    if (ok) return out;
  }
  // Notfall: ohne Einschränkungen
  const cap = capacity.slice();
  const out = result.map((r) => r.slice());
  for (const c of shuffle(rest, rnd)) {
    for (let s = 0; s <= n; s++) {
      if (s !== seat && cap[s] > 0) {
        out[s].push(c);
        cap[s] -= 1;
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ausspielen simulieren
// ---------------------------------------------------------------------------

interface SimResult {
  partyPoints: number[]; // Augen + gültige Meldungen pro Platz-Partei
  declTotal: number;
  made: boolean;
}

function simulate(
  v: GameState,
  hands: Card[][],
  firstCard: Card | null,
  firstSeat: number,
): SimResult {
  const n = v.mode;
  const ctx: PlayCtx = { mode: n, trump: v.trump!, declarer: v.declarer };
  const h = hands.slice(0, n).map((x) => x.slice());
  const won = new Array(n).fill(0);
  const took = new Array(n).fill(false);
  v.history.forEach((t) => {
    const w = t[winningIndex(t, ctx.trump)].seat;
    won[w] += trickPoints(t.map((p) => p.card));
    took[w] = true;
  });
  const played = new Set(v.history.flat().map((p) => p.card.id));
  let trick: Played[] = v.trick.slice();
  trick.forEach((p) => played.add(p.card.id));
  let turn = firstSeat;
  let first = firstCard;
  let lastWinner = -1;
  while (true) {
    if (trick.length === n) {
      const w = trick[winningIndex(trick, ctx.trump)].seat;
      won[w] += trickPoints(trick.map((p) => p.card));
      took[w] = true;
      trick = [];
      turn = w;
      lastWinner = w;
      if (h.every((x) => x.length === 0)) break;
    }
    if (h[turn].length === 0) break;
    const card = first ?? heuristicCard(ctx, turn, h[turn], trick, played);
    first = null;
    h[turn] = h[turn].filter((c) => c.id !== card.id);
    trick.push({ seat: turn, card });
    played.add(card.id);
    turn = (turn + 1) % n;
  }
  if (lastWinner >= 0) won[lastWinner] += 10;
  const pc = n === 4 ? 2 : 3;
  const partyPoints = new Array(pc).fill(0);
  for (let p = 0; p < pc; p++) {
    const seats = n === 4 ? [p, p + 2] : [p];
    let raw = seats.reduce((a, s) => a + won[s], 0);
    if (seats.includes(v.declarer)) raw += trickPoints(v.discard.length ? v.discard : hands[n] ?? []);
    const melds = seats.reduce((a, s) => a + meldTotal(v.melds[s] ?? []), 0);
    partyPoints[p] = roundTen(raw) + (seats.some((s) => took[s]) ? melds : 0);
  }
  const dp = partyOf(v, v.declarer);
  const declTotal = partyPoints[dp];
  return { partyPoints, declTotal, made: declTotal >= v.bid };
}

function valueFor(v: GameState, seat: number, r: SimResult): number {
  const myP = partyOf(v, seat);
  const dp = partyOf(v, v.declarer);
  if (myP === dp) return r.declTotal + (r.made ? 120 : -120 - v.bid);
  return r.partyPoints[myP] - r.declTotal * 0.6 + (r.made ? -80 : 80);
}

// ---------------------------------------------------------------------------
// Entscheidungen
// ---------------------------------------------------------------------------

export function decide(v: GameState, seat: number, level: Level, rnd: () => number = Math.random): Action {
  switch (v.phase) {
    case 'bidding':
      return decideBid(v, seat, level, rnd);
    case 'exchange': {
      const ex = bestExchange(v.hands[seat], v.mode, v.withSevens);
      return { type: 'exchange', discard: ex.discard.map((c) => c.id), trump: ex.trump };
    }
    case 'melds':
      if (seat === v.declarer) return { type: 'decide', play: decidePlayOn(v, seat, level, rnd) };
      return { type: 'ready' };
    case 'roundEnd':
      return { type: 'ready' };
    case 'playing':
      return { type: 'play', cardId: decideCard(v, seat, level, rnd).id };
    default:
      return { type: 'ready' };
  }
}

function handLimit(v: GameState, seat: number, level: Level, rnd: () => number): number {
  const hand = v.hands[seat];
  if (level === 'normal') {
    let best = 0;
    for (const t of SUITS) best = Math.max(best, evalHand(hand, t, v.mode, v.withSevens));
    const dabbBonus = 25;
    const partnerBonus = v.mode === 4 ? 45 : 0;
    return best + dabbBonus + partnerBonus - 15 + (rnd() * 40 - 20);
  }
  // Schwer: Dabb mehrfach zufällig ziehen und das Drücken mitbewerten
  const known = new Set(hand.map((c) => c.id));
  const unknown = makeDeck(v.withSevens).filter((c) => !known.has(c.id));
  const samples = 24;
  const values: number[] = [];
  for (let i = 0; i < samples; i++) {
    const dabb = shuffle(unknown, rnd).slice(0, 4);
    values.push(bestExchange([...hand, ...dabb], v.mode, v.withSevens).value);
  }
  values.sort((a, b) => a - b);
  const p40 = values[Math.floor(samples * 0.4)];
  const partnerBonus = v.mode === 4 ? 45 : 0;
  return p40 + partnerBonus - 5;
}

function decideBid(v: GameState, seat: number, level: Level, rnd: () => number): Action {
  const next = minNextBid(v);
  const limit = handLimit(v, seat, level, rnd);
  // Im Kreuzbinokel den Partner nicht unnötig überreizen
  if (v.mode === 4 && v.bidder >= 0 && v.bidder % 2 === seat % 2 && limit < v.bid + 60) {
    return { type: 'pass' };
  }
  if (next <= limit) return { type: 'bid', value: next };
  return { type: 'pass' };
}

function decidePlayOn(v: GameState, seat: number, level: Level, rnd: () => number): boolean {
  if (level === 'normal') {
    const hand = v.hands[seat];
    const est =
      meldTotal(v.melds[seat]) +
      estimateTricks(hand, v.trump!, v.mode) +
      trickPoints(v.discard) +
      (v.mode === 4 ? meldTotal(v.melds[(seat + 2) % 4]) + 40 : 0);
    return est >= v.bid - 30;
  }
  // Schwer: Erwartungswert durch Simulation
  const samples = 40;
  let evPlay = 0;
  for (let i = 0; i < samples; i++) {
    const hands = sampleHands(v, seat, rnd);
    const r = simulate(v, hands, null, v.declarer);
    evPlay += r.made ? r.declTotal : -2 * v.bid;
  }
  evPlay /= samples;
  return evPlay > -v.bid;
}

function decideCard(v: GameState, seat: number, level: Level, rnd: () => number): Card {
  const legal = legalFor(v, seat);
  if (legal.length === 1) return legal[0];
  const ctx: PlayCtx = { mode: v.mode, trump: v.trump!, declarer: v.declarer };
  const played = new Set([...v.history.flat(), ...v.trick].map((p) => p.card.id));
  if (level === 'normal') {
    if (rnd() < 0.12) return legal[Math.floor(rnd() * legal.length)];
    return heuristicCard(ctx, seat, v.hands[seat], v.trick, played);
  }
  // Schwer: Monte-Carlo
  const samples = Math.max(16, Math.floor(360 / legal.length));
  const scores = new Map<string, number>();
  legal.forEach((c) => scores.set(c.id, 0));
  for (let i = 0; i < samples; i++) {
    const hands = sampleHands(v, seat, rnd);
    for (const c of legal) {
      const r = simulate(v, hands, c, seat);
      scores.set(c.id, scores.get(c.id)! + valueFor(v, seat, r));
    }
  }
  let best = legal[0];
  for (const c of legal) if (scores.get(c.id)! > scores.get(best.id)!) best = c;
  return best;
}
