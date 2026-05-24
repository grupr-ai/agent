import { credentialsPath, load } from './credentials.js';

export async function runStatus(_args) {
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
}
