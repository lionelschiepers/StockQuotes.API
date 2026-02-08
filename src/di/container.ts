import { YahooFinanceService } from '../services/yahooFinanceService';
import { ExchangeRateService } from '../services/exchangeRateService';
import { AlphaVantageService } from '../services/alphaVantageService';
import type { CacheService } from '../services/cacheService';
import { cacheService } from '../services/cacheService';

export interface ServiceContainer {
  yahooFinanceService: YahooFinanceService;
  exchangeRateService: ExchangeRateService;
  alphaVantageService: AlphaVantageService;
  cacheService: CacheService;
}

const container: ServiceContainer = {
  yahooFinanceService: new YahooFinanceService(),
  exchangeRateService: new ExchangeRateService(),
  alphaVantageService: new AlphaVantageService(cacheService),
  cacheService: cacheService,
};

export function getServiceContainer(): ServiceContainer {
  return container;
}
