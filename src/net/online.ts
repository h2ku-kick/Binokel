import Peer, { DataConnection } from 'peerjs';
import { Action, GameState, Level, PlayerInfo } from '../engine/game';
import { GameConn, HostController } from '../controller/host';
import { BOT_NAMES } from '../ui/phrases';

const PREFIX = 'binokel-schwaebisch-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeCode(): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export interface LobbyInfo {
  code: string;
  mode: 3 | 4;
  players: { name: string; seat: number; connected: boolean }[];
}

type Msg =
  | { t: 'hello'; name: string }
  | { t: 'lobby'; lobby: LobbyInfo }
  | { t: 'start'; seat: number }
  | { t: 'view'; view: GameState }
  | { t: 'action'; a: Action }
  | { t: 'error'; msg: string }
  | { t: 'full' }
  | { t: 'closed' };

function friendlyError(e: unknown): string {
  const type = (e as { type?: string })?.type;
  if (type === 'peer-unavailable') return 'Tisch nicht gefunden. Stimmt der Code?';
  if (type === 'unavailable-id') return 'Code schon vergeben, bitte nochmal versuchen.';
  if (type === 'network' || type === 'server-error' || type === 'socket-error')
    return 'Keine Verbindung zum Vermittlungsserver. Internet prüfen.';
  if (type === 'browser-incompatible') return 'Dieser Browser unterstützt kein Online-Spiel.';
  return 'Verbindungsfehler' + (type ? ` (${type})` : '');
}

// ---------------------------------------------------------------------------
// Gastgeber
// ---------------------------------------------------------------------------

export class OnlineHost {
  code = makeCode();
  mode: 3 | 4 = 3;
  level: Level = 'normal';
  private peer: Peer | null = null;
  private guests: { conn: DataConnection; name: string; seat: number }[] = [];
  host: HostController | null = null;
  onLobby: (l: LobbyInfo) => void = () => {};
  onError: (msg: string) => void = () => {};
  onToast: (msg: string) => void = () => {};

  constructor(private hostName: string) {}

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const peer = new Peer(PREFIX + this.code);
      this.peer = peer;
      let opened = false;
      peer.on('open', () => {
        opened = true;
        resolve();
        this.emitLobby();
      });
      peer.on('error', (e) => {
        const msg = friendlyError(e);
        if (!opened) reject(new Error(msg));
        else this.onError(msg);
      });
      peer.on('disconnected', () => {
        if (!this.peer?.destroyed) this.peer?.reconnect();
      });
      peer.on('connection', (conn) => this.handleConn(conn));
    });
  }

  private handleConn(conn: DataConnection) {
    conn.on('data', (raw) => {
      const msg = raw as Msg;
      if (msg.t === 'hello') this.handleHello(conn, msg.name);
      else if (msg.t === 'action') {
        const g = this.guests.find((x) => x.conn === conn);
        if (g && this.host) this.host.act(g.seat, msg.a);
      }
    });
    conn.on('close', () => this.handleClose(conn));
    conn.on('error', () => this.handleClose(conn));
  }

  private handleHello(conn: DataConnection, rawName: string) {
    const name = (rawName || 'Gast').slice(0, 16);
    if (this.host) {
      // Wiedereinstieg: Platz mit gleichem Namen, der gerade vom Bot gespielt wird
      const s = this.host.state;
      const seat = s.players.findIndex(
        (p, i) => i !== 0 && p.name === name && p.kind === 'bot' && !this.guests.some((g) => g.seat === i && g.conn.open),
      );
      const wasGuest = seat >= 0 && this.guestSeats.has(seat);
      if (!wasGuest) {
        conn.send({ t: 'full' } satisfies Msg);
        setTimeout(() => conn.close(), 500);
        return;
      }
      this.guests = this.guests.filter((g) => g.seat !== seat);
      this.guests.push({ conn, name, seat });
      conn.send({ t: 'start', seat } satisfies Msg);
      this.attachGuest(conn, seat);
      this.host.setKind(seat, 'remote');
      this.onToast(`${name} isch wieder do.`);
      return;
    }
    if (this.guests.length >= this.mode - 1) {
      conn.send({ t: 'full' } satisfies Msg);
      setTimeout(() => conn.close(), 500);
      return;
    }
    this.guests.push({ conn, name, seat: -1 });
    this.reseat();
    this.onToast(`${name} sitzt am Tisch.`);
    this.emitLobby();
  }

  private guestSeats = new Set<number>();

  private handleClose(conn: DataConnection) {
    const g = this.guests.find((x) => x.conn === conn);
    if (!g) return;
    if (this.host) {
      if (this.host.state.players[g.seat].kind === 'remote') {
        this.host.removeListener(g.seat);
        this.host.setKind(g.seat, 'bot');
        this.onToast(`${g.name} hot d'Verbindung verlore – a Bot spielt weiter.`);
      }
    } else {
      this.guests = this.guests.filter((x) => x !== g);
      this.reseat();
      this.onToast(`${g.name} isch gange.`);
      this.emitLobby();
    }
  }

  private reseat() {
    this.guests = this.guests.filter((g) => g.conn.open || g.seat === -1);
    this.guests.forEach((g, i) => (g.seat = i + 1));
  }

  setMode(mode: 3 | 4) {
    if (mode === 3 && this.guests.length > 2) {
      this.onError('Für 3 Spieler sitzen schon zu viele am Tisch.');
      return;
    }
    this.mode = mode;
    this.emitLobby();
  }

  lobby(): LobbyInfo {
    return {
      code: this.code,
      mode: this.mode,
      players: [
        { name: this.hostName, seat: 0, connected: true },
        ...this.guests.map((g) => ({ name: g.name, seat: g.seat, connected: g.conn.open })),
      ],
    };
  }

  private emitLobby() {
    const l = this.lobby();
    this.onLobby(l);
    for (const g of this.guests) if (g.conn.open) g.conn.send({ t: 'lobby', lobby: l } satisfies Msg);
  }

  /** Startet das Spiel; freie Plätze übernehmen Bots. Gibt die Verbindung für den Gastgeber zurück. */
  startGame(): GameConn {
    const players: PlayerInfo[] = [];
    const used = new Set<string>([this.hostName]);
    const names = BOT_NAMES.filter((n) => !used.has(n));
    for (let seat = 0; seat < this.mode; seat++) {
      if (seat === 0) players.push({ name: this.hostName, kind: 'local', level: this.level });
      else {
        const g = this.guests.find((x) => x.seat === seat);
        if (g) players.push({ name: g.name, kind: 'remote', level: this.level });
        else players.push({ name: names.shift() ?? `Bot ${seat}`, kind: 'bot', level: this.level });
      }
    }
    this.host = HostController.create(this.mode, players);
    for (const g of this.guests) {
      this.guestSeats.add(g.seat);
      g.conn.send({ t: 'start', seat: g.seat } satisfies Msg);
      this.attachGuest(g.conn, g.seat);
    }
    this.host.start();
    return this.host.connFor(0);
  }

  private attachGuest(conn: DataConnection, seat: number) {
    this.host!.addListener(
      seat,
      (view) => {
        if (conn.open) conn.send({ t: 'view', view } satisfies Msg);
      },
      (msg) => {
        if (conn.open) conn.send({ t: 'error', msg } satisfies Msg);
      },
    );
  }

  /** Nach Spielende: neue Partie mit denselben Leuten. */
  restart(): GameConn {
    this.host?.stop();
    this.host = null;
    this.guests = this.guests.filter((g) => g.conn.open);
    this.guestSeats.clear();
    return this.startGame();
  }

  close() {
    for (const g of this.guests) {
      try {
        if (g.conn.open) g.conn.send({ t: 'closed' } satisfies Msg);
      } catch {
        /* egal */
      }
    }
    this.host?.stop();
    setTimeout(() => this.peer?.destroy(), 300);
  }
}

// ---------------------------------------------------------------------------
// Gast
// ---------------------------------------------------------------------------

export class OnlineGuest {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  seat = -1;
  private viewCb: ((v: GameState) => void) | null = null;
  private errorCb: ((m: string) => void) | null = null;
  private lastView: GameState | null = null;
  onLobby: (l: LobbyInfo) => void = () => {};
  onStart: (conn: GameConn) => void = () => {};
  onError: (msg: string) => void = () => {};
  onClosed: (msg: string) => void = () => {};

  constructor(
    private name: string,
    public code: string,
  ) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const peer = new Peer();
      this.peer = peer;
      let done = false;
      const fail = (msg: string) => {
        if (!done) {
          done = true;
          reject(new Error(msg));
        } else this.onError(msg);
      };
      const timeout = setTimeout(() => fail('Zeitüberschreitung – Tisch nicht erreichbar.'), 15000);
      peer.on('error', (e) => fail(friendlyError(e)));
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + this.code.toUpperCase(), { reliable: true });
        this.conn = conn;
        conn.on('open', () => {
          clearTimeout(timeout);
          done = true;
          conn.send({ t: 'hello', name: this.name } satisfies Msg);
          resolve();
        });
        conn.on('data', (raw) => this.handle(raw as Msg));
        conn.on('close', () => this.onClosed('Verbindung zum Tisch getrennt.'));
        conn.on('error', () => this.onClosed('Verbindung zum Tisch getrennt.'));
      });
    });
  }

  private handle(msg: Msg) {
    switch (msg.t) {
      case 'lobby':
        this.onLobby(msg.lobby);
        break;
      case 'start':
        this.seat = msg.seat;
        this.lastView = null;
        this.onStart(this.gameConn());
        break;
      case 'view':
        this.lastView = msg.view;
        this.viewCb?.(msg.view);
        break;
      case 'error':
        this.errorCb?.(msg.msg);
        break;
      case 'full':
        this.onClosed('Der Tisch ist voll oder das Spiel läuft schon.');
        break;
      case 'closed':
        this.onClosed('Der Gastgeber hat den Tisch geschlossen.');
        break;
    }
  }

  private gameConn(): GameConn {
    return {
      seat: this.seat,
      onView: (cb) => {
        this.viewCb = cb;
        if (this.lastView) cb(this.lastView);
      },
      send: (a) => this.conn?.send({ t: 'action', a } satisfies Msg),
      onError: (cb) => (this.errorCb = cb),
    };
  }

  close() {
    this.conn?.close();
    setTimeout(() => this.peer?.destroy(), 300);
  }
}
