import type Database from "better-sqlite3";
import { getDb } from "./db";

// ---------------------------------------------------------------------------
// Record interfaces
// ---------------------------------------------------------------------------

export interface SessionRecord {
  id: string;
  project_path: string;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
  task_description: string | null;
  files_modified: string | null;
  decisions_made: string | null;
  learnings: string | null;
  context_utilization_peak: number | null;
  tokens_used_input: number | null;
  tokens_used_output: number | null;
  compaction_count: number;
  parent_session_id: string | null;
}

export interface ActionRecord {
  id?: number;
  session_id: string;
  timestamp?: string;
  tool_name: string;
  file_path: string | null;
  action_type: string | null;
  description: string | null;
  outcome: string | null;
  error_message: string | null;
}

export interface DecisionRecord {
  id?: number;
  session_id: string;
  project_path: string;
  timestamp?: string;
  category: string | null;
  decision: string;
  rationale: string | null;
  files_affected: string | null;
  supersedes_id: number | null;
}

export interface LearningRecord {
  id?: number;
  session_id: string;
  project_path: string;
  timestamp?: string;
  category: string | null;
  learning: string;
  context: string | null;
  relevance_score: number;
  times_referenced: number;
}

export interface SnapshotRecord {
  id?: number;
  session_id: string;
  timestamp?: string;
  trigger: string | null;
  current_task: string | null;
  progress_summary: string | null;
  open_questions: string | null;
  next_steps: string | null;
  working_files: string | null;
}

export interface MetricRecord {
  id?: number;
  session_id: string;
  timestamp?: string;
  metric_name: string;
  metric_value: number;
}

export interface SearchResult {
  source: "sessions" | "decisions" | "learnings";
  id: number;
  snippet: string;
  rank: number;
}

// ---------------------------------------------------------------------------
// Internal helper – safely obtain the database handle
// ---------------------------------------------------------------------------

function db(): Database.Database | null {
  try {
    return getDb();
  } catch {
    return null;
  }
}

// ===========================================================================
// Sessions
// ===========================================================================

export function createSession(
  id: string,
  projectPath: string,
  parentSessionId?: string,
): void {
  const d = db();
  if (!d) return;

  try {
    d.prepare(
      `INSERT INTO sessions (id, project_path, parent_session_id)
       VALUES (?, ?, ?)`,
    ).run(id, projectPath, parentSessionId ?? null);
  } catch {
    // swallow – never throw
  }
}

export function updateSession(
  id: string,
  updates: Partial<SessionRecord>,
): void {
  const d = db();
  if (!d) return;

  // Build a dynamic SET clause from the provided keys, filtering out the
  // primary key and any undefined values.
  const allowed = new Set<string>([
    "ended_at",
    "summary",
    "task_description",
    "files_modified",
    "decisions_made",
    "learnings",
    "context_utilization_peak",
    "tokens_used_input",
    "tokens_used_output",
    "compaction_count",
    "parent_session_id",
  ]);

  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (allowed.has(key) && value !== undefined) {
      setClauses.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (setClauses.length === 0) return;

  values.push(id);

  try {
    d.prepare(
      `UPDATE sessions SET ${setClauses.join(", ")} WHERE id = ?`,
    ).run(...values);
  } catch {
    // swallow
  }
}

export function getSession(id: string): SessionRecord | null {
  const d = db();
  if (!d) return null;

  try {
    const row = d
      .prepare(`SELECT * FROM sessions WHERE id = ?`)
      .get(id) as SessionRecord | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

export function getRecentSessions(
  projectPath: string,
  limit: number = 10,
): SessionRecord[] {
  const d = db();
  if (!d) return [];

  try {
    return d
      .prepare(
        `SELECT * FROM sessions
         WHERE project_path = ?
         ORDER BY started_at DESC
         LIMIT ?`,
      )
      .all(projectPath, limit) as SessionRecord[];
  } catch {
    return [];
  }
}

/**
 * Returns recent sessions that have a non-null summary, suitable for
 * context injection. Avoids returning empty/in-progress sessions.
 */
export function getRecentSummarizedSessions(
  projectPath: string,
  limit: number = 3,
): SessionRecord[] {
  const d = db();
  if (!d) return [];

  try {
    return d
      .prepare(
        `SELECT * FROM sessions
         WHERE project_path = ?
           AND summary IS NOT NULL
           AND summary != ''
         ORDER BY started_at DESC
         LIMIT ?`,
      )
      .all(projectPath, limit) as SessionRecord[];
  } catch {
    return [];
  }
}

// ===========================================================================
// Actions
// ===========================================================================

export function insertAction(action: ActionRecord): number {
  const d = db();
  if (!d) return 0;

  try {
    const info = d
      .prepare(
        `INSERT INTO actions (session_id, tool_name, file_path, action_type, description, outcome, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        action.session_id,
        action.tool_name,
        action.file_path ?? null,
        action.action_type ?? null,
        action.description ?? null,
        action.outcome ?? null,
        action.error_message ?? null,
      );
    return Number(info.lastInsertRowid);
  } catch {
    return 0;
  }
}

export function getSessionActions(sessionId: string): ActionRecord[] {
  const d = db();
  if (!d) return [];

  try {
    return d
      .prepare(
        `SELECT * FROM actions
         WHERE session_id = ?
         ORDER BY timestamp ASC`,
      )
      .all(sessionId) as ActionRecord[];
  } catch {
    return [];
  }
}

// ===========================================================================
// Decisions
// ===========================================================================

export function insertDecision(decision: DecisionRecord): number {
  const d = db();
  if (!d) return 0;

  try {
    const info = d
      .prepare(
        `INSERT INTO decisions (session_id, project_path, category, decision, rationale, files_affected, supersedes_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        decision.session_id,
        decision.project_path,
        decision.category ?? null,
        decision.decision,
        decision.rationale ?? null,
        decision.files_affected ?? null,
        decision.supersedes_id ?? null,
      );
    return Number(info.lastInsertRowid);
  } catch {
    return 0;
  }
}

export function getActiveDecisions(
  projectPath: string,
  limit: number = 50,
): DecisionRecord[] {
  const d = db();
  if (!d) return [];

  try {
    // A decision is "active" (not superseded) when no other decision
    // references it via supersedes_id.
    return d
      .prepare(
        `SELECT d.* FROM decisions d
         WHERE d.project_path = ?
           AND d.id NOT IN (
             SELECT supersedes_id FROM decisions
             WHERE supersedes_id IS NOT NULL
           )
         ORDER BY d.timestamp DESC
         LIMIT ?`,
      )
      .all(projectPath, limit) as DecisionRecord[];
  } catch {
    return [];
  }
}

export function supersedeDecision(
  oldId: number,
  newDecision: DecisionRecord,
): number {
  const d = db();
  if (!d) return 0;

  try {
    const info = d
      .prepare(
        `INSERT INTO decisions (session_id, project_path, category, decision, rationale, files_affected, supersedes_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        newDecision.session_id,
        newDecision.project_path,
        newDecision.category ?? null,
        newDecision.decision,
        newDecision.rationale ?? null,
        newDecision.files_affected ?? null,
        oldId,
      );
    return Number(info.lastInsertRowid);
  } catch {
    return 0;
  }
}

// ===========================================================================
// Learnings
// ===========================================================================

export function insertLearning(learning: LearningRecord): number {
  const d = db();
  if (!d) return 0;

  try {
    const info = d
      .prepare(
        `INSERT INTO learnings (session_id, project_path, category, learning, context, relevance_score, times_referenced)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        learning.session_id,
        learning.project_path,
        learning.category ?? null,
        learning.learning,
        learning.context ?? null,
        learning.relevance_score ?? 1.0,
        learning.times_referenced ?? 0,
      );
    return Number(info.lastInsertRowid);
  } catch {
    return 0;
  }
}

export function getTopLearnings(
  projectPath: string,
  limit: number = 20,
): LearningRecord[] {
  const d = db();
  if (!d) return [];

  try {
    return d
      .prepare(
        `SELECT * FROM learnings
         WHERE project_path = ?
         ORDER BY relevance_score DESC
         LIMIT ?`,
      )
      .all(projectPath, limit) as LearningRecord[];
  } catch {
    return [];
  }
}

export function incrementLearningReference(id: number): void {
  const d = db();
  if (!d) return;

  try {
    d.prepare(
      `UPDATE learnings
       SET times_referenced = times_referenced + 1
       WHERE id = ?`,
    ).run(id);
  } catch {
    // swallow
  }
}

export function decayLearnings(dailyRate: number): void {
  const d = db();
  if (!d) return;

  try {
    // Multiply every learning's relevance_score by (1 - dailyRate).
    // For example dailyRate = 0.02 means a 2 % decay per invocation.
    d.prepare(
      `UPDATE learnings
       SET relevance_score = relevance_score * ?`,
    ).run(1 - dailyRate);
  } catch {
    // swallow
  }
}

// ===========================================================================
// Snapshots
// ===========================================================================

export function insertSnapshot(snapshot: SnapshotRecord): number {
  const d = db();
  if (!d) return 0;

  try {
    const info = d
      .prepare(
        `INSERT INTO snapshots (session_id, trigger, current_task, progress_summary, open_questions, next_steps, working_files)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        snapshot.session_id,
        snapshot.trigger ?? null,
        snapshot.current_task ?? null,
        snapshot.progress_summary ?? null,
        snapshot.open_questions ?? null,
        snapshot.next_steps ?? null,
        snapshot.working_files ?? null,
      );
    return Number(info.lastInsertRowid);
  } catch {
    return 0;
  }
}

export function getLatestSnapshot(
  sessionId: string,
): SnapshotRecord | null {
  const d = db();
  if (!d) return null;

  try {
    const row = d
      .prepare(
        `SELECT * FROM snapshots
         WHERE session_id = ?
         ORDER BY timestamp DESC
         LIMIT 1`,
      )
      .get(sessionId) as SnapshotRecord | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

/**
 * Returns the most recent snapshot for any session in the given project,
 * excluding snapshots from the specified session. Used to restore context
 * after compaction or on resume.
 */
export function getLatestProjectSnapshot(
  projectPath: string,
  excludeSessionId?: string,
): SnapshotRecord | null {
  const d = db();
  if (!d) return null;

  try {
    let row: SnapshotRecord | undefined;

    if (excludeSessionId) {
      row = d
        .prepare(
          `SELECT s.* FROM snapshots s
           JOIN sessions sess ON s.session_id = sess.id
           WHERE sess.project_path = ?
             AND s.session_id != ?
           ORDER BY s.timestamp DESC
           LIMIT 1`,
        )
        .get(projectPath, excludeSessionId) as SnapshotRecord | undefined;
    } else {
      row = d
        .prepare(
          `SELECT s.* FROM snapshots s
           JOIN sessions sess ON s.session_id = sess.id
           WHERE sess.project_path = ?
           ORDER BY s.timestamp DESC
           LIMIT 1`,
        )
        .get(projectPath) as SnapshotRecord | undefined;
    }

    return row ?? null;
  } catch {
    return null;
  }
}

// ===========================================================================
// Metrics
// ===========================================================================

export function insertMetric(
  sessionId: string,
  name: string,
  value: number,
): void {
  const d = db();
  if (!d) return;

  try {
    d.prepare(
      `INSERT INTO metrics (session_id, metric_name, metric_value)
       VALUES (?, ?, ?)`,
    ).run(sessionId, name, value);
  } catch {
    // swallow
  }
}

export function getSessionMetrics(sessionId: string): MetricRecord[] {
  const d = db();
  if (!d) return [];

  try {
    return d
      .prepare(
        `SELECT * FROM metrics
         WHERE session_id = ?
         ORDER BY timestamp ASC`,
      )
      .all(sessionId) as MetricRecord[];
  } catch {
    return [];
  }
}

// ===========================================================================
// Prompts (UserPromptSubmit logging)
// ===========================================================================

export interface PromptRecord {
  id?: number;
  session_id: string;
  project_path: string;
  timestamp?: string;
  prompt: string;
}

export function insertPrompt(prompt: PromptRecord): number {
  const d = db();
  if (!d) return 0;

  try {
    const info = d
      .prepare(
        `INSERT INTO prompts (session_id, project_path, prompt)
         VALUES (?, ?, ?)`,
      )
      .run(prompt.session_id, prompt.project_path, prompt.prompt);
    return Number(info.lastInsertRowid);
  } catch {
    return 0;
  }
}

/**
 * Searches the prompts FTS index for similar prompts in the same project.
 * Returns prompts that match the query, excluding the current session.
 */
export function findSimilarPrompts(
  query: string,
  projectPath: string,
  excludeSessionId?: string,
  limit: number = 5,
): Array<{ id: number; session_id: string; prompt: string; rank: number }> {
  const d = db();
  if (!d) return [];

  try {
    // Use FTS5 to find similar prompts, then filter by project
    if (excludeSessionId) {
      return d
        .prepare(
          `SELECT p.id, p.session_id, p.prompt, pf.rank
           FROM prompts_fts pf
           JOIN prompts p ON p.rowid = pf.rowid
           WHERE prompts_fts MATCH ?
             AND p.project_path = ?
             AND p.session_id != ?
           ORDER BY pf.rank
           LIMIT ?`,
        )
        .all(query, projectPath, excludeSessionId, limit) as Array<{
        id: number;
        session_id: string;
        prompt: string;
        rank: number;
      }>;
    } else {
      return d
        .prepare(
          `SELECT p.id, p.session_id, p.prompt, pf.rank
           FROM prompts_fts pf
           JOIN prompts p ON p.rowid = pf.rowid
           WHERE prompts_fts MATCH ?
             AND p.project_path = ?
           ORDER BY pf.rank
           LIMIT ?`,
        )
        .all(query, projectPath, limit) as Array<{
        id: number;
        session_id: string;
        prompt: string;
        rank: number;
      }>;
    }
  } catch {
    return [];
  }
}

/**
 * Returns aggregate project-level metrics useful for the stats dashboard.
 */
export function getProjectMetrics(projectPath: string): {
  sessionCount: number;
  totalActions: number;
  totalFailures: number;
  avgUtilization: number;
  totalCompactions: number;
  decisionCount: number;
  learningCount: number;
  promptCount: number;
  repeatedPromptCount: number;
} {
  const d = db();
  const empty = {
    sessionCount: 0,
    totalActions: 0,
    totalFailures: 0,
    avgUtilization: 0,
    totalCompactions: 0,
    decisionCount: 0,
    learningCount: 0,
    promptCount: 0,
    repeatedPromptCount: 0,
  };
  if (!d) return empty;

  try {
    const sessionRow = d
      .prepare(
        `SELECT COUNT(*) as cnt, COALESCE(SUM(compaction_count), 0) as compactions,
                COALESCE(AVG(context_utilization_peak), 0) as avg_util
         FROM sessions WHERE project_path = ?`,
      )
      .get(projectPath) as { cnt: number; compactions: number; avg_util: number };

    const actionRow = d
      .prepare(
        `SELECT COUNT(*) as cnt FROM actions a
         JOIN sessions s ON a.session_id = s.id
         WHERE s.project_path = ?`,
      )
      .get(projectPath) as { cnt: number };

    const failureRow = d
      .prepare(
        `SELECT COUNT(*) as cnt FROM actions a
         JOIN sessions s ON a.session_id = s.id
         WHERE s.project_path = ? AND a.outcome = 'failure'`,
      )
      .get(projectPath) as { cnt: number };

    const decisionRow = d
      .prepare(
        `SELECT COUNT(*) as cnt FROM decisions WHERE project_path = ?`,
      )
      .get(projectPath) as { cnt: number };

    const learningRow = d
      .prepare(
        `SELECT COUNT(*) as cnt FROM learnings WHERE project_path = ?`,
      )
      .get(projectPath) as { cnt: number };

    let promptCount = 0;
    try {
      const promptRow = d
        .prepare(
          `SELECT COUNT(*) as cnt FROM prompts WHERE project_path = ?`,
        )
        .get(projectPath) as { cnt: number };
      promptCount = promptRow.cnt;
    } catch {
      // prompts table may not exist yet
    }

    return {
      sessionCount: sessionRow.cnt,
      totalActions: actionRow.cnt,
      totalFailures: failureRow.cnt,
      avgUtilization: sessionRow.avg_util,
      totalCompactions: sessionRow.compactions,
      decisionCount: decisionRow.cnt,
      learningCount: learningRow.cnt,
      promptCount,
      repeatedPromptCount: 0, // computed externally via FTS
    };
  } catch {
    return empty;
  }
}

// ===========================================================================
// Full-text search
// ===========================================================================

export function searchMemory(
  query: string,
  category: "sessions" | "decisions" | "learnings" | "all" = "all",
  limit: number = 20,
): SearchResult[] {
  const d = db();
  if (!d) return [];

  const results: SearchResult[] = [];

  try {
    if (category === "sessions" || category === "all") {
      const rows = d
        .prepare(
          `SELECT rowid, snippet(sessions_fts, 0, '<b>', '</b>', '...', 32) AS snippet, rank
           FROM sessions_fts
           WHERE sessions_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(query, limit) as Array<{
        rowid: number;
        snippet: string;
        rank: number;
      }>;

      for (const row of rows) {
        results.push({
          source: "sessions",
          id: row.rowid,
          snippet: row.snippet,
          rank: row.rank,
        });
      }
    }

    if (category === "decisions" || category === "all") {
      const rows = d
        .prepare(
          `SELECT rowid, snippet(decisions_fts, 0, '<b>', '</b>', '...', 32) AS snippet, rank
           FROM decisions_fts
           WHERE decisions_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(query, limit) as Array<{
        rowid: number;
        snippet: string;
        rank: number;
      }>;

      for (const row of rows) {
        results.push({
          source: "decisions",
          id: row.rowid,
          snippet: row.snippet,
          rank: row.rank,
        });
      }
    }

    if (category === "learnings" || category === "all") {
      const rows = d
        .prepare(
          `SELECT rowid, snippet(learnings_fts, 0, '<b>', '</b>', '...', 32) AS snippet, rank
           FROM learnings_fts
           WHERE learnings_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(query, limit) as Array<{
        rowid: number;
        snippet: string;
        rank: number;
      }>;

      for (const row of rows) {
        results.push({
          source: "learnings",
          id: row.rowid,
          snippet: row.snippet,
          rank: row.rank,
        });
      }
    }

    // Sort combined results by FTS5 rank (lower is better) and trim to limit.
    results.sort((a, b) => a.rank - b.rank);
    return results.slice(0, limit);
  } catch {
    return results; // return whatever we gathered so far
  }
}

// ===========================================================================
// Garbage collection
// ===========================================================================

export function garbageCollect(threshold: number): { removed: number } {
  const d = db();
  if (!d) return { removed: 0 };

  try {
    const info = d
      .prepare(
        `DELETE FROM learnings WHERE relevance_score < ?`,
      )
      .run(threshold);
    return { removed: info.changes };
  } catch {
    return { removed: 0 };
  }
}
