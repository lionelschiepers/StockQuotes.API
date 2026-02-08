import axios from 'axios';
import type { InvocationContext } from '@azure/functions';
import type { CacheService } from './cacheService';
import { cacheService } from './cacheService';

// Alpha Vantage API response interfaces
interface AlphaVantageStatementResponse {
  symbol: string;
  annualReports?: StatementReport[];
  quarterlyReports?: StatementReport[];
}

interface StatementReport {
  fiscalDateEnding: string;
  [key: string]: string | number | undefined;
}

// Merged response interfaces
export interface MergedStatementReport {
  fiscalDateEnding: string;
  incomeStatement: StatementReport | null;
  balanceSheet: StatementReport | null;
  cashFlow: StatementReport | null;
}

export interface FinancialStatementsResponse {
  symbol: string;
  annualReports: MergedStatementReport[];
  quarterlyReports: MergedStatementReport[];
  cacheStatus: 'HIT' | 'MISS';
}

export class AlphaVantageService {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private cache: CacheService;
  private readonly timeout: number = 10000; // 10 seconds

  constructor(cache: CacheService = cacheService) {
    this.apiKey = process.env.ALPHAVANTAGE_API_KEY ?? '';
    this.baseUrl = 'https://www.alphavantage.co/query';
    this.cache = cache;
  }

  async getFinancialStatements(
    ticker: string,
    period: 'yearly' | 'quarterly' | undefined,
    limitStatements: number | undefined,
    fields: string[] | undefined,
    context: InvocationContext,
  ): Promise<FinancialStatementsResponse> {
    // Normalize ticker
    const normalizedTicker = ticker.toUpperCase().trim();

    // Validate ticker
    const validation = this.validateTicker(normalizedTicker);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    // Check cache first - include period, limit, and fields in cache key
    const cacheKey = this.buildCacheKey(normalizedTicker, period, limitStatements, fields);
    const cachedData = this.cache.get<FinancialStatementsResponse>(cacheKey);

    if (cachedData) {
      context.log(
        `Cache hit for ${normalizedTicker}${period ? ` (${period})` : ''}${limitStatements ? ` (limit:${limitStatements})` : ''}${fields ? ` (fields:${fields.length})` : ''}`,
      );
      return { ...cachedData, cacheStatus: 'HIT' };
    }

    context.log(
      `Cache miss for ${normalizedTicker}${period ? ` (${period})` : ''}${limitStatements ? ` (limit:${limitStatements})` : ''}${fields ? ` (fields:${fields.length})` : ''}, fetching from API`,
    );

    // Fetch from API (without limit or fields - we want full data in cache for flexibility)
    const data = await this.fetchFromApi(normalizedTicker, context);

    // Filter data based on period
    const filteredData = this.filterByPeriod(data, period);

    // Apply statement limit
    const limitedData = this.applyStatementLimit(filteredData, limitStatements);

    // Apply field filtering
    const fieldFilteredData = this.applyFieldFilter(limitedData, fields);

    // Store in cache
    this.cache.set(cacheKey, fieldFilteredData);

    return { ...fieldFilteredData, cacheStatus: 'MISS' };
  }

  private buildCacheKey(
    ticker: string,
    period: 'yearly' | 'quarterly' | undefined,
    limitStatements: number | undefined,
    fields: string[] | undefined,
  ): string {
    const parts = ['statements', ticker];
    if (period) parts.push(period);
    if (limitStatements) parts.push(`limit${limitStatements}`);
    if (fields && fields.length > 0) parts.push(`fields:${fields.join(',')}`);
    return parts.join(':');
  }

  private applyStatementLimit(
    data: Omit<FinancialStatementsResponse, 'cacheStatus'>,
    limitStatements: number | undefined,
  ): Omit<FinancialStatementsResponse, 'cacheStatus'> {
    if (!limitStatements) {
      return data;
    }

    return {
      symbol: data.symbol,
      annualReports: data.annualReports.slice(0, limitStatements),
      quarterlyReports: data.quarterlyReports.slice(0, limitStatements),
    };
  }

  private applyFieldFilter(
    data: Omit<FinancialStatementsResponse, 'cacheStatus'>,
    fields: string[] | undefined,
  ): Omit<FinancialStatementsResponse, 'cacheStatus'> {
    if (!fields || fields.length === 0) {
      return data;
    }

    // Check if a field should be included based on field paths
    const shouldIncludeField = (statementType: string, fieldName: string): boolean => {
      // fiscalDateEnding is handled separately
      if (fieldName === 'fiscalDateEnding') return false;
      const fullPath = `${statementType}.${fieldName}`;
      return fields.some((f) => fullPath === f);
    };

    // Filter a single report based on field paths
    const filterReport = (report: StatementReport | null, statementType: string): StatementReport | null => {
      if (!report) return null;

      // Always include fiscalDateEnding in the individual statement
      const filtered: StatementReport = { fiscalDateEnding: report.fiscalDateEnding };
      for (const [key, value] of Object.entries(report)) {
        if (key !== 'fiscalDateEnding' && shouldIncludeField(statementType, key)) {
          filtered[key] = value;
        }
      }
      return filtered;
    };

    // Filter merged reports
    const filterMergedReport = (report: MergedStatementReport): MergedStatementReport => {
      return {
        fiscalDateEnding: report.fiscalDateEnding,
        incomeStatement: report.incomeStatement ? filterReport(report.incomeStatement, 'incomeStatement') : null,
        balanceSheet: report.balanceSheet ? filterReport(report.balanceSheet, 'balanceSheet') : null,
        cashFlow: report.cashFlow ? filterReport(report.cashFlow, 'cashFlow') : null,
      };
    };

    return {
      symbol: data.symbol,
      annualReports: data.annualReports.map(filterMergedReport),
      quarterlyReports: data.quarterlyReports.map(filterMergedReport),
    };
  }

  private filterByPeriod(
    data: Omit<FinancialStatementsResponse, 'cacheStatus'>,
    period: 'yearly' | 'quarterly' | undefined,
  ): Omit<FinancialStatementsResponse, 'cacheStatus'> {
    if (!period) {
      return data;
    }

    if (period === 'yearly') {
      return {
        symbol: data.symbol,
        annualReports: data.annualReports,
        quarterlyReports: [],
      };
    }

    if (period === 'quarterly') {
      return {
        symbol: data.symbol,
        annualReports: [],
        quarterlyReports: data.quarterlyReports,
      };
    }

    return data;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async fetchFromApi(
    ticker: string,
    context: InvocationContext,
  ): Promise<Omit<FinancialStatementsResponse, 'cacheStatus'>> {
    context.log(`Fetching financial statements for ${ticker} from Alpha Vantage`);

    if (!this.apiKey) {
      throw new Error('ALPHAVANTAGE_API_KEY environment variable is not set');
    }

    try {
      // Free tier Alpha Vantage API limit: 2 requests per second
      // Make sequential requests with delay to respect rate limit
      const incomeResponse = await this.fetchStatement(ticker, 'INCOME_STATEMENT', context);

      // Wait 600ms before next request (stays under 2 req/sec limit)
      await this.delay(600);
      const balanceResponse = await this.fetchStatement(ticker, 'BALANCE_SHEET', context);

      // Wait 600ms before next request
      await this.delay(600);
      const cashFlowResponse = await this.fetchStatement(ticker, 'CASH_FLOW', context);

      // Validate responses
      if (!this.isValidResponse(incomeResponse)) {
        throw new Error('Invalid income statement response from Alpha Vantage');
      }
      if (!this.isValidResponse(balanceResponse)) {
        throw new Error('Invalid balance sheet response from Alpha Vantage');
      }
      if (!this.isValidResponse(cashFlowResponse)) {
        throw new Error('Invalid cash flow response from Alpha Vantage');
      }

      // Merge reports
      const annualReports = this.mergeReports(
        incomeResponse.annualReports ?? [],
        balanceResponse.annualReports ?? [],
        cashFlowResponse.annualReports ?? [],
      );

      const quarterlyReports = this.mergeReports(
        incomeResponse.quarterlyReports ?? [],
        balanceResponse.quarterlyReports ?? [],
        cashFlowResponse.quarterlyReports ?? [],
      );

      context.log(`Successfully fetched and merged financial statements for ${ticker}`);

      return {
        symbol: ticker,
        annualReports,
        quarterlyReports,
      };
    } catch (error: unknown) {
      context.error(`Error fetching financial statements for ${ticker}:`, error);
      throw error;
    }
  }

  private async fetchStatement(
    ticker: string,
    function_name: string,
    context: InvocationContext,
  ): Promise<AlphaVantageStatementResponse> {
    const url = `${this.baseUrl}?function=${function_name}&symbol=${ticker}&apikey=${this.apiKey}`;

    context.log(`Fetching ${function_name} for ${ticker}`);

    try {
      const response = await axios.get<AlphaVantageStatementResponse>(url, {
        timeout: this.timeout,
        headers: {
          Accept: 'application/json',
        },
      });

      // Check for API limit reached or other errors
      if (response.data && 'Note' in response.data) {
        throw new Error('Alpha Vantage API rate limit reached');
      }

      if (response.data && 'Information' in response.data) {
        throw new Error(`Alpha Vantage API error: ${(response.data as Record<string, string>).Information}`);
      }

      return response.data;
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
          throw new Error(`Timeout fetching ${function_name} for ${ticker}`);
        }
        if (error.response) {
          throw new Error(
            `Alpha Vantage API error for ${function_name}: ${error.response.status} - ${error.response.statusText}`,
          );
        }
      }
      throw error;
    }
  }

  private isValidResponse(response: AlphaVantageStatementResponse): boolean {
    return response && typeof response === 'object' && 'symbol' in response;
  }

  private mergeReports(
    incomeReports: StatementReport[],
    balanceReports: StatementReport[],
    cashFlowReports: StatementReport[],
  ): MergedStatementReport[] {
    // Create maps for quick lookup
    const incomeMap = new Map<string, StatementReport>();
    const balanceMap = new Map<string, StatementReport>();
    const cashFlowMap = new Map<string, StatementReport>();

    // Build lookup maps
    for (const report of incomeReports) {
      if (report.fiscalDateEnding) {
        incomeMap.set(report.fiscalDateEnding, report);
      }
    }

    for (const report of balanceReports) {
      if (report.fiscalDateEnding) {
        balanceMap.set(report.fiscalDateEnding, report);
      }
    }

    for (const report of cashFlowReports) {
      if (report.fiscalDateEnding) {
        cashFlowMap.set(report.fiscalDateEnding, report);
      }
    }

    // Get all unique fiscal dates
    const allDates = new Set<string>([...incomeMap.keys(), ...balanceMap.keys(), ...cashFlowMap.keys()]);

    // Create merged reports
    const mergedReports: MergedStatementReport[] = [];
    for (const fiscalDateEnding of allDates) {
      mergedReports.push({
        fiscalDateEnding,
        incomeStatement: incomeMap.get(fiscalDateEnding) ?? null,
        balanceSheet: balanceMap.get(fiscalDateEnding) ?? null,
        cashFlow: cashFlowMap.get(fiscalDateEnding) ?? null,
      });
    }

    // Sort by date descending (most recent first)
    mergedReports.sort((a, b) => {
      return new Date(b.fiscalDateEnding).getTime() - new Date(a.fiscalDateEnding).getTime();
    });

    return mergedReports;
  }

  validateTicker(ticker: string): { isValid: boolean; error?: string } {
    if (!ticker || ticker.trim().length === 0) {
      return { isValid: false, error: 'Ticker symbol is required' };
    }

    // Basic ticker validation (1-10 alphanumeric characters, may contain dots for some exchanges)
    const tickerRegex = /^[A-Z0-9.]{1,10}$/;
    if (!tickerRegex.test(ticker.toUpperCase())) {
      return {
        isValid: false,
        error: 'Invalid ticker symbol format. Must be 1-10 alphanumeric characters (may contain dots)',
      };
    }

    return { isValid: true };
  }
}

// Export singleton instance
export const alphaVantageService = new AlphaVantageService();
