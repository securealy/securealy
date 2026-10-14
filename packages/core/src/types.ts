/**
 * Public types for the Securealy engine. These mirror SPEC.md and are the
 * contract for the GradeResult JSON that the CLI, the GitHub Action and the
 * hosted API all produce and consume.
 */

export type Category =
  | 'security'
  | 'email'
  | 'domain'
  | 'seo'
  | 'hygiene'
  | 'payments'
  | 'analytics'
  | 'performance';

export type Severity = 'blocker' | 'high' | 'medium' | 'low' | 'info';
export type Tier = 'passive' | 'verified' | 'local';
export type Status = 'pass' | 'fail' | 'warn' | 'skip' | 'error';
export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

/** One catalogue entry from packages/checks/checks.json. */
export interface Check {
  id: string;
  category: Category;
  title: string;
  severity: Severity;
  tier: Tier;
  what: string;
  why: string;
  module: string;
  freeFix: boolean;
}

/** The outcome of one check against gathered evidence. */
export interface CheckResult {
  id: string;
  status: Status;
  severity: Severity;
  /** Short, human readable, never a response body, secrets always redacted. */
  evidence: string;
  /** Optional longer text. */
  detail?: string;
  /** Slug of the Fix Kit entry, equal to the check id. */
  fixSlug?: string;
}

export interface Stack {
  host?: string;
  dns?: string;
  builder?: string;
  db?: string;
  payments?: string;
  analytics?: string[];
  emailProvider?: string;
  framework?: string;
}

export interface Summary {
  blocker: number;
  fail: number;
  warn: number;
  pass: number;
  skip: number;
  error: number;
}

export interface ScoreResult {
  grade: Grade;
  score: number;
  capped?: string;
  summary: Summary;
}

export interface GradeResult {
  schema: 1;
  id: string;
  input: string;
  finalUrl: string;
  host: string;
  gradedAt: string;
  tier: Tier;
  grade: Grade;
  score: number;
  capped?: string;
  summary: Summary;
  stack: Stack;
  checks: CheckResult[];
  requests: number;
  durationMs: number;
}

/** A minimal DNS resolver interface so tests can inject a fake. */
export interface Resolver {
  resolveNs(host: string): Promise<string[]>;
  resolve4(host: string): Promise<string[]>;
  resolve6(host: string): Promise<string[]>;
  resolveMx(host: string): Promise<{ exchange: string; priority: number }[]>;
  resolveTxt(host: string): Promise<string[][]>;
  resolveCname(host: string): Promise<string[]>;
  resolveCaa?(host: string): Promise<{ critical: number; issue?: string; issuewild?: string; iodef?: string }[]>;
}

export interface GradeOptions {
  tier?: 'passive' | 'verified';
  verifyToken?: string;
  bypassToken?: string;
  timeoutMs?: number;
  maxRequests?: number;
  fetch?: typeof fetch;
  dns?: Resolver;
  log?: (line: string) => void;
  /** Skip the DNSSEC raw UDP query (tests, restricted networks). */
  skipDnssec?: boolean;
  /** Test hook: resolve a hostname for the request-forgery guard. Defaults to dns.lookup with every address. */
  lookup?: (hostname: string) => Promise<{ address: string; family: number }[]>;
  /**
   * Tests only. The engine refuses to fetch loopback, link-local, private,
   * CGNAT, unique-local, multicast and reserved addresses, and the names that
   * mean them, on the input, every redirect and every URL found in a page.
   * This switches that refusal off for a fixture server on 127.0.0.1.
   */
  allowPrivate?: boolean;
}

export interface LocalOptions {
  cwd: string;
  checks?: string[];
  env?: Record<string, string>;
  fetch?: typeof fetch;
  log?: (line: string) => void;
}
