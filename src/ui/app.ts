import { Level, PlayerInfo } from '../engine/game';
import { GameConn, HostController } from '../controller/host';
import type { LobbyInfo, OnlineGuest, OnlineHost } from '../net/online';
import { suitSvg } from './cardsvg';
import { BOT_NAMES } from './phrases';
import { RULES_HTML } from './rules';
import { TableView } from './table';
import { esc, load, save } from './util';

interface Settings {
  name: string;
  mode: 3 | 4;
  level: Level;
}

const SETTINGS_KEY = 'binokel-settings';

export class App {
  private settings: Settings = load<Settings>(SETTINGS_KEY, { name: '', mode: 3, level: 'normal' });
  private table: TableView | null = null;
  private host: HostController | null = null;
  private onlineHost: OnlineHost | null = null;
  private guest: OnlineGuest | null = null;
  private rulesOpen = false;

  constructor(private root: HTMLElement) {
    const params = new URLSearchParams(location.search);
    const join = params.get('join');
    if (join) {
      params.delete('join');
      const rest = params.toString();
      history.replaceState(null, '', location.pathname + (rest ? '?' + rest : ''));
      this.showMenu(join.toUpperCase());
    } else this.showMenu();
  }

  private saveSettings() {
    save(SETTINGS_KEY, this.settings);
  }

  private playerName(): string {
    return this.settings.name.trim() || 'Du';
  }

  private cleanup() {
    this.table?.destroy();
    this.table = null;
    this.host?.stop();
    this.host = null;
    this.onlineHost?.close();
    this.onlineHost = null;
    this.guest?.close();
    this.guest = null;
  }

  // -------------------------------------------------------------------------
  // Hauptmenü
  // -------------------------------------------------------------------------

  showMenu(joinCode = '') {
    this.cleanup();
    const s = this.settings;
    const seg = (name: string, value: string, options: [string, string][]) =>
      `<div class="seg" data-seg="${name}">${options
        .map(([v, l]) => `<button class="${v === value ? 'on' : ''}" data-v="${v}">${l}</button>`)
        .join('')}</div>`;
    this.root.innerHTML = `
      <div class="screen menu">
        <div class="logo">
          <div class="logo-suits">${(['E', 'L', 'H', 'S'] as const).map((x) => suitSvg(x)).join('')}</div>
          <h1>Binokel</h1>
          <p class="tagline">Schwäbisch. Modern. Am Tisch.</p>
        </div>

        <label class="field">
          <span>Dein Name</span>
          <input id="name" maxlength="16" placeholder="z.B. Karle" value="${esc(s.name)}" autocomplete="off">
        </label>

        <section class="card-box">
          <h2>Gega dr Computer</h2>
          ${seg('mode', String(s.mode), [['3', '3 Spieler'], ['4', 'Kreuzbinokel (4)']])}
          ${seg('level', s.level, [['normal', 'Normal'], ['hard', 'Schwer']])}
          ${HostController.hasSave() ? '<button class="btn secondary wide" id="resume">Weiterspiela</button>' : ''}
          <button class="btn primary wide" id="offline">Neues Spiel</button>
        </section>

        <section class="card-box">
          <h2>Online mit Freind</h2>
          ${this.lastTable() ? `<button class="btn primary wide" id="rejoin">Zurück an Tisch ${esc(this.lastTable()!)}</button>` : ''}
          <button class="btn secondary wide" id="create">Tisch aufmacha</button>
          <div class="join-row">
            <input id="code" maxlength="4" placeholder="CODE" value="${esc(joinCode)}" autocomplete="off" autocapitalize="characters">
            <button class="btn primary" id="join">Beitreta</button>
          </div>
        </section>

        <button class="link" id="rules">Spielregeln</button>
      </div>
      ${this.rulesOverlay()}`;

    const nameInput = this.root.querySelector<HTMLInputElement>('#name')!;
    nameInput.addEventListener('input', () => {
      this.settings.name = nameInput.value;
      this.saveSettings();
    });
    this.root.querySelectorAll<HTMLElement>('.seg').forEach((segEl) =>
      segEl.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
        b.addEventListener('click', () => {
          const key = segEl.dataset.seg!;
          if (key === 'mode') this.settings.mode = Number(b.dataset.v) as 3 | 4;
          if (key === 'level') this.settings.level = b.dataset.v as Level;
          this.saveSettings();
          segEl.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        }),
      ),
    );
    this.root.querySelector('#offline')!.addEventListener('click', () => this.startOffline());
    this.root.querySelector('#resume')?.addEventListener('click', () => this.resumeOffline());
    this.root.querySelector('#create')!.addEventListener('click', () => this.createTable());
    this.root.querySelector('#rejoin')?.addEventListener('click', () => this.joinTable(this.lastTable()!));
    this.root.querySelector('#join')!.addEventListener('click', () => {
      const code = this.root.querySelector<HTMLInputElement>('#code')!.value.trim().toUpperCase();
      if (code.length !== 4) {
        alert('Bitte den 4-stelligen Code eingeben.');
        return;
      }
      this.joinTable(code);
    });
    this.root.querySelector('#rules')!.addEventListener('click', () => this.toggleRules(true));
    this.bindRules();
  }

  private rulesOverlay(): string {
    return `<div class="rules-overlay ${this.rulesOpen ? 'open' : ''}">
      <div class="rules-sheet">
        <button class="icon-btn close-rules" aria-label="Schließen">✕</button>
        ${RULES_HTML}
      </div>
    </div>`;
  }

  private bindRules() {
    this.root.querySelector('.close-rules')?.addEventListener('click', () => this.toggleRules(false));
    this.root.querySelector('.rules-overlay')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('rules-overlay')) this.toggleRules(false);
    });
  }

  private toggleRules(open: boolean) {
    this.rulesOpen = open;
    let el = this.root.querySelector('.rules-overlay');
    if (!el) {
      this.root.insertAdjacentHTML('beforeend', this.rulesOverlay());
      this.bindRules();
      el = this.root.querySelector('.rules-overlay');
    }
    el!.classList.toggle('open', open);
  }

  // -------------------------------------------------------------------------
  // Offline
  // -------------------------------------------------------------------------

  private startOffline() {
    const { mode, level } = this.settings;
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5).filter((n) => n !== this.playerName());
    const players: PlayerInfo[] = [{ name: this.playerName(), kind: 'local', level }];
    for (let i = 1; i < mode; i++) players.push({ name: names[i - 1], kind: 'bot', level });
    this.cleanup();
    this.host = HostController.create(mode, players);
    this.host.persist = true;
    this.openTable(this.host.connFor(0), {
      online: false,
      onRestart: () => this.startOffline(),
    });
    this.host.start();
  }

  private resumeOffline() {
    const h = HostController.loadSaved();
    if (!h) return this.startOffline();
    this.cleanup();
    this.host = h;
    this.openTable(h.connFor(0), { online: false, onRestart: () => this.startOffline() });
    h.start();
  }

  private openTable(conn: GameConn, o: { online: boolean; onRestart?: () => void }) {
    this.table?.destroy();
    this.root.innerHTML = `<div class="screen game"></div>${this.rulesOverlay()}`;
    this.bindRules();
    this.table = new TableView(this.root.querySelector('.game')!, conn, {
      online: o.online,
      onRestart: o.onRestart,
      onExit: () => {
        if (o.online && !confirm('Tisch wirklich verlassen?')) return;
        this.showMenu();
      },
      showRules: () => this.toggleRules(true),
    });
  }

  // -------------------------------------------------------------------------
  // Online
  // -------------------------------------------------------------------------

  private async createTable() {
    this.cleanup();
    this.renderConnecting('Tisch wird aufgmacht…');
    const { OnlineHost } = await import('../net/online');
    for (let attempt = 0; attempt < 1; attempt++) {
      const oh = new OnlineHost(this.playerName());
      oh.mode = this.settings.mode;
      oh.level = this.settings.level;
      this.onlineHost = oh;
      oh.onLobby = (l) => this.renderHostLobby(l);
      oh.onToast = (m) => this.table?.toast(m);
      oh.onError = (m) => (this.table ? this.table.toast(m) : alert(m));
      try {
        await oh.open();
        return;
      } catch (e) {
        oh.close();
        this.onlineHost = null;
        this.renderError((e as Error).message);
        return;
      }
    }
  }

  private renderConnecting(msg: string) {
    this.root.innerHTML = `<div class="screen center"><div class="spinner"></div><p>${esc(msg)}</p>
      <button class="btn ghost" id="back">Abbrecha</button></div>`;
    this.root.querySelector('#back')!.addEventListener('click', () => this.showMenu());
  }

  private renderError(msg: string) {
    this.root.innerHTML = `<div class="screen center"><div class="big-emoji">😕</div><p>${esc(msg)}</p>
      <button class="btn primary" id="back">Zurück</button></div>`;
    this.root.querySelector('#back')!.addEventListener('click', () => this.showMenu());
  }

  private inviteLink(code: string): string {
    return `${location.origin}${location.pathname}?join=${code}`;
  }

  private seatList(l: LobbyInfo, botLabel: string): string {
    const rows = [];
    for (let seat = 0; seat < l.mode; seat++) {
      const p = l.players.find((x) => x.seat === seat);
      const partner = l.mode === 4 ? (seat % 2 === 0 ? 'Team A' : 'Team B') : '';
      rows.push(`<div class="lobby-seat ${p ? '' : 'empty'}">
        <span class="seat-no">${seat + 1}</span>
        <span class="seat-who">${p ? esc(p.name) + (seat === 0 ? ' <small>(Gastgeber)</small>' : '') : botLabel}</span>
        ${partner ? `<span class="badge">${partner}</span>` : ''}
      </div>`);
    }
    return rows.join('');
  }

  private renderHostLobby(l: LobbyInfo) {
    if (this.table) return;
    const oh = this.onlineHost!;
    const link = this.inviteLink(l.code);
    this.root.innerHTML = `
      <div class="screen lobby">
        <h2>Dei Tisch</h2>
        <div class="code-box"><small>Code</small><div class="code">${l.code}</div></div>
        <button class="btn secondary wide" id="share">Freind eilada</button>
        <div class="seg" data-seg="mode">
          <button class="${l.mode === 3 ? 'on' : ''}" data-v="3">3 Spieler</button>
          <button class="${l.mode === 4 ? 'on' : ''}" data-v="4">Kreuzbinokel (4)</button>
        </div>
        <div class="seg" data-seg="level">
          <button class="${oh.level === 'normal' ? 'on' : ''}" data-v="normal">Bots: Normal</button>
          <button class="${oh.level === 'hard' ? 'on' : ''}" data-v="hard">Bots: Schwer</button>
        </div>
        <div class="lobby-seats">${this.seatList(l, '<span class="muted">frei – spielt a Bot</span>')}</div>
        <button class="btn primary wide" id="start">Spiel starta</button>
        <button class="btn ghost wide" id="back">Tisch schließa</button>
      </div>`;
    this.root.querySelector('#share')!.addEventListener('click', async () => {
      const text = `Komm zum Binokel! Code: ${l.code}`;
      try {
        if (navigator.share) await navigator.share({ title: 'Binokel', text, url: link });
        else {
          await navigator.clipboard.writeText(`${text}\n${link}`);
          alert('Link kopiert!');
        }
      } catch {
        /* abgebrochen */
      }
    });
    this.root.querySelectorAll<HTMLElement>('[data-seg="mode"] button').forEach((b) =>
      b.addEventListener('click', () => oh.setMode(Number(b.dataset.v) as 3 | 4)),
    );
    this.root.querySelectorAll<HTMLElement>('[data-seg="level"] button').forEach((b) =>
      b.addEventListener('click', () => {
        oh.level = b.dataset.v as Level;
        this.renderHostLobby(oh.lobby());
      }),
    );
    this.root.querySelector('#start')!.addEventListener('click', () => {
      this.openTable(oh.startGame(), this.hostTableOpts(oh));
    });
    this.root.querySelector('#back')!.addEventListener('click', () => this.showMenu());
  }

  private hostTableOpts(oh: OnlineHost) {
    return {
      online: true,
      onRestart: () => {
        const c = oh.restart();
        this.openTable(c, this.hostTableOpts(oh));
      },
    };
  }

  private async joinTable(code: string) {
    this.cleanup();
    this.renderConnecting(`Verbinde mit Tisch ${code}…`);
    const { OnlineGuest } = await import('../net/online');
    const g = new OnlineGuest(this.playerName(), code);
    this.guest = g;
    g.onLobby = (l) => this.renderGuestLobby(l);
    g.onStart = (conn) => this.openTable(conn, { online: true });
    g.onError = (m) => this.table?.toast(m);
    g.onClosed = (m) => {
      if (this.guest !== g) return;
      this.guest = null;
      this.cleanup();
      this.renderError(m);
    };
    try {
      await g.connect();
      save('binokel-last-table', { code, time: Date.now() });
    } catch (e) {
      if (this.guest === g) {
        g.close();
        this.guest = null;
        this.renderError((e as Error).message);
      }
    }
  }

  /** Zuletzt besuchter Tisch (für schnellen Wiedereinstieg, 3 Stunden gültig). */
  private lastTable(): string | null {
    const t = load<{ code: string; time: number }>('binokel-last-table', { code: '', time: 0 });
    return t.code && Date.now() - t.time < 3 * 3600 * 1000 ? t.code : null;
  }

  private renderGuestLobby(l: LobbyInfo) {
    if (this.table) return;
    this.root.innerHTML = `
      <div class="screen lobby">
        <h2>Tisch ${l.code}</h2>
        <p class="muted">${l.mode === 4 ? 'Kreuzbinokel (4 Spieler)' : '3 Spieler'}</p>
        <div class="lobby-seats">${this.seatList(l, '<span class="muted">frei</span>')}</div>
        <div class="waiting"><div class="spinner small"></div> Warte bis dr Gastgeber startet…</div>
        <button class="btn ghost wide" id="back">Verlassa</button>
      </div>`;
    this.root.querySelector('#back')!.addEventListener('click', () => this.showMenu());
  }
}
