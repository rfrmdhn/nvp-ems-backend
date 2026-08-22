import {
  api,
  authHeader,
  getAuthToken,
  validEmployeePayload,
} from './helpers/client';

/**
 * Security: access control on every guarded route, JWT tampering, mass
 * assignment, and injection-style input treated as literal data (Prisma
 * parameterizes everything, so this suite proves that empirically rather
 * than asserting it by code inspection alone). IDOR in the classic
 * "user A reads user B's private resource" sense doesn't apply here — this
 * is a single-admin, single-tenant system (see docs/superpowers/AUDIT.md #1)
 * with no user-scoped resources to cross a boundary between. That's recorded
 * explicitly rather than silently skipped.
 */
describe('Security', () => {
  let token: string;
  const createdIds: string[] = [];

  beforeAll(async () => {
    token = await getAuthToken();
  });

  afterAll(async () => {
    await Promise.all(
      createdIds.map((id) =>
        api().delete(`/employees/${id}`).set(authHeader(token)),
      ),
    );
  });

  describe('Access control — every guarded route requires a valid bearer token', () => {
    const guardedRequests: Array<[string, string]> = [
      ['GET', '/employees'],
      ['POST', '/employees'],
      ['GET', '/employees/00000000-0000-0000-0000-000000000000'],
      ['PUT', '/employees/00000000-0000-0000-0000-000000000000'],
      ['DELETE', '/employees/00000000-0000-0000-0000-000000000000'],
      ['POST', '/csv-import/upload'],
      ['GET', '/csv-import/1/status'],
    ];

    it.each(guardedRequests)(
      '%s %s with NO token -> 401',
      async (method, url) => {
        const res = await (api() as any)[method.toLowerCase()](url);
        expect(res.status).toBe(401);
      },
    );

    it.each(guardedRequests)(
      '%s %s with a garbage token -> 401',
      async (method, url) => {
        const res = await (api() as any)
          [method.toLowerCase()](url)
          .set(authHeader('not-a-real-jwt'));
        expect(res.status).toBe(401);
      },
    );

    it('GET /notifications/stream with no token -> 401', async () => {
      const res = await api().get('/notifications/stream');
      expect(res.status).toBe(401);
    });
  });

  describe('JWT tampering', () => {
    it('a token with a flipped signature byte -> 401', async () => {
      const parts = token.split('.');
      const lastChar = parts[2].slice(-1);
      const flipped = lastChar === 'A' ? 'B' : 'A';
      const tampered = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -1)}${flipped}`;

      const res = await api().get('/employees').set(authHeader(tampered));
      expect(res.status).toBe(401);
    });

    it('an "alg: none" unsigned token -> 401 (never trust a client-declared algorithm)', async () => {
      const header = Buffer.from(
        JSON.stringify({ alg: 'none', typ: 'JWT' }),
      ).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({ sub: 'attacker', email: 'attacker@evil.test' }),
      ).toString('base64url');
      const noneToken = `${header}.${payload}.`;

      const res = await api().get('/employees').set(authHeader(noneToken));
      expect(res.status).toBe(401);
    });

    it('a well-formed but non-existent-secret-signed token -> 401', async () => {
      // header.payload from a real token, signature swapped for random bytes
      const parts = token.split('.');
      const fake = `${parts[0]}.${parts[1]}.${Buffer.from('totally-fake-signature').toString('base64url')}`;
      const res = await api().get('/employees').set(authHeader(fake));
      expect(res.status).toBe(401);
    });
  });

  describe('Mass assignment / over-posting', () => {
    it('POST /employees with an extra unknown field -> 400 (forbidNonWhitelisted, not silently dropped)', async () => {
      const res = await api()
        .post('/employees')
        .set(authHeader(token))
        .send({ ...validEmployeePayload(), isAdmin: true });
      expect(res.status).toBe(400);
    });

    it('POST /employees with a client-supplied id -> 400, never lets the client pick the primary key', async () => {
      const res = await api()
        .post('/employees')
        .set(authHeader(token))
        .send({
          ...validEmployeePayload(),
          id: '11111111-1111-1111-1111-111111111111',
        });
      expect(res.status).toBe(400);
    });
  });

  describe('Injection-style strings are treated as literal data, never executed', () => {
    it('a SQL-injection-shaped `search` value returns 200 with zero matches, not an error', async () => {
      const res = await api()
        .get(
          `/employees?search=${encodeURIComponent("' OR 1=1; DROP TABLE employees;--")}`,
        )
        .set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
    });

    it('a NoSQL-operator-shaped `search` value is treated as a literal substring, not an operator', async () => {
      const res = await api()
        .get(`/employees?search=${encodeURIComponent('{"$ne": null}')}`)
        .set(authHeader(token));
      expect(res.status).toBe(200);
    });

    it('a script-tag employee name is stored and returned as an inert string (JSON API, not HTML)', async () => {
      const payload = validEmployeePayload({
        name: '<script>alert(1)</script>',
      });
      const res = await api()
        .post('/employees')
        .set(authHeader(token))
        .send(payload);
      expect(res.status).toBe(201);
      expect(res.body.name).toBe('<script>alert(1)</script>');
      expect(res.headers['content-type']).toMatch(/application\/json/);
      createdIds.push(res.body.id);
    });
  });

  describe('Error responses never leak internals', () => {
    it('a DB-overflow-triggering salary produces a generic 500 message, no stack trace / Prisma error text', async () => {
      const res = await api()
        .post('/employees')
        .set(authHeader(token))
        .send(validEmployeePayload({ salary: 1e30 }));
      // Documented as a finding in API_Test_Report.md: this SHOULD be a 400
      // (missing upper-bound validation matching the Decimal(14,2) column),
      // but whatever status it is, it must never leak Prisma/stack details.
      expect(res.status).toBeGreaterThanOrEqual(400);
      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/at\s+.*\.(ts|js):\d+/); // no stack-frame-looking text
      expect(body.toLowerCase()).not.toContain('prisma');
    });
  });
});
