import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { yahooFinanceService } from "../services/yahooFinanceService";
import { strictRateLimiter } from "../services/rateLimiter";

// sample call: http://localhost:7071/api/yahoo-finance?symbols=MSFT&fields=regularMarketPrice
export async function yahooFinanceHandler(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log("HTTP trigger YahooFinance launched");

  try {
    // Extract client IP for rate limiting
    const clientIp = request.headers.get('x-forwarded-for') || 
                    request.headers.get('x-real-ip') || 
                    'unknown';

    // Apply rate limiting
    const rateLimitResult = strictRateLimiter.isAllowed(clientIp);
    
    if (!rateLimitResult.allowed) {
      return {
        status: 429,
        jsonBody: {
          error: "Too many requests",
          message: "Rate limit exceeded. Please try again later.",
          retryAfter: Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000)
        },
        headers: {
          "X-RateLimit-Limit": "20",
          "X-RateLimit-Remaining": rateLimitResult.remaining.toString(),
          "X-RateLimit-Reset": new Date(rateLimitResult.resetTime).toISOString(),
          "Retry-After": Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000).toString()
        }
      };
    }

    // Validate input parameters
    const symbolsParam = request.query.get("symbols");
    const fieldsParam = request.query.get("fields");
    
    if (!symbolsParam) {
      return {
        status: 400,
        jsonBody: { error: "Missing required parameter: symbols" }
      };
    }
    
    if (!fieldsParam) {
      return {
        status: 400,
        jsonBody: { error: "Missing required parameter: fields" }
      };
    }

    const querySymbols = symbolsParam.split(",").map(s => s.trim()).filter(s => s.length > 0);
    const queryFields = fieldsParam.split(",").map(f => f.trim()).filter(f => f.length > 0);

    // Validate request using service
    const validation = yahooFinanceService.validateQuoteRequest(querySymbols, queryFields);
    if (!validation.isValid) {
      return {
        status: 400,
        jsonBody: { error: validation.error }
      };
    }

    const responseMessage = await yahooFinanceService.getQuotes(
      { symbols: querySymbols, fields: queryFields },
      context
    );

    return {
      jsonBody: responseMessage,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "max-age=120",
        "Content-Type": "application/json",
        "X-RateLimit-Limit": "20",
        "X-RateLimit-Remaining": rateLimitResult.remaining.toString(),
        "X-RateLimit-Reset": new Date(rateLimitResult.resetTime).toISOString()
      }
    };
  } catch (error: any) {
    context.error("Error in yahooFinanceHandler:", error);

    // Handle different error types
    if (error.response) {
      // External API error
      return {
        status: error.response.status || 502,
        jsonBody: { 
          error: "External API error",
          message: error.response.statusText || "Unknown error",
          status: error.response.status
        }
      };
    } else if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      // Timeout error
      return {
        status: 408,
        jsonBody: { error: "Request timeout", message: "External service is not responding" }
      };
    } else {
      // Internal server error
      return {
        status: 500,
        jsonBody: { 
          error: "Internal server error",
          message: error.message || "An unexpected error occurred"
        }
      };
    }
  }
};

app.http('yahoo-finance', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  handler: yahooFinanceHandler
});
