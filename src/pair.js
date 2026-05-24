// Pairing flow — the TV-style code dance.
//
//   1. POST /api/agent-devices/pair-start  → returns {session_id, code}
//   2. Print the code + a URL the user opens on phone/web
//   3. Long-poll GET /api/agent-devices/pair-poll/:session_id
//      until status="confirmed", then save credentials.
//
// No JWT auth on either step — the session_id IS the secret for the
// poll, and the code is the secret for the user-side confirm.
import readline from 'node:readline';
import os from 'node:os';
import { apiPost, apiGet, apiBase } from './api.js';
import { save, load } from './credentials.js';

export async function runPair(_args) {
  const existing = load();
  if (existing) {
    process.stdout.write(`! Already paired as "${existing.device_name}" (device_id=${existing.device_id})\n`);
    const answer = await prompt('  Re-pair anyway? [y/N]: ');
    if (!/^y(es)?$/i.test(answer.trim())) {
      process.stdout.write('Aborted.\n');
      return;
    }
  }

  process.stdout.write('Starting pairing…\n');
  const session = await apiPost('/api/agent-devices/pair-start', {});
  // session shape: { session_id, code, expires_at }

  const webBase = (apiBase().replace(/^https?:\/\/api\./, 'https://app.')
                            .replace(/^https?:\/\/api/,    'https://app'));
  const confirmURL = `${webBase}/agents/pair?code=${encodeURIComponent(session.code)}`;

  process.stdout.write('\n');
  process.stdout.write('  ╭───────────────────────────────────────────────────╮\n');
  process.stdout.write(`  │   Pairing code:  ${pad(session.code, 32)} │\n`);
  process.stdout.write('  │                                                   │\n');
  process.stdout.write(`  │   On your phone or laptop, open:                  │\n`);
  process.stdout.write(`  │   ${pad(confirmURL, 47)} │\n`);
  process.stdout.write('  │                                                   │\n');
  process.stdout.write(`  │   Or enter the code at app.grupr.ai/agents/pair   │\n`);
  process.stdout.write('  ╰───────────────────────────────────────────────────╯\n');
  process.stdout.write('\n');
  process.stdout.write('Waiting for confirmation… (up to 10 min, Ctrl+C to abort)\n');

  // Loop: long-poll the api up to 15s per call; api returns
  // status=pending if no decision yet, confirmed when the user clicks,
  // expired if the session timed out.
  const startedAt = Date.now();
  const overallTimeoutMs = 10 * 60 * 1000;
  let lastDot = Date.now();
  while (true) {
    if (Date.now() - startedAt > overallTimeoutMs) {
      throw new Error('Pairing timed out after 10 minutes. Run `grupr agent pair` again.');
    }
    const poll = await apiGet(`/api/agent-devices/pair-poll/${session.session_id}`, { timeoutMs: 20_000 });
    if (poll.status === 'expired') {
      throw new Error('Pairing session expired. Run `grupr agent pair` again to get a fresh code.');
    }
    if (poll.status === 'confirmed') {
      if (!poll.device_token) {
        throw new Error('Pairing completed but no token was returned. Re-pair and try again.');
      }
      save({
        device_id: poll.device_id,
        device_token: poll.device_token,
        device_name: defaultDeviceName(),
        api_base: apiBase(),
      });
      process.stdout.write('\n');
      process.stdout.write(`✓ Paired as ${defaultDeviceName()}!\n`);
      process.stdout.write(`  device_id: ${poll.device_id}\n`);
      process.stdout.write(`  credentials saved to ~/.grupr/credentials (chmod 0600)\n`);
      process.stdout.write('\n');
      process.stdout.write('Next steps:\n');
      process.stdout.write('  grupr agent test     # send a synthetic approval to verify\n');
      process.stdout.write('  grupr agent claude   # wrap Claude Code so prompts route to Grupr\n');
      return;
    }
    // pending — print a dot every few seconds so the user knows we're alive
    if (Date.now() - lastDot > 3000) {
      process.stdout.write('.');
      lastDot = Date.now();
    }
  }
}

function defaultDeviceName() {
  return os.hostname() || 'Unnamed device';
}

function pad(s, w) {
  if (s.length >= w) return s;
  return s + ' '.repeat(w - s.length);
}

function prompt(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(q, (a) => { rl.close(); resolve(a); }));
}
