// `grupr agent status` — paired-device info + recent approvals.
//
// W6.3: extended to fetch the user's pending approvals via the api so a
// developer at the shell can see "what's waiting on my phone right now"
// without opening the dashboard. --history flag (TODO: needs a backend
// list-all-statuses endpoint) is a v1.1 follow-up; for v1 we just show
// pending.
import { credentialsPath, load } from './credentials.js';
import { apiGet, deviceAuth } from './api.js';

export async function runStatus(args) {
  const c = load();
  if (!c) {
    process.stdout.write(`Not paired. Run "grupr agent pair" to set up.\n`);
    process.stdout.write(`Credentials path: ${credentialsPath()}\n`);
    return;
  }
  process.stdout.write(`✓ Paired\n`);
  process.stdout.write(`  device_name: ${c.device_name}\n`);
  process.stdout.write(`  device_id:   ${c.device_id}\n`);
  process.stdout.write(`  api_base:    ${c.api_base}\n`);
  process.stdout.write(`  paired_at:   ${c.paired_at}\n`);
  process.stdout.write(`  credentials: ${credentialsPath()}\n`);

  if (args.includes('--quiet')) return;

  // Fetch pending approvals. Best-effort — if the api is unreachable
  // we surface the failure without crashing the status command.
  process.stdout.write('\nPending approvals\n');
  process.stdout.write('─────────────────\n');
  try {
    // Use the device-authed for-device endpoint (CLI doesn't have a JWT).
    // Returns the same shape as the JWT-authed list endpoint.
    const r = await apiGet('/api/agent-approvals/for-device', {
      headers: deviceAuth(c.device_id, c.device_token),
      timeoutMs: 8_000,
    });
    const approvals = r?.approvals ?? [];
    if (approvals.length === 0) {
      process.stdout.write('  (none)\n');
      return;
    }
    // Sort newest first; show up to 10.
    const sorted = [...approvals].sort(
      (a, b) => new Date(b.requested_at).getTime() - new Date(a.requested_at).getTime(),
    );
    const visible = sorted.slice(0, 10);
    for (const a of visible) {
      const age = relativeTime(a.requested_at);
      const tier = (a.risk_tier || 'medium').toUpperCase().padEnd(11);
      const tool = (a.tool_name || 'Unknown').padEnd(14);
      const preview = payloadPreview(a.request_payload);
      process.stdout.write(`  ${tier} ${tool} ${age.padStart(8)}  ${preview}\n`);
    }
    const extra = sorted.length - visible.length;
    if (extra > 0) {
      process.stdout.write(`  …and ${extra} more.\n`);
    }
    process.stdout.write(
      '\n  Approve/deny from: phone (Grupr app), web (app.grupr.ai/agents/approvals),\n' +
      '  or inline within an active Code Review grupr.\n',
    );
  } catch (err) {
    if (err?.code === 'http_401' || err?.status === 401) {
      process.stdout.write('  ⚠ device token rejected — re-pair with `grupr agent pair`.\n');
    } else {
      process.stdout.write(`  ⚠ could not reach Grupr (${err?.message || err}).\n`);
    }
  }
}

function payloadPreview(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (typeof payload.cmd === 'string') return truncate('$ ' + payload.cmd, 60);
  if (typeof payload.command === 'string') return truncate('$ ' + payload.command, 60);
  if (typeof payload.file_path === 'string') return truncate(payload.file_path, 60);
  if (typeof payload.path === 'string') return truncate(payload.path, 60);
  return '';
}

function truncate(s, max) {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function relativeTime(iso) {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const ago = Math.max(0, now - then);
  if (ago < 60_000) return 'just now';
  if (ago < 3_600_000) return `${Math.floor(ago / 60_000)}m ago`;
  if (ago < 86_400_000) return `${Math.floor(ago / 3_600_000)}h ago`;
  return `${Math.floor(ago / 86_400_000)}d ago`;
}
