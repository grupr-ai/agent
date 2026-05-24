import { load, clear, credentialsPath } from './credentials.js';
import { apiFetch, deviceAuth } from './api.js';

export async function runLogout(_args) {
  const c = load();
  if (!c) {
    process.stdout.write('Not paired — nothing to do.\n');
    return;
  }
  process.stdout.write(`Revoking device "${c.device_name}" (${c.device_id})…\n`);
  // Best-effort server-side revoke. If it fails (offline, token already
  // revoked, etc.), we still clear the local credentials.
  try {
    // The user-side revoke endpoint requires JWT auth — not what we
    // have here. v1.1 will add a device-self-revoke endpoint. For now
    // we just clear local credentials; the server-side row stays
    // active until the user revokes from the web/mobile UI.
    void apiFetch; void deviceAuth; // unused in v1
  } catch (err) {
    process.stderr.write(`! Server-side revoke failed (continuing): ${err.message}\n`);
  }
  clear();
  process.stdout.write(`✓ Local credentials removed from ${credentialsPath()}\n`);
  process.stdout.write('  Visit https://app.grupr.ai/agents/devices to fully revoke server-side.\n');
}
