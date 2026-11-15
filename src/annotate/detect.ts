import { groupLines } from '../lib/text/words';
import type { Rect, Word } from '../lib/types';

/**
 * Offline auto-redact suggestions: finds emails, phone numbers, card numbers
 * and API-key-like strings in the capture's text layer and returns the boxes
 * that cover them. Nothing leaves the page; the user decides what to redact.
 */

export type SensitiveKind = 'email' | 'phone' | 'card' | 'key';

export interface Finding {
  kind: SensitiveKind;
  text: string;
  rect: Rect;
}

export const KIND_LABEL: Record<SensitiveKind, string> = {
  email: 'Email address',
  phone: 'Phone number',
  card: 'Card number',
  key: 'API key or token',
};

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{2,4}(?:[\s.-]\d{2,4}){1,4}/g;
const CARD = /\b\d(?:[ -]?\d){12,18}\b/g;
const KEYS = [
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}/g,
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{40,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];
/** Long mixed letters-and-digits tokens that look like secrets. */
const TOKEN = /\b[A-Za-z0-9_\-+/=]{32,}\b/g;

export function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

function looksLikeToken(s: string): boolean {
  if (!/[a-z]/.test(s) || !/[A-Z]/.test(s) || !/\d/.test(s)) return false;
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) h -= (n / s.length) * Math.log2(n / s.length);
  return h >= 3.8;
}

function isPhone(s: string): boolean {
  const digits = s.replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 15) return false;
  // Dates and times ("2026-11-07", "12.10.2026") are not phone numbers.
  if (/^\d{4}[-./]\d{1,2}[-./]\d{1,2}$/.test(s.trim()) || /^\d{1,2}[-./]\d{1,2}[-./]\d{2,4}$/.test(s.trim())) return false;
  return true;
}

interface Span {
  kind: SensitiveKind;
  start: number;
  end: number;
}

/** Sensitive spans in one line of text. Overlaps keep the first, more specific match. */
export function scanText(text: string): Span[] {
  const spans: Span[] = [];
  const add = (kind: SensitiveKind, start: number, end: number) => {
    if (spans.some((s) => start < s.end && s.start < end)) return;
    spans.push({ kind, start, end });
  };
  for (const m of text.matchAll(EMAIL)) add('email', m.index!, m.index! + m[0].length);
  for (const re of KEYS) for (const m of text.matchAll(re)) add('key', m.index!, m.index! + m[0].length);
  for (const m of text.matchAll(CARD)) if (luhn(m[0].replace(/\D/g, ''))) add('card', m.index!, m.index! + m[0].length);
  for (const m of text.matchAll(PHONE)) if (isPhone(m[0])) add('phone', m.index!, m.index! + m[0].length);
  for (const m of text.matchAll(TOKEN)) if (looksLikeToken(m[0])) add('key', m.index!, m.index! + m[0].length);
  return spans.sort((a, b) => a.start - b.start);
}

/** Findings with the word boxes that cover each match (padded a little). */
export function findSensitive(words: Word[], pad = 2): Finding[] {
  const out: Finding[] = [];
  for (const line of groupLines(words)) {
    let text = '';
    const ranges: { w: Word; start: number; end: number }[] = [];
    for (const w of line.words) {
      if (text) text += ' ';
      ranges.push({ w, start: text.length, end: text.length + w.text.length });
      text += w.text;
    }
    for (const s of scanText(text)) {
      const ws = ranges.filter((r) => r.start < s.end && s.start < r.end).map((r) => r.w);
      if (!ws.length) continue;
      const x0 = Math.min(...ws.map((w) => w.x)) - pad;
      const y0 = Math.min(...ws.map((w) => w.y)) - pad;
      const x1 = Math.max(...ws.map((w) => w.x + w.w)) + pad;
      const y1 = Math.max(...ws.map((w) => w.y + w.h)) + pad;
      out.push({ kind: s.kind, text: text.slice(s.start, s.end), rect: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } });
    }
  }
  return out;
}
