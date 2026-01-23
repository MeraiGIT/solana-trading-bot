/**
 * Health Check Server
 *
 * Provides HTTP endpoints for production monitoring:
 * - /health - Overall health status
 * - /ready - Readiness probe
 * - /live - Liveness probe
 *
 * For Railway deployment monitoring.
 */

import http from 'http';
import { Connection } from '@solana/web3.js';
import { createClient } from '@supabase/supabase-js';
import { appConfig } from '../utils/env.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Health');

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  checks: {
    database: CheckResult;
    rpc: CheckResult;
    bot: CheckResult;
  };
}

interface CheckResult {
  status: 'ok' | 'degraded' | 'error';
  latency?: number;
  message?: string;
}

/**
 * Health Check Service
 */
export class HealthCheckServer {
  private server: http.Server | null = null;
  private port: number;
  private startTime: number;
  private botHealthy: boolean = false;
  private supabaseClient = createClient(appConfig.supabaseUrl, appConfig.supabaseAnonKey);
  private rpcConnection = new Connection(appConfig.solanaRpcUrl, 'confirmed');

  constructor(port: number = 3000) {
    this.port = port;
    this.startTime = Date.now();
  }

  /**
   * Start the health check server
   */
  start(): void {
    this.server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${this.port}`);

      // Set CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'application/json');

      try {
        switch (url.pathname) {
          case '/health':
            await this.handleHealth(res);
            break;
          case '/ready':
            await this.handleReady(res);
            break;
          case '/live':
            this.handleLive(res);
            break;
          case '/metrics':
            this.handleMetrics(res);
            break;
          default:
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Not found' }));
        }
      } catch (error) {
        logger.error('Health check error', error);
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });

    this.server.listen(this.port, () => {
      logger.info(`Health check server started on port ${this.port}`);
    });
  }

  /**
   * Stop the health check server
   */
  stop(): void {
    if (this.server) {
      this.server.close(() => {
        logger.info('Health check server stopped');
      });
      this.server = null;
    }
  }

  /**
   * Update bot health status
   */
  setBotHealthy(healthy: boolean): void {
    this.botHealthy = healthy;
  }

  /**
   * Handle /health endpoint - full health status
   */
  private async handleHealth(res: http.ServerResponse): Promise<void> {
    const [dbCheck, rpcCheck] = await Promise.all([
      this.checkDatabase(),
      this.checkRpc(),
    ]);

    const botCheck: CheckResult = {
      status: this.botHealthy ? 'ok' : 'error',
      message: this.botHealthy ? 'Bot running' : 'Bot not started',
    };

    const overallStatus = this.determineOverallStatus([dbCheck, rpcCheck, botCheck]);

    const healthStatus: HealthStatus = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      version: process.env.npm_package_version || '0.5.0',
      checks: {
        database: dbCheck,
        rpc: rpcCheck,
        bot: botCheck,
      },
    };

    const statusCode = overallStatus === 'unhealthy' ? 503 : 200;
    res.writeHead(statusCode);
    res.end(JSON.stringify(healthStatus, null, 2));
  }

  /**
   * Handle /ready endpoint - readiness probe
   */
  private async handleReady(res: http.ServerResponse): Promise<void> {
    const [dbCheck, rpcCheck] = await Promise.all([
      this.checkDatabase(),
      this.checkRpc(),
    ]);

    const ready = dbCheck.status === 'ok' && rpcCheck.status !== 'error' && this.botHealthy;

    if (ready) {
      res.writeHead(200);
      res.end(JSON.stringify({ ready: true }));
    } else {
      res.writeHead(503);
      res.end(JSON.stringify({
        ready: false,
        database: dbCheck.status,
        rpc: rpcCheck.status,
        bot: this.botHealthy ? 'ok' : 'not_started',
      }));
    }
  }

  /**
   * Handle /live endpoint - liveness probe
   */
  private handleLive(res: http.ServerResponse): void {
    res.writeHead(200);
    res.end(JSON.stringify({
      live: true,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
    }));
  }

  /**
   * Handle /metrics endpoint - basic metrics
   */
  private handleMetrics(res: http.ServerResponse): void {
    const memUsage = process.memoryUsage();

    res.writeHead(200);
    res.end(JSON.stringify({
      uptime_seconds: Math.floor((Date.now() - this.startTime) / 1000),
      memory: {
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        rss: Math.round(memUsage.rss / 1024 / 1024),
        unit: 'MB',
      },
      bot_healthy: this.botHealthy,
    }, null, 2));
  }

  /**
   * Check database connection
   */
  private async checkDatabase(): Promise<CheckResult> {
    const start = Date.now();

    try {
      // Simple query to check connection
      const { error } = await this.supabaseClient
        .from('tb_user_settings')
        .select('user_id')
        .limit(1);

      const latency = Date.now() - start;

      if (error) {
        return {
          status: 'error',
          latency,
          message: error.message,
        };
      }

      return {
        status: latency > 2000 ? 'degraded' : 'ok',
        latency,
        message: latency > 2000 ? 'Slow response' : undefined,
      };
    } catch (error) {
      return {
        status: 'error',
        latency: Date.now() - start,
        message: (error as Error).message,
      };
    }
  }

  /**
   * Check RPC connection
   */
  private async checkRpc(): Promise<CheckResult> {
    const start = Date.now();

    try {
      // Get slot to check connection
      await this.rpcConnection.getSlot();
      const latency = Date.now() - start;

      return {
        status: latency > 3000 ? 'degraded' : 'ok',
        latency,
        message: latency > 3000 ? 'High latency' : undefined,
      };
    } catch (error) {
      return {
        status: 'error',
        latency: Date.now() - start,
        message: (error as Error).message,
      };
    }
  }

  /**
   * Determine overall health status
   */
  private determineOverallStatus(checks: CheckResult[]): 'healthy' | 'degraded' | 'unhealthy' {
    const hasError = checks.some(c => c.status === 'error');
    const hasDegraded = checks.some(c => c.status === 'degraded');

    if (hasError) return 'unhealthy';
    if (hasDegraded) return 'degraded';
    return 'healthy';
  }
}

// Export singleton for use in index.ts
export const healthServer = new HealthCheckServer(
  parseInt(process.env.PORT || '3000', 10)
);
