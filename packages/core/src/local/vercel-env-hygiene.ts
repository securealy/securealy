import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { result } from '../checks/context.js';
import { findSecrets, secretLikeName } from '../redact.js';
import type { LocalCheckModule } from './context.js';

interface EnvItem {
  key: string;
  value?: string;
  type?: string;
  target?: string[] | string;
  gitBranch?: string;
}

const PUBLIC_PREFIX = /^(NEXT_PUBLIC_|VITE_|PUBLIC_|REACT_APP_|EXPO_PUBLIC_|NUXT_PUBLIC_|GATSBY_)/;

async function projectFromDisk(cwd: string): Promise<{ projectId?: string; orgId?: string }> {
  try {
    const raw = await readFile(join(cwd, '.vercel', 'project.json'), 'utf8');
    const j = JSON.parse(raw) as { projectId?: string; orgId?: string };
    return { projectId: j.projectId, orgId: j.orgId };
  } catch {
    return {};
  }
}

export const check: LocalCheckModule = {
  id: 'vercel-env-hygiene',
  async run(ctx) {
    const token = ctx.env('VERCEL_TOKEN');
    if (!token) return result(this.id, 'skip', 'VERCEL_TOKEN not set');
    const disk = await projectFromDisk(ctx.cwd);
    const projectId = ctx.env('VERCEL_PROJECT_ID') ?? disk.projectId;
    const teamId = ctx.envAny('VERCEL_TEAM_ID', 'VERCEL_ORG_ID') ?? disk.orgId;
    if (!projectId) return result(this.id, 'skip', 'no project id: set VERCEL_PROJECT_ID or link the directory with the Vercel CLI');
    const team = teamId && teamId.startsWith('team_') ? `&teamId=${encodeURIComponent(teamId)}` : '';
    const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
    const url = (decrypt: boolean) => `https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}/env?decrypt=${decrypt}${team}`;
    // Decrypted values are only requested when the owner opts in; the name and
    // target checks need no values, and a listing with values is a listing of secrets.
    const decryptWanted = ctx.env('SECUREALY_VERCEL_DECRYPT') === '1';
    let res: Response;
    let decrypted = decryptWanted;
    try {
      res = await ctx.fetch(url(decryptWanted), { headers });
      if (decryptWanted && res.status === 403) {
        decrypted = false;
        res = await ctx.fetch(url(false), { headers });
      }
    } catch (e) {
      return result(this.id, 'error', `Vercel API unreachable: ${(e as Error).message}`.slice(0, 160));
    }
    if (res.status === 401 || res.status === 403) return result(this.id, 'error', `Vercel rejected the token (${res.status}); it needs read access to this project`);
    if (res.status === 404) return result(this.id, 'error', `project ${projectId} not found${team ? ' in that team' : ''}`);
    if (!res.ok) return result(this.id, 'error', `Vercel API answered ${res.status}`);
    const body = (await res.json()) as { envs?: EnvItem[] };
    const envs = body.envs ?? [];
    if (envs.length === 0) return result(this.id, 'pass', 'no environment variables on the project');
    const fails: string[] = [];
    const warns: string[] = [];
    let newlineChecked = 0;
    for (const e of envs) {
      const targets = Array.isArray(e.target) ? e.target : e.target ? [e.target] : [];
      const value = decrypted && typeof e.value === 'string' && e.type !== 'sensitive' ? e.value : null;
      if (PUBLIC_PREFIX.test(e.key)) {
        const byName = secretLikeName(e.key);
        const byValue = value ? findSecrets(value, e.key).some((f) => f.confidence === 'high') : false;
        if (byName || byValue) fails.push(`${e.key} is public (bundled into the client) but holds a secret${byValue ? ' value' : '-looking name'}`);
      }
      if (value !== null) {
        newlineChecked += 1;
        if (/[\r\n]$/.test(value)) fails.push(`${e.key} ends in a newline (set it with printf, not echo)`);
        if (/^(sk|rk)_live_/.test(value) && targets.some((t) => t === 'preview' || t === 'development')) warns.push(`${e.key} is a live key but is scoped to ${targets.filter((t) => t !== 'production').join(' and ')}`);
      }
      if (targets.length === 0) warns.push(`${e.key} has no target environment`);
    }
    const prodOnly = envs.filter((e) => Array.isArray(e.target) && e.target.includes('production') && !e.target.includes('preview')).length;
    const valueNote = decrypted
      ? `${newlineChecked} values checked for trailing newlines and live keys outside production`
      : decryptWanted
        ? 'values not readable with this token; trailing-newline and live-key checks skipped'
        : 'values not fetched; trailing-newline and live-key checks skipped (set SECUREALY_VERCEL_DECRYPT=1 to run them)';
    const notes = [`${envs.length} variables`, valueNote, prodOnly ? `${prodOnly} production-only` : null].filter(Boolean);
    if (fails.length) return result(this.id, 'fail', `${fails.slice(0, 3).join('; ')}${fails.length > 3 ? `; ${fails.length - 3} more` : ''}`, [...fails, ...warns].join('\n'));
    if (warns.length) return result(this.id, 'warn', `${warns.slice(0, 3).join('; ')}; ${notes.join(', ')}`);
    return result(this.id, 'pass', notes.join(', '));
  },
};
