/**
 * Structured Logger
 *
 * Production-grade logging with:
 * - Log levels (debug, info, warn, error)
 * - Timestamps
 * - Context/module names
 * - JSON output for production
 * - Colored console output for development
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

interface LogEntry {
  timestamp: string;
  level: string;
  module: string;
  message: string;
  data?: Record<string, unknown>;
}

const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
};

const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: '\x1b[36m', // Cyan
  [LogLevel.INFO]: '\x1b[32m',  // Green
  [LogLevel.WARN]: '\x1b[33m',  // Yellow
  [LogLevel.ERROR]: '\x1b[31m', // Red
};

const RESET_COLOR = '\x1b[0m';

class Logger {
  private module: string;
  private static globalLevel: LogLevel = LogLevel.INFO;
  private static isProduction: boolean = process.env.NODE_ENV === 'production';

  constructor(module: string) {
    this.module = module;
  }

  /**
   * Set the global log level
   */
  static setLevel(level: LogLevel | string): void {
    if (typeof level === 'string') {
      const levelMap: Record<string, LogLevel> = {
        debug: LogLevel.DEBUG,
        info: LogLevel.INFO,
        warn: LogLevel.WARN,
        error: LogLevel.ERROR,
      };
      Logger.globalLevel = levelMap[level.toLowerCase()] ?? LogLevel.INFO;
    } else {
      Logger.globalLevel = level;
    }
  }

  /**
   * Get current log level
   */
  static getLevel(): LogLevel {
    return Logger.globalLevel;
  }

  /**
   * Format a log entry for output
   */
  private formatEntry(level: LogLevel, message: string, data?: Record<string, unknown>): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level: LOG_LEVEL_NAMES[level],
      module: this.module,
      message,
      ...(data && Object.keys(data).length > 0 ? { data } : {}),
    };
  }

  /**
   * Output a log entry
   */
  private output(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (level < Logger.globalLevel) {
      return;
    }

    const entry = this.formatEntry(level, message, data);

    if (Logger.isProduction) {
      // JSON output for production (easy to parse by log aggregators)
      const output = level === LogLevel.ERROR ? console.error : console.log;
      output(JSON.stringify(entry));
    } else {
      // Colored console output for development
      const color = LOG_LEVEL_COLORS[level];
      const levelStr = LOG_LEVEL_NAMES[level].padEnd(5);
      const timestamp = entry.timestamp.split('T')[1].split('.')[0]; // HH:MM:SS
      const dataStr = data && Object.keys(data).length > 0
        ? ` ${JSON.stringify(data)}`
        : '';

      const output = level === LogLevel.ERROR ? console.error : console.log;
      output(`${color}[${timestamp}] ${levelStr}${RESET_COLOR} [${this.module}] ${message}${dataStr}`);
    }
  }

  /**
   * Log a debug message
   */
  debug(message: string, data?: Record<string, unknown>): void {
    this.output(LogLevel.DEBUG, message, data);
  }

  /**
   * Log an info message
   */
  info(message: string, data?: Record<string, unknown>): void {
    this.output(LogLevel.INFO, message, data);
  }

  /**
   * Log a warning message
   */
  warn(message: string, data?: Record<string, unknown>): void {
    this.output(LogLevel.WARN, message, data);
  }

  /**
   * Log an error message
   */
  error(message: string, error?: Error | unknown, data?: Record<string, unknown>): void {
    const errorData = error instanceof Error
      ? { error: error.message, stack: error.stack }
      : error
        ? { error: String(error) }
        : undefined;

    this.output(LogLevel.ERROR, message, { ...errorData, ...data });
  }

  /**
   * Create a child logger with additional context
   */
  child(subModule: string): Logger {
    return new Logger(`${this.module}:${subModule}`);
  }
}

/**
 * Create a logger for a module
 */
export function createLogger(module: string): Logger {
  return new Logger(module);
}

/**
 * Initialize the logger with configuration
 */
export function initLogger(config?: { level?: string }): void {
  if (config?.level) {
    Logger.setLevel(config.level);
  } else {
    // Default from environment
    const envLevel = process.env.LOG_LEVEL || 'info';
    Logger.setLevel(envLevel);
  }
}

// Pre-configured loggers for common modules
export const loggers = {
  bot: createLogger('Bot'),
  wallet: createLogger('Wallet'),
  trading: createLogger('Trading'),
  jupiter: createLogger('Jupiter'),
  jito: createLogger('Jito'),
  pumpfun: createLogger('PumpFun'),
  database: createLogger('Database'),
  rpc: createLogger('RPC'),
  priceMonitor: createLogger('PriceMonitor'),
  security: createLogger('Security'),
  health: createLogger('Health'),
};

export { Logger };
