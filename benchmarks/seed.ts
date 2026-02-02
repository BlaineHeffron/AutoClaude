/**
 * Seeds an isolated SQLite DB with ground truth data for the E2E benchmark.
 *
 * Reuses memory.ts DAL functions with AUTOCLAUDE_DB env set before import
 * (same pattern as tests/benchmark.test.ts).
 *
 * IMPORTANT: AUTOCLAUDE_DB must be set BEFORE this module is imported,
 * because db.ts reads the env var lazily on first getDb() call.
 */

import type { GroundTruth } from './types';
import {
  createSession,
  updateSession,
  insertDecision,
  insertLearning,
  insertSnapshot,
  insertPrompt,
} from '../src/core/memory';
import { closeDb } from '../src/core/db';

/** The 5 topic sessions + 1 recent session with snapshot + 3 prior prompts. */
const TOPIC_SESSIONS = {
  auth: {
    summary:
      'Implemented JWT-based authentication with refresh tokens, bcrypt password hashing, and role-based access control middleware.',
    decisions: [
      {
        decision: 'Use JWT with RS256 algorithm for stateless authentication',
        category: 'architecture',
        rationale: 'Allows horizontal scaling without shared session store',
      },
      {
        decision: 'Added dependency: jsonwebtoken, bcryptjs',
        category: 'library',
        rationale: 'Standard libraries for JWT and password hashing',
      },
    ],
    learnings: [
      {
        learning:
          'JWT refresh tokens must be stored in httpOnly cookies, not localStorage, to prevent XSS attacks',
        category: 'gotcha',
        context:
          'Security review found localStorage token storage vulnerability',
      },
      {
        learning:
          'bcrypt compareSync blocks the event loop; use compare (async) in production routes',
        category: 'gotcha',
        context:
          'Performance testing showed 200ms latency spike on login endpoint',
      },
    ],
  },
  database: {
    summary:
      'Set up PostgreSQL with Prisma ORM, created migration system, added connection pooling with PgBouncer.',
    decisions: [
      {
        decision: 'Use Prisma as the primary ORM with raw SQL escape hatch',
        category: 'architecture',
        rationale: 'Type-safe queries with migration management built-in',
      },
      {
        decision: 'Connection pool size set to 20 with 10s idle timeout',
        category: 'convention',
        rationale:
          'Benchmarked against production-like load; 20 connections optimal for 4-core instance',
      },
    ],
    learnings: [
      {
        learning:
          'Prisma generates client in node_modules/.prisma by default; must run prisma generate after npm install',
        category: 'gotcha',
        context:
          'CI pipeline failed because prisma client was not generated after dependencies installed',
      },
      {
        learning:
          'PostgreSQL JSONB columns need explicit type casting in Prisma; use Json type in schema',
        category: 'pattern',
        context: 'Schema migration failed when using plain JSON field type',
      },
    ],
  },
  frontend: {
    summary:
      'Built React dashboard with TailwindCSS, implemented chart components with Recharts, added dark mode toggle.',
    decisions: [
      {
        decision: 'Use TailwindCSS with custom design tokens over CSS modules',
        category: 'convention',
        rationale: 'Faster iteration, consistent spacing/color system',
      },
      {
        decision: 'Recharts for data visualization over D3 directly',
        category: 'library',
        rationale:
          'React-native composability, smaller bundle for our use case',
      },
    ],
    learnings: [
      {
        learning:
          'TailwindCSS purge must include all component file paths or production builds will miss styles',
        category: 'gotcha',
        context:
          'Production deploy had missing styles because purge config excluded shared/ directory',
      },
      {
        learning:
          'Recharts ResponsiveContainer needs explicit height; auto-height causes infinite resize loop',
        category: 'gotcha',
        context:
          'Dashboard page was freezing due to layout thrashing from ResponsiveContainer',
      },
    ],
  },
  testing: {
    summary:
      'Added comprehensive test suite with Vitest, configured coverage thresholds, set up E2E tests with Playwright.',
    decisions: [
      {
        decision: 'Vitest over Jest for unit/integration tests',
        category: 'convention',
        rationale:
          'Native ESM support, faster execution, Vite ecosystem compatibility',
      },
      {
        decision: 'Coverage threshold: 80% branches, 85% lines minimum',
        category: 'convention',
        rationale: 'Industry standard for production applications',
      },
    ],
    learnings: [
      {
        learning:
          'Vitest mock.module must be called before the module import; hoisting does not work like Jest',
        category: 'gotcha',
        context:
          'Mock was not applied because import was evaluated before mock.module call',
      },
      {
        learning:
          'Playwright needs explicit waitForSelector before assertions; implicit waits are unreliable for dynamic content',
        category: 'pattern',
        context:
          'E2E tests were flaky because assertions ran before DOM updates completed',
      },
    ],
  },
  devops: {
    summary:
      'Configured Docker multi-stage builds, GitHub Actions CI/CD pipeline, and Kubernetes deployment manifests.',
    decisions: [
      {
        decision: 'Multi-stage Docker builds with Alpine base for production',
        category: 'architecture',
        rationale: 'Reduces image size from 1.2GB to 180MB',
      },
      {
        decision: 'GitHub Actions with matrix strategy for Node 18/20/22',
        category: 'architecture',
        rationale: 'Ensure compatibility across supported Node versions',
      },
    ],
    learnings: [
      {
        learning:
          'Docker COPY --from=builder must use absolute paths; relative paths resolve differently in multi-stage',
        category: 'gotcha',
        context:
          'Build artifacts were not found in production stage due to relative path resolution',
      },
      {
        learning:
          'GitHub Actions cache key must include package-lock.json hash; otherwise stale dependencies persist',
        category: 'pattern',
        context:
          'CI was passing with outdated dependencies that failed in production',
      },
    ],
  },
};

const RECENT_SESSION = {
  summary:
    'Implemented user registration API endpoints and form validation. Email verification pending.',
  snapshot: {
    trigger: 'compact' as const,
    current_task: 'Implementing user registration flow with email verification',
    progress_summary:
      '3 API endpoints created, form validation complete, email service pending',
    open_questions: JSON.stringify([
      'Should email verification use JWT or random token?',
      'How long should verification links be valid?',
    ]),
    next_steps: JSON.stringify([
      'Implement email verification service',
      'Add rate limiting to registration endpoint',
      'Write integration tests for auth flow',
    ]),
    working_files: JSON.stringify([
      'src/routes/auth.ts',
      'src/services/email.ts',
      'src/middleware/validation.ts',
    ]),
  },
};

const PRIOR_PROMPTS = [
  'Fix the TypeScript compilation errors in the auth module',
  'Add unit tests for the user registration endpoint',
  'Refactor the database connection pool configuration',
];

/**
 * Seeds the database (pointed to by AUTOCLAUDE_DB) with ground truth data.
 * Returns the ground truth document for the judge.
 */
export function seedBenchmarkDb(projectPath: string): GroundTruth {
  const allDecisions: GroundTruth['decisions'] = [];
  const allLearnings: GroundTruth['learnings'] = [];
  const allSessions: GroundTruth['sessions'] = [];

  // Seed 5 topic sessions
  let idx = 0;
  for (const [topic, data] of Object.entries(TOPIC_SESSIONS)) {
    const sessionId = `e2e-${topic}-${idx}`;
    createSession(sessionId, projectPath);
    updateSession(sessionId, {
      summary: data.summary,
      ended_at: new Date(Date.now() - (5 - idx) * 86400000).toISOString(),
    });

    allSessions.push({ topic, summary: data.summary });

    for (const d of data.decisions) {
      insertDecision({
        session_id: sessionId,
        project_path: projectPath,
        category: d.category,
        decision: d.decision,
        rationale: d.rationale,
        files_affected: null,
        supersedes_id: null,
      });
      allDecisions.push(d);
    }

    for (const l of data.learnings) {
      insertLearning({
        session_id: sessionId,
        project_path: projectPath,
        category: l.category,
        learning: l.learning,
        context: l.context,
        relevance_score: 1.0,
        times_referenced: 0,
      });
      allLearnings.push(l);
    }

    idx++;
  }

  // Seed recent session with snapshot
  const recentSessionId = 'e2e-recent';
  createSession(recentSessionId, projectPath);
  updateSession(recentSessionId, {
    summary: RECENT_SESSION.summary,
    ended_at: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
  });

  insertSnapshot({
    session_id: recentSessionId,
    ...RECENT_SESSION.snapshot,
  });

  // Seed prior prompts for repeated instruction detection
  const promptSessionId = 'e2e-prompts';
  createSession(promptSessionId, projectPath);
  for (const p of PRIOR_PROMPTS) {
    insertPrompt({
      session_id: promptSessionId,
      project_path: projectPath,
      prompt: p,
    });
  }

  // Create the "current" session (the one the benchmark will run in)
  createSession('e2e-current', projectPath);

  return {
    sessions: allSessions,
    decisions: allDecisions,
    learnings: allLearnings,
    recentWork: {
      task: RECENT_SESSION.snapshot.current_task,
      progress: RECENT_SESSION.snapshot.progress_summary,
      nextSteps: JSON.parse(RECENT_SESSION.snapshot.next_steps),
    },
    priorPrompts: PRIOR_PROMPTS,
  };
}

/**
 * Closes the database connection. Call after seeding is complete.
 */
export function closeSeedDb(): void {
  closeDb();
}
