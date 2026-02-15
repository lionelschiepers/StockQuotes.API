import { YahooFinanceService } from '../../src/services/yahooFinanceService';
import type { InvocationContext } from '@azure/functions';

const mockContext = {
  log: jest.fn(),
  error: jest.fn(),
} as unknown as InvocationContext;

describe('YahooFinanceService', () => {
  let service: YahooFinanceService;
  let mockYahooFinance: { quote: jest.Mock; chart: jest.Mock };

  beforeEach(() => {
    mockYahooFinance = {
      quote: jest.fn(),
      chart: jest.fn(),
    };
    service = new YahooFinanceService(mockYahooFinance);
    (mockContext.log as jest.Mock).mockClear();
    (mockContext.error as jest.Mock).mockClear();
  });

  describe('getQuotes', () => {
    it('should call yahoo.quote with the correct parameters and return the result', async () => {
      const request = {
        symbols: ['AAPL', 'GOOG'],
        fields: ['regularMarketPrice', 'marketCap'],
      };
      const expectedResponse = {
        AAPL: { regularMarketPrice: 150, marketCap: 2.5e12 },
        GOOG: { regularMarketPrice: 2800, marketCap: 1.9e12 },
      };

      mockYahooFinance.quote.mockResolvedValue(expectedResponse);

      const response = await service.getQuotes(request, mockContext);

      expect(mockYahooFinance.quote).toHaveBeenCalledWith(request.symbols, { fields: request.fields });
      expect(response).toEqual(expectedResponse);
      expect(mockContext.log).toHaveBeenCalledWith(
        'Fetching quotes for symbols: AAPL,GOOG with fields: regularMarketPrice,marketCap',
      );
      expect(mockContext.log).toHaveBeenCalledWith('Successfully retrieved quotes for 2 symbols');
    });

    it('should throw an error and log it when yahoo.quote fails', async () => {
      const request = {
        symbols: ['FAIL'],
        fields: ['regularMarketPrice'],
      };
      const error = new Error('Failed to fetch');
      mockYahooFinance.quote.mockRejectedValue(error);

      await expect(service.getQuotes(request, mockContext)).rejects.toThrow(error);

      expect(mockContext.error).toHaveBeenCalledWith(
        `Error fetching quotes from Yahoo Finance: ${error.message}`,
        error,
      );
    });
  });

  describe('getHistoricalData', () => {
    it('should call yahoo.chart with the correct parameters and return the result with rounded values and without adjclose', async () => {
      const request = {
        ticker: 'MSFT',
        from: '2024-01-01',
        to: '2024-01-10',
        interval: '1w',
      };
      const expectedResponse = {
        meta: { symbol: 'MSFT' },
        quotes: [
          {
            date: new Date('2024-01-02'),
            open: 370.1234,
            high: 375.5678,
            low: 368.9101,
            close: 372.2345,
            adjclose: 372.2345,
            volume: 1000000,
          },
        ],
      };

      mockYahooFinance.chart.mockResolvedValue(JSON.parse(JSON.stringify(expectedResponse)));

      const response = await service.getHistoricalData(request, mockContext);

      expect(mockYahooFinance.chart).toHaveBeenCalledWith(request.ticker, {
        period1: request.from,
        period2: request.to,
        interval: '1wk',
      });

      expect(response.quotes[0].open).toBe(370.12);
      expect(response.quotes[0].high).toBe(375.57);
      expect(response.quotes[0].low).toBe(368.91);
      expect(response.quotes[0].close).toBe(372.23);
      expect(response.quotes[0]).not.toHaveProperty('adjclose');
      expect(response.quotes[0].volume).toBe(1000000);

      expect(mockContext.log).toHaveBeenCalledWith(
        'Fetching historical data for ticker: MSFT from 2024-01-01 to 2024-01-10 with interval: 1wk',
      );
      expect(mockContext.log).toHaveBeenCalledWith('Successfully retrieved historical data for MSFT');
    });

    it('should support "1wk" interval directly', async () => {
      const request = {
        ticker: 'MSFT',
        from: '2024-01-01',
        to: '2024-01-10',
        interval: '1wk',
      };
      mockYahooFinance.chart.mockResolvedValue({ meta: {}, quotes: [] });

      await service.getHistoricalData(request, mockContext);

      expect(mockYahooFinance.chart).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ interval: '1wk' }),
      );
    });

    it('should use default interval "1d" if not provided', async () => {
      const request = {
        ticker: 'MSFT',
        from: '2024-01-01',
        to: '2024-01-10',
      };
      mockYahooFinance.chart.mockResolvedValue({ meta: {}, quotes: [] });

      await service.getHistoricalData(request, mockContext);

      expect(mockYahooFinance.chart).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ interval: '1d' }),
      );
    });

    it('should filter fields if provided', async () => {
      const request = {
        ticker: 'AAPL',
        from: '2024-01-01',
        to: '2024-01-02',
        fields: ['close'],
      };
      const mockQuote = {
        date: new Date('2024-01-01'),
        open: 150,
        high: 155,
        low: 149,
        close: 152.5,
        volume: 1000,
      };
      mockYahooFinance.chart.mockResolvedValue({ meta: {}, quotes: [mockQuote] });

      const response = await service.getHistoricalData(request, mockContext);

      expect(response.quotes[0]).toEqual({
        date: mockQuote.date,
        close: 152.5,
      });
      expect(response.quotes[0]).not.toHaveProperty('open');
      expect(response.quotes[0]).not.toHaveProperty('high');
      expect(response.quotes[0]).not.toHaveProperty('low');
      expect(response.quotes[0]).not.toHaveProperty('volume');
    });

    it('should throw an error and log it when yahoo.chart fails', async () => {
      const request = {
        ticker: 'FAIL',
        from: '2024-01-01',
        to: '2024-01-10',
      };
      const error = new Error('Failed to fetch historical');
      mockYahooFinance.chart.mockRejectedValue(error);

      await expect(service.getHistoricalData(request, mockContext)).rejects.toThrow(error);

      expect(mockContext.error).toHaveBeenCalledWith(
        `Error fetching historical data from Yahoo Finance: ${error.message}`,
        error,
      );
    });
  });

  describe('validateQuoteRequest', () => {
    it('should return isValid: true for valid input', () => {
      const result = service.validateQuoteRequest(['AAPL'], ['regularMarketPrice']);
      expect(result.isValid).toBe(true);
    });

    it('should return isValid: false if no symbols are provided', () => {
      const result = service.validateQuoteRequest([], ['regularMarketPrice']);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('At least one symbol must be provided');
    });

    it('should return isValid: true if no fields are provided', () => {
      const result = service.validateQuoteRequest(['AAPL'], []);
      expect(result.isValid).toBe(true);
    });

    it('should return isValid: true if fields are undefined', () => {
      const result = service.validateQuoteRequest(['AAPL']);
      expect(result.isValid).toBe(true);
    });

    it('should return isValid: false for invalid symbols', () => {
      const result = service.validateQuoteRequest(['AAPL', ''], ['regularMarketPrice']);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Invalid symbols provided');
    });

    it('should return isValid: false for invalid fields', () => {
      const result = service.validateQuoteRequest(['AAPL'], ['regularMarketPrice', '']);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Invalid fields provided');
    });

    it('should return isValid: false if more than 50 symbols are provided', () => {
      const symbols = new Array(51).fill('AAPL');
      const result = service.validateQuoteRequest(symbols, ['regularMarketPrice']);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Maximum 50 symbols allowed per request');
    });

    it('should return isValid: false if more than 20 fields are provided', () => {
      const fields = new Array(21).fill('regularMarketPrice');
      const result = service.validateQuoteRequest(['AAPL'], fields);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Maximum 20 fields allowed per request');
    });
  });

  describe('validateHistoricalRequest', () => {
    it('should return isValid: true for valid input', () => {
      const result = service.validateHistoricalRequest('AAPL', '2024-01-01', '2024-01-10', '1w');
      expect(result.isValid).toBe(true);
    });

    it('should return isValid: false for invalid interval', () => {
      const result = service.validateHistoricalRequest('AAPL', '2024-01-01', '2024-01-10', 'invalid');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Interval must be one of: 1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h, 1d, 1w, 1wk, 1mo, 3mo');
    });

    it('should return isValid: false for invalid fields', () => {
      const result = service.validateHistoricalRequest('AAPL', '2024-01-01', '2024-01-10', '1d', ['']);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Invalid fields provided');
    });

    it('should return isValid: false if more than 20 fields are provided', () => {
      const fields = new Array(21).fill('close');
      const result = service.validateHistoricalRequest('AAPL', '2024-01-01', '2024-01-10', '1d', fields);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Maximum 20 fields allowed per request');
    });

    it('should return isValid: false if ticker is missing', () => {
      const result = service.validateHistoricalRequest('', '2024-01-01', '2024-01-10');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Ticker must be provided');
    });

    it('should return isValid: false if from date is invalid format', () => {
      const result = service.validateHistoricalRequest('AAPL', '01-01-2024', '2024-01-10');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('From date must be in yyyy-MM-dd format');
    });

    it('should return isValid: false if to date is invalid format', () => {
      const result = service.validateHistoricalRequest('AAPL', '2024-01-01', '2024/01/10');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('To date must be in yyyy-MM-dd format');
    });

    it('should return isValid: false if from date is after to date', () => {
      const result = service.validateHistoricalRequest('AAPL', '2024-01-10', '2024-01-01');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('From date must be before or equal to to date');
    });

    it('should return isValid: false for nonsensical dates', () => {
      const result = service.validateHistoricalRequest('AAPL', '2024-13-45', '2024-01-10');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Invalid from date');
    });

    it('should return isValid: false if daily date range exceeds 5 years', () => {
      const result = service.validateHistoricalRequest('AAPL', '2019-01-01', '2024-01-02', '1d');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Date range exceeds maximum of 5 years for daily interval');
    });

    it('should return isValid: true if daily date range is within 5 years', () => {
      const result = service.validateHistoricalRequest('AAPL', '2020-01-01', '2024-12-30', '1d');
      expect(result.isValid).toBe(true);
    });

    it('should return isValid: false if weekly date range exceeds 50 years', () => {
      const result = service.validateHistoricalRequest('AAPL', '1974-01-01', '2024-01-02', '1w');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Date range exceeds maximum of 50 years for weekly interval');
    });

    it('should return isValid: true if weekly date range is within 50 years', () => {
      const result = service.validateHistoricalRequest('AAPL', '1975-01-01', '2024-12-01', '1wk');
      expect(result.isValid).toBe(true);
    });

    it('should treat 1w and 1wk as weekly interval', () => {
      const result1w = service.validateHistoricalRequest('AAPL', '1974-01-01', '2024-01-02', '1w');
      const result1wk = service.validateHistoricalRequest('AAPL', '1974-01-01', '2024-01-02', '1wk');
      expect(result1w.isValid).toBe(false);
      expect(result1wk.isValid).toBe(false);
      expect(result1w.error).toBe('Date range exceeds maximum of 50 years for weekly interval');
      expect(result1wk.error).toBe('Date range exceeds maximum of 50 years for weekly interval');
    });

    it('should return isValid: true for intraday intervals like 1m, 5m, 1h', () => {
      const result1m = service.validateHistoricalRequest('AAPL', '2024-01-01', '2024-01-07', '1m');
      const result5m = service.validateHistoricalRequest('AAPL', '2024-01-01', '2024-01-07', '5m');
      const result1h = service.validateHistoricalRequest('AAPL', '2024-01-01', '2024-01-07', '1h');
      expect(result1m.isValid).toBe(true);
      expect(result5m.isValid).toBe(true);
      expect(result1h.isValid).toBe(true);
    });

    it('should return isValid: false if intraday interval exceeds 7 days', () => {
      const result = service.validateHistoricalRequest('AAPL', '2024-01-01', '2024-01-09', '1m');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Date range exceeds maximum of 7 days for intraday interval "1m"');
    });

    it('should return isValid: true for monthly intervals 1mo and 3mo', () => {
      const result1mo = service.validateHistoricalRequest('AAPL', '2000-01-01', '2024-01-01', '1mo');
      const result3mo = service.validateHistoricalRequest('AAPL', '2000-01-01', '2024-01-01', '3mo');
      expect(result1mo.isValid).toBe(true);
      expect(result3mo.isValid).toBe(true);
    });

    it('should return isValid: false if monthly interval exceeds 50 years', () => {
      const result = service.validateHistoricalRequest('AAPL', '1970-01-01', '2024-01-01', '1mo');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Date range exceeds maximum of 50 years for monthly interval');
    });
  });
});
