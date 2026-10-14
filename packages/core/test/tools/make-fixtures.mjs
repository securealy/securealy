// Regenerates test/fixtures/<id>/{pass,fail}.json for every remote check.
// Run after `npm run build`: node packages/core/test/tools/make-fixtures.mjs
// Every fixture is a serialized Evidence object: the exact input a check sees.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogue, emptyEvidence, makeRecord, DKIM_SELECTORS } from 'securealy-core';

/** Every queried selector, all unanswered. */
function noDkim() {
  return Object.fromEntries(DKIM_SELECTORS.map((s) => [s, null]));
}

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, '..', 'fixtures');
const HOST = 'goodapp.example';
const ORIGIN = `https://${HOST}`;
const BASE = `${ORIGIN}/`;
const NOW = '2026-10-12T00:00:00.000Z';

// Obviously fake, but shaped like the real thing so the detectors fire.
const FAKE_STRIPE_SECRET = 'sk_live_' + 'FAKEFAKEFAKEFAKEFAKEFAKE';
const FAKE_STRIPE_PUB_LIVE = 'pk_live_' + 'FAKEFAKEFAKEFAKEFAKEFAKE';
const FAKE_STRIPE_PUB_TEST = 'pk_test_' + 'FAKEFAKEFAKEFAKEFAKEFAKE';

function html(o = {}) {
  const {
    title = 'GoodApp: invoices for freelancers, done in minutes',
    description = 'GoodApp helps freelancers send invoices, track payments and get paid faster. Start free, upgrade when you grow, cancel any time.',
    lang = 'en',
    viewport = true,
    canonical = BASE,
    icon = '/favicon.ico',
    og = `${ORIGIN}/og.png`,
    ogDims = true,
    jsonLd = '{"@context":"https://schema.org","@type":"Organization","name":"GoodApp"}',
    analytics = '<script src="https://plausible.io/js/script.js" defer data-domain="goodapp.example"></script>',
    bundle = '<script type="module" src="/assets/index-abc123.js"></script>',
    h1 = '<h1>Invoices for freelancers</h1>',
    links = '<a href="/pricing">Pricing</a><a href="/privacy">Privacy policy</a><a href="/terms">Terms of service</a>',
    extraHead = '',
    extraBody = '',
  } = o;
  return (
    `<!doctype html><html${lang ? ` lang="${lang}"` : ''}><head><meta charset="utf-8">` +
    (title !== null ? `<title>${title}</title>` : '') +
    (description !== null ? `<meta name="description" content="${description}">` : '') +
    (viewport ? '<meta name="viewport" content="width=device-width, initial-scale=1">' : '') +
    (canonical ? `<link rel="canonical" href="${canonical}">` : '') +
    (icon ? `<link rel="icon" href="${icon}">` : '') +
    (og ? `<meta property="og:image" content="${og}">` : '') +
    (og && ogDims ? '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">' : '') +
    (jsonLd ? `<script type="application/ld+json">${jsonLd}</script>` : '') +
    analytics +
    bundle +
    extraHead +
    `</head><body>${h1}<p>Send invoices and get paid without chasing anyone.</p><img src="/hero.png" alt="">${links}${extraBody}</body></html>`
  );
}

const GOOD_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'content-security-policy': "default-src 'self'; script-src 'self' https://plausible.io; frame-ancestors 'none'; form-action 'self'",
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  server: 'Vercel',
  'x-vercel-id': 'sfo1::abc12-1700000000000-0123456789ab',
};

function page(body, headers = {}, extra = {}) {
  return makeRecord({
    url: BASE,
    status: 200,
    headers: { ...GOOD_HEADERS, ...headers, 'content-length': String(body.length) },
    bytes: body.length,
    contentLength: body.length,
    ttfbMs: 180,
    totalMs: 260,
    body,
    bodyHint: 'html',
    ...extra,
  });
}

const BUNDLE_BODY = 'import{a as e}from"./vendor.js";console.log("goodapp",e);';
function bundle(body = BUNDLE_BODY, extra = {}) {
  return makeRecord({ url: `${ORIGIN}/assets/index-abc123.js`, status: 200, headers: { 'content-type': 'application/javascript' }, bytes: body.length, contentLength: body.length, ttfbMs: 40, totalMs: 60, body, bodyHint: 'text', ...extra });
}

function text(path, body, contentType = 'text/plain', extra = {}) {
  return makeRecord({ url: `${ORIGIN}${path}`, status: 200, headers: { 'content-type': contentType }, bytes: body.length, contentLength: body.length, ttfbMs: 40, totalMs: 50, body, bodyHint: contentType.includes('xml') ? 'xml' : 'text', ...extra });
}

function notFound(path) {
  const body = '<!doctype html><html><head><title>Not found</title></head><body><h1>404</h1></body></html>';
  return makeRecord({ url: `${ORIGIN}${path}`, status: 404, headers: { 'content-type': 'text/html' }, bytes: body.length, contentLength: body.length, ttfbMs: 40, totalMs: 50, body, bodyHint: 'html' });
}

function head(url, status = 200, headers = {}, contentLength = null) {
  return makeRecord({ url, method: 'HEAD', status, headers, contentLength, ttfbMs: 30, totalMs: 30 });
}

const ROBOTS = ['User-agent: *', 'Allow: /', 'User-agent: GPTBot', 'Allow: /', 'User-agent: ClaudeBot', 'Allow: /', 'User-agent: PerplexityBot', 'Allow: /', 'User-agent: Google-Extended', 'Allow: /', `Sitemap: ${ORIGIN}/sitemap.xml`].join('\n');
const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${BASE}</loc></url><url><loc>${ORIGIN}/pricing</loc></url><url><loc>${ORIGIN}/privacy</loc></url></urlset>`;

function base() {
  const ev = emptyEvidence(BASE, HOST, HOST);
  ev.startedAt = NOW;
  ev.finalUrl = BASE;
  ev.page = page(html());
  ev.httpProbe = makeRecord({ url: `http://${HOST}/`, status: 308, headers: { location: BASE }, ttfbMs: 20, totalMs: 20 });
  ev.bundles = [bundle()];
  ev.robots = text('/robots.txt', ROBOTS);
  ev.sitemap = text('/sitemap.xml', SITEMAP, 'application/xml');
  ev.sitemapUrls = [BASE, `${ORIGIN}/pricing`, `${ORIGIN}/privacy`];
  ev.sitemapSamples = [head(`${ORIGIN}/pricing`), head(`${ORIGIN}/privacy`)];
  ev.securityTxt = text('/.well-known/security.txt', `Contact: mailto:security@${HOST}\nExpires: 2027-06-01T00:00:00.000Z\n`);
  ev.llmsTxt = text('/llms.txt', '# GoodApp\n\nInvoices for freelancers.\n');
  ev.notFound = { path: '/sly-0123456789', record: notFound('/sly-0123456789') };
  ev.favicon = head(`${ORIGIN}/favicon.ico`, 200, { 'content-type': 'image/x-icon' }, 1500);
  ev.ogImage = head(`${ORIGIN}/og.png`, 200, { 'content-type': 'image/png' }, 90_000);
  ev.linkSamples = [head(`${ORIGIN}/privacy`), head(`${ORIGIN}/terms`), head(`${ORIGIN}/pricing`)];
  ev.imageSamples = [head(`${ORIGIN}/hero.png`, 200, { 'content-type': 'image/png' }, 120_000)];
  ev.dns = {
    ns: ['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com'],
    a: { apex: ['8.8.8.8'], www: ['8.8.8.8'], host: ['8.8.8.8'] },
    aaaa: { apex: [], www: [], host: [] },
    cname: [],
    mx: [{ exchange: 'mx1.mail.example', priority: 10 }],
    txt: ['v=spf1 include:_spf.mail.example -all'],
    dmarc: [`v=DMARC1; p=reject; rua=mailto:dmarc@${HOST}`],
    dkim: { ...noDkim(), resend: 'v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAFAKEFAKEFAKEFAKEFAKE' },
    caa: ['issue "letsencrypt.org"'],
    dnssec: true,
    securealyTxt: [],
    errors: {},
  };
  ev.rdap = { expires: '2028-10-12T00:00:00Z', registrar: 'Example Registrar' };
  ev.tls = { connected: true, authorized: true, hostMatches: true, validFrom: '2026-09-01T00:00:00.000Z', validTo: '2026-11-30T00:00:00.000Z', daysRemaining: 49, sans: [HOST, `www.${HOST}`], issuer: "Let's Encrypt", subject: HOST };
  ev.requests = 18;
  return ev;
}

function withSupabase(ev, tables = []) {
  ev.supabase = { url: 'https://abcdefghijklmnopqrst.supabase.co', anonKeyRedacted: 'eyJhbG…', anonRole: 'anon', rest: makeRecord({ url: 'https://abcdefghijklmnopqrst.supabase.co/rest/v1/', status: tables.length ? 200 : 401, headers: { 'content-type': 'application/json' }, bytes: 0, ttfbMs: 50, totalMs: 60 }), tables };
  return ev;
}

function verifiedBase() {
  const ev = withSupabase(base(), ['invoices', 'profiles']);
  ev.tier = 'verified';
  const probe = (path, status = 404, hint = 'html') => makeRecord({ url: `${ORIGIN}${path}`, status, headers: {}, bytes: status === 200 ? 120 : 60, ttfbMs: 30, totalMs: 30, bodyHint: hint });
  ev.verified = {
    method: 'dns',
    envFiles: ['/.env', '/.env.local', '/.env.production', '/.env.bak', '/.env.local.bak', '/.env.production.bak'].map((p) => probe(p)),
    git: ['/.git/config', '/.git/HEAD'].map((p) => probe(p)),
    internalFiles: ['/README.md', '/CLAUDE.md', '/docs/', '/scripts/', '/package.json'].map((p) => probe(p)),
    routes: [
      { url: `${ORIGIN}/api/admin/users`, source: 'bundle', record: probe('/api/admin/users', 401, 'json') },
      { url: `${ORIGIN}/api/invoices`, source: 'bundle', record: probe('/api/invoices', 401, 'json') },
    ],
    tableReads: [
      { table: 'invoices', status: 200, rows: false, count: 0 },
      { table: 'profiles', status: 200, rows: false, count: 0 },
    ],
    storage: makeRecord({ url: 'https://abcdefghijklmnopqrst.supabase.co/storage/v1/bucket', status: 400, headers: { 'content-type': 'application/json' }, bytes: 80, ttfbMs: 30, totalMs: 30, bodyHint: 'json' }),
    storageKind: 'supabase',
    burst: { url: `${ORIGIN}/api/invoices`, statuses: [401, 401, 401, 401, 401, 401, 401, 429, 429, 429], limited: true, headers: ['retry-after', 'x-ratelimit-remaining'] },
  };
  return ev;
}

function headersWithout(...names) {
  const h = { ...GOOD_HEADERS };
  for (const n of names) delete h[n];
  return h;
}

/** Each entry: [passMutator, failMutator]; mutators receive a fresh base evidence and return it. */
const CASES = {
  'tls-valid': [null, (ev) => ((ev.tls = { ...ev.tls, authorized: false, authorizationError: 'CERT_HAS_EXPIRED' }), ev)],
  'tls-expiry': [null, (ev) => ((ev.tls = { ...ev.tls, daysRemaining: 5 }), ev)],
  'https-redirect': [null, (ev) => ((ev.httpProbe = makeRecord({ url: `http://${HOST}/`, status: 200, headers: { 'content-type': 'text/html' }, bytes: 500 })), ev)],
  hsts: [null, (ev) => ((ev.page = page(html(), headersWithout('strict-transport-security'))), delete ev.page.headers['strict-transport-security'], ev)],
  csp: [null, (ev) => ((ev.page = page(html())), delete ev.page.headers['content-security-policy'], ev)],
  'csp-strength': [null, (ev) => ((ev.page = page(html(), { 'content-security-policy': 'default-src *; script-src * https:' })), ev)],
  'x-frame-options': [null, (ev) => ((ev.page = page(html(), { 'content-security-policy': "default-src 'self'" })), delete ev.page.headers['x-frame-options'], ev)],
  'x-content-type-options': [null, (ev) => ((ev.page = page(html())), delete ev.page.headers['x-content-type-options'], ev)],
  'referrer-policy': [null, (ev) => ((ev.page = page(html())), delete ev.page.headers['referrer-policy'], ev)],
  'permissions-policy': [null, (ev) => ((ev.page = page(html())), delete ev.page.headers['permissions-policy'], ev)],
  'cookie-flags': [
    (ev) => ((ev.page = page(html(), {}, { setCookie: ['session=abc123; Path=/; Secure; HttpOnly; SameSite=Lax'] })), ev),
    (ev) => ((ev.page = page(html(), {}, { setCookie: ['session=abc123; Path=/'] })), ev),
  ],
  'cors-wildcard-credentials': [
    (ev) => ((ev.page = page(html(), { 'access-control-allow-origin': ORIGIN, vary: 'Origin' })), ev),
    (ev) => ((ev.page = page(html(), { 'access-control-allow-origin': '*', 'access-control-allow-credentials': 'true' })), ev),
  ],
  'server-leak': [null, (ev) => ((ev.page = page(html(), { server: 'nginx/1.18.0', 'x-powered-by': 'PHP/8.1.2' })), ev)],
  'source-maps': [
    null,
    (ev) => ((ev.bundles = [bundle(`${BUNDLE_BODY}\n//# sourceMappingURL=index-abc123.js.map`)]), (ev.sourceMaps = [head(`${ORIGIN}/assets/index-abc123.js.map`, 200, { 'content-type': 'application/json' }, 400_000)]), ev),
  ],
  'secrets-in-bundle': [null, (ev) => ((ev.bundles = [bundle(`const stripe=require("stripe")("${FAKE_STRIPE_SECRET}");${BUNDLE_BODY}`)]), ev)],
  'supabase-rest-exposed': [(ev) => withSupabase(ev, []), (ev) => withSupabase(ev, ['invoices', 'profiles', 'payments'])],
  'firebase-config': [null, (ev) => ((ev.firebase = { projectId: 'goodapp-123', storageBucket: 'goodapp-123.appspot.com', apiKeyRedacted: 'AIzaSy…' }), ev)],
  'stripe-test-key-in-prod': [
    (ev) => ((ev.bundles = [bundle(`loadStripe("${FAKE_STRIPE_PUB_LIVE}");${BUNDLE_BODY}`)]), ev),
    (ev) => ((ev.bundles = [bundle(`loadStripe("${FAKE_STRIPE_PUB_TEST}");${BUNDLE_BODY}`)]), ev),
  ],
  'ai-leftovers': [null, (ev) => ((ev.page = page(html({ extraBody: '<a id="lovable-badge" href="https://lovable.dev">Edit with Lovable</a>' }))), ev)],
  spf: [null, (ev) => ((ev.dns.txt = []), ev)],
  // The fail case names a provider with fixed selectors in SPF, so a miss on every selector is conclusive.
  dkim: [null, (ev) => ((ev.dns.dkim = noDkim()), (ev.dns.txt = ['v=spf1 include:_spf.google.com ~all']), ev)],
  dmarc: [null, (ev) => ((ev.dns.dmarc = []), ev)],
  mx: [null, (ev) => ((ev.dns.mx = []), ev)],
  'auth-sender-authenticated': [null, (ev) => ((ev.dns.txt = []), (ev.dns.dmarc = []), ev)],
  nameservers: [null, (ev) => ((ev.dns.ns = []), (ev.dns.errors.ns = 'ESERVFAIL'), ev)],
  dnssec: [null, (ev) => ((ev.dns.dnssec = false), ev)],
  caa: [null, (ev) => ((ev.dns.caa = []), ev)],
  'domain-expiry': [null, (ev) => ((ev.rdap = { expires: '2026-10-20T00:00:00Z', registrar: 'Example Registrar' }), ev)],
  'security-txt': [null, (ev) => ((ev.securityTxt = notFound('/.well-known/security.txt')), ev)],
  'legal-pages': [null, (ev) => ((ev.page = page(html({ links: '<a href="/pricing">Pricing</a>' }))), ev)],
  title: [null, (ev) => ((ev.page = page(html({ title: null }))), ev)],
  'meta-description': [null, (ev) => ((ev.page = page(html({ description: null }))), ev)],
  canonical: [null, (ev) => ((ev.page = page(html({ canonical: null }))), ev)],
  h1: [null, (ev) => ((ev.page = page(html({ h1: '<h2>Invoices</h2>' }))), ev)],
  'lang-viewport': [null, (ev) => ((ev.page = page(html({ lang: null }))), ev)],
  'og-image': [null, (ev) => ((ev.page = page(html({ og: null }))), (ev.ogImage = null), ev)],
  'json-ld': [null, (ev) => ((ev.page = page(html({ jsonLd: '{"@type": "Organization", "name": ' }))), ev)],
  'robots-txt': [null, (ev) => ((ev.robots = notFound('/robots.txt')), ev)],
  sitemap: [null, (ev) => ((ev.sitemap = notFound('/sitemap.xml')), (ev.sitemapUrls = []), (ev.sitemapSamples = []), ev)],
  'not-found-page': [null, (ev) => ((ev.notFound = { path: '/sly-0123456789', record: page(html(), {}, { url: `${ORIGIN}/sly-0123456789` }) }), ev)],
  favicon: [null, (ev) => ((ev.favicon = head(`${ORIGIN}/favicon.ico`, 404)), ev)],
  'mixed-content': [null, (ev) => ((ev.page = page(html({ extraBody: '<img src="http://cdn.example/banner.png" alt="">' }))), ev)],
  'broken-links-home': [null, (ev) => ((ev.linkSamples = [head(`${ORIGIN}/privacy`), head(`${ORIGIN}/terms`, 404), head(`${ORIGIN}/pricing`)]), ev)],
  'llms-txt': [null, (ev) => ((ev.llmsTxt = notFound('/llms.txt')), ev)],
  'ai-crawler-policy': [null, (ev) => ((ev.robots = text('/robots.txt', `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml`)), ev)],
  'analytics-present': [null, (ev) => ((ev.page = page(html({ analytics: '' }))), ev)],
  'consent-mechanism': [
    null,
    (ev) => ((ev.page = page(html({ analytics: '<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABCDEFGH12"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag("js",new Date());gtag("config","G-ABCDEFGH12");</script>' }))), ev),
  ],
  ttfb: [null, (ev) => ((ev.page = page(html(), {}, { ttfbMs: 2500 })), ev)],
  'page-weight': [null, (ev) => ((ev.bundles = [bundle(BUNDLE_BODY, { contentLength: 2_500_000, bytes: 2_000_000 })]), ev)],
  'largest-image': [null, (ev) => ((ev.imageSamples = [head(`${ORIGIN}/hero.png`, 200, { 'content-type': 'image/png' }, 900_000)]), ev)],
  'render-blocking': [
    null,
    (ev) => ((ev.page = page(html({ extraHead: '<script src="/a.js"></script><script src="/b.js"></script><link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="/b.css">' }))), ev),
  ],
  // verified tier
  'exposed-env-files': [verifiedBase, (ev) => ((ev.verified.envFiles[0] = makeRecord({ url: `${ORIGIN}/.env`, status: 200, headers: { 'content-type': 'text/plain' }, bytes: 300, bodyHint: 'env' })), ev)],
  'exposed-git': [verifiedBase, (ev) => ((ev.verified.git[1] = makeRecord({ url: `${ORIGIN}/.git/HEAD`, status: 200, headers: {}, bytes: 23, bodyHint: 'git' })), ev)],
  'exposed-internal-files': [verifiedBase, (ev) => ((ev.verified.internalFiles[0] = makeRecord({ url: `${ORIGIN}/README.md`, status: 200, headers: { 'content-type': 'text/markdown' }, bytes: 4000, bodyHint: 'text' })), ev)],
  'open-admin-routes': [verifiedBase, (ev) => ((ev.verified.routes[0].record = makeRecord({ url: `${ORIGIN}/api/admin/users`, status: 200, headers: { 'content-type': 'application/json' }, bytes: 5200, bodyHint: 'json' })), ev)],
  'supabase-anon-row-read': [verifiedBase, (ev) => ((ev.verified.tableReads[0] = { table: 'invoices', status: 200, rows: true, count: 1842 }), ev)],
  'storage-bucket-listing': [verifiedBase, (ev) => ((ev.verified.storage = makeRecord({ url: 'https://abcdefghijklmnopqrst.supabase.co/storage/v1/bucket', status: 200, headers: { 'content-type': 'application/json' }, bytes: 210, bodyHint: 'json' })), ev)],
  'rate-limit': [verifiedBase, (ev) => ((ev.verified.burst = { url: `${ORIGIN}/api/invoices`, statuses: Array(10).fill(401), limited: false, headers: [] }), ev)],
};

const VERIFIED_IDS = new Set(['exposed-env-files', 'exposed-git', 'exposed-internal-files', 'open-admin-routes', 'supabase-anon-row-read', 'storage-bucket-listing', 'rate-limit']);

let written = 0;
for (const entry of catalogue()) {
  if (entry.tier === 'local') continue;
  const spec = CASES[entry.id];
  if (!spec) throw new Error(`no fixture case for ${entry.id}`);
  const [passMut, failMut] = spec;
  const fresh = () => (VERIFIED_IDS.has(entry.id) ? verifiedBase() : base());
  const pass = passMut && passMut !== verifiedBase ? passMut(fresh()) : fresh();
  const fail = failMut(fresh());
  const dir = join(FIXTURES, entry.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'pass.json'), JSON.stringify(pass, null, 2) + '\n');
  writeFileSync(join(dir, 'fail.json'), JSON.stringify(fail, null, 2) + '\n');
  written += 2;
}
console.log(`wrote ${written} fixtures under ${FIXTURES}`);
