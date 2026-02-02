import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { HookInput, HookOutput } from './types';
import { closeDb } from '../core/db';
import { logger } from '../util/logger';

export async function handleBackup(_input: HookInput): Promise<HookOutput> {
  try {
    const dbPath =
      process.env.AUTOCLAUDE_DB ||
      path.join(os.homedir(), '.autoclaude', 'memory.db');

    if (!fs.existsSync(dbPath)) {
      return {
        continue: true,
        hookSpecificOutput: {
          additionalContext: `No database found at ${dbPath}`,
        },
      };
    }

    const backupDir = path.join(os.homedir(), '.autoclaude', 'backups');
    fs.mkdirSync(backupDir, { recursive: true });

    const isoDate = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `autoclaude-${isoDate}.db`);

    // Close db before copying to avoid WAL issues
    closeDb();

    fs.copyFileSync(dbPath, backupPath);

    const message = `Database backed up to ${backupPath}`;
    logger.info(`[backup] ${message}`);

    return {
      continue: true,
      hookSpecificOutput: {
        additionalContext: message,
      },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[backup] ${msg}`);
    return {
      continue: true,
      hookSpecificOutput: {
        additionalContext: `Backup failed: ${msg}`,
      },
    };
  }
}
