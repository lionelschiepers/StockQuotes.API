import { YahooFinanceService } from '../../src/services/yahooFinanceService';
import { InvocationContext } from '@azure/functions';

const mockContext = {
  log: jest.fn(),
  error: jest.fn(),
} as unknown as InvocationContext;

describe('YahooFinanceService', () => {
  let service: YahooFinanceService;
  let mockYahooFinance: { quote: jest.Mock };

  beforeEach(() => {
    mockYahooFinance = {
      quote: jest.fn(),
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

    it('should return isValid: false if no fields are provided', () => {
      const result = service.validateQuoteRequest(['AAPL'], []);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('At least one field must be provided');
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
});
