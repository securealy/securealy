import type { Evidence, HttpRecord } from '../evidence.js';
import { parsePage } from '../html.js';
import type { ParsedPage } from '../html.js';
import { catalogueEntry } from '../catalogue.js';
import { redactText } from '../redact.js';
import type { CheckResult, Severity, Status } from '../types.js';

/** What a check sees: the evidence plus the parsed page, built once. */
export interface CheckContext {
  ev: Evidence;
  page: ParsedPage | null;
  /** lower-cased header lookup on the final HTML response */
  header(name: string): string | null;
}

export interface CheckModule {
  id: string;
  run(ctx: CheckContext): CheckResult;
}

export function buildContext(ev: Evidence): CheckContext {
  const body = ev.page?.body;
  const isHtml = !!ev.page && (ev.page.bodyHint === 'html' || /text\/html/i.test(ev.page.headers['content-type'] ?? '') || (!!body && /<html|<!doctype/i.test(body.slice(0, 2000))));
  const page = body && isHtml ? parsePage(body) : null;
  return {
    ev,
    page,
    header(name: string) {
      const v = ev.page?.headers[name.toLowerCase()];
      return v === undefined ? null : v;
    },
  };
}

const EVIDENCE_CAP = 240;

/** Build a result; evidence is capped and passed through the redactor. */
export function result(id: string, status: Status, evidence: string, detail?: string): CheckResult {
  const entry = catalogueEntry(id);
  const severity: Severity = entry?.severity ?? 'info';
  const r: CheckResult = { id, status, severity, evidence: redactText(evidence).slice(0, EVIDENCE_CAP), fixSlug: id };
  if (detail) r.detail = redactText(detail).slice(0, 2000);
  return r;
}

/**
 * Shared gate for checks that need the home page. Returns a result to emit
 * when the page is unusable: skip when nothing answered, error when the site
 * answered with a status that is not a page we can judge (403, 5xx).
 */
export function needPage(ctx: CheckContext, id: string, needHtml = true): CheckResult | null {
  const p = ctx.ev.page;
  if (!p) return result(id, 'skip', `no response from ${ctx.ev.host}${ctx.ev.log.length ? ': ' + (ctx.ev.log.find((l) => l.startsWith('no response')) ?? '') : ''}`.trim());
  if (p.status >= 400) return result(id, 'error', `home page answered ${p.status}${challengeNote(p)}; cannot judge`);
  if (needHtml && !ctx.page) return result(id, 'error', `home page is not HTML (${p.headers['content-type'] ?? 'no content-type'})`);
  return null;
}

/**
 * Gate for a pre-launch grade: a check that can only be judged on the
 * deployed site skips with what it needs, never fails or errors.
 */
export function beforeDeploy(ctx: CheckContext, id: string, needs: string): CheckResult | null {
  if (!ctx.ev.preLaunch) return null;
  return result(id, 'skip', `not applicable before deploy: ${needs}`);
}

/** Names the bot challenge in front of the site when the response headers identify one. */
export function challengeNote(p: HttpRecord): string {
  const h = p.headers;
  if (h['x-vercel-mitigated'] || h['x-vercel-challenge-token']) return ' (Vercel bot challenge; grade with --bypass or allow the grader in Firewall settings)';
  if (h['cf-mitigated'] || /cloudflare/i.test(h['server'] ?? '') && (p.status === 403 || p.status === 429 || p.status === 503)) return ' (Cloudflare challenge; allow the grader in a WAF rule)';
  if (p.status === 403) return ' (bot blocking or protection)';
  if (p.status === 429) return ' (rate limited on the first request; a bot gate, not load)';
  return '';
}

export function describe(rec: HttpRecord | null | undefined): string {
  if (!rec) return 'not requested';
  if (rec.error && rec.status === 0) return rec.error;
  return `${rec.status}`;
}

export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

export function kb(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.round(bytes / 1000)} KB`;
}
