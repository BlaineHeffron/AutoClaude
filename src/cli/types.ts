/**
 * Hook input contract - the JSON payload that Claude Code hooks pass on stdin.
 *
 * Different hook events populate different subsets of fields:
 * - SessionStart: session_id, source
 * - PostToolUse: session_id, tool_name, tool_input, tool_output
 * - PreCompact/Stop/Notification: session_id, transcript_path, cwd
 */
export interface HookInput {
  session_id: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string; // PostToolUse only
  tool_input?: unknown; // PostToolUse only
  tool_output?: unknown; // PostToolUse only
  source?: 'startup' | 'resume' | 'compact' | 'clear'; // SessionStart source
}

/**
 * Hook output contract - the JSON payload that handlers return to Claude Code.
 *
 * `continue` must always be true so hooks never block Claude.
 * `hookSpecificOutput` provides optional context injection back into the session.
 */
export interface HookOutput {
  continue: boolean;
  hookSpecificOutput?: {
    hookEventName?: string;
    additionalContext?: string;
    systemMessage?: string;
  };
}
