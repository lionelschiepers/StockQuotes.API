import { healthHandler } from '../../src/functions/health';

describe('healthHandler', () => {
  it('should return a 200 ok response', async () => {
    const response = await healthHandler();

    expect(response.status).toBe(200);
    expect(response.jsonBody).toEqual({ status: 'ok' });
  });
});
