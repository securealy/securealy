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

/** RFC 7505: a single MX of "." says the domain receives no mail. */
export function hasNullMx(ctx: CheckContext): boolean {
  const mx = ctx.ev.dns.mx;
  return mx.length === 1 && (mx[0]?.exchange === '' || mx[0]?.exchange === '.');
}

/** An SPF of exactly "v=spf1 -all" says the domain sends no mail. */
export function declaresNoSending(ctx: CheckContext): boolean {
  const spf = spfRecords(ctx);
  return spf.length === 1 && /^v=spf1\s+-all\s*$/i.test(spf[0] ?? '');
}

/** The SPF record names a provider whose DKIM selectors are fixed and were queried, so a miss on all of them is conclusive. */
export function knownSelectorProvider(ctx: CheckContext): string | null {
  const spf = spfRecords(ctx)[0] ?? '';
  if (/_spf\.google\.com/i.test(spf)) return 'Google Workspace (selector google)';
  if (/\bresend\b/i.test(spf)) return 'Resend (selector resend)';
  if (/protection\.outlook\.com/i.test(spf)) return 'Microsoft 365 (selector1, selector2)';
  if (/sendgrid\.net/i.test(spf)) return 'SendGrid (s1, s2)';
  if (/servers\.mcsv\.net/i.test(spf)) return 'Mailchimp (k1, k2, k3)';
  if (/mandrillapp\.com/i.test(spf)) return 'Mandrill (selector mandrill)';
  if (/\bzoho\b/i.test(spf)) return 'Zoho (selector zoho)';
  if (/messagingengine\.com/i.test(spf)) return 'Fastmail (fm1, fm2)';
  if (/protonmail\.ch/i.test(spf)) return 'Proton (selector protonmail)';
  return null;
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

/** Sending-side checks (DKIM, sender authentication) do not apply to a domain that declares it sends no mail. */
export function noSendingExpected(ctx: CheckContext, id: string): CheckResult | null {
  if (declaresNoSending(ctx) && (ctx.ev.dns.mx.length === 0 || hasNullMx(ctx))) {
    return result(id, 'skip', `${ctx.ev.apex} publishes "v=spf1 -all"${hasNullMx(ctx) ? ' and a null MX' : ' and no MX'}: it declares it sends no mail, so there is no sender to authenticate`);
  }
  return null;
}
