const BYTES_PER_TOKEN = 4;

/**
 * Estimates the token count of a string using the ~4 bytes per token heuristic.
 */
export function estimateTokens(text: string): number {
  const byteLength = Buffer.byteLength(text, 'utf-8');
  return Math.ceil(byteLength / BYTES_PER_TOKEN);
}

/**
 * Truncates text to fit within a token budget, cutting at sentence boundaries
 * where possible. Falls back to word boundaries, then raw character truncation.
 */
export function truncateToTokenBudget(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) {
    return text;
  }

  // Approximate max byte length from token budget
  const maxBytes = maxTokens * BYTES_PER_TOKEN;

  // Start with a rough character slice (characters <= bytes for UTF-8)
  let truncated = text.slice(0, maxBytes);

  // Ensure we're within budget after slicing (multi-byte chars may push us over)
  while (estimateTokens(truncated) > maxTokens && truncated.length > 0) {
    truncated = truncated.slice(0, truncated.length - 1);
  }

  if (truncated.length === 0) {
    return '';
  }

  // Try to cut at the last sentence boundary
  const sentenceEnd = findLastSentenceBoundary(truncated);
  if (sentenceEnd > 0 && sentenceEnd >= truncated.length * 0.5) {
    return truncated.slice(0, sentenceEnd).trimEnd();
  }

  // Fall back to the last word boundary
  const wordEnd = truncated.lastIndexOf(' ');
  if (wordEnd > 0 && wordEnd >= truncated.length * 0.5) {
    return truncated.slice(0, wordEnd).trimEnd();
  }

  // Last resort: return the raw truncation
  return truncated;
}

/**
 * Finds the last sentence-ending position in the text.
 * Looks for `.`, `!`, or `?` followed by a space or end of string.
 */
function findLastSentenceBoundary(text: string): number {
  let lastPos = -1;

  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === '.' || ch === '!' || ch === '?') {
      const next = i + 1;
      if (next >= text.length || text[next] === ' ' || text[next] === '\n') {
        lastPos = next;
        break;
      }
    }
  }

  return lastPos;
}
