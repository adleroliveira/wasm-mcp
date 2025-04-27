export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

class Logger {
  private level: LogLevel = LogLevel.INFO;

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  debug(...args: any[]): void {
    if (this.level <= LogLevel.DEBUG) {
      console.debug('[DEBUG]', ...args);
    }
  }

  info(...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      console.info('[INFO]', ...args);
    }
  }

  warn(...args: any[]): void {
    if (this.level <= LogLevel.WARN) {
      console.warn('[WARN]', ...args);
    }
  }

  error(...args: any[]): void {
    if (this.level <= LogLevel.ERROR) {
      console.error('[ERROR]', ...args);
    }
  }
}

export const logger = new Logger(); 