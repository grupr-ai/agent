// `grupr agent allow <tool-pattern>` — V10.18. Creates a device-scoped
// allowlist rule via POST /api/agent-allowlists/self (device-authed).
//
// Future approvals matching the pattern auto-approve without UI noise.
// Destructive-tier requests STILL require explicit human approval —
// the api refuses to allow-list destructive tools regardless of rule.
//
// Pattern uses glob syntax (* wildcards). Examples:
//   grupr agent allow Bash:npm-install     # exact match
//   grupr agent allow Bash:npm*            # any npm command
//   grupr agent allow Read                 # any Read tool call (already auto-low though)
import { apiPost, deviceAuth } from './api.js';
import { requireCredentials } from './credentials.js';

export async function runAllow(args) {
  const pattern = (args[0] || '').trim();
  if (!pattern) {
    process.stderr.write(
      'Usage: grupr agent allow <tool-pattern>\n' +
      '\n' +
      'Creates a device-scoped allowlist rule. Future matching requests\n' +
      'auto-approve without UI noise. Glob wildcards (* and ?) supported.\n' +
      '\n' +
      'Examples:\n' +
      '  grupr agent allow Bash:npm-install\n' +
      '  grupr agent allow Bash:npm*\n' +
      '  grupr agent allow Read\n' +
      '\n' +
      'Destructive-tier ops are NEVER auto-approved regardless of rules.\n',
    );
    return 1;
  }
  const c = requireCredentials();
  try {
    const r = await apiPost(
      '/api/agent-allowlists/self',
      { tool_pattern: pattern },
      { headers: deviceAuth(c.device_id, c.device_token) },
    );
    process.stdout.write(`✓ Allowed: ${pattern} (scope: device)\n`);
    if (r?.rule?.id) {
      process.stdout.write(`  rule_id: ${r.rule.id}\n`);
    }
    process.stdout.write(`  Manage rules at https://app.grupr.ai/agents/allowlists\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`grupr: allow failed: ${err.message}\n`);
    return 1;
  }
}
