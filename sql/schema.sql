-- Core session tracking
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project_path TEXT NOT NULL,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    summary TEXT,
    task_description TEXT,
    files_modified TEXT,
    decisions_made TEXT,
    learnings TEXT,
    context_utilization_peak REAL,
    tokens_used_input INTEGER,
    tokens_used_output INTEGER,
    compaction_count INTEGER DEFAULT 0,
    parent_session_id TEXT,
    FOREIGN KEY (parent_session_id) REFERENCES sessions(id)
);

-- Granular action log (from PostToolUse)
CREATE TABLE IF NOT EXISTS actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    tool_name TEXT NOT NULL,
    file_path TEXT,
    action_type TEXT,
    description TEXT,
    outcome TEXT,
    error_message TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Decisions and architectural choices
CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    project_path TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    category TEXT,
    decision TEXT NOT NULL,
    rationale TEXT,
    files_affected TEXT,
    supersedes_id INTEGER,
    FOREIGN KEY (session_id) REFERENCES sessions(id),
    FOREIGN KEY (supersedes_id) REFERENCES decisions(id)
);

-- Learnings (mistakes, gotchas, patterns discovered)
CREATE TABLE IF NOT EXISTS learnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    project_path TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    category TEXT,
    learning TEXT NOT NULL,
    context TEXT,
    relevance_score REAL DEFAULT 1.0,
    times_referenced INTEGER DEFAULT 0,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Pre-compaction snapshots
CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    trigger TEXT,
    current_task TEXT,
    progress_summary TEXT,
    open_questions TEXT,
    next_steps TEXT,
    working_files TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Metrics for performance tracking
CREATE TABLE IF NOT EXISTS metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    metric_name TEXT NOT NULL,
    metric_value REAL NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Full-text search indexes
CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
    summary, task_description, content='sessions', content_rowid='rowid'
);

CREATE VIRTUAL TABLE IF NOT EXISTS decisions_fts USING fts5(
    decision, rationale, content='decisions', content_rowid='rowid'
);

CREATE VIRTUAL TABLE IF NOT EXISTS learnings_fts USING fts5(
    learning, context, content='learnings', content_rowid='rowid'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS sessions_ai AFTER INSERT ON sessions BEGIN
    INSERT INTO sessions_fts(rowid, summary, task_description) VALUES (NEW.rowid, NEW.summary, NEW.task_description);
END;

CREATE TRIGGER IF NOT EXISTS sessions_au AFTER UPDATE ON sessions BEGIN
    INSERT INTO sessions_fts(sessions_fts, rowid, summary, task_description) VALUES('delete', OLD.rowid, OLD.summary, OLD.task_description);
    INSERT INTO sessions_fts(rowid, summary, task_description) VALUES (NEW.rowid, NEW.summary, NEW.task_description);
END;

CREATE TRIGGER IF NOT EXISTS decisions_ai AFTER INSERT ON decisions BEGIN
    INSERT INTO decisions_fts(rowid, decision, rationale) VALUES (NEW.rowid, NEW.decision, NEW.rationale);
END;

CREATE TRIGGER IF NOT EXISTS decisions_au AFTER UPDATE ON decisions BEGIN
    INSERT INTO decisions_fts(decisions_fts, rowid, decision, rationale) VALUES('delete', OLD.rowid, OLD.decision, OLD.rationale);
    INSERT INTO decisions_fts(rowid, decision, rationale) VALUES (NEW.rowid, NEW.decision, NEW.rationale);
END;

CREATE TRIGGER IF NOT EXISTS learnings_ai AFTER INSERT ON learnings BEGIN
    INSERT INTO learnings_fts(rowid, learning, context) VALUES (NEW.rowid, NEW.learning, NEW.context);
END;

CREATE TRIGGER IF NOT EXISTS learnings_au AFTER UPDATE ON learnings BEGIN
    INSERT INTO learnings_fts(learnings_fts, rowid, learning, context) VALUES('delete', OLD.rowid, OLD.learning, OLD.context);
    INSERT INTO learnings_fts(rowid, learning, context) VALUES (NEW.rowid, NEW.learning, NEW.context);
END;

-- Enable WAL mode for better concurrent access
PRAGMA journal_mode=WAL;
