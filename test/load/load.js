import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

/**
 * Load test: normal/expected traffic against the two realistic hot paths —
 * GET /employees (read-heavy list) and POST /employees (write path that
 * enqueues a BullMQ job). Run via `npm run test:load` (wraps the official
 * grafana/k6 Docker image — see backend/README.md).
 *
 * SLA targets (this technical test's own definition, documented in
 * API_Test_Report.md — there was no pre-existing SLA to inherit):
 *   - p95 latency < 300ms
 *   - error rate < 1%
 */

const BASE_URL = __ENV.API_BASE_URL || 'http://localhost:3000';
const ADMIN_EMAIL = __ENV.ADMIN_EMAIL || 'admin@nusantaradigital.test';
const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD || 'ChangeMe123!';

export const options = {
  scenarios: {
    steady_traffic: {
      executor: 'constant-vus',
      vus: 20,
      duration: '1m',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<300'],
    http_req_failed: ['rate<0.01'],
  },
};

const errorRate = new Rate('ems_error_rate');
const listDuration = new Trend('ems_get_employees_duration');
const createDuration = new Trend('ems_post_employees_duration');

export function setup() {
  const res = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(res, { 'login succeeded': (r) => r.status === 200 });
  return { token: res.json('accessToken') };
}

export default function (data) {
  const headers = {
    Authorization: `Bearer ${data.token}`,
    'Content-Type': 'application/json',
  };

  // 80% of iterations: list (read-heavy hot path)
  const listRes = http.get(
    `${BASE_URL}/employees?page=1&limit=50&sortBy=createdAt&sortOrder=desc`,
    { headers },
  );
  listDuration.add(listRes.timings.duration);
  const listOk = check(listRes, { 'GET /employees is 200': (r) => r.status === 200 });
  errorRate.add(!listOk);

  // 20% of iterations: create (write path, enqueues employee-created job)
  if (Math.random() < 0.2) {
    const payload = JSON.stringify({
      name: `Load Test Employee ${__VU}-${__ITER}`,
      age: 20 + (__ITER % 60),
      position: 'Load Test Position',
      salary: 5000000 + __ITER * 1000,
    });
    const createRes = http.post(`${BASE_URL}/employees`, payload, { headers });
    createDuration.add(createRes.timings.duration);
    const createOk = check(createRes, { 'POST /employees is 201': (r) => r.status === 201 });
    errorRate.add(!createOk);
  }

  sleep(1);
}
