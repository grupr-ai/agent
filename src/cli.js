// Argv router. Subcommands are tiny — each is one file in src/ that
// exports a `run(args)` async function.
import { runPair } from './pair.js';
import { runStatus } from './status.js';
import { runLogout } from './logout.js';
import { runTest } from './test.js';
import { runClaude } from './wrappers/claude.js';

const USAGE = `
@grupr/agent — Remote Control for AI coding agents

Usage:
  grupr agent <command> [...args]

Commands:
  pair            Pair this machine to your Grupr account (one-time)
  status          Show paired device info + recent approvals
  test            Send a synthetic approval to verify the round-trip
  claude [...]    Wrap a Claude Code invocation so prompts route to Grupr
  logout          Revoke this device's token + remove ~/.grupr/credentials

Environment:
  GRUPR_API_BASE  Override the api base URL (default: https://api.grupr.ai)
  GRUPR_DEBUG     Print stack traces on error
`;

export async function main(argv) {
  // Two valid argv shapes:
  //   grupr <cmd>          → argv = [cmd, ...rest]
  //   grupr agent <cmd>    → argv = ['agent', cmd, ...rest]
  // We accept both for compatibility with how Bret typed it in the design doc.
  let args = argv.slice();
  if (args[0] === 'agent') args.shift();

  const cmd = args.shift();
  if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
    process.stdout.write(USAGE);
    return;
  }
  switch (cmd) {
    case 'pair':
      return runPair(args);
    case 'status':
      return runStatus(args);
    case 'test':
      return runTest(args);
    case 'claude':
      return runClaude(args);
    case 'logout':
      return runLogout(args);
    default:
      process.stderr.write(`Unknown command: ${cmd}\n${USAGE}`);
      process.exit(1);
  }
}
