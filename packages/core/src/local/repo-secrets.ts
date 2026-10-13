import { result } from '../checks/context.js';
import { findSecrets } from '../redact.js';
import type { SecretFinding } from '../redact.js';
import type { LocalCheckModule } from './context.js';
import { isGitRepo } from './context.js';

const HISTORY_CAP = 200 * 1024 * 1024;
const SKIP_PATHS = /(^|\/)(node_modules|vendor|\.yarn)\/|package-lock\.json$|yarn\.lock$|pnpm-lock\.yaml$|\.min\.js$|(^|\/)fixtures?\//;

export const check: LocalCheckModule = {
  id: 'repo-secrets',
  async run(ctx) {
    if (!(await isGitRepo(ctx))) return result(this.id, 'skip', `${ctx.cwd} is not a git repository`);
    const findings: (SecretFinding & { commit: string })[] = [];
    const seen = new Set<string>();
    let commit = '';
    let file = '';
    let skippedFiles = 0;
    let lines = 0;
    const r = await ctx.stream(
      'git',
      ['log', '-p', '--all', '--no-color', '--no-ext-diff', '--format=commit %h'],
      (line) => {
        lines += 1;
        if (line.startsWith('commit ')) {
          commit = line.slice(7).trim();
          return;
        }
        if (line.startsWith('diff --git ')) {
          const m = / b\/(.+)$/.exec(line);
          file = m?.[1] ?? '';
          if (SKIP_PATHS.test(file)) skippedFiles += 1;
          return;
        }
        if (!line.startsWith('+') || line.startsWith('+++')) return;
        if (SKIP_PATHS.test(file)) return;
        const found = findSecrets(line.slice(1), file || '(unknown file)', 5);
        for (const f of found) {
          if (f.confidence !== 'high') continue;
          const key = `${f.kind}:${f.redacted}`;
          if (seen.has(key)) continue;
          seen.add(key);
          findings.push({ ...f, commit });
        }
        if (findings.length >= 50) return false;
      },
      HISTORY_CAP,
    );
    if (r.code === null) return result(this.id, 'error', 'could not run git log');
    const scanned = r.truncated ? ` (first 200 MB of history${skippedFiles ? `, ${skippedFiles} lockfile or fixture diffs skipped` : ''})` : '';
    if (findings.length) {
      const first = findings[0] as SecretFinding & { commit: string };
      const detail = findings
        .slice(0, 20)
        .map((f) => `${f.redacted} (${f.kind}) in ${f.location} at commit ${f.commit}`)
        .join('\n');
      return result(
        this.id,
        'fail',
        `${findings.length} secret-shaped string${findings.length === 1 ? '' : 's'} in history: ${first.redacted} (${first.kind}) in ${first.location} at ${first.commit}; rotate it, history is public once pushed${scanned}`,
        detail,
      );
    }
    return result(this.id, 'pass', `full history scanned (${Math.round(r.bytes / 1_000_000)} MB, ${lines} lines), no secret-shaped strings${scanned}`);
  },
};
