import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, it, expect, afterAll } from 'vitest';
import { runLocal, LOCAL_CHECKS, catalogue, GIT_SAFETY_ARGS } from '../src/index.js';
import { createLocalContext } from '../src/local/context.js';
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

/** A fetch that records every URL it is asked for and answers from a table. */
function recordingFetch(responses: LocalFixture['responses'] = []): typeof fetch & { calls: string[] } {
  const calls: string[] = [];
  const inner = fakeFetch(responses);
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    return inner(input, init);
  }) as typeof fetch & { calls: string[] };
  f.calls = calls;
  return f;
}

describe('git is spawned with the safety flags', () => {
  it('every git call overrides core.fsmonitor and core.hooksPath, so a scanned repository cannot run its own hooks', async () => {
    const dir = materialize({ files: { 'a.txt': 'a\n' }, git: true });
    execFileSync('git', ['config', 'core.hooksPath', join(dir, 'evil-hooks')], { cwd: dir });
    execFileSync('git', ['config', 'core.fsmonitor', join(dir, 'evil-fsmonitor')], { cwd: dir });
    const ctx = createLocalContext(dir, {}, fakeFetch(), () => {});
    expect((await ctx.exec('git', ['config', 'core.hooksPath'])).stdout.trim()).toBe('/dev/null');
    expect((await ctx.exec('git', ['config', 'core.fsmonitor'])).stdout.trim()).toBe('false');
    const seen: string[] = [];
    await ctx.stream('git', ['config', 'core.hooksPath'], (line) => void seen.push(line), 10_000);
    expect(seen).toEqual(['/dev/null']);
    expect(GIT_SAFETY_ARGS).toContain('core.fsmonitor=false');
  });
});

describe('rls-policies only sends the service key to a Supabase-hosted https project', () => {
  const key = 'FAKEserviceKeyFAKEserviceKeyFAKE';
  const run = (url: string, extra: Record<string, string> = {}) => {
    const f = recordingFetch();
    return runLocal({ cwd: materialize({}), checks: ['rls-policies'], env: { SUPABASE_URL: url, SUPABASE_SERVICE_KEY: key, ...extra }, fetch: f }).then((r) => ({ r, calls: f.calls }));
  };

  it('skips without a request for a foreign host, a plain-http URL or a non-URL', async () => {
    for (const url of ['https://evil.example/supabase', 'http://abcdefghijklmnopqrst.supabase.co', 'https://abcdefghijklmnopqrst.supabase.co.evil.example', 'not a url']) {
      const { r, calls } = await run(url);
      expect(calls, url).toEqual([]);
      expect(r.checks[0]?.status, url).toBe('skip');
      expect(r.checks[0]?.evidence, url).toContain('SECUREALY_SUPABASE_HOST_OVERRIDE');
      expect(JSON.stringify(r)).not.toContain(key);
    }
  });

  it('sends it to a Supabase-hosted project, and to anything else only with the override', async () => {
    const hosted = await run('https://abcdefghijklmnopqrst.supabase.co');
    expect(hosted.calls).toHaveLength(1);
    expect(hosted.calls[0]).toBe('https://abcdefghijklmnopqrst.supabase.co/rest/v1/');
    const overridden = await run('https://supabase.internal.example', { SECUREALY_SUPABASE_HOST_OVERRIDE: '1' });
    expect(overridden.calls).toHaveLength(1);
    expect(overridden.r.checks[0]?.status).toBe('error'); // the fake answers 599
  });
});

describe('vercel-env-hygiene fetches decrypted values only with SECUREALY_VERCEL_DECRYPT=1', () => {
  const envs = [
    { id: '1', key: 'RESEND_API_KEY', value: 're_FAKEabcd_FAKEabcdefghijklmnop\n', type: 'encrypted', target: ['production'] },
    { id: '2', key: 'NEXT_PUBLIC_SITE_URL', value: 'https://app.example', type: 'plain', target: ['production', 'preview'] },
  ];
  const run = (extra: Record<string, string>) => {
    const f = recordingFetch([{ match: '/env?decrypt=', status: 200, body: { envs } }]);
    return runLocal({ cwd: materialize({}), checks: ['vercel-env-hygiene'], env: { VERCEL_TOKEN: 'FAKEvercelTokenFAKEvercelToken', VERCEL_PROJECT_ID: 'prj_FAKEproject', ...extra }, fetch: f }).then((r) => ({ r, calls: f.calls }));
  };

  it('without the variable it asks for metadata only and says which checks it skipped', async () => {
    const { r, calls } = await run({});
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('decrypt=false');
    expect(r.checks[0]?.status).toBe('pass');
    expect(r.checks[0]?.evidence).toContain('SECUREALY_VERCEL_DECRYPT');
    expect(r.checks[0]?.evidence).toContain('skipped');
  });

  it('with the variable it reads values and catches the trailing newline', async () => {
    const { r, calls } = await run({ SECUREALY_VERCEL_DECRYPT: '1' });
    expect(calls[0]).toContain('decrypt=true');
    expect(r.checks[0]?.status).toBe('fail');
    expect(r.checks[0]?.evidence).toContain('newline');
  });
});
