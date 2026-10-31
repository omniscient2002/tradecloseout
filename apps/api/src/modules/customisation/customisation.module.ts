import { Module } from '@nestjs/common';
import { ConfigResolverService } from './config-resolver.service';

@Module({
  providers: [ConfigResolverService],
  exports: [ConfigResolverService],
})
export class CustomisationModule {}
