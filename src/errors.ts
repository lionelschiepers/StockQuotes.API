/**
 * Domain error types.
 *
 * Services throw these so HTTP handlers can map failures to status codes
 * without inspecting error message strings.
 */
export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly publicError: string,
    readonly publicMessage: string = message,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, publicError = 'Bad Request') {
    super(message, 400, publicError);
  }
}

export class ConfigError extends AppError {
  constructor(message: string) {
    super(message, 500, 'Configuration error');
  }
}

export class UpstreamTimeoutError extends AppError {
  constructor(message = 'External service is not responding') {
    super(message, 408, 'Request timeout');
  }
}

export class UpstreamRateLimitError extends AppError {
  constructor(message: string, publicError = 'API rate limit exceeded') {
    super(message, 429, publicError);
  }
}

export class UpstreamError extends AppError {
  constructor(
    message: string,
    readonly upstreamStatus = 502,
    upstreamStatusText?: string,
  ) {
    super(message, upstreamStatus, 'External API error', upstreamStatusText ?? message);
  }
}
