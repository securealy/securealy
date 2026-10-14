import { describe, it, expect } from 'vitest';
import { grade, OptOutError, VerificationError, verificationFingerprint, USER_AGENT } from '../src/index.js';
import type { Resolver } from '../src/index.js';

/** The guard resolves every test host to one public address; the engine never touches real DNS here. */
const PUBLIC_V4 = '8.8.8.8';
const publicLookup = async () => [{ address: PUBLIC_V4, family: 4 }];

function fakeResolver(txt: Record<string, string[][]> = {}): Resolver {
  const nodata = () => Promise.reject(Object.assign(new Error('ENODATA'), { code: 'ENODATA' }));
  return {
    resolveNs: () => Promise.resolve(['ns1.dns.example', 'ns2.dns.example']),
    resolve4: () => Promise.resolve([PUBLIC_V4]),
    resolve6: nodata,
    resolveMx: nodata,
    resolveTxt: (name) => (txt[name] ? Promise.resolve(txt[name] as string[][]) : nodata()),
    resolveCname: nodata,
    resolveCaa: nodata,
  };
}

function fakeFetch(handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>): typeof fetch & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    return handler(url, init);
  }) as typeof fetch & { calls: string[] };
  f.calls = calls;
  return f;
}

const HTML = '<!doctype html><html lang="en"><head><title>Opt out test site title here</title></head><body><h1>Hi</h1></body></html>';

describe('opt-out', () => {
  it('honors the DNS TXT opt-out before any HTTP request', async () => {
    const fetchImpl = fakeFetch(() => new Response(HTML, { status: 200, headers: { 'content-type': 'text/html' } }));
    const dns = fakeResolver({ '_securealy.optout.example': [['optout']] });
    await expect(grade('https://optout.example', { fetch: fetchImpl, dns, lookup: publicLookup, skipDnssec: true })).rejects.toBeInstanceOf(OptOutError);
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('honors the X-Securealy: optout header after the first request', async () => {
    const fetchImpl = fakeFetch(() => new Response(HTML, { status: 200, headers: { 'content-type': 'text/html', 'x-securealy': 'optout' } }));
    await expect(grade('https://header-optout.example', { fetch: fetchImpl, dns: fakeResolver(), lookup: publicLookup, skipDnssec: true })).rejects.toMatchObject({ name: 'OptOutError', via: 'header' });
    expect(fetchImpl.calls).toHaveLength(1);
  });
});

describe('grade', () => {
  it('sends the exact User-Agent and stays within the request budget', async () => {
    let ua: string | null = null;
    const fetchImpl = fakeFetch((url, init) => {
      const h = init?.headers as Record<string, string>;
      ua = h['user-agent'] ?? null;
      if (url.startsWith('http://')) return new Response(null, { status: 308, headers: { location: url.replace('http://', 'https://') } });
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /\n', { status: 200, headers: { 'content-type': 'text/plain' } });
      if (/rdap/.test(url)) return new Response(JSON.stringify({ events: [{ eventAction: 'expiration', eventDate: '2030-01-01T00:00:00Z' }] }), { status: 200, headers: { 'content-type': 'application/rdap+json' } });
      if (url === 'https://budget.example/') return new Response(HTML, { status: 200, headers: { 'content-type': 'text/html' } });
      return new Response('nope', { status: 404, headers: { 'content-type': 'text/plain' } });
    });
    const r = await grade('https://budget.example', { fetch: fetchImpl, dns: fakeResolver(), lookup: publicLookup, skipDnssec: true, timeoutMs: 20_000 });
    expect(ua).toBe(USER_AGENT);
    expect(r.schema).toBe(1);
    expect(r.id).toMatch(/^g_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(r.requests).toBeLessThanOrEqual(25);
    expect(r.requests).toBe(fetchImpl.calls.length);
    expect(r.checks).toHaveLength(51);
    expect(r.tier).toBe('passive');
    expect(r.host).toBe('budget.example');
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
    const tls = r.checks.find((c) => c.id === 'tls-valid');
    expect(tls?.status).toBe('fail'); // no real TLS endpoint for budget.example
  });

  it('produces a clean result for a host that does not exist', async () => {
    const fetchImpl = fakeFetch((url) => {
      if (/rdap/.test(url)) return new Response('{"errorCode":404}', { status: 404, headers: { 'content-type': 'application/rdap+json' } });
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND' } });
    });
    const dead: Resolver = {
      resolveNs: () => Promise.reject(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })),
      resolve4: () => Promise.reject(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })),
      resolve6: () => Promise.reject(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })),
      resolveMx: () => Promise.reject(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })),
      resolveTxt: () => Promise.reject(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })),
      resolveCname: () => Promise.reject(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })),
    };
    const r = await grade('https://does-not-exist-securealy-test.invalid', { fetch: fetchImpl, dns: dead, lookup: publicLookup, skipDnssec: true, timeoutMs: 20_000 });
    expect(r.checks).toHaveLength(51);
    expect(r.checks.find((c) => c.id === 'tls-valid')?.status).toBe('fail');
    // rdap.org answered 404 without redirecting, so there is no RDAP server for the TLD: not a verdict on the domain.
    expect(r.checks.find((c) => c.id === 'domain-expiry')?.status).toBe('skip');
    expect(r.summary.skip).toBeGreaterThan(30);
    expect(r.summary.error).toBe(0);
    expect(r.grade).toBe('F');
    expect(r.capped).toMatch(/1 blocker/);
  });

  it('turns a 403 bot block into error statuses with evidence, not a crash', async () => {
    const fetchImpl = fakeFetch((url) => {
      if (/rdap/.test(url)) return new Response('{}', { status: 404 });
      return new Response('<html><body>Access denied</body></html>', { status: 403, headers: { 'content-type': 'text/html' } });
    });
    const r = await grade('https://blocked.example', { fetch: fetchImpl, dns: fakeResolver(), lookup: publicLookup, skipDnssec: true, timeoutMs: 20_000 });
    const errors = r.checks.filter((c) => c.status === 'error');
    expect(errors.length).toBeGreaterThan(20);
    for (const e of errors) expect(e.evidence).toMatch(/403|cannot judge|unavailable|not found/);
    expect(r.summary.error).toBe(errors.length);
  });

  it('refuses the verified tier without proof of ownership', async () => {
    const fetchImpl = fakeFetch((url) => {
      if (url === 'https://unverified.example/') return new Response(HTML, { status: 200, headers: { 'content-type': 'text/html' } });
      return new Response('x', { status: 404 });
    });
    await expect(grade('https://unverified.example', { tier: 'verified', verifyToken: 'sly_test', fetch: fetchImpl, dns: fakeResolver(), lookup: publicLookup, skipDnssec: true, timeoutMs: 20_000 })).rejects.toBeInstanceOf(VerificationError);
  });

  it('runs the verified probes once the DNS fingerprint matches', async () => {
    const token = 'sly_FAKEtoken';
    const fp = verificationFingerprint(token);
    const fetchImpl = fakeFetch((url) => {
      if (url === 'https://verified.example/') return new Response(HTML, { status: 200, headers: { 'content-type': 'text/html' } });
      if (url.endsWith('/.env')) return new Response('STRIPE_SECRET_KEY=sk_live_FAKEFAKEFAKEFAKEFAKE\n', { status: 200, headers: { 'content-type': 'text/plain' } });
      return new Response('x', { status: 404 });
    });
    const dns = fakeResolver({ '_securealy.verified.example': [[`securealy-verify=${fp}`]] });
    const r = await grade('https://verified.example', { tier: 'verified', verifyToken: token, fetch: fetchImpl, dns, lookup: publicLookup, skipDnssec: true, timeoutMs: 20_000 });
    expect(r.tier).toBe('verified');
    expect(r.checks).toHaveLength(58);
    const env = r.checks.find((c) => c.id === 'exposed-env-files');
    expect(env?.status).toBe('fail');
    expect(env?.evidence).toContain('/.env');
    expect(JSON.stringify(r).includes('sk_live_FAKE')).toBe(false);
    expect(fetchImpl.calls.filter((c) => c.endsWith('/.git/config'))).toHaveLength(1);
  });
});
