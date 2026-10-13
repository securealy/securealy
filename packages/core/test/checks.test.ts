import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { catalogue, buildContext, REMOTE_CHECKS } from '../src/index.js';
import type { Evidence, Status } from '../src/index.js';

const FIXTURES = join(__dirname, 'fixtures');

/** Checks whose "fail" fixture legitimately lands on warn (the catalogue says the condition cannot be judged outright). */
const EXPECTED_FAIL: Record<string, Status> = {
  'firebase-config': 'warn',
  'consent-mechanism': 'warn',
};

function load(id: string, kind: 'pass' | 'fail'): Evidence {
  const p = join(FIXTURES, id, `${kind}.json`);
  if (!existsSync(p)) throw new Error(`missing fixture ${p}; run node packages/core/test/tools/make-fixtures.mjs`);
  return JSON.parse(readFileSync(p, 'utf8')) as Evidence;
}

const remote = catalogue().filter((c) => c.tier !== 'local');
const byId = new Map(REMOTE_CHECKS.map((m) => [m.id, m]));

describe('catalogue coverage', () => {
  it('every remote catalogue entry has a module and every module is in the catalogue', () => {
    const ids = new Set(remote.map((c) => c.id));
    for (const c of remote) expect(byId.has(c.id), `module for ${c.id}`).toBe(true);
    for (const m of REMOTE_CHECKS) expect(ids.has(m.id), `catalogue entry for ${m.id}`).toBe(true);
    expect(remote.filter((c) => c.tier === 'passive')).toHaveLength(51);
    expect(remote.filter((c) => c.tier === 'verified')).toHaveLength(7);
    expect(catalogue().filter((c) => c.tier === 'local')).toHaveLength(7);
  });
});

for (const entry of remote) {
  describe(entry.id, () => {
    const mod = byId.get(entry.id);
    it('passes on the pass fixture', () => {
      const r = mod!.run(buildContext(load(entry.id, 'pass')));
      expect(r.id).toBe(entry.id);
      expect(r.severity).toBe(entry.severity);
      expect(r.status, r.evidence).toBe('pass');
      expect(r.evidence.length).toBeGreaterThan(0);
      expect(r.evidence.length).toBeLessThanOrEqual(240);
    });
    it('fails on the fail fixture', () => {
      const r = mod!.run(buildContext(load(entry.id, 'fail')));
      expect(r.status, r.evidence).toBe(EXPECTED_FAIL[entry.id] ?? 'fail');
      expect(r.evidence.length).toBeGreaterThan(0);
    });
    it('is deterministic', () => {
      const a = mod!.run(buildContext(load(entry.id, 'fail')));
      const b = mod!.run(buildContext(load(entry.id, 'fail')));
      expect(a).toEqual(b);
    });
  });
}
