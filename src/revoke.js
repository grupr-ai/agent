// `grupr agent revoke` — V10.18. Self-revokes the current device.
// Calls POST /api/agent-devices/self/revoke (device-authed in V10.18),
// then clears local credentials.
//
// No-arg form ONLY — revoking OTHER devices requires user JWT which
// the CLI doesn't have. Manage other devices at /agents/devices.
import readline from 'node:readline';
import { apiPost, deviceAuth } from './api.js';
import { credentialsPath, load, clear } from './credentials.js';

export async function runRevoke(args) {
  if (args[0] && !args.includes('--yes') && !args.includes('-y')) {
    process.stderr.write(
      'grupr: revoke takes no arguments (it revokes THIS device).\n' +
      '\n' +
      'To revoke a different device, use the web app:\n' +
      '  https://app.grupr.ai/agents/devices\n',
    );
    return 1;
  }
  const c = load();
  if (!c) {
    process.stdout.write(`Not paired. Nothing to revoke.\nCredentials path: ${credentialsPath()}\n`);
    return 0;
  }

  // Confirm unless --yes.
  if (!args.includes('--yes') && !args.includes('-y')) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ans = await new Promise((res) =>
      rl.question(`Revoke this device (${c.device_name})? [y/N] `, res),
    );
    rl.close();
    if (ans.trim().toLowerCase() !== 'y') {
      process.stdout.write('Aborted.\n');
      return 0;
    }
  }

  try {
    await apiPost('/api/agent-devices/self/revoke', null, {
      headers: deviceAuth(c.device_id, c.device_token),
    });
    clear();
    process.stdout.write(`✓ Device revoked + local credentials cleared.\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`grupr: revoke failed: ${err.message}\n`);
    return 1;
  }
}
