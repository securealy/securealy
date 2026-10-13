/**
 * Small, dependency-free domain helpers. Not a full public suffix list: a
 * short table of multi-label country suffixes plus the hosting platforms whose
 * customers get a subdomain, which is where most freshly launched apps live.
 */

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

export function normalizeInput(input: string): URL {
  let s = input.trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  const u = new URL(s);
  u.hash = '';
  if (!u.hostname) throw new Error(`Not a URL: ${input}`);
  return u;
}
