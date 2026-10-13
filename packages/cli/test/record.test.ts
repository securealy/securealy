import { createServer as createHttpServer } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { GradeResult } from 'securealy-core';
import { main } from '../src/cli.js';
import { ENGINE_VERSION, HISTORY_CAP, appendHistory, comparisonLine, previousFor, readHistory, recordRun, toEntry, toTelemetry } from '../src/record.js';
import type { HistoryEntry } from '../src/record.js';

// Random-looking so the placeholder guard does not dismiss it; FAKE marks it for the repo sweep.
const PLANTED = 'sk_live_' + 'FAKE' + 'q8Wn3zT5vK2mX7pL9rD4';
const STRIPE_KEY = 'sk_test_' + 'FAKE' + 'h2Jk5mN8pQ3rS6tV9wX1';

const sample: GradeResult = {
  schema: 1,
  id: 'g_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  input: 'https://app.example',
  finalUrl: 'https://app.example/',
  host: 'app.example',
  gradedAt: '2026-10-12T00:00:00Z',
  tier: 'passive',
  grade: 'B',
  score: 83,
  summary: { blocker: 0, fail: 2, warn: 1, pass: 5, skip: 1, error: 0 },
  stack: { host: 'vercel', db: 'supabase', analytics: ['ga4'], framework: 'next' },
  checks: [
    { id: 'hsts', status: 'fail', severity: 'high', evidence: 'no Strict-Transport-Security header; token ' + PLANTED, fixSlug: 'hsts' },
    { id: 'not-found-page', status: 'fail', severity: 'medium', evidence: 'random path answered 200', fixSlug: 'not-found-page' },
    { id: 'title', status: 'warn', severity: 'medium', evidence: 'title is 12 characters', fixSlug: 'title' },
    { id: 'tls-valid', status: 'pass', severity: 'blocker', evidence: 'trusted certificate', fixSlug: 'tls-valid' },
    { id: 'spf', status: 'pass', severity: 'high', evidence: 'v=spf1 -all', fixSlug: 'spf' },
    { id: 'json-ld', status: 'skip', severity: 'low', evidence: 'no JSON-LD blocks', fixSlug: 'json-ld' },
  ],
  requests: 19,
  durationMs: 4120,
};

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'securealy-record-'));
  dirs.push(d);
  return d;
}
const historyPath = (d: string) => join(d, '.securealy', 'history.json');
const io = (overrides: Record<string, unknown> = {}) => {
  const out: string[] = [];
  return { out, ctx: { out: (s: string) => out.push(s), err: (s: string) => out.push(s), color: false, ...overrides } };
};

/** A git repository with one committed secret, so scan-repo has real evidence to leave out of the record. */
function fixtureRepo(): string {
  const dir = tmp();
  writeFileSync(join(dir, '.gitignore'), '.env*\nnode_modules/\n');
  writeFileSync(join(dir, '.env.example'), 'STRIPE_SECRET_KEY=\n');
  writeFileSync(join(dir, 'index.js'), `const k = process.env.STRIPE_SECRET_KEY;\nconst leaked = "${PLANTED}";\n`);
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example' } });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  return dir;
}

let http: HttpServer;
let endpoint = '';
const received: { headers: Record<string, string | string[] | undefined>; body: unknown }[] = [];

beforeAll(async () => {
  http = createHttpServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/api/telemetry') {
        received.push({ headers: req.headers, body: JSON.parse(raw) });
        res.writeHead(204);
        return res.end();
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  const addr = http.address();
  endpoint = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}/api/telemetry` : '';
});

afterAll(async () => {
  await new Promise<void>((r) => http.close(() => r()));
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('history entries', () => {
  it('carry ids and numbers only: no evidence, no URL beyond the host', () => {
    const e = toEntry(sample, 'grade', new Date('2026-10-12T10:00:00.123Z'));
    expect(e).toEqual({
      at: '2026-10-12T10:00:00Z',
      command: 'grade',
      tier: 'passive',
      host: 'app.example',
      grade: 'B',
      score: 83,
      summary: sample.summary,
      id: sample.id,
      failed: ['hsts', 'not-found-page'],
      engineVersion: ENGINE_VERSION,
    });
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(JSON.stringify(e)).not.toContain(PLANTED);
    expect(JSON.stringify(e)).not.toContain('Strict-Transport');
  });

  it('omit the host for local runs', () => {
    const e = toEntry({ ...sample, tier: 'local', host: 'app.example', input: '/home/me/app', finalUrl: '/home/me/app' }, 'scan-repo');
    expect(e.host).toBeUndefined();
    expect(JSON.stringify(e)).not.toContain('/home/me/app');
  });

  it('compare with the previous grade of the same host', () => {
    const prev: HistoryEntry = { ...toEntry(sample, 'grade', new Date('2026-10-12T00:00:00Z')), failed: ['hsts', 'csp', 'spf'], grade: 'C', score: 70 };
    const cur = toEntry(sample, 'grade');
    expect(comparisonLine(prev, cur)).toBe('Previous grade C 70 on 2026-10-12; 2 checks improved, 1 regressed: not-found-page');
    expect(comparisonLine({ ...prev, failed: cur.failed }, cur)).toBe('Previous grade C 70 on 2026-10-12; no checks changed');
    expect(comparisonLine({ ...prev, failed: ['hsts', 'not-found-page', 'csp'] }, cur)).toBe('Previous grade C 70 on 2026-10-12; 1 check improved, 0 regressed');
    const other = { ...prev, host: 'other.example' };
    const local = { ...prev, tier: 'local' as const, host: undefined };
    expect(previousFor([other, local, prev, other], cur)).toBe(prev);
    expect(previousFor([other, local], cur)).toBeUndefined();
    expect(previousFor([prev], { ...cur, host: undefined })).toBeUndefined();
  });

  it('are appended, capped at the newest 200, and the README is written once', () => {
    const dir = tmp();
    const seed: HistoryEntry[] = [];
    for (let i = 0; i < HISTORY_CAP; i++) seed.push({ ...toEntry(sample, 'grade', new Date(Date.UTC(2026, 0, 1 + (i % 28)))), id: `g_seed${i}` });
    mkdirSync(join(dir, '.securealy'));
    writeFileSync(historyPath(dir), JSON.stringify(seed));
    const kept = appendHistory({ ...toEntry(sample, 'grade'), id: 'g_new' }, dir)!;
    expect(kept.length).toBe(HISTORY_CAP);
    expect(kept[0]?.id).toBe('g_seed1');
    expect(kept[kept.length - 1]?.id).toBe('g_new');
    const onDisk = readHistory(dir);
    expect(onDisk.length).toBe(HISTORY_CAP);
    expect(onDisk[onDisk.length - 1]?.id).toBe('g_new');
    const readme = join(dir, '.securealy', 'README.md');
    expect(existsSync(readme)).toBe(true);
    const text = readFileSync(readme, 'utf8');
    expect(text).toContain('safe to commit');
    expect(text).toContain('SECUREALY_NO_HISTORY=1');
    writeFileSync(readme, 'edited by the user\n');
    appendHistory(toEntry(sample, 'grade'), dir);
    expect(readFileSync(readme, 'utf8')).toBe('edited by the user\n');
  });

  it('start fresh over a corrupt file and skip silently where the folder cannot be written', () => {
    const dir = tmp();
    mkdirSync(join(dir, '.securealy'));
    writeFileSync(historyPath(dir), '{not json');
    expect(readHistory(dir)).toEqual([]);
    expect(appendHistory(toEntry(sample, 'grade'), dir)?.length).toBe(1);
    const blocked = tmp();
    writeFileSync(join(blocked, '.securealy'), 'a file where the folder should be');
    const rec = recordRun(sample, 'grade', { cwd: blocked, env: {} });
    expect(rec.entry).toBeUndefined();
    expect(rec.comparison).toBeUndefined();
  });

  it('are disabled by the option and by SECUREALY_NO_HISTORY=1', () => {
    const a = tmp();
    recordRun(sample, 'grade', { cwd: a, env: {}, noHistory: true });
    expect(existsSync(join(a, '.securealy'))).toBe(false);
    const b = tmp();
    recordRun(sample, 'grade', { cwd: b, env: { SECUREALY_NO_HISTORY: '1' } });
    expect(existsSync(join(b, '.securealy'))).toBe(false);
    const c = tmp();
    recordRun(sample, 'grade', { cwd: c, env: { SECUREALY_NO_HISTORY: '0' } });
    expect(existsSync(historyPath(c))).toBe(true);
  });
});

describe('CLI history', () => {
  it('scan-repo appends an entry without the planted secret, and the next run compares nothing for a local tier', async () => {
    const repo = fixtureRepo();
    const cwd = tmp();
    const { out, ctx: first } = io({ cwd, env: {} });
    const code = await main(['scan-repo', repo, '--json'], first);
    expect(code).toBe(1); // the planted secret is a blocker
    const result = JSON.parse(out.join('\n')) as GradeResult;
    expect(result.checks.find((c) => c.id === 'repo-secrets')?.status).toBe('fail');
    const raw = readFileSync(historyPath(cwd), 'utf8');
    expect(raw).not.toContain(PLANTED);
    expect(raw).not.toContain('sk_liv');
    expect(raw).not.toContain(repo);
    expect(raw).not.toContain('index.js');
    const [entry] = readHistory(cwd);
    expect(entry).toMatchObject({ command: 'scan-repo', tier: 'local', grade: result.grade, score: result.score, id: result.id, engineVersion: ENGINE_VERSION });
    expect(entry?.host).toBeUndefined();
    expect(entry?.failed).toContain('repo-secrets');
    expect(Object.keys(entry ?? {}).sort()).toEqual(['at', 'command', 'engineVersion', 'failed', 'grade', 'id', 'score', 'summary', 'tier']);
    expect(existsSync(join(cwd, '.securealy', 'README.md'))).toBe(true);

    const second = io({ cwd, env: {} });
    await main(['scan-repo', repo], second.ctx);
    expect(readHistory(cwd).length).toBe(2);
    expect(second.out.join('\n')).not.toContain('Previous grade');
  });

  it('check-stripe never writes the key from the environment, even when the API echoes it', async () => {
    const cwd = tmp();
    const f = (async () => new Response(JSON.stringify({ error: { message: `Invalid API Key provided: ${STRIPE_KEY}` } }), { status: 401, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    const { out, ctx: run } = io({ cwd, env: { STRIPE_SECRET_KEY: STRIPE_KEY, SECUREALY_PRODUCTION_URL: 'https://app.example' }, fetch: f });
    await main(['check-stripe'], run);
    expect(out.join('\n')).not.toContain(STRIPE_KEY);
    const raw = readFileSync(historyPath(cwd), 'utf8');
    expect(raw).not.toContain(STRIPE_KEY);
    expect(raw).not.toContain('sk_tes');
    expect(readHistory(cwd)[0]?.command).toBe('check-stripe');
  });

  it('--no-history and SECUREALY_NO_HISTORY=1 leave no folder behind', async () => {
    const repo = fixtureRepo();
    const a = tmp();
    await main(['scan-repo', repo, '--no-history', '--json'], io({ cwd: a, env: {} }).ctx);
    expect(existsSync(join(a, '.securealy'))).toBe(false);
    const b = tmp();
    await main(['scan-repo', repo, '--json'], io({ cwd: b, env: { SECUREALY_NO_HISTORY: '1' } }).ctx);
    expect(existsSync(join(b, '.securealy'))).toBe(false);
  });

  it('prints the comparison line in the human report when a previous grade of the host exists', async () => {
    const cwd = tmp();
    const prev = { ...toEntry(sample, 'grade', new Date('2026-10-12T00:00:00Z')), failed: ['hsts', 'csp'] };
    appendHistory(prev, cwd);
    // A URL grade needs the network, so exercise the same path the CLI uses through recordRun.
    const rec = recordRun(sample, 'grade', { cwd, env: {} });
    expect(rec.comparison).toBe('Previous grade B 83 on 2026-10-12; 1 check improved, 1 regressed: not-found-page');
    expect(readHistory(cwd).length).toBe(2);
  });
});

describe('telemetry', () => {
  it('is off by default and when the variable is anything but 1', async () => {
    received.length = 0;
    const repo = fixtureRepo();
    await main(['scan-repo', repo, '--json'], io({ cwd: tmp(), env: {}, telemetryEndpoint: endpoint }).ctx);
    await main(['scan-repo', repo, '--json'], io({ cwd: tmp(), env: { SECUREALY_TELEMETRY: 'true' }, telemetryEndpoint: endpoint }).ctx);
    const rec = recordRun(sample, 'grade', { cwd: tmp(), env: {}, telemetryEndpoint: endpoint });
    await rec.telemetry;
    expect(received.length).toBe(0);
  });

  it('sends exactly the documented shape when SECUREALY_TELEMETRY=1, with no URL, host, path or evidence', async () => {
    received.length = 0;
    const repo = fixtureRepo();
    const cwd = tmp();
    const run = io({ cwd, env: { SECUREALY_TELEMETRY: '1' }, telemetryEndpoint: endpoint });
    await main(['scan-repo', repo, '--json'], run.ctx);
    const result = JSON.parse(run.out.join('\n')) as GradeResult;
    expect(received.length).toBe(1);
    const sent = received[0]!;
    expect(sent.headers['content-type']).toBe('application/json');
    expect(sent.headers['user-agent']).toMatch(/^securealy-cli\/\d+\.\d+\.\d+$/);
    const body = sent.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['command', 'counts', 'durationMs', 'engine', 'failed', 'grade', 'node', 'requests', 'score', 'stack', 'tier']);
    expect(body).toMatchObject({ command: 'scan-repo', tier: 'local', grade: result.grade, score: result.score, requests: result.requests, durationMs: result.durationMs, engine: ENGINE_VERSION });
    expect(Object.keys(body.counts as object).sort()).toEqual(['blocker', 'error', 'fail', 'pass', 'skip', 'warn']);
    expect(body.counts).toEqual({ pass: result.summary.pass, fail: result.summary.fail, warn: result.summary.warn, skip: result.summary.skip, error: result.summary.error, blocker: result.summary.blocker });
    expect(Object.keys(body.stack as object).sort()).toEqual(['builder', 'db', 'framework', 'host', 'payments']);
    expect(body.node).toBe(Number(process.versions.node.split('.')[0]));
    expect(body.failed).toContain('repo-secrets');
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(PLANTED);
    expect(raw).not.toContain('sk_liv');
    expect(raw).not.toContain(repo);
    expect(raw).not.toContain('http');
    for (const k of ['url', 'input', 'finalUrl', 'host', 'evidence', 'checks', 'id', 'gradedAt']) expect(body).not.toHaveProperty(k);
  });

  it('maps a URL grade to the payload with the stack kind and never the hostname', () => {
    const t = toTelemetry(sample, 'grade');
    expect(t.stack).toEqual({ host: 'vercel', builder: null, db: 'supabase', payments: null, framework: 'next' });
    expect(t.failed).toEqual(['hsts', 'not-found-page']);
    expect(JSON.stringify(t)).not.toContain('app.example');
  });

  it('swallows an unreachable endpoint', async () => {
    const rec = recordRun(sample, 'grade', { cwd: tmp(), env: { SECUREALY_TELEMETRY: '1' }, telemetryEndpoint: 'http://127.0.0.1:9/api/telemetry' });
    await expect(rec.telemetry).resolves.toBeUndefined();
    expect(rec.entry).toBeDefined();
  });
});
