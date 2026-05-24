// `grupr agent aider [...args]` — wraps the Aider CLI.
// BETA: see _pty-shared.js for the architecture + caveats.
//
// Aider uses its own "Apply these changes?" / "Run shell command?"
// prompts. The patterns below match Aider's prompt format as of v0.x.
// Update as the CLI evolves.
import { runPTYWrappedAgent, COMMON_PROMPT_PATTERNS } from './_pty-shared.js';

const AIDER_PATTERNS = [
  {
    label: 'shell',
    regex: /Run shell command(?:\?)?[^:]*:\s*(.+?)\s*\[y\/N\]/i,
    extract: (m) => ({
      tool_name: 'Bash',
      request_payload: { cmd: m[1].trim() },
    }),
  },
  {
    label: 'changes',
    regex: /Apply (?:these )?(?:changes|edits|patches)(?: to)?\s*(.{0,160}?)\s*\[y\/N\]/i,
    extract: (m) => ({
      tool_name: 'Edit',
      request_payload: { file_path: (m[1] || '').trim() || '(multiple files)' },
    }),
  },
  ...COMMON_PROMPT_PATTERNS,
];

export async function runAider(args) {
  return runPTYWrappedAgent({
    binary: 'aider',
    agentKind: 'aider',
    sessionPrefix: 'ai-',
    patterns: AIDER_PATTERNS,
    args,
    betaCopy: 'grupr: aider wrap (BETA) — approvals routing through Grupr Remote Control.',
  });
}
