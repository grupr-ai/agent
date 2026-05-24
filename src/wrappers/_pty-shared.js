// ═════════════════════════════════════════════════════════
// Shared PTY-wrap + prompt-intercept implementation for all the
// coding-agent wrappers that don't expose a permission hook (codex,
// aider, continue, cursor-agent). Claude Code uses the MCP server
// path instead (claude-mcp-server.js) — none of this applies there.
//
// Architecture:
//   - Spawn the wrapped binary inside a PTY (via optional node-pty)
//   - Forward user keystrokes → PTY stdin
//   - Forward PTY output → user stdout, while accumulating into a
//     ring buffer that gets matched against prompt patterns
//   - On pattern match: route the implied approval through Grupr,
//     then send y\r or n\r to the PTY based on the decision
//
// node-pty is OPTIONAL — when not installed we fall back to passthrough
// (stdio inherit) with a warning. Reason: native build dep would
// torpedo install success rate for users who only care about Claude
// Code. Power users opt in with `npm install -g node-pty`.
// ═════════════════════════════════════════════════════════

import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { apiPost, apiGet, deviceAuth } from '../api.js';
import { load as loadCredentials } from '../credentials.js';

/**
 * @typedef {Object} PromptPattern
 * @property {string} label - identifier for debug logging
 * @property {RegExp} regex - tested against accumulated PTY output
 * @property {(m: RegExpMatchArray) => {tool_name: string, request_payload: any}} extract
 */

/**
 * @typedef {Object} PTYWrapConfig
 * @property {string} binary - the wrapped CLI binary name (must be on PATH)
 * @property {string} agentKind - one of: claude_code, codex, aider, continue, cursor, generic
 * @property {string} sessionPrefix - e.g. "cx-" for codex, "ai-" for aider
 * @property {PromptPattern[]} patterns - first-match-wins prompt regexes
 * @property {string[]} args - args to pass through to the wrapped binary
 * @property {string} [betaCopy] - optional banner copy to print on start
 */

/**
 * Run a PTY-wrapped coding-agent CLI with Grupr approval routing.
 * Returns the wrapped process exit code.
 *
 * @param {PTYWrapConfig} cfg
 * @returns {Promise<number>}
 */
export async function runPTYWrappedAgent(cfg) {
  // --no-grupr escape hatch — bypass the wrap entirely.
  if (cfg.args.includes('--no-grupr')) {
    const filtered = cfg.args.filter((a) => a !== '--no-grupr');
    process.stderr.write(
      `grupr: --no-grupr passed, running ${cfg.binary} without Remote Control wrap.\n`,
    );
    return execPassthrough(cfg.binary, filtered);
  }

  // Pre-flight: binary on PATH?
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cfg.binary], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (which.status !== 0) {
    process.stderr.write(
      `grupr: \`${cfg.binary}\` CLI not found on PATH.\n` +
      `grupr: install ${cfg.binary} first then re-run.\n`,
    );
    return 127;
  }

  // Optional node-pty.
  let pty;
  try {
    const mod = await import('node-pty');
    pty = mod.default || mod;
  } catch {
    pty = null;
  }

  if (!pty) {
    process.stderr.write(
      `grupr: ⚠ node-pty not installed. Running ${cfg.binary} in passthrough mode — approvals will NOT route through Grupr.\n` +
      `grupr: install with \`npm install -g node-pty\` to enable the full ${cfg.binary} wrap (beta).\n`,
    );
    return execPassthrough(cfg.binary, cfg.args);
  }

  // Credentials.
  const credentials = loadCredentials();
  if (!credentials) {
    process.stderr.write(
      'grupr: no paired credentials at ~/.grupr/credentials. Run `grupr agent pair` first.\n' +
      `grupr: falling back to ${cfg.binary} passthrough — approvals will NOT route through Grupr.\n`,
    );
    return execPassthrough(cfg.binary, cfg.args);
  }
  const authHeaders = deviceAuth(credentials.device_id, credentials.device_token);
  const sessionId =
    cfg.sessionPrefix + crypto.randomBytes(4).toString('hex') + Date.now().toString(36);

  if (cfg.betaCopy) {
    process.stderr.write(cfg.betaCopy + '\n');
  }
  if (process.env.GRUPR_DEBUG) {
    process.stderr.write(
      `[grupr-${cfg.agentKind}] session=${sessionId} device=${credentials.device_id.slice(0, 8)}…\n`,
    );
  }

  // ── Spawn in PTY ───────────────────────────────────────────────────
  const cols = process.stdout.columns || 120;
  const rows = process.stdout.rows || 30;
  const term = pty.spawn(cfg.binary, cfg.args, {
    name: 'xterm-color',
    cols,
    rows,
    cwd: process.cwd(),
    env: { ...process.env },
  });

  const onResize = () => {
    try { term.resize(process.stdout.columns, process.stdout.rows); } catch {}
  };
  process.stdout.on('resize', onResize);

  if (process.stdin.isTTY) {
    try { process.stdin.setRawMode(true); } catch {}
  }
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  const onStdin = (data) => term.write(data);
  process.stdin.on('data', onStdin);

  // ── PTY output → user + intercept ──────────────────────────────────
  let promptBuffer = '';
  let interceptInFlight = false;

  term.onData((chunk) => {
    process.stdout.write(chunk);
    if (interceptInFlight) return;

    promptBuffer += chunk;
    if (promptBuffer.length > 4096) {
      promptBuffer = promptBuffer.slice(-4096);
    }

    for (const p of cfg.patterns) {
      const m = promptBuffer.match(p.regex);
      if (!m) continue;
      const { tool_name, request_payload } = p.extract(m);
      if (process.env.GRUPR_DEBUG) {
        process.stderr.write(
          `[grupr-${cfg.agentKind}] intercepted ${p.label}: ${JSON.stringify(request_payload).slice(0, 100)}\n`,
        );
      }
      interceptInFlight = true;
      promptBuffer = '';
      routeApproval(authHeaders, sessionId, cfg.agentKind, tool_name, request_payload)
        .then(({ approved, reason }) => {
          // W6.2: surface user-typed deny reason above the PTY so the
          // developer sees it before the wrapped agent reacts. PTY
          // wrappers can't pass structured data to the agent the way
          // the Claude Code MCP wrapper can, so this is the channel.
          if (!approved && reason) {
            process.stderr.write(`\n[grupr] Denied: ${reason}\n`);
          }
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

// ── shared helpers ────────────────────────────────────────────────────

async function routeApproval(authHeaders, sessionId, agentKind, toolName, requestPayload) {
  const created = await apiPost(
    '/api/agent-approvals',
    {
      agent_session_id: sessionId,
      agent_kind: agentKind,
      tool_name: toolName,
      request_payload: requestPayload,
    },
    { headers: authHeaders, timeoutMs: 15_000 },
  );
  if (created.auto_approved) return { approved: true, reason: '' };

  const approvalId = created.approval?.id;
  if (!approvalId) throw new Error('api did not return an approval id');

  while (true) {
    const r = await apiGet(`/api/agent-approvals/${approvalId}/wait`, {
      headers: authHeaders,
      timeoutMs: 100_000,
    });
    const a = r.approval;
    if (a.status === 'pending') continue;
    // W6.2: extract user-typed reason from decision JSON for caller to
    // surface above the PTY.
    let reason = '';
    try {
      const d = typeof a.decision === 'string' ? JSON.parse(a.decision) : a.decision;
      if (d && typeof d.reason === 'string') reason = d.reason.trim();
    } catch {}
    return { approved: a.status === 'approved', reason };
  }
}

function execPassthrough(binary, args) {
  return new Promise((resolve) => {
    const child = spawn(binary, args, { stdio: 'inherit', env: process.env });
    child.on('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        resolve(128);
      } else {
        resolve(code ?? 0);
      }
    });
    child.on('error', (err) => {
      process.stderr.write(`grupr: failed to spawn ${binary}: ${err.message}\n`);
      resolve(1);
    });
  });
}

// ── shared prompt patterns ────────────────────────────────────────────
//
// Most coding-agent CLIs use a similar y/N prompt format. These are
// good defaults; individual wrappers can extend with tool-specific
// patterns.

/** @type {PromptPattern[]} */
export const COMMON_PROMPT_PATTERNS = [
  {
    label: 'bash',
    regex: /(?:run command|execute|approve command|run shell)[^:]*:\s*(.+?)\s*\[y\/N\]/i,
    extract: (m) => ({
      tool_name: 'Bash',
      request_payload: { cmd: m[1].trim() },
    }),
  },
  {
    label: 'edit',
    regex: /(?:apply (?:diff|patch|edit) to|write to|modify|edit file)\s+(.+?)\s*\[y\/N\]/i,
    extract: (m) => ({
      tool_name: 'Edit',
      request_payload: { file_path: m[1].trim() },
    }),
  },
  {
    label: 'create',
    regex: /(?:create file|new file)\s+(.+?)\s*\[y\/N\]/i,
    extract: (m) => ({
      tool_name: 'Write',
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
