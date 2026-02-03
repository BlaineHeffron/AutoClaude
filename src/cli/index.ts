/**
 * CLI entry point for autoclaude.
 *
 * This is the main router invoked by Claude Code hooks. It:
 * 1. Reads the command from process.argv[2]
 * 2. Reads stdin (hooks pass JSON on stdin)
 * 3. Routes to the appropriate handler module
 * 4. Outputs the handler result as JSON to stdout
 *
 * On any error, outputs {"continue": true} so hooks never block Claude.
 */

import { logger } from '../util/logger';
import type { LogLevel } from '../util/logger';
import { getConfig } from '../util/config';
import { closeDb } from '../core/db';
import type { HookInput, HookOutput } from './types';

export type { HookInput, HookOutput };

/** The safe fallback output - hooks must never block Claude. */
const SAFE_OUTPUT: HookOutput = { continue: true };

/**
 * Reads all of stdin into a string. Returns an empty string if stdin is a TTY
 * (i.e. no piped input) or if reading fails.
 */
function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    // If stdin is a TTY, there is no piped input to read.
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }

    const chunks: Buffer[] = [];

    process.stdin.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    process.stdin.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });

    process.stdin.on('error', () => {
      resolve('');
    });
  });
}

/**
 * Parses a raw stdin string as JSON into a HookInput.
 * Returns an empty object cast to HookInput if the string is empty or invalid.
 */
function parseHookInput(raw: string): HookInput {
  if (!raw.trim()) {
    return {} as HookInput;
  }

  try {
    return JSON.parse(raw) as HookInput;
  } catch {
    logger.warn(`Failed to parse stdin as JSON: ${raw.substring(0, 200)}`);
    return {} as HookInput;
  }
}

/**
 * Maps CLI command names to Claude Code hook event names.
 * Claude Code requires hookSpecificOutput to include hookEventName.
 */
const COMMAND_TO_EVENT: Record<string, string> = {
  'session-start': 'SessionStart',
  'user-prompt': 'UserPromptSubmit',
  'capture-action': 'PostToolUse',
  'pre-compact': 'PreCompact',
  'session-stop': 'Stop',
  'session-end': 'SessionEnd',
};

/**
 * Routes the command to the appropriate handler module and returns its result.
 */
async function routeCommand(
  command: string,
  input: HookInput,
): Promise<HookOutput> {
  switch (command) {
    case 'session-start': {
      const { handleSessionStart } = await import('./session-start');
      return handleSessionStart(input);
    }
    case 'capture-action': {
      const { captureAction } = await import('./capture-action');
      return captureAction(input);
    }
    case 'pre-compact': {
      const { handlePreCompact } = await import('./pre-compact');
      return handlePreCompact(input);
    }
    case 'session-stop': {
      const { handleSessionStop } = await import('./session-stop');
      return handleSessionStop(input);
    }
    case 'session-end': {
      const { handleSessionEnd } = await import('./session-end');
      return handleSessionEnd(input);
    }
    case 'query': {
      const queryText = process.argv[3] || '';
      const { handleQuery } = await import('./query');
      return handleQuery(input, queryText);
    }
    case 'user-prompt': {
      const { handleUserPrompt } = await import('./user-prompt');
      return handleUserPrompt(input);
    }
    case 'stats': {
      const { handleStats } = await import('./stats');
      return handleStats(input);
    }
    case 'gc': {
      const { handleGc } = await import('./gc');
      return handleGc(input);
    }
    case 'export': {
      const { handleExport } = await import('./export');
      return handleExport(input);
    }
    case 'backup': {
      const { handleBackup } = await import('./backup');
      return handleBackup(input);
    }
    default:
      logger.warn(`Unknown command: ${command}`);
      return SAFE_OUTPUT;
  }
}

/**
 * Returns true when running inside a Zeroshot multi-agent session.
 * Zeroshot sets ZEROSHOT_BLOCK_ASK_USER=1 for every spawned agent.
 * We skip all hook logic to avoid polluting the memory DB with
 * ephemeral agent sessions and to preserve blind validation integrity.
 */
function isZeroshotAgent(): boolean {
  return process.env.ZEROSHOT_BLOCK_ASK_USER === '1';
}

/**
 * Main entry point. Reads config, sets up logging, reads stdin,
 * routes the command, and outputs the result as JSON.
 */
async function main(): Promise<void> {
  let output: HookOutput = SAFE_OUTPUT;

  try {
    // Skip all hook logic inside Zeroshot multi-agent sessions
    if (isZeroshotAgent()) {
      return;
    }

    // Load configuration and apply log level
    const config = getConfig();
    logger.setLevel(config.logging.level as LogLevel);

    if (config.logging.file) {
      logger.setLogFile(config.logging.file);
    }

    const command = process.argv[2];

    if (!command) {
      logger.warn('No command provided to autoclaude CLI');
      return;
    }

    logger.debug(`CLI invoked with command: ${command}`);

    // Read and parse stdin
    const raw = await readStdin();
    const input = parseHookInput(raw);

    if (input.session_id) {
      logger.debug(
        `Session: ${input.session_id}, event: ${input.hook_event_name || 'n/a'}`,
      );
    }

    // Route to handler
    output = await routeCommand(command, input);

    // Inject hookEventName into hookSpecificOutput (required by Claude Code)
    const eventName = COMMAND_TO_EVENT[command];
    if (eventName && output.hookSpecificOutput) {
      output.hookSpecificOutput.hookEventName = eventName;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      `CLI error (command=${process.argv[2] || 'none'}): ${message}`,
    );
    output = SAFE_OUTPUT;
  } finally {
    // Always output valid JSON so hooks never block Claude
    process.stdout.write(JSON.stringify(output) + '\n');

    // Clean up database connection
    closeDb();
  }
}

main();
