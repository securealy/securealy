import { describe, it, expect } from 'vitest';
import { findSecrets, redactSecret, redactText, secretLikeName, secretValuesFromEnv, urlPassword, buildContext, REMOTE_CHECKS, emptyEvidence, makeRecord } from '../src/index.js';

const STRIPE = 'sk_live_' + 'FAKE0123456789abcdefghijklmnop';
const OPENAI = 'sk-proj-' + 'FAKEabcdefghijklmnopqrstuvwxyz0123456789';
const ANTHROPIC = 'sk-ant-' + 'FAKEapi03abcdefghijklmnopqrstuvwxyz';
const AWS = 'AKIA' + 'FAKE0123456789AB';
const GITHUB = 'ghp_' + 'FAKEabcdefghijklmnopqrstuvwxyz0123456789';
const SLACK = 'xoxb-' + '000000000000-000000000000-FAKEabcdefghij';
const SENDGRID = 'SG.' + 'FAKEabcdefghijklmnop' + '.' + 'FAKEabcdefghijklmnopqrstuvwxyz';
const RESEND = 're_' + 'FAKEabcd' + '_' + 'FAKEabcdefghijklmnopqrst';
// Varied hex: a single repeated character is a documentation placeholder, which the scanner ignores on purpose.
const TWILIO_SK = 'SK' + 'f1e2d3c4b5a69788776655443322110a';
const TWILIO_AC = 'AC' + 'e1d2c3b4a5968778695a4b3c2d1e0f9a';

function serviceRoleJwt(): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase', role: 'service_role', ref: 'abcdefghijklmnopqrst' })}.FAKEsignatureFAKEsignatureFAKE`;
}

function anonJwt(): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase', role: 'anon', ref: 'abcdefghijklmnopqrst' })}.FAKEsignatureFAKEsignatureFAKE`;
}

describe('redaction', () => {
  it('keeps six characters plus an ellipsis', () => {
    expect(redactSecret(STRIPE)).toBe('sk_liv…');
    expect(redactSecret('abc')).toBe('abc…');
  });

  it('detects every documented secret kind and never returns the value', () => {
    const text = [STRIPE, OPENAI, ANTHROPIC, AWS, GITHUB, SLACK, SENDGRID, RESEND, TWILIO_SK, serviceRoleJwt(), 'private_key: "-----BEGIN PRIVATE KEY-----FAKEFAKEFAKEFAKE"'].join('\n');
    const found = findSecrets(text, 'bundle.js', 50);
    const kinds = new Set(found.map((f) => f.kind));
    for (const k of ['stripe-secret', 'openai', 'anthropic', 'aws-access-key', 'github-token', 'slack-token', 'sendgrid', 'resend', 'twilio-api-key', 'supabase-service-role', 'private-key']) {
      expect(kinds.has(k as never), k).toBe(true);
    }
    for (const f of found) {
      expect(f.redacted.length).toBe(7);
      expect(f.redacted.endsWith('…')).toBe(true);
      expect(text.includes(f.redacted.slice(0, 6))).toBe(true);
      expect(f.location).toBe('bundle.js');
    }
    const serialized = JSON.stringify(found);
    for (const s of [STRIPE, OPENAI, ANTHROPIC, AWS, GITHUB, SLACK, SENDGRID, RESEND, TWILIO_SK]) expect(serialized.includes(s)).toBe(false);
  });

  it('does not flag an anon-role Supabase JWT or a publishable Stripe key', () => {
    const found = findSecrets(`${anonJwt()} pk_live_FAKE0123456789abcdefghijkl`, 'x');
    expect(found.filter((f) => f.kind === 'supabase-service-role')).toHaveLength(0);
    expect(found.filter((f) => f.kind === 'stripe-secret')).toHaveLength(0);
  });

  it('marks a Twilio account SID as low confidence', () => {
    const found = findSecrets(TWILIO_AC, 'x');
    expect(found[0]?.kind).toBe('twilio-account-sid');
    expect(found[0]?.confidence).toBe('low');
  });

  it('scrubs secrets out of free text', () => {
    expect(redactText(`key=${STRIPE} and ${AWS}`)).toBe('key=sk_liv… and AKIAFA…');
  });

  it('classifies variable names', () => {
    expect(secretLikeName('NEXT_PUBLIC_SUPABASE_SERVICE_KEY')).toBe(true);
    expect(secretLikeName('VITE_STRIPE_SECRET_KEY')).toBe(true);
    expect(secretLikeName('NEXT_PUBLIC_SUPABASE_ANON_KEY')).toBe(false);
    expect(secretLikeName('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY')).toBe(false);
    expect(secretLikeName('NEXT_PUBLIC_SITE_URL')).toBe(false);
  });

  it('learns the password inside any URL-shaped env value, whatever the variable is called', () => {
    expect(urlPassword('postgres://app:s3cretPassw0rd@db.example:5432/app')).toBe('s3cretPassw0rd');
    expect(urlPassword('redis://default:p%40ss%2Fword@cache.example:6379')).toBe('p%40ss%2Fword');
    expect(urlPassword('https://app.example/')).toBeNull();
    expect(urlPassword('https://user@app.example/')).toBeNull();
    expect(urlPassword('just a value')).toBeNull();
    const values = secretValuesFromEnv({ DATABASE_URL: 'postgres://app:s3cretPassw0rd@db.example:5432/app', CACHE: 'redis://default:p%40ss%2Fword@cache.example:6379', STRIPE_SECRET_KEY: 'sk_test_FAKE', NEXT_PUBLIC_SITE_URL: 'https://app.example', EMPTY: undefined });
    expect(values).toContain('s3cretPassw0rd');
    expect(values).toContain('p%40ss%2Fword');
    expect(values).toContain('p@ss/word');
    expect(values).toContain('sk_test_FAKE');
    expect(values).not.toContain('https://app.example');
    expect(values).not.toContain('postgres://app:s3cretPassw0rd@db.example:5432/app');
  });

  it('secrets-in-bundle evidence is redacted and names the file', () => {
    const ev = emptyEvidence('https://app.example/', 'app.example', 'app.example');
    const body = '<!doctype html><html><head><title>x</title></head><body></body></html>';
    ev.page = makeRecord({ url: 'https://app.example/', status: 200, headers: { 'content-type': 'text/html' }, body, bytes: body.length, bodyHint: 'html' });
    ev.bundles = [makeRecord({ url: 'https://app.example/assets/index-8f3a.js', status: 200, headers: {}, body: `const k="${STRIPE}";`, bytes: 40 })];
    const mod = REMOTE_CHECKS.find((m) => m.id === 'secrets-in-bundle')!;
    const r = mod.run(buildContext(ev));
    expect(r.status).toBe('fail');
    expect(r.evidence).toContain('sk_liv…');
    expect(r.evidence).toContain('/assets/index-8f3a.js');
    expect(r.evidence).toContain('(redacted)');
    expect(JSON.stringify(r).includes(STRIPE)).toBe(false);
  });
});
