/**
 * Logger Tests
 *
 * Tests for the structured logging system.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createLogger, initLogger, Logger, LogLevel } from '../src/utils/logger.js';

describe('Logger', () => {
  // Capture console output
  let consoleLogs: string[] = [];
  let consoleErrors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;

  beforeEach(() => {
    consoleLogs = [];
    consoleErrors = [];
    console.log = (...args: unknown[]) => {
      consoleLogs.push(args.map(String).join(' '));
    };
    console.error = (...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(' '));
    };
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  describe('createLogger', () => {
    it('should create a logger with module name', () => {
      const logger = createLogger('TestModule');
      expect(logger).toBeDefined();
    });

    it('should include module name in output', () => {
      const logger = createLogger('TestModule');
      Logger.setLevel(LogLevel.DEBUG);

      logger.info('test message');

      expect(consoleLogs.length).toBe(1);
      expect(consoleLogs[0]).toContain('TestModule');
      expect(consoleLogs[0]).toContain('test message');
    });
  });

  describe('log levels', () => {
    beforeEach(() => {
      Logger.setLevel(LogLevel.DEBUG);
    });

    it('should log debug messages when level is DEBUG', () => {
      const logger = createLogger('Test');
      logger.debug('debug message');

      expect(consoleLogs.length).toBe(1);
      expect(consoleLogs[0]).toContain('DEBUG');
    });

    it('should log info messages', () => {
      const logger = createLogger('Test');
      logger.info('info message');

      expect(consoleLogs.length).toBe(1);
      expect(consoleLogs[0]).toContain('INFO');
    });

    it('should log warn messages', () => {
      const logger = createLogger('Test');
      logger.warn('warn message');

      expect(consoleLogs.length).toBe(1);
      expect(consoleLogs[0]).toContain('WARN');
    });

    it('should log error messages to stderr', () => {
      const logger = createLogger('Test');
      logger.error('error message');

      expect(consoleErrors.length).toBe(1);
      expect(consoleErrors[0]).toContain('ERROR');
    });

    it('should filter messages below current level', () => {
      Logger.setLevel(LogLevel.WARN);
      const logger = createLogger('Test');

      logger.debug('debug');
      logger.info('info');
      logger.warn('warn');

      expect(consoleLogs.length).toBe(1); // Only warn
      expect(consoleLogs[0]).toContain('WARN');
    });
  });

  describe('setLevel', () => {
    it('should accept LogLevel enum', () => {
      Logger.setLevel(LogLevel.ERROR);
      expect(Logger.getLevel()).toBe(LogLevel.ERROR);
    });

    it('should accept string levels', () => {
      Logger.setLevel('debug');
      expect(Logger.getLevel()).toBe(LogLevel.DEBUG);

      Logger.setLevel('INFO');
      expect(Logger.getLevel()).toBe(LogLevel.INFO);

      Logger.setLevel('WARN');
      expect(Logger.getLevel()).toBe(LogLevel.WARN);

      Logger.setLevel('error');
      expect(Logger.getLevel()).toBe(LogLevel.ERROR);
    });

    it('should default to INFO for invalid strings', () => {
      Logger.setLevel('invalid');
      expect(Logger.getLevel()).toBe(LogLevel.INFO);
    });
  });

  describe('initLogger', () => {
    it('should initialize with config level', () => {
      initLogger({ level: 'debug' });
      expect(Logger.getLevel()).toBe(LogLevel.DEBUG);
    });

    it('should default to env variable LOG_LEVEL', () => {
      process.env.LOG_LEVEL = 'warn';
      initLogger();
      expect(Logger.getLevel()).toBe(LogLevel.WARN);
    });
  });

  describe('child logger', () => {
    it('should create child with prefixed module name', () => {
      const parent = createLogger('Parent');
      const child = parent.child('Child');

      Logger.setLevel(LogLevel.DEBUG);
      child.info('test');

      expect(consoleLogs[0]).toContain('Parent:Child');
    });
  });

  describe('data logging', () => {
    it('should include data in log output', () => {
      Logger.setLevel(LogLevel.DEBUG);
      const logger = createLogger('Test');

      logger.info('message', { key: 'value', num: 42 });

      expect(consoleLogs[0]).toContain('message');
      expect(consoleLogs[0]).toContain('key');
      expect(consoleLogs[0]).toContain('value');
    });

    it('should include error info for error logs', () => {
      Logger.setLevel(LogLevel.DEBUG);
      const logger = createLogger('Test');

      const testError = new Error('test error');
      logger.error('Something failed', testError);

      expect(consoleErrors[0]).toContain('Something failed');
      expect(consoleErrors[0]).toContain('test error');
    });
  });
});
