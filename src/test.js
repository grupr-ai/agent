// `grupr agent test` — sends a synthetic approval through the full
// pipeline so the user can verify pairing + push + decision round-trip
// works before wiring up a real coding-agent wrapper.
//
// Flow:
//   1. POST /api/agent-approvals (device-authed) with a fake tool call
//   2. If auto_approved (allowlist match) → print + exit
//   3. Else long-poll GET /api/agent-approvals/:id/wait
//   4. Print the decision when it lands
import crypto from 'node:crypto';
import { apiPost, apiGet, deviceAuth } from './api.js';
import { requireCredentials } from './credentials.js';

export async function runTest(_args) {
  const c = requireCredentials();
  const auth = deviceAuth(c.device_id, c.device_token);

  const sessionId = 'test-session-' + crypto.randomBytes(4).toString('hex');
  process.stdout.write('Sending synthetic approval request to Grupr…\n');

  const created = await apiPost('/api/agent-approvals', {
    agent_session_id: sessionId,
    agent_kind: 'generic',
    tool_name: 'Bash',
    request_payload: {
      cmd: 'echo "hello from grupr agent test"',
    },
  }, { headers: auth });

  if (created.auto_approved) {
    process.stdout.write(`✓ Auto-approved by allowlist rule (${created.allowlist_rule?.tool_pattern})\n`);
    return;
  }

  const approvalId = created.approval?.id;
  if (!approvalId) {
    throw new Error('api did not return an approval_id');
  }
  const timeoutAt = created.approval?.timeout_at;
  process.stdout.write(`✓ Approval created: ${approvalId}\n`);
  process.stdout.write(`  risk_tier: ${created.approval?.risk_tier}\n`);
  if (timeoutAt) {
    process.stdout.write(`  times out at: ${timeoutAt}\n`);
  }
  process.stdout.write('\n');
  process.stdout.write('Open https://app.grupr.ai/agents to approve or deny.\n');
  process.stdout.write('Waiting for your decision…\n');

  // Long-poll. Server returns whenever status flips out of pending OR
  // after 90s. We loop in case the user takes longer.
  while (true) {
    let r;
    try {
      r = await apiGet(`/api/agent-approvals/${approvalId}/wait`, {
        headers: auth,
        timeoutMs: 100_000,
      });
    } catch (e) {
      // The long-poll can be cut by an intermediary (Cloudflare ~100s idle
      // timeout / 520, a dropped connection, a client-side fetch timeout)
      // while the approval is still pending server-side. Reconnect and
      // keep waiting rather than aborting — the decision isn't lost.
      process.stdout.write('~');
      await new Promise((res) => setTimeout(res, 2000));
      continue;
    }
    const a = r.approval;
    if (a.status === 'pending') {
      process.stdout.write('.');
      continue;
    }
    process.stdout.write('\n');
    process.stdout.write(`→ Decision: ${a.status.toUpperCase()}\n`);
    if (a.decision) {
      try {
        const d = typeof a.decision === 'string' ? JSON.parse(a.decision) : a.decision;
        if (d.surface) process.stdout.write(`  surface: ${d.surface}\n`);
        if (d.decided_at) process.stdout.write(`  at:      ${d.decided_at}\n`);
      } catch {}
    }
    return;
  }
}
