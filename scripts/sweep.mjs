#!/usr/bin/env node
// Fails when a tracked file contains a credential-shaped string or a hostname
// that is not securealy.com, a public registry, a standards body, or a fixture.
// Runs in CI and before every release. Exit 1 lists each hit.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);

const SECRET_SHAPES = [
  /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}\b/,
  /\bsb_secret_[A-Za-z0-9_-]{16,}\b/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/,
  /\bsk-proj-[A-Za-z0-9_-]{20,}\b/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/,
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/,
  /\bre_[A-Za-z0-9]{6,}_[A-Za-z0-9]{12,}\b/,
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----\s*[A-Za-z0-9+/=\s]{40,}/,
  /\bsly_[A-Za-z0-9]{24,}\b/,
  /\bmch_[A-Za-z0-9]{16,}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{20,}\b/,
  /\bwhsec_[A-Za-z0-9]{16,}\b/, // Stripe webhook signing secret
  /\bsbp_[A-Za-z0-9]{16,}\b/, // Supabase personal access token
  /\bAIza[0-9A-Za-z_-]{35}\b/, // Google API key
  /\bnpm_[A-Za-z0-9]{36}\b/, // npm token
  /\bpk_live_[0-9A-Za-z]{16,}\b/, // Stripe live publishable key (sk_live_ and rk_live_ are in the first shape)
  /\bcfat_[A-Za-z0-9_-]{16,}\b/, // Cloudflare API token
  /\b(?:prj|team)_[A-Za-z0-9]{16,}\b/, // Vercel project and team ids
];

// Addresses the request-forgery guard and its tests name on purpose; anything else dotted-quad is a leak.
const ALLOWED_IPS = new Set(['0.0.0.0', '127.0.0.1', '10.0.0.0', '192.168.0.1', '169.254.169.254', '8.8.8.8', '1.1.1.1']);
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

// Addresses in docs and tests may only be on reserved or our own domains.
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const ALLOWED_EMAIL_DOMAINS = /(^|\.)(?:example\.com|securealy\.com|users\.noreply\.github\.com)$|\.example$/i;

// A placeholder body (FAKE, xxxx, example) in a test or a document that explains a format is not a credential.
const PLACEHOLDER = /FAKE|xxxx|example|your[_-]/i;

// Hostnames the public repository may legitimately mention.
const ALLOWED_HOSTS = [
  /(^|\.)securealy\.com$/,
  /(^|\.)example(\.com|\.org|\.net)?$/,
  /\.example$/,
  /(^|\.)localhost$/,
  /(^|\.)github\.com$/,
  /(^|\.)githubusercontent\.com$/,
  /(^|\.)npmjs\.(com|org)$/,
  /(^|\.)nodejs\.org$/,
  /(^|\.)modelcontextprotocol\.io$/,
  /(^|\.)agentskills\.io$/,
  /(^|\.)claude\.(ai|com)$/,
  /(^|\.)anthropic\.com$/,
  /(^|\.)cursor\.com$/,
  /(^|\.)visualstudio\.com$/,
  /(^|\.)smithery\.ai$/,
  /(^|\.)glama\.ai$/,
  /(^|\.)apache\.org$/,
  /(^|\.)w3\.org$/,
  /(^|\.)json-schema\.org$/,
  /(^|\.)schema\.org$/,
  /(^|\.)iana\.org$/,
  /(^|\.)letsencrypt\.org$/,
  /(^|\.)rdap\.org$/,
  /(^|\.)google\.com$/,
  /(^|\.)googleapis\.com$/,
  /(^|\.)supabase\.com$/,
  /^abcdefghijklmnopqrst\.supabase\.co$/, // the fixture project ref, the only Supabase project host allowed
  /(^|\.)stripe\.com$/,
  /(^|\.)vercel\.(com|app)$/,
  /(^|\.)cloudflare\.com$/,
  /(^|\.)cloudflare-dns\.com$/,
  /(^|\.)openai\.com$/,
  /(^|\.)chatgpt\.com$/,
  /(^|\.)twitter\.com$/,
  /(^|\.)fonts\.gstatic\.com$/,
  /(^|\.)gstatic\.com$/,
  /(^|\.)jsdelivr\.net$/,
  /(^|\.)unpkg\.com$/,
  /(^|\.)cdnjs\.cloudflare\.com$/,
  /(^|\.)firebaseio\.com$/,
  /(^|\.)firebase\.com$/,
  /(^|\.)posthog\.com$/,
  /(^|\.)plausible\.io$/,
  /(^|\.)fathom\.com$/,
  /(^|\.)usefathom\.com$/,
  /(^|\.)umami\.is$/,
  /(^|\.)segment\.(com|io)$/,
  /(^|\.)mixpanel\.com$/,
  /(^|\.)hotjar\.com$/,
  /(^|\.)clarity\.ms$/,
  /(^|\.)googletagmanager\.com$/,
  /(^|\.)google-analytics\.com$/,
  /(^|\.)facebook\.(com|net)$/,
  /(^|\.)linkedin\.com$/,
  /(^|\.)cookiebot\.com$/,
  /(^|\.)onetrust\.com$/,
  /(^|\.)iubenda\.com$/,
  /(^|\.)resend\.com$/,
  /(^|\.)sendgrid\.net$/,
  /(^|\.)amazonses\.com$/,
  /(^|\.)mailgun\.org$/,
  /(^|\.)postmarkapp\.com$/,
  /(^|\.)mimecast\.com$/,
  /(^|\.)outlook\.com$/,
  /(^|\.)pphosted\.com$/,
  /(^|\.)messagingengine\.com$/,
  /(^|\.)secureserver\.net$/,
  /(^|\.)protonmail\.ch$/,
  /(^|\.)zoho\.com$/,
  /(^|\.)mintcdn\.com$/,
  /(^|\.)verisign\.com$/,
  /(^|\.)sitemaps\.org$/,
  /(^|\.)lovable\.dev$/,
  // Builder products the engine recognises by name.
  /(^|\.)replit\.com$/,
  /(^|\.)framer\.com$/,
  /(^|\.)webflow\.com$/,
  /(^|\.)v0\.dev$/,
  /(^|\.)bolt\.new$/,
  /(^|\.)name\.com$/,
  /^your-app\./,
];
// Second-level country labels the engine's domain table lists (co.uk, com.co ...).
const SECOND_LEVEL = /^(?:com|net|org|co|ac|gov|edu|ne|or|firm|me|ltd|plc)\.[a-z]{2}$/;
// Platform suffixes the engine lists for stack detection (any label in front).
const PLATFORM = /(vercel\.app|netlify\.app|pages\.dev|workers\.dev|onrender\.com|fly\.dev|railway\.app|lovable\.app|lovableproject\.com|bolt\.host|replit\.app|repl\.co|base44\.app|softr\.app|framer\.(website|app)|webflow\.io|wixsite\.com|github\.io|gitlab\.io|surge\.sh|herokuapp\.com|glitch\.me|web\.app|firebaseapp\.com|azurewebsites\.net|amplifyapp\.com|cloudfront\.net|appspot\.com|deno\.dev|val\.run|streamlit\.app|hf\.space|ngrok(-free)?\.app|trycloudflare\.com|bubbleapps\.io|squarespace\.com|myshopify\.com|carrd\.co|super\.site|notion\.site|typedream\.app|dorik\.io|stripe\.com|vercel\.com|cloudflare\.com)$/;

const HOST_RE = /\b(?:https?:\/\/)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|dev|app|ai|co|me|sh|site|cloud|uk|au))\b/gi;
const SKIP = [/(^|\/)package-lock\.json$/, /^packages\/core\/test\/fixtures\//, /^LICENSE$/, /\.(png|jpg|jpeg|gif|webp|ico|woff2?)$/];

const hits = [];
for (const file of files) {
  if (SKIP.some((re) => re.test(file))) continue;
  const text = readFileSync(file, 'utf8');
  for (const re of SECRET_SHAPES) {
    const m = re.exec(text);
    if (!m) continue;
    const placeholder = (/\/test\//.test(file) && /FAKE/.test(m[0])) || (/\.md$/.test(file) && PLACEHOLDER.test(m[0]));
    if (!placeholder) hits.push(`${file}: credential-shaped string ${m[0].slice(0, 8)}…`);
  }
  for (const m of text.matchAll(IPV4_RE)) {
    if (!ALLOWED_IPS.has(m[0])) hits.push(`${file}: address ${m[0]}`);
  }
  for (const m of text.matchAll(EMAIL_RE)) {
    const domain = m[0].slice(m[0].indexOf('@') + 1).toLowerCase();
    if (!ALLOWED_EMAIL_DOMAINS.test(domain)) hits.push(`${file}: email address ${m[0]}`);
  }
  for (const m of text.matchAll(HOST_RE)) {
    const host = m[1].toLowerCase();
    if (ALLOWED_HOSTS.some((re) => re.test(host)) || PLATFORM.test(host) || SECOND_LEVEL.test(host)) continue;
    // File names and package specifiers that merely look like hostnames.
    if (/\.(ts|js|mjs|json|md|yml|yaml|txt|html|css)$/.test(host)) continue;
    hits.push(`${file}: hostname ${host}`);
  }
}

if (hits.length) {
  console.error('sweep: review these before publishing');
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}
console.log(`sweep: ${files.length} tracked files clean`);
