import { Module, Global } from '@nestjs/common';
import { Pool } from 'pg';
import { TenantDbService } from './tenant-db.service';

@Global()
@Module({
  providers: [
    TenantDbService,
    {
      provide: Pool,
      useFactory: (db: TenantDbService) => db.getPool(),
      inject: [TenantDbService],
    },
  ],
  exports: [TenantDbService, Pool],
})
export class DatabaseModule {}
