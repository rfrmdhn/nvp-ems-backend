import path from 'path';
import { api, authHeader, getAuthToken } from './helpers/client';

const SAMPLE_CSV = path.join(__dirname, '../../scripts/sample-employees.csv');
const SAMPLE_CSV_ROWS = 20; // scripts/sample-employees.csv has 20 data rows (see README)

async function pollUntilCompleted(
  jobId: string,
  token: string,
  timeoutMs = 20_000,
) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await api()
      .get(`/csv-import/${jobId}/status`)
      .set(authHeader(token));
    if (last.body?.state === 'completed' || last.body?.state === 'failed') {
      return last;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `csv-import job ${jobId} did not complete within ${timeoutMs}ms`,
  );
}

describe('Functional: /csv-import', () => {
  let token: string;

  beforeAll(async () => {
    token = await getAuthToken();
  });

  it('upload -> 202 + jobId, poll status -> completed with imported=20, skipped=0', async () => {
    const upload = await api()
      .post('/csv-import/upload')
      .set(authHeader(token))
      .attach('file', SAMPLE_CSV);

    expect(upload.status).toBe(202);
    expect(upload.body.jobId).toBeTruthy();

    const final = await pollUntilCompleted(upload.body.jobId, token);
    expect(final.status).toBe(200);
    expect(final.body.state).toBe('completed');
    expect(final.body.imported).toBe(SAMPLE_CSV_ROWS);
    expect(final.body.skipped).toBe(0);
    expect(final.body.errors).toEqual([]);
    expect(final.body.percent).toBe(100);
  });

  it('upload without a file -> 400, field name "file" is required', async () => {
    const res = await api()
      .post('/csv-import/upload')
      .set(authHeader(token))
      .field('irrelevant', 'value');
    expect(res.status).toBe(400);
  });

  it('upload a non-.csv file -> 400, rejected by the fileFilter before enqueueing', async () => {
    const res = await api()
      .post('/csv-import/upload')
      .set(authHeader(token))
      .attach('file', Buffer.from('not a csv'), 'notes.txt');
    expect(res.status).toBe(400);
  });

  it('GET status for an unknown jobId -> 404', async () => {
    const res = await api()
      .get('/csv-import/does-not-exist-12345/status')
      .set(authHeader(token));
    expect(res.status).toBe(404);
  });
});
