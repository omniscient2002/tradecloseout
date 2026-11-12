// apps/api/src/modules/health/health.controller.ts
import { Controller, Get, Res, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { TenantDbService } from '../../database/tenant-db.service';

@Controller()
export class HealthController {
  constructor(private readonly db: TenantDbService) {}

  @Get('health')
  async health(@Res() res: Response) {
    return this.checkHealth(res);
  }

  @Get('api/v1/health')
  async apiHealth(@Res() res: Response) {
    return this.checkHealth(res);
  }

  private async checkHealth(res: Response) {
    // This route is unauthenticated. Never disclose SQL/provider diagnostics,
    // dependency names beyond the existing stable field, or exception messages.
    res.setHeader('Cache-Control', 'no-store');
    try {
      const dbCheck = await this.db.queryGlobal('SELECT 1 as alive');
      const isAlive = Boolean(dbCheck && dbCheck.length > 0);

      return res.status(isAlive ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json({
        status: isAlive ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        version: '0.2.1',
        database: isAlive ? 'connected' : 'disconnected',
      });
    } catch {
      return res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        status: 'degraded',
        timestamp: new Date().toISOString(),
        version: '0.2.1',
        database: 'disconnected',
      });
    }
  }
}
