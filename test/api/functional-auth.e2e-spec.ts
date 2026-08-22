import { ADMIN_EMAIL, ADMIN_PASSWORD, api } from './helpers/client';

describe('Functional: POST /auth/login', () => {
  it('valid credentials -> 200, { accessToken, expiresIn }', async () => {
    const res = await api()
      .post('/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');
    // 3-part JWT: header.payload.signature
    expect(res.body.accessToken.split('.')).toHaveLength(3);
    expect(typeof res.body.expiresIn).toBe('string');
  });

  it('wrong password -> 401, generic message (no user-existence leak)', async () => {
    const res = await api()
      .post('/auth/login')
      .send({ email: ADMIN_EMAIL, password: 'not-the-right-password' });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid credentials');
  });

  it('unknown email -> 401 with the SAME message as a wrong password (no user-enumeration signal)', async () => {
    const res = await api().post('/auth/login').send({
      email: 'nobody-like-this@nusantaradigital.test',
      password: 'whatever123',
    });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid credentials');
  });

  it('missing password -> 400 validation error, not 401/500', async () => {
    const res = await api().post('/auth/login').send({ email: ADMIN_EMAIL });
    expect(res.status).toBe(400);
  });

  it('malformed email -> 400 validation error', async () => {
    const res = await api()
      .post('/auth/login')
      .send({ email: 'not-an-email', password: ADMIN_PASSWORD });
    expect(res.status).toBe(400);
  });

  it('every error response follows the standard {statusCode, timestamp, path, message} shape', async () => {
    const res = await api()
      .post('/auth/login')
      .send({ email: ADMIN_EMAIL, password: 'x' });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      statusCode: 401,
      path: '/auth/login',
    });
    expect(typeof res.body.timestamp).toBe('string');
  });
});
