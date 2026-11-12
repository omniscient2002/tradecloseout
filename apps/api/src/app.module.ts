import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './modules/health/health.module';
import { IdentityModule } from './modules/identity/identity.module';
import { OrganisationsModule } from './modules/organisations/organisations.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { ChecklistsModule } from './modules/checklists/checklists.module';
import { AssetsModule } from './modules/assets/assets.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { HandoverModule } from './modules/handover/handover.module';
import { PartiesModule } from './modules/parties/parties.module';
import { ConfigurationModule } from './modules/configuration/configuration.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { BillingModule } from './modules/billing/billing.module';
import { SignaturesModule } from './modules/signatures/signatures.module';
import { WorkItemsModule } from './modules/work-items/work-items.module';
import { CommissioningModule } from './modules/commissioning/commissioning.module';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { VisibilityProjectionInterceptor } from './common/interceptors/visibility-projection.interceptor';

@Module({
  imports: [
    DatabaseModule,
    HealthModule,
    IdentityModule,
    OrganisationsModule,
    ProjectsModule,
    ChecklistsModule,
    AssetsModule,
    DocumentsModule,
    ReviewsModule,
    HandoverModule,
    PartiesModule,
    ConfigurationModule,
    NotificationsModule,
    BillingModule,
    SignaturesModule,
    WorkItemsModule,
    CommissioningModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: IdempotencyInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: VisibilityProjectionInterceptor,
    },
  ],
})
export class AppModule {}
