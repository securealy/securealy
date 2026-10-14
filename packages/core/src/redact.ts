/**
 * Secret detection and redaction. Shared by the bundle scanner, the repo
 * scanner and the hosting env check. Nothing in here ever returns a whole
 * secret: every finding carries only the first six characters plus an ellipsis.
 */

export type SecretKind =
  | 'stripe-secret'
  | 'supabase-service-role'
  | 'supabase-secret-key'
  | 'aws-access-key'
  | 'openai'
  | 'anthropic'
  | 'twilio-api-key'
  | 'twilio-account-sid'
  | 'sendgrid'
  | 'resend'
  | 'github-token'
  | 'slack-token'
  | 'private-key';

export interface SecretPattern {
  kind: SecretKind;
  re: RegExp;
  /** low confidence findings become warn instead of fail */
  confidence: 'high' | 'low';
  /** optional extra validation on the matched string */
  verify?: (match: string) => boolean;
}

function jwtRole(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(json) as { role?: unknown };
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

export const SECRET_PATTERNS: SecretPattern[] = [
  { kind: 'stripe-secret', re: /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}\b/g, confidence: 'high' },
  {
    kind: 'supabase-service-role',
    re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    confidence: 'high',
    verify: (m) => jwtRole(m) === 'service_role',
  },
  { kind: 'supabase-secret-key', re: /\bsb_secret_[A-Za-z0-9_-]{16,}\b/g, confidence: 'high' },
  { kind: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, confidence: 'high' },
  { kind: 'anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, confidence: 'high' },
  { kind: 'openai', re: /\bsk-proj-[A-Za-z0-9_-]{20,}\b/g, confidence: 'high' },
  { kind: 'openai', re: /\bsk-(?!ant-|proj-)[A-Za-z0-9]{32,}\b/g, confidence: 'high' },
  { kind: 'twilio-api-key', re: /\bSK[0-9a-f]{32}\b/g, confidence: 'high' },
  { kind: 'twilio-account-sid', re: /\bAC[0-9a-f]{32}\b/g, confidence: 'low' },
  { kind: 'sendgrid', re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, confidence: 'high' },
  { kind: 'resend', re: /\bre_[A-Za-z0-9]{6,}_[A-Za-z0-9]{12,}\b/g, confidence: 'high' },
  { kind: 'github-token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g, confidence: 'high' },
  { kind: 'github-token', re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g, confidence: 'high' },
  { kind: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, confidence: 'high' },
  { kind: 'private-key', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g, confidence: 'high' },
  {
    kind: 'private-key',
    re: /["']?private_key["']?\s*[:=]\s*["'][^"'\n]{20,}["']/g,
    confidence: 'high',
  },
];

export interface SecretFinding {
  kind: SecretKind;
  confidence: 'high' | 'low';
  /** first six characters plus an ellipsis, never more */
  redacted: string;
  /** where it was found (file path, URL path, commit) */
  location: string;
  /** 1-based line when known */
  line?: number;
}

/** First six characters plus an ellipsis. */
export function redactSecret(value: string): string {
  const head = value.slice(0, 6);
  return `${head}…`;
}

/**
 * Scan a text for secret-shaped strings. Returns at most `max` findings,
 * de-duplicated by kind and redacted prefix.
 */
/**
 * Documentation and sample code carry key-shaped placeholders: sk_live_xxxxxxxx,
 * sk-YOUR_KEY_HERE, the AWS docs key that ends in EXAMPLE. A real key never
 * repeats one character for its whole body or spells out that it is a placeholder.
 */
export function looksLikePlaceholder(value: string): boolean {
  const body = value.replace(/^(?:sk|rk|pk)_(?:live|test)_|^sk-(?:ant-|proj-)?|^(?:AKIA|ASIA)|^SG\.|^re_|^gh[pousr]_|^github_pat_|^xox[abprs]-|^SK|^AC/, '');
  if (new Set(body.toLowerCase()).size <= 3) return true;
  return /xxxx|your[_-]?|example|placeholder|replace[_-]?me|insert|changeme|dummy|sample/i.test(body);
}

export function findSecrets(text: string, location: string, max = 20): SecretFinding[] {
  const out: SecretFinding[] = [];
  const seen = new Set<string>();
  for (const p of SECRET_PATTERNS) {
    p.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.re.exec(text)) !== null) {
      const value = m[0];
      if (p.verify && !p.verify(value)) continue;
      if (p.kind !== 'private-key' && looksLikePlaceholder(value)) continue;
      const redacted = redactSecret(value);
      const key = `${p.kind}:${redacted}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const line = text.slice(0, m.index).split('\n').length;
      out.push({ kind: p.kind, confidence: p.confidence, redacted, location, line });
      if (out.length >= max) return out;
    }
  }
  return out;
}

/**
 * Replace every secret-shaped string in a free-text string with its redacted
 * form. Used on evidence strings as a last line of defence.
 */
export function redactText(text: string): string {
  let out = text;
  for (const p of SECRET_PATTERNS) {
    p.re.lastIndex = 0;
    out = out.replace(p.re, (m) => (p.verify && !p.verify(m) ? m : redactSecret(m)));
  }
  return out;
}

/** Does a variable name look like it holds a secret? */
export function secretLikeName(name: string): boolean {
  const n = name.toUpperCase();
  if (/(PUBLISHABLE|ANON_KEY|PUBLIC_KEY|SITE_KEY|MEASUREMENT_ID|_ID$|_URL$|_HOST$|_REGION$)/.test(n)) return false;
  return /(SECRET|SERVICE_ROLE|SERVICE_KEY|PRIVATE|PASSWORD|PASSWD|_TOKEN|ACCESS_KEY|API_KEY|APIKEY|AUTH_KEY|SIGNING|WEBHOOK_KEY|CLIENT_SECRET|MGMT|MANAGEMENT)/.test(
    n,
  );
}

/** The password of a URL-shaped value (postgres://user:pass@host/db), whatever the variable is called. */
export function urlPassword(value: string): string | null {
  const v = value.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return null;
  try {
    const pw = new URL(v).password;
    return pw ? pw : null;
  } catch {
    return null;
  }
}

/**
 * Every environment value that must never appear in output: the value of any
 * secret-looking variable, plus the password of any value that is a URL with
 * userinfo (DATABASE_URL, REDIS_URL), in both its raw and decoded forms.
 */
export function secretValuesFromEnv(env: Record<string, string | undefined>): string[] {
  const out = new Set<string>();
  for (const [name, value] of Object.entries(env)) {
    if (typeof value !== 'string') continue;
    if (secretLikeName(name)) out.add(value);
    const pw = urlPassword(value);
    if (pw) {
      out.add(pw);
      try {
        out.add(decodeURIComponent(pw));
      } catch {
        /* not percent-encoded */
      }
    }
  }
  return [...out];
}
