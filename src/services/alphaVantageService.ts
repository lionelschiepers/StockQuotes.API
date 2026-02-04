import axios from 'axios';
import { InvocationContext } from '@azure/functions';
import { cacheService, CacheService } from './cacheService';

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
    this.apiKey = process.env.ALPHAVANTAGE_API_KEY || '';
    this.baseUrl = 'https://www.alphavantage.co/query';
    this.cache = cache;
  }

  async getFinancialStatements(ticker: string, context: InvocationContext): Promise<FinancialStatementsResponse> {
    // Normalize ticker
    const normalizedTicker = ticker.toUpperCase().trim();

    // Validate ticker
    const validation = this.validateTicker(normalizedTicker);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    // Check cache first
    const cacheKey = `statements:${normalizedTicker}`;
    const cachedData = this.cache.get<FinancialStatementsResponse>(cacheKey);

    if (cachedData) {
      context.log(`Cache hit for ${normalizedTicker}`);
      return { ...cachedData, cacheStatus: 'HIT' };
    }

    context.log(`Cache miss for ${normalizedTicker}, fetching from API`);

    // Fetch from API
    const data = await this.fetchFromApi(normalizedTicker, context);

    // Store in cache
    this.cache.set(cacheKey, data);

    return { ...data, cacheStatus: 'MISS' };
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
      // Make parallel requests to all three endpoints
      const [incomeResponse, balanceResponse, cashFlowResponse] = await Promise.all([
        this.fetchStatement(ticker, 'INCOME_STATEMENT', context),
        this.fetchStatement(ticker, 'BALANCE_SHEET', context),
        this.fetchStatement(ticker, 'CASH_FLOW', context),
      ]);

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
        incomeResponse.annualReports || [],
        balanceResponse.annualReports || [],
        cashFlowResponse.annualReports || [],
      );

      const quarterlyReports = this.mergeReports(
        incomeResponse.quarterlyReports || [],
        balanceResponse.quarterlyReports || [],
        cashFlowResponse.quarterlyReports || [],
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
        incomeStatement: incomeMap.get(fiscalDateEnding) || null,
        balanceSheet: balanceMap.get(fiscalDateEnding) || null,
        cashFlow: cashFlowMap.get(fiscalDateEnding) || null,
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
