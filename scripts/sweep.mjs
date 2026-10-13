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
];

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
  /(^|\.)supabase\.(co|com|in|red)$/,
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
  /(^|\.)name\.com$/,
  /^your-app\./,
];
// Second-level country labels the engine's domain table lists (co.uk, com.co ...).
const SECOND_LEVEL = /^(?:com|net|org|co|ac|gov|edu|ne|or|firm|me|ltd|plc)\.[a-z]{2}$/;
// Platform suffixes the engine lists for stack detection (any label in front).
const PLATFORM = /(vercel\.app|netlify\.app|pages\.dev|workers\.dev|onrender\.com|fly\.dev|railway\.app|lovable\.app|lovableproject\.com|bolt\.host|replit\.app|repl\.co|base44\.app|softr\.app|framer\.(website|app)|webflow\.io|wixsite\.com|github\.io|gitlab\.io|surge\.sh|herokuapp\.com|glitch\.me|web\.app|firebaseapp\.com|azurewebsites\.net|amplifyapp\.com|cloudfront\.net|appspot\.com|deno\.dev|val\.run|streamlit\.app|hf\.space|ngrok(-free)?\.app|trycloudflare\.com|bubbleapps\.io|squarespace\.com|myshopify\.com|carrd\.co|super\.site|notion\.site|typedream\.app|dorik\.io|supabase\.co|stripe\.com|vercel\.com|cloudflare\.com)$/;

const HOST_RE = /\b(?:https?:\/\/)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|dev|app|ai|co|me|sh|site|cloud|uk|au))\b/gi;
const SKIP = [/^package-lock\.json$/, /^packages\/core\/test\/fixtures\//, /^LICENSE$/, /\.(png|jpg|jpeg|gif|webp|ico|woff2?)$/];

const hits = [];
for (const file of files) {
  if (SKIP.some((re) => re.test(file))) continue;
  const text = readFileSync(file, 'utf8');
  for (const re of SECRET_SHAPES) {
    const m = re.exec(text);
    if (m && !(/\/test\//.test(file) && /FAKE/.test(m[0]))) hits.push(`${file}: credential-shaped string ${m[0].slice(0, 8)}…`);
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
