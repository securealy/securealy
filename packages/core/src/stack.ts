import type { Evidence } from './evidence.js';
import type { ParsedPage } from './html.js';
import type { Stack } from './types.js';

function texts(ev: Evidence, page: ParsedPage | null): string {
  const parts = [page?.markers ?? (ev.page?.body ?? '').slice(0, 1_500_000).toLowerCase()];
  for (const b of ev.bundles) if (b.body) parts.push(b.body.slice(0, 300_000).toLowerCase());
  return parts.join('\n');
}

export function detectHost(ev: Evidence): string | undefined {
  const h = ev.page?.headers ?? {};
  const server = (h['server'] ?? '').toLowerCase();
  const cname = ev.dns.cname.join(' ');
  if (h['x-vercel-id'] || server === 'vercel' || /vercel-dns\.com|vercel\.app/.test(cname) || ev.platformSuffix === 'vercel.app') return 'vercel';
  if (h['x-nf-request-id'] || server.includes('netlify') || /netlify/.test(cname) || ev.platformSuffix === 'netlify.app') return 'netlify';
  if (h['x-render-origin-server'] || /onrender\.com/.test(cname) || ev.platformSuffix === 'onrender.com') return 'render';
  if (h['fly-request-id'] || /fly\.dev/.test(cname) || ev.platformSuffix === 'fly.dev') return 'fly';
  if (server.includes('railway') || /railway\.app/.test(cname) || (ev.platformSuffix ?? '').endsWith('railway.app')) return 'railway';
  if (/pages\.dev/.test(cname) || ev.platformSuffix === 'pages.dev' || ev.platformSuffix === 'workers.dev') return 'cloudflare-pages';
  if (h['cf-ray'] && server === 'cloudflare') return 'cloudflare';
  if (/github\.io/.test(cname) || ev.platformSuffix === 'github.io' || server.includes('github')) return 'github-pages';
  if (ev.platformSuffix === 'web.app' || ev.platformSuffix === 'firebaseapp.com' || /firebase/.test(cname)) return 'firebase-hosting';
  if (server) return server.split('/')[0] ?? undefined;
  return undefined;
}

export function detectDnsProvider(ns: string[]): string | undefined {
  const all = ns.join(' ').toLowerCase();
  if (!all) return undefined;
  const table: [RegExp, string][] = [
    [/cloudflare\.com/, 'cloudflare'],
    [/vercel-dns\.com/, 'vercel'],
    [/awsdns/, 'route53'],
    [/googledomains\.com|google\.com/, 'google'],
    [/domaincontrol\.com/, 'godaddy'],
    [/registrar-servers\.com/, 'namecheap'],
    [/squarespacedns\.com/, 'squarespace'],
    [/digitalocean\.com/, 'digitalocean'],
    [/nsone\.net/, 'ns1'],
    [/porkbun\.com/, 'porkbun'],
    [/hover\.com/, 'hover'],
    [/name\.com/, 'name.com'],
    [/dnsimple\.com/, 'dnsimple'],
    [/gandi\.net/, 'gandi'],
    [/ovh\.net/, 'ovh'],
    [/ui-dns\.|ionos/, 'ionos'],
    [/wixdns\.net/, 'wix'],
    [/shopify/, 'shopify'],
    [/azure-dns/, 'azure'],
    [/linode\.com/, 'linode'],
    [/hetzner/, 'hetzner'],
    [/dreamhost/, 'dreamhost'],
    [/bluehost|hostgator|websitewelcome/, 'bluehost'],
    [/dnsmadeeasy/, 'dnsmadeeasy'],
    [/netlify/, 'netlify'],
  ];
  for (const [re, name] of table) if (re.test(all)) return name;
  const first = ns[0] ?? '';
  const parts = first.split('.');
  return parts.length >= 2 ? parts.slice(-2).join('.') : first;
}

/**
 * Builder markers are things a builder leaves in a generated site (its badge,
 * its asset host, its bootstrap script), never a bare mention of the product:
 * a page that links to lovable.dev or v0.dev is not built with it.
 */
export function detectBuilder(t: string, headers: Record<string, string>): string | undefined {
  if (/lovable-badge|lovable-uploads\/|lovable\.dev\/opengraph|gptengineer\.js|cdn\.gpteng\.co|content="lovable"|\.lovable\.app\/|lovableproject\.com/.test(t)) return 'lovable';
  if (/\.bolt\.host\/|bolt-badge|built with bolt|stackblitz-badge|bolt\.new\/badge/.test(t)) return 'bolt';
  if (/v0-user-next|built with v0|content="v0"|v0\.app\/badge|v0-badge/.test(t)) return 'v0';
  if (/replit-badge|made with replit|\.replit\.app\/|\.repl\.co\/|replit\.com\/public\/js\/replit-badge/.test(t)) return 'replit';
  if (/base44\.app\/|base44-badge|app\.base44\.com/.test(t)) return 'base44';
  if (/softr-badge|\.softr\.app\/|softr\.io\/(?:css|js)|content="softr"/.test(t)) return 'softr';
  if (/framerusercontent\.com|content="framer|framer-badge|__framer/.test(t) || (headers['server'] ?? '').toLowerCase().includes('framer')) return 'framer';
  if (/data-wf-page|data-wf-site|w-webflow-badge|\.webflow\.io\//.test(t)) return 'webflow';
  if (/static\.wixstatic\.com|static\.parastorage\.com|x-wix|wix-code/.test(t) || headers['x-wix-request-id']) return 'wix';
  return undefined;
}

export function detectDb(ev: Evidence, t: string): string | undefined {
  // A Supabase project URL or the client library, not a mention of the product.
  if (ev.supabase || /@supabase\/supabase-js|supabase-js\/|\/\/[a-z0-9-]{10,}\.supabase\.(?:co|in|red)\/(?:rest|auth|storage|realtime|functions)\//.test(t)) return 'supabase';
  if (ev.firebase || /firebaseio\.com|firestore\.googleapis|firebasestorage\.googleapis|\.firebaseapp\.com\//.test(t)) return 'firebase';
  if (/\.convex\.cloud/.test(t)) return 'convex';
  if (/pocketbase\.io\/|\/api\/collections\/[a-z0-9_]+\/records|new pocketbase\(/.test(t)) return 'pocketbase';
  return undefined;
}

export function detectPayments(t: string): string | undefined {
  if (/js\.stripe\.com|pk_live_|pk_test_|checkout\.stripe\.com|buy\.stripe\.com/.test(t)) return 'stripe';
  if (/lemonsqueezy\.com|lemon\.js/.test(t)) return 'lemonsqueezy';
  if (/cdn\.paddle\.com|paddle\.com\/|paddle_button/.test(t)) return 'paddle';
  if (/polar\.sh/.test(t)) return 'polar';
  return undefined;
}

/**
 * Analytics is detected by the script host a vendor loads from or by the
 * vendor's own inline bootstrap, never by a bare identifier: a first-party
 * script that guards `if (window.gtag)` or a link to /gtm-template is not a tag.
 * `t` is lower-cased page HTML plus the first-party bundles.
 */
export const ANALYTICS_SIGNATURES: [string, RegExp][] = [
  ['ga4', /googletagmanager\.com\/gtag\/js|google-analytics\.com\/g\/collect|gtag\(\s*['"]config['"]\s*,\s*['"]g-[a-z0-9]{6,12}['"]/],
  ['gtm', /googletagmanager\.com\/gtm\.js|googletagmanager\.com\/ns\.html\?id=gtm-|['"]dataLayer['"]\s*,\s*['"]gtm-[a-z0-9]{5,}['"]/],
  ['plausible', /<script[^>]+src=["'][^"']*plausible\.io\/js\/|<script[^>]+data-domain=[^>]+src=["'][^"']*\/js\/(?:script|plausible)[^"']*["']|<script[^>]+src=["'][^"']*\/js\/(?:script|plausible)[^"']*["'][^>]+data-domain=|plausible\.io\/api\/event/],
  ['posthog', /posthog\.com\/static\/array\.js|posthog\.init\s*\(|\bphc_[a-z0-9]{20,}|[a-z]+\.i\.posthog\.com/],
  ['fathom', /usefathom\.com\/script\.js|cdn\.usefathom\.com/],
  ['umami', /<script[^>]+data-website-id=|umami\.is\/script\.js|cloud\.umami\.is/],
  ['vercel-analytics', /\/_vercel\/insights\/script\.js|va\.vercel-scripts\.com|window\.va\s*=\s*window\.va\s*\|\|/],
  ['mixpanel', /cdn\.mxpnl\.com|api(?:-js)?\.mixpanel\.com|mixpanel\.init\s*\(/],
  ['segment', /cdn\.segment\.(?:com|io)\/analytics\.js|analytics\.load\s*\(\s*['"]/],
  ['hotjar', /static\.hotjar\.com|_hjsettings\s*=/],
  ['clarity', /clarity\.ms\/tag\/|window\.clarity\s*=|\bclarity\s*\(\s*['"]set['"]/],
  ['simpleanalytics', /simpleanalyticscdn\.com|scripts\.simpleanalytics\.(?:com|io)|queue\.simpleanalyticscdn/],
];

export function detectAnalytics(t: string): string[] {
  const out: string[] = [];
  for (const [name, re] of ANALYTICS_SIGNATURES) if (re.test(t)) out.push(name);
  return out;
}

export function detectEmailProvider(ev: Evidence): string | undefined {
  const d = ev.dns.dkim;
  if (d['resend']) return 'resend';
  if (d['google']) return 'google';
  if (d['selector1'] || d['selector2']) return 'microsoft';
  if (d['k1'] || d['k2'] || d['k3']) return 'mailchimp';
  if (d['s1'] || d['s2']) return 'sendgrid';
  if (d['mandrill']) return 'mandrill';
  if (d['pm']) return 'postmark';
  if (d['mailgun'] || d['mg']) return 'mailgun';
  if (d['amazonses']) return 'ses';
  if (d['protonmail']) return 'proton';
  if (d['zoho']) return 'zoho';
  if (d['fm1'] || d['fm2']) return 'fastmail';
  const spf = ev.dns.txt.find((t) => /^v=spf1/i.test(t)) ?? '';
  if (/amazonses/.test(spf)) return 'ses';
  if (/resend/.test(spf)) return 'resend';
  if (/_spf\.google\.com/.test(spf)) return 'google';
  if (/protection\.outlook\.com/.test(spf)) return 'microsoft';
  if (/sendgrid\.net/.test(spf)) return 'sendgrid';
  if (/mailgun\.org/.test(spf)) return 'mailgun';
  if (/postmarkapp|mtasv\.net/.test(spf)) return 'postmark';
  if (/servers\.mcsv\.net/.test(spf)) return 'mailchimp';
  if (/zoho/.test(spf)) return 'zoho';
  if (/protonmail\.ch/.test(spf)) return 'proton';
  if (/messagingengine\.com/.test(spf)) return 'fastmail';
  if (Object.values(d).some((v) => v !== null)) return 'custom';
  const mx = ev.dns.mx.map((m) => m.exchange).join(' ');
  if (/google\.com|googlemail/.test(mx)) return 'google';
  if (/outlook\.com/.test(mx)) return 'microsoft';
  if (/zoho/.test(mx)) return 'zoho';
  if (/icloud\.com/.test(mx)) return 'icloud';
  if (/protonmail|proton\.me/.test(mx)) return 'proton';
  if (/messagingengine\.com/.test(mx)) return 'fastmail';
  if (/improvmx|forwardemail/.test(mx)) return 'forwarding';
  return undefined;
}

export function detectFramework(t: string, page: ParsedPage | null, headers: Record<string, string>): string | undefined {
  if (/\/_next\/static|__next_data__|next-head-count|__next_f/.test(t) || (headers['x-powered-by'] ?? '').toLowerCase().includes('next')) return 'next';
  if (/\/_nuxt\/|__nuxt__|__nuxt/.test(t)) return 'nuxt';
  if (/astro-island|content="astro/.test(t)) return 'astro';
  if (/__remixcontext|remix-run/.test(t)) return 'remix';
  if (/\/_app\/immutable\/|__sveltekit/.test(t)) return 'sveltekit';
  if (/content="gatsby/.test(t)) return 'gatsby';
  if (page) {
    const hasModule = page.scripts.some((s) => s.module && s.src && /\/assets\//.test(s.src));
    const hasPreload = page.links.some((l) => l.rel === 'modulepreload');
    if (hasModule || hasPreload || /\/assets\/index-[a-z0-9_-]+\.js/.test(t)) return 'vite';
  }
  if (/\/static\/js\/main\.[a-f0-9]+\.js/.test(t)) return 'create-react-app';
  return undefined;
}

export function detectStack(ev: Evidence, page: ParsedPage | null): Stack {
  const t = texts(ev, page);
  const headers = ev.page?.headers ?? {};
  const stack: Stack = {};
  // A local server's headers say nothing about where the site will be hosted.
  const host = ev.preLaunch ? undefined : detectHost(ev);
  if (host) stack.host = host;
  const dns = detectDnsProvider(ev.dns.ns);
  if (dns) stack.dns = dns;
  else if (ev.platformSuffix) stack.dns = ev.platformSuffix;
  const builder = detectBuilder(t, headers);
  if (builder) stack.builder = builder;
  const db = detectDb(ev, t);
  if (db) stack.db = db;
  const payments = detectPayments(t);
  if (payments) stack.payments = payments;
  const analytics = detectAnalytics(t);
  if (analytics.length) stack.analytics = analytics;
  const emailProvider = detectEmailProvider(ev);
  if (emailProvider) stack.emailProvider = emailProvider;
  const framework = detectFramework(t, page, headers);
  if (framework) stack.framework = framework;
  return stack;
}
