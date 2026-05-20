import axios from 'axios';
import type { InvocationContext } from '@azure/functions';
import type { CacheService } from './cacheService';
import { cacheService } from './cacheService';

export interface ExchangeRateResponse {
  data: string;
  contentType: string;
}

export class ExchangeRateService {
  private readonly ecbUrl = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
  private readonly cache: CacheService;

  constructor(cache: CacheService = cacheService) {
    this.cache = cache;
  }

  async getDailyRates(context: InvocationContext): Promise<ExchangeRateResponse> {
    const cacheKey = 'ecb-daily-rates';

    // Check if daily rates are already in the cache
    const cached = this.cache.get<ExchangeRateResponse>(cacheKey);
    if (cached) {
      context.log('Successfully retrieved ECB exchange rates from cache');
      return cached;
    }

    try {
      context.log('Fetching daily exchange rates from ECB');

      const response = await axios.get<string>(this.ecbUrl, {
        timeout: 10000, // 10 second timeout
        headers: {
          'User-Agent': 'Azure-Function/1.0',
          Accept: 'application/xml,text/xml',
        },
      });

      context.log(`Successfully retrieved exchange rates. Status: ${response.status}`);

      const contentTypeHeader = response.headers['content-type'];
      const contentType = typeof contentTypeHeader === 'string' ? contentTypeHeader : 'application/xml';

      const result: ExchangeRateResponse = {
        data: response.data,
        contentType,
      };

      // Store daily exchange rates in the cache
      this.cache.set(cacheKey, result);

      return result;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      context.error(`Error fetching exchange rates from ECB: ${errorMessage}`, error);
      throw error;
    }
  }

  validateRequest(): { isValid: boolean; error?: string } {
    // For now, the ECB endpoint doesn't require specific validation
    // This can be extended if we add parameters later
    return { isValid: true };
  }
}

// Export singleton instance
export const exchangeRateService = new ExchangeRateService();
