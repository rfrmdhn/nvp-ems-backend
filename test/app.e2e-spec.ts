import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

/**
 * Placeholder e2e suite kept/adapted from Nest's starter template. This
 * boots the REAL AppModule (Prisma/Redis connections included), so it needs
 * a reachable Postgres + Redis (e.g. via `docker compose up postgres redis`)
 * to pass — it is NOT part of `npm test` (see package.json's separate
 * `test:e2e` script), and is not required to be green for this technical
 * test's harness phase. See docs/superpowers/tests/*.md for the currently
 * required (mocked-dependency) unit test suites, and CLAUDE.md's Testing
 * Strategy section for why a fuller e2e suite is a deferred, not omitted,
 * next step.
 */
describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET) returns a health-check payload', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect({ status: 'ok', service: 'ems-backend' });
  });

  afterEach(async () => {
    await app.close();
  });
});
