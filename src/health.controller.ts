import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from './auth/decorators/public.decorator.js';
import { PrismaService } from './prisma/prisma.service.js';

/** Liveness/readiness for the load balancer or uptime monitor. */
@ApiTags('health')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'OK when the API can reach the database' })
  async check() {
    const started = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ status: 'error', db: 'down' });
    }
    return {
      status: 'ok',
      db: 'up',
      dbLatencyMs: Date.now() - started,
      uptimeS: Math.round(process.uptime()),
    };
  }
}
