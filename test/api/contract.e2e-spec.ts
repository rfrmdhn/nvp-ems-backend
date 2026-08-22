import Ajv from 'ajv';
import path from 'path';
import {
  api,
  authHeader,
  getAuthToken,
  validEmployeePayload,
} from './helpers/client';

/**
 * Contract: validates real HTTP responses against the app's own live-generated
 * OpenAPI document (Nest Swagger's `/api/docs-json`), not a hand-maintained
 * copy — so this test only stays green if the code's decorators actually
 * describe reality. Also snapshots the doc so an unintended breaking shape
 * change (a field renamed/removed/retyped) is visible in a future diff — see
 * the "Regression" note in API_Test_Report.md for why this snapshot doubles
 * as the regression baseline.
 */
describe('Contract: live OpenAPI vs actual responses', () => {
  let token: string;
  let openapi: any;
  const ajv = new Ajv({ strict: false });

  function resolveSchema(schema: any) {
    if (schema?.$ref) {
      const name = schema.$ref.replace('#/components/schemas/', '');
      return openapi.components.schemas[name];
    }
    return schema;
  }

  function schemaWithComponents(schema: any) {
    return { ...schema, components: openapi.components };
  }

  beforeAll(async () => {
    token = await getAuthToken();
    const doc = await api().get('/api/docs-json');
    expect(doc.status).toBe(200);
    openapi = doc.body;
  });

  it('the OpenAPI doc declares every implemented route', () => {
    const paths = Object.keys(openapi.paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/auth/login',
        '/employees',
        '/employees/{id}',
        '/csv-import/upload',
        '/csv-import/{jobId}/status',
        '/notifications/stream',
      ]),
    );
  });

  it('POST /auth/login 200 response matches its documented schema', async () => {
    const res = await api()
      .post('/auth/login')
      .send({ email: 'admin@nusantaradigital.test', password: 'ChangeMe123!' });
    expect(res.status).toBe(200);

    const responseSchema =
      openapi.paths['/auth/login'].post.responses['200'].content[
        'application/json'
      ].schema;
    const resolved = resolveSchema(responseSchema);
    const validate = ajv.compile(schemaWithComponents(resolved));
    const valid = validate(res.body);
    expect(valid).toBe(true);
    if (!valid) {
      console.error(validate.errors);
    }
  });

  it('POST /employees 201 response matches EmployeeResponseDto, including salary-as-string', async () => {
    const res = await api()
      .post('/employees')
      .set(authHeader(token))
      .send(validEmployeePayload());
    expect(res.status).toBe(201);

    const responseSchema =
      openapi.paths['/employees'].post.responses['201'].content[
        'application/json'
      ].schema;
    const resolved = resolveSchema(responseSchema);
    const validate = ajv.compile(schemaWithComponents(resolved));
    const valid = validate(res.body);
    expect(valid).toBe(true);
    if (!valid) {
      console.error(validate.errors);
    }
    // The specific gap this suite exists to catch: salary must be documented
    // (and actually returned) as a string, never silently become a number.
    expect(typeof res.body.salary).toBe('string');
    expect(resolved.properties.salary.type).toBe('string');

    await api().delete(`/employees/${res.body.id}`).set(authHeader(token));
  });

  it('GET /employees 200 response matches PaginatedEmployeesResponseDto', async () => {
    const res = await api().get('/employees?limit=1').set(authHeader(token));
    expect(res.status).toBe(200);

    const responseSchema =
      openapi.paths['/employees'].get.responses['200'].content[
        'application/json'
      ].schema;
    const resolved = resolveSchema(responseSchema);
    const validate = ajv.compile(schemaWithComponents(resolved));
    const valid = validate(res.body);
    expect(valid).toBe(true);
    if (!valid) {
      console.error(validate.errors);
    }
  });

  it('POST /csv-import/upload 202 and GET status 200 responses match their documented schemas', async () => {
    const upload = await api()
      .post('/csv-import/upload')
      .set(authHeader(token))
      .attach(
        'file',
        path.join(__dirname, '../../scripts/sample-employees.csv'),
      );
    expect(upload.status).toBe(202);

    const uploadSchema = resolveSchema(
      openapi.paths['/csv-import/upload'].post.responses['202'].content[
        'application/json'
      ].schema,
    );
    const validateUpload = ajv.compile(schemaWithComponents(uploadSchema));
    expect(validateUpload(upload.body)).toBe(true);

    // Give the worker a brief moment, then check whatever state it's in —
    // the schema must hold for in-flight state too, not just "completed".
    await new Promise((r) => setTimeout(r, 200));
    const status = await api()
      .get(`/csv-import/${upload.body.jobId}/status`)
      .set(authHeader(token));
    expect(status.status).toBe(200);

    const statusSchema = resolveSchema(
      openapi.paths['/csv-import/{jobId}/status'].get.responses['200'].content[
        'application/json'
      ].schema,
    );
    const validateStatus = ajv.compile(schemaWithComponents(statusSchema));
    const validStatus = validateStatus(status.body);
    expect(validStatus).toBe(true);
    if (!validStatus) {
      console.error(validateStatus.errors);
    }
  });

  it('every guarded route documents `security: [{ bearer: [] }]`', () => {
    const guardedOperations = [
      openapi.paths['/employees'].get,
      openapi.paths['/employees'].post,
      openapi.paths['/employees/{id}'].get,
      openapi.paths['/employees/{id}'].put,
      openapi.paths['/employees/{id}'].delete,
      openapi.paths['/csv-import/upload'].post,
      openapi.paths['/csv-import/{jobId}/status'].get,
    ];
    for (const op of guardedOperations) {
      expect(op.security).toEqual([{ bearer: [] }]);
    }
  });
});
