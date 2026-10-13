import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { grade, runLocal, verificationOptions, OptOutError, VerificationError } from 'securealy-core';
import type { GradeResult } from 'securealy-core';
import { API_BASE, meetsMinimum, parseGrade, renderReport, summaryLine } from './report.js';
import { CLI_VERSION, recordRun } from './record.js';
import type { RunCommand } from './record.js';

const HELP = `securealy: grade a freshly launched app the way an attacker and a customer would see it

Usage
  securealy grade <url> [--json] [--min-grade C] [--tier verified --token sly_...] [--bypass <vercel bypass token>] [--verbose]
  securealy verify <domain> [--token sly_...]      print the three ownership-verification options
  securealy scan-repo [path]                       repo-secrets, gitignore-env-coverage, env-example-parity
  securealy check-rls                              rls-policies and supabase-auth-config from your env
  securealy check-stripe                           stripe-webhook-wiring from STRIPE_SECRET_KEY
  securealy check-vercel-env                       vercel-env-hygiene from VERCEL_TOKEN + VERCEL_PROJECT_ID
  securealy local [path]                           every local check at once
  securealy post <result.json> --token sly_...     store a local result against your project

Options
  --json            print the GradeResult instead of the report
  --compact         hide passing and skipped rows in the report
  --min-grade <g>   exit 1 when the grade is below this (default C)
  --no-color        plain output
  --no-history      do not append this run to .securealy/history.json (or set SECUREALY_NO_HISTORY=1)
  -h, --help        this text

Every run is appended to .securealy/history.json in the current folder (grade, score,
counts, failing check ids; never evidence or values) so the next run can say what changed.
Set SECUREALY_TELEMETRY=1 to also send an anonymous aggregate (grade, counts, stack kind,
failing ids; no URL, no host, no evidence) to securealy.com. Off by default.

Nothing here prints a secret. Every environment variable is trimmed before use and
only ever sent to the service it belongs to.`;

const LOCAL_SETS: Record<string, string[]> = {
  'scan-repo': ['repo-secrets', 'gitignore-env-coverage', 'env-example-parity'],
  'check-rls': ['rls-policies', 'supabase-auth-config'],
  'check-stripe': ['stripe-webhook-wiring'],
  'check-vercel-env': ['vercel-env-hygiene'],
  local: [],
};

export interface Io {
  out(s: string): void;
  err(s: string): void;
  color: boolean;
  /** Test hooks. Default: process.cwd(), process.env, global fetch, the securealy.com telemetry endpoint. */
  cwd?: string;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  telemetryEndpoint?: string;
}

function defaultIo(noColor: boolean): Io {
  return {
    out: (s) => process.stdout.write(s + '\n'),
    err: (s) => process.stderr.write(s + '\n'),
    color: !noColor && !!process.stdout.isTTY && !process.env['NO_COLOR'],
  };
}

export async function main(argv: string[], io?: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: { type: 'boolean', default: false },
      compact: { type: 'boolean', default: false },
      tier: { type: 'string' },
      token: { type: 'string' },
      bypass: { type: 'string' },
      'min-grade': { type: 'string' },
      verbose: { type: 'boolean', default: false },
      'no-color': { type: 'boolean', default: false },
      'no-history': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const o = io ?? defaultIo(values['no-color'] === true);
  const [command, arg] = positionals;
  if (values.help || !command) {
    o.out(HELP);
    return values.help ? 0 : 1;
  }
  const minGrade = parseGrade(values['min-grade']);
  const cwd = o.cwd ?? process.cwd();
  const env = o.env ?? (process.env as Record<string, string | undefined>);
  const emit = async (r: GradeResult, ran: RunCommand): Promise<number> => {
    const rec = recordRun(r, ran, { cwd, env, noHistory: values['no-history'] === true, fetch: o.fetch, telemetryEndpoint: o.telemetryEndpoint, userAgent: `securealy-cli/${CLI_VERSION}` });
    if (values.json) o.out(JSON.stringify(r, null, 2));
    else {
      o.out(renderReport(r, { color: o.color, compact: values.compact === true }));
      if (rec.comparison) o.out(rec.comparison);
      o.out(summaryLine(r));
    }
    await rec.telemetry;
    return meetsMinimum(r.grade, minGrade) ? 0 : 1;
  };

  switch (command) {
    case 'grade': {
      if (!arg) throw new Error('grade needs a URL');
      const tier = values.tier === 'verified' ? 'verified' : 'passive';
      if (tier === 'verified' && !values.token) throw new Error('--tier verified needs --token sly_...');
      try {
        const r = await grade(arg, {
          tier,
          verifyToken: values.token?.trim(),
          bypassToken: values.bypass?.trim(),
          fetch: o.fetch,
          log: values.verbose ? (line) => o.err(`  ${line}`) : undefined,
        });
        return await emit(r, 'grade');
      } catch (e) {
        if (e instanceof OptOutError) {
          o.err(e.message);
          return 2;
        }
        if (e instanceof VerificationError) {
          o.err(e.message);
          o.err('');
          o.err(verifyText(e.host, values.token));
          return 2;
        }
        throw e;
      }
    }
    case 'verify': {
      if (!arg) throw new Error('verify needs a domain');
      o.out(verifyText(arg.replace(/^https?:\/\//, '').replace(/\/.*$/, ''), values.token));
      return 0;
    }
    case 'scan-repo':
    case 'check-rls':
    case 'check-stripe':
    case 'check-vercel-env':
    case 'local': {
      const target = resolve(cwd, arg ?? '.');
      const checks = LOCAL_SETS[command] ?? [];
      const localEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(env)) if (typeof v === 'string') localEnv[k] = v;
      const r = await runLocal({ cwd: target, checks, env: localEnv, fetch: o.fetch, log: values.verbose ? (line) => o.err(`  ${line}`) : undefined });
      return await emit(r, command);
    }
    case 'post': {
      if (!arg) throw new Error('post needs a result.json path');
      const token = values.token?.trim();
      if (!token) throw new Error('post needs --token sly_...');
      const raw = await readFile(resolve(arg), 'utf8');
      const result = JSON.parse(raw) as GradeResult;
      if (result.schema !== 1 || !Array.isArray(result.checks)) throw new Error(`${arg} is not a Securealy GradeResult`);
      const res = await (o.fetch ?? fetch)(`${API_BASE}/api/results`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'user-agent': `securealy-cli/${CLI_VERSION}` },
        body: JSON.stringify(result),
      });
      const text = await res.text();
      if (!res.ok) {
        o.err(`post failed: ${res.status} ${text.slice(0, 200)}`);
        return 1;
      }
      o.out(text.slice(0, 2000));
      return 0;
    }
    default:
      o.err(`unknown command: ${command}`);
      o.out(HELP);
      return 1;
  }
}

function verifyText(domain: string, token?: string): string {
  const v = verificationOptions(domain, token?.trim());
  const lines = [
    `Prove you own ${domain} with any ONE of these, then run: securealy grade https://${domain} --tier verified --token <sly_...>`,
    '',
    `  1. DNS TXT record`,
    `     ${v.dns}`,
    '',
    `  2. Meta tag in the home page <head>`,
    `     ${v.meta}`,
    '',
    `  3. Well-known file`,
    `     ${v.wellKnown}`,
    '',
    token ? `The value is a fingerprint of your token, never the token itself.` : `Pass --token sly_... to fill in the fingerprint; the token itself is never published.`,
  ];
  return lines.join('\n');
}
