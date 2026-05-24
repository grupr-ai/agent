// Manages ~/.grupr/credentials — a small JSON file with the paired
// device id + token. chmod 0600 so other users on the machine can't
// read it. On Windows the perms are best-effort (filesystem may not
// honor POSIX bits) — same as how ~/.ssh keys are handled.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DIR = path.join(os.homedir(), '.grupr');
const FILE = path.join(DIR, 'credentials');

export function credentialsPath() {
  return FILE;
}

export function load() {
  if (!fs.existsSync(FILE)) return null;
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed?.device_id || !parsed?.device_token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function save({ device_id, device_token, device_name, api_base }) {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const data = {
    device_id,
    device_token,
    device_name: device_name || 'Unnamed device',
    api_base: api_base || process.env.GRUPR_API_BASE || 'https://api.grupr.ai',
    paired_at: new Date().toISOString(),
  };
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  // chmod again in case the file already existed with looser perms.
  try { fs.chmodSync(FILE, 0o600); } catch {}
}

export function clear() {
  try { fs.unlinkSync(FILE); } catch {}
}

// requireCredentials throws a friendly error if not paired.
export function requireCredentials() {
  const c = load();
  if (!c) {
    const err = new Error(`No credentials found at ${FILE}. Run "grupr agent pair" first.`);
    err.code = 'not_paired';
    throw err;
  }
  return c;
}
