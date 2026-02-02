/**
 * Builds a human-readable ground truth document from seeded data.
 * Used as a template variable in llm-rubric assertions.
 */

import type { GroundTruth } from './types';

export function buildGroundTruthDoc(groundTruth: GroundTruth): string {
  const lines: string[] = [];

  lines.push('## Ground Truth: Seeded Project Context');
  lines.push('');
  lines.push('### Session History');
  for (const s of groundTruth.sessions) {
    lines.push(`- **${s.topic}**: ${s.summary}`);
  }

  lines.push('');
  lines.push('### Architecture Decisions');
  for (const d of groundTruth.decisions) {
    lines.push(`- **${d.decision}** (${d.category}): ${d.rationale}`);
  }

  lines.push('');
  lines.push('### Learnings / Gotchas');
  for (const l of groundTruth.learnings) {
    lines.push(`- **${l.learning}** (${l.category}): ${l.context}`);
  }

  lines.push('');
  lines.push('### Most Recent Work');
  lines.push(`- Task: ${groundTruth.recentWork.task}`);
  lines.push(`- Progress: ${groundTruth.recentWork.progress}`);
  lines.push(`- Next Steps: ${groundTruth.recentWork.nextSteps.join(', ')}`);

  lines.push('');
  lines.push('### Prior Prompts (for repeated instruction detection)');
  for (const p of groundTruth.priorPrompts) {
    lines.push(`- "${p}"`);
  }

  return lines.join('\n');
}
