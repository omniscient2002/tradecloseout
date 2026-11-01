import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { ChecklistsModule } from './modules/checklists/checklists.module';
import { AssetsModule } from './modules/assets/assets.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { PackagesModule } from './modules/packages/packages.module';
import { PartiesModule } from './modules/parties/parties.module';
import { CustomisationModule } from './modules/customisation/customisation.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { BillingModule } from './modules/billing/billing.module';

@Module({
  imports: [
    DatabaseModule,
    HealthModule,
    AuthModule,
    ProjectsModule,
    ChecklistsModule,
    AssetsModule,
    DocumentsModule,
    ReviewsModule,
    PackagesModule,
    PartiesModule,
    CustomisationModule,
    NotificationsModule,
    BillingModule,
  ],
})
export class AppModule {}
