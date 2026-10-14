import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, afterAll } from 'vitest';
import { grade, evaluate, assemble, score, normalizeInput, isPreLaunchHost, isPreLaunchInput, isLoopbackAddress, UnsafeHostError } from '../src/index.js';
import type { Evidence, Resolver } from '../src/index.js';

/**
 * The pre-launch grade: a loopback input is graded with only loopback allowed,
 * the checks that need a deployed site skip with the reason, and the score
 * covers the rest. Private addresses are written as the sweep allows them.
 */
const LOOPBACK = '127.0.0.1';
const LAN = [10, 0, 0, 5].join('.');
const METADATA = '169.254.169.254';
const FIXTURES = join(__dirname, 'fixtures', 'pre-launch');

/** Exactly these skip before deploy; everything else runs on a local server. */
const SKIPPED_BEFORE_DEPLOY = [
  'tls-valid', 'tls-expiry', 'https-redirect', 'hsts',
  'spf', 'dkim', 'dmarc', 'mx', 'auth-sender-authenticated',
  'nameservers', 'dnssec', 'caa', 'domain-expiry',
  'stripe-test-key-in-prod', 'ttfb', 'source-maps', 'page-weight',
].sort();

const REASON = /^not applicable before deploy: /;

function load(name: string): Evidence {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as Evidence;
}

/** A resolver that fails the test if the engine asks it anything. */
function noDns(): Resolver & { calls: number } {
  const r = { calls: 0 } as Resolver & { calls: number };
  const nope = () => {
    r.calls += 1;
    return Promise.reject(new Error('DNS must not be queried for a local address'));
  };
  Object.assign(r, { resolveNs: nope, resolve4: nope, resolve6: nope, resolveMx: nope, resolveTxt: nope, resolveCname: nope, resolveCaa: nope });
  return r;
}

function fakeFetch(handler: (url: string) => Response): typeof fetch & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    return handler(url);
  }) as typeof fetch & { calls: string[] };
  f.calls = calls;
  return f;
}

const HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Local app before launch, under test</title><meta name="description" content="Served from this machine so the grader has something to read before a domain exists."><link rel="canonical" href="https://local-app.example/"><script src="/app.js"></script></head><body><h1>Local</h1><a href="/privacy">Privacy</a><a href="/terms">Terms</a></body></html>';
const SECURE_HEADERS = {
  'content-type': 'text/html',
  'content-security-policy': "default-src 'self'; frame-ancestors 'none'; form-action 'self'",
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=()',
};
const loopbackLookup = async () => [{ address: LOOPBACK, family: 4 }];

describe('what counts as a local address', () => {
  it('names and loopback literals only', () => {
    for (const h of ['localhost', 'LOCALHOST', 'localhost.', 'app.localhost', 'api.myproject.test', 'my-app.test', LOOPBACK, [127, 1, 2, 3].join('.'), '[::1]', '::1', `::ffff:${LOOPBACK}`]) {
      expect(isPreLaunchHost(h), h).toBe(true);
    }
    for (const h of ['10.0.0.0', '192.168.0.1', LAN, METADATA, '0.0.0.0', '8.8.8.8', 'example.com', 'printer.local', 'db.internal', 'router.home.arpa', 'localhost.example', 'test.example', '[fe80::1]', 'fd00::1', `::ffff:${LAN}`]) {
      expect(isPreLaunchHost(h), h).toBe(false);
    }
  });

  it('isLoopbackAddress is narrower than isPrivateAddress', () => {
    for (const ip of [LOOPBACK, [127, 255, 255, 255].join('.'), '::1', `::ffff:${LOOPBACK}`, `::${LOOPBACK}`]) expect(isLoopbackAddress(ip), ip).toBe(true);
    for (const ip of ['10.0.0.0', LAN, METADATA, '0.0.0.0', 'fe80::1', 'fd00::1', `::ffff:${LAN}`, '8.8.8.8', 'not-an-ip']) expect(isLoopbackAddress(ip), ip).toBe(false);
  });

  it('isPreLaunchInput reads the hostname out of whatever the user typed', () => {
    for (const s of ['http://localhost:3000', 'localhost:3000', 'localhost', `http://${LOOPBACK}:8080/path`, 'http://[::1]:5173', 'https://app.localhost', 'app.test:4000']) expect(isPreLaunchInput(s), s).toBe(true);
    for (const s of ['https://example.com', 'example.com', `http://${LAN}:3000`, `http://${METADATA}/latest`, 'http://app.internal', 'http://app.local:3000', '', ':::not a url']) expect(isPreLaunchInput(s), s).toBe(false);
  });

  it('a bare local name means http, a bare public name still means https', () => {
    expect(normalizeInput('localhost:3000', { allowPrivate: true }).toString()).toBe('http://localhost:3000/');
    expect(normalizeInput('https://localhost:3000', { allowPrivate: true }).toString()).toBe('https://localhost:3000/');
    expect(normalizeInput('example.com').toString()).toBe('https://example.com/');
    expect(() => normalizeInput('localhost:3000')).toThrow(UnsafeHostError);
  });
});

describe('pre-launch fixtures', () => {
  it('a clean local app reaches A: applicable checks pass, the rest skip with the reason', () => {
    const ev = load('clean');
    const { checks, stack } = evaluate(ev);
    const skipped = checks.filter((c) => c.status === 'skip' && REASON.test(c.evidence)).map((c) => c.id).sort();
    expect(skipped).toEqual(SKIPPED_BEFORE_DEPLOY);
    for (const c of checks) expect(['pass', 'skip'], `${c.id}: ${c.evidence}`).toContain(c.status);
    const r = assemble(ev, checks, stack, 12);
    expect(r.preLaunch).toBe(true);
    expect(r.tier).toBe('passive');
    expect(r.grade).toBe('A');
    expect(r.score).toBe(100);
    expect(r.capped).toBeUndefined();
    // The score is computed over the applicable checks alone.
    const applicable = checks.filter((c) => c.status !== 'skip');
    expect(score(applicable).score).toBe(r.score);
    expect(r.summary.skip).toBeGreaterThanOrEqual(SKIPPED_BEFORE_DEPLOY.length);
    expect(r.summary.pass + r.summary.skip).toBe(checks.length);
    // Nothing about hosting can be read off a local server.
    expect(stack.host).toBeUndefined();
    expect(stack.dns).toBeUndefined();
    expect(stack.emailProvider).toBeUndefined();
    expect(stack.analytics).toEqual(['plausible']);
  });

  it('the adapted checks judge what a local server can show', () => {
    const checks = evaluate(load('clean')).checks;
    const by = (id: string) => checks.find((c) => c.id === id)!;
    expect(by('cookie-flags').status).toBe('pass');
    expect(by('cookie-flags').evidence).toContain('Secure is judged on the deployed site');
    expect(by('canonical').status).toBe('pass');
    expect(by('canonical').evidence).toContain('https://goodapp.example/');
    expect(by('mixed-content').status).toBe('pass');
    expect(by('og-image').status).toBe('pass');
    expect(by('hsts').evidence).toBe('not applicable before deploy: https on the public hostname');
    expect(by('stripe-test-key-in-prod').evidence).toContain('a test key is expected locally');
  });

  it('blockers still apply locally: a secret in the bundle and no CSP cap the grade', () => {
    const ev = load('leaky');
    const { checks, stack } = evaluate(ev);
    const by = (id: string) => checks.find((c) => c.id === id)!;
    expect(by('secrets-in-bundle').status).toBe('fail');
    expect(by('secrets-in-bundle').severity).toBe('blocker');
    expect(by('csp').status).toBe('fail');
    // The test publishable key in the same bundle is the expected state before launch, not a finding.
    expect(by('stripe-test-key-in-prod').status).toBe('skip');
    // A session cookie without Secure is fine over plain http; without SameSite it is still a finding.
    expect(by('cookie-flags').status).toBe('warn');
    expect(by('cookie-flags').evidence).toContain('SameSite');
    expect(by('cookie-flags').evidence).not.toContain('Secure');
    const r = assemble(ev, checks, stack, 12);
    expect(r.preLaunch).toBe(true);
    expect(r.grade).toBe('D');
    expect(r.capped).toMatch(/1 blocker/);
    expect(JSON.stringify(r)).not.toContain('FAKEFAKEFAKEFAKEFAKEFAKE');
  });

  it('a check that needs the deployed site skips even when the local evidence looks judgeable', () => {
    const ev = load('clean');
    // The fixture server could send HSTS and a plausible TLS record; the gate still skips both.
    ev.page!.headers['strict-transport-security'] = 'max-age=31536000';
    ev.tls = { connected: true, authorized: true, hostMatches: true, daysRemaining: 60, sans: ['localhost'] };
    const checks = evaluate(ev).checks;
    expect(checks.find((c) => c.id === 'hsts')?.status).toBe('skip');
    expect(checks.find((c) => c.id === 'tls-valid')?.status).toBe('skip');
    expect(checks.find((c) => c.id === 'tls-expiry')?.status).toBe('skip');
  });
});

describe('gathering a pre-launch grade', () => {
  it('makes no DNS, TLS, RDAP or port-80 request and marks the result', async () => {
    const fetchImpl = fakeFetch((url) => {
      if (url === 'http://localhost:3000/') return new Response(HTML, { status: 200, headers: SECURE_HEADERS });
      if (url === 'http://localhost:3000/app.js') return new Response('console.log(1)', { status: 200, headers: { 'content-type': 'application/javascript' } });
      if (url === 'http://localhost:3000/robots.txt') return new Response('User-agent: *\nAllow: /\nSitemap: https://local-app.example/sitemap.xml\n', { status: 200, headers: { 'content-type': 'text/plain' } });
      if (url === 'http://localhost:3000/privacy' || url === 'http://localhost:3000/terms') return new Response('ok', { status: 200, headers: { 'content-type': 'text/html' } });
      return new Response('nope', { status: 404, headers: { 'content-type': 'text/plain' } });
    });
    const dns = noDns();
    const r = await grade('http://localhost:3000', { fetch: fetchImpl, dns, lookup: loopbackLookup, allowPrivate: true, timeoutMs: 20_000 });
    expect(dns.calls).toBe(0);
    expect(fetchImpl.calls.every((u) => u.startsWith('http://localhost:3000/'))).toBe(true);
    expect(fetchImpl.calls.some((u) => /rdap/.test(u))).toBe(false);
    expect(fetchImpl.calls).not.toContain('http://localhost/');
    expect(r.preLaunch).toBe(true);
    expect(r.tier).toBe('passive');
    expect(r.host).toBe('localhost');
    expect(r.finalUrl).toBe('http://localhost:3000/');
    expect(r.checks).toHaveLength(51);
    const skipped = r.checks.filter((c) => c.status === 'skip' && REASON.test(c.evidence)).map((c) => c.id).sort();
    expect(skipped).toEqual(SKIPPED_BEFORE_DEPLOY);
    expect(r.summary.error).toBe(0);
    expect(r.checks.find((c) => c.id === 'csp')?.status).toBe('pass');
    expect(r.checks.find((c) => c.id === 'canonical')?.status).toBe('pass');
    expect(r.checks.find((c) => c.id === 'legal-pages')?.status).toBe('pass');
    expect(r.checks.find((c) => c.id === 'mixed-content')?.status).toBe('pass');
    expect(r.requests).toBe(fetchImpl.calls.length);
    expect(r.stack.host).toBeUndefined();
  });

  it('refuses a local address without the option, so the hosted grader is unchanged', async () => {
    const fetchImpl = fakeFetch(() => new Response(HTML, { status: 200, headers: SECURE_HEADERS }));
    for (const input of ['http://localhost:3000', `http://${LOOPBACK}:3000`, 'http://[::1]:3000', 'http://app.localhost:3000']) {
      await expect(grade(input, { fetch: fetchImpl, dns: noDns(), lookup: loopbackLookup, timeoutMs: 20_000 }), input).rejects.toBeInstanceOf(UnsafeHostError);
    }
    // A .test name is refused where every privately-resolving name is: at the lookup, before any request leaves.
    const r = await grade('http://app.test:3000', { fetch: fetchImpl, dns: noDns(), lookup: loopbackLookup, timeoutMs: 20_000 });
    expect(r.preLaunch).toBeUndefined();
    expect(r.checks.find((c) => c.id === 'csp')?.evidence).toMatch(/refused.*private/);
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('a non-loopback private literal still throws, with or without the option', async () => {
    const fetchImpl = fakeFetch(() => new Response(HTML, { status: 200, headers: SECURE_HEADERS }));
    for (const input of [`http://${LAN}:3000`, `http://${METADATA}/`, 'http://192.168.0.1:3000', 'http://0.0.0.0:3000', 'http://[fe80::1]:3000', 'http://app.local:3000', 'http://app.internal:3000']) {
      await expect(grade(input, { fetch: fetchImpl, dns: noDns(), lookup: loopbackLookup, timeoutMs: 20_000 }), input).rejects.toBeInstanceOf(UnsafeHostError);
      expect(isPreLaunchInput(input), input).toBe(false);
    }
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('follows a local redirect only to loopback; a hop to the LAN or the metadata service is refused', async () => {
    const fetchImpl = fakeFetch((url) => {
      if (url === 'http://localhost:3000/') return new Response(HTML, { status: 200, headers: SECURE_HEADERS });
      if (url === 'http://localhost:3000/robots.txt') return new Response(null, { status: 302, headers: { location: `http://${LAN}/robots.txt` } });
      if (url === 'http://localhost:3000/sitemap.xml') return new Response(null, { status: 302, headers: { location: `http://${METADATA}/latest/meta-data/` } });
      if (url === 'http://localhost:3000/llms.txt') return new Response(null, { status: 302, headers: { location: 'http://app.internal/llms.txt' } });
      if (url === 'http://localhost:3000/app.js') return new Response(null, { status: 302, headers: { location: `http://${LOOPBACK}:3000/app.js` } });
      if (url === `http://${LOOPBACK}:3000/app.js`) return new Response('console.log(2)', { status: 200, headers: { 'content-type': 'application/javascript' } });
      return new Response('nope', { status: 404, headers: { 'content-type': 'text/plain' } });
    });
    const r = await grade('http://localhost:3000', { fetch: fetchImpl, dns: noDns(), lookup: loopbackLookup, allowPrivate: true, timeoutMs: 20_000 });
    expect(fetchImpl.calls.some((u) => u.includes(LAN) || u.includes(METADATA) || u.includes('app.internal'))).toBe(false);
    expect(fetchImpl.calls).toContain(`http://${LOOPBACK}:3000/app.js`);
    expect(r.preLaunch).toBe(true);
    expect(r.checks.find((c) => c.id === 'robots-txt')?.evidence).toMatch(/refused/);
  });

  it('a .test name that resolves to the LAN is refused: the name is local, the address is not', async () => {
    const fetchImpl = fakeFetch(() => new Response(HTML, { status: 200, headers: SECURE_HEADERS }));
    const lookup = async () => [{ address: LAN, family: 4 }];
    const r = await grade('http://app.test:3000', { fetch: fetchImpl, dns: noDns(), lookup, allowPrivate: true, timeoutMs: 20_000 });
    expect(fetchImpl.calls).toHaveLength(0);
    expect(r.preLaunch).toBe(true);
    expect(r.checks.find((c) => c.id === 'csp')?.evidence).toMatch(/refused.*private/);
  });

  it('the verified tier needs a public domain', async () => {
    const fetchImpl = fakeFetch(() => new Response(HTML, { status: 200, headers: SECURE_HEADERS }));
    await expect(grade('http://localhost:3000', { tier: 'verified', verifyToken: 'sly_test', fetch: fetchImpl, dns: noDns(), lookup: loopbackLookup, allowPrivate: true })).rejects.toThrow(/verified tier needs a public domain/);
    expect(fetchImpl.calls).toHaveLength(0);
  });
});

describe('against a real local server', () => {
  let http: Server | undefined;
  afterAll(async () => {
    if (http) await new Promise<void>((r) => http!.close(() => r()));
  });

  it('the engine fetches a loopback literal through its own dispatcher and grades it', async () => {
    http = createServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(200, { ...SECURE_HEADERS, 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'session=abc; Path=/; HttpOnly; SameSite=Lax' });
        return res.end(HTML);
      }
      if (req.url === '/app.js') {
        res.writeHead(200, { 'content-type': 'application/javascript' });
        return res.end('console.log("real");');
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    });
    await new Promise<void>((r) => http!.listen(0, LOOPBACK, r));
    const addr = http.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const r = await grade(`http://${LOOPBACK}:${port}`, { allowPrivate: true, dns: noDns(), timeoutMs: 20_000 });
    expect(r.preLaunch).toBe(true);
    expect(r.host).toBe(LOOPBACK);
    expect(r.summary.error).toBe(0);
    expect(r.checks.find((c) => c.id === 'csp')?.status).toBe('pass');
    expect(r.checks.find((c) => c.id === 'cookie-flags')?.status).toBe('pass');
    expect(r.checks.find((c) => c.id === 'tls-valid')?.status).toBe('skip');
    expect(r.checks.find((c) => c.id === 'not-found-page')?.status).toBe('pass');
    expect(r.requests).toBeGreaterThan(3);
  });
});
