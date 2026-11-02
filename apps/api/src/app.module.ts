import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { IdentityModule } from './modules/identity/identity.module';
import { OrganisationsModule } from './modules/organisations/organisations.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { ChecklistsModule } from './modules/checklists/checklists.module';
import { AssetsModule } from './modules/assets/assets.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { PackagesModule } from './modules/packages/packages.module';
import { HandoverModule } from './modules/handover/handover.module';
import { WorkflowsModule } from './modules/workflows/workflows.module';
import { PartiesModule } from './modules/parties/parties.module';
import { CustomisationModule } from './modules/customisation/customisation.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { BillingModule } from './modules/billing/billing.module';
import { SignaturesModule } from './modules/signatures/signatures.module';

@Module({
  imports: [
    DatabaseModule,
    HealthModule,
    IdentityModule,
    OrganisationsModule,
    AuthModule,
    ProjectsModule,
    ChecklistsModule,
    AssetsModule,
    DocumentsModule,
    ReviewsModule,
    PackagesModule,
    HandoverModule,
    WorkflowsModule,
    PartiesModule,
    CustomisationModule,
    NotificationsModule,
    BillingModule,
    SignaturesModule,
  ],
})
export class AppModule {}
