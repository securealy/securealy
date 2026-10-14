import { execFile, spawn } from 'node:child_process';
import type { CheckResult } from '../types.js';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * What a local check sees. Env reads are trimmed at the source and never
 * echoed; the fetch is injectable so tests never touch the network.
 */
export interface LocalContext {
  cwd: string;
  /** trimmed value or undefined */
  env(name: string): string | undefined;
  /** first defined among several names */
  envAny(...names: string[]): string | undefined;
  fetch: typeof fetch;
  log(line: string): void;
  exec(cmd: string, args: string[], opts?: { maxBuffer?: number }): Promise<ExecResult>;
  /**
   * Stream a command's stdout line by line. The callback returns false to stop
   * early (the process is killed). Resolves with the number of bytes seen.
   */
  stream(cmd: string, args: string[], onLine: (line: string) => boolean | void, maxBytes: number): Promise<{ bytes: number; truncated: boolean; code: number | null }>;
  /** counts outbound HTTP calls for the result's `requests` */
  requests: { count: number };
}

/**
 * Every git invocation gets these in front of its own arguments: a scanned
 * repository can set core.fsmonitor or core.hooksPath to a script in its own
 * .git/config, and a read-only scan must never execute code from the target.
 */
export const GIT_SAFETY_ARGS = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null'] as const;
const GIT_ENV = { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } as const;

function guardedArgs(cmd: string, args: string[]): string[] {
  return cmd === 'git' ? [...GIT_SAFETY_ARGS, ...args] : args;
}

export interface LocalCheckModule {
  id: string;
  run(ctx: LocalContext): Promise<CheckResult>;
}

export function createLocalContext(cwd: string, env: Record<string, string | undefined>, fetchImpl: typeof fetch, log: (line: string) => void): LocalContext {
  const requests = { count: 0 };
  const countingFetch: typeof fetch = async (input, init) => {
    requests.count += 1;
    return fetchImpl(input, init);
  };
  const read = (name: string) => {
    const v = env[name];
    if (v === undefined || v === null) return undefined;
    const t = String(v).trim();
    return t === '' ? undefined : t;
  };
  return {
    cwd,
    env: read,
    envAny: (...names) => {
      for (const n of names) {
        const v = read(n);
        if (v !== undefined) return v;
      }
      return undefined;
    },
    fetch: countingFetch,
    log,
    requests,
    exec(cmd, args, opts = {}) {
      return new Promise((resolve) => {
        execFile(cmd, guardedArgs(cmd, args), { cwd, maxBuffer: opts.maxBuffer ?? 8_000_000, env: { ...process.env, ...GIT_ENV } }, (err, stdout, stderr) => {
          const code = err && typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : err ? 1 : 0;
          resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
        });
      });
    },
    stream(cmd, args, onLine, maxBytes) {
      return new Promise((resolve) => {
        const child = spawn(cmd, guardedArgs(cmd, args), { cwd, env: { ...process.env, ...GIT_ENV }, stdio: ['ignore', 'pipe', 'ignore'] });
        let bytes = 0;
        let truncated = false;
        let rest = '';
        let stopped = false;
        const stop = () => {
          if (stopped) return;
          stopped = true;
          try {
            child.kill('SIGTERM');
          } catch {
            /* ignore */
          }
        };
        child.stdout.on('data', (chunk: Buffer) => {
          if (stopped) return;
          bytes += chunk.length;
          const text = rest + chunk.toString('utf8');
          const lines = text.split('\n');
          rest = lines.pop() ?? '';
          for (const line of lines) {
            if (onLine(line) === false) {
              stop();
              return;
            }
          }
          if (bytes >= maxBytes) {
            truncated = true;
            stop();
          }
        });
        child.on('error', () => resolve({ bytes, truncated, code: null }));
        child.on('close', (code) => {
          if (rest && !stopped) onLine(rest);
          resolve({ bytes, truncated, code });
        });
      });
    },
  };
}

export function isGitRepo(ctx: LocalContext): Promise<boolean> {
  return ctx.exec('git', ['rev-parse', '--is-inside-work-tree']).then((r) => r.code === 0 && r.stdout.trim() === 'true');
}

export function supabaseRefFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const m = /^https?:\/\/([a-z0-9-]+)\.supabase\.(?:co|in|red)/i.exec(url.trim());
  return m?.[1] ?? null;
}

const SUPABASE_HOSTED = /\.supabase\.(?:co|in|red)$/i;

/**
 * Why a key must not be sent to this SUPABASE_URL, or null when it may be:
 * only an https URL on a Supabase-hosted domain qualifies, unless the owner
 * sets SECUREALY_SUPABASE_HOST_OVERRIDE=1 for a self-hosted project.
 */
export function supabaseUrlProblem(url: string, ctx: LocalContext): string | null {
  if (ctx.env('SECUREALY_SUPABASE_HOST_OVERRIDE') === '1') return null;
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return 'SUPABASE_URL is not a URL';
  }
  if (u.protocol !== 'https:') return `SUPABASE_URL is ${u.protocol.replace(/:$/, '')}, not https`;
  if (!SUPABASE_HOSTED.test(u.hostname)) return `SUPABASE_URL host ${u.hostname} is not a Supabase-hosted project`;
  return null;
}

export function hostFromUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const v = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    return new URL(v).hostname.toLowerCase();
  } catch {
    return null;
  }
}
