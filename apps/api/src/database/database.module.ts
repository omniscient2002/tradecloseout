import { Module, Global } from '@nestjs/common';
import { Pool } from 'pg';
import { TenantDbService } from './tenant-db.service';
import { SessionCsrfGuard } from '../common/guards/session-csrf.guard';
import { PermissionGuard } from '../common/guards/permission.guard';

@Global()
@Module({
  providers: [
    TenantDbService,
    {
      provide: Pool,
      useFactory: (db: TenantDbService) => db.getPool(),
      inject: [TenantDbService],
    },
    SessionCsrfGuard,
    PermissionGuard,
  ],
  exports: [TenantDbService, Pool, SessionCsrfGuard, PermissionGuard],
})
export class DatabaseModule {}
