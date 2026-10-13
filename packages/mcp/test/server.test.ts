import { createServer as createHttpServer } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Resolver } from 'securealy-core';
import { createServer } from '../src/server.js';
import { Redactor } from '../src/redact.js';
import { summarize } from '../src/summary.js';

const FIXTURE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Fixture app for the Securealy MCP tests</title><meta name="description" content="A tiny page served by the test suite so grade_url has something real to fetch.">
<link rel="canonical" href="https://fixture.example/"><script src="/app.js"></script></head>
<body><h1>Fixture</h1><a href="/privacy">Privacy</a><a href="/terms">Terms</a></body></html>`;
// Random-looking so the placeholder guard does not dismiss it; FAKE marks it for the repo sweep.
const FIXTURE_SECRET = 'sk_live_' + 'FAKE' + 'k7Qm2xP9vL4nR8tW3yB6';
const FIXTURE_JS = `console.log("hello");const stripe="${FIXTURE_SECRET}";`;

function fakeResolver(): Resolver {
  const nodata = () => Promise.reject(Object.assign(new Error('ENODATA'), { code: 'ENODATA' }));
  return { resolveNs: () => Promise.resolve(['ns1.dns.example']), resolve4: () => Promise.resolve(['127.0.0.1']), resolve6: nodata, resolveMx: nodata, resolveTxt: nodata, resolveCname: nodata, resolveCaa: nodata };
}

let http: HttpServer;
let base = '';
const tmp: string[] = [];
/** Telemetry POSTs the fixture server received, and waiters for the next one. */
const telemetry: { headers: Record<string, string | string[] | undefined>; body: Record<string, unknown> }[] = [];
let telemetryWaiters: (() => void)[] = [];
const nextTelemetry = () => new Promise<void>((r) => telemetryWaiters.push(r));
const tmpDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'securealy-mcp-'));
  tmp.push(d);
  return d;
};

beforeAll(async () => {
  http = createHttpServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/telemetry') {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        telemetry.push({ headers: req.headers, body: JSON.parse(raw) as Record<string, unknown> });
        res.writeHead(204);
        res.end();
        const w = telemetryWaiters;
        telemetryWaiters = [];
        for (const r of w) r();
      });
      return;
    }
    const headers = { 'strict-transport-security': 'max-age=31536000', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' };
    if (req.url === '/') {
      res.writeHead(200, { ...headers, 'content-type': 'text/html; charset=utf-8' });
      return res.end(FIXTURE_HTML);
    }
    if (req.url === '/app.js') {
      res.writeHead(200, { ...headers, 'content-type': 'application/javascript' });
      return res.end(FIXTURE_JS);
    }
    if (req.url === '/robots.txt') {
      res.writeHead(200, { ...headers, 'content-type': 'text/plain' });
      return res.end('User-agent: *\nAllow: /\n');
    }
    res.writeHead(404, { ...headers, 'content-type': 'text/plain' });
    res.end('not found');
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  const addr = http.address();
  base = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
});

afterAll(async () => {
  await new Promise<void>((r) => http.close(() => r()));
  for (const d of tmp) rmSync(d, { recursive: true, force: true });
});

/** Real fetch for the fixture host; everything else (RDAP, securealy.com, Stripe) answers from the table. */
function routedFetch(table: Record<string, { status: number; body: string }> = {}): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (base && url.startsWith(base)) return fetch(input, init);
    if (url.startsWith('http://127.0.0.1') || url.startsWith('https://127.0.0.1')) return new Response('', { status: 404 });
    const hit = Object.entries(table).find(([k]) => url.includes(k));
    if (hit) return new Response(hit[1].body, { status: hit[1].status, headers: { 'content-type': 'application/json' } });
    return new Response('{"error":"not mocked"}', { status: 404, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

async function connect(opts: Parameters<typeof createServer>[0] = {}) {
  // A fresh working directory per server so the run record never lands in the repository.
  const server = createServer({ fetch: routedFetch(), dns: fakeResolver(), skipDnssec: true, cwd: tmpDir(), env: {}, ...opts });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await server.connect(serverT);
  await client.connect(clientT);
  return { client, server };
}

function text(r: { content: unknown }): string {
  const c = r.content as { type: string; text?: string }[];
  return c.map((x) => x.text ?? '').join('\n');
}

describe('tools/list', () => {
  it('exposes the nine tools with titles, descriptions and annotations', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['check_rls', 'check_stripe', 'check_vercel_env', 'fetch_fix', 'get_check', 'grade_url', 'list_checks', 'post_result', 'scan_repo']);
    for (const t of tools) {
      expect(t.title, t.name).toBeTruthy();
      expect(t.description?.length ?? 0, t.name).toBeGreaterThan(80);
      expect(t.inputSchema.type).toBe('object');
      expect(t.annotations, t.name).toBeDefined();
    }
    const post = tools.find((t) => t.name === 'post_result')!;
    expect(post.annotations?.readOnlyHint).toBe(false);
    expect(post.annotations?.destructiveHint).toBe(false);
    const gradeTool = tools.find((t) => t.name === 'grade_url')!;
    expect(gradeTool.annotations?.readOnlyHint).toBe(true);
    expect(gradeTool.annotations?.openWorldHint).toBe(true);
    const scan = tools.find((t) => t.name === 'scan_repo')!;
    expect(scan.annotations?.openWorldHint).toBe(false);
  });

  it('serves the catalogue and the spec as resources', async () => {
    const { client } = await connect();
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual(['securealy://checks', 'securealy://spec']);
    const checks = await client.readResource({ uri: 'securealy://checks' });
    const parsed = JSON.parse((checks.contents[0] as { text: string }).text) as { id: string }[];
    expect(parsed.length).toBe(65);
    const spec = await client.readResource({ uri: 'securealy://spec' });
    expect((spec.contents[0] as { text: string }).text).toContain('# Securealy engine spec');
  });
});

describe('grade_url', () => {
  it('grades a local fixture server passively, summarises it and redacts the bundle secret', async () => {
    const { client } = await connect();
    const r = await client.callTool({ name: 'grade_url', arguments: { url: base } });
    expect(r.isError).toBeFalsy();
    const t = text(r);
    expect(t).toMatch(/^Grade [A-F] \(\d+\/100\), passive tier/);
    expect(t).toContain('GradeResult JSON:');
    const structured = r.structuredContent as { schema: number; checks: { id: string; status: string; evidence: string }[]; grade: string };
    expect(structured.schema).toBe(1);
    expect(structured.checks.length).toBeGreaterThan(40);
    const secrets = structured.checks.find((c) => c.id === 'secrets-in-bundle')!;
    expect(secrets.status).toBe('fail');
    expect(t).toContain('BLOCKERS');
    expect(t).toContain('secrets-in-bundle');
    expect(t).not.toContain(FIXTURE_SECRET);
    expect(JSON.stringify(r)).not.toContain('4'.repeat(24));
    const hsts = structured.checks.find((c) => c.id === 'hsts')!;
    expect(hsts.status).toBe('pass');
  });

  it('refuses verified without a token and surfaces the hosted API error text', async () => {
    const { client } = await connect({ fetch: routedFetch({ '/api/grade': { status: 403, body: '{"error":"domain not verified"}' } }) });
    const noToken = await client.callTool({ name: 'grade_url', arguments: { url: 'https://fixture.example', tier: 'verified' } });
    expect(noToken.isError).toBe(true);
    expect(text(noToken)).toContain('needs a Securealy project token');
    const rejected = await client.callTool({ name: 'grade_url', arguments: { url: 'https://fixture.example', tier: 'verified', token: 'sly_test_token_1234567890' } });
    expect(rejected.isError).toBe(true);
    expect(text(rejected)).toContain('403');
    expect(text(rejected)).toContain('domain not verified');
    expect(JSON.stringify(rejected)).not.toContain('sly_test_token_1234567890');
  });

  it('returns the hosted result when the API answers done', async () => {
    const fake = { schema: 1, id: 'g_1', input: 'https://fixture.example', finalUrl: 'https://fixture.example/', host: 'fixture.example', gradedAt: '2026-10-12T00:00:00Z', tier: 'verified', grade: 'B', score: 80, summary: { blocker: 0, fail: 1, warn: 0, pass: 10, skip: 0, error: 0 }, stack: {}, checks: [{ id: 'hsts', status: 'fail', severity: 'high', evidence: 'missing' }], requests: 3, durationMs: 10 };
    const { client } = await connect({ fetch: routedFetch({ '/api/grade': { status: 200, body: JSON.stringify({ id: 'g_1', status: 'done', result: fake }) } }) });
    const r = await client.callTool({ name: 'grade_url', arguments: { url: 'https://fixture.example', tier: 'verified', token: 'sly_x_1234567890' } });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toMatch(/^Grade B \(80\/100\), verified tier/);
    expect(text(r)).toContain('hsts');
  });
});

describe('scan_repo', () => {
  it('gates on folder trust, then runs the three repo checks', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, '.gitignore'), '.env*\nnode_modules/\n');
    writeFileSync(join(dir, '.env.example'), 'STRIPE_SECRET_KEY=\n');
    writeFileSync(join(dir, 'index.js'), 'const k = process.env.STRIPE_SECRET_KEY;\n');
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example' } });
    git('init', '-q');
    git('add', '-A');
    git('commit', '-q', '-m', 'fixture');

    const { client } = await connect({ cwd: dir });
    const first = await client.callTool({ name: 'scan_repo', arguments: {} });
    expect(first.isError).toBeFalsy();
    expect((first.structuredContent as { trustRequired?: boolean }).trustRequired).toBe(true);
    expect(text(first)).toContain('trust');
    expect(text(first)).toContain('"trust": true');

    const stillGated = await client.callTool({ name: 'scan_repo', arguments: { path: dir } });
    expect((stillGated.structuredContent as { trustRequired?: boolean }).trustRequired).toBe(true);

    const second = await client.callTool({ name: 'scan_repo', arguments: { path: dir, trust: true } });
    expect(second.isError).toBeFalsy();
    const s = second.structuredContent as { tier: string; checks: { id: string }[] };
    expect(s.tier).toBe('local');
    expect(s.checks.map((c) => c.id).sort()).toEqual(['env-example-parity', 'gitignore-env-coverage', 'repo-secrets']);

    const third = await client.callTool({ name: 'scan_repo', arguments: { path: dir } });
    expect((third.structuredContent as { trustRequired?: boolean }).trustRequired).toBeUndefined();
    expect((third.structuredContent as { tier: string }).tier).toBe('local');
  });

  it('reports a missing folder as an error', async () => {
    const { client } = await connect();
    const r = await client.callTool({ name: 'scan_repo', arguments: { path: '/definitely/not/here/securealy' } });
    expect(r.isError).toBe(true);
  });
});

describe('redaction', () => {
  it('Redactor strips known key shapes and literal env values', () => {
    const red = new Redactor();
    red.learnEnv({ VERCEL_TOKEN: 'plainlookingtoken1234567890', NEXT_PUBLIC_SITE_URL: 'https://fixture.example', SHORT_SECRET: 'abc' });
    red.learn('sly_argument_token_xyz');
    const out = red.text('token plainlookingtoken1234567890 key sk_live_' + 'a'.repeat(24) + ' arg sly_argument_token_xyz site https://fixture.example abc');
    expect(out).not.toContain('plainlookingtoken1234567890');
    expect(out).not.toContain('a'.repeat(24));
    expect(out).not.toContain('sly_argument_token_xyz');
    expect(out).toContain('https://fixture.example');
    expect(out).toContain('abc');
    expect(red.value({ nested: { v: 'plainlookingtoken1234567890' } })).toEqual({ nested: { v: 'plainl…' } });
  });

  it('never echoes STRIPE_SECRET_KEY through check_stripe, even when the API echoes it back', async () => {
    const key = 'sk_test_' + 'b'.repeat(24);
    const { client } = await connect({ env: { STRIPE_SECRET_KEY: key }, fetch: routedFetch({ 'api.stripe.com': { status: 401, body: JSON.stringify({ error: { message: `Invalid API Key provided: ${key}` } }) } }) });
    const r = await client.callTool({ name: 'check_stripe', arguments: { productionHost: 'fixture.example' } });
    expect(JSON.stringify(r)).not.toContain(key);
    const s = r.structuredContent as { checks: { id: string }[] };
    expect(s.checks.map((c) => c.id)).toEqual(['stripe-webhook-wiring']);
  });

  it('check_rls and check_vercel_env skip cleanly with nothing in the environment', async () => {
    const { client } = await connect({ env: {} });
    const rls = await client.callTool({ name: 'check_rls', arguments: {} });
    expect((rls.structuredContent as { checks: { id: string; status: string }[] }).checks.map((c) => c.id).sort()).toEqual(['rls-policies', 'supabase-auth-config']);
    const vercel = await client.callTool({ name: 'check_vercel_env', arguments: { projectId: 'prj_x' } });
    expect((vercel.structuredContent as { checks: { id: string }[] }).checks.map((c) => c.id)).toEqual(['vercel-env-hygiene']);
  });
});

describe('catalogue tools', () => {
  it('get_check returns the entry and page URL, and fails on unknown ids', async () => {
    const { client } = await connect();
    const r = await client.callTool({ name: 'get_check', arguments: { id: 'hsts' } });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain('https://securealy.com/checks/hsts');
    expect((r.structuredContent as { check: { id: string } }).check.id).toBe('hsts');
    const bad = await client.callTool({ name: 'get_check', arguments: { id: 'hsts-nope' } });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toContain('hsts');
  });

  it('list_checks filters by category and tier', async () => {
    const { client } = await connect();
    const r = await client.callTool({ name: 'list_checks', arguments: { tier: 'local' } });
    expect((r.structuredContent as { count: number }).count).toBe(7);
    const p = await client.callTool({ name: 'list_checks', arguments: { category: 'payments' } });
    const ids = (p.structuredContent as { checks: { id: string }[] }).checks.map((c) => c.id);
    expect(ids).toContain('stripe-test-key-in-prod');
  });

  it('fetch_fix falls back to the catalogue entry on 404 and returns the body on 200', async () => {
    const miss = await connect();
    const r = await miss.client.callTool({ name: 'fetch_fix', arguments: { id: 'csp' } });
    expect(r.isError).toBeFalsy();
    expect((r.structuredContent as { fixAvailable: boolean }).fixAvailable).toBe(false);
    expect(text(r)).toContain('https://securealy.com/checks/csp');
    const hit = await connect({ fetch: routedFetch({ '/checks/csp.json': { status: 200, body: '{"id":"csp","fix":"Add a Content-Security-Policy header."}' } }) });
    const r2 = await hit.client.callTool({ name: 'fetch_fix', arguments: { id: 'csp' } });
    expect((r2.structuredContent as { fixAvailable: boolean }).fixAvailable).toBe(true);
    expect(text(r2)).toContain('Add a Content-Security-Policy header.');
  });

  it('post_result sends the Bearer token and reports the answer without echoing the token', async () => {
    const seen: { auth?: string; body?: string } = {};
    const f = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/results')) {
        seen.auth = (init?.headers as Record<string, string>)['authorization'];
        seen.body = String(init?.body);
        return new Response('{"stored":true}', { status: 201 });
      }
      return new Response('', { status: 404 });
    }) as typeof fetch;
    const { client } = await connect({ fetch: f });
    const result = { schema: 1, id: 'g_2', input: '/repo', finalUrl: '/repo', host: 'local', gradedAt: '2026-10-12T00:00:00Z', tier: 'local', grade: 'A', score: 100, summary: { blocker: 0, fail: 0, warn: 0, pass: 3, skip: 0, error: 0 }, stack: {}, checks: [], requests: 0, durationMs: 1 };
    const r = await client.callTool({ name: 'post_result', arguments: { result, token: 'sly_post_token_1234567890' } });
    expect(r.isError).toBeFalsy();
    expect(seen.auth).toBe('Bearer sly_post_token_1234567890');
    expect(JSON.parse(seen.body ?? '{}').id).toBe('g_2');
    expect(JSON.stringify(r)).not.toContain('sly_post_token_1234567890');
  });
});

describe('summarize', () => {
  it('lists blockers first, then fails by category', () => {
    const r = {
      schema: 1 as const, id: 'g', input: 'https://x.example', finalUrl: 'https://x.example/', host: 'x.example', gradedAt: '', tier: 'passive' as const, grade: 'D' as const, score: 50, capped: 'D or lower because of 1 blocker',
      summary: { blocker: 1, fail: 1, warn: 0, pass: 1, skip: 0, error: 0 }, stack: { host: 'vercel' },
      checks: [
        { id: 'secrets-in-bundle', status: 'fail' as const, severity: 'blocker' as const, evidence: 'sk_liv… found' },
        { id: 'title', status: 'fail' as const, severity: 'high' as const, evidence: 'missing' },
        { id: 'hsts', status: 'pass' as const, severity: 'high' as const, evidence: 'ok' },
      ],
      requests: 5, durationMs: 100,
    };
    const s = summarize(r);
    expect(s.split('\n')[0]).toBe('Grade D (50/100), passive tier, https://x.example -> https://x.example/');
    expect(s.indexOf('BLOCKERS')).toBeLessThan(s.indexOf('seo:'));
    expect(s).toContain('Stack: host=vercel');
    expect(s).not.toContain('hsts');
  });
});

describe('learning record', () => {
  const history = (cwd: string) => JSON.parse(readFileSync(join(cwd, '.securealy', 'history.json'), 'utf8')) as Record<string, unknown>[];

  it('grade_url appends an entry with the host and no evidence, then reports the change on the next grade', async () => {
    const cwd = tmpDir();
    const { client } = await connect({ cwd });
    const first = await client.callTool({ name: 'grade_url', arguments: { url: base } });
    expect(first.isError).toBeFalsy();
    expect(text(first)).not.toContain('Previous grade');
    const raw = readFileSync(join(cwd, '.securealy', 'history.json'), 'utf8');
    expect(raw).not.toContain(FIXTURE_SECRET);
    expect(raw).not.toContain('sk_liv');
    expect(raw).not.toContain('found in');
    const [entry] = history(cwd);
    const structured = first.structuredContent as { id: string; grade: string; score: number; host: string };
    expect(entry).toMatchObject({ command: 'mcp.grade_url', tier: 'passive', host: structured.host, grade: structured.grade, score: structured.score, id: structured.id });
    expect(Object.keys(entry ?? {}).sort()).toEqual(['at', 'command', 'engineVersion', 'failed', 'grade', 'host', 'id', 'score', 'summary', 'tier']);
    expect(entry?.failed).toContain('secrets-in-bundle');
    expect(existsSync(join(cwd, '.securealy', 'README.md'))).toBe(true);

    const second = await client.callTool({ name: 'grade_url', arguments: { url: base } });
    const t = text(second);
    expect(t).toMatch(/\nPrevious grade [A-F] \d+ on \d{4}-\d{2}-\d{2}; no checks changed\n/);
    expect(t.indexOf('Previous grade')).toBeLessThan(t.indexOf('GradeResult JSON:'));
    expect(history(cwd).length).toBe(2);
  });

  it('local tools record without a host, and SECUREALY_NO_HISTORY=1 records nothing', async () => {
    const cwd = tmpDir();
    const { client } = await connect({ cwd });
    await client.callTool({ name: 'check_vercel_env', arguments: { projectId: 'prj_x' } });
    const [entry] = history(cwd);
    expect(entry?.command).toBe('mcp.check_vercel_env');
    expect(entry?.tier).toBe('local');
    expect(entry).not.toHaveProperty('host');

    const off = tmpDir();
    const quiet = await connect({ cwd: off, env: { SECUREALY_NO_HISTORY: '1' } });
    await quiet.client.callTool({ name: 'check_rls', arguments: {} });
    expect(existsSync(join(off, '.securealy'))).toBe(false);
  });

  it('telemetry is off by default and sends only the aggregate shape when SECUREALY_TELEMETRY=1', async () => {
    telemetry.length = 0;
    const silent = await connect({ cwd: tmpDir(), telemetryEndpoint: `${base}/api/telemetry` });
    await silent.client.callTool({ name: 'check_rls', arguments: {} });
    await new Promise((r) => setTimeout(r, 150));
    expect(telemetry.length).toBe(0);

    const loud = await connect({ cwd: tmpDir(), env: { SECUREALY_TELEMETRY: '1' }, telemetryEndpoint: `${base}/api/telemetry` });
    const arrived = nextTelemetry();
    const r = await loud.client.callTool({ name: 'grade_url', arguments: { url: base } });
    await arrived;
    expect(telemetry.length).toBe(1);
    const sent = telemetry[0]!;
    expect(sent.headers['user-agent']).toMatch(/^securealy-mcp\/\d+\.\d+\.\d+$/);
    expect(Object.keys(sent.body).sort()).toEqual(['command', 'counts', 'durationMs', 'engine', 'failed', 'grade', 'node', 'requests', 'score', 'stack', 'tier']);
    const structured = r.structuredContent as { grade: string; score: number; requests: number; summary: Record<string, number> };
    expect(sent.body).toMatchObject({ command: 'mcp.grade_url', tier: 'passive', grade: structured.grade, score: structured.score, requests: structured.requests });
    expect(sent.body.counts).toEqual({ pass: structured.summary.pass, fail: structured.summary.fail, warn: structured.summary.warn, skip: structured.summary.skip, error: structured.summary.error, blocker: structured.summary.blocker });
    expect(Object.keys(sent.body.stack as object).sort()).toEqual(['builder', 'db', 'framework', 'host', 'payments']);
    expect(sent.body.failed).toContain('secrets-in-bundle');
    const raw = JSON.stringify(sent.body);
    expect(raw).not.toContain('127.0.0.1');
    expect(raw).not.toContain(FIXTURE_SECRET);
    expect(raw).not.toContain('sk_liv');
    for (const k of ['url', 'input', 'finalUrl', 'host', 'evidence', 'checks', 'id']) expect(sent.body).not.toHaveProperty(k);
  });
});
