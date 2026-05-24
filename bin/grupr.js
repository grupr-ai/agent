#!/usr/bin/env node
// Thin entry — defers to src/cli.js so the bin file stays minimal and
// the actual argv router can be ESM with imports.
import { main } from '../src/cli.js';

main(process.argv.slice(2)).catch((err) => {
  console.error('\n✗ ' + (err?.message || err));
  if (process.env.GRUPR_DEBUG) {
    console.error(err);
  }
  process.exit(1);
});
