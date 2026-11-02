import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { DigitalSignatureService } from './digital-signature.service';
import { DigitalSignatureController } from './digital-signature.controller';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [DigitalSignatureController],
  providers: [DigitalSignatureService],
  exports: [DigitalSignatureService],
})
export class SignaturesModule {}
