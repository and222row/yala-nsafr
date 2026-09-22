import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

/**
 * Boot smoke test. It replaces the generated "Hello World!" test, which asserted a route
 * whose controller was never registered in AppModule and so had failed since the first
 * commit — a permanently red test that would have hidden a real one.
 *
 * Booting the whole graph is worth a few seconds on its own: a repository injected
 * without being added to the owning module's forFeature breaks every request at startup,
 * and this catches it in one test instead of in all 168.
 */
describe('Application boot (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('resolves every provider and serves the health probe', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);

    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('up');
    expect(typeof res.body.uptimeSeconds).toBe('number');
  });
});
