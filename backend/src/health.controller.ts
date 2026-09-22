import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Liveness probe for the host, and a boot smoke test for the e2e suite.
 *
 * Unauthenticated on purpose — a probe cannot hold a token. It replaces the Nest
 * scaffold's "Hello World!" route, whose controller was never registered in AppModule,
 * so the generated test asserted a route that had not existed since the first commit.
 */
@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  @Get()
  async check() {
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      // Answering 200 here would let the host keep routing traffic to an instance that
      // cannot serve a single query, which is the whole point of having a probe.
      throw new ServiceUnavailableException({ status: 'degraded', database: 'down' });
    }

    return {
      status: 'ok',
      database: 'up',
      uptimeSeconds: Math.round(process.uptime()),
    };
  }
}
