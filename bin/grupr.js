#!/usr/bin/env node
// Thin entry — defers to src/cli.js so the bin file stays minimal and
// the actual argv router can be ESM with imports.
import { main } from '../src/cli.js';

// Safety net: if some native handle (e.g. node-pty on Windows) fails to
// close and keeps the event loop alive past the grace period, force-exit
// anyway with whatever code we settled on. Unref'd so it NEVER delays a
// clean drain, and the 8s grace exceeds undici's keep-alive socket timeout
// so this force-exit can't race an idle fetch socket.
function armExitWatchdog() {
  const t = setTimeout(() => process.exit(process.exitCode ?? 0), 8000);
  if (t && typeof t.unref === 'function') t.unref();
}

main(process.argv.slice(2))
  .then((code) => {
    // Non-wrapper commands set process.exitCode inside main() and return so
    // the loop drains naturally (no process.exit() → no undici/libuv
    // teardown race on Windows). Wrappers process.exit() inside main().
    if (typeof code === 'number') process.exitCode = code;
    armExitWatchdog();
  })
  .catch((err) => {
    // A throw bypasses main()'s own exit handling. Surface it and drain
    // naturally too — by here any fetch has already settled/errored, so
    // there is nothing in flight to race.
    console.error('\n✗ ' + (err?.message || err));
    if (process.env.GRUPR_DEBUG) {
      console.error(err);
    }
    process.exitCode = 1;
    armExitWatchdog();
  });
