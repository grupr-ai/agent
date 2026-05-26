// `grupr agent history [--limit N]` — V10.18. Recent approvals from
// this device via GET /api/agent-approvals/self/history (device-authed).
//
// Plain table output to stdout; suitable for piping to grep / awk.
import { apiGet, deviceAuth } from './api.js';
import { requireCredentials } from './credentials.js';

export async function runHistory(args) {
  let limit = 20;
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--limit' || args[i] === '-n') && args[i + 1]) {
      const n = parseInt(args[i + 1], 10);
      if (!Number.isNaN(n) && n > 0 && n <= 200) limit = n;
      i++;
    }
  }
  const c = requireCredentials();
  let r;
  try {
    r = await apiGet(`/api/agent-approvals/self/history?limit=${limit}`, {
      headers: deviceAuth(c.device_id, c.device_token),
    });
  } catch (err) {
    process.stderr.write(`grupr: history failed: ${err.message}\n`);
    return 1;
  }
  const items = r?.approvals || [];
  if (items.length === 0) {
    process.stdout.write('No approvals in history for this device yet.\n');
    return 0;
  }
  // Column-formatted table. Status column color-coded via ANSI when stdout is a TTY.
  const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
  const color = (code, s) => (useColor ? `[${code}m${s}[0m` : s);
  process.stdout.write(
    `\n` +
    pad('STATUS', 12) + pad('TIER', 12) + pad('TOOL', 14) + pad('AGENT', 14) + 'PAYLOAD\n',
  );
  process.stdout.write('─'.repeat(120) + '\n');
  for (const a of items) {
    const statusStr = (a.status || '?').toUpperCase();
    const statusColored = (() => {
      switch (a.status) {
        case 'approved':  return color(32, pad(statusStr, 12));
        case 'denied':    return color(31, pad(statusStr, 12));
        case 'timed_out': return color(33, pad(statusStr, 12));
        default:          return pad(statusStr, 12);
      }
    })();
    process.stdout.write(
      statusColored +
      pad(a.risk_tier || '-', 12) +
      pad(a.tool_name || '-', 14) +
      pad(a.agent_kind || '-', 14) +
      payloadPreview(a.request_payload) + '\n',
    );
  }
  process.stdout.write('\n');
  process.stdout.write(`Showing ${items.length} most-recent. --limit N for more (max 200).\n`);
  return 0;
}

function pad(s, n) {
  s = String(s);
  if (s.length >= n) return s.slice(0, n - 1) + ' ';
  return s + ' '.repeat(n - s.length);
}

function payloadPreview(p) {
  if (!p) return '';
  if (typeof p === 'string') {
    try { p = JSON.parse(p); } catch { return p.slice(0, 60); }
  }
  if (typeof p.cmd === 'string') return '$ ' + truncate(p.cmd, 60);
  if (typeof p.command === 'string') return '$ ' + truncate(p.command, 60);
  if (typeof p.file_path === 'string') return truncate(p.file_path, 60);
  if (typeof p.path === 'string') return truncate(p.path, 60);
  return truncate(JSON.stringify(p), 60);
}

function truncate(s, n) {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
