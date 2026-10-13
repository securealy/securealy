import { createRequire } from 'node:module';
import type { Check, Tier } from './types.js';

const require = createRequire(import.meta.url);

let cached: Check[] | null = null;

/** The check catalogue from packages/checks/checks.json, the source of truth. */
export function catalogue(): Check[] {
  if (!cached) {
    const raw = require('securealy-checks/checks.json') as Check[];
    cached = raw.map((c) => ({ ...c }));
  }
  return cached.map((c) => ({ ...c }));
}

export function catalogueByTier(tier: Tier): Check[] {
  return catalogue().filter((c) => c.tier === tier);
}

export function catalogueEntry(id: string): Check | undefined {
  return catalogue().find((c) => c.id === id);
}
