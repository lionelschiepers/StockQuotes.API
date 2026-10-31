import type { HttpResponseInit } from '@azure/functions';
import { app } from '@azure/functions';

/**
 * Lightweight liveness probe for container health checks.
 * Must not depend on any external service.
 */
export async function healthHandler(): Promise<HttpResponseInit> {
  return { status: 200, jsonBody: { status: 'ok' } };
}

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: healthHandler,
});
