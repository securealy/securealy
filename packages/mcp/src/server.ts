import { readFileSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { grade, runLocal, catalogue, catalogueEntry, OptOutError, VerificationError } from 'securealy-core';
import type { Category, GradeResult, Resolver, Tier } from 'securealy-core';
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
  timeoutMs?: number;
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
  /** Diagnostic lines. Never stdout: stdio is the protocol channel. */
  log?: (line: string) => void;
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
  return 'SPEC.md is not bundled with this build. Read it at https://github.com/kennyhyder/securealy/blob/main/SPEC.md';
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

  const ok = (text: string, structured?: Record<string, unknown>): CallToolResult => {
    const out: CallToolResult = { content: [{ type: 'text', text: redactor.text(text) }] };
    if (structured) out.structuredContent = redactor.value(structured);
    return out;
  };
  const fail = (text: string): CallToolResult => ({ content: [{ type: 'text', text: redactor.text(text) }], isError: true });
  const resultText = (r: GradeResult): string => `${summarize(r)}\n\nGradeResult JSON:\n${JSON.stringify(r)}`;
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
        'Verified tier needs the project token (sly_...) for a domain whose ownership was already proven at securealy.com; it runs on the hosted grader and adds the probes an owner would want (served /.env or /.git, open admin routes, anon row reads, listable buckets, rate limiting). ' +
        'Returns a GradeResult (schema 1) and a text summary: grade A to F, score out of 100, blockers with evidence, then fails and warnings by category, each with its fix page. ' +
        'Pass bypassToken for a Vercel deployment that has protection enabled; it is sent only to that host. Evidence never contains a response body and secrets are redacted to six characters.',
      inputSchema: {
        url: z.string().min(1).describe('The URL to grade, for example https://my-app.vercel.app. A bare hostname is treated as https.'),
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
          return ok(resultText(r), r as unknown as Record<string, unknown>);
        }
        const r = await grade(url, { tier: 'passive', bypassToken: bypassToken?.trim(), fetch: fetchImpl, dns: opts.dns, skipDnssec: opts.skipDnssec, timeoutMs: opts.timeoutMs, log });
        return ok(resultText(r), r as unknown as Record<string, unknown>);
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
        path: z.string().optional().describe('Folder to scan. Defaults to the server\'s working directory. Relative paths resolve against it.'),
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
        return ok(resultText(r), r as unknown as Record<string, unknown>);
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
        'Each value is trimmed, sent only to that Supabase project, and never appears in the output. If a variable is missing the check is skipped with a reason; tell the user which variable to export, never ask them to paste it into the chat.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async () => {
      try {
        const r = await runLocalSet(LOCAL_SETS.check_rls, baseCwd);
        return ok(resultText(r), r as unknown as Record<string, unknown>);
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
        productionHost: z.string().min(1).describe('The production hostname or URL the webhook should point at, for example my-app.com.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async ({ productionHost }) => {
      try {
        const r = await runLocalSet(LOCAL_SETS.check_stripe, baseCwd, { SECUREALY_PRODUCTION_URL: productionHost.trim() });
        return ok(resultText(r), r as unknown as Record<string, unknown>);
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
        'The token is trimmed, sent only to api.vercel.com, and never appears in the output.',
      inputSchema: {
        projectId: z.string().optional().describe('Vercel project id (prj_...). Falls back to VERCEL_PROJECT_ID or .vercel/project.json in the working directory.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async ({ projectId }) => {
      try {
        const r = await runLocalSet(LOCAL_SETS.check_vercel_env, baseCwd, projectId ? { VERCEL_PROJECT_ID: projectId.trim() } : {});
        return ok(resultText(r), r as unknown as Record<string, unknown>);
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
