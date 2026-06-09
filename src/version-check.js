// V9.5: async npm-registry latest-version check. Prints a one-line
// "update available" hint to stderr when the installed @grupr/agent
// is older than the latest published version.
//
// Designed to be fire-and-forget — never blocks the CLI, never throws,
// and caches the result for 24h so we don't hit the registry on every
// invocation.
//
// The cache lives at ~/.grupr/version-cache.json (alongside credentials).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import url from 'node:url';

const REGISTRY_URL = 'https://registry.npmjs.org/@grupr/agent/latest';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const CACHE_FILE = path.join(os.homedir(), '.grupr', 'version-cache.json');

let localVersionMemo = null;

// Holds the in-flight background update check (a Promise) so the CLI can
// flush it before the process exits. Without this, a fast-returning
// command that calls process.exit() (e.g. any non-zero exit code) races
// the live undici fetch and crashes libuv on Windows with
// "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)".
let pendingCheck = null;

// Return the version from this package's package.json. Computed once
// per process. Returns null if it can't be parsed (running uninstalled
// from a checkout etc.) — caller treats null as "skip the check".
function getLocalVersion() {
  if (localVersionMemo !== null) return localVersionMemo;
  try {
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    // src/version-check.js → ../package.json
    const pkgPath = path.resolve(here, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    localVersionMemo = typeof pkg?.version === 'string' ? pkg.version : null;
  } catch {
    localVersionMemo = null;
  }
  return localVersionMemo;
}

// Read the cache. Returns null on any error or when stale.
function readCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (typeof raw?.checked_at !== 'number') return null;
    if (Date.now() - raw.checked_at > CACHE_TTL_MS) return null;
    return raw;
  } catch {
    return null;
  }
}

function writeCache(latestVersion) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      CACHE_FILE,
      JSON.stringify({ latest_version: latestVersion, checked_at: Date.now() }),
      { mode: 0o600 },
    );
  } catch {
    // cache write failure is harmless
  }
}

// Compare two semver-ish strings. Returns true if `b` is newer than `a`.
// Pre-release suffixes (-alpha, -beta) are compared lexically AFTER the
// numeric triple. Not a full semver impl — sufficient for "0.1.2" vs
// "0.1.3" and "0.1.0-alpha.1" vs "0.1.0".
function isNewer(a, b) {
  if (a === b) return false;
  const parse = (v) => {
    const [main, pre] = String(v).split('-');
    const [maj = '0', min = '0', pat = '0'] = main.split('.');
    return {
      maj: parseInt(maj, 10) || 0,
      min: parseInt(min, 10) || 0,
      pat: parseInt(pat, 10) || 0,
      pre: pre || '',
    };
  };
  const A = parse(a);
  const B = parse(b);
  if (B.maj !== A.maj) return B.maj > A.maj;
  if (B.min !== A.min) return B.min > A.min;
  if (B.pat !== A.pat) return B.pat > A.pat;
  // Same numeric — a release (no -pre) is newer than a pre-release of
  // the same number. Otherwise compare prerelease strings lexically.
  if (A.pre && !B.pre) return true;
  if (!A.pre && B.pre) return false;
  return B.pre > A.pre;
}

// Fire-and-forget check. Schedules an async fetch to the npm registry
// and prints to stderr if a newer version exists. Returns immediately;
// the actual stderr write may happen after the calling command has
// already printed its output. We use setImmediate so we don't block
// process exit beyond what the network call needs.
//
// Skip conditions (all silent):
//   - opted out via GRUPR_DISABLE_UPDATE_CHECK
//   - cache says we checked in the last 24h AND latest matches local
//   - can't determine local version
//   - registry fetch fails or times out (4s)
export function checkForUpdate() {
  if (process.env.GRUPR_DISABLE_UPDATE_CHECK) return;
  const local = getLocalVersion();
  if (!local) return;

  // Fast path: cache is fresh and tells us we're current.
  const cached = readCache();
  if (cached && !isNewer(local, cached.latest_version)) return;
  if (cached && isNewer(local, cached.latest_version)) {
    // Cache says there's a newer version — print without re-fetching.
    printUpdateNotice(local, cached.latest_version);
    return;
  }

  // Cache miss or stale — fetch in the background. checkForUpdate still
  // returns immediately (we only assign the promise, never await it), but
  // recording it lets flushUpdateCheck() settle the fetch before exit so
  // process.exit() never tears down a live undici handle.
  pendingCheck = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      const resp = await fetch(REGISTRY_URL, { signal: controller.signal });
      if (!resp.ok) return;
      const json = await resp.json();
      const latest = typeof json?.version === 'string' ? json.version : null;
      if (!latest) return;
      writeCache(latest);
      if (isNewer(local, latest)) printUpdateNotice(local, latest);
    } catch {
      // network failures are silent
    } finally {
      clearTimeout(timeout);
    }
  })();
}

// flushUpdateCheck awaits any in-flight background update check. Call it
// before the process exits so a fast-returning command's process.exit()
// can't race a live undici fetch (which aborts libuv on Windows). No-op
// when nothing is pending — cache hit, opted out, or a wrapper command
// that never started a check. Bounded by the fetch's own 4s abort timer.
export async function flushUpdateCheck() {
  if (!pendingCheck) return;
  try {
    await pendingCheck;
  } catch {
    // already swallowed inside the check; nothing to surface
  }
  pendingCheck = null;
}

function printUpdateNotice(local, latest) {
  process.stderr.write(
    `\n[grupr] update available: ${local} → ${latest}. ` +
    `Install with: npm install -g @grupr/agent\n` +
    `[grupr] (set GRUPR_DISABLE_UPDATE_CHECK=1 to silence)\n\n`,
  );
}

// Exported for tests.
export { isNewer as _isNewer, getLocalVersion as _getLocalVersion };
