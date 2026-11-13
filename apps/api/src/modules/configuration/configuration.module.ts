import {Module} from '@nestjs/common';
import {ChecklistsModule} from '../checklists/checklists.module';
import {ConfigurationController} from './configuration.controller';
import {ConfigurationService} from './configuration.service';
@Module({imports:[ChecklistsModule],controllers:[ConfigurationController],providers:[ConfigurationService],exports:[ConfigurationService]})
export class ConfigurationModule{}
