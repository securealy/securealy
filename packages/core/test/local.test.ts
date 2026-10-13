import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, it, expect, afterAll } from 'vitest';
import { runLocal, LOCAL_CHECKS, catalogue } from '../src/index.js';
import type { Status } from '../src/index.js';

/**
 * Local fixtures describe a scenario rather than an Evidence object: files to
 * create, whether to turn the directory into a git repo, the env to expose and
 * canned HTTP responses keyed by a URL substring.
 */
interface LocalFixture {
  files?: Record<string, string>;
  git?: boolean;
  env?: Record<string, string>;
  responses?: { match: string; bodyMatch?: string; status: number; body?: unknown }[];
  expect: Status;
}

const FIXTURES = join(__dirname, 'fixtures');
const dirs: string[] = [];

function materialize(f: LocalFixture): string {
  const dir = mkdtempSync(join(tmpdir(), 'securealy-local-'));
  dirs.push(dir);
  for (const [path, content] of Object.entries(f.files ?? {})) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  if (f.git) {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example' } });
    git('init', '-q');
    git('add', '-A');
    git('commit', '-q', '-m', 'fixture', '--allow-empty');
  }
  return dir;
}

function fakeFetch(responses: LocalFixture['responses'] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const reqBody = typeof init?.body === 'string' ? init.body : '';
    const hit = responses.find((r) => url.includes(r.match) && (!r.bodyMatch || reqBody.includes(r.bodyMatch)));
    if (!hit) return new Response('not mocked', { status: 599 });
    const body = typeof hit.body === 'string' ? hit.body : JSON.stringify(hit.body ?? {});
    return new Response(body, { status: hit.status, headers: { 'content-type': 'application/json', 'content-range': '0-0/0' } });
  }) as typeof fetch;
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const local = catalogue().filter((c) => c.tier === 'local');

describe('local catalogue coverage', () => {
  it('every local entry has a module', () => {
    const ids = new Set(LOCAL_CHECKS.map((m) => m.id));
    for (const c of local) expect(ids.has(c.id), c.id).toBe(true);
  });
});

for (const entry of local) {
  describe(entry.id, () => {
    for (const kind of ['pass', 'fail'] as const) {
      it(`${kind} fixture`, async () => {
        const f = JSON.parse(readFileSync(join(FIXTURES, entry.id, `${kind}.json`), 'utf8')) as LocalFixture;
        const cwd = materialize(f);
        const r = await runLocal({ cwd, checks: [entry.id], env: f.env ?? {}, fetch: fakeFetch(f.responses) });
        expect(r.tier).toBe('local');
        expect(r.checks).toHaveLength(1);
        const c = r.checks[0]!;
        expect(c.id).toBe(entry.id);
        expect(c.status, c.evidence).toBe(f.expect);
        for (const v of Object.values(f.env ?? {})) {
          if (v.length >= 16) expect(JSON.stringify(r).includes(v), `secret ${v.slice(0, 6)} leaked into result`).toBe(false);
        }
      });
    }
  });
}
