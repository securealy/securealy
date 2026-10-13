import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { result } from '../checks/context.js';
import { findSecrets } from '../redact.js';
import type { LocalCheckModule } from './context.js';

const SOURCE_EXT = /\.(c|m)?(j|t)sx?$|\.(vue|svelte|astro)$/;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.output', '.vercel', '.svelte-kit', 'coverage', '.turbo', 'out', '.cache', 'vendor']);
const EXAMPLE_FILES = ['.env.example', '.env.sample', '.env.template', '.env.example.local', 'example.env'];
const RUNTIME_VARS = new Set([
  'NODE_ENV', 'CI', 'PORT', 'HOST', 'HOSTNAME', 'HOME', 'PATH', 'PWD', 'SHELL', 'USER', 'TERM', 'TZ', 'DEBUG', 'LOG_LEVEL', 'NODE_OPTIONS',
  'VERCEL', 'VERCEL_ENV', 'VERCEL_URL', 'VERCEL_REGION', 'VERCEL_GIT_COMMIT_SHA', 'VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_BRANCH_URL',
  'NEXT_RUNTIME', 'NEXT_PHASE', 'ANALYZE', 'MODE', 'DEV', 'PROD', 'SSR', 'BASE_URL', 'VITEST', 'JEST_WORKER_ID', 'AWS_REGION', 'AWS_LAMBDA_FUNCTION_NAME',
  'NETLIFY', 'CONTEXT', 'DEPLOY_URL', 'URL', 'RAILWAY_ENVIRONMENT', 'RENDER', 'FLY_APP_NAME', 'GITHUB_ACTIONS', 'GITHUB_TOKEN', 'npm_package_version', 'npm_lifecycle_event',
]);
const MAX_FILES = 5000;
const MAX_FILE_BYTES = 1_000_000;

const READ_PATTERNS = [
  /process\.env\.([A-Z_][A-Z0-9_]*)/g,
  /process\.env\[\s*['"`]([A-Z_][A-Z0-9_]*)['"`]\s*\]/g,
  /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g,
  /Deno\.env\.get\(\s*['"`]([A-Z_][A-Z0-9_]*)['"`]\s*\)/g,
  /env\(\s*['"`]([A-Z_][A-Z0-9_]*)['"`]\s*\)/g,
];

async function walk(root: string, onFile: (path: string) => Promise<void>, budget: { files: number }): Promise<void> {
  const stack = [root];
  while (stack.length && budget.files < MAX_FILES) {
    const dir = stack.pop() as string;
    let entries: { name: string; isDirectory(): boolean; isFile(): boolean }[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) stack.push(join(dir, e.name));
      } else if (e.isFile() && SOURCE_EXT.test(e.name)) {
        budget.files += 1;
        await onFile(join(dir, e.name));
        if (budget.files >= MAX_FILES) return;
      }
    }
  }
}

export function parseEnvKeys(text: string): string[] {
  const keys: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/.exec(line);
    if (m?.[1]) keys.push(m[1]);
  }
  return keys;
}

export const check: LocalCheckModule = {
  id: 'env-example-parity',
  async run(ctx) {
    const used = new Map<string, string>();
    const budget = { files: 0 };
    await walk(ctx.cwd, async (path) => {
      let s;
      try {
        s = await stat(path);
      } catch {
        return;
      }
      if (s.size > MAX_FILE_BYTES) return;
      const text = await readFile(path, 'utf8').catch(() => '');
      for (const re of READ_PATTERNS) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          const name = m[1] as string;
          if (RUNTIME_VARS.has(name) || name.startsWith('npm_')) continue;
          if (!used.has(name)) used.set(name, relative(ctx.cwd, path));
        }
      }
    }, budget);
    let exampleFile: string | null = null;
    let exampleText = '';
    for (const f of EXAMPLE_FILES) {
      try {
        exampleText = await readFile(join(ctx.cwd, f), 'utf8');
        exampleFile = f;
        break;
      } catch {
        /* next */
      }
    }
    if (used.size === 0) return result(this.id, 'pass', `no environment variables read in ${budget.files} source files`);
    if (!exampleFile) return result(this.id, 'fail', `${used.size} variables read in code (${[...used.keys()].slice(0, 4).join(', ')}${used.size > 4 ? ', ...' : ''}) but no .env.example exists`);
    const real = findSecrets(exampleText, exampleFile).filter((f) => f.confidence === 'high');
    if (real.length) return result(this.id, 'fail', `${exampleFile} contains a real-looking secret (${real[0]?.redacted} ${real[0]?.kind}); examples hold placeholders only`);
    const keys = new Set(parseEnvKeys(exampleText));
    const missing = [...used.keys()].filter((k) => !keys.has(k)).sort();
    if (missing.length) {
      const detail = missing.map((k) => `${k} (first read in ${used.get(k)})`).join('\n');
      return result(this.id, 'fail', `${missing.length} of ${used.size} variables missing from ${exampleFile}: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', ...' : ''}`, detail);
    }
    return result(this.id, 'pass', `${used.size} variable${used.size === 1 ? '' : 's'} read in code, all listed in ${exampleFile}`);
  },
};
