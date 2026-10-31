export const RULES_HTML = `
<h2>So goht Binokel</h2>
<p>Gespielt wird mit dem <b>deutschen Blatt</b> (Eichel, Laub, Herz, Schellen). Jede Karte gibt es zweimal.</p>

<h3>Varianten</h3>
<ul>
  <li><b>3 Spieler:</b> 40 Karten (Sau, Zehner, König, Ober, Unter). Jeder kriegt 12, 4 Karten kommen in den <b>Dabb</b>.</li>
  <li><b>Kreuzbinokel (4 Spieler):</b> 48 Karten (zusätzlich Siebener). Jeder kriegt 11, 4 in den Dabb. Wer gegenüber sitzt, spielt zusammen.</li>
</ul>

<h3>Kartenwerte (Augen)</h3>
<table class="rules-table">
  <tr><td>Sau (A)</td><td>11</td></tr>
  <tr><td>Zehner (10)</td><td>10</td></tr>
  <tr><td>König (K)</td><td>4</td></tr>
  <tr><td>Ober (O)</td><td>3</td></tr>
  <tr><td>Unter (U)</td><td>2</td></tr>
  <tr><td>Siebener (7)</td><td>0</td></tr>
  <tr><td>Letzter Stich</td><td>+10</td></tr>
</table>
<p>Die Reihenfolge im Stich ist A &gt; 10 &gt; K &gt; O &gt; U &gt; 7. Liegen zwei gleiche Karten im Stich, gewinnt die zuerst gespielte.</p>

<h3>Ablauf</h3>
<ol>
  <li><b>Reizen:</b> Los geht's links vom Geber, ab 150 in Zehnerschritten. Wer „weg“ sagt, ist raus. Wenn keiner reizt, wird neu gegeben.</li>
  <li><b>Dabb:</b> Wer am höchsten gereizt hat (der <b>Spieler</b>), nimmt den Dabb auf, drückt 4 Karten und sagt Trumpf an. Die Augen der gedrückten Karten zählen für ihn.</li>
  <li><b>Melden:</b> Alle zeigen ihre Meldungen. Danach entscheidet der Spieler: <b>spielen</b> oder <b>abgehen</b>.</li>
  <li><b>Stiche:</b> Der Spieler spielt aus. Es gilt <b>Farbzwang</b>, <b>Trumpfzwang</b> und <b>Stichzwang</b>: Wenn du kannst, musst du überstechen.</li>
</ol>

<h3>Meldungen</h3>
<table class="rules-table">
  <tr><td>Familie in Trumpf (A, 10, K, O, U)</td><td>150</td></tr>
  <tr><td>Familie in anderer Farbe</td><td>100</td></tr>
  <tr><td>Paar in Trumpf (K + O)</td><td>40</td></tr>
  <tr><td>Paar in anderer Farbe</td><td>20</td></tr>
  <tr><td>Binokel (Laub-Ober + Schellen-Unter)</td><td>40</td></tr>
  <tr><td>Doppel-Binokel</td><td>300</td></tr>
  <tr><td>Vier Säu / Könige / Ober / Unter</td><td>100 / 80 / 60 / 40</td></tr>
  <tr><td>Acht Säu / Könige / Ober / Unter</td><td>1000 / 800 / 600 / 400</td></tr>
  <tr><td>Doppelte Familie (Trumpf / andere)</td><td>1500 / 1000</td></tr>
  <tr><td>Dix (Trumpf-Siebener, nur Kreuzbinokel)</td><td>10</td></tr>
</table>
<p>Meldungen zählen nur, wenn die Partei <b>mindestens einen Stich</b> macht.</p>

<h3>Abrechnung</h3>
<ul>
  <li>Jede Partei bekommt ihre Meldungen plus ihre Augen aus den Stichen (auf Zehner gerundet).</li>
  <li>Erreicht der Spieler sein Gebot nicht, werden ihm <b>das Doppelte des Gebots</b> abgezogen.</li>
  <li><b>Abgehen:</b> Der Spieler verliert sein Gebot (einfach). Die Gegner bekommen ihre Meldungen plus 40.</li>
  <li>Wer zuerst <b>1000 Punkte</b> hat, gewinnt.</li>
</ul>

<h3>Bedienung</h3>
<p>Tippe eine Karte einmal an, um sie anzuheben, und ein zweites Mal, um sie zu spielen. Über ↺ oben rechts siehst du den letzten Stich.</p>
`;
