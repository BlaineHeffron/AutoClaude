import Database, { Database as DatabaseType } from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const AUTOCLAUDE_DIR = path.join(os.homedir(), '.autoclaude');
const SCHEMA_PATH = path.join(__dirname, '..', '..', 'sql', 'schema.sql');

let db: DatabaseType | null = null;

/**
 * Returns the database file path. Reads AUTOCLAUDE_DB env var lazily
 * (at call time, not module load time) so tests can override it.
 */
function getDbPath(): string {
  return process.env.AUTOCLAUDE_DB || path.join(AUTOCLAUDE_DIR, 'memory.db');
}

/**
 * Ensures the parent directory for the database file exists.
 */
function ensureDbDir(): void {
  const dir = path.dirname(getDbPath());
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Reads and executes the schema SQL file to initialize database tables,
 * FTS indexes, and triggers.
 *
 * The schema uses CREATE IF NOT EXISTS throughout, so this is safe
 * to run on every startup.
 */
function applySchema(database: DatabaseType): void {
  const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf-8');

  // The schema file contains multiple statements including PRAGMA, CREATE TABLE,
  // CREATE VIRTUAL TABLE, and CREATE TRIGGER. We need to execute them individually
  // because better-sqlite3's exec() handles multi-statement strings, but PRAGMA
  // statements mixed with DDL can be finicky. Split on semicolons that end statements.
  //
  // However, better-sqlite3's exec() actually handles this well for DDL,
  // so we split only the PRAGMA out and exec the rest as a batch.
  const pragmaStatements: string[] = [];
  const ddlStatements: string[] = [];

  // Split schema into PRAGMA vs DDL statements
  for (const rawStatement of schemaSql.split(';')) {
    const statement = rawStatement.trim();
    if (!statement) continue;

    if (statement.toUpperCase().startsWith('PRAGMA')) {
      pragmaStatements.push(statement);
    } else {
      ddlStatements.push(statement);
    }
  }

  // Execute PRAGMAs individually (they return results, not suitable for exec batch)
  for (const pragma of pragmaStatements) {
    database.pragma(pragma.replace(/^PRAGMA\s+/i, ''));
  }

  // Execute all DDL as a single batch
  if (ddlStatements.length > 0) {
    database.exec(ddlStatements.join(';\n') + ';');
  }
}

/**
 * Lazily initializes and returns the singleton SQLite database connection.
 *
 * On first call:
 * - Creates ~/.autoclaude/ if it doesn't exist
 * - Opens (or creates) the memory.db database
 * - Enables WAL mode for concurrent access
 * - Applies the schema (tables, FTS indexes, triggers)
 *
 * Returns null if the database cannot be opened. Hooks must never block
 * Claude, so errors are logged to stderr and swallowed.
 */
export function getDb(): DatabaseType | null {
  if (db !== null) {
    return db;
  }

  try {
    ensureDbDir();

    const dbPath = getDbPath();
    db = new Database(dbPath);

    // Enable WAL mode before applying schema for better concurrent access.
    // This is idempotent - if already in WAL mode, this is a no-op.
    db.pragma('journal_mode = WAL');
    // Wait up to 5s for write lock instead of failing immediately.
    // Hooks run as separate processes and can overlap.
    db.pragma('busy_timeout = 5000');

    applySchema(db);

    return db;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[autoclaude] Failed to initialize database at ${getDbPath()}: ${message}`,
    );

    // Clean up partial state
    if (db !== null) {
      try {
        db.close();
      } catch {
        // Ignore close errors during cleanup
      }
      db = null;
    }

    return null;
  }
}

/**
 * Closes the database connection for clean shutdown.
 *
 * Safe to call multiple times or when no connection has been opened.
 * Errors are logged but never thrown - hooks must never block Claude.
 */
export function closeDb(): void {
  if (db === null) {
    return;
  }

  try {
    db.close();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[autoclaude] Error closing database: ${message}`);
  } finally {
    db = null;
  }
}
