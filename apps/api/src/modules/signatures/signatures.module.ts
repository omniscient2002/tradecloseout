import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { DigitalSignatureService } from './digital-signature.service';
import { DigitalSignatureController } from './digital-signature.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [DigitalSignatureController],
  providers: [DigitalSignatureService],
  exports: [DigitalSignatureService],
})
export class SignaturesModule {}
