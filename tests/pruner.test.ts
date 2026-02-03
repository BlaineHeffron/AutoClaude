import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';

import { getAdaptiveThreshold, resetCache } from '../src/core/pruner';

describe('Pruner', () => {
  beforeEach(() => {
    resetCache();
  });

  describe('getAdaptiveThreshold', () => {
    it('should return base threshold below warn utilization', () => {
      const result = getAdaptiveThreshold(0.5, 0.3);
      assert.equal(result, 0.5);
    });

    it('should return base threshold at zero utilization', () => {
      const result = getAdaptiveThreshold(0.5, 0);
      assert.equal(result, 0.5);
    });

    it('should reduce threshold at warn utilization', () => {
      // At exactly warnUtilization (0.55), threshold should start decreasing
      const result = getAdaptiveThreshold(0.5, 0.55);
      // At the boundary, progress=0, scale=1.0 so threshold unchanged
      assert.equal(result, 0.5);
    });

    it('should reduce threshold above warn utilization', () => {
      // At 0.625 (halfway between 0.55 and 0.7), progress=0.5, scale=0.7
      const result = getAdaptiveThreshold(0.5, 0.625);
      assert.ok(result < 0.5, `Expected < 0.5, got ${result}`);
      assert.ok(result > 0.1, `Expected > 0.1, got ${result}`);
    });

    it('should reduce threshold at critical utilization', () => {
      // At 0.7: range=0.45, progress=0.333, scale=0.8, threshold=0.5*0.8=0.4
      const result = getAdaptiveThreshold(0.5, 0.7);
      assert.ok(result < 0.5, `Expected < 0.5, got ${result}`);
      assert.ok(result > 0.3, `Expected > 0.3, got ${result}`);
    });

    it('should reduce maximally at 100% utilization', () => {
      // At 1.0: progress=1.0, scale=0.4, threshold=0.5*0.4=0.2
      const result = getAdaptiveThreshold(0.5, 1.0);
      assert.ok(result <= 0.21, `Expected <= 0.21, got ${result}`);
      assert.ok(result >= 0.1, `Expected >= 0.1 (floor), got ${result}`);
    });

    it('should never go below 0.1', () => {
      const result = getAdaptiveThreshold(0.1, 1.0);
      assert.ok(result >= 0.1, `Expected >= 0.1, got ${result}`);
    });

    it('should handle edge case of base threshold at 1.0', () => {
      // At 0.7: scale=0.8, so 1.0*0.8=0.8
      const result = getAdaptiveThreshold(1.0, 0.7);
      assert.ok(result < 1.0, `Expected < 1.0, got ${result}`);
      assert.ok(result >= 0.1, `Expected >= 0.1, got ${result}`);
    });
  });
});
