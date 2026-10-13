#!/usr/bin/env node
// Smoke test over real stdio: start the built server, send initialize + initialized + tools/list, print the tool names.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
const child = spawn(process.execPath, [bin], { stdio: ['pipe', 'pipe', 'inherit'] });
const send = (msg) => child.stdin.write(JSON.stringify(msg) + '\n');
let buf = '';
child.stdout.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  for (const line of buf.split('\n').slice(0, -1)) {
    const msg = JSON.parse(line);
    if (msg.id === 1) {
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    }
    if (msg.id === 2) {
      console.log(`${msg.result.tools.length} tools: ${msg.result.tools.map((t) => t.name).join(', ')}`);
      child.kill();
    }
  }
  buf = buf.slice(buf.lastIndexOf('\n') + 1);
});
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } } });
setTimeout(() => { console.error('smoke: timed out'); child.kill(); process.exit(1); }, 10_000).unref();
