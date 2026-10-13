import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32

function encodeTime(ms: number, len: number): string {
  let out = '';
  let t = ms;
  for (let i = 0; i < len; i++) {
    out = ALPHABET[t % 32] + out;
    t = Math.floor(t / 32);
  }
  return out;
}

function encodeRandom(len: number): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[(bytes[i] ?? 0) % 32];
  return out;
}

/** `g_` plus a 26-character ULID-style id: 10 chars of time, 16 of randomness. */
export function gradeId(now: number = Date.now()): string {
  return `g_${encodeTime(now, 10)}${encodeRandom(16)}`;
}
