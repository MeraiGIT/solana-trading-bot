/**
 * Token Info Service
 *
 * Fetches token information from DexScreener API.
 * Used for displaying token details and determining routing.
 */

// DexScreener API
const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex';

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  priceUsd: number;
  priceNative: number; // Price in SOL
  liquidity: number;
  volume24h: number;
  priceChange24h: number;
  marketCap?: number;
  fdv?: number;
  pairAddress?: string;
  dexId: string;
  dexName: string;
  isPumpFun: boolean;
  onBondingCurve: boolean;
  url?: string;
  imageUrl?: string;
  createdAt?: Date;
}

export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  liquidity?: {
    usd: number;
    base: number;
    quote: number;
  };
  volume?: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  priceChange?: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: {
    imageUrl?: string;
    websites?: { url: string }[];
    socials?: { platform: string; handle: string }[];
  };
}

export interface DexScreenerResponse {
  schemaVersion: string;
  pairs: DexScreenerPair[] | null;
}

/**
 * Token Info Service for fetching token data
 */
export class TokenInfoService {
  private cache: Map<string, { data: TokenInfo; expiry: number }>;
  private cacheTtlMs: number;

  constructor(options?: { cacheTtlMs?: number }) {
    this.cache = new Map();
    this.cacheTtlMs = options?.cacheTtlMs ?? 30000; // 30 second cache
  }

  /**
   * Get token information from DexScreener
   */
  async getTokenInfo(tokenAddress: string): Promise<TokenInfo | null> {
    // Check cache
    const cached = this.cache.get(tokenAddress);
    if (cached && cached.expiry > Date.now()) {
      return cached.data;
    }

    try {
      const response = await fetch(`${DEXSCREENER_API}/tokens/${tokenAddress}`);

      if (!response.ok) {
        return null;
      }

      const data = await response.json() as DexScreenerResponse;

      if (!data.pairs || data.pairs.length === 0) {
        return null;
      }

      // Filter for Solana pairs only
      const solanaPairs = data.pairs.filter(p => p.chainId === 'solana');

      if (solanaPairs.length === 0) {
        return null;
      }

      // Sort by liquidity (highest first) to get the best pair
      const sortedPairs = solanaPairs
        .filter(p => p.liquidity?.usd && p.liquidity.usd > 1000) // Min $1k liquidity
        .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));

      if (sortedPairs.length === 0) {
        // Fallback to any pair if none have liquidity
        const bestPair = solanaPairs[0];
        return this.pairToTokenInfo(bestPair);
      }

      const bestPair = sortedPairs[0];
      const tokenInfo = this.pairToTokenInfo(bestPair);

      // Cache the result
      this.cache.set(tokenAddress, {
        data: tokenInfo,
        expiry: Date.now() + this.cacheTtlMs,
      });

      return tokenInfo;
    } catch (error) {
      console.error('Error fetching token info:', error);
      return null;
    }
  }

  /**
   * Convert DexScreener pair to TokenInfo
   */
  private pairToTokenInfo(pair: DexScreenerPair): TokenInfo {
    const isPumpFun = pair.dexId?.toLowerCase().includes('pump') ||
                      pair.url?.toLowerCase().includes('pump.fun');

    // PumpFun tokens on bonding curve typically have very low liquidity
    // and dexId contains 'pumpfun' (not 'raydium' after graduation)
    const onBondingCurve = isPumpFun &&
                          pair.dexId === 'pumpfun' &&
                          (pair.liquidity?.usd ?? 0) < 100000;

    return {
      address: pair.baseToken.address,
      symbol: pair.baseToken.symbol,
      name: pair.baseToken.name,
      decimals: 9, // Most Solana tokens use 9 decimals
      priceUsd: parseFloat(pair.priceUsd) || 0,
      priceNative: parseFloat(pair.priceNative) || 0,
      liquidity: pair.liquidity?.usd ?? 0,
      volume24h: pair.volume?.h24 ?? 0,
      priceChange24h: pair.priceChange?.h24 ?? 0,
      marketCap: pair.marketCap,
      fdv: pair.fdv,
      pairAddress: pair.pairAddress,
      dexId: pair.dexId,
      dexName: this.getDexName(pair.dexId),
      isPumpFun,
      onBondingCurve,
      url: pair.url,
      imageUrl: pair.info?.imageUrl,
      createdAt: pair.pairCreatedAt ? new Date(pair.pairCreatedAt) : undefined,
    };
  }

  /**
   * Get human-readable DEX name
   */
  private getDexName(dexId: string): string {
    const dexNames: Record<string, string> = {
      'raydium': 'Raydium',
      'orca': 'Orca',
      'meteora': 'Meteora',
      'pumpfun': 'PumpFun',
      'jupiter': 'Jupiter',
      'lifinity': 'Lifinity',
      'phoenix': 'Phoenix',
      'openbook': 'OpenBook',
    };
    return dexNames[dexId.toLowerCase()] || dexId;
  }

  /**
   * Search for tokens by symbol or name
   */
  async searchTokens(query: string): Promise<TokenInfo[]> {
    try {
      const response = await fetch(`${DEXSCREENER_API}/search?q=${encodeURIComponent(query)}`);

      if (!response.ok) {
        return [];
      }

      const data = await response.json() as { pairs?: DexScreenerPair[] };
      const pairs = data.pairs || [];

      // Filter for Solana and deduplicate by token address
      const seen = new Set<string>();
      const results: TokenInfo[] = [];

      for (const pair of pairs) {
        if (pair.chainId !== 'solana') continue;
        if (seen.has(pair.baseToken.address)) continue;

        seen.add(pair.baseToken.address);
        results.push(this.pairToTokenInfo(pair));

        if (results.length >= 10) break; // Limit results
      }

      return results;
    } catch {
      return [];
    }
  }

  /**
   * Get multiple tokens info at once
   */
  async getMultipleTokens(addresses: string[]): Promise<Map<string, TokenInfo>> {
    const results = new Map<string, TokenInfo>();

    // DexScreener supports comma-separated addresses
    const chunks = this.chunkArray(addresses, 30); // API limit

    for (const chunk of chunks) {
      try {
        const response = await fetch(
          `${DEXSCREENER_API}/tokens/${chunk.join(',')}`
        );

        if (!response.ok) continue;

        const data = await response.json() as DexScreenerResponse;
        const pairs = data.pairs || [];

        // Group by token address
        for (const pair of pairs) {
          if (pair.chainId !== 'solana') continue;

          const address = pair.baseToken.address;
          if (!results.has(address)) {
            results.set(address, this.pairToTokenInfo(pair));
          }
        }
      } catch {
        // Continue with next chunk
      }
    }

    return results;
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Helper to chunk array
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

// Utility functions
export function formatPrice(price: number): string {
  if (price === 0) return '$0.00';

  if (price < 0.00001) {
    return `$${price.toExponential(2)}`;
  } else if (price < 0.01) {
    return `$${price.toFixed(6)}`;
  } else if (price < 1) {
    return `$${price.toFixed(4)}`;
  } else if (price < 1000) {
    return `$${price.toFixed(2)}`;
  } else {
    return `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }
}

export function formatNumber(num: number): string {
  if (num >= 1e9) {
    return `${(num / 1e9).toFixed(2)}B`;
  } else if (num >= 1e6) {
    return `${(num / 1e6).toFixed(2)}M`;
  } else if (num >= 1e3) {
    return `${(num / 1e3).toFixed(2)}K`;
  }
  return num.toFixed(2);
}

export function formatPercentage(pct: number): string {
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

export { DEXSCREENER_API };
