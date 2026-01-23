/**
 * Audit Logging Service
 *
 * Logs all security-sensitive operations:
 * - Wallet operations (create, import, export, delete)
 * - Trades (buy, sell)
 * - Withdrawals
 * - Settings changes
 * - Failed operations
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { appConfig } from '../utils/env.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Audit');

/**
 * Audit action types
 */
export enum AuditAction {
  // Wallet operations
  WALLET_CREATE = 'wallet_create',
  WALLET_IMPORT = 'wallet_import',
  WALLET_EXPORT = 'wallet_export',
  WALLET_DELETE = 'wallet_delete',

  // Trading operations
  TRADE_BUY = 'trade_buy',
  TRADE_SELL = 'trade_sell',
  TRADE_SL_TRIGGERED = 'trade_sl_triggered',
  TRADE_TP_TRIGGERED = 'trade_tp_triggered',

  // Order operations
  ORDER_CREATE_SL = 'order_create_sl',
  ORDER_CREATE_TP = 'order_create_tp',
  ORDER_CANCEL = 'order_cancel',

  // Withdrawal operations
  WITHDRAWAL_INITIATE = 'withdrawal_initiate',
  WITHDRAWAL_COMPLETE = 'withdrawal_complete',
  WITHDRAWAL_FAILED = 'withdrawal_failed',

  // Settings operations
  SETTINGS_UPDATE = 'settings_update',

  // Security events
  RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',
  INVALID_INPUT = 'invalid_input',
  AUTH_FAILURE = 'auth_failure',
}

/**
 * Resource types being audited
 */
export enum AuditResource {
  WALLET = 'wallet',
  TRADE = 'trade',
  ORDER = 'order',
  WITHDRAWAL = 'withdrawal',
  SETTINGS = 'settings',
  SECURITY = 'security',
}

/**
 * Audit log entry
 */
export interface AuditLogEntry {
  userId: string;
  action: AuditAction;
  resourceType: AuditResource;
  resourceId?: string;
  details?: Record<string, unknown>;
  success?: boolean;
  errorMessage?: string;
}

/**
 * Audit Service
 */
class AuditService {
  private client: SupabaseClient;
  private enabled: boolean = true;

  constructor() {
    this.client = createClient(
      appConfig.supabaseUrl,
      appConfig.supabaseAnonKey
    );
  }

  /**
   * Log an audit event
   */
  async log(entry: AuditLogEntry): Promise<void> {
    if (!this.enabled) {
      return;
    }

    try {
      const { error } = await this.client
        .from('tb_audit_logs')
        .insert({
          user_id: entry.userId,
          action: entry.action,
          resource_type: entry.resourceType,
          resource_id: entry.resourceId,
          details: entry.details ? this.sanitizeDetails(entry.details) : null,
          success: entry.success ?? true,
          error_message: entry.errorMessage,
        });

      if (error) {
        logger.error('Failed to write audit log', error, {
          action: entry.action,
          userId: entry.userId,
        });
      } else {
        logger.debug('Audit logged', {
          action: entry.action,
          userId: entry.userId,
          resourceType: entry.resourceType,
        });
      }
    } catch (error) {
      // Don't throw on audit failures - just log and continue
      logger.error('Audit logging exception', error);
    }
  }

  /**
   * Sanitize details to remove sensitive information
   */
  private sanitizeDetails(details: Record<string, unknown>): Record<string, unknown> {
    const sensitiveFields = [
      'privateKey', 'secretKey', 'encryptedPrivateKey',
      'password', 'secret', 'key', 'mnemonic', 'seed',
    ];

    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(details)) {
      const lowerKey = key.toLowerCase();

      // Check if this is a sensitive field
      if (sensitiveFields.some(f => lowerKey.includes(f.toLowerCase()))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // Recursively sanitize nested objects
        sanitized[key] = this.sanitizeDetails(value as Record<string, unknown>);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Log a wallet creation
   */
  async logWalletCreate(userId: string, publicAddress: string, isImported: boolean): Promise<void> {
    await this.log({
      userId,
      action: isImported ? AuditAction.WALLET_IMPORT : AuditAction.WALLET_CREATE,
      resourceType: AuditResource.WALLET,
      resourceId: publicAddress,
      details: {
        isImported,
        publicAddress: publicAddress.slice(0, 8) + '...',
      },
    });
  }

  /**
   * Log a wallet export
   */
  async logWalletExport(userId: string, publicAddress: string): Promise<void> {
    await this.log({
      userId,
      action: AuditAction.WALLET_EXPORT,
      resourceType: AuditResource.WALLET,
      resourceId: publicAddress,
      details: {
        publicAddress: publicAddress.slice(0, 8) + '...',
        warning: 'Private key was exported',
      },
    });
  }

  /**
   * Log a wallet deletion
   */
  async logWalletDelete(userId: string, publicAddress: string): Promise<void> {
    await this.log({
      userId,
      action: AuditAction.WALLET_DELETE,
      resourceType: AuditResource.WALLET,
      resourceId: publicAddress,
      details: {
        publicAddress: publicAddress.slice(0, 8) + '...',
      },
    });
  }

  /**
   * Log a trade
   */
  async logTrade(
    userId: string,
    action: 'buy' | 'sell',
    details: {
      tokenAddress: string;
      tokenSymbol?: string;
      amountSol?: number;
      amountTokens?: number;
      txSignature?: string;
      dexUsed?: string;
      success: boolean;
      errorMessage?: string;
    }
  ): Promise<void> {
    await this.log({
      userId,
      action: action === 'buy' ? AuditAction.TRADE_BUY : AuditAction.TRADE_SELL,
      resourceType: AuditResource.TRADE,
      resourceId: details.txSignature,
      details: {
        tokenAddress: details.tokenAddress.slice(0, 8) + '...',
        tokenSymbol: details.tokenSymbol,
        amountSol: details.amountSol,
        amountTokens: details.amountTokens,
        dexUsed: details.dexUsed,
      },
      success: details.success,
      errorMessage: details.errorMessage,
    });
  }

  /**
   * Log a withdrawal
   */
  async logWithdrawal(
    userId: string,
    details: {
      destination: string;
      amountSol: number;
      txSignature?: string;
      success: boolean;
      errorMessage?: string;
    }
  ): Promise<void> {
    await this.log({
      userId,
      action: details.success
        ? AuditAction.WITHDRAWAL_COMPLETE
        : AuditAction.WITHDRAWAL_FAILED,
      resourceType: AuditResource.WITHDRAWAL,
      resourceId: details.txSignature,
      details: {
        destination: details.destination.slice(0, 8) + '...',
        amountSol: details.amountSol,
      },
      success: details.success,
      errorMessage: details.errorMessage,
    });
  }

  /**
   * Log a security event
   */
  async logSecurityEvent(
    userId: string,
    action: AuditAction,
    details: Record<string, unknown>
  ): Promise<void> {
    await this.log({
      userId,
      action,
      resourceType: AuditResource.SECURITY,
      details,
      success: false,
    });
  }

  /**
   * Log a settings change
   */
  async logSettingsChange(
    userId: string,
    changes: Record<string, { old: unknown; new: unknown }>
  ): Promise<void> {
    await this.log({
      userId,
      action: AuditAction.SETTINGS_UPDATE,
      resourceType: AuditResource.SETTINGS,
      details: changes,
    });
  }

  /**
   * Log an order creation
   */
  async logOrderCreate(
    userId: string,
    orderType: 'stop_loss' | 'take_profit',
    details: {
      orderId: string;
      positionId: string;
      tokenAddress: string;
      triggerPrice: number;
      sellPercentage: number;
    }
  ): Promise<void> {
    await this.log({
      userId,
      action: orderType === 'stop_loss'
        ? AuditAction.ORDER_CREATE_SL
        : AuditAction.ORDER_CREATE_TP,
      resourceType: AuditResource.ORDER,
      resourceId: details.orderId,
      details: {
        ...details,
        tokenAddress: details.tokenAddress.slice(0, 8) + '...',
      },
    });
  }

  /**
   * Log an order trigger
   */
  async logOrderTriggered(
    userId: string,
    orderType: 'stop_loss' | 'take_profit',
    details: {
      orderId: string;
      txSignature?: string;
      soldAmount: string;
      receivedSol: string;
      success: boolean;
      errorMessage?: string;
    }
  ): Promise<void> {
    await this.log({
      userId,
      action: orderType === 'stop_loss'
        ? AuditAction.TRADE_SL_TRIGGERED
        : AuditAction.TRADE_TP_TRIGGERED,
      resourceType: AuditResource.ORDER,
      resourceId: details.orderId,
      details: {
        txSignature: details.txSignature,
        soldAmount: details.soldAmount,
        receivedSol: details.receivedSol,
      },
      success: details.success,
      errorMessage: details.errorMessage,
    });
  }

  /**
   * Get recent audit logs for a user
   */
  async getRecentLogs(
    userId: string,
    limit: number = 50
  ): Promise<Array<{
    action: string;
    resourceType: string;
    resourceId: string | null;
    details: Record<string, unknown> | null;
    success: boolean;
    createdAt: Date;
  }>> {
    const { data, error } = await this.client
      .from('tb_audit_logs')
      .select('action, resource_type, resource_id, details, success, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !data) {
      logger.error('Failed to fetch audit logs', error);
      return [];
    }

    return data.map(row => ({
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      details: row.details,
      success: row.success,
      createdAt: new Date(row.created_at),
    }));
  }

  /**
   * Enable/disable audit logging
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    logger.info(`Audit logging ${enabled ? 'enabled' : 'disabled'}`);
  }
}

// Export singleton instance
export const auditService = new AuditService();
