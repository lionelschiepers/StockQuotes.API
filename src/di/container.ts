import { YahooFinanceService } from '../services/yahooFinanceService';
import { ExchangeRateService } from '../services/exchangeRateService';

export interface ServiceContainer {
  yahooFinanceService: YahooFinanceService;
  exchangeRateService: ExchangeRateService;
}

const container: ServiceContainer = {
  yahooFinanceService: new YahooFinanceService(),
  exchangeRateService: new ExchangeRateService(),
};

export function getServiceContainer(): ServiceContainer {
  return container;
}
