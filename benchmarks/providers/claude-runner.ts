/**
 * Shared helper: wraps `claude --print` invocations for both providers.
 * Extracted from the original runner.ts.
 */

import { execFile } from 'node:child_process';

interface ClaudeJsonOutput {
  result: string;
  session_id?: string;
  cost_usd?: number;
  total_cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  num_turns?: number;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export interface ClaudeResult {
  output: string;
  cost: number;
  tokenUsage: {
    total: number;
    prompt: number;
    completion: number;
  };
}

export function runClaude(
  args: string[],
  env: Record<string, string>,
  cwd: string,
  timeoutMs: number = 120_000,
): Promise<{ stdout: string; stderr: string; durationMs: number }> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const proc = execFile(
      'claude',
      args,
      {
        env: { ...process.env, ...env },
        cwd,
        maxBuffer: 10 * 1024 * 1024,
        timeout: timeoutMs,
      },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - start;
        if (error && !stdout) {
          reject(
            new Error(
              `claude exited with error: ${error.message}\nstderr: ${stderr}`,
            ),
          );
          return;
        }
        resolve({ stdout, stderr, durationMs });
      },
    );

    // Close stdin so claude --print doesn't wait for piped input
    proc.stdin?.end();

    // Safety: kill if timeout fires before execFile's timeout
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
    }, timeoutMs + 5000);
    proc.on('exit', () => clearTimeout(timer));
  });
}

export function parseClaudeOutput(stdout: string): ClaudeResult {
  try {
    const parsed = JSON.parse(stdout) as ClaudeJsonOutput;
    const usage = parsed.usage;
    return {
      output: parsed.result ?? '',
      cost: parsed.total_cost_usd ?? parsed.cost_usd ?? 0,
      tokenUsage: {
        total: (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0),
        prompt: usage?.input_tokens ?? 0,
        completion: usage?.output_tokens ?? 0,
      },
    };
  } catch {
    return {
      output: stdout,
      cost: 0,
      tokenUsage: { total: 0, prompt: 0, completion: 0 },
    };
  }
}
