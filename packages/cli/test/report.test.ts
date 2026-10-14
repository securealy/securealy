import { describe, it, expect } from 'vitest';
import type { GradeResult } from 'securealy-core';
import { renderReport, meetsMinimum, parseGrade, summaryLine } from '../src/report.js';
import { main } from '../src/cli.js';

const sample: GradeResult = {
  schema: 1,
  id: 'g_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  input: 'https://app.example',
  finalUrl: 'https://app.example/',
  host: 'app.example',
  gradedAt: '2026-10-12T00:00:00Z',
  tier: 'passive',
  grade: 'D',
  score: 71,
  capped: 'D or lower because of 1 blocker (uncapped C)',
  summary: { blocker: 1, fail: 1, warn: 1, pass: 2, skip: 1, error: 0 },
  stack: { host: 'vercel', db: 'supabase', analytics: ['ga4'] },
  checks: [
    { id: 'secrets-in-bundle', status: 'fail', severity: 'blocker', evidence: 'sk_liv… (stripe-secret) found in /assets/index-8f3a.js (redacted)', fixSlug: 'secrets-in-bundle' },
    { id: 'hsts', status: 'fail', severity: 'high', evidence: 'no Strict-Transport-Security header', fixSlug: 'hsts' },
    { id: 'title', status: 'warn', severity: 'medium', evidence: 'title is 12 characters', fixSlug: 'title' },
    { id: 'tls-valid', status: 'pass', severity: 'blocker', evidence: 'trusted certificate', fixSlug: 'tls-valid' },
    { id: 'spf', status: 'pass', severity: 'high', evidence: 'v=spf1 -all', fixSlug: 'spf' },
    { id: 'json-ld', status: 'skip', severity: 'low', evidence: 'no JSON-LD blocks', fixSlug: 'json-ld' },
  ],
  requests: 19,
  durationMs: 4120,
};

describe('report', () => {
  it('renders the stamp, blockers first, then categories with evidence', () => {
    const text = renderReport(sample);
    expect(text).toContain('Grade D  (71/100)');
    expect(text.indexOf('BLOCKERS')).toBeGreaterThan(0);
    expect(text.indexOf('BLOCKERS')).toBeLessThan(text.indexOf('SECURITY'));
    expect(text.indexOf('SECURITY')).toBeLessThan(text.indexOf('EMAIL'));
    expect(text).toContain('sk_liv… (stripe-secret) found in /assets/index-8f3a.js (redacted)');
    expect(text).toContain('https://securealy.com/checks/hsts');
    expect(text).toContain('stack: host vercel . db supabase . analytics ga4');
    expect(text.includes('\u001b[')).toBe(false);
    expect(text.startsWith(' ####  ')).toBe(true);
  });

  it('compact mode hides pass and skip rows', () => {
    const text = renderReport(sample, { compact: true });
    expect(text).not.toContain('tls-valid');
    expect(text).toContain('hsts');
  });

  it('summary line carries the five numbers', () => {
    expect(JSON.parse(summaryLine(sample))).toEqual({ grade: 'D', score: 71, capped: sample.capped, summary: sample.summary, requests: 19, durationMs: 4120 });
  });

  it('min-grade comparisons', () => {
    expect(meetsMinimum('C', 'C')).toBe(true);
    expect(meetsMinimum('D', 'C')).toBe(false);
    expect(meetsMinimum('A', 'B')).toBe(true);
    expect(parseGrade(undefined)).toBe('C');
    expect(parseGrade('b')).toBe('B');
    expect(() => parseGrade('Z')).toThrow();
  });

  it('verify prints the three options with a fingerprint and never the token', async () => {
    const out: string[] = [];
    const code = await main(['verify', 'app.example', '--token', 'sly_FAKEtokenFAKEtoken'], { out: (s) => out.push(s), err: (s) => out.push(s), color: false });
    const text = out.join('\n');
    expect(code).toBe(0);
    expect(text).toContain('_securealy.app.example');
    expect(text).toContain('<meta name="securealy-verify"');
    expect(text).toContain('/.well-known/securealy.txt');
    expect(text).not.toContain('sly_FAKEtokenFAKEtoken');
    expect(text).toMatch(/securealy-verify=[0-9a-f]{32}/);
  });

  it('reads the token from SECUREALY_TOKEN when no flag is given, and the flag wins', async () => {
    const run = async (argv: string[], env: Record<string, string>) => {
      const out: string[] = [];
      await main(argv, { out: (s) => out.push(s), err: (s) => out.push(s), color: false, env });
      return out.join('\n');
    };
    const flagged = await run(['verify', 'app.example', '--token', 'sly_FAKEtokenFAKEtoken'], {});
    const fromEnv = await run(['verify', 'app.example'], { SECUREALY_TOKEN: ' sly_FAKEtokenFAKEtoken\n' });
    const fp = /securealy-verify=([0-9a-f]{32})/.exec(flagged)?.[1];
    expect(fp).toBeTruthy();
    expect(fromEnv).toContain(`securealy-verify=${fp}`);
    expect(fromEnv).not.toContain('sly_FAKEtokenFAKEtoken');
    const flagWins = await run(['verify', 'app.example', '--token', 'sly_OTHERtokenOTHERtoken'], { SECUREALY_TOKEN: 'sly_FAKEtokenFAKEtoken' });
    expect(flagWins).not.toContain(`securealy-verify=${fp}`);
    const none = await run(['verify', 'app.example'], {});
    expect(none).toContain('Pass --token');
    await expect(main(['grade', 'https://app.example', '--tier', 'verified'], { out: () => {}, err: () => {}, color: false, env: {} })).rejects.toThrow(/SECUREALY_TOKEN/);
  });

  it('prints help and exits 1 without a command', async () => {
    const out: string[] = [];
    const code = await main([], { out: (s) => out.push(s), err: (s) => out.push(s), color: false });
    expect(code).toBe(1);
    expect(out.join('\n')).toContain('Usage');
  });
});
