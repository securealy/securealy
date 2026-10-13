#!/usr/bin/env node
import { main } from './cli.js';

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    const e = err as Error;
    process.stderr.write(`securealy: ${e?.message ?? String(err)}\n`);
    process.exitCode = 2;
  },
);
