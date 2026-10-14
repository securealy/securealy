import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * The distribution layer has several files that must agree with each other
 * and with the package version. A release that forgets one of them ships a
 * plugin that starts the wrong server or a skill that drifts from its mirror.
 */
const root = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const json = <T>(p: string) => JSON.parse(read(p)) as T;

const version = json<{ version: string }>('package.json').version;
type Pkg = { version: string; dependencies?: Record<string, string> };
const semver = /^\d+\.\d+\.\d+$/;

describe('distribution layout', () => {
  it('the CLI, the MCP server and the manifests carry the root version; the engine packages pin each other exactly', () => {
    // The CLI and the server ship on every release. The catalogue and the
    // engine keep their own version when nothing in them changed, so a release
    // never republishes an identical securealy-core.
    const checks = json<Pkg>('packages/checks/package.json');
    const core = json<Pkg>('packages/core/package.json');
    const cli = json<Pkg>('packages/cli/package.json');
    const mcp = json<Pkg>('packages/mcp/package.json');
    expect(cli.version).toBe(version);
    expect(mcp.version).toBe(version);
    expect(core.version).toMatch(semver);
    expect(checks.version).toBe(core.version);
    expect(core.dependencies?.['securealy-checks']).toBe(checks.version);
    expect(cli.dependencies?.['securealy-core']).toBe(core.version);
    expect(mcp.dependencies?.['securealy-core']).toBe(core.version);
    expect(mcp.dependencies?.['securealy']).toBe(cli.version);
    expect(json<{ version: string }>('plugin/.claude-plugin/plugin.json').version).toBe(version);
    expect(json<{ plugins: { version: string }[] }>('.claude-plugin/marketplace.json').plugins[0]?.version).toBe(version);
    const server = json<{ version: string; packages: { version: string; identifier: string }[]; name: string }>('server.json');
    expect(server.version).toBe(version);
    expect(server.packages[0]?.version).toBe(version);
    expect(server.packages[0]?.identifier).toBe('securealy-mcp');
    expect(server.name).toBe(json<{ mcpName: string }>('packages/mcp/package.json').mcpName);
  });

  it('the plugin starts the pinned securealy-mcp version through npx', () => {
    const mcp = json<{ mcpServers: { securealy: { command: string; args: string[] } } }>('plugin/.mcp.json');
    expect(mcp.mcpServers.securealy.command).toBe('npx');
    expect(mcp.mcpServers.securealy.args).toEqual(['-y', `securealy-mcp@${version}`]);
  });

  it('the Action defaults to the CLI version it was released with', () => {
    const action = read('packages/action/action.yml');
    expect(action).toContain(`default: ${version}\n`);
    expect(read('packages/action/README.md')).toContain(`| \`version\` | \`${version}\` |`);
    expect(read('plugin/README.md')).toContain(`npx -y securealy-mcp@${version}`);
  });

  it('the Action passes tokens and its own path through the environment, never on a command line', () => {
    const action = read('packages/action/action.yml');
    expect(action).not.toMatch(/--token/);
    expect(action).not.toMatch(/--bypass/);
    expect(action).toContain('SECUREALY_TOKEN: ${{ inputs.token }}');
    expect(action).toContain('SECUREALY_BYPASS: ${{ inputs.bypass-token }}');
    expect(action).toContain('ACTION_PATH: ${{ github.action_path }}');
    // The grade step's script: every value it uses comes from env, so no expression is interpolated into shell.
    const script = (action.split('run: |')[1] ?? '').split('\n    - name:')[0] ?? '';
    expect(script).toContain('npx -y "securealy@${SECUREALY_VERSION}"');
    expect(script).not.toContain('${{');
  });

  it('the release workflow publishes only the packages whose version matches the tag', () => {
    const release = read('.github/workflows/release.yml');
    expect(release).toContain('for p in packages/checks packages/core packages/cli packages/mcp');
    expect(release).toContain('npm publish --workspace "$p" --access public');
    expect(release).not.toContain('npm publish --workspace packages/core');
  });

  it('the agentskills mirror is identical to the plugin skill and its name matches its folder', () => {
    const plugin = read('plugin/skills/launch-check/SKILL.md');
    const mirror = read('skills/launch-check/SKILL.md');
    expect(mirror).toBe(plugin);
    const front = plugin.split('---')[1] ?? '';
    expect(front).toMatch(/^name: launch-check$/m);
    const desc = /^description: (.+)$/m.exec(front)?.[1] ?? '';
    expect(desc.length).toBeGreaterThan(40);
    expect(desc.length).toBeLessThanOrEqual(1024);
    expect(front).toMatch(/version: "?\d+\.\d+\.\d+"?/);
    expect(plugin.split('\n').length).toBeLessThan(500);
  });

  it('nothing in the plugin or skill refers to another secret-bearing service by env name without disclosure', () => {
    const readme = read('plugin/README.md');
    for (const v of ['SUPABASE_SERVICE_KEY', 'SUPABASE_MGMT_TOKEN', 'STRIPE_SECRET_KEY', 'VERCEL_TOKEN']) expect(readme).toContain(v);
    expect(readme.split(/\s+/).length).toBeGreaterThan(40);
  });
});
