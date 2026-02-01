import type { HookInput, HookOutput } from "./types";
import { insertAction } from "../core/memory";
import { logger } from "../util/logger";

// ---------------------------------------------------------------------------
// Tool-name to action-type classification
// ---------------------------------------------------------------------------

function classifyAction(
  toolName: string,
  toolInput: Record<string, unknown> | undefined,
): { actionType: string; filePath: string | null } {
  const input = toolInput ?? {};

  switch (toolName) {
    case "Edit":
      return {
        actionType: "edit",
        filePath: (input.file_path as string) ?? null,
      };

    case "Write":
      return {
        actionType: "create",
        filePath: (input.file_path as string) ?? null,
      };

    case "Bash": {
      const command = String(input.command ?? "");
      if (/\b(npm\s+test|jest|pytest|vitest|mocha)\b/.test(command)) {
        return { actionType: "test", filePath: null };
      }
      if (/\b(npm\s+run\s+build|make|tsc|esbuild)\b/.test(command)) {
        return { actionType: "build", filePath: null };
      }
      if (/\bgit\s+commit\b/.test(command)) {
        return { actionType: "commit", filePath: null };
      }
      return { actionType: "other", filePath: null };
    }

    default:
      return { actionType: "other", filePath: null };
  }
}

// ---------------------------------------------------------------------------
// Outcome detection
// ---------------------------------------------------------------------------

function determineOutcome(
  toolOutput: unknown,
): { outcome: string; errorMessage: string | null } {
  const outputStr = typeof toolOutput === "string"
    ? toolOutput
    : JSON.stringify(toolOutput ?? "");

  // Look for common error indicators in the output
  if (/\b[Ee]rror\b/.test(outputStr) || /\bERROR\b/.test(outputStr)) {
    return { outcome: "failure", errorMessage: outputStr.slice(0, 500) };
  }

  return { outcome: "success", errorMessage: null };
}

// ---------------------------------------------------------------------------
// Handler: PostToolUse
// ---------------------------------------------------------------------------

export async function captureAction(input: HookInput): Promise<HookOutput> {
  try {
    const toolName = input.tool_name ?? "unknown";
    const { actionType, filePath } = classifyAction(toolName, input.tool_input);
    const { outcome, errorMessage } = determineOutcome(input.tool_output);

    const description =
      actionType !== "other"
        ? `${actionType}: ${filePath ?? toolName}`
        : `${toolName} invocation`;

    insertAction({
      session_id: input.session_id,
      tool_name: toolName,
      file_path: filePath,
      action_type: actionType,
      description,
      outcome,
      error_message: errorMessage,
    });

    logger.debug(
      `[capture-action] Recorded ${actionType} (${outcome}) for session ${input.session_id}`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[capture-action] ${msg}`);
  }

  return { continue: true };
}
