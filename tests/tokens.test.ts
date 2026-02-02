import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { estimateTokens, truncateToTokenBudget } from '../src/util/tokens';

describe('Token Utilities', () => {
  describe('estimateTokens', () => {
    it('should estimate tokens for ASCII text', () => {
      // 12 bytes / 4 = 3 tokens
      const result = estimateTokens('hello world!');
      assert.equal(result, 3);
    });

    it('should return 0 for empty string', () => {
      assert.equal(estimateTokens(''), 0);
    });

    it('should handle multi-byte UTF-8 characters', () => {
      // Each emoji is typically 4 bytes in UTF-8
      const emoji = '😀';
      const byteLen = Buffer.byteLength(emoji, 'utf-8');
      assert.equal(estimateTokens(emoji), Math.ceil(byteLen / 4));
    });

    it('should round up for non-exact divisions', () => {
      // 5 bytes / 4 = 1.25 → ceil = 2
      const result = estimateTokens('hello');
      assert.equal(result, 2);
    });
  });

  describe('truncateToTokenBudget', () => {
    it('should return text unchanged when within budget', () => {
      const text = 'Hello world';
      const result = truncateToTokenBudget(text, 100);
      assert.equal(result, text);
    });

    it('should truncate text that exceeds budget', () => {
      const text = 'A'.repeat(1000);
      const result = truncateToTokenBudget(text, 10);
      assert.ok(
        estimateTokens(result) <= 10,
        'Truncated text should fit within budget',
      );
    });

    it('should prefer sentence boundaries for truncation', () => {
      const text =
        'This is the first sentence. This is the second sentence. This is a much longer third sentence that goes on and on.';
      const budget = 15; // ~60 bytes
      const result = truncateToTokenBudget(text, budget);
      assert.ok(
        result.endsWith('.') || result.endsWith('?') || result.endsWith('!'),
        'Should end at a sentence boundary',
      );
    });

    it('should fall back to word boundaries', () => {
      // Single very long "sentence" with no periods
      const text = 'word '.repeat(200).trim();
      const budget = 10; // ~40 bytes
      const result = truncateToTokenBudget(text, budget);
      assert.ok(!result.endsWith(' '), 'Should not end with trailing space');
      assert.ok(estimateTokens(result) <= budget, 'Should be within budget');
    });

    it('should handle zero budget', () => {
      const result = truncateToTokenBudget('Hello world', 0);
      assert.equal(result, '');
    });

    it('should handle budget of 1 token', () => {
      const result = truncateToTokenBudget('Hello world this is a test', 1);
      assert.ok(estimateTokens(result) <= 1, 'Result should fit in 1 token');
    });

    it('should handle empty text', () => {
      assert.equal(truncateToTokenBudget('', 100), '');
    });
  });
});
