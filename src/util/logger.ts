import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private level: LogLevel = 'info';
  private logFile: string;
  private initialized = false;

  constructor() {
    this.logFile = path.join(
      os.homedir(),
      '.autoclaude',
      'logs',
      'autoclaude.log',
    );
  }

  private ensureDirectory(): void {
    if (this.initialized) return;
    try {
      const dir = path.dirname(this.logFile);
      fs.mkdirSync(dir, { recursive: true });
      this.initialized = true;
    } catch {
      // Silently ignore - we'll handle write failures gracefully
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  setLogFile(filePath: string): void {
    this.logFile = filePath.replace(/^~/, os.homedir());
    this.initialized = false;
  }

  private write(level: LogLevel, message: string): void {
    if (LOG_LEVELS[level] < LOG_LEVELS[this.level]) return;

    this.ensureDirectory();

    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;

    try {
      fs.appendFileSync(this.logFile, line, 'utf-8');
    } catch {
      // Gracefully handle write failures - never throw
    }
  }

  debug(message: string): void {
    this.write('debug', message);
  }

  info(message: string): void {
    this.write('info', message);
  }

  warn(message: string): void {
    this.write('warn', message);
  }

  error(message: string): void {
    this.write('error', message);
  }
}

export const logger = new Logger();
export type { LogLevel };
