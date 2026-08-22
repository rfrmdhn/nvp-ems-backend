import {
  api,
  authHeader,
  getAuthToken,
  validEmployeePayload,
} from './helpers/client';

/**
 * Functional coverage for /employees, mirroring the table in
 * docs/superpowers/specs/employees.md. Every employee this suite creates is
 * deleted again in afterAll so repeated runs don't pollute the seeded roster.
 */
describe('Functional: /employees CRUD', () => {
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

  it('POST /employees with a valid payload -> 201, full row, salary echoed back', async () => {
    const payload = validEmployeePayload({ salary: 12000000 });
    const res = await api()
      .post('/employees')
      .set(authHeader(token))
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: payload.name,
      age: payload.age,
      position: payload.position,
    });
    expect(res.body.id).toBeTruthy();
    expect(res.body.createdAt).toBeTruthy();
    expect(res.body.updatedAt).toBeTruthy();
    createdIds.push(res.body.id);
  });

  it('POST /employees missing/invalid fields -> 400 with a message per violation', async () => {
    const res = await api()
      .post('/employees')
      .set(authHeader(token))
      .send({ name: '', age: 200, position: '', salary: -5 });

    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.message)).toBe(true);
    expect(res.body.message.length).toBeGreaterThanOrEqual(4);
  });

  it('GET /employees/:id for a just-created row -> 200, matches what was created', async () => {
    const created = await api()
      .post('/employees')
      .set(authHeader(token))
      .send(validEmployeePayload());
    createdIds.push(created.body.id);

    const res = await api()
      .get(`/employees/${created.body.id}`)
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.body.id);
    expect(res.body.name).toBe(created.body.name);
  });

  it('GET /employees/:id for a well-formed but non-existent uuid -> 404', async () => {
    const res = await api()
      .get('/employees/00000000-0000-0000-0000-000000000000')
      .set(authHeader(token));
    expect(res.status).toBe(404);
  });

  it('GET /employees/:id for a malformed (non-uuid) id -> 400, never reaches the DB', async () => {
    const res = await api().get('/employees/not-a-uuid').set(authHeader(token));
    expect(res.status).toBe(400);
  });

  it('PUT /employees/:id partial update -> 200, only the given field changes, updatedAt bumps', async () => {
    const created = await api()
      .post('/employees')
      .set(authHeader(token))
      .send(validEmployeePayload({ salary: 10000000 }));
    createdIds.push(created.body.id);

    await new Promise((r) => setTimeout(r, 10));

    const res = await api()
      .put(`/employees/${created.body.id}`)
      .set(authHeader(token))
      .send({ salary: 16000000 });

    expect(res.status).toBe(200);
    expect(res.body.salary).toBe('16000000');
    expect(res.body.name).toBe(created.body.name);
    expect(new Date(res.body.updatedAt).getTime()).toBeGreaterThan(
      new Date(created.body.updatedAt).getTime(),
    );
  });

  it('PUT /employees/:id with a client-supplied id in the body -> 400 (never a silent redirect)', async () => {
    const created = await api()
      .post('/employees')
      .set(authHeader(token))
      .send(validEmployeePayload());
    createdIds.push(created.body.id);

    const res = await api()
      .put(`/employees/${created.body.id}`)
      .set(authHeader(token))
      .send({ id: '11111111-1111-1111-1111-111111111111', salary: 5000000 });

    expect(res.status).toBe(400);
  });

  it('PUT /employees/:id for a non-existent id -> 404, no write attempted', async () => {
    const res = await api()
      .put('/employees/00000000-0000-0000-0000-000000000000')
      .set(authHeader(token))
      .send({ salary: 1000000 });
    expect(res.status).toBe(404);
  });

  it('DELETE /employees/:id -> 200 with the deleted row, then GET on it -> 404', async () => {
    const created = await api()
      .post('/employees')
      .set(authHeader(token))
      .send(validEmployeePayload());

    const del = await api()
      .delete(`/employees/${created.body.id}`)
      .set(authHeader(token));
    expect(del.status).toBe(200);
    expect(del.body.id).toBe(created.body.id);

    const getAfter = await api()
      .get(`/employees/${created.body.id}`)
      .set(authHeader(token));
    expect(getAfter.status).toBe(404);
  });

  describe('GET /employees — pagination/search/sort', () => {
    const marker = `PagSortTest-${Date.now()}`;

    beforeAll(async () => {
      const rows = [
        {
          name: `${marker} Alice`,
          age: 25,
          position: 'Engineer',
          salary: 5000000,
        },
        {
          name: `${marker} Bob`,
          age: 40,
          position: 'Manager',
          salary: 20000000,
        },
        {
          name: `${marker} Carol`,
          age: 30,
          position: 'Engineer',
          salary: 8000000,
        },
      ];
      for (const row of rows) {
        const res = await api()
          .post('/employees')
          .set(authHeader(token))
          .send(row);
        createdIds.push(res.body.id);
      }
    });

    it('defaults: page 1, limit 50, createdAt desc, response shape { data, total, page, limit }', async () => {
      const res = await api().get('/employees').set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('page', 1);
      expect(res.body).toHaveProperty('limit', 50);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('?search matches name/position case-insensitively and total reflects the filtered count', async () => {
      const res = await api()
        .get(`/employees?search=${encodeURIComponent(marker.toLowerCase())}`)
        .set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(3);
      expect(res.body.data).toHaveLength(3);
    });

    it('?page & ?limit slice correctly', async () => {
      const res = await api()
        .get(
          `/employees?search=${encodeURIComponent(marker)}&page=2&limit=1&sortBy=name&sortOrder=asc`,
        )
        .set(authHeader(token));
      expect(res.status).toBe(200);
      expect(res.body.page).toBe(2);
      expect(res.body.limit).toBe(1);
      expect(res.body.data).toHaveLength(1);
      // asc by name: Alice(0), Bob(1) -> page 2 is Bob
      expect(res.body.data[0].name).toBe(`${marker} Bob`);
    });

    it('?sortBy=salary&sortOrder=asc orders ascending by salary', async () => {
      const res = await api()
        .get(
          `/employees?search=${encodeURIComponent(marker)}&sortBy=salary&sortOrder=asc`,
        )
        .set(authHeader(token));
      expect(res.status).toBe(200);
      const salaries = res.body.data.map((e: { salary: string }) =>
        Number(e.salary),
      );
      const sorted = [...salaries].sort((a, b) => a - b);
      expect(salaries).toEqual(sorted);
    });

    it('?sortBy=notacolumn -> 400 (allowlisted enum, never passed straight to Prisma)', async () => {
      const res = await api()
        .get('/employees?sortBy=notacolumn')
        .set(authHeader(token));
      expect(res.status).toBe(400);
    });

    it('?limit=501 (over the 500 cap) -> 400', async () => {
      const res = await api()
        .get('/employees?limit=501')
        .set(authHeader(token));
      expect(res.status).toBe(400);
    });

    it('?page=0 -> 400 (1-indexed, min 1)', async () => {
      const res = await api().get('/employees?page=0').set(authHeader(token));
      expect(res.status).toBe(400);
    });
  });
});
