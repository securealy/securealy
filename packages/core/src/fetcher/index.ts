import { createHash } from 'node:crypto';
import type { Evidence, FirebaseEvidence, HttpRecord, RouteProbe, SupabaseEvidence, TableRead, VerifiedEvidence } from '../evidence.js';
import { emptyEvidence, makeRecord } from '../evidence.js';
import { apexOf, normalizeInput, platformSuffixOf } from '../domain.js';
import { parsePage, resolveUrl, sameSite, hostOf, meta } from '../html.js';
import type { ParsedPage } from '../html.js';
import type { GradeOptions, Resolver } from '../types.js';
import { redactSecret } from '../redact.js';
import { OptOutError, VerificationError, txtMatchesFingerprint, verificationFingerprint, VERIFY_PREFIX } from '../verify.js';
import { fetch as undiciFetch } from 'undici';
import { Budget, createClient } from './http.js';
import type { HttpClient } from './http.js';
import { createHostGuard } from './safe.js';
import type { HostGuard } from './safe.js';
import { defaultResolver, gatherDns, lookupSecurealyTxt } from './dns.js';
import { gatherTls } from './tls.js';
import { gatherRdap } from './rdap.js';

export const PASSIVE_MAX_REQUESTS = 25;
export const VERIFIED_EXTRA_REQUESTS = 60;
export const TOTAL_TIMEOUT_MS = 45_000;
const BUNDLE_CAP = 8;
const BUNDLE_BYTES = 2_000_000;
const PAGE_BYTES = 2_000_000;
const SITEMAP_SAMPLE_CAP = 5;
const LINK_SAMPLE_CAP = 5;
const IMAGE_SAMPLE_CAP = 3;
const ROUTE_CAP = 15;
const TABLE_CAP = 20;

export function notFoundPath(host: string): string {
  return `/sly-${createHash('sha256').update(host.toLowerCase()).digest('hex').slice(0, 10)}`;
}

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

/** Samples that never left the machine (budget or total timeout) are not evidence about the site. */
function onlyAttempted(records: HttpRecord[]): HttpRecord[] {
  return records.filter((r) => !(r.status === 0 && r.error && /budget exhausted|total timeout/.test(r.error)));
}

function isJsUrl(u: string): boolean {
  try {
    const p = new URL(u).pathname;
    return /\.(m?js)(\?|$)/i.test(p) || /\/_next\/static\//.test(p) || /\/_app\/immutable\//.test(p) || /\/_nuxt\//.test(p);
  } catch {
    return false;
  }
}

function pickEvenly<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const out: T[] = [];
  const step = arr.length / n;
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)] as T);
  return out;
}

export function parseSitemapLocs(xml: string): { locs: string[]; isIndex: boolean } {
  const isIndex = /<sitemapindex/i.test(xml);
  const locs: string[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null && locs.length < 500) {
    const v = m[1]?.replace(/&amp;/g, '&');
    if (v) locs.push(v);
  }
  return { locs, isIndex };
}

interface SupabaseDetection {
  url: string;
  anonKey: string | null;
}

function jwtRole(token: string): string | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const payload = JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as { role?: unknown };
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

export function detectSupabase(texts: string[]): SupabaseDetection | null {
  const urlRe = /https:\/\/([a-z0-9-]{10,})\.supabase\.(?:co|in|red)\b/g;
  let url: string | null = null;
  let anonKey: string | null = null;
  for (const t of texts) {
    const m = urlRe.exec(t);
    urlRe.lastIndex = 0;
    if (m) {
      url = m[0];
      break;
    }
  }
  if (!url) return null;
  const jwtRe = /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
  const pubRe = /\bsb_publishable_[A-Za-z0-9_-]{16,}\b/;
  for (const t of texts) {
    let m: RegExpExecArray | null;
    jwtRe.lastIndex = 0;
    while ((m = jwtRe.exec(t)) !== null) {
      if (jwtRole(m[0]) === 'anon') {
        anonKey = m[0];
        break;
      }
    }
    if (anonKey) break;
    const p = pubRe.exec(t);
    if (p) {
      anonKey = p[0];
      break;
    }
  }
  return { url, anonKey };
}

export function detectFirebase(texts: string[]): FirebaseEvidence | null {
  for (const t of texts) {
    const hasMarker = /firebaseapp\.com|firebaseio\.com|firebasestorage\.googleapis\.com|initializeApp\s*\(/.test(t);
    if (!hasMarker) continue;
    const projectId = /projectId\s*[:=]\s*["']([a-z0-9-]+)["']/.exec(t)?.[1] ?? null;
    const storageBucket = /storageBucket\s*[:=]\s*["']([a-z0-9.-]+)["']/.exec(t)?.[1] ?? null;
    const apiKey = /apiKey\s*[:=]\s*["'](AIza[0-9A-Za-z_-]{20,})["']/.exec(t)?.[1] ?? null;
    if (projectId || storageBucket || apiKey) {
      return { projectId, storageBucket, apiKeyRedacted: apiKey ? redactSecret(apiKey) : null };
    }
  }
  return null;
}

function discoverRoutes(sitemapUrls: string[], bundles: HttpRecord[], page: ParsedPage | null, base: string, host: string, apex: string): { url: string; source: RouteProbe['source'] }[] {
  const found: { url: string; source: RouteProbe['source'] }[] = [];
  const seen = new Set<string>();
  const push = (u: string | null, source: RouteProbe['source']) => {
    if (!u) return;
    let norm: string;
    try {
      const x = new URL(u);
      x.hash = '';
      norm = x.toString();
    } catch {
      return;
    }
    if (seen.has(norm) || !sameSite(norm, host, apex)) return;
    seen.add(norm);
    found.push({ url: norm, source });
  };
  const sensitive = /\/(admin|dashboard|api|internal|settings|account|users?|export|backup|debug|graphql|trpc)(\/|$|\?)/i;
  for (const u of sitemapUrls) if (sensitive.test(u)) push(u, 'sitemap');
  if (page) {
    for (const a of page.anchors) {
      const u = resolveUrl(base, a.href);
      if (u && sensitive.test(u)) push(u, 'html');
    }
  }
  const routeRe = /["'`](\/(?:api|admin|internal|dashboard|graphql|trpc)\/[A-Za-z0-9_\-./]{1,80})["'`]/g;
  for (const b of bundles) {
    if (!b.body) continue;
    let m: RegExpExecArray | null;
    routeRe.lastIndex = 0;
    while ((m = routeRe.exec(b.body)) !== null && found.length < ROUTE_CAP * 3) {
      const p = m[1] ?? '';
      if (/\$\{|\[|:[a-z]/.test(p) || /\.(js|css|map|png|jpg|svg|json|woff2?)$/i.test(p)) continue;
      push(resolveUrl(base, p), 'bundle');
    }
  }
  return found.slice(0, ROUTE_CAP);
}

async function verifyOwnership(
  client: HttpClient,
  ev: Evidence,
  page: ParsedPage | null,
  token: string,
): Promise<'dns' | 'meta' | 'well-known'> {
  const fp = verificationFingerprint(token);
  if (txtMatchesFingerprint(ev.dns.securealyTxt, fp)) return 'dns';
  const metaValue = page ? meta(page, 'securealy-verify') : null;
  if (metaValue && metaValue.trim().toLowerCase() === fp) return 'meta';
  const wk = await client.request(`https://${ev.host}/.well-known/securealy.txt`, { keepBytes: 4096 });
  if (wk.status === 200 && wk.body) {
    const lines = wk.body.split(/\r?\n/).map((l) => l.trim());
    if (txtMatchesFingerprint(lines, fp) || lines.some((l) => l.toLowerCase() === `${VERIFY_PREFIX}${fp}`)) return 'well-known';
  }
  throw new VerificationError(ev.host, ['dns TXT _securealy', 'meta securealy-verify', '/.well-known/securealy.txt']);
}

async function gatherVerified(
  client: HttpClient,
  ev: Evidence,
  page: ParsedPage | null,
  base: string,
  supabaseKey: string | null,
  method: VerifiedEvidence['method'],
): Promise<VerifiedEvidence> {
  const origin = new URL(base).origin;
  const probe = (path: string) => client.request(`${origin}${path}`, { keepBytes: 0 });
  const envFiles = await Promise.all(['/.env', '/.env.local', '/.env.production', '/.env.bak', '/.env.local.bak', '/.env.production.bak'].map(probe));
  const git = await Promise.all(['/.git/config', '/.git/HEAD'].map(probe));
  const internalFiles = await Promise.all(['/README.md', '/CLAUDE.md', '/docs/', '/scripts/', '/package.json'].map(probe));
  const routeTargets = discoverRoutes(ev.sitemapUrls, ev.bundles, page, base, ev.host, ev.apex);
  const routes: RouteProbe[] = await Promise.all(
    routeTargets.map(async (r) => ({ url: r.url, source: r.source, record: await client.request(r.url, { keepBytes: 0, headers: { accept: 'application/json, text/html;q=0.5' } }) })),
  );
  const tableReads: TableRead[] = [];
  let storage: HttpRecord | null = null;
  let storageKind: VerifiedEvidence['storageKind'] = null;
  if (ev.supabase && supabaseKey) {
    const sb = ev.supabase;
    const headers = { apikey: supabaseKey, authorization: `Bearer ${supabaseKey}`, prefer: 'count=exact', accept: 'application/json' };
    const reads = await Promise.all(
      sb.tables.slice(0, TABLE_CAP).map(async (table) => {
        const rec = await client.request(`${sb.url}/rest/v1/${encodeURIComponent(table)}?select=*&limit=1`, { keepBytes: 0, headers });
        const tr: TableRead = { table, status: rec.status, rows: null, count: null };
        if (rec.error) tr.error = rec.error;
        const range = rec.headers['content-range'];
        const total = range ? /\/(\d+)$/.exec(range)?.[1] : undefined;
        if (total !== undefined) tr.count = Number(total);
        if (rec.status === 200) {
          if (tr.count !== null) tr.rows = tr.count > 0;
          else tr.rows = rec.bodyHint === 'json' && rec.bytes > 2;
        } else if (rec.status === 401 || rec.status === 403 || rec.status === 404) {
          tr.rows = false;
        }
        return tr;
      }),
    );
    tableReads.push(...reads);
    storage = await client.request(`${sb.url}/storage/v1/bucket`, { keepBytes: 0, headers: { apikey: supabaseKey, authorization: `Bearer ${supabaseKey}` } });
    storageKind = 'supabase';
  } else if (ev.firebase?.storageBucket) {
    storage = await client.request(`https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(ev.firebase.storageBucket)}/o?maxResults=1`, { keepBytes: 0 });
    storageKind = 'firebase';
  }
  // Burst only an endpoint that accepted the probe: a route answering 404, 405, 410 or 501 says nothing
  // about rate limiting (a POST-only API answers 405 to every GET, limited or not). With no such route,
  // burst the 404 path so a site-wide limiter still shows; the check reads the statuses and skips on 404/405.
  const accepted = (s: number) => s > 0 && s !== 404 && s !== 405 && s !== 410 && s !== 501;
  const burstTarget =
    routes.find((r) => /\/api\//.test(r.url) && accepted(r.record.status))?.url ??
    routes.find((r) => accepted(r.record.status))?.url ??
    `${origin}${notFoundPath(ev.host)}`;
  const burstRecords = await Promise.all(Array.from({ length: 10 }, () => client.request(burstTarget, { keepBytes: 0 })));
  const statuses = burstRecords.map((r) => r.status);
  const rlHeaders = uniq(
    burstRecords.flatMap((r) => Object.keys(r.headers).filter((h) => /ratelimit|retry-after|x-rate-limit/i.test(h))),
  );
  const burst = { url: burstTarget, statuses, limited: statuses.includes(429) || statuses.includes(503) || rlHeaders.some((h) => /retry-after/i.test(h)), headers: rlHeaders };
  return { method, envFiles, git, internalFiles, routes, tableReads, storage, storageKind, burst };
}

/** Gather every piece of evidence once. Throws OptOutError and VerificationError. */
export async function gather(input: string, opts: GradeOptions = {}): Promise<Evidence> {
  const url = normalizeInput(input, { allowPrivate: opts.allowPrivate });
  const host = url.hostname.toLowerCase();
  const apex = apexOf(host);
  const tier = opts.tier === 'verified' ? 'verified' : 'passive';
  const ev = emptyEvidence(url.toString(), host, apex);
  ev.tier = tier;
  ev.platformSuffix = platformSuffixOf(host);
  ev.startedAt = new Date().toISOString();
  const log = (line: string) => {
    ev.log.push(line);
    opts.log?.(line);
  };
  const maxRequests = opts.maxRequests ?? (tier === 'verified' ? PASSIVE_MAX_REQUESTS + VERIFIED_EXTRA_REQUESTS : PASSIVE_MAX_REQUESTS);
  const budget = new Budget(maxRequests, Date.now() + (opts.timeoutMs ?? TOTAL_TIMEOUT_MS));
  // The engine's own fetch is undici's, so the guard's dispatcher is honored; an injected fetch (tests) still sees every check.
  const fetchImpl = opts.fetch ?? (undiciFetch as unknown as typeof fetch);
  const guard = createHostGuard({ lookup: opts.lookup, allowPrivate: opts.allowPrivate });
  const client = createClient(fetchImpl, budget, log, guard, { bypass: opts.bypassToken ? { host, token: opts.bypassToken } : null });
  const resolver = opts.dns ?? defaultResolver();
  try {
    return await gatherWith(url, host, apex, ev, opts, client, guard, resolver, budget, log);
  } finally {
    await guard.close().catch(() => {});
  }
}

async function gatherWith(
  url: URL,
  host: string,
  apex: string,
  ev: Evidence,
  opts: GradeOptions,
  client: HttpClient,
  guard: HostGuard,
  resolver: Resolver,
  budget: Budget,
  log: (line: string) => void,
): Promise<Evidence> {
  const tier = ev.tier;

  // 1. Opt-out first, before any request to the host.
  const securealyTxt = await lookupSecurealyTxt(resolver, host, apex);
  if (securealyTxt.some((v) => v.trim().toLowerCase() === 'optout')) throw new OptOutError(host, 'dns');

  // 2. The home page is the first HTTP request; its header can also opt out.
  const page = await client.request(url.toString(), { keepBytes: PAGE_BYTES });
  if ((page.headers['x-securealy'] ?? '').trim().toLowerCase() === 'optout') throw new OptOutError(host, 'header');
  ev.page = page.error && page.status === 0 ? null : page;
  if (ev.page === null) log(`no response from ${url}: ${page.error ?? 'unknown'}`);
  ev.finalUrl = page.url;
  const parsed = ev.page?.body && (ev.page.bodyHint === 'html' || /text\/html/i.test(ev.page.headers['content-type'] ?? '')) ? parsePage(ev.page.body) : null;
  const base = ev.finalUrl;
  const finalHost = hostOf(base) ?? host;

  // 3. DNS, TLS, RDAP and the plain-http probe in parallel.
  const [dns, tls, rdap, httpProbe] = await Promise.all([
    gatherDns(resolver, host, apex, { skipDnssec: opts.skipDnssec }),
    gatherTls(host, guard),
    gatherRdap(client, apex, ev.platformSuffix),
    client.request(`http://${host}${url.pathname}`, { keepBytes: 0, follow: false }),
  ]);
  ev.dns = dns;
  ev.dns.securealyTxt = uniq([...securealyTxt, ...dns.securealyTxt]);
  ev.tls = tls;
  ev.rdap = rdap;
  ev.httpProbe = httpProbe.status === 0 && httpProbe.error ? httpProbe : httpProbe;

  if (ev.page === null) {
    ev.requests = budget.used;
    return ev;
  }

  // 4. The well-known files, the 404 probe, favicon and og:image.
  const origin = new URL(base).origin;
  const ogRaw = parsed ? (meta(parsed, 'og:image') ?? meta(parsed, 'twitter:image')) : null;
  const ogUrl = ogRaw ? resolveUrl(base, ogRaw) : null;
  const iconLink = parsed?.links.find((l) => /(^|\s)(icon|shortcut icon|apple-touch-icon)(\s|$)/.test(l.rel));
  const iconUrl = iconLink ? resolveUrl(base, iconLink.href) : `${origin}/favicon.ico`;
  const [robots, sitemap, securityTxt, llmsTxt, notFound, favicon, ogImage] = await Promise.all([
    client.request(`${origin}/robots.txt`, { keepBytes: 64_000 }),
    client.request(`${origin}/sitemap.xml`, { keepBytes: 512_000 }),
    client.request(`${origin}/.well-known/security.txt`, { keepBytes: 16_000 }),
    client.request(`${origin}/llms.txt`, { keepBytes: 16_000 }),
    client.request(`${origin}${notFoundPath(host)}`, { keepBytes: 64_000 }),
    iconUrl ? client.request(iconUrl, { method: 'HEAD' }) : Promise.resolve(null),
    ogUrl ? client.request(ogUrl, { method: 'HEAD' }) : Promise.resolve(null),
  ]);
  ev.robots = robots;
  ev.sitemap = sitemap;
  ev.securityTxt = securityTxt;
  ev.llmsTxt = llmsTxt;
  ev.notFound = { path: notFoundPath(host), record: notFound };
  ev.favicon = favicon;
  ev.ogImage = ogImage;

  // 5. First-party bundles, within what the budget leaves for the rest.
  if (parsed) {
    const srcs = uniq(
      [
        ...parsed.scripts.map((s) => s.src).filter((s): s is string => !!s),
        ...parsed.links.filter((l) => l.rel === 'modulepreload').map((l) => l.href),
      ]
        .map((s) => resolveUrl(base, s))
        .filter((u): u is string => !!u && sameSite(u, finalHost, apex) && isJsUrl(u)),
    );
    const reserve = 7; // sitemap samples + a couple of link and image checks
    const cap = Math.max(0, Math.min(BUNDLE_CAP, budget.remaining - reserve));
    ev.bundles = await Promise.all(srcs.slice(0, cap).map((u) => client.request(u, { keepBytes: BUNDLE_BYTES, headers: { accept: '*/*' } })));
    const mapUrls = uniq(
      ev.bundles
        .map((b) => {
          const m = b.body ? /\/\/[#@]\s*sourceMappingURL=([^\s*]+)/.exec(b.body.slice(-600)) : null;
          return m?.[1] && !m[1].startsWith('data:') ? resolveUrl(b.url, m[1]) : null;
        })
        .filter((u): u is string => !!u),
    ).slice(0, 2);
    ev.sourceMaps = await Promise.all(mapUrls.map((u) => client.request(u, { method: 'HEAD' })));
  }

  // 6. Supabase and Firebase detection from the page and bundles.
  const texts = [ev.page.body ?? '', ...(parsed ? [parsed.inlineScript] : []), ...ev.bundles.map((b) => b.body ?? '')];
  const sb = detectSupabase(texts);
  let supabaseKey: string | null = null;
  if (sb) {
    supabaseKey = sb.anonKey;
    const se: SupabaseEvidence = {
      url: sb.url,
      anonKeyRedacted: sb.anonKey ? redactSecret(sb.anonKey) : '',
      anonRole: sb.anonKey ? jwtRole(sb.anonKey) : null,
      rest: null,
      tables: [],
    };
    if (sb.anonKey) {
      const rest = await client.request(`${sb.url}/rest/v1/`, { keepBytes: 1_500_000, headers: { apikey: sb.anonKey, authorization: `Bearer ${sb.anonKey}`, accept: 'application/openapi+json, application/json' } });
      if (rest.status === 200 && rest.body) {
        try {
          const doc = JSON.parse(rest.body) as { definitions?: Record<string, unknown>; paths?: Record<string, unknown> };
          const fromDefs = Object.keys(doc.definitions ?? {});
          const fromPaths = Object.keys(doc.paths ?? {})
            .filter((p) => p !== '/' && !p.startsWith('/rpc/'))
            .map((p) => p.replace(/^\//, ''));
          se.tables = uniq([...fromDefs, ...fromPaths]).sort();
        } catch {
          /* not JSON */
        }
      }
      delete rest.body; // metadata only, never keep the spec
      se.rest = rest;
    }
    ev.supabase = se;
  }
  ev.firebase = detectFirebase(texts);

  // 7. Sitemap parse and a sample of its URLs.
  if (sitemap.status === 200 && sitemap.body) {
    const parsedSitemap = parseSitemapLocs(sitemap.body);
    let locs = parsedSitemap.locs;
    if (parsedSitemap.isIndex && locs[0] && budget.remaining > 3) {
      const child = await client.request(locs[0], { keepBytes: 512_000 });
      if (child.status === 200 && child.body) locs = parseSitemapLocs(child.body).locs;
    }
    ev.sitemapUrls = locs.slice(0, 200);
    const candidates = locs.filter((l) => sameSite(l, finalHost, apex) && l.replace(/\/$/, '') !== base.replace(/\/$/, ''));
    const n = Math.min(SITEMAP_SAMPLE_CAP, Math.max(0, budget.remaining - 2));
    ev.sitemapSamples = onlyAttempted(await Promise.all(pickEvenly(candidates, n).map((u) => client.request(u, { method: 'HEAD' }))));
  }

  // 8. Whatever budget is left goes to internal links (legal pages first) and the biggest-looking images.
  if (parsed && budget.remaining > 0) {
    const internal = uniq(
      parsed.anchors
        .map((a) => resolveUrl(base, a.href))
        .filter((u): u is string => !!u && sameSite(u, finalHost, apex) && u.replace(/\/$/, '') !== base.replace(/\/$/, '')),
    );
    const legal = internal.filter((u) => /privacy|terms|legal|tos/i.test(u));
    const others = internal.filter((u) => !legal.includes(u));
    const targets = [...legal, ...others].slice(0, Math.min(LINK_SAMPLE_CAP, budget.remaining));
    ev.linkSamples = onlyAttempted(await Promise.all(targets.map((u) => client.request(u, { method: 'HEAD' }))));
  }
  if (parsed && budget.remaining > 0) {
    const imgs = uniq(
      parsed.images
        .map((i) => resolveUrl(base, i.src))
        .filter((u): u is string => !!u && !/\.svg(\?|$)/i.test(u) && !u.startsWith('data:') && u !== ogUrl),
    ).slice(0, Math.min(IMAGE_SAMPLE_CAP, budget.remaining));
    ev.imageSamples = onlyAttempted(await Promise.all(imgs.map((u) => client.request(u, { method: 'HEAD' }))));
  }

  // 9. Verified tier: prove ownership, then the probes from the catalogue.
  if (tier === 'verified') {
    if (!opts.verifyToken) throw new VerificationError(host, ['no verifyToken given']);
    const method = await verifyOwnership(client, ev, parsed, opts.verifyToken);
    log(`ownership verified via ${method}`);
    ev.verified = await gatherVerified(client, ev, parsed, base, supabaseKey, method);
  }

  ev.requests = budget.used;
  return ev;
}

export { makeRecord };
