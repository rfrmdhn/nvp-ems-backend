import { api } from './helpers/client';

/**
 * Smoke: is the deployment even up? Run this first against a fresh
 * `docker compose up --build`. No auth fixtures, no cleanup needed.
 */
describe('Smoke', () => {
  it('GET / returns 200 with the health payload', async () => {
    const res = await api().get('/');
    expect(res.status).toBe(200);
    expect(res.status).toBeLessThan(500);
    expect(res.body).toEqual({ status: 'ok', service: 'ems-backend' });
  });

  it('POST /auth/login with valid seeded admin creds returns 200 and a token', async () => {
    const res = await api()
      .post('/auth/login')
      .send({ email: 'admin@nusantaradigital.test', password: 'ChangeMe123!' });
    expect(res.status).toBe(200);
    expect(res.status).toBeLessThan(500);
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.accessToken.length).toBeGreaterThan(0);
  });

  it('GET /api/docs (Swagger UI) is reachable and not a 5xx', async () => {
    const res = await api().get('/api/docs');
    expect(res.status).toBeLessThan(500);
  });

  it('an unknown route returns 404, never a 5xx', async () => {
    const res = await api().get('/this-route-does-not-exist');
    expect(res.status).toBe(404);
  });
});
