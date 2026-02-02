import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

// We test config by importing the module and checking behavior with various
// config files. The config module reads from ~/.autoclaude/config.json,
// so we need to control that file for testing.

// Since config.ts reads from a fixed path (~/.autoclaude/config.json),
// we test the validation and merge logic by importing the functions we can.
// For getConfig(), we verify it returns defaults when no config exists.

import { getConfig, DEFAULT_CONFIG } from '../src/util/config';

describe('Config', () => {
  describe('Default config', () => {
    it('should return default config when no config file exists', () => {
      const config = getConfig();

      // Verify all default values
      assert.equal(config.injection.enabled, true);
      assert.equal(config.injection.maxTokens, 1000);
      assert.equal(config.injection.includeSessions, 3);
      assert.equal(config.injection.includeDecisions, true);
      assert.equal(config.injection.includeLearnings, true);
      assert.equal(config.injection.includeSnapshot, true);

      assert.equal(config.capture.enabled, true);
      assert.equal(config.capture.asyncActions, true);
      assert.deepEqual(config.capture.captureTools, ['Edit', 'Write', 'Bash']);

      assert.equal(config.metrics.enabled, true);
      assert.equal(config.metrics.warnUtilization, 0.55);
      assert.equal(config.metrics.criticalUtilization, 0.7);

      assert.equal(config.decay.dailyRate, 0.05);
      assert.equal(config.decay.referenceBoost, 0.1);
      assert.equal(config.decay.gcThreshold, 0.1);

      assert.equal(config.logging.level, 'info');
      assert.ok(config.logging.file.includes('autoclaude'));
    });
  });

  describe('DEFAULT_CONFIG export', () => {
    it('should export the DEFAULT_CONFIG object', () => {
      assert.ok(DEFAULT_CONFIG);
      assert.equal(DEFAULT_CONFIG.injection.maxTokens, 1000);
      assert.equal(DEFAULT_CONFIG.metrics.warnUtilization, 0.55);
    });
  });

  describe('Config structure', () => {
    it('should have all required top-level keys', () => {
      const config = getConfig();
      assert.ok('injection' in config);
      assert.ok('capture' in config);
      assert.ok('metrics' in config);
      assert.ok('decay' in config);
      assert.ok('logging' in config);
    });

    it('should have numeric values in valid ranges', () => {
      const config = getConfig();

      // After validation, all values should be in range
      assert.ok(config.injection.maxTokens >= 100);
      assert.ok(config.injection.maxTokens <= 10000);
      assert.ok(config.injection.includeSessions >= 0);
      assert.ok(config.injection.includeSessions <= 20);
      assert.ok(config.metrics.warnUtilization >= 0);
      assert.ok(config.metrics.warnUtilization <= 1);
      assert.ok(config.metrics.criticalUtilization >= 0);
      assert.ok(config.metrics.criticalUtilization <= 1);
      assert.ok(
        config.metrics.warnUtilization < config.metrics.criticalUtilization,
      );
      assert.ok(config.decay.dailyRate >= 0);
      assert.ok(config.decay.dailyRate <= 1);
      assert.ok(config.decay.referenceBoost >= 0);
      assert.ok(config.decay.referenceBoost <= 1);
      assert.ok(config.decay.gcThreshold >= 0);
      assert.ok(config.decay.gcThreshold <= 1);
    });

    it('should have valid logging level', () => {
      const config = getConfig();
      const validLevels = ['debug', 'info', 'warn', 'error'];
      assert.ok(
        validLevels.includes(config.logging.level),
        `Logging level "${config.logging.level}" should be one of ${validLevels.join(', ')}`,
      );
    });
  });
});
