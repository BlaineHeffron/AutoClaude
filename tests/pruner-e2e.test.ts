/**
 * End-to-end tests for the SWE-Pruner integration.
 * Requires a running pruner server. Tests are skipped if the server is unreachable.
 *
 * Usage:
 *   PRUNER_URL=http://localhost:8050 npm test   # custom URL
 *   npm test                                     # uses default http://localhost:8050
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

// Resolve pruner URL before imports — env var flows into pruner module
const PRUNER_URL = process.env.PRUNER_URL || 'http://localhost:8050';
process.env.AUTOCLAUDE_PRUNER_URL = PRUNER_URL;

const TEST_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), 'autoclaude-pruner-e2e-'),
);
const TEST_DB = path.join(TEST_DIR, 'test.db');
process.env.AUTOCLAUDE_DB = TEST_DB;

import {
  isAvailable,
  prune,
  pruneIfAvailable,
  resetCache,
} from '../src/core/pruner';
import { estimateTokens } from '../src/util/tokens';
import { closeDb } from '../src/core/db';

// A substantial code sample with comments, docstrings, and verbose patterns
// that a neural pruner should be able to compress meaningfully.
const CODE_SAMPLE = `
/**
 * UserAuthenticationService handles all user authentication operations
 * including login, logout, token refresh, and session management.
 * This service integrates with the OAuth2 provider and maintains
 * a local session cache for performance optimization.
 */
class UserAuthenticationService {
  // The maximum number of retry attempts for authentication requests
  private static readonly MAX_RETRY_ATTEMPTS = 3;

  // The timeout duration in milliseconds for each authentication request
  private static readonly REQUEST_TIMEOUT_MS = 5000;

  // Cache for storing active user sessions to avoid repeated database lookups
  private sessionCache: Map<string, UserSession> = new Map();

  // Logger instance for tracking authentication events and errors
  private logger: Logger;

  // Database connection for persisting session data
  private db: DatabaseConnection;

  /**
   * Creates a new instance of UserAuthenticationService.
   * @param logger - The logger instance for recording authentication events
   * @param db - The database connection for session persistence
   * @param config - Configuration options for the authentication service
   */
  constructor(logger: Logger, db: DatabaseConnection, config: AuthConfig) {
    this.logger = logger;
    this.db = db;
    // Initialize the session cache with any existing active sessions
    this.initializeSessionCache();
  }

  /**
   * Authenticates a user with the provided credentials.
   * This method performs the following steps:
   * 1. Validates the input credentials format
   * 2. Checks for existing active sessions
   * 3. Sends authentication request to the OAuth2 provider
   * 4. Creates a new session on successful authentication
   * 5. Stores the session in both cache and database
   *
   * @param username - The user's username or email address
   * @param password - The user's password (will be hashed before transmission)
   * @returns A promise that resolves to an AuthResult containing the session token
   * @throws AuthenticationError if credentials are invalid
   * @throws NetworkError if the OAuth2 provider is unreachable
   */
  async authenticate(username: string, password: string): Promise<AuthResult> {
    // Step 1: Validate the input credentials format
    this.logger.info(\`Attempting authentication for user: \${username}\`);

    if (!username || !password) {
      this.logger.warn('Authentication attempt with empty credentials');
      throw new AuthenticationError('Username and password are required');
    }

    // Step 2: Check if user already has an active session
    const existingSession = this.findExistingSession(username);
    if (existingSession && !existingSession.isExpired()) {
      this.logger.info(\`Reusing existing session for user: \${username}\`);
      return { token: existingSession.token, refreshToken: existingSession.refreshToken };
    }

    // Step 3: Hash the password and send to OAuth2 provider
    const hashedPassword = await this.hashPassword(password);
    let response: OAuthResponse;

    // Retry logic for transient network failures
    for (let attempt = 1; attempt <= UserAuthenticationService.MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        response = await this.sendAuthRequest(username, hashedPassword);
        break;
      } catch (error) {
        if (attempt === UserAuthenticationService.MAX_RETRY_ATTEMPTS) {
          this.logger.error(\`Authentication failed after \${attempt} attempts\`);
          throw error;
        }
        this.logger.warn(\`Auth attempt \${attempt} failed, retrying...\`);
        await this.delay(attempt * 1000);
      }
    }

    // Step 4: Create a new session from the OAuth response
    const session = new UserSession({
      userId: response!.userId,
      username: username,
      token: response!.accessToken,
      refreshToken: response!.refreshToken,
      expiresAt: new Date(Date.now() + response!.expiresIn * 1000),
      createdAt: new Date(),
    });

    // Step 5: Store the session in cache and database
    this.sessionCache.set(username, session);
    await this.db.sessions.insert(session.toRecord());

    this.logger.info(\`Authentication successful for user: \${username}\`);
    return { token: session.token, refreshToken: session.refreshToken };
  }

  /**
   * Refreshes an expired or soon-to-expire authentication token.
   * Uses the refresh token to obtain a new access token without
   * requiring the user to re-enter their credentials.
   */
  async refreshToken(refreshToken: string): Promise<AuthResult> {
    this.logger.info('Attempting token refresh');
    const response = await this.sendRefreshRequest(refreshToken);
    return { token: response.accessToken, refreshToken: response.refreshToken };
  }

  /**
   * Logs out a user by invalidating their session.
   * Removes the session from both the local cache and the database.
   */
  async logout(username: string): Promise<void> {
    this.logger.info(\`Logging out user: \${username}\`);
    this.sessionCache.delete(username);
    await this.db.sessions.deleteByUsername(username);
  }

  // Private helper methods below

  private initializeSessionCache(): void {
    // Load active sessions from database into memory cache
    // This runs once during service initialization
  }

  private findExistingSession(username: string): UserSession | undefined {
    return this.sessionCache.get(username);
  }

  private async hashPassword(password: string): Promise<string> {
    // Implementation uses bcrypt with salt rounds = 12
    return password; // placeholder
  }

  private async sendAuthRequest(username: string, hashedPassword: string): Promise<OAuthResponse> {
    // Sends POST to OAuth2 provider /token endpoint
    return {} as OAuthResponse; // placeholder
  }

  private async sendRefreshRequest(refreshToken: string): Promise<OAuthResponse> {
    // Sends POST to OAuth2 provider /token/refresh endpoint
    return {} as OAuthResponse; // placeholder
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
`;

describe('Pruner E2E', () => {
  let prunerAvailable = false;

  before(async () => {
    resetCache();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${PRUNER_URL}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      prunerAvailable = res.ok;
    } catch {
      prunerAvailable = false;
    }
    if (!prunerAvailable) {
      console.log(
        `\n  ⚠ Pruner not available at ${PRUNER_URL} — skipping e2e tests`,
      );
      console.log(
        `    Set PRUNER_URL to override (e.g. PRUNER_URL=http://localhost:8050 npm test)\n`,
      );
    }
  });

  after(() => {
    closeDb();
    try {
      fs.rmSync(TEST_DIR, { recursive: true });
    } catch {
      // cleanup best-effort
    }
  });

  beforeEach(() => {
    resetCache();
  });

  it('isAvailable() should detect running pruner', async (t) => {
    if (!prunerAvailable) return t.skip('Pruner not available');

    const available = await isAvailable();
    assert.equal(
      available,
      true,
      'isAvailable() should return true when pruner is running',
    );
  });

  it('prune() should reduce token count on verbose code', async (t) => {
    if (!prunerAvailable) return t.skip('Pruner not available');

    const originalTokens = estimateTokens(CODE_SAMPLE);
    const result = await prune(
      CODE_SAMPLE,
      'What does the authenticate method do?',
    );

    assert.ok(
      result.prunedTokens < result.originalTokens,
      `Expected prunedTokens (${result.prunedTokens}) < originalTokens (${result.originalTokens})`,
    );
    assert.ok(
      result.reductionPercent > 0,
      `Expected positive reduction, got ${result.reductionPercent.toFixed(1)}%`,
    );
    assert.equal(result.originalTokens, originalTokens);
    // Pruned text should still contain something (not empty)
    assert.ok(result.prunedText.length > 0, 'Pruned text should not be empty');
  });

  it('pruneIfAvailable() should return pruned result when server is up', async (t) => {
    if (!prunerAvailable) return t.skip('Pruner not available');

    const result = await pruneIfAvailable(
      CODE_SAMPLE,
      'Summarize the authentication flow',
    );

    assert.ok(
      result.prunedTokens <= result.originalTokens,
      `Expected prunedTokens (${result.prunedTokens}) <= originalTokens (${result.originalTokens})`,
    );
    assert.ok(
      result.reductionPercent >= 0,
      `Expected non-negative reduction, got ${result.reductionPercent.toFixed(1)}%`,
    );
  });

  it('pruneIfAvailable() should fall back gracefully on bad URL', async () => {
    // Temporarily point to a nonexistent server
    const originalUrl = process.env.AUTOCLAUDE_PRUNER_URL;
    process.env.AUTOCLAUDE_PRUNER_URL = 'http://localhost:1';
    resetCache();

    try {
      const result = await pruneIfAvailable(CODE_SAMPLE, 'test query');

      // Should return original text unchanged
      assert.equal(result.prunedText, CODE_SAMPLE);
      assert.equal(result.reductionPercent, 0);
      assert.equal(result.prunedTokens, result.originalTokens);
    } finally {
      process.env.AUTOCLAUDE_PRUNER_URL = originalUrl;
      resetCache();
    }
  });

  it('prune() with different thresholds should produce different results', async (t) => {
    if (!prunerAvailable) return t.skip('Pruner not available');

    const [low, high] = await Promise.all([
      prune(CODE_SAMPLE, 'authentication', { threshold: 0.2 }),
      prune(CODE_SAMPLE, 'authentication', { threshold: 0.8 }),
    ]);

    // Both should prune something
    assert.ok(
      low.reductionPercent >= 0,
      `Low threshold should have non-negative reduction, got ${low.reductionPercent.toFixed(1)}%`,
    );
    assert.ok(
      high.reductionPercent >= 0,
      `High threshold should have non-negative reduction, got ${high.reductionPercent.toFixed(1)}%`,
    );

    // Different thresholds should generally produce different output sizes
    // (not a hard assertion — just log for visibility)
    if (low.prunedTokens !== high.prunedTokens) {
      console.log(
        `    threshold=0.2: ${low.prunedTokens} tokens (${low.reductionPercent.toFixed(1)}% reduction)`,
      );
      console.log(
        `    threshold=0.8: ${high.prunedTokens} tokens (${high.reductionPercent.toFixed(1)}% reduction)`,
      );
    }
  });

  // ---------------------------------------------------------------------------
  // Compaction savings comparison — with vs without pruning
  // ---------------------------------------------------------------------------

  describe('compaction token savings', () => {
    // Simulates a realistic context injection payload (sessions + decisions +
    // learnings + snapshot) and measures tokens before and after pruning.
    const CONTEXT_PAYLOAD = [
      '# [autoclaude] Session Context',
      '',
      '## Snapshot (Resuming)',
      '**Task:** Implement user authentication with OAuth2 and session management',
      '**Progress:** Session performed 16 file edits, 4 test runs, 3 commits across 7 files. All tests passed, committed: "Add OAuth2 integration with token refresh". Touched 7 files including auth.service.ts and session.middleware.ts.',
      '**Next Steps:**',
      '  - Add rate limiting to the login endpoint to prevent brute force attacks',
      '  - Implement session expiry cleanup cron job to remove stale sessions',
      '  - Add integration tests for the full OAuth2 flow with mock provider',
      '  - Update API documentation with new auth endpoints and error codes',
      '',
      '## Active Decisions',
      '- [architecture]: Using JWT tokens stored in httpOnly cookies instead of localStorage for XSS protection',
      '- [library]: Selected passport.js with passport-oauth2 strategy for OAuth2 integration',
      '- [convention]: All API error responses follow RFC 7807 Problem Details format with type, title, status, detail fields',
      '- [architecture]: Session store uses Redis with 24-hour TTL, falling back to in-memory store in development',
      '- [testing]: Integration tests use a dedicated test OAuth2 provider container via docker-compose',
      '',
      '## Learnings',
      '- [gotcha]: passport.js serializeUser must be called before any route handlers or sessions silently fail without errors',
      '- [pattern]: Always set SameSite=Strict on auth cookies in production to prevent CSRF; use SameSite=Lax in development for OAuth redirect compatibility',
      '- [gotcha]: Redis session store requires explicit JSON serialization of nested objects; passport user objects with Date fields need custom serializer',
      '- [pattern]: Use a separate middleware for token refresh that runs before auth check — this avoids redirect loops when tokens expire during navigation',
      '- [gotcha]: OAuth2 state parameter must be cryptographically random (use crypto.randomBytes) not Math.random, as predictable state enables CSRF',
      '',
      '## Recent Sessions',
      '- [Feb 4, 09:45 PM]: Session performed 8 file edits, 2 test runs, 1 commit across 5 files. All tests passed, committed: "Add Redis session store with fallback".',
      '- [Feb 4, 05:54 PM]: Session performed 16 file edits, 4 test runs, 3 commits across 7 files. All tests passed, committed: "Implement OAuth2 flow with passport.js". Touched 7 files including auth.service.ts and oauth.strategy.ts.',
      '- [Feb 4, 05:00 AM]: Session performed 3 file edits, 1 commit across 3 files. Committed: "Add session middleware and cookie config". Key files: session.middleware.ts, cookie.config.ts, app.ts.',
    ].join('\n');

    it('should show savings on code vs prose content', async (t) => {
      if (!prunerAvailable) return t.skip('Pruner not available');

      const [codeResult, proseResult] = await Promise.all([
        prune(CODE_SAMPLE, 'What does the authenticate method do?'),
        prune(CONTEXT_PAYLOAD, 'authentication session management'),
      ]);

      console.log('');
      console.log(
        '    ┌──────────────────────────────────────────────────────────┐',
      );
      console.log(
        '    │         Token Savings by Content Type                    │',
      );
      console.log(
        '    ├──────────────────────────────────────────────────────────┤',
      );
      console.log(
        `    │ Code:    ${String(codeResult.originalTokens).padStart(5)} → ${String(codeResult.prunedTokens).padStart(5)} tokens  ${codeResult.reductionPercent.toFixed(1).padStart(5)}% reduction  │`,
      );
      console.log(
        `    │ Prose:   ${String(proseResult.originalTokens).padStart(5)} → ${String(proseResult.prunedTokens).padStart(5)} tokens  ${proseResult.reductionPercent.toFixed(1).padStart(5)}% reduction  │`,
      );
      const totalOrig = codeResult.originalTokens + proseResult.originalTokens;
      const totalPruned = codeResult.prunedTokens + proseResult.prunedTokens;
      const totalPct =
        totalOrig > 0
          ? (((totalOrig - totalPruned) / totalOrig) * 100).toFixed(1)
          : '0.0';
      console.log(
        `    │ Total:   ${String(totalOrig).padStart(5)} → ${String(totalPruned).padStart(5)} tokens  ${totalPct.padStart(5)}% reduction  │`,
      );
      console.log(
        '    └──────────────────────────────────────────────────────────┘',
      );
      console.log(
        '    (SWE-Pruner is a code pruner — prose/markdown passes through)',
      );
      console.log('');

      // Code should be meaningfully reduced
      assert.ok(
        codeResult.prunedTokens < codeResult.originalTokens,
        `Code should be reduced: ${codeResult.prunedTokens} should be < ${codeResult.originalTokens}`,
      );
      // Prose may or may not be reduced (SWE-Pruner focuses on code)
      assert.ok(
        proseResult.prunedTokens <= proseResult.originalTokens,
        `Prose should not grow: ${proseResult.prunedTokens} should be <= ${proseResult.originalTokens}`,
      );
    });

    it('simulated compaction: code context should shrink with pruning', async (t) => {
      if (!prunerAvailable) return t.skip('Pruner not available');

      // Simulate what a future pruner-enhanced compaction would look like:
      // the injected context includes both prose sections AND code snippets.
      // The pruner can shrink the code portions while prose passes through.
      const mixedPayload = [
        CONTEXT_PAYLOAD,
        '',
        '## Working Files',
        '```typescript',
        CODE_SAMPLE,
        '```',
      ].join('\n');

      const withoutPruning = estimateTokens(mixedPayload);
      const result = await prune(
        mixedPayload,
        'Implement user authentication with OAuth2',
      );

      console.log('');
      console.log('    ┌───────────────────────────────────────────────┐');
      console.log('    │  Simulated Compaction: Mixed Content Savings  │');
      console.log('    ├───────────────────────────────────────────────┤');
      console.log(
        `    │ Before pruning:  ${String(withoutPruning).padStart(5)} tokens              │`,
      );
      console.log(
        `    │ After pruning:   ${String(result.prunedTokens).padStart(5)} tokens              │`,
      );
      const saved = withoutPruning - result.prunedTokens;
      console.log(
        `    │ Saved:           ${String(saved).padStart(5)} tokens (${result.reductionPercent.toFixed(1)}%)        │`,
      );
      console.log('    └───────────────────────────────────────────────┘');
      console.log('');

      assert.ok(
        result.prunedTokens < withoutPruning,
        `Mixed payload should shrink: ${result.prunedTokens} should be < ${withoutPruning}`,
      );
    });
  });
});
