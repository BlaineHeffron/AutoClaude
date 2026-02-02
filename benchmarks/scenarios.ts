/**
 * 8 test scenarios across 4 categories for the E2E benchmark.
 *
 * Each scenario includes expected keywords from the seeded ground truth
 * that the "with autoclaude" arm should surface in its response.
 */

import type { Scenario } from './types';

export const SCENARIOS: Scenario[] = [
  // ── Session Continuity (2) ──────────────────────────────────────────────
  {
    id: 'cont-1',
    category: 'session-continuity',
    prompt: 'What were we working on in the last session?',
    expectedKeywords: [
      'user registration',
      'email verification',
      'API endpoints',
      'form validation',
    ],
    description:
      'Tests whether AutoClaude recalls the most recent session snapshot.',
  },
  {
    id: 'cont-2',
    category: 'session-continuity',
    prompt: "Continue where we left off on the auth feature. What's next?",
    expectedKeywords: [
      'email verification service',
      'rate limiting',
      'integration tests',
      'JWT',
    ],
    description:
      'Tests whether AutoClaude can surface next-steps from the snapshot.',
  },

  // ── Project Knowledge (3) ──────────────────────────────────────────────
  {
    id: 'know-1',
    category: 'project-knowledge',
    prompt: 'What architecture decisions have we made?',
    expectedKeywords: [
      'JWT',
      'RS256',
      'Prisma',
      'TailwindCSS',
      'Vitest',
      'Docker',
      'multi-stage',
    ],
    description:
      'Tests whether AutoClaude surfaces stored architecture decisions.',
  },
  {
    id: 'know-2',
    category: 'project-knowledge',
    prompt: 'What are the known gotchas in this codebase?',
    expectedKeywords: [
      'httpOnly cookies',
      'bcrypt',
      'event loop',
      'prisma generate',
      'purge',
      'ResponsiveContainer',
    ],
    description: 'Tests whether AutoClaude surfaces stored learnings/gotchas.',
  },
  {
    id: 'know-3',
    category: 'project-knowledge',
    prompt: 'What database setup are we using?',
    expectedKeywords: [
      'PostgreSQL',
      'Prisma',
      'connection pool',
      'PgBouncer',
      'migration',
    ],
    description:
      'Tests whether AutoClaude retrieves database-specific decisions and learnings.',
  },

  // ── Cold Start (1) ──────────────────────────────────────────────────────
  {
    id: 'cold-1',
    category: 'cold-start',
    prompt: 'I just joined this project. Give me a tech stack overview.',
    expectedKeywords: [
      'JWT',
      'PostgreSQL',
      'Prisma',
      'React',
      'TailwindCSS',
      'Vitest',
      'Docker',
      'GitHub Actions',
    ],
    description:
      'Tests whether AutoClaude can synthesize a project overview from stored context.',
  },

  // ── Repeated Instruction (2) ────────────────────────────────────────────
  {
    id: 'repeat-1',
    category: 'repeated-instruction',
    prompt: 'Fix the TypeScript compilation errors in the auth module',
    expectedKeywords: [
      'previously',
      'already',
      'prior',
      'before',
      'earlier',
      'again',
    ],
    description:
      'Tests whether AutoClaude detects this was asked before and flags it.',
  },
  {
    id: 'repeat-2',
    category: 'repeated-instruction',
    prompt: 'Add unit tests for the user registration endpoint',
    expectedKeywords: [
      'previously',
      'already',
      'prior',
      'before',
      'earlier',
      'again',
    ],
    description: 'Tests whether AutoClaude detects a duplicate instruction.',
  },
];
