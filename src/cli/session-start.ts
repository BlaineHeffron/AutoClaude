import {
  createSession,
  getRecentSessions,
  getActiveDecisions,
  getTopLearnings,
  getLatestSnapshot,
  decayLearnings,
  garbageCollect,
} from "../core/memory";
import type {
  SessionRecord,
  DecisionRecord,
  LearningRecord,
  SnapshotRecord,
} from "../core/memory";
import { estimateTokens, truncateToTokenBudget } from "../util/tokens";
import { getConfig } from "../util/config";
import { logger } from "../util/logger";

// ---------------------------------------------------------------------------
// Hook I/O interfaces
// ---------------------------------------------------------------------------

export interface HookInput {
  session_id: string;
  cwd?: string;
  source?: "startup" | "resume" | "compact" | "clear";
}

export interface HookOutput {
  continue: boolean;
  additionalContext?: string;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

function formatSessionsSection(sessions: SessionRecord[]): string {
  if (sessions.length === 0) return "";

  const lines = sessions
    .filter((s) => s.summary)
    .map((s) => `- [${formatDate(s.started_at)}]: ${s.summary}`);

  if (lines.length === 0) return "";

  return `## Recent Sessions\n${lines.join("\n")}`;
}

function formatDecisionsSection(decisions: DecisionRecord[]): string {
  if (decisions.length === 0) return "";

  const lines = decisions.map(
    (d) => `- ${d.category ? `[${d.category}]` : "[general]"}: ${d.decision}`,
  );

  return `## Active Decisions\n${lines.join("\n")}`;
}

function formatLearningsSection(learnings: LearningRecord[]): string {
  if (learnings.length === 0) return "";

  const lines = learnings.map(
    (l) => `- ${l.category ? `[${l.category}]` : "[general]"}: ${l.learning}`,
  );

  return `## Learnings\n${lines.join("\n")}`;
}

function formatSnapshotSection(snapshot: SnapshotRecord): string {
  const parts: string[] = ["## Snapshot (Resuming)"];

  if (snapshot.current_task) {
    parts.push(`**Task:** ${snapshot.current_task}`);
  }
  if (snapshot.progress_summary) {
    parts.push(`**Progress:** ${snapshot.progress_summary}`);
  }
  if (snapshot.next_steps) {
    // next_steps may be stored as JSON array or plain text
    let steps: string;
    try {
      const parsed = JSON.parse(snapshot.next_steps);
      if (Array.isArray(parsed)) {
        steps = parsed.map((s: string) => `  - ${s}`).join("\n");
      } else {
        steps = `  - ${snapshot.next_steps}`;
      }
    } catch {
      // Plain text -- split on newlines if multi-line, otherwise single bullet
      const lines = snapshot.next_steps
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      steps = lines.map((l) => `  - ${l}`).join("\n");
    }
    parts.push(`**Next Steps:**\n${steps}`);
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Context assembly with priority-based token budgeting
// ---------------------------------------------------------------------------

/**
 * Assembles the context sections in priority order (snapshot > decisions >
 * learnings > sessions) and trims the combined output to fit within the
 * configured token budget.
 *
 * Priority is enforced by building the output incrementally: higher-priority
 * sections are added first, and the remaining budget shrinks accordingly. If
 * a lower-priority section would exceed the remaining budget it is truncated.
 */
function assembleContext(
  sections: {
    snapshot: string;
    decisions: string;
    learnings: string;
    sessions: string;
  },
  maxTokens: number,
): string {
  const header = "# [autoclaude] Session Context\n";
  const headerTokens = estimateTokens(header);
  let remaining = maxTokens - headerTokens;

  if (remaining <= 0) {
    return truncateToTokenBudget(header, maxTokens);
  }

  // Priority order: snapshot > decisions > learnings > sessions
  const ordered: string[] = [];

  for (const section of [
    sections.snapshot,
    sections.decisions,
    sections.learnings,
    sections.sessions,
  ]) {
    if (!section) continue;

    const sectionTokens = estimateTokens(section);
    if (sectionTokens <= remaining) {
      ordered.push(section);
      remaining -= sectionTokens;
    } else if (remaining > 0) {
      // Truncate this section to fit the remaining budget
      ordered.push(truncateToTokenBudget(section, remaining));
      remaining = 0;
    }
    // If remaining is already 0, skip lower-priority sections
  }

  if (ordered.length === 0) {
    return "";
  }

  return header + "\n" + ordered.join("\n\n");
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handleSessionStart(
  input: HookInput,
): Promise<HookOutput> {
  const { session_id, cwd, source } = input;
  const projectPath = cwd ?? process.cwd();

  logger.info(
    `session-start: id=${session_id} source=${source ?? "startup"} project=${projectPath}`,
  );

  // ------------------------------------------------------------------
  // 1. Create the session record
  // ------------------------------------------------------------------

  createSession(session_id, projectPath);

  // ------------------------------------------------------------------
  // 2. Load configuration
  // ------------------------------------------------------------------

  const config = getConfig();

  // ------------------------------------------------------------------
  // 3. Run garbage collection on learnings (decay + prune)
  // ------------------------------------------------------------------

  try {
    decayLearnings(config.decay.dailyRate);
    const gc = garbageCollect(config.decay.gcThreshold);
    if (gc.removed > 0) {
      logger.info(`session-start: pruned ${gc.removed} stale learnings`);
    }
  } catch (err) {
    logger.error(
      `session-start: gc failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ------------------------------------------------------------------
  // 4. If injection is disabled, return early
  // ------------------------------------------------------------------

  if (!config.injection.enabled) {
    logger.debug("session-start: injection disabled, skipping context build");
    return { continue: true };
  }

  // ------------------------------------------------------------------
  // 5. Gather context for injection
  // ------------------------------------------------------------------

  // 5a. Recent session summaries
  let sessionsSection = "";
  if (config.injection.includeSessions > 0) {
    const sessions = getRecentSessions(
      projectPath,
      config.injection.includeSessions,
    );
    sessionsSection = formatSessionsSection(sessions);
  }

  // 5b. Active decisions
  let decisionsSection = "";
  if (config.injection.includeDecisions) {
    const decisions = getActiveDecisions(projectPath);
    decisionsSection = formatDecisionsSection(decisions);
  }

  // 5c. Top learnings by relevance score
  let learningsSection = "";
  if (config.injection.includeLearnings) {
    const learnings = getTopLearnings(projectPath, 10);
    learningsSection = formatLearningsSection(learnings);
  }

  // 5d. Latest snapshot (only for compact/resume sources)
  let snapshotSection = "";
  if (
    config.injection.includeSnapshot &&
    (source === "compact" || source === "resume")
  ) {
    // Find the most recent prior session to pull its snapshot
    const recentSessions = getRecentSessions(projectPath, 2);
    // The first entry may be the session we just created (no snapshot yet),
    // so look for the first session with a different id.
    const parentSession = recentSessions.find((s) => s.id !== session_id);

    if (parentSession) {
      const snapshot = getLatestSnapshot(parentSession.id);
      if (snapshot) {
        snapshotSection = formatSnapshotSection(snapshot);
      }
    }
  }

  // ------------------------------------------------------------------
  // 6. Assemble and trim to token budget
  // ------------------------------------------------------------------

  const context = assembleContext(
    {
      snapshot: snapshotSection,
      decisions: decisionsSection,
      learnings: learningsSection,
      sessions: sessionsSection,
    },
    config.injection.maxTokens,
  );

  if (!context) {
    logger.debug("session-start: no context to inject");
    return { continue: true };
  }

  logger.info(
    `session-start: injecting ~${estimateTokens(context)} tokens of context`,
  );

  return {
    continue: true,
    additionalContext: context,
  };
}
