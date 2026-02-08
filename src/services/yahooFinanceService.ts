import { InvocationContext } from '@azure/functions';
import YahooFinance from 'yahoo-finance2';

export interface YahooFinanceQuoteRequest {
  symbols: string[];
  fields: string[];
}

export interface YahooFinanceHistoricalRequest {
  ticker: string;
  from: string;
  to: string;
  interval?: string;
  fields?: string[];
}

export interface YahooFinanceResponse {
  [key: string]: unknown;
}

export class YahooFinanceService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly yahooFinance: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(yahooFinance?: any) {
    this.yahooFinance =
      yahooFinance ||
      new YahooFinance({
        suppressNotices: ['yahooSurvey'],
        fetchOptions: {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
          },
        },
      });
  }

  async getQuotes(request: YahooFinanceQuoteRequest, context: InvocationContext): Promise<YahooFinanceResponse> {
    try {
      context.log(`Fetching quotes for symbols: ${request.symbols.join(',')} with fields: ${request.fields.join(',')}`);

      const response = await this.yahooFinance.quote(request.symbols, { fields: request.fields });

      context.log(`Successfully retrieved quotes for ${request.symbols.length} symbols`);
      return response;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      context.error(`Error fetching quotes from Yahoo Finance: ${errorMessage}`, error);
      throw error;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getHistoricalData(request: YahooFinanceHistoricalRequest, context: InvocationContext): Promise<any> {
    try {
      const interval = request.interval === '1w' ? '1wk' : request.interval || '1d';
      context.log(
        `Fetching historical data for ticker: ${request.ticker} from ${request.from} to ${request.to} with interval: ${interval}`,
      );

      const response = await this.yahooFinance.chart(request.ticker, {
        period1: request.from,
        period2: request.to,
        interval,
      });

      if (response && response.quotes && Array.isArray(response.quotes)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        response.quotes = response.quotes.map((quote: any) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { adjclose, ...rest } = quote;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const processedQuote: any = {
            date: rest.date,
          };

          const priceFields = ['open', 'high', 'low', 'close'];
          priceFields.forEach((field) => {
            if (typeof rest[field] === 'number') {
              processedQuote[field] = Math.round(rest[field] * 100) / 100;
            } else {
              processedQuote[field] = rest[field];
            }
          });

          if (Object.prototype.hasOwnProperty.call(rest, 'volume')) {
            processedQuote.volume = rest.volume;
          }

          // Filter fields if requested
          if (request.fields && request.fields.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const filtered: any = { date: processedQuote.date };
            request.fields.forEach((f) => {
              if (Object.prototype.hasOwnProperty.call(processedQuote, f)) {
                filtered[f] = processedQuote[f];
              }
            });
            return filtered;
          }

          return processedQuote;
        });
      }

      context.log(`Successfully retrieved historical data for ${request.ticker}`);
      return response;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      context.error(`Error fetching historical data from Yahoo Finance: ${errorMessage}`, error);
      throw error;
    }
  }

  validateQuoteRequest(symbols: string[], fields: string[]): { isValid: boolean; error?: string } {
    if (!symbols || symbols.length === 0) {
      return { isValid: false, error: 'At least one symbol must be provided' };
    }

    if (!fields || fields.length === 0) {
      return { isValid: false, error: 'At least one field must be provided' };
    }

    const validSymbols = symbols.filter((s) => s && s.trim().length > 0);
    const validFields = fields.filter((f) => f && f.trim().length > 0);

    if (validSymbols.length !== symbols.length) {
      return { isValid: false, error: 'Invalid symbols provided' };
    }

    if (validFields.length !== fields.length) {
      return { isValid: false, error: 'Invalid fields provided' };
    }

    if (validSymbols.length > 50) {
      return { isValid: false, error: 'Maximum 50 symbols allowed per request' };
    }

    if (validFields.length > 20) {
      return { isValid: false, error: 'Maximum 20 fields allowed per request' };
    }

    return { isValid: true };
  }

  validateHistoricalRequest(
    ticker: string,
    from: string,
    to: string,
    interval?: string,
    fields?: string[],
  ): { isValid: boolean; error?: string } {
    if (!ticker || ticker.trim().length === 0) {
      return { isValid: false, error: 'Ticker must be provided' };
    }

    if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      return { isValid: false, error: 'From date must be in yyyy-MM-dd format' };
    }

    if (!to || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return { isValid: false, error: 'To date must be in yyyy-MM-dd format' };
    }

    if (interval && !['1d', '1w', '1wk'].includes(interval)) {
      return { isValid: false, error: 'Interval must be "1d", "1w" or "1wk"' };
    }

    if (fields && fields.length > 0) {
      const invalidFields = fields.filter((f) => !f || f.trim().length === 0);
      if (invalidFields.length > 0) {
        return { isValid: false, error: 'Invalid fields provided' };
      }
      if (fields.length > 20) {
        return { isValid: false, error: 'Maximum 20 fields allowed per request' };
      }
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);

    if (isNaN(fromDate.getTime())) {
      return { isValid: false, error: 'Invalid from date' };
    }

    if (isNaN(toDate.getTime())) {
      return { isValid: false, error: 'Invalid to date' };
    }

    if (fromDate > toDate) {
      return { isValid: false, error: 'From date must be before or equal to to date' };
    }

    return { isValid: true };
  }
}
