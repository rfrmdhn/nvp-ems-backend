import request from 'supertest';

/**
 * Black-box HTTP helpers shared by every test/api/*.e2e-spec.ts suite. These
 * hit a REAL running instance (docker compose up --build) at API_BASE_URL —
 * unlike test/app.e2e-spec.ts, which boots AppModule in-process, these specs
 * treat the API as a deployed black box, matching how the Postman/k6 suites
 * already exercise it.
 */
export const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';

export const ADMIN_EMAIL =
  process.env.ADMIN_EMAIL ?? 'admin@nusantaradigital.test';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'ChangeMe123!';

export function api() {
  return request(API_BASE_URL);
}

let cachedToken: string | undefined;

/** Logs in once per test process and caches the token (routes expire in 1h by default). */
export async function getAuthToken(): Promise<string> {
  if (cachedToken) {
    return cachedToken;
  }
  const res = await api()
    .post('/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  if (res.status !== 200 || !res.body?.accessToken) {
    throw new Error(
      `Login failed while priming test auth token (status ${res.status}): ${JSON.stringify(res.body)}`,
    );
  }
  cachedToken = res.body.accessToken as string;
  return cachedToken;
}

export function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** A minimal, valid employee payload — callers override fields as needed per test. */
export function validEmployeePayload(overrides: Record<string, unknown> = {}) {
  return {
    name: `QA Test Employee ${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    age: 30,
    position: 'QA Automation Engineer',
    salary: 10000000,
    ...overrides,
  };
}
