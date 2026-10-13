#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

// stdout is the protocol channel: nothing else may ever write to it.
const server = createServer({ log: (line) => process.stderr.write(`securealy-mcp: ${line}\n`) });
server.connect(new StdioServerTransport()).catch((err: unknown) => {
  process.stderr.write(`securealy-mcp: ${(err as Error)?.message ?? String(err)}\n`);
  process.exitCode = 1;
});
