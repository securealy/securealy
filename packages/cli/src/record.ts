import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { redactText } from 'securealy-core';
import type { GradeResult, Summary } from 'securealy-core';
import { API_BASE } from './report.js';

/**
 * The learning record: a local history of every run so the next run can say
 * what changed, and an opt-in telemetry ping so the catalogue can be tuned
 * on aggregate pass/fail rates. Nothing in either carries evidence, a URL,
 * a hostname (telemetry), a token or an environment value.
 */

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string; dependencies: Record<string, string> };

/** Version of the engine these results came from: the securealy-core release this CLI pins. */
export const ENGINE_VERSION: string = pkg.dependencies['securealy-core'] ?? pkg.version;
export const CLI_VERSION: string = pkg.version;

export const TELEMETRY_ENDPOINT = `${API_BASE}/api/telemetry`;
export const HISTORY_DIR = '.securealy';
export const HISTORY_FILE = 'history.json';
export const HISTORY_CAP = 200;
export const TELEMETRY_TIMEOUT_MS = 3_000;

export type RunCommand =
  | 'grade'
  | 'local'
  | 'scan-repo'
  | 'check-rls'
  | 'check-stripe'
  | 'check-vercel-env'
  | 'mcp.grade_url'
  | 'mcp.scan_repo'
  | 'mcp.check_rls'
  | 'mcp.check_stripe'
  | 'mcp.check_vercel_env';

export interface HistoryEntry {
  at: string;
  command: RunCommand;
  tier: GradeResult['tier'];
  /** Only for a grade of a URL. */
  host?: string;
  grade: GradeResult['grade'];
  score: number;
  summary: Summary;
  id: string;
  /** Ids of the checks with status fail. */
  failed: string[];
  engineVersion: string;
}

export interface TelemetryPayload {
  command: RunCommand;
  tier: GradeResult['tier'];
  grade: GradeResult['grade'];
  score: number;
  durationMs: number;
  requests: number;
  counts: { pass: number; fail: number; warn: number; skip: number; error: number; blocker: number };
  engine: string;
  node: number;
  stack: { host: string | null; builder: string | null; db: string | null; payments: string | null; framework: string | null };
  failed: string[];
}

export interface RecordOptions {
  /** Folder that holds .securealy/. Defaults to process.cwd(). */
  cwd?: string;
  /** Environment to read SECUREALY_NO_HISTORY and SECUREALY_TELEMETRY from. Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** --no-history */
  noHistory?: boolean;
  /** Injectable for tests. Defaults to global fetch. */
  fetch?: typeof fetch;
  /** Injectable for tests. Defaults to TELEMETRY_ENDPOINT. */
  telemetryEndpoint?: string;
  userAgent?: string;
}

export interface RecordOutcome {
  /** The entry appended, or undefined when history is off or the folder is not writable. */
  entry?: HistoryEntry;
  /** The previous entry for the same host (URL grades only), when one existed. */
  previous?: HistoryEntry;
  /** One line comparing this run with the previous one, when there is one. */
  comparison?: string;
  /** Resolves when the telemetry request has finished or failed; already resolved when telemetry is off. */
  telemetry: Promise<void>;
}

const README = `# .securealy

Securealy writes one entry to \`history.json\` each time you grade a URL or run a local check
from this folder, through the CLI or the MCP server. An entry holds the time, the command, the
tier, the grade and score, the pass/fail/warn/skip/error counts, the ids of the failing checks,
the result id and the engine version. A grade of a URL also records the hostname that was graded.

An entry never holds evidence strings, tokens, environment values or anything from a response.
The file is safe to commit. The Securealy launch-check skill reads it before grading again so it
can report which checks improved or regressed since the last run; the CLI prints the same
comparison. The newest ${HISTORY_CAP} entries are kept.

To turn it off: \`--no-history\` on the CLI, or \`SECUREALY_NO_HISTORY=1\` in the environment.
`;

function flag(env: Record<string, string | undefined>, name: string): boolean {
  return (env[name] ?? '').trim() === '1';
}

function nodeMajor(): number {
  return Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10) || 0;
}

export function toEntry(r: GradeResult, command: RunCommand, now: Date = new Date()): HistoryEntry {
  const entry: HistoryEntry = {
    at: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    command,
    tier: r.tier,
    grade: r.grade,
    score: r.score,
    summary: { blocker: r.summary.blocker, fail: r.summary.fail, warn: r.summary.warn, pass: r.summary.pass, skip: r.summary.skip, error: r.summary.error },
    id: r.id,
    failed: r.checks.filter((c) => c.status === 'fail').map((c) => c.id),
    engineVersion: ENGINE_VERSION,
  };
  if (r.tier !== 'local') entry.host = r.host;
  return entry;
}

export function toTelemetry(r: GradeResult, command: RunCommand): TelemetryPayload {
  return {
    command,
    tier: r.tier,
    grade: r.grade,
    score: r.score,
    durationMs: r.durationMs,
    requests: r.requests,
    counts: { pass: r.summary.pass, fail: r.summary.fail, warn: r.summary.warn, skip: r.summary.skip, error: r.summary.error, blocker: r.summary.blocker },
    engine: ENGINE_VERSION,
    node: nodeMajor(),
    stack: { host: r.stack.host ?? null, builder: r.stack.builder ?? null, db: r.stack.db ?? null, payments: r.stack.payments ?? null, framework: r.stack.framework ?? null },
    failed: r.checks.filter((c) => c.status === 'fail').map((c) => c.id),
  };
}

/** Read the history file; a missing or unreadable file is an empty history. */
export function readHistory(cwd: string = process.cwd()): HistoryEntry[] {
  try {
    const raw = readFileSync(join(cwd, HISTORY_DIR, HISTORY_FILE), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]).filter((e) => e && typeof e === 'object' && typeof e.at === 'string') : [];
  } catch {
    return [];
  }
}

/** The most recent URL grade of the same host, if any. */
export function previousFor(history: HistoryEntry[], entry: HistoryEntry): HistoryEntry | undefined {
  if (!entry.host) return undefined;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h && h.host === entry.host && h.tier !== 'local') return h;
  }
  return undefined;
}

/** "Previous grade B 83 on 2026-10-12; 2 checks improved, 1 regressed: not-found-page" */
export function comparisonLine(previous: HistoryEntry, current: HistoryEntry): string {
  const before = new Set(previous.failed ?? []);
  const after = new Set(current.failed ?? []);
  const improved = [...before].filter((id) => !after.has(id));
  const regressed = [...after].filter((id) => !before.has(id));
  const date = previous.at.slice(0, 10);
  const head = `Previous grade ${previous.grade} ${previous.score} on ${date}`;
  if (!improved.length && !regressed.length) return `${head}; no checks changed`;
  const n = (k: number) => `${k} check${k === 1 ? '' : 's'}`;
  const tail = regressed.length ? `: ${regressed.join(', ')}` : '';
  return `${head}; ${n(improved.length)} improved, ${regressed.length} regressed${tail}`;
}

/**
 * Append an entry to .securealy/history.json under cwd, creating the folder
 * and its README on first use. Returns undefined when the folder cannot be
 * written; nothing is ever thrown from here.
 */
export function appendHistory(entry: HistoryEntry, cwd: string = process.cwd()): HistoryEntry[] | undefined {
  try {
    const dir = join(cwd, HISTORY_DIR);
    mkdirSync(dir, { recursive: true });
    const history = readHistory(cwd);
    history.push(entry);
    const kept = history.length > HISTORY_CAP ? history.slice(history.length - HISTORY_CAP) : history;
    // Belt and braces: the entry is built from ids and numbers only, and the
    // serialised form is still passed through the engine's secret redactor.
    writeFileSync(join(dir, HISTORY_FILE), redactText(JSON.stringify(kept, null, 2)) + '\n');
    const readme = join(dir, 'README.md');
    if (!existsSync(readme)) writeFileSync(readme, README);
    return kept;
  } catch {
    return undefined;
  }
}

/** POST the telemetry payload. Fire and forget: a 3 s timeout, and every failure is swallowed. */
export async function sendTelemetry(payload: TelemetryPayload, opts: RecordOptions = {}): Promise<void> {
  const f = opts.fetch ?? globalThis.fetch;
  const endpoint = opts.telemetryEndpoint ?? TELEMETRY_ENDPOINT;
  try {
    const res = await f(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': opts.userAgent ?? `securealy-cli/${CLI_VERSION}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TELEMETRY_TIMEOUT_MS),
    });
    await res.arrayBuffer().catch(() => undefined);
  } catch {
    /* silent by design */
  }
}

/**
 * Record one run: append it to the local history (unless disabled by
 * --no-history or SECUREALY_NO_HISTORY=1) and, only when SECUREALY_TELEMETRY=1,
 * send the aggregate payload. Never throws.
 */
export function recordRun(r: GradeResult, command: RunCommand, opts: RecordOptions = {}): RecordOutcome {
  const env = opts.env ?? (process.env as Record<string, string | undefined>);
  const cwd = opts.cwd ?? process.cwd();
  const out: RecordOutcome = { telemetry: Promise.resolve() };
  try {
    if (!opts.noHistory && !flag(env, 'SECUREALY_NO_HISTORY')) {
      const entry = toEntry(r, command);
      const previous = previousFor(readHistory(cwd), entry);
      if (appendHistory(entry, cwd)) {
        out.entry = entry;
        if (previous) {
          out.previous = previous;
          out.comparison = comparisonLine(previous, entry);
        }
      }
    }
    if (flag(env, 'SECUREALY_TELEMETRY')) out.telemetry = sendTelemetry(toTelemetry(r, command), opts);
  } catch {
    /* the record must never break a run */
  }
  return out;
}
