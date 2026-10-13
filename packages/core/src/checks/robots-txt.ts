import type { CheckModule } from './context.js';
import { describe, needPage, result } from './context.js';

/** Groups of a robots.txt: consecutive User-agent lines share the rules that follow them, up to the next User-agent after a rule. */
export function parseRobots(body: string): { agents: string[]; allow: string[]; disallow: string[] }[] {
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  let current: { agents: string[]; allow: string[]; disallow: string[] } | null = null;
  let lastWasAgent = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const field = (m[1] ?? '').toLowerCase();
    const value = (m[2] ?? '').trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === 'disallow') current.disallow.push(value);
    else if (field === 'allow') current.allow.push(value);
  }
  return groups;
}

/** True when the rules that apply to every crawler disallow the whole site. */
export function blocksEveryone(body: string): boolean {
  const star = parseRobots(body).filter((g) => g.agents.includes('*'));
  if (star.length === 0) return false;
  return star.some((g) => g.disallow.some((d) => d === '/' ) && !g.allow.some((a) => a === '/'));
}

export const check: CheckModule = {
  id: 'robots-txt',
  run(ctx) {
    const gate = needPage(ctx, this.id, false);
    if (gate) return gate;
    const r = ctx.ev.robots;
    if (!r) return result(this.id, 'skip', '/robots.txt was not requested');
    if (r.status !== 200) return result(this.id, 'fail', `/robots.txt answers ${describe(r)}`);
    if (r.bodyHint === 'html') return result(this.id, 'fail', '/robots.txt answers 200 with HTML (soft 404); crawlers cannot parse it');
    const ct = (r.headers['content-type'] ?? '').toLowerCase();
    const body = r.body ?? '';
    const sitemap = /^sitemap:\s*\S+/im.test(body);
    if (blocksEveryone(body)) return result(this.id, 'fail', 'the User-agent: * group has Disallow: / with no Allow: /; the site cannot be indexed');
    if (!sitemap) return result(this.id, 'warn', `robots.txt is served${ct && !ct.includes('text/plain') ? ` as ${ct.split(';')[0]}` : ''} but names no Sitemap:`);
    if (ct && !ct.includes('text/plain')) return result(this.id, 'warn', `robots.txt names a sitemap but is served as ${ct.split(';')[0]}, not text/plain`);
    return result(this.id, 'pass', `200 text/plain, names a sitemap`);
  },
};
