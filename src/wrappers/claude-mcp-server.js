#!/usr/bin/env node
// ═════════════════════════════════════════════════════════
// Grupr MCP server for Claude Code's --permission-prompt-tool
//
// Claude Code spawns this as a subprocess and speaks the MCP protocol
// (JSON-RPC 2.0 over newline-delimited JSON on stdio). Whenever Claude
// needs a permission decision for a Bash/Edit/Write/WebFetch/etc. tool,
// it calls our `grupr_permission_check` tool with {tool_name, input}.
//
// Our handler:
//   1. Classifies risk locally for the prompt copy (the api re-classifies
//      server-side, the server's verdict is authoritative)
//   2. POSTs to /api/agent-approvals using the paired device credentials
//      from ~/.grupr/credentials
//   3. Long-polls /api/agent-approvals/:id/wait until the user decides
//      on phone / web / inline-in-grupr
//   4. Returns {behavior: "allow"|"deny", message?: ...} per Claude Code's
//      permission-prompt-tool spec
//
// stderr is the *only* safe log target — stdout is the JSON-RPC channel.
//
// Auto-approve fast path:
//   If the api short-circuits with auto_approved=true (an allowlist rule
//   matched), we return allow immediately without long-polling. This is
//   the path that makes the wrapper feel native rather than chatty.
// ═════════════════════════════════════════════════════════

import process from 'node:process';
import { apiPost, apiGet, deviceAuth } from '../api.js';
import { load as loadCredentials } from '../credentials.js';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'grupr';
const SERVER_VERSION = '0.1.0';
const TOOL_NAME = 'grupr_permission_check';

// Session id is generated once per server process. Claude Code spawns
// one MCP server per `claude` invocation, so this naturally scopes
// session-level allowlists to a single conversation.
const SESSION_ID = 'cc-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

const credentials = loadCredentials();
if (!credentials) {
  // Without credentials we cannot route approvals. Log to stderr and
  // exit non-zero — Claude Code will surface the failure to the user.
  process.stderr.write(
    'grupr-mcp: no paired credentials at ~/.grupr/credentials. Run `grupr agent pair` first.\n',
  );
  process.exit(2);
}
const authHeaders = deviceAuth(credentials.device_id, credentials.device_token);
debug(`session=${SESSION_ID} device=${credentials.device_id.slice(0, 8)}…`);

// ─── stdio JSON-RPC plumbing ─────────────────────────────────────────────
//
// MCP frames are one JSON message per line. We accumulate stdin, split on
// newlines, JSON.parse each, dispatch. Responses + notifications go to
// stdout as one line each.

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (err) {
      debug(`malformed frame: ${err.message}`);
      continue;
    }
    handleMessage(msg).catch((err) => {
      debug(`handler crash: ${err.stack || err.message}`);
      if (msg && msg.id !== undefined) {
        writeFrame({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32603, message: 'Internal error: ' + (err.message || String(err)) },
        });
      }
    });
  }
});
process.stdin.on('end', () => process.exit(0));

function writeFrame(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function debug(...args) {
  if (process.env.GRUPR_DEBUG) {
    process.stderr.write('[grupr-mcp] ' + args.join(' ') + '\n');
  }
}

// ─── MCP method dispatch ─────────────────────────────────────────────────

async function handleMessage(msg) {
  if (msg.method === 'initialize') {
    writeFrame({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      },
    });
    return;
  }
  if (msg.method === 'notifications/initialized') {
    // Notification — no response.
    return;
  }
  if (msg.method === 'tools/list') {
    writeFrame({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        tools: [
          {
            name: TOOL_NAME,
            description:
              'Route a Claude Code permission prompt through Grupr Remote Control. ' +
              'The decision will be made on the user\'s phone, web app, or active grupr.',
            inputSchema: {
              type: 'object',
              properties: {
                tool_name: { type: 'string', description: 'The Claude Code tool requesting permission (Bash, Edit, etc.)' },
                input: { type: 'object', description: 'The tool\'s arguments (cmd, file_path, etc.)' },
              },
              required: ['tool_name', 'input'],
            },
          },
        ],
      },
    });
    return;
  }
  if (msg.method === 'tools/call') {
    await handleToolCall(msg);
    return;
  }
  // Method not implemented — reply with error if it had an id, ignore otherwise.
  if (msg.id !== undefined) {
    writeFrame({
      jsonrpc: '2.0',
      id: msg.id,
      error: { code: -32601, message: `Method not found: ${msg.method}` },
    });
  }
}

async function handleToolCall(msg) {
  const params = msg.params || {};
  if (params.name !== TOOL_NAME) {
    writeFrame({
      jsonrpc: '2.0',
      id: msg.id,
      error: { code: -32602, message: `Unknown tool: ${params.name}` },
    });
    return;
  }
  const args = params.arguments || {};
  const toolName = String(args.tool_name || 'Unknown');
  const toolInput = args.input || {};

  debug(`approval request: tool=${toolName}`);

  try {
    const decision = await routeApproval(toolName, toolInput);
    writeFrame({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        // Per Claude Code's permission-prompt-tool spec, the response
        // is a single text content block whose value is JSON with
        // {behavior, updatedInput?, message?}.
        content: [
          {
            type: 'text',
            text: JSON.stringify(decision),
          },
        ],
      },
    });
  } catch (err) {
    debug(`route failure: ${err.message}`);
    // Fail-closed: if Grupr is unreachable, DENY the operation rather
    // than silently allowing it. The user can retry or run without
    // the wrapper to bypass during outages.
    writeFrame({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              behavior: 'deny',
              message:
                'Grupr Remote Control is unreachable (' + (err.message || 'unknown') +
                '). Denying for safety. Retry in a moment or run claude without the wrapper.',
            }),
          },
        ],
      },
    });
  }
}

// ─── Approval routing — the actual Grupr integration ────────────────────

async function routeApproval(toolName, toolInput) {
  // Step 1: POST the approval request. The api classifies risk +
  // checks allowlists; we get back either auto_approved=true (allowlist
  // short-circuit) or a pending approval whose id we long-poll.
  const created = await apiPost(
    '/api/agent-approvals',
    {
      agent_session_id: SESSION_ID,
      agent_kind: 'claude_code',
      tool_name: toolName,
      request_payload: toolInput,
    },
    { headers: authHeaders, timeoutMs: 15_000 },
  );

  if (created.auto_approved) {
    debug(`auto-approved (allowlist rule=${created.allowlist_rule?.tool_pattern})`);
    return { behavior: 'allow' };
  }

  const approvalId = created.approval?.id;
  if (!approvalId) {
    throw new Error('api did not return an approval id');
  }
  debug(`pending approval id=${approvalId} tier=${created.approval?.risk_tier}`);

  // Step 2: long-poll /wait until the user decides. We loop because
  // the api's long-poll window is 90s — if the user takes longer we
  // resume. Each iteration is bounded by a 100s client timeout to
  // give the server room to return naturally before we retry.
  while (true) {
    const r = await apiGet(`/api/agent-approvals/${approvalId}/wait`, {
      headers: authHeaders,
      timeoutMs: 100_000,
    });
    const a = r.approval;
    if (a.status === 'pending') {
      // Server returned because its long-poll deadline elapsed. Loop.
      continue;
    }
    debug(`decision: ${a.status}`);
    switch (a.status) {
      case 'approved':
        return { behavior: 'allow' };
      case 'denied':
        return {
          behavior: 'deny',
          message: 'Denied via Grupr Remote Control.',
        };
      case 'timed_out':
        return {
          behavior: 'deny',
          message: 'Approval timed out — no decision was made. Try again.',
        };
      case 'cancelled':
        return {
          behavior: 'deny',
          message: 'Approval was cancelled.',
        };
      default:
        return {
          behavior: 'deny',
          message: `Unknown approval status: ${a.status}`,
        };
    }
  }
}
