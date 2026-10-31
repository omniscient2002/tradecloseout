// apps/api/src/modules/auth/auth.module.ts

import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { TenantDbService } from '../../database/tenant-db.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, TenantDbService],
  exports: [AuthService],
})
export class AuthModule {}
