import type { InvocationContext } from '@azure/functions';
import YahooFinance from 'yahoo-finance2';

export interface YahooFinanceQuoteRequest {
  symbols: string[];
  fields?: string[];
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
  private static queue: Promise<void> = Promise.resolve();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(yahooFinance?: any) {
    this.yahooFinance =
      yahooFinance ??
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

  private async enqueue<T>(task: () => Promise<T>): Promise<T> {
    // Append the new task to the chain
    const result = YahooFinanceService.queue.then(task);

    // Update the queue to wait for this task (even if it fails)
    YahooFinanceService.queue = result.then(
      () => {},
      () => {},
    );

    return result;
  }

  async getQuotes(request: YahooFinanceQuoteRequest, context: InvocationContext): Promise<YahooFinanceResponse> {
    return this.enqueue(async () => {
      try {
        context.log(
          `Fetching quotes for symbols: ${request.symbols.join(',')} with fields: ${request.fields?.join(',') ?? 'all'}`,
        );

        const options: { fields?: string[] } = {};
        if (request.fields && request.fields.length > 0) {
          options.fields = request.fields;
        }

        const response = await this.yahooFinance.quote(request.symbols, options);

        context.log(`Successfully retrieved quotes for ${request.symbols.length} symbols`);

        if (request.fields && request.fields.length > 0) {
          const fields = request.fields;
          if (Array.isArray(response)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return response.map((quote: any) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const filtered: any = { symbol: quote.symbol };
              fields.forEach((f) => {
                if (Object.hasOwn(quote, f)) {
                  filtered[f] = quote[f];
                }
              });
              return filtered;
            });
          } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const filtered: any = { symbol: response.symbol };
            fields.forEach((f) => {
              if (Object.hasOwn(response, f)) {
                filtered[f] = response[f];
              }
            });
            return filtered;
          }
        }

        return response;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        context.error(`Error fetching quotes from Yahoo Finance: ${errorMessage}`, error);
        throw error;
      }
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getHistoricalData(request: YahooFinanceHistoricalRequest, context: InvocationContext): Promise<any> {
    return this.enqueue(async () => {
      try {
        const interval = request.interval === '1w' ? '1wk' : (request.interval ?? '1d');
        context.log(
          `Fetching historical data for ticker: ${request.ticker} from ${request.from} to ${request.to} with interval: ${interval}`,
        );

        // Add one day to `to` date because Yahoo Finance API treats period2 as exclusive
        const toDate = new Date(request.to);
        toDate.setDate(toDate.getDate() + 1);
        const period2 = toDate.toISOString().split('T')[0];

        const response = await this.yahooFinance.chart(request.ticker, {
          period1: request.from,
          period2,
          interval,
        });

        if (response?.quotes && Array.isArray(response.quotes)) {
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

            if (Object.hasOwn(rest, 'volume')) {
              processedQuote.volume = rest.volume;
            }

            // Filter fields if requested
            if (request.fields && request.fields.length > 0) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const filtered: any = { date: processedQuote.date };
              request.fields.forEach((f) => {
                if (Object.hasOwn(processedQuote, f)) {
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
    });
  }

  validateQuoteRequest(symbols: string[], fields?: string[]): { isValid: boolean; error?: string } {
    if (!symbols || symbols.length === 0) {
      return { isValid: false, error: 'At least one symbol must be provided' };
    }

    const validSymbols = symbols.filter((s) => s && s.trim().length > 0);

    if (validSymbols.length !== symbols.length) {
      return { isValid: false, error: 'Invalid symbols provided' };
    }

    if (validSymbols.length > 50) {
      return { isValid: false, error: 'Maximum 50 symbols allowed per request' };
    }

    if (fields && fields.length > 0) {
      const validFields = fields.filter((f) => f && f.trim().length > 0);
      if (validFields.length !== fields.length) {
        return { isValid: false, error: 'Invalid fields provided' };
      }
      if (validFields.length > 20) {
        return { isValid: false, error: 'Maximum 20 fields allowed per request' };
      }
    }

    return { isValid: true };
  }

  private getIntervalLimit(interval: string): { maxRangeDays: number; intervalName: string } {
    const intradayIntervals = ['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h'];
    const isIntraday = intradayIntervals.includes(interval);

    if (isIntraday) {
      return { maxRangeDays: 7, intervalName: 'intraday' };
    }

    switch (interval) {
      case '1wk':
        return { maxRangeDays: 365 * 50, intervalName: 'weekly' };
      case '1d':
        return { maxRangeDays: 365 * 5, intervalName: 'daily' };
      case '1mo':
      case '3mo':
        return { maxRangeDays: 365 * 50, intervalName: 'monthly' };
      default:
        return { maxRangeDays: 365, intervalName: 'other' };
    }
  }

  private validateDates(
    from: string,
    to: string,
  ): { isValid: boolean; error?: string; fromDate?: Date; toDate?: Date } {
    if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      return { isValid: false, error: 'From date must be in yyyy-MM-dd format' };
    }

    if (!to || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return { isValid: false, error: 'To date must be in yyyy-MM-dd format' };
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);

    if (Number.isNaN(fromDate.getTime())) {
      return { isValid: false, error: 'Invalid from date' };
    }

    if (Number.isNaN(toDate.getTime())) {
      return { isValid: false, error: 'Invalid to date' };
    }

    if (fromDate > toDate) {
      return { isValid: false, error: 'From date must be before or equal to to date' };
    }

    return { isValid: true, fromDate, toDate };
  }

  private validateRange(fromDate: Date, toDate: Date, interval?: string): { isValid: boolean; error?: string } {
    const normalizedInterval = interval === '1w' ? '1wk' : (interval ?? '1d');
    const rangeDays = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24);
    const { maxRangeDays, intervalName } = this.getIntervalLimit(normalizedInterval);

    if (rangeDays > maxRangeDays) {
      if (intervalName === 'intraday') {
        return {
          isValid: false,
          error: `Date range exceeds maximum of 7 days for intraday interval "${normalizedInterval}"`,
        };
      }
      const maxYears = Math.round(maxRangeDays / 365);
      return {
        isValid: false,
        error: `Date range exceeds maximum of ${maxYears} years for ${intervalName} interval`,
      };
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

    const validIntervals = ['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h', '1d', '1w', '1wk', '1mo', '3mo'];
    if (interval && !validIntervals.includes(interval)) {
      return { isValid: false, error: 'Interval must be one of: ' + validIntervals.join(', ') };
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

    const dateValidation = this.validateDates(from, to);
    if (!dateValidation.isValid) {
      return { isValid: false, error: dateValidation.error };
    }

    return this.validateRange(dateValidation.fromDate!, dateValidation.toDate!, interval);
  }
}
