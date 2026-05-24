// `grupr agent continue [...args]` — wraps the Continue CLI.
// BETA: see _pty-shared.js for the architecture + caveats.
//
// Continue primarily lives as an IDE plugin; the CLI surface is newer
// and prompt formats are still in flux. We rely on the common y/N
// patterns; specific patterns can be added as we observe real prompts.
import { runPTYWrappedAgent, COMMON_PROMPT_PATTERNS } from './_pty-shared.js';

export async function runContinue(args) {
  return runPTYWrappedAgent({
    binary: 'continue',
    agentKind: 'continue',
    sessionPrefix: 'cn-',
    patterns: COMMON_PROMPT_PATTERNS,
    args,
    betaCopy: 'grupr: continue wrap (BETA) — approvals routing through Grupr Remote Control.',
  });
}
