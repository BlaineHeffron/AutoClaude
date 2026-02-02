/**
 * Promptfoo custom provider: with-autoclaude.
 * Prepends injection context (set by the beforeAll hook) and calls `claude --print`.
 */

import type {
  ApiProvider,
  ProviderOptions,
  ProviderResponse,
  CallApiContextParams,
} from 'promptfoo';
import { runClaude, parseClaudeOutput } from './claude-runner';

declare const global: {
  __benchInjectionContext?: string;
  __benchProjectDir?: string;
  __benchDbPath?: string;
};

export default class WithAutoClaudeProvider implements ApiProvider {
  protected providerId: string;
  public config: Record<string, unknown>;

  constructor(options: ProviderOptions) {
    this.providerId = options.id || 'with-autoclaude';
    this.config = options.config || {};
  }

  id(): string {
    return this.providerId;
  }

  async callApi(
    prompt: string,
    _context?: CallApiContextParams,
  ): Promise<ProviderResponse> {
    const injectionContext = global.__benchInjectionContext || '';
    const projectDir = global.__benchProjectDir || process.cwd();
    const dbPath = global.__benchDbPath || '';

    const fullPrompt = injectionContext
      ? `<autoclaude-context>\n${injectionContext}\n</autoclaude-context>\n\n${prompt}`
      : prompt;

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
      fullPrompt,
    ];

    const env: Record<string, string> = {};
    if (dbPath) {
      env.AUTOCLAUDE_DB = dbPath;
    }

    try {
      const { stdout } = await runClaude(args, env, projectDir);
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
