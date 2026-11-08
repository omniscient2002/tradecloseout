import { Module } from '@nestjs/common';
import { OrganisationsController } from './organisations.controller';
import { OrganisationsService } from './organisations.service';
import { DatabaseModule } from '../../database/database.module';
import { IdentityModule } from '../identity/identity.module';

@Module({
  imports: [DatabaseModule, IdentityModule],
  controllers: [OrganisationsController],
  providers: [OrganisationsService],
  exports: [OrganisationsService],
})
export class OrganisationsModule {}
