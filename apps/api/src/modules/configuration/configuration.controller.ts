import {Body,Controller,Get,Param,Post,Req,UseGuards} from '@nestjs/common';
import {ConfigurationService} from './configuration.service';
import {SessionCsrfGuard} from '../../common/guards/session-csrf.guard';
import {PermissionGuard,RequirePermission} from '../../common/guards/permission.guard';
@Controller('api/v1')
@UseGuards(SessionCsrfGuard,PermissionGuard)
export class ConfigurationController{
 constructor(private readonly service:ConfigurationService){}
 @Get('configuration/versions') @RequirePermission('template.manage')
 list(@Req()req:any){return this.service.listVersions(req.userContext);}
 @Post('configuration/versions') @RequirePermission('template.manage')
 create(@Req()req:any,@Body()dto:unknown){return this.service.createVersion(req.userContext,dto);}
 @Post('configuration/installations') @RequirePermission('template.manage')
 install(@Req()req:any,@Body()dto:unknown){return this.service.installPack(req.userContext,dto);}
 @Post('configuration/versions/:id/publish') @RequirePermission('template.manage')
 publish(@Req()req:any,@Param('id')id:string){return this.service.publish(req.userContext,id);}
 @Post('configuration/versions/:id/archive') @RequirePermission('template.manage')
 archive(@Req()req:any,@Param('id')id:string){return this.service.publish(req.userContext,id,true);}
 @Post('projects/:projectId/configuration/preview') @RequirePermission('project.manage')
 preview(@Req()req:any,@Param('projectId')id:string,@Body()dto:{versionIds:unknown}){return this.service.preview(req.userContext,id,dto?.versionIds);}
 @Post('projects/:projectId/configuration/change-requests') @RequirePermission('project.manage')
 propose(@Req()req:any,@Param('projectId')id:string,@Body()dto:unknown){return this.service.proposeChange(req.userContext,id,dto);}
 @Post('projects/:projectId/configuration/apply') @RequirePermission('project.manage')
 apply(@Req()req:any,@Param('projectId')id:string,@Body()dto:unknown){return this.service.apply(req.userContext,id,dto);}
}
