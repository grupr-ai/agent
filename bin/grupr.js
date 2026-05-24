#!/usr/bin/env node
// Thin entry — defers to src/cli.js so the bin file stays minimal and
// the actual argv router can be ESM with imports.
import { main } from '../src/cli.js';

main(process.argv.slice(2))
  .then((code) => {
    // main returns the exit code (0 default; wrappers pass through the
    // wrapped process's code so CI sees real failures).
    if (typeof code === 'number' && code !== 0) {
      process.exit(code);
    }
  })
  .catch((err) => {
    console.error('\n✗ ' + (err?.message || err));
    if (process.env.GRUPR_DEBUG) {
      console.error(err);
    }
    process.exit(1);
  });
