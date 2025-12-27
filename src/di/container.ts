// Simple dependency injection container for Azure Functions
import { YahooFinanceService } from "../services/yahooFinanceService";
import { ExchangeRateService } from "../services/exchangeRateService";

export interface ServiceContainer {
  yahooFinanceService: YahooFinanceService;
  exchangeRateService: ExchangeRateService;
}

// Create singleton instances
const container: ServiceContainer = {
  yahooFinanceService: new YahooFinanceService(),
  exchangeRateService: new ExchangeRateService()
};

export function getServiceContainer(): ServiceContainer {
  return container;
}

// Export individual services for convenience
export { yahooFinanceService } from "../services/yahooFinanceService";
export { exchangeRateService } from "../services/exchangeRateService";
