import { InvocationContext } from "@azure/functions";

const YahooFinance = require("yahoo-finance2").default;

export interface YahooFinanceQuoteRequest {
  symbols: string[];
  fields: string[];
}

export interface YahooFinanceResponse {
  [key: string]: any;
}

export class YahooFinanceService {
  private yahooFinance: any;

  constructor() {
    this.yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
  }

  async getQuotes(request: YahooFinanceQuoteRequest, context: InvocationContext): Promise<YahooFinanceResponse> {
    try {
      context.log(`Fetching quotes for symbols: ${request.symbols.join(',')} with fields: ${request.fields.join(',')}`);
      
      const response = await this.yahooFinance.quote(request.symbols, { fields: request.fields });
      
      context.log(`Successfully retrieved quotes for ${request.symbols.length} symbols`);
      return response;
    } catch (error: any) {
      context.error(`Error fetching quotes from Yahoo Finance: ${error.message}`, error);
      throw error;
    }
  }

  validateQuoteRequest(symbols: string[], fields: string[]): { isValid: boolean; error?: string } {
    if (!symbols || symbols.length === 0) {
      return { isValid: false, error: "At least one symbol must be provided" };
    }
    
    if (!fields || fields.length === 0) {
      return { isValid: false, error: "At least one field must be provided" };
    }

    const validSymbols = symbols.filter(s => s && s.trim().length > 0);
    const validFields = fields.filter(f => f && f.trim().length > 0);

    if (validSymbols.length !== symbols.length) {
      return { isValid: false, error: "Invalid symbols provided" };
    }

    if (validFields.length !== fields.length) {
      return { isValid: false, error: "Invalid fields provided" };
    }

    if (validSymbols.length > 50) {
      return { isValid: false, error: "Maximum 50 symbols allowed per request" };
    }

    if (validFields.length > 20) {
      return { isValid: false, error: "Maximum 20 fields allowed per request" };
    }

    return { isValid: true };
  }
}

// Export singleton instance
export const yahooFinanceService = new YahooFinanceService();
