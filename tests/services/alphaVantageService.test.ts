import { AlphaVantageService } from '../../src/services/alphaVantageService';
import { CacheService } from '../../src/services/cacheService';
import { InvocationContext } from '@azure/functions';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const mockContext = {
  log: jest.fn(),
  error: jest.fn(),
} as unknown as InvocationContext;

describe('AlphaVantageService', () => {
  let service: AlphaVantageService;
  let mockCache: CacheService;
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv, ALPHAVANTAGE_API_KEY: 'test-api-key' };

    mockCache = new CacheService();
    service = new AlphaVantageService(mockCache);

    (mockContext.log as jest.Mock).mockClear();
    (mockContext.error as jest.Mock).mockClear();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getFinancialStatements', () => {
    const mockIncomeStatement = {
      symbol: 'IBM',
      annualReports: [
        {
          fiscalDateEnding: '2023-12-31',
          totalRevenue: '1000000',
          netIncome: '100000',
        },
        {
          fiscalDateEnding: '2022-12-31',
          totalRevenue: '900000',
          netIncome: '90000',
        },
      ],
      quarterlyReports: [
        {
          fiscalDateEnding: '2024-03-31',
          totalRevenue: '250000',
          netIncome: '25000',
        },
      ],
    };

    const mockBalanceSheet = {
      symbol: 'IBM',
      annualReports: [
        {
          fiscalDateEnding: '2023-12-31',
          totalAssets: '5000000',
          totalLiabilities: '2000000',
        },
        {
          fiscalDateEnding: '2022-12-31',
          totalAssets: '4500000',
          totalLiabilities: '1800000',
        },
      ],
      quarterlyReports: [
        {
          fiscalDateEnding: '2024-03-31',
          totalAssets: '5200000',
          totalLiabilities: '2100000',
        },
      ],
    };

    const mockCashFlow = {
      symbol: 'IBM',
      annualReports: [
        {
          fiscalDateEnding: '2023-12-31',
          operatingCashflow: '150000',
          capitalExpenditures: '50000',
        },
        {
          fiscalDateEnding: '2022-12-31',
          operatingCashflow: '140000',
          capitalExpenditures: '45000',
        },
      ],
      quarterlyReports: [
        {
          fiscalDateEnding: '2024-03-31',
          operatingCashflow: '40000',
          capitalExpenditures: '12000',
        },
      ],
    };

    it('should fetch and merge financial statements successfully', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: mockIncomeStatement });
      mockedAxios.get.mockResolvedValueOnce({ data: mockBalanceSheet });
      mockedAxios.get.mockResolvedValueOnce({ data: mockCashFlow });

      const result = await service.getFinancialStatements('IBM', undefined, undefined, mockContext);

      expect(result.symbol).toBe('IBM');
      expect(result.cacheStatus).toBe('MISS');
      expect(result.annualReports).toHaveLength(2);
      expect(result.quarterlyReports).toHaveLength(1);

      // Check merged data for 2023
      const report2023 = result.annualReports.find((r) => r.fiscalDateEnding === '2023-12-31');
      expect(report2023).toBeDefined();
      expect(report2023?.incomeStatement).toEqual(mockIncomeStatement.annualReports[0]);
      expect(report2023?.balanceSheet).toEqual(mockBalanceSheet.annualReports[0]);
      expect(report2023?.cashFlow).toEqual(mockCashFlow.annualReports[0]);
    });

    it('should return cached data on cache hit', async () => {
      // First call - cache miss
      mockedAxios.get
        .mockResolvedValueOnce({ data: mockIncomeStatement })
        .mockResolvedValueOnce({ data: mockBalanceSheet })
        .mockResolvedValueOnce({ data: mockCashFlow });

      await service.getFinancialStatements('IBM', undefined, undefined, mockContext);

      // Second call - should use cache
      const result = await service.getFinancialStatements('IBM', undefined, undefined, mockContext);

      // axios should only have been called 3 times total (not 6)
      expect(mockedAxios.get).toHaveBeenCalledTimes(3);
      expect(result.cacheStatus).toBe('HIT');
    });

    it('should normalize ticker to uppercase', async () => {
      mockedAxios.get
        .mockResolvedValueOnce({ data: { ...mockIncomeStatement, symbol: 'ibm' } })
        .mockResolvedValueOnce({ data: { ...mockBalanceSheet, symbol: 'ibm' } })
        .mockResolvedValueOnce({ data: { ...mockCashFlow, symbol: 'ibm' } });

      const result = await service.getFinancialStatements('ibm', undefined, undefined, mockContext);

      expect(result.symbol).toBe('IBM');
    });

    it('should handle partial data (missing reports in some statements)', async () => {
      const partialIncome = {
        symbol: 'IBM',
        annualReports: [{ fiscalDateEnding: '2023-12-31', totalRevenue: '1000000' }],
        quarterlyReports: [],
      };

      const partialBalance = {
        symbol: 'IBM',
        annualReports: [
          { fiscalDateEnding: '2023-12-31', totalAssets: '5000000' },
          { fiscalDateEnding: '2022-12-31', totalAssets: '4500000' },
        ],
        quarterlyReports: [],
      };

      const partialCashFlow = {
        symbol: 'IBM',
        annualReports: [{ fiscalDateEnding: '2022-12-31', operatingCashflow: '140000' }],
        quarterlyReports: [],
      };

      mockedAxios.get
        .mockResolvedValueOnce({ data: partialIncome })
        .mockResolvedValueOnce({ data: partialBalance })
        .mockResolvedValueOnce({ data: partialCashFlow });

      const result = await service.getFinancialStatements('IBM', undefined, undefined, mockContext);

      expect(result.annualReports).toHaveLength(2);

      // 2023 should have income and balance but no cash flow
      const report2023 = result.annualReports.find((r) => r.fiscalDateEnding === '2023-12-31');
      expect(report2023?.incomeStatement).toBeTruthy();
      expect(report2023?.balanceSheet).toBeTruthy();
      expect(report2023?.cashFlow).toBeNull();

      // 2022 should have balance and cash flow but no income
      const report2022 = result.annualReports.find((r) => r.fiscalDateEnding === '2022-12-31');
      expect(report2022?.incomeStatement).toBeNull();
      expect(report2022?.balanceSheet).toBeTruthy();
      expect(report2022?.cashFlow).toBeTruthy();
    });

    it('should sort reports by date descending', async () => {
      const unsortedIncome = {
        symbol: 'IBM',
        annualReports: [
          { fiscalDateEnding: '2021-12-31', totalRevenue: '800000' },
          { fiscalDateEnding: '2023-12-31', totalRevenue: '1000000' },
          { fiscalDateEnding: '2022-12-31', totalRevenue: '900000' },
        ],
        quarterlyReports: [],
      };

      const unsortedBalance = {
        symbol: 'IBM',
        annualReports: [
          { fiscalDateEnding: '2021-12-31', totalAssets: '4000000' },
          { fiscalDateEnding: '2023-12-31', totalAssets: '5000000' },
          { fiscalDateEnding: '2022-12-31', totalAssets: '4500000' },
        ],
        quarterlyReports: [],
      };

      const unsortedCashFlow = {
        symbol: 'IBM',
        annualReports: [
          { fiscalDateEnding: '2021-12-31', operatingCashflow: '130000' },
          { fiscalDateEnding: '2023-12-31', operatingCashflow: '150000' },
          { fiscalDateEnding: '2022-12-31', operatingCashflow: '140000' },
        ],
        quarterlyReports: [],
      };

      mockedAxios.get
        .mockResolvedValueOnce({ data: unsortedIncome })
        .mockResolvedValueOnce({ data: unsortedBalance })
        .mockResolvedValueOnce({ data: unsortedCashFlow });

      const result = await service.getFinancialStatements('IBM', undefined, undefined, mockContext);

      expect(result.annualReports[0].fiscalDateEnding).toBe('2023-12-31');
      expect(result.annualReports[1].fiscalDateEnding).toBe('2022-12-31');
      expect(result.annualReports[2].fiscalDateEnding).toBe('2021-12-31');
    });

    it('should throw error when API key is not set', async () => {
      delete process.env.ALPHAVANTAGE_API_KEY;
      service = new AlphaVantageService(mockCache);

      await expect(service.getFinancialStatements('IBM', undefined, undefined, mockContext)).rejects.toThrow(
        'ALPHAVANTAGE_API_KEY environment variable is not set',
      );
    });

    it('should throw error on invalid ticker', async () => {
      await expect(service.getFinancialStatements('', undefined, undefined, mockContext)).rejects.toThrow(
        'Ticker symbol is required',
      );
    });

    it('should throw error on rate limit response', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { Note: 'API call frequency exceeded' },
      });

      await expect(service.getFinancialStatements('IBM', undefined, undefined, mockContext)).rejects.toThrow(
        'Alpha Vantage API rate limit reached',
      );
    });

    it('should throw error on API information message', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { Information: 'Invalid API call' },
      });

      await expect(service.getFinancialStatements('IBM', undefined, undefined, mockContext)).rejects.toThrow(
        'Alpha Vantage API error: Invalid API call',
      );
    });

    it('should throw timeout error on ECONNABORTED', async () => {
      const error = new Error('Request timeout') as Error & { code: string };
      error.code = 'ECONNABORTED';
      mockedAxios.get.mockRejectedValueOnce(error);
      mockedAxios.isAxiosError.mockReturnValueOnce(true);

      await expect(service.getFinancialStatements('IBM', undefined, undefined, mockContext)).rejects.toThrow(
        'Timeout fetching INCOME_STATEMENT for IBM',
      );
    });

    it('should throw timeout error on ETIMEDOUT', async () => {
      const error = new Error('Request timeout') as Error & { code: string };
      error.code = 'ETIMEDOUT';
      mockedAxios.get.mockRejectedValueOnce(error);
      mockedAxios.isAxiosError.mockReturnValueOnce(true);

      await expect(service.getFinancialStatements('IBM', undefined, undefined, mockContext)).rejects.toThrow(
        'Timeout fetching INCOME_STATEMENT for IBM',
      );
    });

    it('should throw error on HTTP error response', async () => {
      mockedAxios.get.mockRejectedValueOnce({
        response: { status: 500, statusText: 'Internal Server Error' },
        isAxiosError: true,
      });

      mockedAxios.isAxiosError.mockReturnValueOnce(true);

      await expect(service.getFinancialStatements('IBM', undefined, undefined, mockContext)).rejects.toThrow(
        'Alpha Vantage API error for INCOME_STATEMENT: 500 - Internal Server Error',
      );
    });

    describe('limitStatements', () => {
      const mockIncomeStatementLimit = {
        symbol: 'IBM',
        annualReports: [
          { fiscalDateEnding: '2023-12-31', totalRevenue: '1000000' },
          { fiscalDateEnding: '2022-12-31', totalRevenue: '900000' },
          { fiscalDateEnding: '2021-12-31', totalRevenue: '800000' },
          { fiscalDateEnding: '2020-12-31', totalRevenue: '700000' },
          { fiscalDateEnding: '2019-12-31', totalRevenue: '600000' },
        ],
        quarterlyReports: [
          { fiscalDateEnding: '2024-03-31', totalRevenue: '250000' },
          { fiscalDateEnding: '2023-12-31', totalRevenue: '240000' },
          { fiscalDateEnding: '2023-09-30', totalRevenue: '230000' },
          { fiscalDateEnding: '2023-06-30', totalRevenue: '220000' },
          { fiscalDateEnding: '2023-03-31', totalRevenue: '210000' },
        ],
      };

      const mockBalanceSheetLimit = {
        symbol: 'IBM',
        annualReports: [
          { fiscalDateEnding: '2023-12-31', totalAssets: '5000000' },
          { fiscalDateEnding: '2022-12-31', totalAssets: '4500000' },
          { fiscalDateEnding: '2021-12-31', totalAssets: '4000000' },
          { fiscalDateEnding: '2020-12-31', totalAssets: '3500000' },
          { fiscalDateEnding: '2019-12-31', totalAssets: '3000000' },
        ],
        quarterlyReports: [
          { fiscalDateEnding: '2024-03-31', totalAssets: '5200000' },
          { fiscalDateEnding: '2023-12-31', totalAssets: '5100000' },
          { fiscalDateEnding: '2023-09-30', totalAssets: '5050000' },
          { fiscalDateEnding: '2023-06-30', totalAssets: '5000000' },
          { fiscalDateEnding: '2023-03-31', totalAssets: '4950000' },
        ],
      };

      const mockCashFlowLimit = {
        symbol: 'IBM',
        annualReports: [
          { fiscalDateEnding: '2023-12-31', operatingCashflow: '150000' },
          { fiscalDateEnding: '2022-12-31', operatingCashflow: '140000' },
          { fiscalDateEnding: '2021-12-31', operatingCashflow: '130000' },
          { fiscalDateEnding: '2020-12-31', operatingCashflow: '120000' },
          { fiscalDateEnding: '2019-12-31', operatingCashflow: '110000' },
        ],
        quarterlyReports: [
          { fiscalDateEnding: '2024-03-31', operatingCashflow: '40000' },
          { fiscalDateEnding: '2023-12-31', operatingCashflow: '38000' },
          { fiscalDateEnding: '2023-09-30', operatingCashflow: '36000' },
          { fiscalDateEnding: '2023-06-30', operatingCashflow: '34000' },
          { fiscalDateEnding: '2023-03-31', operatingCashflow: '32000' },
        ],
      };

      it('should limit statements to specified count for both periods', async () => {
        mockedAxios.get
          .mockResolvedValueOnce({ data: mockIncomeStatementLimit })
          .mockResolvedValueOnce({ data: mockBalanceSheetLimit })
          .mockResolvedValueOnce({ data: mockCashFlowLimit });

        const result = await service.getFinancialStatements('IBM', undefined, 3, mockContext);

        expect(result.annualReports).toHaveLength(3);
        expect(result.quarterlyReports).toHaveLength(3);
        // Should be the most recent dates (sorted descending)
        expect(result.annualReports[0].fiscalDateEnding).toBe('2023-12-31');
        expect(result.annualReports[1].fiscalDateEnding).toBe('2022-12-31');
        expect(result.annualReports[2].fiscalDateEnding).toBe('2021-12-31');
        expect(result.quarterlyReports[0].fiscalDateEnding).toBe('2024-03-31');
        expect(result.quarterlyReports[1].fiscalDateEnding).toBe('2023-12-31');
        expect(result.quarterlyReports[2].fiscalDateEnding).toBe('2023-09-30');
      });

      it('should limit only yearly reports when period=yearly', async () => {
        mockedAxios.get
          .mockResolvedValueOnce({ data: mockIncomeStatementLimit })
          .mockResolvedValueOnce({ data: mockBalanceSheetLimit })
          .mockResolvedValueOnce({ data: mockCashFlowLimit });

        const result = await service.getFinancialStatements('IBM', 'yearly', 2, mockContext);

        expect(result.annualReports).toHaveLength(2);
        expect(result.quarterlyReports).toHaveLength(0);
        expect(result.annualReports[0].fiscalDateEnding).toBe('2023-12-31');
        expect(result.annualReports[1].fiscalDateEnding).toBe('2022-12-31');
      });

      it('should limit only quarterly reports when period=quarterly', async () => {
        mockedAxios.get
          .mockResolvedValueOnce({ data: mockIncomeStatementLimit })
          .mockResolvedValueOnce({ data: mockBalanceSheetLimit })
          .mockResolvedValueOnce({ data: mockCashFlowLimit });

        const result = await service.getFinancialStatements('IBM', 'quarterly', 4, mockContext);

        expect(result.annualReports).toHaveLength(0);
        expect(result.quarterlyReports).toHaveLength(4);
        expect(result.quarterlyReports[0].fiscalDateEnding).toBe('2024-03-31');
        expect(result.quarterlyReports[3].fiscalDateEnding).toBe('2023-06-30');
      });

      it('should return all statements when limit exceeds available count', async () => {
        mockedAxios.get
          .mockResolvedValueOnce({ data: mockIncomeStatementLimit })
          .mockResolvedValueOnce({ data: mockBalanceSheetLimit })
          .mockResolvedValueOnce({ data: mockCashFlowLimit });

        const result = await service.getFinancialStatements('IBM', undefined, 100, mockContext);

        expect(result.annualReports).toHaveLength(5);
        expect(result.quarterlyReports).toHaveLength(5);
      });

      it('should return all statements when limitStatements is not provided', async () => {
        mockedAxios.get
          .mockResolvedValueOnce({ data: mockIncomeStatementLimit })
          .mockResolvedValueOnce({ data: mockBalanceSheetLimit })
          .mockResolvedValueOnce({ data: mockCashFlowLimit });

        const result = await service.getFinancialStatements('IBM', undefined, undefined, mockContext);

        expect(result.annualReports).toHaveLength(5);
        expect(result.quarterlyReports).toHaveLength(5);
      });

      it('should use different cache keys for different limits', async () => {
        mockedAxios.get
          .mockResolvedValueOnce({ data: mockIncomeStatementLimit })
          .mockResolvedValueOnce({ data: mockBalanceSheetLimit })
          .mockResolvedValueOnce({ data: mockCashFlowLimit })
          .mockResolvedValueOnce({ data: mockIncomeStatementLimit })
          .mockResolvedValueOnce({ data: mockBalanceSheetLimit })
          .mockResolvedValueOnce({ data: mockCashFlowLimit });

        // First call with limit 2
        await service.getFinancialStatements('IBM', undefined, 2, mockContext);

        // Second call with limit 4 - should fetch new data (cache miss)
        const result = await service.getFinancialStatements('IBM', undefined, 4, mockContext);

        // axios should have been called 6 times total (not 3)
        expect(mockedAxios.get).toHaveBeenCalledTimes(6);
        expect(result.annualReports).toHaveLength(4);
      });
    });
  });

  describe('validateTicker', () => {
    it('should validate valid ticker symbols', () => {
      const validTickers = ['AAPL', 'GOOG', 'MSFT', 'BRK.B', '123', 'A'];

      for (const ticker of validTickers) {
        const result = service.validateTicker(ticker);
        expect(result.isValid).toBe(true);
      }
    });

    it('should invalidate empty ticker', () => {
      const result = service.validateTicker('');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Ticker symbol is required');
    });

    it('should invalidate null/undefined ticker', () => {
      const result = service.validateTicker(null as unknown as string);
      expect(result.isValid).toBe(false);
    });

    it('should invalidate ticker with invalid characters', () => {
      const invalidTickers = ['AAPL@', 'GOOG!', 'MSFT#', 'TOO-LONG-SYMBOL'];

      for (const ticker of invalidTickers) {
        const result = service.validateTicker(ticker);
        expect(result.isValid).toBe(false);
        expect(result.error).toContain('Invalid ticker symbol format');
      }
    });

    it('should invalidate ticker longer than 10 characters', () => {
      const result = service.validateTicker('VERYLONGTICKER');
      expect(result.isValid).toBe(false);
    });
  });
});
