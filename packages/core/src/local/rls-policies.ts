import { result } from '../checks/context.js';
import type { LocalCheckModule, LocalContext } from './context.js';
import { supabaseRefFromUrl, supabaseUrlProblem } from './context.js';
import type { CheckResult } from '../types.js';

interface TableRow {
  table: string;
  rls: boolean;
}
interface PolicyRow {
  tablename: string;
  policyname: string;
  roles: string | string[];
  cmd: string;
  permissive: string;
  qual: string | null;
  with_check: string | null;
}

const TABLES_SQL =
  "select c.relname as table, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p') order by 1";
const POLICIES_SQL = "select tablename, policyname, roles::text as roles, cmd, permissive, qual, with_check from pg_policies where schemaname = 'public' order by 1, 2";

function rolesOf(r: PolicyRow): string[] {
  const raw = Array.isArray(r.roles) ? r.roles.join(',') : String(r.roles ?? '');
  return raw.replace(/[{}"]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
}

function isTrue(expr: string | null): boolean {
  return expr !== null && /^\(?\s*true\s*\)?$/i.test(expr.trim());
}

async function viaManagement(ctx: LocalContext, id: string, token: string, ref: string): Promise<CheckResult> {
  const query = async (sql: string): Promise<unknown[] | { error: string }> => {
    let res: Response;
    try {
      res = await ctx.fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/database/query`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ query: sql }),
      });
    } catch (e) {
      return { error: `management API unreachable: ${(e as Error).message}` };
    }
    if (!res.ok) return { error: `management API answered ${res.status}` };
    const body = (await res.json()) as unknown;
    return Array.isArray(body) ? body : { error: 'unexpected query response' };
  };
  const tables = await query(TABLES_SQL);
  if (!Array.isArray(tables)) return result(id, 'error', tables.error);
  const policies = await query(POLICIES_SQL);
  if (!Array.isArray(policies)) return result(id, 'error', policies.error);
  const t = tables as TableRow[];
  const p = policies as PolicyRow[];
  if (t.length === 0) return result(id, 'pass', 'no tables in the public schema');
  const off = t.filter((x) => !x.rls).map((x) => x.table);
  const open = p
    .filter((x) => {
      const roles = rolesOf(x);
      const anon = roles.includes('anon') || roles.includes('public');
      const read = /^(SELECT|ALL|\*)$/i.test(x.cmd ?? '');
      return anon && read && (x.permissive ?? 'PERMISSIVE').toUpperCase() === 'PERMISSIVE' && (isTrue(x.qual) || x.qual === null);
    })
    .map((x) => `${x.tablename}.${x.policyname}`);
  const openWrites = p
    .filter((x) => {
      const roles = rolesOf(x);
      const anon = roles.includes('anon') || roles.includes('public');
      return anon && /^(INSERT|UPDATE|DELETE)$/i.test(x.cmd ?? '') && (isTrue(x.with_check) || isTrue(x.qual));
    })
    .map((x) => `${x.tablename}.${x.policyname} (${x.cmd})`);
  const fails: string[] = [];
  if (off.length) fails.push(`RLS off on ${off.length} table${off.length === 1 ? '' : 's'}: ${off.slice(0, 5).join(', ')}${off.length > 5 ? ', ...' : ''}`);
  if (open.length) fails.push(`USING (true) for anon on ${open.slice(0, 4).join(', ')}${open.length > 4 ? ', ...' : ''}`);
  if (fails.length) return result(id, 'fail', fails.join('; '), [...off.map((o) => `rls off: ${o}`), ...open.map((o) => `anon read: ${o}`), ...openWrites.map((o) => `anon write: ${o}`)].join('\n'));
  if (openWrites.length) return result(id, 'warn', `RLS on everywhere, but anon can write without a condition: ${openWrites.slice(0, 3).join(', ')}`);
  const noPolicy = t.filter((x) => !p.some((y) => y.tablename === x.table)).length;
  return result(id, 'pass', `${t.length} table${t.length === 1 ? '' : 's'} with RLS on, ${p.length} polic${p.length === 1 ? 'y' : 'ies'}, none USING (true) for anon${noPolicy ? `, ${noPolicy} locked with no policy` : ''}`);
}

async function viaServiceKey(ctx: LocalContext, id: string, url: string, serviceKey: string, anonKey: string | undefined): Promise<CheckResult> {
  const base = url.replace(/\/+$/, '');
  let res: Response;
  try {
    res = await ctx.fetch(`${base}/rest/v1/`, { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, accept: 'application/openapi+json, application/json' } });
  } catch (e) {
    return result(id, 'error', `REST root unreachable: ${(e as Error).message}`.slice(0, 160));
  }
  if (!res.ok) return result(id, 'error', `REST root answered ${res.status} to the service key`);
  const doc = (await res.json()) as { definitions?: Record<string, unknown> };
  const tables = Object.keys(doc.definitions ?? {}).sort();
  if (tables.length === 0) return result(id, 'pass', 'no tables exposed through the REST API');
  if (!anonKey) return result(id, 'warn', `${tables.length} table${tables.length === 1 ? '' : 's'} exposed; set SUPABASE_ANON_KEY (or SUPABASE_MGMT_TOKEN) to test what anonymous callers can read`);
  const leaking: string[] = [];
  for (const table of tables.slice(0, 50)) {
    let r: Response;
    try {
      r = await ctx.fetch(`${base}/rest/v1/${encodeURIComponent(table)}?select=*&limit=1`, { headers: { apikey: anonKey, authorization: `Bearer ${anonKey}`, prefer: 'count=exact', accept: 'application/json' } });
    } catch {
      continue;
    }
    const range = r.headers.get('content-range') ?? '';
    const total = /\/(\d+)$/.exec(range)?.[1];
    try {
      await r.body?.cancel();
    } catch {
      /* ignore */
    }
    if (r.status === 200 && total !== undefined && Number(total) > 0) leaking.push(`${table} (${total} rows)`);
  }
  if (leaking.length) return result(id, 'fail', `anon key reads rows from ${leaking.length} of ${tables.length} tables: ${leaking.slice(0, 4).join(', ')}; RLS is off or a policy is USING (true)`);
  return result(id, 'pass', `${tables.length} table${tables.length === 1 ? '' : 's'} return zero rows to the anon key (policies not inspected; set SUPABASE_MGMT_TOKEN to read them)`);
}

export const check: LocalCheckModule = {
  id: 'rls-policies',
  async run(ctx) {
    const mgmt = ctx.envAny('SUPABASE_MGMT_TOKEN', 'SUPABASE_ACCESS_TOKEN');
    const url = ctx.envAny('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'VITE_SUPABASE_URL', 'PUBLIC_SUPABASE_URL');
    const ref = ctx.env('SUPABASE_PROJECT_REF') ?? supabaseRefFromUrl(url);
    const service = ctx.envAny('SUPABASE_SERVICE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY');
    const anon = ctx.envAny('SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY', 'PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY');
    if (mgmt && ref) return viaManagement(ctx, this.id, mgmt, ref);
    if (url && service) {
      const problem = supabaseUrlProblem(url, ctx);
      if (problem) return result(this.id, 'skip', `${problem}; the service key was not sent (set SECUREALY_SUPABASE_HOST_OVERRIDE=1 for a self-hosted project)`);
      return viaServiceKey(ctx, this.id, url, service, anon);
    }
    return result(this.id, 'skip', 'set SUPABASE_MGMT_TOKEN plus SUPABASE_PROJECT_REF (or SUPABASE_URL), or SUPABASE_URL plus SUPABASE_SERVICE_KEY');
  },
};
