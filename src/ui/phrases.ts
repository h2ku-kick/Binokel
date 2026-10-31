import { Suit, SUIT_NAME } from '../engine/cards';

// Schwäbische Sprüche

function pick(arr: string[], key: number): string {
  return arr[Math.abs(key) % arr.length];
}

export function bidPhrase(value: number, key: number): string {
  return pick([`${value}!`, `I sag ${value}.`, `${value}, gell!`, `No ${value}.`, `${value} – gugg mol!`], key);
}

export function passPhrase(key: number): string {
  return pick(['I bin weg.', 'Ohne mi.', 'Do gang i net mit.', 'Noi, danke.', 'Basst scho, weg.'], key);
}

export function callPhrase(call: string, key: number): string {
  if (call === 'weg') return passPhrase(key);
  if (call === 'I spiel!') return pick(['I spiel!', 'Des pack i!', 'Des wird scho!'], key);
  if (call === 'I gang ab') return pick(['I gang ab.', 'Des wird nix, i gang ab.', 'Do isch nix z\'mache.'], key);
  if (/^\d+$/.test(call)) return bidPhrase(Number(call), key);
  return call;
}

export function trumpPhrase(s: Suit): string {
  return `Trumpf isch ${SUIT_NAME[s]}!`;
}

export function madePhrase(made: boolean, key: number): string {
  return made
    ? pick(['Des hot glangt!', 'Sauber gspielt!', 'Na also, goht doch!'], key)
    : pick(['Des isch nix worre.', 'Oh je, verreizt!', 'Do hosch di verschätzt.'], key);
}

export function winPhrase(key: number): string {
  return pick(['Gwonna! Sauber!', 'Des isch dr Sieg!', 'Mir hent gwonna!'], key);
}

export function losePhrase(key: number): string {
  return pick(['Schad – des nächscht Mol!', 'Heit isch net dei Dag.', 'Net bruddla, nomol spiela!'], key);
}

export const BOT_NAMES = ['Gottlieb', 'Hilde', 'Karle', 'Frieda', 'Schorsch', 'Lore', 'Eugen', 'Rosl'];
