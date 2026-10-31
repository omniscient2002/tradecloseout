import { Module, Global } from '@nestjs/common';
import { TenantDbService } from './tenant-db.service';

@Global()
@Module({
  providers: [TenantDbService],
  exports: [TenantDbService],
})
export class DatabaseModule {}
