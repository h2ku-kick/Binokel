import { decide } from '../ai/ai';
import { Action, applyAction, createGame, GameState, pendingSeats, PlayerInfo, viewFor } from '../engine/game';

/** Verbindung eines Platzes zum Spiel: lokal oder über das Netz. */
export interface GameConn {
  seat: number;
  onView(cb: (v: GameState) => void): void;
  send(a: Action): void;
  onError?(cb: (msg: string) => void): void;
}

type Listener = (v: GameState) => void;

const SAVE_KEY = 'binokel-save';

/** Führt das Spiel (Autorität). Steuert Bots und verteilt Sichten. */
export class HostController {
  state: GameState;
  private listeners = new Map<number, Listener>();
  private errorListeners = new Map<number, (m: string) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  persist = false;

  constructor(state: GameState) {
    this.state = state;
  }

  static create(mode: 3 | 4, players: PlayerInfo[], target = 1000): HostController {
    return new HostController(createGame(mode, players, { target }));
  }

  static loadSaved(): HostController | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw) as GameState;
      if (!s || s.phase === 'gameOver') return null;
      const h = new HostController(s);
      h.persist = true;
      return h;
    } catch {
      return null;
    }
  }

  static hasSave(): boolean {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return !!raw && JSON.parse(raw).phase !== 'gameOver';
    } catch {
      return false;
    }
  }

  static clearSave() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* egal */
    }
  }

  connFor(seat: number): GameConn {
    return {
      seat,
      onView: (cb) => {
        this.listeners.set(seat, cb);
        cb(viewFor(this.state, seat));
      },
      send: (a) => this.act(seat, a),
      onError: (cb) => this.errorListeners.set(seat, cb),
    };
  }

  addListener(seat: number, cb: Listener, onError?: (m: string) => void) {
    this.listeners.set(seat, cb);
    if (onError) this.errorListeners.set(seat, onError);
    cb(viewFor(this.state, seat));
  }

  removeListener(seat: number) {
    this.listeners.delete(seat);
    this.errorListeners.delete(seat);
  }

  start() {
    this.stopped = false;
    this.broadcast();
    this.schedule();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Spieler wird zum Bot (z.B. Verbindungsabbruch) oder wieder Mensch. */
  setKind(seat: number, kind: PlayerInfo['kind']) {
    this.state.players[seat].kind = kind;
    this.state.version += 1;
    this.broadcast();
    this.schedule();
  }

  act(seat: number, a: Action): string | null {
    if (this.stopped) return 'Spiel beendet';
    const err = applyAction(this.state, seat, a);
    if (err) {
      this.errorListeners.get(seat)?.(err);
      return err;
    }
    this.broadcast();
    this.schedule();
    return null;
  }

  private broadcast() {
    for (const [seat, cb] of this.listeners) cb(viewFor(this.state, seat));
    if (this.persist) {
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(this.state));
      } catch {
        /* egal */
      }
    }
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.stopped) return;
    const s = this.state;
    if (s.phase === 'gameOver') {
      if (this.persist) HostController.clearSave();
      return;
    }
    if (s.phase === 'playing' && s.trickWinner >= 0) {
      this.timer = setTimeout(() => this.act(-1, { type: 'collect' }), 1300);
      return;
    }
    const bots = pendingSeats(s).filter((i) => s.players[i].kind === 'bot');
    if (!bots.length) return;
    const seat = bots[0];
    let delay = 650;
    if (s.phase === 'bidding') delay = 900;
    else if (s.phase === 'exchange') delay = 1500;
    else if (s.phase === 'melds') delay = seat === s.declarer ? 1800 : 150;
    else if (s.phase === 'roundEnd') delay = 150;
    else if (s.phase === 'playing') delay = s.trick.length === 0 ? 800 : 650;
    this.timer = setTimeout(() => {
      this.timer = null;
      const v = viewFor(this.state, seat);
      const a = decide(v, seat, this.state.players[seat].level);
      this.act(seat, a);
    }, delay);
  }
}
