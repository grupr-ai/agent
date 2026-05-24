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
  pair                  Pair this machine to your Grupr account (one-time)
  status                Show paired device info + recent approvals
  test                  Send a synthetic approval to verify the round-trip
  claude [...args]      Wrap a Claude Code invocation so every permission
                        prompt routes through Grupr (phone, web, inline).
                        All args after \`claude\` are passed through.
                        Pass --no-grupr to bypass the wrap for one run.
  logout                Revoke this device's token + remove ~/.grupr/credentials

Examples:
  grupr agent pair                       # one-time setup
  grupr agent claude                     # start a Grupr-wrapped Claude Code session
  grupr agent claude --resume            # resume the last session, still wrapped
  grupr agent claude --no-grupr          # one-shot bypass (during outages)

Environment:
  GRUPR_API_BASE  Override the api base URL (default: https://api.grupr.ai)
  GRUPR_DEBUG     Print stack traces + MCP server diagnostics on stderr
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
  // Subcommands optionally return a number (exit code). Default to 0
  // when they return undefined. Wrappers like \`claude\` return the
  // wrapped process's exit code so CI pipelines stay honest.
  let exit;
  switch (cmd) {
    case 'pair':
      exit = await runPair(args);
      break;
    case 'status':
      exit = await runStatus(args);
      break;
    case 'test':
      exit = await runTest(args);
      break;
    case 'claude':
      exit = await runClaude(args);
      break;
    case 'logout':
      exit = await runLogout(args);
      break;
    default:
      process.stderr.write(`Unknown command: ${cmd}\n${USAGE}`);
      return 1;
  }
  return typeof exit === 'number' ? exit : 0;
}
