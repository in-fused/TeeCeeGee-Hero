/**
 * Simple logger for scraper operations
 */

import { createWriteStream, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// Ensure logs directory exists
const LOGS_DIR = process.env.LOGS_DIR || './logs';
if (!existsSync(LOGS_DIR)) {
  mkdirSync(LOGS_DIR, { recursive: true });
}

// Log levels
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
}

class Logger {
  private logStream: ReturnType<typeof createWriteStream>;
  private errorStream: ReturnType<typeof createWriteStream>;
  private minLevel: LogLevel;

  private levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor() {
    this.logStream = createWriteStream(join(LOGS_DIR, 'scraper.log'), { flags: 'a' });
    this.errorStream = createWriteStream(join(LOGS_DIR, 'scraper-error.log'), { flags: 'a' });
    this.minLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levelPriority[level] >= this.levelPriority[this.minLevel];
  }

  private formatLogEntry(entry: LogEntry): string {
    const dataStr = entry.data ? ` ${JSON.stringify(entry.data)}` : '';
    return `[${entry.timestamp}] ${entry.level.toUpperCase()}: ${entry.message}${dataStr}\n`;
  }

  private write(entry: LogEntry): void {
    const formatted = this.formatLogEntry(entry);
    
    // Write to file
    this.logStream.write(formatted);
    
    // Also write errors to separate error log
    if (entry.level === 'error' || entry.level === 'warn') {
      this.errorStream.write(formatted);
    }

    // Console output in development
    if (process.env.NODE_ENV !== 'production') {
      console.log(formatted.trim());
    }
  }

  debug(data: unknown, message?: string): void {
    if (!this.shouldLog('debug')) return;
    
    // Handle pino-style logging where first arg is data object
    if (typeof data === 'object' && data !== null && message) {
      this.write({
        timestamp: new Date().toISOString(),
        level: 'debug',
        message,
        data,
      });
    } else {
      this.write({
        timestamp: new Date().toISOString(),
        level: 'debug',
        message: String(data),
      });
    }
  }

  info(data: unknown, message?: string): void {
    if (!this.shouldLog('info')) return;
    
    if (typeof data === 'object' && data !== null && message) {
      this.write({
        timestamp: new Date().toISOString(),
        level: 'info',
        message,
        data,
      });
    } else {
      this.write({
        timestamp: new Date().toISOString(),
        level: 'info',
        message: String(data),
      });
    }
  }

  warn(data: unknown, message?: string): void {
    if (!this.shouldLog('warn')) return;
    
    if (typeof data === 'object' && data !== null && message) {
      this.write({
        timestamp: new Date().toISOString(),
        level: 'warn',
        message,
        data,
      });
    } else {
      this.write({
        timestamp: new Date().toISOString(),
        level: 'warn',
        message: String(data),
      });
    }
  }

  error(data: unknown, message?: string): void {
    if (!this.shouldLog('error')) return;
    
    if (typeof data === 'object' && data !== null && message) {
      this.write({
        timestamp: new Date().toISOString(),
        level: 'error',
        message,
        data,
      });
    } else {
      this.write({
        timestamp: new Date().toISOString(),
        level: 'error',
        message: String(data),
      });
    }
  }

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }
}

// Export singleton instance
export const logger = new Logger();
