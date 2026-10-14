import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterAll } from 'vitest';
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

describe('grade of a local server', () => {
  const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Local app under test before launch</title><meta name="description" content="A page served from this machine so the CLI can grade it before any domain exists.">
<link rel="canonical" href="https://local-app.example/"><script type="module" src="/app.js"></script></head>
<body><h1>Local app</h1><a href="/privacy">Privacy</a><a href="/terms">Terms</a></body></html>`;
  const HEADERS = {
    'content-security-policy': "default-src 'self'; frame-ancestors 'none'; form-action 'self'",
    'strict-transport-security': 'max-age=31536000',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=()',
  };
  let http: Server | undefined;
  const dirs: string[] = [];
  afterAll(async () => {
    if (http) await new Promise<void>((r) => http!.close(() => r()));
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  const serve = async (): Promise<string> => {
    http = createServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(200, { ...HEADERS, 'content-type': 'text/html; charset=utf-8' });
        return res.end(PAGE);
      }
      if (req.url === '/app.js') {
        res.writeHead(200, { ...HEADERS, 'content-type': 'application/javascript' });
        return res.end('console.log("local");');
      }
      res.writeHead(req.url === '/privacy' || req.url === '/terms' ? 200 : 404, { ...HEADERS, 'content-type': 'text/plain' });
      res.end('x');
    });
    await new Promise<void>((r) => http!.listen(0, '127.0.0.1', r));
    const addr = http.address();
    return typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
  };
  const io = () => {
    const out: string[] = [];
    const err: string[] = [];
    const cwd = mkdtempSync(join(tmpdir(), 'securealy-cli-'));
    dirs.push(cwd);
    return { out, err, io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s), color: false, cwd, env: {} as Record<string, string> } };
  };

  it('grades a loopback URL as a pre-launch grade and says so once', async () => {
    const url = await serve();
    const { out, err, io: o } = io();
    const code = await main(['grade', url, '--no-history', '--min-grade', 'F'], o);
    expect(code).toBe(0);
    expect(err).toContain('pre-launch grade of a local address; checks that need a public domain are skipped');
    const text = out.join('\n');
    expect(text).toMatch(/Grade [A-F] {2}\(\d+\/100\) {3}pre-launch, passive tier/);
    expect(text).toContain('skip  hsts');
    expect(text).toContain('not applicable before deploy: https on the public hostname');
    expect(text).toContain('pass  csp');
    expect(text).toContain('pass  canonical');
    expect(JSON.parse(out[out.length - 1] ?? '{}').preLaunch).toBe(true);
    // Nothing about a domain was asked for: no port-80 probe, no RDAP, no TLS.
    expect(text).not.toContain('ERR ');
  });

  it('still refuses a private address that is not loopback', async () => {
    const lan = [192, 168, 1, 20].join('.');
    const { io: o } = io();
    await expect(main(['grade', `http://${lan}:3000`, '--no-history'], o)).rejects.toThrow(/private, loopback, link-local or reserved/);
    await expect(main(['grade', 'http://app.internal:3000', '--no-history'], o)).rejects.toThrow(/reserved for the local machine or network/);
  });
});

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

  it('labels a pre-launch result in the banner and the summary line', () => {
    const local: GradeResult = { ...sample, preLaunch: true, input: 'http://localhost:3000', finalUrl: 'http://localhost:3000/', host: 'localhost' };
    expect(renderReport(local)).toContain('Grade D  (71/100)   pre-launch, passive tier');
    expect(JSON.parse(summaryLine(local)).preLaunch).toBe(true);
    expect(renderReport(sample)).toContain('Grade D  (71/100)   passive tier');
    expect(JSON.parse(summaryLine(sample)).preLaunch).toBeUndefined();
  });

  it('prints help and exits 1 without a command', async () => {
    const out: string[] = [];
    const code = await main([], { out: (s) => out.push(s), err: (s) => out.push(s), color: false });
    expect(code).toBe(1);
    expect(out.join('\n')).toContain('Usage');
  });
});
