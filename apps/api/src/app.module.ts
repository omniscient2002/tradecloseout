import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { ChecklistsModule } from './modules/checklists/checklists.module';
import { AssetsModule } from './modules/assets/assets.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { PackagesModule } from './modules/packages/packages.module';
import { PartiesModule } from './modules/parties/parties.module';
import { CustomisationModule } from './modules/customisation/customisation.module';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    ProjectsModule,
    ChecklistsModule,
    AssetsModule,
    DocumentsModule,
    ReviewsModule,
    PackagesModule,
    PartiesModule,
    CustomisationModule,
  ],
})
export class AppModule {}
