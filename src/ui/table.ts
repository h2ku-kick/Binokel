import { Card, CARD_POINTS, Suit, SUITS, SUIT_NAME } from '../engine/cards';
import { findMelds, meldTotal } from '../engine/melds';
import { GameState, legalFor, minNextBid, partyCount, partyOf, partySeats } from '../engine/game';
import { winningIndex } from '../engine/rules';
import { GameConn } from '../controller/host';
import { cardBackHtml, cardFaceHtml, miniCardHtml, suitSvg } from './cardsvg';
import { callPhrase, losePhrase, madePhrase, trumpPhrase, winPhrase } from './phrases';
import { esc } from './util';

interface Target {
  key: string;
  card: Card | null; // null = Rückseite
  x: number;
  y: number;
  rot: number;
  z: number;
  scale?: number;
  cls?: string;
  from?: { x: number; y: number }; // Startpunkt für neue Karten
  delay?: number;
  onTap?: () => void;
}

export interface TableOptions {
  onExit: () => void;
  onRestart?: () => void; // nur wer neu starten darf
  showRules: () => void;
  online: boolean;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export class TableView {
  private el: HTMLElement;
  private layer: HTMLElement;
  private hud: HTMLElement;
  private panel: HTMLElement;
  private modal: HTMLElement;
  private toastEl: HTMLElement;
  private v: GameState | null = null;
  private prev: GameState | null = null;
  private cardEls = new Map<string, HTMLElement>();
  private selected = new Set<string>(); // Drücken
  private armed: string | null = null; // Karte zum Spielen angetippt
  private bidValue = 0;
  private exTrump: Suit | null = null;
  private showLastTrick = false;
  private menuOpen = false;
  private resizeObs: ResizeObserver;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private seat: number;

  constructor(
    private root: HTMLElement,
    private conn: GameConn,
    private opts: TableOptions,
  ) {
    this.seat = conn.seat;
    root.innerHTML = `
      <div class="table">
        <div class="felt"><div class="felt-ring"></div></div>
        <div class="hud"></div>
        <div class="cards-layer"></div>
        <div class="panel"></div>
        <div class="modal-layer"></div>
        <div class="toast"></div>
      </div>`;
    this.el = root.querySelector('.table')!;
    this.layer = root.querySelector('.cards-layer')!;
    this.hud = root.querySelector('.hud')!;
    this.panel = root.querySelector('.panel')!;
    this.modal = root.querySelector('.modal-layer')!;
    this.toastEl = root.querySelector('.toast')!;
    this.resizeObs = new ResizeObserver(() => this.render(false));
    this.resizeObs.observe(this.el);
    conn.onError?.((m) => this.toast(m));
    conn.onView((v) => this.update(v));
  }

  destroy() {
    this.resizeObs.disconnect();
    this.root.innerHTML = '';
  }

  toast(msg: string) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), 2600);
  }

  private update(v: GameState) {
    this.prev = this.v;
    this.v = v;
    const p = this.prev;
    if (!p || p.phase !== v.phase || p.round !== v.round) {
      this.selected.clear();
      this.armed = null;
      this.exTrump = null;
    }
    if (v.phase === 'bidding' && (!p || p.bid !== v.bid || p.phase !== 'bidding' || p.turn !== v.turn)) {
      this.bidValue = minNextBid(v);
    }
    if (v.phase === 'playing' && p?.phase === 'melds' && v.trump) this.toast(trumpPhrase(v.trump));
    if (this.armed && !v.hands[this.seat].some((c) => c.id === this.armed)) this.armed = null;
    this.render(true);
  }

  private rel(seat: number): number {
    const n = this.v!.mode;
    return (seat - this.seat + n) % n;
  }

  private name(seat: number): string {
    return seat === this.seat ? 'Du' : this.v!.players[seat].name;
  }

  private partyName(party: number): string {
    const v = this.v!;
    if (v.mode === 4) {
      const mine = partyOf(v, this.seat) === party;
      const seats = partySeats(v, party).map((s) => (s === this.seat ? 'Du' : v.players[s].name));
      return (mine ? 'Ihr' : 'Die') + ` (${seats.join(' & ')})`;
    }
    return this.name(party);
  }

  // -------------------------------------------------------------------------
  // Geometrie
  // -------------------------------------------------------------------------

  private geo() {
    const W = this.el.clientWidth;
    const H = this.el.clientHeight;
    const land = W > H * 1.15;
    const cw = land
      ? Math.round(Math.max(46, Math.min(112, H * 0.2, W / 9.5)))
      : Math.round(Math.max(50, Math.min(104, W / 6, H / 6.4)));
    const ch = Math.round(cw * 1.55);
    return { W, H, cw, ch, cx: W / 2, cy: land ? H * 0.37 : H * 0.43, land };
  }

  private seatAnchor(rel: number): { x: number; y: number } {
    const { W, H, ch } = this.geo();
    if (rel === 0) return { x: W / 2, y: H + ch };
    const elx = this.hud.querySelector<HTMLElement>(`.seat[data-rel="${rel}"] .avatar`);
    if (elx) {
      const r = elx.getBoundingClientRect();
      const t = this.el.getBoundingClientRect();
      return { x: r.left - t.left + r.width / 2, y: r.top - t.top + r.height / 2 };
    }
    return { x: W / 2, y: 0 };
  }

  private trickPos(rel: number, idx: number): { x: number; y: number; rot: number } {
    const { cx, cy, cw, ch } = this.geo();
    const n = this.v!.mode;
    let dx = 0;
    let dy = 0;
    const land = this.geo().land;
    const sx = land ? 1.25 : 1;
    const sy = land ? 0.75 : 1;
    if (rel === 0) dy = ch * 0.3 * sy;
    else if (n === 3) {
      dx = (rel === 1 ? -cw * 0.55 : cw * 0.55) * sx;
      dy = -ch * 0.14 * sy;
    } else if (rel === 1) dx = -cw * 0.62 * sx;
    else if (rel === 2) dy = -ch * 0.3 * sy;
    else dx = cw * 0.62 * sx;
    const rot = ((hash(String(idx) + rel) % 9) - 4) * 1.6;
    return { x: cx + dx, y: cy + dy, rot };
  }

  // -------------------------------------------------------------------------
  // Rendern
  // -------------------------------------------------------------------------

  private render(changed: boolean) {
    const v = this.v;
    if (!v) return;
    const g = this.geo();
    this.el.style.setProperty('--cw', g.cw + 'px');
    this.el.style.setProperty('--ch', g.ch + 'px');
    this.el.classList.toggle('land', g.land);
    this.renderHud();
    this.renderCards();
    if (changed || true) {
      this.renderPanel();
      this.renderModal();
    }
  }

  private renderHud() {
    const v = this.v!;
    const n = v.mode;
    const seatsHtml: string[] = [];
    for (let seat = 0; seat < n; seat++) {
      const rel = this.rel(seat);
      if (rel === 0) continue;
      const p = v.players[seat];
      const active = this.isActive(seat);
      const call = v.calls[seat];
      const bubble = call ? `<div class="bubble">${esc(callPhrase(call, hash(seat + ':' + v.round + ':' + call)))}</div>` : '';
      const badges = [
        v.dealer === seat ? '<span class="badge">Geber</span>' : '',
        v.declarer === seat && v.phase !== 'bidding' ? '<span class="badge gold">Spieler</span>' : '',
        n === 4 && seat % 2 === this.seat % 2 ? '<span class="badge partner">Partner</span>' : '',
        p.kind === 'bot' && this.opts.online ? '<span class="badge dim">Bot</span>' : '',
      ].join('');
      const count = v.handCounts[seat];
      const fan = Array.from({ length: count }, (_, i) => `<i style="--i:${i};--m:${(count - 1) / 2}"></i>`).join('');
      seatsHtml.push(`
        <div class="seat pos-${n}-${rel} ${active ? 'active' : ''}" data-rel="${rel}">
          <div class="avatar" style="--hue:${(hash(p.name) % 360 + 360) % 360}">
            <span>${esc(p.name.slice(0, 1).toUpperCase())}</span>
            ${active ? '<i class="ring"></i>' : ''}
          </div>
          <div class="seat-info">
            <div class="seat-name">${esc(p.name)}</div>
            <div class="seat-badges">${badges}</div>
            <div class="seat-cards"><span class="fan" style="--n:${count}">${fan}</span><b>${count}</b>
              ${v.phase === 'playing' || v.phase === 'roundEnd' ? `<span class="tricks">· ${v.tricksCount[seat]} Stich${v.tricksCount[seat] === 1 ? '' : 'e'}</span>` : ''}</div>
          </div>
          ${bubble}
        </div>`);
    }

    // Eigener Platz (Sprechblase und Status)
    const myCall = v.calls[this.seat];
    const myActive = this.isActive(this.seat);
    const meBadges = [
      v.dealer === this.seat ? '<span class="badge">Geber</span>' : '',
      v.declarer === this.seat && v.phase !== 'bidding' ? '<span class="badge gold">Spieler</span>' : '',
      v.phase === 'playing' || v.phase === 'roundEnd'
        ? `<span class="badge dim">${v.tricksCount[this.seat]} Stich${v.tricksCount[this.seat] === 1 ? '' : 'e'}</span>`
        : '',
    ].join('');
    const meHtml = `
      <div class="me ${myActive ? 'active' : ''}">
        ${myCall ? `<div class="bubble up">${esc(callPhrase(myCall, hash(this.seat + ':' + v.round + ':' + myCall)))}</div>` : ''}
        <div class="seat-badges">${meBadges}</div>
      </div>`;

    // Punkte
    const pc = partyCount(v);
    const scores = [];
    for (let p = 0; p < pc; p++) {
      const mine = partyOf(v, this.seat) === p;
      const label = v.mode === 4 ? (mine ? 'Ihr' : 'Gegner') : this.name(p);
      scores.push(`<div class="score ${mine ? 'mine' : ''}"><span>${esc(label)}</span><b>${v.scores[p]}</b></div>`);
    }

    let info = '';
    if (v.trump) {
      info = `<div class="trump-chip" title="Trumpf">${suitSvg(v.trump, 'tiny')}<span>${SUIT_NAME[v.trump]}</span></div>`;
    }
    if (v.bid > 0) {
      info += `<div class="bid-chip"><small>${v.phase === 'bidding' ? 'Gebot' : 'Gereizt'}</small><b>${v.bid}</b><small>${esc(
        v.bidder >= 0 ? this.name(v.bidder) : '',
      )}</small></div>`;
    }

    const last = v.history.length && v.phase === 'playing'
      ? `<button class="icon-btn" data-act="last" title="Letzter Stich">↺</button>`
      : '';

    this.hud.innerHTML = `
      <header class="topbar">
        <button class="icon-btn" data-act="menu" aria-label="Menü">☰</button>
        <div class="scores">${scores.join('')}</div>
        <div class="topinfo">${info}${last}</div>
      </header>
      ${seatsHtml.join('')}
      ${meHtml}
      ${this.menuOpen ? this.menuHtml() : ''}
      ${this.showLastTrick ? this.lastTrickHtml() : ''}`;

    this.hud.querySelector('[data-act="menu"]')?.addEventListener('click', () => {
      this.menuOpen = !this.menuOpen;
      this.render(false);
    });
    this.hud.querySelector('[data-act="last"]')?.addEventListener('click', () => {
      this.showLastTrick = !this.showLastTrick;
      this.render(false);
    });
    this.hud.querySelector('.lasttrick')?.addEventListener('click', () => {
      this.showLastTrick = false;
      this.render(false);
    });
    this.hud.querySelectorAll<HTMLElement>('[data-menu]').forEach((b) =>
      b.addEventListener('click', () => {
        const a = b.dataset.menu;
        this.menuOpen = false;
        if (a === 'rules') this.opts.showRules();
        else if (a === 'exit') this.opts.onExit();
        this.render(false);
      }),
    );
  }

  private menuHtml(): string {
    return `
      <div class="dropdown">
        <button data-menu="rules">Spielregeln</button>
        <button data-menu="exit">${this.opts.online ? 'Tisch verlassen' : 'Zum Hauptmenü'}</button>
        <button data-menu="close">Schließen</button>
      </div>`;
  }

  private lastTrickHtml(): string {
    const v = this.v!;
    const t = v.lastTrick;
    if (!t.length) return '';
    const w = t[winningIndex(t, v.trump!)].seat;
    return `<div class="lasttrick">
      <div class="lt-title">Letzter Stich – ${esc(this.name(w))}</div>
      <div class="lt-cards">${t.map((p) => `<div class="lt-item">${miniCardHtml(p.card)}<small>${esc(this.name(p.seat))}</small></div>`).join('')}</div>
    </div>`;
  }

  private isActive(seat: number): boolean {
    const v = this.v!;
    if (v.phase === 'bidding' || v.phase === 'exchange') return v.turn === seat;
    if (v.phase === 'playing') return v.turn === seat && v.trickWinner < 0;
    return false;
  }

  private renderCards() {
    const v = this.v!;
    const g = this.geo();
    const targets: Target[] = [];
    const hand = v.hands[this.seat];
    const legal = new Set(legalFor(v, this.seat).map((c) => c.id));
    const myTurnPlay = v.phase === 'playing' && v.turn === this.seat && v.trickWinner < 0;
    const exchanging = v.phase === 'exchange' && v.declarer === this.seat;
    const dabbIds = new Set(v.dabb.map((c) => c.id));

    // Eigene Hand
    const n = hand.length;
    const spacing = n > 1 ? Math.min(g.cw * (g.land ? 0.68 : 0.6), (Math.min(g.W, g.land ? g.W * 0.82 : g.W) - 16 - g.cw) / (n - 1)) : 0;
    const total = spacing * (n - 1) + g.cw;
    const x0 = (g.W - total) / 2 + g.cw / 2;
    const baseY = g.H - g.ch / 2 - 24;
    const newCount = hand.filter((c) => !this.cardEls.has(c.id)).length;
    hand.forEach((c, i) => {
      const mid = (n - 1) / 2;
      const off = i - mid;
      let y = baseY + (mid > 0 ? (off * off) / (mid * mid) : 0) * Math.min(14, g.ch * 0.12);
      let cls = '';
      if (myTurnPlay) {
        if (legal.has(c.id)) cls = 'playable';
        else {
          cls = 'disabled';
          y += 8;
        }
      }
      if (exchanging) {
        cls = 'selectable';
        if (dabbIds.has(c.id)) cls += ' from-dabb';
      }
      if (this.selected.has(c.id) || this.armed === c.id) {
        y -= g.ch * 0.2;
        cls += ' selected';
      }
      targets.push({
        key: c.id,
        card: c,
        x: x0 + i * spacing,
        y,
        rot: mid > 0 ? (off / mid) * Math.min(9, mid * 1.4) : 0,
        z: 100 + i,
        cls,
        from: { x: g.cx, y: g.cy },
        delay: newCount > 3 ? i * 35 : 0,
        onTap: () => this.tapCard(c),
      });
    });

    // Dabb
    if (v.phase === 'bidding') {
      for (let i = 0; i < 4; i++) {
        targets.push({
          key: 'dabb-back-' + i,
          card: null,
          x: g.cx + (i - 1.5) * g.cw * 0.18,
          y: g.cy,
          rot: (i - 1.5) * 5,
          z: 10 + i,
          scale: 0.75,
          from: { x: g.cx, y: g.cy },
        });
      }
    } else if (v.phase === 'exchange' && v.declarer !== this.seat) {
      v.dabb.forEach((c, i) => {
        targets.push({
          key: 'dabb-' + c.id,
          card: c,
          x: g.cx + (i - 1.5) * g.cw * 0.8,
          y: g.cy,
          rot: 0,
          z: 10 + i,
          scale: 0.85,
          from: { x: g.cx, y: g.cy },
        });
      });
    }

    // Stich
    v.trick.forEach((p, i) => {
      const rel = this.rel(p.seat);
      const pos = this.trickPos(rel, v.history.length * 10 + i);
      targets.push({
        key: p.card.id,
        card: p.card,
        x: pos.x,
        y: pos.y,
        rot: pos.rot,
        z: 50 + i,
        scale: g.land ? 0.86 : 1,
        cls: v.trickWinner >= 0 && v.trick[winningIndex(v.trick, v.trump!)].card.id === p.card.id ? 'winner' : '',
        from: this.seatAnchor(rel),
      });
    });

    this.applyTargets(targets);
  }

  private applyTargets(targets: Target[]) {
    const v = this.v!;
    const keys = new Set(targets.map((t) => t.key));
    // Entfernen (Stich einsammeln: zum Gewinner fliegen)
    for (const [key, el] of this.cardEls) {
      if (keys.has(key)) continue;
      this.cardEls.delete(key);
      const inLast = v.lastTrick.some((p) => p.card.id === key);
      if (inLast && v.lastTrick.length) {
        const w = v.lastTrick[winningIndex(v.lastTrick, v.trump!)].seat;
        const a = this.seatAnchor(this.rel(w));
        el.style.transform = `translate(${a.x}px, ${a.y}px) translate(-50%,-50%) scale(0.4)`;
      }
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      setTimeout(() => el.remove(), 500);
    }
    for (const t of targets) {
      let el = this.cardEls.get(t.key);
      const tf = `translate(${t.x}px, ${t.y}px) translate(-50%,-50%) rotate(${t.rot}deg) scale(${t.scale ?? 1})`;
      if (!el) {
        el = document.createElement('div');
        el.className = 'card';
        el.innerHTML = t.card ? cardFaceHtml(t.card) : cardBackHtml();
        el.dataset.face = t.card ? '1' : '0';
        const from = t.from ?? { x: t.x, y: t.y };
        el.style.transition = 'none';
        el.style.transform = `translate(${from.x}px, ${from.y}px) translate(-50%,-50%) scale(0.6)`;
        el.style.opacity = '0';
        this.layer.appendChild(el);
        this.cardEls.set(t.key, el);
        void el.offsetWidth;
        el.style.transition = '';
        el.style.transitionDelay = (t.delay ?? 0) + 'ms';
        const e = el;
        setTimeout(() => (e.style.transitionDelay = ''), (t.delay ?? 0) + 400);
        el.addEventListener('click', () => {
          const tap = (e as HTMLElement & { _tap?: () => void })._tap;
          tap?.();
        });
      }
      el.style.transform = tf;
      el.style.opacity = '1';
      el.style.zIndex = String(t.z);
      el.className = 'card ' + (t.cls ?? '');
      (el as HTMLElement & { _tap?: () => void })._tap = t.onTap;
    }
  }

  private tapCard(c: Card) {
    const v = this.v!;
    if (v.phase === 'exchange' && v.declarer === this.seat) {
      if (this.selected.has(c.id)) this.selected.delete(c.id);
      else if (this.selected.size < 4) this.selected.add(c.id);
      else this.toast('Du kannst nur 4 Karten drücken.');
      this.render(false);
      return;
    }
    if (v.phase === 'playing' && v.turn === this.seat && v.trickWinner < 0) {
      const legal = legalFor(v, this.seat);
      if (!legal.some((x) => x.id === c.id)) {
        this.toast(this.illegalReason(c));
        return;
      }
      if (this.armed === c.id) {
        this.armed = null;
        this.conn.send({ type: 'play', cardId: c.id });
      } else {
        this.armed = c.id;
        this.render(false);
      }
      return;
    }
  }

  private illegalReason(c: Card): string {
    const v = this.v!;
    const led = v.trick[0]?.card.suit;
    const hand = v.hands[this.seat];
    if (led && c.suit !== led && hand.some((x) => x.suit === led)) return `Du musch ${SUIT_NAME[led]} bediena!`;
    if (led && c.suit !== v.trump && hand.some((x) => x.suit === v.trump)) return 'Du musch stecha (Trumpf)!';
    return 'Du musch überstecha, wenn\'s goht!';
  }

  // -------------------------------------------------------------------------
  // Aktionsleiste
  // -------------------------------------------------------------------------

  private renderPanel() {
    const v = this.v!;
    let html = '';
    const myTurn = v.turn === this.seat;
    if (v.phase === 'bidding') {
      if (myTurn) {
        const min = minNextBid(v);
        html = `
          <div class="bar">
            <div class="bar-title">${v.bid ? `Aktuell <b>${v.bid}</b> von ${esc(this.name(v.bidder))}` : 'Du fängsch a mit Reiza'}</div>
            <div class="bid-row">
              <button class="btn ghost" data-act="pass">Weg</button>
              <div class="stepper">
                <button class="step" data-act="minus" ${this.bidValue <= min ? 'disabled' : ''}>−</button>
                <b>${this.bidValue}</b>
                <button class="step" data-act="plus">+</button>
              </div>
              <button class="btn primary" data-act="bid">Reiza</button>
            </div>
          </div>`;
      } else {
        html = `<div class="pill">${esc(this.name(v.turn))} isch dra mit Reiza…</div>`;
      }
    } else if (v.phase === 'exchange') {
      if (v.declarer === this.seat) {
        const hand = v.hands[this.seat];
        const kept = hand.filter((c) => !this.selected.has(c.id));
        const meld = this.exTrump && this.selected.size === 4 ? meldTotal(findMelds(kept, this.exTrump, v.withSevens)) : null;
        const discPts = hand.filter((c) => this.selected.has(c.id)).reduce((s, c) => s + CARD_POINTS[c.rank], 0);
        html = `
          <div class="bar">
            <div class="bar-title">Drück 4 Karten (${this.selected.size}/4) und sag Trumpf an</div>
            <div class="trump-row">
              ${SUITS.map((s) => `<button class="suit-btn ${this.exTrump === s ? 'on' : ''}" data-suit="${s}">${suitSvg(s, 'tiny')}<span>${SUIT_NAME[s]}</span></button>`).join('')}
            </div>
            <div class="bid-row">
              <div class="meta">${meld !== null ? `Meldung <b>${meld}</b> · Gedrückt <b>${discPts}</b> Augen` : `Gereizt: <b>${v.bid}</b>`}</div>
              <button class="btn primary" data-act="exchange" ${this.selected.size === 4 && this.exTrump ? '' : 'disabled'}>Fertig</button>
            </div>
          </div>`;
      } else {
        html = `<div class="pill">${esc(this.name(v.declarer))} nimmt dr Dabb und drückt…</div>`;
      }
    } else if (v.phase === 'playing') {
      if (myTurn && v.trickWinner < 0) {
        html = `<div class="pill glow">${this.armed ? 'Nomol tippe zum Spiela' : 'Du bisch dra'}</div>`;
      } else if (v.trickWinner >= 0) {
        html = `<div class="pill">${esc(this.name(v.trickWinner))} ${v.trickWinner === this.seat ? 'machsch' : 'macht'} dr Stich</div>`;
      }
    }
    this.panel.innerHTML = html;
    this.panel.querySelector('[data-act="pass"]')?.addEventListener('click', () => this.conn.send({ type: 'pass' }));
    this.panel.querySelector('[data-act="bid"]')?.addEventListener('click', () =>
      this.conn.send({ type: 'bid', value: this.bidValue }),
    );
    this.panel.querySelector('[data-act="plus"]')?.addEventListener('click', () => {
      this.bidValue += 10;
      this.renderPanel();
    });
    this.panel.querySelector('[data-act="minus"]')?.addEventListener('click', () => {
      this.bidValue = Math.max(minNextBid(v), this.bidValue - 10);
      this.renderPanel();
    });
    this.panel.querySelectorAll<HTMLElement>('[data-suit]').forEach((b) =>
      b.addEventListener('click', () => {
        this.exTrump = b.dataset.suit as Suit;
        this.renderPanel();
      }),
    );
    this.panel.querySelector('[data-act="exchange"]')?.addEventListener('click', () => {
      if (this.selected.size !== 4 || !this.exTrump) return;
      this.conn.send({ type: 'exchange', discard: [...this.selected], trump: this.exTrump });
    });
  }

  // -------------------------------------------------------------------------
  // Dialoge: Meldungen, Rundenende, Spielende
  // -------------------------------------------------------------------------

  private renderModal() {
    const v = this.v!;
    let html = '';
    if (v.phase === 'melds') html = this.meldsHtml();
    else if (v.phase === 'roundEnd') html = this.roundEndHtml();
    else if (v.phase === 'gameOver') html = this.gameOverHtml();
    if (this.modal.dataset.html === html) return;
    this.modal.dataset.html = html;
    this.modal.innerHTML = html;
    this.modal.querySelector('[data-act="ready"]')?.addEventListener('click', () => this.conn.send({ type: 'ready' }));
    this.modal.querySelector('[data-act="play"]')?.addEventListener('click', () =>
      this.conn.send({ type: 'decide', play: true }),
    );
    this.modal.querySelector('[data-act="abgehen"]')?.addEventListener('click', () =>
      this.conn.send({ type: 'decide', play: false }),
    );
    this.modal.querySelector('[data-act="restart"]')?.addEventListener('click', () => this.opts.onRestart?.());
    this.modal.querySelector('[data-act="exit"]')?.addEventListener('click', () => this.opts.onExit());
  }

  private meldsHtml(): string {
    const v = this.v!;
    const rows = [];
    for (let seat = 0; seat < v.mode; seat++) {
      const ms = v.melds[seat];
      const total = meldTotal(ms);
      rows.push(`
        <div class="meld-row ${seat === v.declarer ? 'decl' : ''}">
          <div class="meld-head"><b>${esc(this.name(seat))}</b>${seat === v.declarer ? ' <span class="badge gold">Spieler</span>' : ''}<span class="meld-total">${total}</span></div>
          <div class="meld-list">${
            ms.length
              ? ms.map((m) => `<span class="meld-chip">${esc(m.name)} <b>${m.points}</b></span>`).join('')
              : '<span class="muted">Nix gmeldet</span>'
          }</div>
        </div>`);
    }
    let actions: string;
    if (v.declarer === this.seat) {
      if (v.declarerDecision) actions = `<div class="muted">Warte auf die andere…</div>`;
      else {
        const own = meldTotal(v.melds[this.seat]);
        const partner = v.mode === 4 ? meldTotal(v.melds[(this.seat + 2) % 4]) : 0;
        const disc = v.discard.reduce((s, c) => s + CARD_POINTS[c.rank], 0);
        actions = `
          <div class="decide-info">Gereizt <b>${v.bid}</b> · Meldung <b>${own + partner}</b> · Gedrückt <b>${disc}</b><br>
          Dir fehla no <b>${Math.max(0, v.bid - own - partner - disc)}</b> Augen aus de Stich.</div>
          <div class="btn-row">
            <button class="btn ghost" data-act="abgehen">Abgehen (−${v.bid})</button>
            <button class="btn primary" data-act="play">Spiela!</button>
          </div>`;
      }
    } else if (v.ready[this.seat]) actions = `<div class="muted">Warte auf ${esc(this.name(v.declarer))}…</div>`;
    else actions = `<div class="btn-row"><button class="btn primary" data-act="ready">Weiter</button></div>`;
    return `
      <div class="modal">
        <div class="modal-title">${v.trump ? suitSvg(v.trump, 'tiny') : ''} ${esc(trumpPhrase(v.trump!))}</div>
        <div class="modal-sub">Gemeldet wird – Meldunga zähla nur mit mindeschtens oim Stich.</div>
        <div class="modal-melds">${rows.join('')}</div>
        ${actions}
      </div>`;
  }

  private roundEndHtml(): string {
    const v = this.v!;
    const r = v.result!;
    const dp = partyOf(v, r.declarer);
    const declName = this.name(r.declarer);
    const head = r.abgegangen
      ? `${esc(declName)} ${r.declarer === this.seat ? 'bisch' : 'isch'} abganga.`
      : `${esc(declName)} ${r.declarer === this.seat ? 'hosch' : 'hot'} ${r.bid} in ${SUIT_NAME[r.trump!]} gspielt – ${esc(madePhrase(r.made, v.round))}`;
    const rows = r.parties
      .map(
        (p, i) => `
        <tr class="${i === dp ? 'decl' : ''} ${i === partyOf(v, this.seat) ? 'mine' : ''}">
          <td>${esc(this.partyName(i))}</td>
          <td>${p.meldsCount ? p.melds : `<s>${p.melds}</s>`}</td>
          <td>${r.abgegangen ? (i === dp ? '–' : '+40') : p.tricks}</td>
          <td class="${p.score < 0 ? 'neg' : 'pos'}">${p.score > 0 ? '+' : ''}${p.score}</td>
          <td><b>${v.scores[i]}</b></td>
        </tr>`,
      )
      .join('');
    const waiting = v.ready[this.seat];
    return `
      <div class="modal">
        <div class="modal-title">Runde ${v.round}</div>
        <div class="modal-sub">${head}</div>
        <table class="result">
          <thead><tr><th></th><th>Meldung</th><th>Augen</th><th>Runde</th><th>Gesamt</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="muted small">Ziel: ${v.target} Punkte</div>
        <div class="btn-row">${
          waiting ? '<div class="muted">Warte auf die andere…</div>' : `<button class="btn primary" data-act="ready">${v.winner !== null ? 'Zum Ergebnis' : 'Nächste Runde'}</button>`
        }</div>
      </div>`;
  }

  private gameOverHtml(): string {
    const v = this.v!;
    const won = v.winner === partyOf(v, this.seat);
    const order = v.scores.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s);
    return `
      <div class="modal final">
        <div class="trophy">${won ? '🏆' : '🃏'}</div>
        <div class="modal-title">${esc(won ? winPhrase(v.round) : losePhrase(v.round))}</div>
        <div class="modal-sub">${esc(this.partyName(v.winner!))} ${v.mode === 4 || v.winner === this.seat ? 'hent' : 'hot'} gwonna.</div>
        <div class="final-list">${order.map((o, k) => `<div class="final-item ${o.i === v.winner ? 'win' : ''}"><span>${k + 1}.</span><span>${esc(this.partyName(o.i))}</span><b>${o.s}</b></div>`).join('')}</div>
        <div class="btn-row">
          <button class="btn ghost" data-act="exit">Menü</button>
          ${this.opts.onRestart ? '<button class="btn primary" data-act="restart">Nomol!</button>' : ''}
        </div>
        ${!this.opts.onRestart ? '<div class="muted small">Dr Gastgeber ka a neue Partie starta.</div>' : ''}
      </div>`;
  }
}
