import mqtt, { MqttClient } from 'mqtt';
import { Action, GameState, Level, PlayerInfo } from '../engine/game';
import { GameConn, HostController } from '../controller/host';
import { BOT_NAMES } from '../ui/phrases';

/*
 * Online-Modus über einen öffentlichen MQTT-Server (WebSocket).
 * Alle Nachrichten laufen über den Server – das funktioniert in jedem Netz
 * (Mobilfunk, WLAN), und wer kurz die App verlässt, kommt automatisch wieder rein.
 *
 * Themen:  binokel-sw/v2/<CODE>/lobby        (Gastgeber → alle, retained)
 *          binokel-sw/v2/<CODE>/up           (Gäste → Gastgeber)
 *          binokel-sw/v2/<CODE>/to/<clientId> (Gastgeber → ein Gast)
 */

const DEFAULT_BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt'];
const ROOT = 'binokel-sw/v2/';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PING_MS = 4000;
const GUEST_TIMEOUT_MS = 15000;

function brokers(): string[] {
  // Für Tests: ?broker=ws://localhost:8888
  const b = new URLSearchParams(location.search).get('broker');
  return b ? [b] : DEFAULT_BROKERS;
}

export function makeCode(): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** Dauerhafte Geräte-ID, damit man nach einem Abbruch wieder auf seinen Platz kommt. */
function clientId(): string {
  try {
    let id = localStorage.getItem('binokel-client-id');
    if (!id) {
      id = randomId();
      localStorage.setItem('binokel-client-id', id);
    }
    return id;
  } catch {
    return randomId();
  }
}

export interface LobbyInfo {
  code: string;
  mode: 3 | 4;
  players: { name: string; seat: number; connected: boolean }[];
  started: boolean;
  closed?: boolean;
}

type Up =
  | { t: 'hello'; id: string; name: string }
  | { t: 'ping'; id: string; name: string }
  | { t: 'action'; id: string; a: Action }
  | { t: 'bye'; id: string };

type Down =
  | { t: 'start'; seat: number }
  | { t: 'view'; view: GameState }
  | { t: 'error'; msg: string }
  | { t: 'full' }
  | { t: 'pong' };

/** Verbindet sich mit dem ersten erreichbaren Server. */
function connectTo(url: string, timeoutMs = 7000): Promise<MqttClient> {
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(url, {
      clientId: 'binokel_' + randomId(),
      keepalive: 30,
      reconnectPeriod: 1500,
      connectTimeout: timeoutMs,
      clean: true,
    });
    const timer = setTimeout(() => {
      client.end(true);
      reject(new Error('timeout'));
    }, timeoutMs);
    client.once('connect', () => {
      clearTimeout(timer);
      resolve(client);
    });
  });
}

function watchVisibility(client: MqttClient, onVisible?: () => void): () => void {
  const handler = () => {
    if (document.visibilityState !== 'visible') return;
    if (!client.connected && !client.disconnecting) client.reconnect();
    onVisible?.();
  };
  document.addEventListener('visibilitychange', handler);
  window.addEventListener('online', handler);
  return () => {
    document.removeEventListener('visibilitychange', handler);
    window.removeEventListener('online', handler);
  };
}

const enc = (o: unknown) => JSON.stringify(o);
function dec<T>(buf: Uint8Array | string): T | null {
  try {
    const s = typeof buf === 'string' ? buf : new TextDecoder().decode(buf);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Gastgeber
// ---------------------------------------------------------------------------

interface Guest {
  id: string;
  name: string;
  seat: number;
  lastSeen: number;
  connected: boolean;
}

export class OnlineHost {
  code = makeCode();
  mode: 3 | 4 = 3;
  level: Level = 'normal';
  private client: MqttClient | null = null;
  private guests: Guest[] = [];
  host: HostController | null = null;
  private lastViews = new Map<number, GameState>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private unwatch: (() => void) | null = null;
  onLobby: (l: LobbyInfo) => void = () => {};
  onError: (msg: string) => void = () => {};
  onToast: (msg: string) => void = () => {};

  constructor(private hostName: string) {}

  private topic(s: string) {
    return ROOT + this.code + '/' + s;
  }

  async open(): Promise<void> {
    let lastErr: unknown = null;
    for (const url of brokers()) {
      try {
        this.client = await connectTo(url);
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!this.client) {
      console.warn(lastErr);
      throw new Error('Keine Verbindung zum Spielserver. Bitte Internet prüfen.');
    }
    const c = this.client;
    c.on('message', (_t, payload) => {
      const m = dec<Up>(payload);
      if (m) this.handle(m);
    });
    c.on('connect', () => {
      // nach Wiederverbindung: Lobby erneut veröffentlichen
      this.publishLobby();
    });
    await c.subscribeAsync(this.topic('up'), { qos: 1 });
    this.publishLobby();
    this.timer = setInterval(() => this.checkGuests(), 2000);
    this.unwatch = watchVisibility(c);
  }

  private send(id: string, m: Down) {
    this.client?.publish(this.topic('to/' + id), enc(m), { qos: 1 });
  }

  private handle(m: Up) {
    const now = Date.now();
    let g = this.guests.find((x) => x.id === m.id);
    // Ein Ping von einem Unbekannten zählt als Anmeldung (falls das Hallo verloren ging)
    if (m.t === 'hello' || (m.t === 'ping' && !g)) {
      const name = (m.name || 'Gast').slice(0, 16);
      if (g) {
        g.name = this.host ? g.name : name;
        g.lastSeen = now;
        this.markConnected(g);
        if (this.host && g.seat > 0) {
          this.send(g.id, { t: 'start', seat: g.seat });
          const v = this.lastViews.get(g.seat);
          if (v) this.send(g.id, { t: 'view', view: v });
        }
        this.publishLobby();
        return;
      }
      if (this.host || this.guests.length >= this.mode - 1) {
        this.send(m.id, { t: 'full' });
        return;
      }
      g = { id: m.id, name, seat: -1, lastSeen: now, connected: true };
      this.guests.push(g);
      this.reseat();
      this.onToast(`${name} sitzt am Tisch.`);
      this.publishLobby();
      return;
    }
    if (!g) return;
    g.lastSeen = now;
    if (!g.connected) this.markConnected(g);
    if (m.t === 'ping') this.send(g.id, { t: 'pong' });
    else if (m.t === 'action' && this.host && g.seat > 0) this.host.act(g.seat, m.a);
    else if (m.t === 'bye') {
      g.lastSeen = 0;
      this.checkGuests();
    }
  }

  private markConnected(g: Guest) {
    const was = g.connected;
    g.connected = true;
    if (this.host && g.seat > 0 && this.host.state.players[g.seat].kind === 'bot') {
      this.host.setKind(g.seat, 'remote');
      if (!was) this.onToast(`${g.name} isch wieder do.`);
    }
  }

  private checkGuests() {
    const now = Date.now();
    let changed = false;
    for (const g of [...this.guests]) {
      if (!g.connected || now - g.lastSeen < GUEST_TIMEOUT_MS) continue;
      g.connected = false;
      changed = true;
      if (this.host) {
        if (g.seat > 0 && this.host.state.players[g.seat].kind === 'remote') {
          this.host.setKind(g.seat, 'bot');
          this.onToast(`${g.name} hot d'Verbindung verlore – a Bot spielt weiter.`);
        }
      } else {
        this.guests = this.guests.filter((x) => x !== g);
        this.reseat();
        this.onToast(`${g.name} isch gange.`);
      }
    }
    if (changed) this.publishLobby();
  }

  private reseat() {
    this.guests.forEach((g, i) => (g.seat = i + 1));
  }

  setMode(mode: 3 | 4) {
    if (mode === 3 && this.guests.length > 2) {
      this.onError('Für 3 Spieler sitzen schon zu viele am Tisch.');
      return;
    }
    this.mode = mode;
    this.publishLobby();
  }

  lobby(): LobbyInfo {
    return {
      code: this.code,
      mode: this.mode,
      started: !!this.host,
      players: [
        { name: this.hostName, seat: 0, connected: true },
        ...this.guests.map((g) => ({ name: g.name, seat: g.seat, connected: g.connected })),
      ],
    };
  }

  private publishLobby() {
    const l = this.lobby();
    this.onLobby(l);
    this.client?.publish(this.topic('lobby'), enc(l), { qos: 1, retain: true });
  }

  /** Startet das Spiel; freie Plätze übernehmen Bots. Gibt die Verbindung für den Gastgeber zurück. */
  startGame(): GameConn {
    const players: PlayerInfo[] = [];
    const names = BOT_NAMES.filter((n) => n !== this.hostName && !this.guests.some((g) => g.name === n));
    for (let seat = 0; seat < this.mode; seat++) {
      if (seat === 0) players.push({ name: this.hostName, kind: 'local', level: this.level });
      else {
        const g = this.guests.find((x) => x.seat === seat);
        if (g) players.push({ name: g.name, kind: g.connected ? 'remote' : 'bot', level: this.level });
        else players.push({ name: names.shift() ?? `Bot ${seat}`, kind: 'bot', level: this.level });
      }
    }
    this.host = HostController.create(this.mode, players);
    this.lastViews.clear();
    for (const g of this.guests) {
      this.send(g.id, { t: 'start', seat: g.seat });
      const id = g.id;
      const seat = g.seat;
      this.host.addListener(
        seat,
        (view) => {
          this.lastViews.set(seat, view);
          this.send(id, { t: 'view', view });
        },
        (msg) => this.send(id, { t: 'error', msg }),
      );
    }
    this.host.start();
    this.publishLobby();
    return this.host.connFor(0);
  }

  /** Nach Spielende: neue Partie mit denselben Leuten. */
  restart(): GameConn {
    this.host?.stop();
    this.host = null;
    this.guests = this.guests.filter((g) => g.connected);
    this.reseat();
    return this.startGame();
  }

  close() {
    this.host?.stop();
    if (this.timer) clearInterval(this.timer);
    this.unwatch?.();
    const c = this.client;
    if (!c) return;
    // Lobby als geschlossen markieren und Retain löschen
    const closed: LobbyInfo = { ...this.lobby(), closed: true };
    c.publish(this.topic('lobby'), enc(closed), { qos: 1 }, () => {
      c.publish(this.topic('lobby'), '', { qos: 1, retain: true }, () => c.end());
    });
    setTimeout(() => c.end(true), 2000);
  }
}

// ---------------------------------------------------------------------------
// Gast
// ---------------------------------------------------------------------------

export class OnlineGuest {
  private client: MqttClient | null = null;
  private id = clientId();
  seat = -1;
  private viewCb: ((v: GameState) => void) | null = null;
  private errorCb: ((m: string) => void) | null = null;
  private lastView: GameState | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private unwatch: (() => void) | null = null;
  private closed = false;
  onLobby: (l: LobbyInfo) => void = () => {};
  onStart: (conn: GameConn) => void = () => {};
  onError: (msg: string) => void = () => {};
  onClosed: (msg: string) => void = () => {};

  constructor(
    private name: string,
    public code: string,
  ) {
    this.code = code.toUpperCase();
  }

  private topic(s: string) {
    return ROOT + this.code + '/' + s;
  }

  /** Sucht den Tisch auf den bekannten Servern. */
  async connect(): Promise<void> {
    for (const url of brokers()) {
      let c: MqttClient;
      try {
        c = await connectTo(url);
      } catch {
        continue;
      }
      const lobby = await this.waitForLobby(c, 5000);
      if (lobby && !lobby.closed) {
        this.client = c;
        this.attach(c);
        this.onLobby(lobby);
        return;
      }
      c.end(true);
    }
    throw new Error(`Tisch ${this.code} nicht gefunden. Stimmt der Code und ist der Gastgeber noch in der Lobby?`);
  }

  private waitForLobby(c: MqttClient, ms: number): Promise<LobbyInfo | null> {
    return new Promise((resolve) => {
      const t = this.topic('lobby');
      const done = (l: LobbyInfo | null) => {
        clearTimeout(timer);
        c.removeListener('message', onMsg);
        resolve(l);
      };
      const onMsg = (topic: string, payload: Uint8Array) => {
        if (topic !== t) return;
        const l = dec<LobbyInfo>(payload);
        if (l) done(l);
      };
      const timer = setTimeout(() => done(null), ms);
      c.on('message', onMsg);
      c.subscribe(t, { qos: 1 });
    });
  }

  private attach(c: MqttClient) {
    const lobbyTopic = this.topic('lobby');
    const myTopic = this.topic('to/' + this.id);
    c.on('message', (topic, payload) => {
      if (topic === lobbyTopic) {
        const l = dec<LobbyInfo>(payload);
        if (!l) return;
        if (l.closed) this.finish('Der Gastgeber hat den Tisch geschlossen.');
        else this.onLobby(l);
      } else if (topic === myTopic) {
        const m = dec<Down>(payload);
        if (m) this.handle(m);
      }
    });
    c.subscribe(myTopic, { qos: 1 }, () => this.hello());
    c.on('connect', () => this.hello()); // nach Wiederverbindung neu melden
    this.pingTimer = setInterval(() => this.up({ t: 'ping', id: this.id, name: this.name }), PING_MS);
    this.unwatch = watchVisibility(c, () => this.hello());
  }

  private hello() {
    this.up({ t: 'hello', id: this.id, name: this.name });
  }

  private up(m: Up) {
    if (this.client?.connected) this.client.publish(this.topic('up'), enc(m), { qos: 1 });
  }

  private handle(m: Down) {
    switch (m.t) {
      case 'start':
        if (this.seat !== m.seat || !this.viewCb) {
          this.seat = m.seat;
          this.lastView = null;
          this.viewCb = null;
          this.onStart(this.gameConn());
        }
        break;
      case 'view':
        this.lastView = m.view;
        this.viewCb?.(m.view);
        break;
      case 'error':
        this.errorCb?.(m.msg);
        break;
      case 'full':
        this.finish('Der Tisch ist voll oder das Spiel läuft schon.');
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
      send: (a) => this.up({ t: 'action', id: this.id, a }),
      onError: (cb) => (this.errorCb = cb),
    };
  }

  private finish(msg: string) {
    if (this.closed) return;
    this.close();
    this.onClosed(msg);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.unwatch?.();
    const c = this.client;
    if (c) {
      if (c.connected) c.publish(this.topic('up'), enc({ t: 'bye', id: this.id }), { qos: 0 });
      setTimeout(() => c.end(true), 300);
    }
  }
}
