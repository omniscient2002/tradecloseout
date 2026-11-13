import {WorkAllocationService} from './work-allocation.service';
import {OrganisationAdministrationController} from './organisation-administration.controller';
import {OrganisationAdministrationService} from './organisation-administration.service';
import { Module } from '@nestjs/common';
import { OrganisationsController } from './organisations.controller';
import { OrganisationsService } from './organisations.service';
import { DatabaseModule } from '../../database/database.module';
import { IdentityModule } from '../identity/identity.module';

@Module({
  imports: [DatabaseModule, IdentityModule],
  controllers: [OrganisationsController,OrganisationAdministrationController],
  providers: [WorkAllocationService,OrganisationsService,OrganisationAdministrationService],
  exports: [OrganisationsService],
})
export class OrganisationsModule {}
