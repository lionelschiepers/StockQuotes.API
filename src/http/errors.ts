import type { HttpResponseInit, InvocationContext } from '@azure/functions';
import { AppError, UpstreamError } from '../errors';

export interface ErrorMappingOptions {
  /** Prefix used for the server-side log entry. */
  logLabel: string;
  /** Message used for unknown/non-Error failures. */
  fallbackMessage: string;
  /** Message used when an upstream response has no status text. */
  upstreamMessage: string;
  /** Message used for timeout failures. */
  timeoutMessage: string;
  /** Message used for upstream 429 responses. */
  rateLimitMessage: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function jsonError(status: number, body: Record<string, unknown>, headers: Record<string, string>): HttpResponseInit {
  return {
    status,
    jsonBody: body,
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', ...headers },
  };
}

/**
 * Maps any thrown value to an HTTP response.
 *
 * Typed {@link AppError} instances win; axios-style and Node-style errors are
 * still supported because third-party clients (yahoo-finance2) throw them.
 */
export function mapErrorToResponse(
  error: unknown,
  context: InvocationContext,
  options: ErrorMappingOptions,
): HttpResponseInit {
  context.error(options.logLabel, error);

  if (error instanceof UpstreamError) {
    return jsonError(
      error.status,
      {
        error: error.publicError,
        message: error.publicMessage,
        status: error.upstreamStatus,
      },
      {},
    );
  }

  if (error instanceof AppError) {
    return jsonError(error.status, { error: error.publicError, message: error.publicMessage }, {});
  }

  if (isRecord(error) && isRecord(error.response)) {
    const response = error.response;
    return jsonError(
      typeof response.status === 'number' ? response.status : 502,
      {
        error: 'External API error',
        message: typeof response.statusText === 'string' ? response.statusText : options.upstreamMessage,
        status: response.status,
      },
      {},
    );
  }

  if (isRecord(error) && (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT')) {
    return jsonError(408, { error: 'Request timeout', message: options.timeoutMessage }, {});
  }

  if (isRecord(error) && error.code === 429) {
    return jsonError(429, { error: 'Too Many Requests', message: options.rateLimitMessage }, {});
  }

  return jsonError(
    500,
    {
      error: 'Internal server error',
      message: error instanceof Error ? error.message : options.fallbackMessage,
    },
    {},
  );
}
