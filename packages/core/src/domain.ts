/**
 * Small, dependency-free domain helpers. Not a full public suffix list: a
 * short table of multi-label country suffixes plus the hosting platforms whose
 * customers get a subdomain, which is where most freshly launched apps live.
 */

import { isPreLaunchHost, literalReason, UnsafeHostError } from './fetcher/safe.js';

const COUNTRY_SECOND_LEVEL = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'org.nz', 'net.nz',
  'com.br', 'org.br', 'net.br',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp',
  'co.in', 'net.in', 'org.in', 'firm.in',
  'com.mx', 'org.mx',
  'co.za', 'org.za',
  'com.sg', 'com.my', 'com.hk', 'com.tw', 'com.ar', 'com.co', 'com.pe', 'com.tr', 'com.ua',
  'co.kr', 'co.il', 'co.th', 'co.id',
]);

/** Suffixes under which every customer gets a subdomain and no registration of their own. */
export const PLATFORM_SUFFIXES = [
  'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev', 'onrender.com', 'fly.dev', 'up.railway.app', 'railway.app',
  'lovable.app', 'lovableproject.com', 'bolt.host', 'replit.app', 'repl.co', 'base44.app', 'softr.app', 'framer.website',
  'framer.app', 'webflow.io', 'wixsite.com', 'github.io', 'gitlab.io', 'surge.sh', 'herokuapp.com', 'glitch.me',
  'web.app', 'firebaseapp.com', 'azurewebsites.net', 'amplifyapp.com', 'cloudfront.net', 'appspot.com', 'deno.dev',
  'val.run', 'streamlit.app', 'hf.space', 'ngrok.app', 'ngrok-free.app', 'trycloudflare.com', 'bubbleapps.io',
  'squarespace.com', 'myshopify.com', 'carrd.co', 'super.site', 'notion.site', 'typedream.app', 'dorik.io',
];

export function platformSuffixOf(host: string): string | null {
  const h = host.toLowerCase();
  for (const s of PLATFORM_SUFFIXES) {
    if (h === s || h.endsWith(`.${s}`)) return s;
  }
  return null;
}

/** The registrable domain, or the platform subdomain when hosted on a platform suffix. */
export function apexOf(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, '');
  const platform = platformSuffixOf(h);
  if (platform) {
    const rest = h.slice(0, h.length - platform.length - 1);
    const first = rest.split('.').pop();
    return first ? `${first}.${platform}` : h;
  }
  const labels = h.split('.');
  if (labels.length <= 2) return h;
  const lastTwo = labels.slice(-2).join('.');
  if (COUNTRY_SECOND_LEVEL.has(lastTwo)) return labels.slice(-3).join('.');
  return lastTwo;
}

/**
 * Parse the input into an http(s) URL. A name or literal that can only mean
 * the local machine or a private network is refused here, before anything
 * resolves; the resolved addresses are checked again by the fetcher's guard.
 */
export function normalizeInput(input: string, opts: { allowPrivate?: boolean } = {}): URL {
  let s = input.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(s)?.[1]?.toLowerCase();
  if (scheme && scheme !== 'http' && scheme !== 'https') throw new Error(`Not an http(s) URL: ${input}`);
  if (!scheme) s = `https://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new Error(`Not a URL: ${input}`);
  }
  u.hash = '';
  if (!u.hostname) throw new Error(`Not a URL: ${input}`);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`Not an http(s) URL: ${input}`);
  if (!opts.allowPrivate) {
    const reason = literalReason(u.hostname);
    if (reason) throw new UnsafeHostError(u.hostname, reason);
  }
  // A local server has no TLS: a bare "localhost:3000" means http.
  if (!scheme && opts.allowPrivate && isPreLaunchHost(u.hostname)) u.protocol = 'http:';
  return u;
}

/**
 * True when the input names the developer's own machine (localhost,
 * *.localhost, *.test, the 127 loopback range or ::1), which the CLI and the MCP server
 * grade as a pre-launch grade. Anything that does not parse is false.
 */
export function isPreLaunchInput(input: string): boolean {
  let s = input.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  try {
    return isPreLaunchHost(new URL(s).hostname);
  } catch {
    return false;
  }
}
