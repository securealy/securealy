import type { CheckContext } from './context.js';
import { result } from './context.js';
import type { CheckResult } from '../types.js';

export function spfRecords(ctx: CheckContext): string[] {
  return ctx.ev.dns.txt.filter((t) => /^v=spf1\b/i.test(t.trim()));
}

export function dmarcRecord(ctx: CheckContext): string | null {
  return ctx.ev.dns.dmarc.find((t) => /^v=DMARC1\b/i.test(t.trim())) ?? null;
}

export function dkimSelectors(ctx: CheckContext): string[] {
  return Object.entries(ctx.ev.dns.dkim)
    .filter(([, v]) => v !== null)
    .map(([k]) => k);
}

/** Platform subdomains (my-app.vercel.app) do not carry mail of their own. */
export function noMailExpected(ctx: CheckContext, id: string): CheckResult | null {
  if (ctx.ev.platformSuffix && ctx.ev.dns.mx.length === 0 && spfRecords(ctx).length === 0) {
    return result(id, 'skip', `platform subdomain under ${ctx.ev.platformSuffix}; no mail expected from it`);
  }
  const d = ctx.ev.dns;
  const unresolved = d.ns.length === 0 && d.a.apex.length === 0 && d.aaaa.apex.length === 0 && d.mx.length === 0 && d.txt.length === 0 && d.a.host.length === 0;
  if (unresolved) {
    return result(id, 'skip', `${ctx.ev.apex} does not resolve${d.errors['txt'] ? ` (${d.errors['txt']})` : ''}; no DNS to judge`);
  }
  return null;
}
