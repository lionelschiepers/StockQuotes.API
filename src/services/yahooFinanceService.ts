import type { InvocationContext } from '@azure/functions';
import YahooFinance from 'yahoo-finance2';
import { UpstreamTimeoutError } from '../errors';
import { parseStrictDate } from '../utils/date';

const SUMMARY_MODULES = [
  'assetProfile',
  'balanceSheetHistory',
  'balanceSheetHistoryQuarterly',
  'calendarEvents',
  'cashflowStatementHistory',
  'cashflowStatementHistoryQuarterly',
  'defaultKeyStatistics',
  'earnings',
  'earningsHistory',
  'earningsTrend',
  'financialData',
  'fundOwnership',
  'fundPerformance',
  'fundProfile',
  'incomeStatementHistory',
  'incomeStatementHistoryQuarterly',
  'indexTrend',
  'insiderHolders',
  'insiderTransactions',
  'institutionOwnership',
  'majorDirectHolders',
  'majorHoldersBreakdown',
  'netSharePurchaseActivity',
  'price',
  'quoteType',
  'recommendationTrend',
  'secFilings',
  'sectorTrend',
  'summaryDetail',
  'summaryProfile',
  'topHoldings',
  'upgradeDowngradeHistory',
] as const;

const DEFAULT_SUMMARY_MODULES: readonly string[] = ['financialData', 'defaultKeyStatistics', 'recommendationTrend'];

export type YahooQuote = Record<string, unknown>;
export type YahooSummary = Record<string, unknown>;

export interface YahooChartResponse {
  quotes: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface OptionsContract {
  strike: number;
  [key: string]: unknown;
}

export interface OptionsChainEntry {
  expirationDate?: Date;
  calls?: OptionsContract[];
  puts?: OptionsContract[];
  [key: string]: unknown;
}

export interface OptionsResponse {
  underlyingSymbol?: string;
  expirationDates?: Date[];
  strikes?: number[];
  hasMiniOptions?: boolean;
  quote?: { regularMarketPrice?: number; regularMarketDayHigh?: number };
  options?: OptionsChainEntry[];
  [key: string]: unknown;
}

/**
 * Minimal surface of the yahoo-finance2 client used by this service.
 * Keeps the service testable without importing the library's full types.
 */
export interface YahooFinanceClient {
  quote(symbols: string[], options?: { fields?: string[] }): Promise<YahooQuote | YahooQuote[]>;
  chart(ticker: string, options: { period1: string; period2: string; interval: string }): Promise<YahooChartResponse>;
  quoteSummary(ticker: string, options: { modules: string[] }): Promise<YahooSummary>;
  options(
    ticker: string,
    options: { date?: Date },
    config?: { validateResult: boolean },
  ): Promise<OptionsResponse | undefined>;
}

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

export interface YahooFinanceOptionsRequest {
  ticker: string;
  expirationDate?: string;
  expirationDatesCount?: number;
  filter?: Array<'calls' | 'puts'>;
  limit?: number;
}

export interface YahooFinanceSummaryRequest {
  ticker: string;
  modules?: string[];
}

export interface YahooFinanceResponse {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Copies the requested fields that exist on the source, plus any always-included keys. */
function pickFields(source: Record<string, unknown>, fields: string[], always: string[] = []): Record<string, unknown> {
  const picked: Record<string, unknown> = {};

  for (const key of always) {
    picked[key] = source[key];
  }
  for (const field of fields) {
    if (Object.hasOwn(source, field)) {
      picked[field] = source[field];
    }
  }

  return picked;
}

export class YahooFinanceService {
  private readonly yahooFinance: YahooFinanceClient;
  private readonly queueTimeoutMs: number;
  private static activeCount = 0;
  private static readonly waiters: Array<{ resolve: () => void; timer: ReturnType<typeof setTimeout> }> = [];
  private static readonly maxConcurrent = 2;

  constructor(yahooFinance?: YahooFinanceClient, queueTimeoutMs = 10_000) {
    this.yahooFinance =
      yahooFinance ??
      (new YahooFinance({
        suppressNotices: ['yahooSurvey'],
        fetchOptions: {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
          },
        },
      }) as unknown as YahooFinanceClient);
    this.queueTimeoutMs = queueTimeoutMs;
  }

  private async enqueue<T>(task: () => Promise<T>): Promise<T> {
    await this.acquireSlot();

    try {
      return await task();
    } finally {
      this.releaseSlot();
    }
  }

  private acquireSlot(): Promise<void> {
    if (YahooFinanceService.activeCount < YahooFinanceService.maxConcurrent) {
      YahooFinanceService.activeCount++;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: { resolve: () => void; timer: ReturnType<typeof setTimeout> } = {
        resolve: () => {
          clearTimeout(waiter.timer);
          // The slot is transferred from the releasing request, so the active
          // count must not change here.
          resolve();
        },
        timer: undefined as unknown as ReturnType<typeof setTimeout>,
      };

      waiter.timer = setTimeout(() => {
        const index = YahooFinanceService.waiters.indexOf(waiter);
        if (index !== -1) {
          YahooFinanceService.waiters.splice(index, 1);
        }
        reject(new UpstreamTimeoutError('Timed out waiting for a Yahoo Finance request slot'));
      }, this.queueTimeoutMs);

      waiter.timer.unref?.();
      YahooFinanceService.waiters.push(waiter);
    });
  }

  private releaseSlot(): void {
    const next = YahooFinanceService.waiters.shift();
    if (next) {
      // Transfer the slot directly to the next waiter.
      next.resolve();
      return;
    }

    YahooFinanceService.activeCount = Math.max(0, YahooFinanceService.activeCount - 1);
  }

  async getQuotes(request: YahooFinanceQuoteRequest, context: InvocationContext): Promise<YahooQuote | YahooQuote[]> {
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
            return response.filter(isRecord).map((quote) => pickFields(quote, fields, ['symbol']));
          }
          if (isRecord(response)) {
            return pickFields(response, fields, ['symbol']);
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

  async getHistoricalData(
    request: YahooFinanceHistoricalRequest,
    context: InvocationContext,
  ): Promise<YahooChartResponse> {
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

        if (response.quotes && Array.isArray(response.quotes)) {
          response.quotes = response.quotes.filter(isRecord).map((quote) => {
            const { adjclose: _adjclose, ...rest } = quote;
            const processedQuote: Record<string, unknown> = { date: rest.date };

            for (const field of ['open', 'high', 'low', 'close']) {
              const value = rest[field];
              processedQuote[field] = typeof value === 'number' ? Math.round(value * 100) / 100 : value;
            }

            if (Object.hasOwn(rest, 'volume')) {
              processedQuote.volume = rest.volume;
            }

            if (request.fields && request.fields.length > 0) {
              return pickFields(processedQuote, request.fields, ['date']);
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

  async getQuoteSummary(request: YahooFinanceSummaryRequest, context: InvocationContext): Promise<YahooSummary> {
    return this.enqueue(async () => {
      try {
        const modules = request.modules && request.modules.length > 0 ? request.modules : [...DEFAULT_SUMMARY_MODULES];
        context.log(`Fetching quote summary for ticker: ${request.ticker} with modules: ${modules.join(',')}`);

        const response = await this.yahooFinance.quoteSummary(request.ticker, { modules });

        context.log(`Successfully retrieved quote summary for ${request.ticker}`);
        return response;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        context.error(`Error fetching quote summary from Yahoo Finance: ${errorMessage}`, error);
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

    const fromDate = parseStrictDate(from);
    const toDate = parseStrictDate(to);

    if (!fromDate) {
      return { isValid: false, error: 'Invalid from date' };
    }

    if (!toDate) {
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

    if (!dateValidation.fromDate || !dateValidation.toDate) {
      return { isValid: false, error: 'Invalid date range' };
    }

    return this.validateRange(dateValidation.fromDate, dateValidation.toDate, interval);
  }

  async getOptions(request: YahooFinanceOptionsRequest, context: InvocationContext): Promise<OptionsResponse> {
    return this.enqueue(async () => {
      try {
        context.log(`Fetching options for ticker: ${request.ticker}`);

        if (request.expirationDate) {
          const options: { date: Date } = { date: new Date(request.expirationDate) };
          const response = await this.fetchOptions(request.ticker, options);
          context.log(`Successfully retrieved options for ${request.ticker}`);
          return this.applyOptionsFilters(response, request);
        }

        const initialResponse = await this.fetchOptions(request.ticker, {});
        const allExpirationDates: Date[] = initialResponse.expirationDates ?? [];

        if (request.expirationDatesCount && request.expirationDatesCount > 1 && allExpirationDates.length > 1) {
          const datesToFetch = allExpirationDates.slice(
            0,
            Math.min(request.expirationDatesCount, allExpirationDates.length),
          );
          const allOptions: OptionsChainEntry[] = [];

          for (const expDate of datesToFetch) {
            const options: { date: Date } = { date: expDate };
            const response = await this.fetchOptions(request.ticker, options);
            if (response.options?.[0]) {
              allOptions.push(response.options[0]);
            }
          }

          initialResponse.options = allOptions;
          context.log(
            `Successfully retrieved options for ${request.ticker} with ${allOptions.length} expiration dates`,
          );
        }

        return this.applyOptionsFilters(initialResponse, request);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        context.error(`Error fetching options from Yahoo Finance: ${errorMessage}`, error);
        throw error;
      }
    });
  }

  private async fetchOptions(ticker: string, options: { date?: Date }): Promise<OptionsResponse> {
    const response = await this.yahooFinance.options(ticker, options, { validateResult: false });

    if (!response) {
      return {
        underlyingSymbol: ticker,
        expirationDates: [],
        strikes: [],
        hasMiniOptions: false,
        quote: { regularMarketPrice: 0 },
        options: [],
      };
    }

    return response;
  }

  private applyOptionsFilters(response: OptionsResponse, request: YahooFinanceOptionsRequest): OptionsResponse {
    const marketPrice = response.quote?.regularMarketPrice ?? response.quote?.regularMarketDayHigh ?? 0;

    if (request.filter && request.filter.length > 0 && response.options && Array.isArray(response.options)) {
      const includeCalls = request.filter.includes('calls');
      const includePuts = request.filter.includes('puts');

      response.options = response.options.map((option) => {
        const filteredOption: OptionsChainEntry = {};
        if (option.expirationDate) {
          filteredOption.expirationDate = option.expirationDate;
        }
        if (includeCalls && option.calls) {
          filteredOption.calls = option.calls;
        }
        if (includePuts && option.puts) {
          filteredOption.puts = option.puts;
        }
        return filteredOption;
      });
    }

    if (request.limit && request.limit > 0 && marketPrice > 0 && response.options && Array.isArray(response.options)) {
      const limit = request.limit;

      response.options = response.options.map((option) => {
        const limitedOption: OptionsChainEntry = {};
        if (option.expirationDate) {
          limitedOption.expirationDate = option.expirationDate;
        }

        if (option.calls && option.calls.length > 0) {
          const validCalls = option.calls.filter(
            (call) => typeof call.strike === 'number' && call.strike > marketPrice,
          );
          validCalls.sort((a, b) => a.strike - b.strike);
          limitedOption.calls = validCalls.slice(0, limit);
        }

        if (option.puts && option.puts.length > 0) {
          const validPuts = option.puts.filter((put) => typeof put.strike === 'number' && put.strike < marketPrice);
          validPuts.sort((a, b) => b.strike - a.strike);
          limitedOption.puts = validPuts.slice(0, limit);
        }

        return limitedOption;
      });
    }

    return response;
  }

  private validateOptionsTicker(ticker: string): string | undefined {
    if (!ticker || ticker.trim().length === 0) {
      return 'Ticker must be provided';
    }
    return undefined;
  }

  private validateOptionsExpirationDate(expirationDate?: string): string | undefined {
    if (!expirationDate) {
      return undefined;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expirationDate)) {
      return 'Expiration date must be in yyyy-MM-dd format';
    }
    if (!parseStrictDate(expirationDate)) {
      return 'Invalid expiration date';
    }
    return undefined;
  }

  private validateOptionsExpirationDatesCount(expirationDatesCount?: number): string | undefined {
    if (expirationDatesCount === undefined) {
      return undefined;
    }
    if (!Number.isInteger(expirationDatesCount) || expirationDatesCount < 1 || expirationDatesCount > 24) {
      return 'expirationDatesCount must be an integer between 1 and 24';
    }
    return undefined;
  }

  private validateOptionsExpirationConflict(
    expirationDate?: string,
    expirationDatesCount?: number,
  ): string | undefined {
    if (expirationDate && expirationDatesCount) {
      return 'Cannot specify both expirationDate and expirationDatesCount';
    }
    return undefined;
  }

  private validateOptionsFilter(filter?: string[]): string | undefined {
    if (!filter || filter.length === 0) {
      return undefined;
    }
    const validFilters = new Set(['calls', 'puts']);
    const invalidFilters = filter.filter((f) => !validFilters.has(f));
    if (invalidFilters.length > 0) {
      return `Invalid filter values: ${invalidFilters.join(', ')}. Valid values are: calls, puts`;
    }
    return undefined;
  }

  private validateOptionsLimit(limit?: number): string | undefined {
    if (limit === undefined) {
      return undefined;
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      return 'Limit must be an integer between 1 and 50';
    }
    return undefined;
  }

  validateOptionsRequest(
    ticker: string,
    expirationDate?: string,
    expirationDatesCount?: number,
    filter?: string[],
    limit?: number,
  ): { isValid: boolean; error?: string } {
    const error =
      this.validateOptionsTicker(ticker) ??
      this.validateOptionsExpirationDate(expirationDate) ??
      this.validateOptionsExpirationDatesCount(expirationDatesCount) ??
      this.validateOptionsExpirationConflict(expirationDate, expirationDatesCount) ??
      this.validateOptionsFilter(filter) ??
      this.validateOptionsLimit(limit);

    return error ? { isValid: false, error } : { isValid: true };
  }

  validateSummaryRequest(ticker: string, modules?: string[]): { isValid: boolean; error?: string } {
    if (!ticker || ticker.trim().length === 0) {
      return { isValid: false, error: 'Ticker must be provided' };
    }

    if (modules && modules.length > 0) {
      const invalidModules = modules.filter(
        (m) => !m || !SUMMARY_MODULES.includes(m as (typeof SUMMARY_MODULES)[number]),
      );
      if (invalidModules.length > 0) {
        return { isValid: false, error: `Invalid modules: ${invalidModules.join(', ')}` };
      }
      if (modules.length > 20) {
        return { isValid: false, error: 'Maximum 20 modules allowed per request' };
      }
    }

    return { isValid: true };
  }
}
