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
    try {
      const dbCheck = await this.db.queryGlobal('SELECT 1 as alive');
      const isAlive = dbCheck && dbCheck.length > 0;

      return res.status(HttpStatus.OK).json({
        status: isAlive ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        version: '0.2.1',
        database: isAlive ? 'connected' : 'disconnected',
      });
    } catch {
      return res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        version: '0.2.1',
        database: 'error',
        message: 'Health dependency unavailable',
      });
    }
  }
}
