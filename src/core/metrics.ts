import * as fs from "fs";

const BYTES_PER_TOKEN = 4;
const CONTEXT_WINDOW_TOKENS = 200_000;
const CONTEXT_WINDOW_BYTES = CONTEXT_WINDOW_TOKENS * BYTES_PER_TOKEN;

export interface UtilizationEstimate {
  bytes: number;
  estimatedTokens: number;
  utilization: number;
}

/**
 * Estimates context window utilization by reading the transcript JSONL file.
 *
 * Heuristic: 1 token ≈ 4 bytes of text. The 200k context window translates
 * to approximately 800KB of transcript data. This is imprecise but
 * directionally useful for triggering compaction warnings.
 *
 * Returns { bytes: 0, estimatedTokens: 0, utilization: 0 } if the file
 * cannot be read (never throws).
 */
export function estimateUtilization(transcriptPath: string): UtilizationEstimate {
  try {
    const stat = fs.statSync(transcriptPath);
    const bytes = stat.size;
    const estimatedTokens = Math.ceil(bytes / BYTES_PER_TOKEN);
    const utilization = bytes / CONTEXT_WINDOW_BYTES;

    return { bytes, estimatedTokens, utilization };
  } catch {
    return { bytes: 0, estimatedTokens: 0, utilization: 0 };
  }
}
