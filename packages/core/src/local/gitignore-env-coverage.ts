import { result } from '../checks/context.js';
import type { LocalCheckModule } from './context.js';
import { isGitRepo } from './context.js';

export const ENV_FAMILY = ['.env', '.env.local', '.env.production', '.env.local.bak', 'secrets.bak'];

export const check: LocalCheckModule = {
  id: 'gitignore-env-coverage',
  async run(ctx) {
    if (!(await isGitRepo(ctx))) return result(this.id, 'skip', `${ctx.cwd} is not a git repository`);
    const notIgnored: string[] = [];
    const tracked: string[] = [];
    for (const p of ENV_FAMILY) {
      const ig = await ctx.exec('git', ['check-ignore', '-q', '--no-index', p]);
      if (ig.code !== 0) notIgnored.push(p);
      const ls = await ctx.exec('git', ['ls-files', '--error-unmatch', p]);
      if (ls.code === 0) tracked.push(p);
    }
    if (tracked.length) return result(this.id, 'fail', `${tracked.join(', ')} ${tracked.length === 1 ? 'is' : 'are'} committed to the repository; remove, rotate every value in it, then ignore`);
    if (notIgnored.length) return result(this.id, 'fail', `not ignored: ${notIgnored.join(', ')}; add ".env*" and "*.bak*" to .gitignore`);
    const example = await ctx.exec('git', ['check-ignore', '-q', '--no-index', '.env.example']);
    if (example.code === 0) return result(this.id, 'warn', `${ENV_FAMILY.join(', ')} ignored, but .env.example is ignored too and should be committed (a rule like ".env*" needs "!.env.example")`);
    return result(this.id, 'pass', `${ENV_FAMILY.join(', ')} are all ignored`);
  },
};
