import axios from 'axios';
import { InvocationContext } from '@azure/functions';
import { ExchangeRateService } from '../../src/services/exchangeRateService';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const mockContext = {
  log: jest.fn(),
  error: jest.fn(),
} as unknown as InvocationContext;

describe('ExchangeRateService', () => {
  let service: ExchangeRateService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ExchangeRateService();
  });

  describe('getDailyRates', () => {
    it('should fetch daily exchange rates and return XML data', async () => {
      const mockXmlResponse = `
        <gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
            <gesmes:subject>Reference rates</gesmes:subject>
            <gesmes:Sender>
                <gesmes:name>European Central Bank</gesmes:name>
            </gesmes:Sender>
            <Cube>
                <Cube time="2023-01-20">
                    <Cube currency="USD" rate="1.0851"/>
                    <Cube currency="JPY" rate="141.27"/>
                </Cube>
            </Cube>
        </gesmes:Envelope>
      `;
      const mockHeaders = { 'content-type': 'application/xml' };

      mockedAxios.get.mockResolvedValue({
        data: mockXmlResponse,
        status: 200,
        statusText: 'OK',
        headers: mockHeaders,
        config: {},
      });

      const result = await service.getDailyRates(mockContext);

      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
        expect.objectContaining({
          timeout: 10000,
          headers: {
            'User-Agent': 'Azure-Function/1.0',
            Accept: 'application/xml,text/xml',
          },
        }),
      );
      expect(result.data).toBe(mockXmlResponse);
      expect(result.contentType).toBe('application/xml');
      expect(mockContext.log).toHaveBeenCalledWith('Fetching daily exchange rates from ECB');
      expect(mockContext.log).toHaveBeenCalledWith('Successfully retrieved exchange rates. Status: 200');
    });

    it('should throw an error if fetching rates fails', async () => {
      const error = new Error('Network Error');
      mockedAxios.get.mockRejectedValue(error);

      await expect(service.getDailyRates(mockContext)).rejects.toThrow('Network Error');
      expect(mockContext.error).toHaveBeenCalledWith(`Error fetching exchange rates from ECB: ${error.message}`, error);
    });
  });

  describe('validateRequest', () => {
    it('should always return isValid: true', () => {
      const result = service.validateRequest();
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });
});
