import { readFileSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, resolve, sep } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { grade, runLocal, catalogue, catalogueEntry, isPreLaunchInput, OptOutError, VerificationError } from 'securealy-core';
import type { Category, GradeResult, Resolver, Tier } from 'securealy-core';
import { recordRun } from 'securealy/record';
import type { RunCommand } from 'securealy/record';
import { API_BASE, ApiError, fetchFix, hostedGrade, postResult } from './api.js';
import { Redactor } from './redact.js';
import { summarize } from './summary.js';

const require = createRequire(import.meta.url);
const { version: VERSION } = require('../package.json') as { version: string };
const USER_AGENT = `securealy-mcp/${VERSION}`;

export interface ServerOptions {
  /** The environment the local checks read. Defaults to process.env. Values are trimmed by the engine and never echoed. */
  env?: Record<string, string | undefined>;
  /** Default repository path for scan_repo and the local checks. Defaults to process.cwd(). */
  cwd?: string;
  /** Injectable for tests. Defaults to global fetch. */
  fetch?: typeof fetch;
  /** Injectable DNS resolver for tests. */
  dns?: Resolver;
  skipDnssec?: boolean;
  /** Tests only: let grade_url fetch a fixture server on 127.0.0.1. Never set from an environment variable or a tool argument. */
  allowPrivate?: boolean;
  timeoutMs?: number;
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
  /** Diagnostic lines. Never stdout: stdio is the protocol channel. */
  log?: (line: string) => void;
  /** Injectable for tests: where SECUREALY_TELEMETRY=1 posts. Defaults to the securealy.com endpoint. */
  telemetryEndpoint?: string;
}

const CATEGORIES = ['security', 'email', 'domain', 'seo', 'hygiene', 'payments', 'analytics', 'performance'] as const;
const TIERS = ['passive', 'verified', 'local'] as const;

const LOCAL_SETS = {
  scan_repo: ['repo-secrets', 'gitignore-env-coverage', 'env-example-parity'],
  check_rls: ['rls-policies', 'supabase-auth-config'],
  check_stripe: ['stripe-webhook-wiring'],
  check_vercel_env: ['vercel-env-hygiene'],
} as const;

function readSpec(): string {
  for (const candidate of [new URL('./SPEC.md', import.meta.url), new URL('../../../SPEC.md', import.meta.url)]) {
    try {
      return readFileSync(candidate, 'utf8');
    } catch {
      /* try the next location */
    }
  }
  return 'SPEC.md is not bundled with this build. Read it at https://github.com/securealy/securealy/blob/main/SPEC.md';
}

function checkPage(id: string): string {
  return `${API_BASE}/checks/${encodeURIComponent(id)}`;
}

/**
 * Build the Securealy MCP server. One instance per process; the folder-trust
 * set for scan_repo lives for the life of that instance.
 */
export function createServer(opts: ServerOptions = {}): McpServer {
  const env = opts.env ?? (process.env as Record<string, string | undefined>);
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const log = opts.log ?? (() => {});
  const baseCwd = opts.cwd ?? process.cwd();
  const api = { fetch: fetchImpl, userAgent: USER_AGENT, pollTimeoutMs: opts.pollTimeoutMs, pollIntervalMs: opts.pollIntervalMs };
  const redactor = new Redactor();
  redactor.learnEnv(env);
  const trusted = new Set<string>();
  /**
   * scan_repo may only read under the server's working directory, or under a
   * folder listed in SECUREALY_SCAN_ROOTS (separated by the OS path delimiter).
   * Both sides are compared by real path, so a symlink cannot point outside.
   */
  const scanRoots = (): string[] => {
    const roots: string[] = [];
    for (const r of [baseCwd, ...(env['SECUREALY_SCAN_ROOTS'] ?? '').split(delimiter)]) {
      const t = r.trim();
      if (!t) continue;
      try {
        roots.push(realpathSync(resolve(baseCwd, t)));
      } catch {
        /* a root that does not exist allows nothing */
      }
    }
    return roots;
  };
  const contained = (abs: string): boolean => scanRoots().some((root) => abs === root || abs.startsWith(root.endsWith(sep) ? root : `${root}${sep}`));

  const ok = (text: string, structured?: Record<string, unknown>): CallToolResult => {
    const out: CallToolResult = { content: [{ type: 'text', text: redactor.text(text) }] };
    if (structured) out.structuredContent = redactor.value(structured);
    return out;
  };
  const fail = (text: string): CallToolResult => ({ content: [{ type: 'text', text: redactor.text(text) }], isError: true });
  /**
   * Append the run to .securealy/history.json under the server's working
   * directory (ids and numbers only, never evidence) and, when the user set
   * SECUREALY_TELEMETRY=1, send the aggregate payload without waiting for it.
   * The comparison with the previous grade of the same host joins the text.
   */
  const record = (r: GradeResult, command: RunCommand): string | undefined => {
    const rec = recordRun(r, command, { cwd: baseCwd, env, fetch: fetchImpl, telemetryEndpoint: opts.telemetryEndpoint, userAgent: USER_AGENT });
    void rec.telemetry;
    return rec.comparison;
  };
  const resultText = (r: GradeResult, command: RunCommand): string => {
    const comparison = record(r, command);
    return `${summarize(r)}${comparison ? `\n${comparison}` : ''}\n\nGradeResult JSON:\n${JSON.stringify(r)}`;
  };
  const errText = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

  const runLocalSet = async (checks: readonly string[], cwd: string, extraEnv: Record<string, string | undefined> = {}): Promise<GradeResult> => {
    const merged: Record<string, string> = {};
    for (const [k, v] of Object.entries({ ...env, ...extraEnv })) if (typeof v === 'string') merged[k] = v;
    return runLocal({ cwd, checks: [...checks], env: merged, fetch: fetchImpl, log });
  };

  const server = new McpServer(
    { name: 'securealy', version: VERSION, title: 'Securealy' },
    {
      instructions: [
        'Securealy grades a freshly launched web app the way an attacker and a customer would see it.',
        'Start with grade_url on the live or preview URL, then scan_repo on the source folder. Read blockers first.',
        'Use get_check or fetch_fix for the fix behind any failing check id. Local checks (scan_repo, check_rls, check_stripe, check_vercel_env) read the user\'s own environment and send nothing to Securealy.',
        'Every output is passed through a redactor; never ask the user to paste a secret into the conversation.',
        'Each run appends one entry (grade, score, counts, failing check ids; never evidence) to .securealy/history.json in the working directory, and grade_url reports the change since the previous grade of the same host. SECUREALY_NO_HISTORY=1 turns that off; SECUREALY_TELEMETRY=1 (off by default) sends an anonymous aggregate to securealy.com.',
      ].join(' '),
    },
  );

  server.registerTool(
    'grade_url',
    {
      title: 'Grade a URL',
      description:
        'Grade a website the way an attacker and a customer would see it, in under a minute. ' +
        'Passive tier (default) runs locally in this process and only does what a browser does when a visitor opens the site, plus DNS and TLS lookups: at most 25 requests, no probing, no credential use; it works on any public URL, including preview deployments. ' +
        'A URL on localhost, 127.0.0.1, [::1], *.localhost or *.test (plain http is fine) gives a pre-launch grade of the app running on this machine: the result carries preLaunch: true, checks that need a public domain (TLS, HSTS, DNS, email, domain, Stripe live key) are skipped with the reason, and the score covers the rest, so the same command on the deployed URL later gives the real grade. Any other private address is refused. ' +
        'Verified tier needs the project token (sly_...) for a domain whose ownership was already proven at securealy.com; it runs on the hosted grader and adds the probes an owner would want (served /.env or /.git, open admin routes, anon row reads, listable buckets, rate limiting). ' +
        'Returns a GradeResult (schema 1) and a text summary: grade A to F, score out of 100, blockers with evidence, then fails and warnings by category, each with its fix page. ' +
        'Pass bypassToken for a Vercel deployment that has protection enabled; it is sent only to that host. Evidence never contains a response body and secrets are redacted to six characters.',
      inputSchema: {
        url: z.string().min(1).describe('The URL to grade, for example https://my-app.vercel.app. A bare hostname is treated as https. http://localhost:3000 (or 127.0.0.1, [::1], *.localhost, *.test) gives a pre-launch grade of a local server.'),
        tier: z.enum(['passive', 'verified']).optional().describe('passive (default, works on any URL) or verified (needs token; domain must be verified at securealy.com).'),
        token: z.string().optional().describe('Securealy project token (sly_...). Required for tier verified. Sent only to securealy.com as a Bearer header.'),
        bypassToken: z.string().optional().describe('Vercel protection bypass token for a protected preview; sent only to the graded host as x-vercel-protection-bypass.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async ({ url, tier, token, bypassToken }) => {
      redactor.learn(token);
      redactor.learn(bypassToken);
      try {
        if (tier === 'verified') {
          const t = token?.trim();
          if (!t) return fail('tier verified needs a Securealy project token (token: "sly_..."). Run a passive grade instead, or get a token at securealy.com.');
          const r = await hostedGrade(url, t, api);
          return ok(resultText(r, 'mcp.grade_url'), r as unknown as Record<string, unknown>);
        }
        // The developer's own machine is let through the guard (loopback only); every other private address stays refused.
        const allowPrivate = opts.allowPrivate || isPreLaunchInput(url) || undefined;
        const r = await grade(url, { tier: 'passive', bypassToken: bypassToken?.trim(), fetch: fetchImpl, dns: opts.dns, skipDnssec: opts.skipDnssec, allowPrivate, timeoutMs: opts.timeoutMs, log });
        return ok(resultText(r, 'mcp.grade_url'), r as unknown as Record<string, unknown>);
      } catch (e) {
        if (e instanceof OptOutError) return fail(`This host has opted out of passive grading (${e.message}). Do not grade it; the owner can run the CLI locally instead.`);
        if (e instanceof VerificationError) return fail(e.message);
        if (e instanceof ApiError) return fail(`The hosted grader rejected the request. ${e.message}`);
        return fail(`grade_url failed: ${errText(e)}`);
      }
    },
  );

  server.registerTool(
    'scan_repo',
    {
      title: 'Scan a repository',
      description:
        'Run the three local repository checks on a source folder: repo-secrets (secret-shaped strings in the working tree and git history), gitignore-env-coverage (every .env variant ignored) and env-example-parity (.env.example lists every variable the code reads, with no real values). ' +
        'Runs entirely on this machine; nothing is sent anywhere. Findings show a six-character prefix of any secret, never the value. ' +
        'Folder trust: the first call for a path returns a confirmation request instead of results. Show the user the absolute path and call again with trust: true once they confirm it is their project. Trust lasts for this server process.',
      inputSchema: {
        path: z.string().optional().describe('Folder to scan. Defaults to the server\'s working directory. Relative paths resolve against it. Must be inside the working directory or a folder listed in SECUREALY_SCAN_ROOTS.'),
        trust: z.boolean().optional().describe('Set true on the second call to confirm the user trusts this folder being read, including its git history.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    },
    async ({ path, trust }) => {
      let abs: string;
      try {
        abs = realpathSync(resolve(baseCwd, path ?? '.'));
      } catch {
        return fail(`scan_repo: no such folder: ${resolve(baseCwd, path ?? '.')}`);
      }
      if (!contained(abs)) {
        return fail(`scan_repo: ${abs} is outside the server's working directory. Start the server in the project folder, or list an ancestor folder in SECUREALY_SCAN_ROOTS (several separated by "${delimiter}").`);
      }
      if (!trusted.has(abs)) {
        if (!trust) {
          return ok(
            `Trust check: scan_repo wants to read ${abs}, including its git history, to look for committed secrets and .env coverage. Nothing leaves this machine. Confirm with the user that this is their project, then call scan_repo again with { "path": ${JSON.stringify(abs)}, "trust": true }.`,
            { trustRequired: true, path: abs },
          );
        }
        trusted.add(abs);
      }
      try {
        const r = await runLocalSet(LOCAL_SETS.scan_repo, abs);
        return ok(resultText(r, 'mcp.scan_repo'), r as unknown as Record<string, unknown>);
      } catch (e) {
        return fail(`scan_repo failed: ${errText(e)}`);
      }
    },
  );

  server.registerTool(
    'check_rls',
    {
      title: 'Check Supabase RLS and auth config',
      description:
        'Run rls-policies and supabase-auth-config against the user\'s own Supabase project using credentials already in this server\'s environment: SUPABASE_URL plus SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY), or SUPABASE_MGMT_TOKEN plus SUPABASE_PROJECT_REF. ' +
        'rls-policies lists tables in the public schema with row level security off or with permissive policies; supabase-auth-config reads the auth settings (open signup, email confirmation, OTP expiry). ' +
        'Each value is trimmed, sent only to that Supabase project, and never appears in the output. The service key is sent only to an https URL on a Supabase-hosted domain (the project URL Supabase issued); any other SUPABASE_URL skips the check unless SECUREALY_SUPABASE_HOST_OVERRIDE=1 is set for a self-hosted project. If a variable is missing the check is skipped with a reason; tell the user which variable to export, never ask them to paste it into the chat.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async () => {
      try {
        const r = await runLocalSet(LOCAL_SETS.check_rls, baseCwd);
        return ok(resultText(r, 'mcp.check_rls'), r as unknown as Record<string, unknown>);
      } catch (e) {
        return fail(`check_rls failed: ${errText(e)}`);
      }
    },
  );

  server.registerTool(
    'check_stripe',
    {
      title: 'Check Stripe webhook wiring',
      description:
        'Run stripe-webhook-wiring with STRIPE_SECRET_KEY from this server\'s environment: confirms a live-mode key is in use, that at least one enabled webhook endpoint points at the production host, and that it subscribes to the checkout and subscription events. ' +
        'The key is trimmed, sent only to api.stripe.com, and never appears in the output. Provide productionHost so the endpoint host can be compared.',
      inputSchema: {
        productionHost: z.string().min(1).describe('The production hostname or URL the webhook should point at, for example my-app.example.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async ({ productionHost }) => {
      try {
        const r = await runLocalSet(LOCAL_SETS.check_stripe, baseCwd, { SECUREALY_PRODUCTION_URL: productionHost.trim() });
        return ok(resultText(r, 'mcp.check_stripe'), r as unknown as Record<string, unknown>);
      } catch (e) {
        return fail(`check_stripe failed: ${errText(e)}`);
      }
    },
  );

  server.registerTool(
    'check_vercel_env',
    {
      title: 'Check Vercel environment hygiene',
      description:
        'Run vercel-env-hygiene with VERCEL_TOKEN (a project-scoped token is enough) and VERCEL_PROJECT_ID from this server\'s environment, or the project id passed here. Reports secret-looking variables exposed to the browser through a NEXT_PUBLIC_ or VITE_ prefix, test keys in production, and production values missing from preview. ' +
        'The token is trimmed, sent only to api.vercel.com, and never appears in the output. Variable values are fetched only when SECUREALY_VERCEL_DECRYPT=1 is set in the environment; without it the checks that need values (trailing newlines, live keys outside production) are reported as skipped and only names and targets are read.',
      inputSchema: {
        projectId: z.string().optional().describe('Vercel project id (prj_...). Falls back to VERCEL_PROJECT_ID or .vercel/project.json in the working directory.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async ({ projectId }) => {
      try {
        const r = await runLocalSet(LOCAL_SETS.check_vercel_env, baseCwd, projectId ? { VERCEL_PROJECT_ID: projectId.trim() } : {});
        return ok(resultText(r, 'mcp.check_vercel_env'), r as unknown as Record<string, unknown>);
      } catch (e) {
        return fail(`check_vercel_env failed: ${errText(e)}`);
      }
    },
  );

  server.registerTool(
    'get_check',
    {
      title: 'Look up a check',
      description:
        'Return the catalogue entry for a check id (category, title, severity, tier, what passing means, why it matters, whether the fix is published free) plus the public fix page URL. Use it to explain a failing check to the user before fetching the fix. Local, no network.',
      inputSchema: { id: z.string().min(1).describe('A check id from a GradeResult, for example secrets-in-bundle.') },
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    },
    async ({ id }) => {
      const entry = catalogueEntry(id.trim());
      if (!entry) {
        const near = catalogue()
          .map((c) => c.id)
          .filter((c) => c.includes(id.trim().split('-')[0] ?? ''))
          .slice(0, 8);
        return fail(`No check with id "${id}".${near.length ? ` Similar ids: ${near.join(', ')}.` : ''} Call list_checks for the full catalogue.`);
      }
      const url = checkPage(entry.id);
      return ok(`${entry.id} [${entry.severity}, ${entry.category}, ${entry.tier} tier]\n${entry.title}\nPasses when: ${entry.what}\nWhy it matters: ${entry.why}\nFix: ${url}${entry.freeFix ? ' (free)' : ''}`, { check: entry, url });
    },
  );

  server.registerTool(
    'list_checks',
    {
      title: 'List the check catalogue',
      description: 'List every check Securealy runs, optionally filtered by category or tier, with severity and the one-line meaning of a pass. Local, no network.',
      inputSchema: {
        category: z.enum(CATEGORIES).optional().describe('Filter by category.'),
        tier: z.enum(TIERS).optional().describe('Filter by tier: passive, verified or local.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
    },
    async ({ category, tier }) => {
      const checks = catalogue().filter((c) => (!category || c.category === (category as Category)) && (!tier || c.tier === (tier as Tier)));
      const text = checks.map((c) => `${c.id} [${c.severity}, ${c.category}, ${c.tier}] ${c.title}: ${c.what}`).join('\n');
      return ok(`${checks.length} checks\n${text}`, { count: checks.length, checks });
    },
  );

  server.registerTool(
    'fetch_fix',
    {
      title: 'Fetch the fix for a check',
      description:
        'Fetch the published fix for a check id from securealy.com (GET /checks/<id>.json): the catalogue entry plus the fix text the caller is entitled to. Sends only the check id. If the fix endpoint is not available yet, returns the catalogue entry and the fix page URL to read instead.',
      inputSchema: { id: z.string().min(1).describe('A check id, for example hsts.') },
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async ({ id }) => {
      const entry = catalogueEntry(id.trim());
      if (!entry) return fail(`No check with id "${id}". Call list_checks for the full catalogue.`);
      const url = checkPage(entry.id);
      const fix = await fetchFix(entry.id, api);
      if (!fix.found) {
        return ok(
          `The fix JSON for ${entry.id} is not available from securealy.com right now (status ${fix.status || 'network error'}). Read the fix page instead: ${url}\n\n${entry.title}\nPasses when: ${entry.what}\nWhy it matters: ${entry.why}`,
          { check: entry, url, fixAvailable: false },
        );
      }
      const body = typeof fix.body === 'string' ? fix.body : JSON.stringify(fix.body, null, 2);
      return ok(`Fix for ${entry.id} (${url}):\n${body}`, { check: entry, url, fixAvailable: true, fix: fix.body });
    },
  );

  server.registerTool(
    'post_result',
    {
      title: 'Post a local result to Securealy',
      description:
        'Store a GradeResult from a local check (scan_repo, check_rls, check_stripe, check_vercel_env) against the user\'s Securealy project so it shows in their dashboard. Sends the result and the project token (as a Bearer header) to securealy.com and nothing else. Only call this when the user has asked for the result to be posted.',
      inputSchema: {
        result: z.object({ schema: z.literal(1), checks: z.array(z.unknown()) }).passthrough().describe('The GradeResult object returned by a local check tool.'),
        token: z.string().min(1).describe('Securealy project token (sly_...).'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    },
    async ({ result, token }) => {
      redactor.learn(token);
      try {
        const res = await postResult(result as unknown as GradeResult, token.trim(), api);
        if (res.status < 200 || res.status >= 300) return fail(`post_result: securealy.com answered ${res.status}: ${res.body}`);
        return ok(`Posted. securealy.com answered ${res.status}: ${res.body}`, { status: res.status, body: res.body });
      } catch (e) {
        return fail(`post_result failed: ${errText(e)}`);
      }
    },
  );

  server.registerResource(
    'checks',
    'securealy://checks',
    { title: 'Securealy check catalogue', description: 'Every check id with category, severity, tier, what passing means and why it matters.', mimeType: 'application/json' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(catalogue(), null, 2) }] }),
  );

  server.registerResource(
    'spec',
    'securealy://spec',
    { title: 'Securealy engine spec', description: 'Tiers, budgets, the GradeResult schema, scoring and the public API.', mimeType: 'text/markdown' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: readSpec() }] }),
  );

  return server;
}

export { VERSION, API_BASE };
