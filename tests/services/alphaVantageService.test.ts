import { AlphaVantageService } from '../../src/services/alphaVantageService';
import { CacheService } from '../../src/services/cacheService';
import type { InvocationContext } from '@azure/functions';
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

    const mockEarnings = {
      symbol: 'IBM',
      annualEarnings: [
        {
          fiscalDateEnding: '2023-12-31',
          reportedEPS: '9.61',
        },
        {
          fiscalDateEnding: '2022-12-31',
          reportedEPS: '9.12',
        },
      ],
      quarterlyEarnings: [
        {
          fiscalDateEnding: '2024-03-31',
          reportedEPS: '1.68',
        },
      ],
    };

    const mockEarningsQuarterly = {
      symbol: 'IBM',
      annualEarnings: [
        {
          fiscalDateEnding: '2023-12-31',
          reportedEPS: '9.61',
        },
        {
          fiscalDateEnding: '2022-12-31',
          reportedEPS: '9.12',
        },
        {
          fiscalDateEnding: '2021-12-31',
          reportedEPS: '9.97',
        },
        {
          fiscalDateEnding: '2020-12-31',
          reportedEPS: '8.67',
        },
        {
          fiscalDateEnding: '2019-12-31',
          reportedEPS: '12.81',
        },
      ],
      quarterlyEarnings: [
        {
          fiscalDateEnding: '2024-03-31',
          reportedEPS: '1.68',
        },
        {
          fiscalDateEnding: '2023-12-31',
          reportedEPS: '3.87',
        },
        {
          fiscalDateEnding: '2023-09-30',
          reportedEPS: '2.2',
        },
        {
          fiscalDateEnding: '2023-06-30',
          reportedEPS: '2.18',
        },
        {
          fiscalDateEnding: '2023-03-31',
          reportedEPS: '1.36',
        },
      ],
    };

    it('should fetch and merge financial statements successfully', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: mockIncomeStatement });
      mockedAxios.get.mockResolvedValueOnce({ data: mockBalanceSheet });
      mockedAxios.get.mockResolvedValueOnce({ data: mockCashFlow });
      mockedAxios.get.mockResolvedValueOnce({ data: mockEarnings });

      const result = await service.getFinancialStatements('IBM', undefined, undefined, undefined, mockContext);

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
      expect(report2023?.ratio).toEqual({
        fiscalDateEnding: '2023-12-31',
        reportedEPS: '9.61',
      });
    });

    it('should return cached data on cache hit', async () => {
      // First call - cache miss
      mockedAxios.get
        .mockResolvedValueOnce({ data: mockIncomeStatement })
        .mockResolvedValueOnce({ data: mockBalanceSheet })
        .mockResolvedValueOnce({ data: mockCashFlow })
        .mockResolvedValueOnce({ data: mockEarnings });

      await service.getFinancialStatements('IBM', undefined, undefined, undefined, mockContext);

      // Second call - should use cache
      const result = await service.getFinancialStatements('IBM', undefined, undefined, undefined, mockContext);

      // axios should only have been called 4 times total (not 8)
      expect(mockedAxios.get).toHaveBeenCalledTimes(4);
      expect(result.cacheStatus).toBe('HIT');
    });

    it('should normalize ticker to uppercase', async () => {
      mockedAxios.get
        .mockResolvedValueOnce({ data: { ...mockIncomeStatement, symbol: 'ibm' } })
        .mockResolvedValueOnce({ data: { ...mockBalanceSheet, symbol: 'ibm' } })
        .mockResolvedValueOnce({ data: { ...mockCashFlow, symbol: 'ibm' } })
        .mockResolvedValueOnce({ data: { ...mockEarnings, symbol: 'ibm' } });

      const result = await service.getFinancialStatements('ibm', undefined, undefined, undefined, mockContext);

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
        .mockResolvedValueOnce({ data: partialCashFlow })
        .mockResolvedValueOnce({ data: mockEarnings });

      const result = await service.getFinancialStatements('IBM', undefined, undefined, undefined, mockContext);

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

    it('should filter out entries when all statement sections are null', async () => {
      const emptyStatements = {
        symbol: 'IBM',
        annualReports: [],
        quarterlyReports: [],
      };

      // Use mockEarningsQuarterly which has only one entry to avoid confusion
      const singleEarnings = {
        symbol: 'IBM',
        annualEarnings: [
          {
            fiscalDateEnding: '2023-12-31',
            reportedEPS: '9.61',
          },
        ],
        quarterlyEarnings: [],
      };

      mockedAxios.get
        .mockResolvedValueOnce({ data: emptyStatements })
        .mockResolvedValueOnce({ data: emptyStatements })
        .mockResolvedValueOnce({ data: emptyStatements })
        .mockResolvedValueOnce({ data: singleEarnings });

      const result = await service.getFinancialStatements('IBM', undefined, undefined, undefined, mockContext);

      // Entries with all null sections should be filtered out
      expect(result.annualReports).toHaveLength(0);
    });

    it('should set ratio when statements exist', async () => {
      const partialIncome = {
        symbol: 'IBM',
        annualReports: [{ fiscalDateEnding: '2023-12-31', totalRevenue: '1000000' }],
        quarterlyReports: [],
      };

      const emptyStatements = {
        symbol: 'IBM',
        annualReports: [],
        quarterlyReports: [],
      };

      // Use single earnings to match
      const singleEarnings = {
        symbol: 'IBM',
        annualEarnings: [
          {
            fiscalDateEnding: '2023-12-31',
            reportedEPS: '9.61',
          },
        ],
        quarterlyEarnings: [],
      };

      mockedAxios.get
        .mockResolvedValueOnce({ data: partialIncome })
        .mockResolvedValueOnce({ data: emptyStatements })
        .mockResolvedValueOnce({ data: emptyStatements })
        .mockResolvedValueOnce({ data: singleEarnings });

      const result = await service.getFinancialStatements('IBM', undefined, undefined, undefined, mockContext);

      expect(result.annualReports).toHaveLength(1);
      const report = result.annualReports[0];
      expect(report.incomeStatement).toBeTruthy(); // Has data
      expect(report.balanceSheet).toBeNull();
      expect(report.cashFlow).toBeNull();
      expect(report.ratio).toBeTruthy(); // Should be set since incomeStatement exists
      expect(report.ratio?.reportedEPS).toBe('9.61');
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
        .mockResolvedValueOnce({ data: unsortedCashFlow })
        .mockResolvedValueOnce({ data: mockEarnings });

      const result = await service.getFinancialStatements('IBM', undefined, undefined, undefined, mockContext);

      expect(result.annualReports[0].fiscalDateEnding).toBe('2023-12-31');
      expect(result.annualReports[1].fiscalDateEnding).toBe('2022-12-31');
      expect(result.annualReports[2].fiscalDateEnding).toBe('2021-12-31');
    });

    it('should throw error when API key is not set', async () => {
      delete process.env.ALPHAVANTAGE_API_KEY;
      service = new AlphaVantageService(mockCache);

      await expect(service.getFinancialStatements('IBM', undefined, undefined, undefined, mockContext)).rejects.toThrow(
        'ALPHAVANTAGE_API_KEY environment variable is not set',
      );
    });

    it('should throw error on invalid ticker', async () => {
      await expect(service.getFinancialStatements('', undefined, undefined, undefined, mockContext)).rejects.toThrow(
        'Ticker symbol is required',
      );
    });

    it('should throw error on rate limit response', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { Note: 'API call frequency exceeded' },
      });

      await expect(service.getFinancialStatements('IBM', undefined, undefined, undefined, mockContext)).rejects.toThrow(
        'Alpha Vantage API rate limit reached',
      );
    });

    it('should throw error on API information message', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { Information: 'Invalid API call' },
      });

      await expect(service.getFinancialStatements('IBM', undefined, undefined, undefined, mockContext)).rejects.toThrow(
        'Alpha Vantage API error: Invalid API call',
      );
    });

    it('should throw timeout error on ECONNABORTED', async () => {
      const error = new Error('Request timeout') as Error & { code: string };
      error.code = 'ECONNABORTED';
      mockedAxios.get.mockRejectedValueOnce(error);
      mockedAxios.isAxiosError.mockReturnValueOnce(true);

      await expect(service.getFinancialStatements('IBM', undefined, undefined, undefined, mockContext)).rejects.toThrow(
        'Timeout fetching INCOME_STATEMENT for IBM',
      );
    });

    it('should throw timeout error on ETIMEDOUT', async () => {
      const error = new Error('Request timeout') as Error & { code: string };
      error.code = 'ETIMEDOUT';
      mockedAxios.get.mockRejectedValueOnce(error);
      mockedAxios.isAxiosError.mockReturnValueOnce(true);

      await expect(service.getFinancialStatements('IBM', undefined, undefined, undefined, mockContext)).rejects.toThrow(
        'Timeout fetching INCOME_STATEMENT for IBM',
      );
    });

    it('should throw error on HTTP error response', async () => {
      mockedAxios.get.mockRejectedValueOnce({
        response: { status: 500, statusText: 'Internal Server Error' },
        isAxiosError: true,
      });

      mockedAxios.isAxiosError.mockReturnValueOnce(true);

      await expect(service.getFinancialStatements('IBM', undefined, undefined, undefined, mockContext)).rejects.toThrow(
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
          .mockResolvedValueOnce({ data: mockCashFlowLimit })
          .mockResolvedValueOnce({ data: mockEarningsQuarterly });

        const result = await service.getFinancialStatements('IBM', undefined, 3, undefined, mockContext);

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
          .mockResolvedValueOnce({ data: mockCashFlowLimit })
          .mockResolvedValueOnce({ data: mockEarningsQuarterly });

        const result = await service.getFinancialStatements('IBM', 'yearly', 2, undefined, mockContext);

        expect(result.annualReports).toHaveLength(2);
        expect(result.quarterlyReports).toHaveLength(0);
        expect(result.annualReports[0].fiscalDateEnding).toBe('2023-12-31');
        expect(result.annualReports[1].fiscalDateEnding).toBe('2022-12-31');
      });

      it('should limit only quarterly reports when period=quarterly', async () => {
        mockedAxios.get
          .mockResolvedValueOnce({ data: mockIncomeStatementLimit })
          .mockResolvedValueOnce({ data: mockBalanceSheetLimit })
          .mockResolvedValueOnce({ data: mockCashFlowLimit })
          .mockResolvedValueOnce({ data: mockEarningsQuarterly });

        const result = await service.getFinancialStatements('IBM', 'quarterly', 4, undefined, mockContext);

        expect(result.annualReports).toHaveLength(0);
        expect(result.quarterlyReports).toHaveLength(4);
        expect(result.quarterlyReports[0].fiscalDateEnding).toBe('2024-03-31');
        expect(result.quarterlyReports[3].fiscalDateEnding).toBe('2023-06-30');
      });

      it('should return all statements when limit exceeds available count', async () => {
        mockedAxios.get
          .mockResolvedValueOnce({ data: mockIncomeStatementLimit })
          .mockResolvedValueOnce({ data: mockBalanceSheetLimit })
          .mockResolvedValueOnce({ data: mockCashFlowLimit })
          .mockResolvedValueOnce({ data: mockEarningsQuarterly });

        const result = await service.getFinancialStatements('IBM', undefined, 100, undefined, mockContext);

        expect(result.annualReports).toHaveLength(5);
        expect(result.quarterlyReports).toHaveLength(5);
      });

      it('should return all statements when limitStatements is not provided', async () => {
        mockedAxios.get
          .mockResolvedValueOnce({ data: mockIncomeStatementLimit })
          .mockResolvedValueOnce({ data: mockBalanceSheetLimit })
          .mockResolvedValueOnce({ data: mockCashFlowLimit })
          .mockResolvedValueOnce({ data: mockEarningsQuarterly });

        const result = await service.getFinancialStatements('IBM', undefined, undefined, undefined, mockContext);

        expect(result.annualReports).toHaveLength(5);
        expect(result.quarterlyReports).toHaveLength(5);
      });

      it('should use single cache and apply filters on each request', async () => {
        mockedAxios.get
          .mockResolvedValueOnce({ data: mockIncomeStatementLimit })
          .mockResolvedValueOnce({ data: mockBalanceSheetLimit })
          .mockResolvedValueOnce({ data: mockCashFlowLimit })
          .mockResolvedValueOnce({ data: mockEarningsQuarterly });

        // First call with limit 2 - should be a MISS (fetches full data from API)
        const result1 = await service.getFinancialStatements('IBM', undefined, 2, undefined, mockContext);
        expect(result1.cacheStatus).toBe('MISS');
        expect(result1.annualReports).toHaveLength(2);

        // Second call with limit 4 - should be a HIT (uses cached full data and applies different limit)
        const result2 = await service.getFinancialStatements('IBM', undefined, 4, undefined, mockContext);

        // axios should only have been called 4 times total (for the first request)
        expect(mockedAxios.get).toHaveBeenCalledTimes(4);
        expect(result2.cacheStatus).toBe('HIT');
        // Returns 4 reports by applying limit filter to cached full data
        expect(result2.annualReports).toHaveLength(4);
      });
    });

    describe('fields parameter', () => {
      const mockIncomeStatement = {
        symbol: 'IBM',
        annualReports: [
          {
            fiscalDateEnding: '2023-12-31',
            totalRevenue: '1000000',
            grossProfit: '500000',
            netIncome: '100000',
          },
        ],
        quarterlyReports: [
          {
            fiscalDateEnding: '2024-03-31',
            totalRevenue: '250000',
            grossProfit: '125000',
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
            totalShareholderEquity: '3000000',
          },
        ],
        quarterlyReports: [
          {
            fiscalDateEnding: '2024-03-31',
            totalAssets: '5200000',
            totalLiabilities: '2100000',
            totalShareholderEquity: '3100000',
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
        ],
        quarterlyReports: [
          {
            fiscalDateEnding: '2024-03-31',
            operatingCashflow: '40000',
            capitalExpenditures: '12000',
          },
        ],
      };

      beforeEach(() => {
        mockedAxios.get.mockResolvedValueOnce({ data: mockIncomeStatement });
        mockedAxios.get.mockResolvedValueOnce({ data: mockBalanceSheet });
        mockedAxios.get.mockResolvedValueOnce({ data: mockCashFlow });
        mockedAxios.get.mockResolvedValueOnce({ data: mockEarnings });
      });

      it('should filter fields from all statements', async () => {
        const result = await service.getFinancialStatements(
          'IBM',
          undefined,
          undefined,
          ['incomeStatement.grossProfit', 'balanceSheet.totalAssets'],
          mockContext,
        );

        // The annual reports should include all dates from mock data
        expect(result.annualReports.length).toBeGreaterThanOrEqual(1);

        // The report for 2023 should be filtered
        const report2023 = result.annualReports.find((r) => r.fiscalDateEnding === '2023-12-31');
        expect(report2023).toBeDefined();

        // Only grossProfit should be in incomeStatement (plus fiscalDateEnding)
        expect(report2023?.incomeStatement).toEqual({
          fiscalDateEnding: '2023-12-31',
          grossProfit: '500000',
        });

        // Only totalAssets should be in balanceSheet (plus fiscalDateEnding)
        expect(report2023?.balanceSheet).toEqual({
          fiscalDateEnding: '2023-12-31',
          totalAssets: '5000000',
        });

        // cashFlow should only have fiscalDateEnding since no fields were requested
        expect(report2023?.cashFlow).toEqual({
          fiscalDateEnding: '2023-12-31',
        });
      });

      it('should return all fields when fields is undefined', async () => {
        const result = await service.getFinancialStatements('IBM', undefined, undefined, undefined, mockContext);

        const report = result.annualReports[0];
        expect(report.incomeStatement).toEqual(mockIncomeStatement.annualReports[0]);
        expect(report.balanceSheet).toEqual(mockBalanceSheet.annualReports[0]);
        expect(report.cashFlow).toEqual(mockCashFlow.annualReports[0]);
      });

      it('should return all fields when fields array is empty', async () => {
        const result = await service.getFinancialStatements('IBM', undefined, undefined, [], mockContext);

        const report = result.annualReports[0];
        expect(report.incomeStatement).toEqual(mockIncomeStatement.annualReports[0]);
        expect(report.balanceSheet).toEqual(mockBalanceSheet.annualReports[0]);
        expect(report.cashFlow).toEqual(mockCashFlow.annualReports[0]);
      });

      it('should use the full data cache for different fields', async () => {
        // Create a fresh service instance for this test
        const freshCache = new CacheService();
        const freshService = new AlphaVantageService(freshCache);

        // Setup mocks for first call
        mockedAxios.get
          .mockResolvedValueOnce({ data: mockIncomeStatement })
          .mockResolvedValueOnce({ data: mockBalanceSheet })
          .mockResolvedValueOnce({ data: mockCashFlow })
          .mockResolvedValueOnce({ data: mockEarnings });

        // First call with fields - MISS
        const result1 = await freshService.getFinancialStatements(
          'IBM',
          undefined,
          undefined,
          ['incomeStatement.grossProfit'],
          mockContext,
        );
        expect(result1.cacheStatus).toBe('MISS');

        // Second call with different fields - should be a HIT (uses full data cache)
        const result2 = await freshService.getFinancialStatements(
          'IBM',
          undefined,
          undefined,
          ['balanceSheet.totalAssets'],
          mockContext,
        );

        // Should have used cache (HIT)
        expect(result2.cacheStatus).toBe('HIT');
        // axios should not have been called again
        expect(mockedAxios.get).toHaveBeenCalledTimes(4);
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
