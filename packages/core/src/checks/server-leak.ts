import type { CheckModule } from './context.js';
import { needPage, result } from './context.js';

const VERSION = /\d+\.\d+/;

export const check: CheckModule = {
  id: 'server-leak',
  run(ctx) {
    const gate = needPage(ctx, this.id, false);
    if (gate) return gate;
    const server = ctx.header('server');
    const powered = ctx.header('x-powered-by');
    const aspnet = ctx.header('x-aspnet-version');
    const versioned: string[] = [];
    if (server && VERSION.test(server)) versioned.push(`Server: ${server.slice(0, 50)}`);
    if (powered && VERSION.test(powered)) versioned.push(`X-Powered-By: ${powered.slice(0, 50)}`);
    if (aspnet) versioned.push(`X-AspNet-Version: ${aspnet.slice(0, 30)}`);
    if (versioned.length) return result(this.id, 'fail', versioned.join('; '));
    if (powered) return result(this.id, 'warn', `X-Powered-By: ${powered.slice(0, 50)} names the framework (no version)`);
    if (server) return result(this.id, 'pass', `Server: ${server.slice(0, 50)} (vendor name only, no version)`);
    return result(this.id, 'pass', 'no Server or X-Powered-By header');
  },
};
