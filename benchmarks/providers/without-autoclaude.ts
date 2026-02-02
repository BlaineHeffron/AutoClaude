/**
 * Promptfoo custom provider: without-autoclaude.
 * Vanilla Claude Code with no plugin context.
 */

import type {
  ApiProvider,
  ProviderOptions,
  ProviderResponse,
  CallApiContextParams,
} from 'promptfoo';
import { runClaude, parseClaudeOutput } from './claude-runner';

declare const global: {
  __benchProjectDir?: string;
};

export default class WithoutAutoClaudeProvider implements ApiProvider {
  protected providerId: string;
  public config: Record<string, unknown>;

  constructor(options: ProviderOptions) {
    this.providerId = options.id || 'without-autoclaude';
    this.config = options.config || {};
  }

  id(): string {
    return this.providerId;
  }

  async callApi(
    prompt: string,
    _context?: CallApiContextParams,
  ): Promise<ProviderResponse> {
    const projectDir = global.__benchProjectDir || process.cwd();

    const args = [
      '--print',
      '--setting-sources',
      '',
      '--model',
      (this.config.model as string) || 'sonnet',
      '--no-session-persistence',
      '--max-budget-usd',
      String(this.config.maxBudgetUsd || 0.15),
      '--output-format',
      'json',
      prompt,
    ];

    try {
      const { stdout } = await runClaude(args, {}, projectDir);
      const result = parseClaudeOutput(stdout);
      return {
        output: result.output,
        cost: result.cost,
        tokenUsage: result.tokenUsage,
      };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
