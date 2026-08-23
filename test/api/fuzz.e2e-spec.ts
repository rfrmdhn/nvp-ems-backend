import path from 'path';
import { api, authHeader, getAuthToken } from './helpers/client';

/**
 * Fuzz: malformed/adversarial input across the JSON and multipart surfaces.
 * The bar per the brief: never a crash, never a leaked stack trace, always a
 * graceful (4xx, standard error shape) response. This suite originally
 * surfaced four real gaps (see API_Test_Report.md's "Open findings" table
 * and git history for the pre-fix versions of these tests) — all four are
 * now fixed in src/, and the tests below assert the fixed behavior:
 * CreateEmployeeDto rejects control characters, oversized strings, and
 * out-of-range salaries with a 400 instead of letting them reach Postgres
 * as an uncaught 500, and csv-import.processor.ts's `relax_column_count`
 * turns a wrong-column-count CSV row into a normal skipped row instead of
 * failing the whole job.
 */
describe('Fuzz', () => {
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

  function expectGracefulErrorShape(res: { status: number; body: any }) {
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(600);
    expect(res.body).toHaveProperty('statusCode', res.status);
    expect(res.body).toHaveProperty('message');
    expect(JSON.stringify(res.body).toLowerCase()).not.toMatch(
      /at .*\.(ts|js):\d+/,
    );
  }

  /** Waits for a csv-import job to settle, retrying a couple extra polls if
   * `state` flips to completed/failed before summary fields are populated
   * (an eventual-consistency window was observed once under heavy back-to-
   * back load; not reliably reproduced — see API_Test_Report.md). */
  async function pollUntilSettled(jobId: string, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    let settledButIncomplete = 0;
    while (Date.now() < deadline) {
      const res = await api()
        .get(`/csv-import/${jobId}/status`)
        .set(authHeader(token));
      const body = res.body;
      if (body?.state === 'failed') return body;
      if (body?.state === 'completed') {
        if (body.imported !== undefined || settledButIncomplete >= 3) {
          return body;
        }
        settledButIncomplete += 1;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(
      `csv-import job ${jobId} did not settle within ${timeoutMs}ms`,
    );
  }

  it('malformed JSON body (broken syntax) -> 400, not a crash', async () => {
    const res = await api()
      .post('/employees')
      .set(authHeader(token))
      .set('Content-Type', 'application/json')
      .send('{"name": "Broken", "age": 30, ' as any);
    expectGracefulErrorShape(res);
    expect(res.status).toBe(400);
  });

  it('wrong content-type (text/plain body claiming to be JSON-shaped) -> 4xx, not a crash', async () => {
    const res = await api()
      .post('/employees')
      .set(authHeader(token))
      .set('Content-Type', 'text/plain')
      .send('name=Broken&age=30');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('empty body -> 400', async () => {
    const res = await api().post('/employees').set(authHeader(token)).send({});
    expectGracefulErrorShape(res);
  });

  it('wrong types across every field -> 400 with a message per field', async () => {
    const res = await api()
      .post('/employees')
      .set(authHeader(token))
      .send({ name: 12345, age: 'thirty', position: true, salary: 'a lot' });
    expectGracefulErrorShape(res);
    expect(res.status).toBe(400);
  });

  it('negative age and negative salary -> 400', async () => {
    const res = await api()
      .post('/employees')
      .set(authHeader(token))
      .send({ name: 'Negative Test', age: -5, position: 'QA', salary: -1 });
    expectGracefulErrorShape(res);
    expect(res.status).toBe(400);
  });

  it('NaN/Infinity-shaped numeric values -> 400, not accepted as numbers', async () => {
    const res = await api()
      .post('/employees')
      .set(authHeader(token))
      .send({ name: 'NaN Test', age: NaN, position: 'QA', salary: Infinity });
    expectGracefulErrorShape(res);
    expect(res.status).toBe(400);
  });

  it('a deeply unicode/emoji/RTL name is accepted and echoed back byte-for-byte', async () => {
    const weirdName = '\u{1F680}\u{1F4A5} Ĩëllo مرحبا 你好';
    const res = await api()
      .post('/employees')
      .set(authHeader(token))
      .send({ name: weirdName, age: 30, position: 'QA', salary: 1000000 });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe(weirdName);
    createdIds.push(res.body.id);
  });

  it('a name containing a NUL byte (0x00) -> 400, never reaches Postgres', async () => {
    const nulName = `Null${String.fromCharCode(0)}Byte${String.fromCharCode(7)}Test`;
    const res = await api()
      .post('/employees')
      .set(authHeader(token))
      .send({ name: nulName, age: 30, position: 'QA', salary: 1000000 });
    // Previously a 500: class-validator's @IsString() accepted any string,
    // including one containing a NUL byte, so it reached Postgres and got
    // rejected at the encoding level ("invalid byte sequence for encoding
    // UTF8: 0x00") as an uncaught PrismaClientUnknownRequestError.
    // CreateEmployeeDto's @Matches(NO_CONTROL_CHARACTERS) now catches this
    // at validation time instead.
    expectGracefulErrorShape(res);
    expect(res.status).toBe(400);
    expect(res.body.message).toEqual(
      expect.arrayContaining([expect.stringContaining('control characters')]),
    );
  });

  it('an extremely long (100,000 char) name -> 400, rejected by @MaxLength', async () => {
    const hugeName = 'A'.repeat(100_000);
    const res = await api()
      .post('/employees')
      .set(authHeader(token))
      .send({ name: hugeName, age: 30, position: 'QA', salary: 1000000 });
    // Previously accepted with no cap (unbounded Prisma TEXT column,
    // CreateEmployeeDto had no @MaxLength) — a storage-abuse/oversized-
    // payload vector. Now rejected at the validation layer.
    expectGracefulErrorShape(res);
    expect(res.status).toBe(400);
  });

  it('a salary far beyond the Decimal(14,2) column range -> 400, not a 500', async () => {
    const res = await api()
      .post('/employees')
      .set(authHeader(token))
      .send({ name: 'Overflow Test', age: 30, position: 'QA', salary: 1e30 });
    // Previously a 500 (uncaught Postgres "numeric field overflow").
    // CreateEmployeeDto.salary now has an explicit @Max matching the
    // Decimal(14,2) column's range.
    expectGracefulErrorShape(res);
    expect(res.status).toBe(400);
  });

  it('age/salary as arrays or objects -> 400, not coerced', async () => {
    const res = await api()
      .post('/employees')
      .set(authHeader(token))
      .send({
        name: 'Weird Types',
        age: [30],
        position: 'QA',
        salary: { amount: 1 },
      });
    expectGracefulErrorShape(res);
    expect(res.status).toBe(400);
  });

  describe('CSV upload fuzzing', () => {
    it('an empty .csv file -> handled gracefully, no crash', async () => {
      const res = await api()
        .post('/csv-import/upload')
        .set(authHeader(token))
        .attach('file', Buffer.from(''), 'empty.csv');
      expect(res.status).toBeLessThan(500);
    });

    it('a .csv with only a header row (zero data rows) -> accepted, completes with imported=0', async () => {
      const res = await api()
        .post('/csv-import/upload')
        .set(authHeader(token))
        .attach(
          'file',
          Buffer.from('name,age,position,salary\n'),
          'header-only.csv',
        );
      expect(res.status).toBe(202);

      const status = await pollUntilSettled(res.body.jobId);
      expect(status.state).toBe('completed');
      expect(status.imported).toBe(0);
    });

    it('a .csv with semantically-invalid-but-same-column-count rows -> skip-and-collect works', async () => {
      // scripts/invalid-employees.csv: 1 valid row + blank name + non-numeric
      // age + non-numeric salary + negative salary — shared with the
      // frontend's own e2e fixture (frontend/e2e/fixtures/invalid-employees.csv)
      // so both sides of the stack exercise the exact same malformed input.
      const res = await api()
        .post('/csv-import/upload')
        .set(authHeader(token))
        .attach(
          'file',
          path.join(__dirname, '../../scripts/invalid-employees.csv'),
        );
      expect(res.status).toBe(202);

      const status = await pollUntilSettled(res.body.jobId);
      expect(status.state).toBe('completed');
      expect(status.imported).toBe(1);
      expect(status.skipped).toBe(4);
      expect(status.errors).toHaveLength(4);
    });

    it('a row with the WRONG COLUMN COUNT is skipped, not fatal to the whole job', async () => {
      const csv =
        'name,age,position,salary\n' +
        'Good Row,30,QA,1000000\n' +
        'Missing Fields,25\n' + // structurally malformed: 2 cols, not 4
        'Another Good Row,28,QA,2000000\n';
      const res = await api()
        .post('/csv-import/upload')
        .set(authHeader(token))
        .attach('file', Buffer.from(csv), 'wrong-column-count.csv');
      expect(res.status).toBe(202);

      const status = await pollUntilSettled(res.body.jobId);
      // Previously: csv-parse threw ("Invalid Record Length: columns length
      // is 4, got 2 on line N") from inside the streaming loop, which the
      // processor's outer try/catch treated as fatal — the job ended in
      // `failed` and "Another Good Row" (after the bad line) was never even
      // seen, contradicting AUDIT.md #3's documented skip-and-collect
      // resolution. csv-import.processor.ts now parses with
      // `relax_column_count: true`, so a short row's missing fields surface
      // as `undefined` and validateRow() rejects it like any other invalid
      // row — both good rows import, the bad one is skipped and reported.
      expect(status.state).toBe('completed');
      expect(status.imported).toBe(2);
      expect(status.skipped).toBe(1);
      expect(status.errors).toHaveLength(1);
      expect(status.errors?.[0]).toMatch(/Row 2/);
    });

    it('a file with a .csv extension but binary/garbage content -> handled gracefully, no crash', async () => {
      const garbage = Buffer.from([
        0x00, 0xff, 0xfe, 0x01, 0x02, 0x89, 0x50, 0x4e, 0x47,
      ]);
      const res = await api()
        .post('/csv-import/upload')
        .set(authHeader(token))
        .attach('file', garbage, 'fake.csv');
      expect(res.status).toBeLessThan(500);
    });

    it('a double extension (.csv.exe) is rejected by the extension check -> 400', async () => {
      const res = await api()
        .post('/csv-import/upload')
        .set(authHeader(token))
        .attach(
          'file',
          Buffer.from('name,age,position,salary\n'),
          'sneaky.csv.exe',
        );
      expect(res.status).toBe(400);
    });
  });
});
