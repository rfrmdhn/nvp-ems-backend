import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

/**
 * Stress test: ramps well past normal traffic to find where this API
 * actually breaks and how it degrades (timeouts, connection-pool exhaustion,
 * rising latency) — there's no rate limiter or autoscaling in this stack, so
 * the expected failure mode is Postgres/Prisma connection-pool saturation,
 * not a clean 429. Run via `npm run test:stress`. Observed breaking point
 * and failure mode are recorded in API_Test_Report.md (from an actual run,
 * not predicted ahead of time).
 */

const BASE_URL = __ENV.API_BASE_URL || 'http://localhost:3000';
const ADMIN_EMAIL = __ENV.ADMIN_EMAIL || 'admin@nusantaradigital.test';
const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD || 'ChangeMe123!';

export const options = {
  scenarios: {
    ramp_to_breaking_point: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '30s', target: 50 },
        { duration: '30s', target: 100 },
        { duration: '30s', target: 200 },
        { duration: '30s', target: 300 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  // No hard thresholds that abort the run — the point of a stress test is
  // to observe what happens past the SLA, not to fail fast at it.
};

const errorRate = new Rate('ems_error_rate');

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

  const listRes = http.get(
    `${BASE_URL}/employees?page=1&limit=50&sortBy=createdAt&sortOrder=desc`,
    { headers },
  );
  errorRate.add(
    !check(listRes, { 'GET /employees ok': (r) => r.status === 200 }),
  );

  if (Math.random() < 0.2) {
    const payload = JSON.stringify({
      name: `Stress Test Employee ${__VU}-${__ITER}`,
      age: 20 + (__ITER % 60),
      position: 'Stress Test Position',
      salary: 5000000 + __ITER * 1000,
    });
    const createRes = http.post(`${BASE_URL}/employees`, payload, { headers });
    errorRate.add(
      !check(createRes, { 'POST /employees ok': (r) => r.status === 201 }),
    );
  }

  sleep(0.5);
}
