// ═════════════════════════════════════════════════════════
// `grupr agent codex [...args]` — wraps the `codex` CLI so approval
// prompts route through Grupr Remote Control.
//
// ⚠ MARKED BETA.
//
// Codex (OpenAI's coding-agent CLI) does NOT expose a permission-prompt
// hook the way Claude Code does. Our only intercept point is parsing
// its tty output for the approval prompts and synthesizing the y/n
// keystroke when Grupr returns a decision.
//
// Two execution modes, picked at runtime:
//
//   1. PTY mode (preferred). If `node-pty` is installed, we wrap codex
//      in a pseudo-terminal so its raw-mode single-key prompts behave
//      correctly. Required for the full Grupr-routed UX.
//
//      Enable with:  npm install -g node-pty
//
//   2. Passthrough mode (fallback). If node-pty isn't available, we
//      spawn codex with stdio inherit so the user can use it normally
//      — but approvals are NOT routed through Grupr. We print a clear
//      warning so the user isn't surprised.
//
// Why the optional-dep route: node-pty requires a native build toolchain
// (python + a C++ compiler) on first install. Forcing that on every
// @grupr/agent user just to wrap Claude Code (which doesn't need PTY)
// would torpedo install success rate. Codex users opt in.
//
// Prompt-parser regex below is based on observed Codex v0.x prompt
// formats. Update as the CLI evolves. The parser fires on any line
// matching the regex — false positives would cause Grupr round-trips
// that don't matter, never silent approvals.
// ═════════════════════════════════════════════════════════

import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { apiPost, apiGet, deviceAuth } from '../api.js';
import { load as loadCredentials } from '../credentials.js';

// Prompt patterns we intercept. Each entry: { regex, toolFn(line) → {tool_name, request_payload} }
// Codex typically asks "Run command: <cmd>? [y/N]" or "Apply diff to <file>? [y/N]".
// Order matters — first match wins.
const PROMPT_PATTERNS = [
  {
    label: 'bash',
    regex: /(?:run command|execute|approve command)[^:]*:\s*(.+?)\s*\[y\/N\]/i,
    extract: (m) => ({
      tool_name: 'Bash',
      request_payload: { cmd: m[1].trim() },
    }),
  },
  {
    label: 'edit',
    regex: /(?:apply (?:diff|patch|edit) to|write to|modify)\s+(.+?)\s*\[y\/N\]/i,
    extract: (m) => ({
      tool_name: 'Edit',
      request_payload: { file_path: m[1].trim() },
    }),
  },
  {
    label: 'generic',
    regex: /(.{5,160}?)\s*\[y\/N\]\s*$/i,
    extract: (m) => ({
      tool_name: 'Generic',
      request_payload: { prompt: m[1].trim() },
    }),
  },
];

export async function runCodex(args) {
  if (args.includes('--no-grupr')) {
    const filtered = args.filter((a) => a !== '--no-grupr');
    process.stderr.write('grupr: --no-grupr passed, running codex without Remote Control wrap.\n');
    return execPassthrough(filtered);
  }

  // Pre-flight: codex on PATH?
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['codex'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (which.status !== 0) {
    process.stderr.write(
      'grupr: `codex` CLI not found on PATH.\n' +
      'grupr: install OpenAI Codex CLI first then re-run.\n',
    );
    return 127;
  }

  // Try to require node-pty. Optional dep — if missing we fall back.
  let pty;
  try {
    pty = (await import('node-pty')).default || (await import('node-pty'));
  } catch {
    pty = null;
  }

  if (!pty) {
    process.stderr.write(
      'grupr: ⚠ node-pty is not installed. Falling back to passthrough — approvals will NOT be routed through Grupr for this session.\n' +
      'grupr: install with `npm install -g node-pty` to enable the full Codex wrap (beta).\n',
    );
    return execPassthrough(args);
  }

  // Credentials needed for the PTY-routed path.
  const credentials = loadCredentials();
  if (!credentials) {
    process.stderr.write(
      'grupr: no paired credentials at ~/.grupr/credentials. Run `grupr agent pair` first.\n' +
      'grupr: falling back to passthrough — approvals will NOT route through Grupr.\n',
    );
    return execPassthrough(args);
  }
  const authHeaders = deviceAuth(credentials.device_id, credentials.device_token);
  const sessionId = 'cx-' + crypto.randomBytes(4).toString('hex') + Date.now().toString(36);

  process.stderr.write('grupr: codex wrap (beta) — approvals routing through Grupr Remote Control.\n');
  if (process.env.GRUPR_DEBUG) {
    process.stderr.write(`[grupr-codex] session=${sessionId} device=${credentials.device_id.slice(0, 8)}…\n`);
  }

  // ── Spawn codex in a PTY ───────────────────────────────────────────
  const cols = process.stdout.columns || 120;
  const rows = process.stdout.rows || 30;
  const term = pty.spawn('codex', args, {
    name: 'xterm-color',
    cols,
    rows,
    cwd: process.cwd(),
    env: { ...process.env },
  });

  // Mirror terminal resize.
  const onResize = () => {
    try { term.resize(process.stdout.columns, process.stdout.rows); } catch {}
  };
  process.stdout.on('resize', onResize);

  // Forward user keystrokes to the PTY.
  if (process.stdin.isTTY) {
    try { process.stdin.setRawMode(true); } catch {}
  }
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  const onStdin = (data) => term.write(data);
  process.stdin.on('data', onStdin);

  // Parse PTY output, intercepting approval prompts.
  let promptBuffer = '';
  let interceptInFlight = false;

  term.onData((chunk) => {
    process.stdout.write(chunk);
    if (interceptInFlight) return;

    promptBuffer += chunk;
    // Cap buffer to last 4K — prompt patterns won't be longer than that.
    if (promptBuffer.length > 4096) {
      promptBuffer = promptBuffer.slice(-4096);
    }

    for (const p of PROMPT_PATTERNS) {
      const m = promptBuffer.match(p.regex);
      if (m) {
        const { tool_name, request_payload } = p.extract(m);
        if (process.env.GRUPR_DEBUG) {
          process.stderr.write(`[grupr-codex] intercepted ${p.label} prompt: ${JSON.stringify(request_payload).slice(0, 100)}\n`);
        }
        interceptInFlight = true;
        promptBuffer = '';
        // Fire-and-handle async.
        routeApproval(authHeaders, sessionId, tool_name, request_payload)
          .then((approved) => {
            // Send y or n + newline. \r for raw-mode "Enter".
            term.write(approved ? 'y\r' : 'n\r');
          })
          .catch((err) => {
            process.stderr.write(`grupr: approval routing failed (${err.message}). Denying for safety.\n`);
            term.write('n\r');
          })
          .finally(() => {
            interceptInFlight = false;
          });
        break;
      }
    }
  });

  return new Promise((resolve) => {
    term.onExit(({ exitCode, signal }) => {
      process.stdout.off('resize', onResize);
      process.stdin.off('data', onStdin);
      if (process.stdin.isTTY) {
        try { process.stdin.setRawMode(false); } catch {}
      }
      process.stdin.pause();
      if (signal) {
        process.kill(process.pid, signal);
        resolve(128);
      } else {
        resolve(exitCode ?? 0);
      }
    });
  });
}

// ── helpers ───────────────────────────────────────────────────────────

async function routeApproval(authHeaders, sessionId, toolName, requestPayload) {
  const created = await apiPost(
    '/api/agent-approvals',
    {
      agent_session_id: sessionId,
      agent_kind: 'codex',
      tool_name: toolName,
      request_payload: requestPayload,
    },
    { headers: authHeaders, timeoutMs: 15_000 },
  );
  if (created.auto_approved) return true;

  const approvalId = created.approval?.id;
  if (!approvalId) throw new Error('api did not return an approval id');

  while (true) {
    const r = await apiGet(`/api/agent-approvals/${approvalId}/wait`, {
      headers: authHeaders,
      timeoutMs: 100_000,
    });
    const a = r.approval;
    if (a.status === 'pending') continue;
    return a.status === 'approved';
  }
}

function execPassthrough(args) {
  return new Promise((resolve) => {
    const child = spawn('codex', args, { stdio: 'inherit', env: process.env });
    child.on('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        resolve(128);
      } else {
        resolve(code ?? 0);
      }
    });
    child.on('error', (err) => {
      process.stderr.write('grupr: failed to spawn codex: ' + err.message + '\n');
      resolve(1);
    });
  });
}
