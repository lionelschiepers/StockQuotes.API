import axios from "axios";
import { InvocationContext } from "@azure/functions";

export interface ExchangeRateResponse {
  data: string;
  contentType: string;
}

export class ExchangeRateService {
  private readonly ecbUrl = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

  async getDailyRates(context: InvocationContext): Promise<ExchangeRateResponse> {
    try {
      context.log("Fetching daily exchange rates from ECB");

      const response = await axios.get<string>(this.ecbUrl, {
        timeout: 10000, // 10 second timeout
        headers: {
          'User-Agent': 'Azure-Function/1.0',
          'Accept': 'application/xml,text/xml'
        }
      });

      context.log(`Successfully retrieved exchange rates. Status: ${response.status}`);
      
      return {
        data: response.data,
        contentType: response.headers["content-type"] || "application/xml"
      };
    } catch (error: any) {
      context.error(`Error fetching exchange rates from ECB: ${error.message}`, error);
      throw error;
    }
  }

  validateRequest(): { isValid: boolean; error?: string } {
    // For now, the ECB endpoint doesn't require specific validation
    // This can be extended if we add parameters later
    return { isValid: true };
  }
}

// Export singleton instance
export const exchangeRateService = new ExchangeRateService();
