import path from 'path';
import {
  API_BASE_URL,
  api,
  authHeader,
  getAuthToken,
  validEmployeePayload,
} from './helpers/client';

/**
 * Integration: exercises the cross-service workflow the brief describes —
 * login -> create employee -> worker processes the `employee-created` BullMQ
 * job -> api relays it over Redis pub/sub -> SSE client sees `employee.created`
 * -> CSV bulk import -> poll to completion -> GET /employees reflects both.
 * This is the one suite that proves the queue/notifications/worker wiring
 * actually works end-to-end, not just each service in isolation.
 */

/** Reads one or more SSE events off a live stream until `predicate` matches one, or times out. */
async function waitForSseEvent(
  token: string,
  predicate: (eventType: string, data: unknown) => boolean,
  timeoutMs = 10_000,
): Promise<{ type: string; data: unknown }> {
  const controller = new AbortController();
  const res = await fetch(
    `${API_BASE_URL}/notifications/stream?token=${encodeURIComponent(token)}`,
    { signal: controller.signal, headers: { Connection: 'close' } },
  );
  if (!res.ok || !res.body) {
    throw new Error(`SSE connect failed: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      controller.abort();
      reject(
        new Error(
          `Timed out waiting for matching SSE event after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);
  });

  const read = (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        throw new Error('SSE stream closed before a matching event arrived');
      }
      buffer += decoder.decode(value, { stream: true });

      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() ?? '';

      for (const chunk of chunks) {
        const lines = chunk.split('\n');
        const eventLine = lines.find((l) => l.startsWith('event: '));
        const dataLine = lines.find((l) => l.startsWith('data: '));
        if (!eventLine || !dataLine) continue;

        const type = eventLine.slice('event: '.length);
        const raw = dataLine.slice('data: '.length);
        let data: unknown;
        try {
          data = JSON.parse(raw);
        } catch {
          continue;
        }

        if (predicate(type, data)) {
          controller.abort();
          return { type, data };
        }
      }
    }
  })();

  try {
    return await Promise.race([read, timeout]);
  } finally {
    await reader.cancel().catch(() => undefined);
    controller.abort();
  }
}

async function pollCsvStatus(jobId: string, token: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await api()
      .get(`/csv-import/${jobId}/status`)
      .set(authHeader(token));
    if (res.body?.state === 'completed' || res.body?.state === 'failed') {
      return res.body;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `csv-import job ${jobId} did not settle within ${timeoutMs}ms`,
  );
}

describe('Integration: login -> create employee -> SSE -> CSV import -> list reflects both', () => {
  it('runs the full cross-service workflow', async () => {
    // 1. Login
    const token = await getAuthToken();

    // 2. Open the SSE stream BEFORE creating the employee (events aren't
    //    replayed for late subscribers — see docs/superpowers/AUDIT.md #5),
    //    then create it and wait for the matching employee.created event.
    const payload = validEmployeePayload({
      name: `Integration Flow ${Date.now()}`,
    });

    const [ssePromise, createRes] = await Promise.all([
      waitForSseEvent(
        token,
        (type, data) =>
          type === 'employee.created' &&
          (data as { name?: string })?.name === payload.name,
      ),
      (async () => {
        // small delay so the SSE connection is established before the
        // create fires and the event gets published
        await new Promise((r) => setTimeout(r, 300));
        return api().post('/employees').set(authHeader(token)).send(payload);
      })(),
    ]);

    expect(createRes.status).toBe(201);
    const employeeId = createRes.body.id;
    expect((ssePromise.data as { id?: string }).id).toBe(employeeId);

    // 3. CSV bulk import
    const upload = await api()
      .post('/csv-import/upload')
      .set(authHeader(token))
      .attach(
        'file',
        path.join(__dirname, '../../scripts/sample-employees.csv'),
      );
    expect(upload.status).toBe(202);

    const finalStatus = await pollCsvStatus(upload.body.jobId, token);
    expect(finalStatus.state).toBe('completed');
    expect(finalStatus.imported).toBe(20);

    // 4. GET /employees reflects both the single create and the CSV import
    const single = await api()
      .get(`/employees/${employeeId}`)
      .set(authHeader(token));
    expect(single.status).toBe(200);

    const listed = await api()
      .get(`/employees?search=${encodeURIComponent(payload.name)}`)
      .set(authHeader(token));
    expect(listed.body.total).toBe(1);

    // cleanup
    await api().delete(`/employees/${employeeId}`).set(authHeader(token));
  }, 30_000);
});
