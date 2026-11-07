import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { S3StorageService } from './s3-storage.service';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, S3StorageService],
  exports: [DocumentsService, S3StorageService],
})
export class DocumentsModule {}
