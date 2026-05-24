// ═════════════════════════════════════════════════════════
// `grupr agent claude [...args]` — wraps a `claude` CLI invocation so
// every permission prompt routes through Grupr Remote Control.
//
// Mechanics:
//   1. Validates credentials (paired device).
//   2. Writes a temp MCP-config file registering the bundled
//      claude-mcp-server.js as a server named "grupr".
//   3. Spawns `claude` with:
//        --mcp-config <temp>          (so claude knows where to find us)
//        --permission-prompt-tool mcp__grupr__grupr_permission_check
//      followed by any user-passed args (the prompt, --resume, etc.).
//   4. Pipes stdio inherit-style so the user sees claude's UI verbatim
//      and can type into it.
//   5. On exit, cleans up the temp config.
//
// The MCP server runs as a subprocess of `claude` (claude spawns it
// itself per the config); we don't spawn it. Our wrapper just owns
// the config + the `claude` parent process.
//
// Bypass: if `--no-grupr` is passed, we skip the wrap and just exec
// claude with the user's args (useful for breaking the loop during
// Grupr outages without uninstalling).
// ═════════════════════════════════════════════════════════

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { requireCredentials } from '../credentials.js';

const MCP_TOOL_REF = 'mcp__grupr__grupr_permission_check';

export async function runClaude(args) {
  // Check for the escape hatch first so even with broken credentials
  // the user can still run `claude` through the wrapper.
  if (args.includes('--no-grupr')) {
    const filtered = args.filter((a) => a !== '--no-grupr');
    process.stderr.write('grupr: --no-grupr passed, running claude without Remote Control wrap.\n');
    return execClaude(filtered, /*envExtras*/ {});
  }

  // Require credentials. Print a friendly message rather than a stack.
  try {
    requireCredentials();
  } catch (err) {
    process.stderr.write(
      'grupr: ' + (err.message || 'not paired') + '\n' +
      'grupr: skipping Remote Control wrap for this run. ' +
      'Use `grupr agent pair` to enable, or pass --no-grupr to silence this.\n',
    );
    return execClaude(args, {});
  }

  // Resolve the bundled MCP server path. We use file URLs so this
  // works regardless of where the package is installed (global, npx,
  // local node_modules).
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const serverPath = path.resolve(here, 'claude-mcp-server.js');
  if (!fs.existsSync(serverPath)) {
    process.stderr.write(`grupr: cannot find MCP server at ${serverPath}. Falling back to unwrapped claude.\n`);
    return execClaude(args, {});
  }

  // Write a per-invocation MCP config to a temp file. Using a fresh
  // file each run avoids stomping on user's existing .mcp.json.
  const cfgPath = path.join(
    os.tmpdir(),
    `grupr-mcp-${process.pid}-${crypto.randomBytes(4).toString('hex')}.json`,
  );
  const cfg = {
    mcpServers: {
      grupr: {
        command: process.execPath, // current node binary — avoids "node not in PATH" surprises
        args: [serverPath],
        env: {
          // Forward our env to the MCP subprocess so GRUPR_DEBUG /
          // GRUPR_API_BASE / etc. propagate.
          GRUPR_API_BASE: process.env.GRUPR_API_BASE || '',
          GRUPR_DEBUG: process.env.GRUPR_DEBUG || '',
          HOME: os.homedir(), // MCP server reads ~/.grupr/credentials
        },
      },
    },
  };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), { mode: 0o600 });

  // Cleanup the temp config when claude exits (including on signals).
  const cleanup = () => {
    try { fs.unlinkSync(cfgPath); } catch {}
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });

  // Build the claude argv. Our flags come FIRST so user-supplied flags
  // can override them if needed (rare but useful for debugging).
  const claudeArgs = [
    '--mcp-config', cfgPath,
    '--permission-prompt-tool', MCP_TOOL_REF,
    ...args,
  ];

  return execClaude(claudeArgs, {}).finally(cleanup);
}

// Spawn `claude` with the given argv. stdio inherit so the TTY UI
// works (Claude Code does its own ANSI cursor management; we mustn't
// pipe through Node).
function execClaude(args, envExtras) {
  // Pre-flight: is `claude` even on PATH? If not, fail with a useful
  // message instead of a cryptic ENOENT.
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (which.status !== 0) {
    process.stderr.write(
      'grupr: `claude` CLI not found on PATH.\n' +
      'grupr: install Claude Code first (https://github.com/anthropics/claude-code) then re-run.\n',
    );
    return Promise.resolve(127);
  }

  return new Promise((resolve) => {
    const child = spawn('claude', args, {
      stdio: 'inherit',
      env: { ...process.env, ...envExtras },
    });
    child.on('exit', (code, signal) => {
      if (signal) {
        // Mirror signal-exit semantics.
        process.kill(process.pid, signal);
        resolve(128);
      } else {
        resolve(code ?? 0);
      }
    });
    child.on('error', (err) => {
      process.stderr.write('grupr: failed to spawn claude: ' + err.message + '\n');
      resolve(1);
    });
  });
}
