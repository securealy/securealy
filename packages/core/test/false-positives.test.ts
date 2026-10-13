import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildContext, REMOTE_CHECKS, detectStack, findSecrets, grade, makeRecord, DKIM_SELECTORS } from '../src/index.js';
import type { Evidence, HttpRecord, Resolver } from '../src/index.js';
import { parseRobots, blocksEveryone } from '../src/checks/robots-txt.js';
import { looksLikePlaceholder } from '../src/redact.js';

/**
 * Regression tests for false positives found in the pre-launch review: each
 * case is a shape seen on a real site, reduced to the evidence that fooled a
 * check. Hosts are .example throughout.
 */

const FIXTURES = join(__dirname, 'fixtures');
const byId = new Map(REMOTE_CHECKS.map((m) => [m.id, m]));

function load(id: string, kind: 'pass' | 'fail' = 'pass'): Evidence {
  return JSON.parse(readFileSync(join(FIXTURES, id, `${kind}.json`), 'utf8')) as Evidence;
}

function run(id: string, ev: Evidence) {
  return byId.get(id)!.run(buildContext(ev));
}

/** Replace the home page body, keeping headers and status. */
function withBody(ev: Evidence, body: string): Evidence {
  const page = ev.page as HttpRecord;
  ev.page = { ...page, body, bytes: body.length, contentLength: body.length };
  return ev;
}

function withBundle(ev: Evidence, body: string): Evidence {
  ev.bundles = [makeRecord({ url: 'https://goodapp.example/assets/index-abc123.js', status: 200, headers: { 'content-type': 'application/javascript' }, bytes: body.length, body, bodyHint: 'text' })];
  return ev;
}

const SHELL = (head: string, body = '<h1>App</h1>') => `<!doctype html><html lang="en"><head><title>GoodApp: invoices for freelancers, done</title>${head}</head><body>${body}</body></html>`;

describe('analytics detection needs a tag host or a bootstrap, not a bare identifier', () => {
  it('a first-party script that only guards window.gtag is not GA4', () => {
    const ev = withBundle(withBody(load('analytics-present'), SHELL('<script src="/assets/index-abc123.js"></script>')), 'function track(name, params) { try { if (window.gtag) gtag("event", name, params); } catch (e) {} }');
    expect(detectStack(ev, buildContext(ev).page).analytics).toBeUndefined();
    expect(run('analytics-present', ev).status).toBe('fail');
    const consent = run('consent-mechanism', ev);
    expect(consent.status).toBe('pass');
    expect(consent.evidence).toMatch(/no tracking/);
  });

  it('a link to /gtm-template is not Google Tag Manager', () => {
    const ev = withBody(load('analytics-present'), SHELL('', '<ul><li><a href="/gtm-template">GTM template</a></li></ul><p>Works with GTM-style containers.</p>'));
    expect(detectStack(ev, buildContext(ev).page).analytics).toBeUndefined();
  });

  it('the real gtag snippet, a GTM container and a PostHog bootstrap are detected', () => {
    const gtag = SHELL('<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABCDEFGH12"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag("js",new Date());gtag("config","G-ABCDEFGH12");</script>');
    expect(detectStack(withBody(load('analytics-present'), gtag), null).analytics).toEqual(['ga4']);
    const gtm = SHELL("<script>(function(w,d,s,l,i){w[l]=w[l]||[];})(window,document,'script','dataLayer','GTM-ABC1234');</script><script src=\"https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234\"></script>");
    expect(detectStack(withBody(load('analytics-present'), gtm), null).analytics).toEqual(['gtm']);
    const ph = withBundle(withBody(load('analytics-present'), SHELL('<script src="/assets/index-abc123.js"></script>')), 'posthog.init("phc_abcdefghijklmnopqrstuvwxyz0123", {api_host: "https://us.i.posthog.com"})');
    expect(detectStack(ph, null).analytics).toEqual(['posthog']);
    const plausible = SHELL('<script defer data-domain="goodapp.example" src="https://plausible.io/js/script.js"></script>');
    expect(detectStack(withBody(load('analytics-present'), plausible), null).analytics).toEqual(['plausible']);
  });

  it('marketing copy that names Mixpanel, Hotjar or PostHog is not a tag', () => {
    const ev = withBody(load('analytics-present'), SHELL('', '<p>Compare us with Mixpanel, Hotjar and PostHog. We also export to Segment.</p>'));
    expect(detectStack(ev, buildContext(ev).page).analytics).toBeUndefined();
  });

  it('a preconnect to a tag host without a tag is a warn, not a fail', () => {
    const ev = withBody(load('analytics-present'), SHELL('<link rel="preconnect" href="https://www.googletagmanager.com">'));
    const r = run('analytics-present', ev);
    expect(r.status).toBe('warn');
    expect(r.evidence).toMatch(/preconnect to www\.googletagmanager\.com/);
  });
});

describe('builder and database detection need an artifact, not a mention', () => {
  it('linking to lovable.dev or v0.dev is not being built with them', () => {
    const ev = withBody(load('ai-leftovers'), SHELL('', '<p>Customers: <a href="https://lovable.dev">Lovable</a>, <a href="https://v0.dev">v0</a>, <a href="https://bolt.new">Bolt</a>.</p>'));
    expect(detectStack(ev, buildContext(ev).page).builder).toBeUndefined();
  });

  it('the Lovable default og:image and badge are artifacts', () => {
    const ev = withBody(load('ai-leftovers'), SHELL('<meta property="og:image" content="https://lovable.dev/opengraph-image-p98pqg.png">'));
    expect(detectStack(ev, buildContext(ev).page).builder).toBe('lovable');
  });

  it('mentioning supabase.co in copy is not a Supabase backend; a project REST URL is', () => {
    const copy = withBody(load('supabase-rest-exposed', 'fail'), SHELL('', '<p>Host it anywhere, even on something.supabase.co.</p>'));
    copy.supabase = null;
    expect(detectStack(copy, buildContext(copy).page).db).toBeUndefined();
    const real = withBundle(withBody(load('supabase-rest-exposed', 'fail'), SHELL('<script src="/assets/index-abc123.js"></script>')), 'fetch("https://abcdefghijklmnopqrst.supabase.co/rest/v1/profiles")');
    real.supabase = null;
    expect(detectStack(real, null).db).toBe('supabase');
  });

  it("the builder's own site carrying its own badge is not a leftover", () => {
    const ev = withBody(load('ai-leftovers'), SHELL('', '<h1>Build apps</h1><a id="lovable-badge" href="/">Edit with Lovable</a>'));
    ev.host = 'lovable.dev';
    ev.apex = 'lovable.dev';
    expect(run('ai-leftovers', ev).status).toBe('pass');
    const other = withBody(load('ai-leftovers'), SHELL('', '<h1>Build apps</h1><a id="lovable-badge" href="/">Edit with Lovable</a>'));
    expect(run('ai-leftovers', other).status).toBe('fail');
  });

  it('"Hello World" in a code sample is not starter copy', () => {
    const ev = withBody(load('ai-leftovers'), SHELL('', '<h1>Email for developers</h1><pre><code>subject: "Hello World"</code></pre>'));
    expect(run('ai-leftovers', ev).status).toBe('pass');
  });
});

describe('secret detection ignores documented placeholders', () => {
  it('recognises placeholder bodies and keeps random-looking keys', () => {
    expect(looksLikePlaceholder('sk_live_' + 'x'.repeat(24))).toBe(true);
    expect(looksLikePlaceholder('sk_live_' + '4'.repeat(24))).toBe(true);
    expect(looksLikePlaceholder('AKIA' + 'IOSFODNN7EXAMPLE')).toBe(true);
    expect(looksLikePlaceholder('sk-' + 'YOUR_OPENAI_KEY_GOES_RIGHT_HERE_OK')).toBe(true);
    expect(looksLikePlaceholder('sk_live_' + 'FAKEk7Qm2xP9vL4nR8tW3yB6')).toBe(false);
  });

  it('a docs page showing sk_live_xxxx and the AWS example key produces no finding', () => {
    const doc = 'STRIPE_SECRET_KEY=sk_live_' + 'xxxxxxxxxxxxxxxxxxxxxxxx' + ' AWS_ACCESS_KEY_ID=AKIA' + 'IOSFODNN7EXAMPLE';
    expect(findSecrets(doc, '/docs')).toEqual([]);
    expect(findSecrets('const k="sk_live_' + 'FAKEk7Qm2xP9vL4nR8tW3yB6' + '"', '/x.js')).toHaveLength(1);
  });
});

describe('DKIM selector coverage and confidence', () => {
  it('queries the selectors the common providers publish under', () => {
    for (const s of ['resend', 'google', 'default', 'k1', 'k2', 'k3', 's1', 's2', 'selector1', 'selector2', 'mail', 'dkim', 'mandrill', 'pm', 'sendgrid', 'mailgun', 'smtp', 'email', 'amazonses', 'protonmail', 'zoho', 'fm1', 'fm2']) {
      expect(DKIM_SELECTORS, s).toContain(s);
    }
  });

  it('a miss on every selector is a warn unless SPF names a provider with fixed selectors', () => {
    const ev = load('dkim', 'fail');
    ev.dns.txt = ['v=spf1 include:amazonses.com ~all'];
    const r = run('dkim', ev);
    expect(r.status).toBe('warn');
    expect(r.evidence).toMatch(/custom selector/);
    ev.dns.txt = ['v=spf1 include:_spf.google.com ~all'];
    expect(run('dkim', ev).status).toBe('fail');
  });

  it('a domain that publishes v=spf1 -all and a null MX sends no mail: DKIM and sender checks skip, MX warns', () => {
    const ev = load('dkim', 'fail');
    ev.dns.txt = ['v=spf1 -all'];
    ev.dns.mx = [{ exchange: '.', priority: 0 }];
    expect(run('dkim', ev).status).toBe('skip');
    expect(run('auth-sender-authenticated', ev).status).toBe('skip');
    const mx = run('mx', ev);
    expect(mx.status).toBe('warn');
    expect(mx.evidence).toMatch(/RFC 7505/);
    expect(run('spf', ev).status).toBe('pass');
  });
});

describe('robots.txt groups are parsed, not regexed across groups', () => {
  const REPLIT_STYLE = 'User-agent: *\nDisallow:\n\nUser-agent: FreshpingBot\nDisallow: /\n\nSitemap: https://goodapp.example/sitemap.xml\n';
  it('a Disallow: / for one named bot does not block everyone', () => {
    expect(parseRobots(REPLIT_STYLE)).toEqual([
      { agents: ['*'], allow: [], disallow: [''] },
      { agents: ['freshpingbot'], allow: [], disallow: ['/'] },
    ]);
    expect(blocksEveryone(REPLIT_STYLE)).toBe(false);
    const ev = load('robots-txt');
    (ev.robots as HttpRecord).body = REPLIT_STYLE;
    expect(run('robots-txt', ev).status).toBe('pass');
  });
  it('a real block-all still fails, and Allow: / in the same group lifts it', () => {
    expect(blocksEveryone('User-agent: *\nDisallow: /\n')).toBe(true);
    expect(blocksEveryone('User-agent: Googlebot\nUser-agent: *\nDisallow: /admin\nDisallow: /\nAllow: /\n')).toBe(false);
    expect(blocksEveryone('User-agent: *\nDisallow: /admin\n')).toBe(false);
  });
});

describe('cookie flags judge session cookies, not analytics cookies', () => {
  function cookies(ev: Evidence, setCookie: string[]): Evidence {
    ev.page = { ...(ev.page as HttpRecord), setCookie };
    return ev;
  }
  it('a Segment ajs_session_id without HttpOnly is by design', () => {
    const r = run('cookie-flags', cookies(load('cookie-flags'), ['ajs_session_id=e403d66b363f; Secure; SameSite=Strict; Path=/', 'ajs_anonymous_id=786c32eb; Secure; SameSite=Strict; Path=/']));
    expect(r.status).toBe('pass');
  });
  it('a preference cookie without Secure is a warn; a session cookie without Secure is the fail', () => {
    const w = run('cookie-flags', cookies(load('cookie-flags'), ['theme=dark; Path=/; SameSite=Lax']));
    expect(w.status).toBe('warn');
    expect(w.evidence).toMatch(/no session cookie affected/);
    const f = run('cookie-flags', cookies(load('cookie-flags'), ['session=abc; Path=/; SameSite=Lax']));
    expect(f.status).toBe('fail');
    expect(f.evidence).toMatch(/Secure, HttpOnly/);
  });
});

describe('checks that cannot be judged skip instead of passing or failing', () => {
  it('no CORS header anywhere is a skip, not a pass', () => {
    const ev = load('cors-wildcard-credentials');
    delete (ev.page as HttpRecord).headers['access-control-allow-origin'];
    const r = run('cors-wildcard-credentials', ev);
    expect(r.status).toBe('skip');
    expect(r.evidence).toMatch(/verified tier/);
  });
  it('a client-rendered shell with no links skips legal-pages; a /legal hub is a warn; rel link types count', () => {
    expect(run('legal-pages', withBody(load('legal-pages'), SHELL('', '<div id="root"></div>'))).status).toBe('skip');
    const hub = run('legal-pages', withBody(load('legal-pages'), SHELL('', '<a href="/pricing">Pricing</a><a href="/legal">Legal policies</a>')));
    expect(hub.status).toBe('warn');
    expect(hub.evidence).toMatch(/legal hub/);
    const rel = run('legal-pages', withBody(load('legal-pages'), SHELL('', '<a rel="privacy-policy" href="/p">Policy</a><a rel="terms-of-service" href="/t">Agreement</a>')));
    expect(rel.status).toBe('pass');
    const none = run('legal-pages', withBody(load('legal-pages'), SHELL('', '<a href="/pricing">Pricing</a><a href="/blog">Blog</a>')));
    expect(none.status).toBe('fail');
    expect(none.evidence).toMatch(/among 2 links/);
  });
  it('llms.txt missing is a warn and ai-crawler-policy without robots.txt is a skip', () => {
    expect(run('llms-txt', load('llms-txt', 'fail')).status).toBe('warn');
    const ev = load('ai-crawler-policy');
    (ev.robots as HttpRecord).status = 404;
    expect(run('ai-crawler-policy', ev).status).toBe('skip');
    expect(run('ai-crawler-policy', load('ai-crawler-policy', 'fail')).status).toBe('warn');
  });
  it('a .map URL that answers 200 with the SPA fallback page is not a served source map', () => {
    const ev = load('source-maps', 'fail');
    ev.sourceMaps = [makeRecord({ url: 'https://goodapp.example/assets/index-abc123.js.map', method: 'HEAD', status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })];
    const r = run('source-maps', ev);
    expect(r.status).toBe('pass');
    expect(r.evidence).toMatch(/SPA fallback/);
  });
  it('og:image answering 403 to the grader is a warn; a px-suffixed width still parses', () => {
    const ev = load('og-image');
    (ev.ogImage as HttpRecord).status = 403;
    expect(run('og-image', ev).status).toBe('warn');
    const px = withBody(load('og-image'), SHELL('<meta property="og:image" content="https://goodapp.example/og.png"><meta property="og:image:width" content="1200px"><meta property="og:image:height" content="630px">'));
    const r = run('og-image', px);
    expect(r.status).toBe('pass');
    expect(r.evidence).toMatch(/declared 1200x630/);
  });
  it('an og:image served as SVG is a true finding even though it is an image', () => {
    const ev = load('og-image');
    (ev.ogImage as HttpRecord).headers['content-type'] = 'image/svg+xml';
    const r = run('og-image', ev);
    expect(r.status).toBe('fail');
    expect(r.evidence).toMatch(/SVG/);
  });
  it('a TTFB between 800 and 1600 ms is a warn from one cold sample', () => {
    const ev = load('ttfb');
    (ev.page as HttpRecord).ttfbMs = 1000;
    expect(run('ttfb', ev).status).toBe('warn');
    (ev.page as HttpRecord).ttfbMs = 2000;
    expect(run('ttfb', ev).status).toBe('fail');
  });
  it('a client-rendered 404 behind a 200 is named as such', () => {
    const ev = load('not-found-page');
    const body = '<!doctype html><html><head><title>404: Page not found</title></head><body><div id="root"></div></body></html>';
    ev.notFound = { path: '/sly-0123456789', record: makeRecord({ url: 'https://goodapp.example/sly-0123456789', status: 200, headers: { 'content-type': 'text/html' }, bytes: body.length, body, bodyHint: 'html' }) };
    const r = run('not-found-page', ev);
    expect(r.status).toBe('fail');
    expect(r.evidence).toMatch(/says not found/);
  });
  it('largest-image names the og:image when it is the only image and it has no content-length', () => {
    const ev = withBody(load('largest-image'), SHELL('<meta property="og:image" content="https://goodapp.example/og.png">'));
    ev.imageSamples = [];
    ev.ogImage = makeRecord({ url: 'https://goodapp.example/og.png', method: 'HEAD', status: 200, headers: { 'content-type': 'image/png' } });
    const r = run('largest-image', ev);
    expect(r.status).toBe('skip');
    expect(r.evidence).toMatch(/only the og:image/);
  });
});

/* ---------------- fetcher-level regressions through grade() ---------------- */

function fakeResolver(): Resolver {
  const nodata = () => Promise.reject(Object.assign(new Error('ENODATA'), { code: 'ENODATA' }));
  return {
    resolveNs: () => Promise.resolve(['ns1.dns.example']),
    resolve4: () => Promise.resolve(['203.0.113.5']),
    resolve6: nodata,
    resolveMx: nodata,
    resolveTxt: nodata,
    resolveCname: nodata,
    resolveCaa: nodata,
  };
}

function fakeFetch(handler: (url: string, init: RequestInit | undefined) => Response): typeof fetch & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    return handler(url, init);
  }) as typeof fetch & { calls: string[] };
  f.calls = calls;
  return f;
}

const PAGE = '<!doctype html><html lang="en"><head><title>Fetcher regression site title</title><meta property="og:image" content="https://fetch.example/og.png"></head><body><h1>Hi</h1></body></html>';

describe('fetcher regressions', () => {
  it('retries a HEAD that answers 501 or 405 as a GET and keeps the GET verdict', async () => {
    const fetchImpl = fakeFetch((url, init) => {
      if (url.startsWith('http://')) return new Response(null, { status: 308, headers: { location: url.replace('http://', 'https://') } });
      if (/rdap/.test(url)) return new Response('{}', { status: 404 });
      if (url === 'https://fetch.example/') return new Response(PAGE, { status: 200, headers: { 'content-type': 'text/html' } });
      if (url === 'https://fetch.example/og.png') {
        if (init?.method === 'HEAD') return new Response(null, { status: 501 });
        return new Response(new Uint8Array(20_000), { status: 200, headers: { 'content-type': 'image/png', 'content-length': '20000' } });
      }
      if (init?.method === 'HEAD') return new Response(null, { status: 405 });
      return new Response('nope', { status: 404, headers: { 'content-type': 'text/plain' } });
    });
    const r = await grade('https://fetch.example', { fetch: fetchImpl, dns: fakeResolver(), skipDnssec: true, timeoutMs: 20_000 });
    const og = r.checks.find((c) => c.id === 'og-image');
    expect(og?.status).toBe('pass');
    expect(fetchImpl.calls).toContain('HEAD https://fetch.example/og.png');
    expect(fetchImpl.calls).toContain('GET https://fetch.example/og.png');
    expect(r.checks.find((c) => c.id === 'favicon')?.evidence).toMatch(/404/);
  });

  it('rdap.org 404 without a redirect is no RDAP server for the TLD (skip); a registry 404 after the redirect is not registered (fail)', async () => {
    const mk = (registry: boolean) =>
      fakeFetch((url) => {
        if (url.startsWith('http://')) return new Response(null, { status: 308, headers: { location: url.replace('http://', 'https://') } });
        if (/^https:\/\/rdap\.org\//.test(url)) return registry ? new Response(null, { status: 302, headers: { location: 'https://rdap.verisign.com/com/v1/domain/fetch.example' } }) : new Response('{}', { status: 404 });
        if (/rdap\.verisign\.com/.test(url)) return new Response('{"errorCode":404}', { status: 404 });
        if (url === 'https://fetch.example/') return new Response(PAGE, { status: 200, headers: { 'content-type': 'text/html' } });
        return new Response('nope', { status: 404, headers: { 'content-type': 'text/plain' } });
      });
    const a = await grade('https://fetch.example', { fetch: mk(false), dns: fakeResolver(), skipDnssec: true, timeoutMs: 20_000 });
    const da = a.checks.find((c) => c.id === 'domain-expiry');
    expect(da?.status).toBe('skip');
    expect(da?.evidence).toMatch(/no RDAP server is listed for \.example/);
    const b = await grade('https://fetch.example', { fetch: mk(true), dns: fakeResolver(), skipDnssec: true, timeoutMs: 20_000 });
    expect(b.checks.find((c) => c.id === 'domain-expiry')?.status).toBe('fail');
  });

  it('names the Vercel bot challenge when the home page answers 429 with the mitigation header', async () => {
    const fetchImpl = fakeFetch((url) => {
      if (/rdap/.test(url)) return new Response('{}', { status: 404 });
      if (url === 'https://fetch.example/') return new Response('<html>challenge</html>', { status: 429, headers: { 'content-type': 'text/html', 'x-vercel-mitigated': 'challenge', server: 'Vercel' } });
      return new Response(null, { status: 429, headers: { 'x-vercel-mitigated': 'challenge' } });
    });
    const r = await grade('https://fetch.example', { fetch: fetchImpl, dns: fakeResolver(), skipDnssec: true, timeoutMs: 20_000 });
    const hsts = r.checks.find((c) => c.id === 'hsts');
    expect(hsts?.status).toBe('error');
    expect(hsts?.evidence).toMatch(/Vercel bot challenge/);
  });
});
