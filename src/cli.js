// Argv router. Subcommands are tiny — each is one file in src/ that
// exports a `run(args)` async function.
import { runPair } from './pair.js';
import { runStatus } from './status.js';
import { runLogout } from './logout.js';
import { runTest } from './test.js';
import { runRevoke } from './revoke.js';
import { runAllow } from './allow.js';
import { runHistory } from './history.js';
import { runClaude } from './wrappers/claude.js';
import { runCodex } from './wrappers/codex.js';
import { runAider } from './wrappers/aider.js';
import { runContinue } from './wrappers/continue.js';
import { runCursor } from './wrappers/cursor.js';
import { checkForUpdate, flushUpdateCheck } from './version-check.js';

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
  codex [...args]       Wrap OpenAI Codex CLI (BETA, needs node-pty)
  aider [...args]       Wrap Aider CLI (BETA, needs node-pty)
  continue [...args]    Wrap Continue CLI (BETA, needs node-pty)
  cursor [...args]      Wrap Cursor's cursor-agent CLI (BETA, needs node-pty)
  revoke                Self-revoke THIS device (server + local creds). Use the
                        web for revoking other devices.
  allow <pattern>       Create a device-scoped allowlist rule. Future matching
                        requests auto-approve. Glob wildcards (*) supported.
                        Destructive ops are NEVER auto-approved.
  history [-n N]        Recent approvals from this device (default 20, max 200).
                        Color-coded status when stdout is a TTY.
  logout                Revoke this device's token + remove ~/.grupr/credentials

Notes:
  - The Claude Code wrapper uses the native --permission-prompt-tool
    MCP hook and works without node-pty.
  - All other wrappers (codex/aider/continue/cursor) PTY-wrap the
    binary and parse approval prompts from output. node-pty must be
    installed separately: \`npm install -g node-pty\`. Without it the
    wrap falls back to passthrough (no Grupr routing) with a warning.
  - Pass --no-grupr to any wrapper to bypass the wrap for one run.

Examples:
  grupr agent pair                       # one-time setup
  grupr agent claude                     # start a Grupr-wrapped Claude Code session
  grupr agent claude --resume            # resume the last session, still wrapped
  grupr agent claude --no-grupr          # one-shot bypass (during outages)
  grupr agent codex                      # Grupr-wrapped Codex (beta, needs node-pty)

Environment:
  GRUPR_API_BASE  Override the api base URL (default: https://api.grupr.ai)
  GRUPR_DEBUG     Print stack traces + MCP server diagnostics on stderr
`;

export async function main(argv) {
  // V9.5: fire-and-forget update check. Skip for wrapper subcommands
  // because they take over stdio (claude/codex/aider/continue/cursor)
  // and a deferred stderr write mid-session would be noisy. The check
  // runs for pair / status / test / logout / help where it can print
  // cleanly after the command exits.
  const peekedCmd = argv[0] === 'agent' ? argv[1] : argv[0];
  const isWrapper = ['claude', 'codex', 'aider', 'continue', 'cursor'].includes(peekedCmd);
  if (!isWrapper) checkForUpdate();

  // Two valid argv shapes:
  //   grupr <cmd>          → argv = [cmd, ...rest]
  //   grupr agent <cmd>    → argv = ['agent', cmd, ...rest]
  // We accept both for compatibility with how the design doc describes the UX.
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
    case 'codex':
      exit = await runCodex(args);
      break;
    case 'aider':
      exit = await runAider(args);
      break;
    case 'continue':
      exit = await runContinue(args);
      break;
    case 'cursor':
      exit = await runCursor(args);
      break;
    case 'logout':
      exit = await runLogout(args);
      break;
    case 'revoke':
      exit = await runRevoke(args);
      break;
    case 'allow':
      exit = await runAllow(args);
      break;
    case 'history':
      exit = await runHistory(args);
      break;
    default:
      process.stderr.write(`Unknown command: ${cmd}\n${USAGE}`);
      exit = 1;
      break;
  }
  // Settle any in-flight background update check so its stderr notice prints
  // and no undici fetch from the version check is still mid-flight at exit.
  await flushUpdateCheck();
  const finalCode = typeof exit === 'number' ? exit : 0;
  if (isWrapper) {
    // Wrappers PTY-wrap a binary (node-pty) and need a hard process.exit so
    // the native handle is torn down and the shell returns promptly with the
    // wrapped process's exit code. Pre-existing, verified-working path.
    process.exit(finalCode);
  }
  // Non-wrapper commands: set the exit code and let the event loop drain
  // naturally instead of calling process.exit(). A short command that just
  // did a fetch() still has undici's keep-alive socket in the pool;
  // process.exit() tears it down mid-flight and crashes libuv on Windows
  // ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)", src\win\async.c).
  // Natural drain (undici unrefs idle sockets) closes it cleanly — exactly
  // what the already-working status/test commands do on their code-0 path.
  process.exitCode = finalCode;
  return finalCode;
}
