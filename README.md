# Binokel

Klassisches schwäbisches Binokel als Web-App (PWA) fürs Handy – mit deutschem Blatt, Tisch-Ansicht und schwäbischen Sprüchen.

- **Gegen den Computer:** 3 Spieler oder Kreuzbinokel (4 Spieler, 2 gegen 2), KI in *Normal* oder *Schwer*
- **Online mit Freunden:** Tisch aufmachen, 4-stelligen Code oder Link teilen – Verbindung direkt von Handy zu Handy (WebRTC/PeerJS), freie Plätze übernehmen Bots
- **Offline spielbar** und als App installierbar („Zum Home-Bildschirm“)

## Installieren aufs Handy

1. Link der GitHub-Pages-Seite öffnen
2. iPhone (Safari): Teilen → „Zum Home-Bildschirm“ · Android (Chrome): Menü → „App installieren“

## Entwicklung

```bash
npm install
npm run dev     # lokaler Server
npm test        # Regeln + komplette Bot-Partien
npm run build   # Produktion nach dist/
```

Struktur:

- `src/engine/` – Karten, Meldungen, Stichregeln, Spielablauf (rein, ohne UI)
- `src/ai/` – Computer-Gegner (Normal: Heuristik, Schwer: Kartenzählen + Monte-Carlo-Simulation)
- `src/controller/` – Spielleitung (Host), steuert Bots und verteilt die Sicht je Platz
- `src/net/` – Online-Modus über PeerJS
- `src/ui/` – Tisch, Menü, Regeln

## Veröffentlichung

Jeder Push wird per GitHub Actions gebaut und auf GitHub Pages veröffentlicht
(einmalig nötig: *Settings → Pages → Source: GitHub Actions*).
