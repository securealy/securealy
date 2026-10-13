import type { CheckModule } from './context.js';
import { needPage, result } from './context.js';
import { effectiveCsp } from './csp.js';

export function parseCsp(value: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of value.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    const name = tokens.shift()?.toLowerCase();
    if (name && !out.has(name)) out.set(name, tokens.map((t) => t.toLowerCase()));
  }
  return out;
}

export const check: CheckModule = {
  id: 'csp-strength',
  run(ctx) {
    const gate = needPage(ctx, this.id, false);
    if (gate) return gate;
    const csp = effectiveCsp(ctx);
    if (!csp) return result(this.id, 'skip', 'no CSP to judge (see csp)');
    const d = parseCsp(csp.value);
    const problems: string[] = [];
    if (!d.has('frame-ancestors')) problems.push('no frame-ancestors');
    if (!d.has('form-action')) problems.push('no form-action');
    const script = d.get('script-src') ?? d.get('default-src') ?? [];
    const wild = script.filter((s) => s === '*' || s === 'https:' || s === 'http:' || s === 'data:');
    if (wild.length) problems.push(`script-src allows ${wild.join(' ')}`);
    if (script.length === 0 && !d.has('script-src') && !d.has('default-src')) problems.push('no script-src or default-src');
    if (problems.length) return result(this.id, 'fail', problems.join('; '));
    const notes: string[] = [];
    if (script.includes("'unsafe-inline'") && !script.some((s) => s.startsWith("'nonce-") || s.startsWith("'sha"))) notes.push("script-src has 'unsafe-inline' without a nonce or hash");
    if (script.includes("'unsafe-eval'")) notes.push("script-src has 'unsafe-eval'");
    if (notes.length) return result(this.id, 'warn', `frame-ancestors and form-action set, no wildcard; ${notes.join('; ')}`);
    return result(this.id, 'pass', `frame-ancestors, form-action set; script-src: ${script.slice(0, 4).join(' ') || '(from default-src)'}`);
  },
};
