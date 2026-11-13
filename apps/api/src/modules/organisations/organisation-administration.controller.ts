import {Body,Controller,Get,Param,Post,Req,UseGuards} from '@nestjs/common';
import {SessionCsrfGuard} from '../../common/guards/session-csrf.guard';
import {PermissionGuard,RequirePermission} from '../../common/guards/permission.guard';
import {OrganisationAdministrationService} from './organisation-administration.service';
@Controller('api/v1/organisation-administration')
@UseGuards(SessionCsrfGuard,PermissionGuard)
export class OrganisationAdministrationController{
 constructor(private readonly service:OrganisationAdministrationService){}
 @Get('onboarding') @RequirePermission('org.manage')
 onboarding(@Req()req:any){return this.service.onboarding(req.userContext);}
 @Post('onboarding') @RequirePermission('org.manage')
 save(@Req()req:any,@Body()dto:unknown){return this.service.saveOnboarding(req.userContext,dto);}
 @Get('deletion-requests') @RequirePermission('org.delete')
 deletion(@Req()req:any){return this.service.deletionRequests(req.userContext);}
 @Post('deletion-requests') @RequirePermission('org.delete')
 request(@Req()req:any,@Body()dto:unknown){return this.service.requestDeletion(req.userContext,dto);}
 @Post('deletion-requests/:id/cancel') @RequirePermission('org.delete')
 cancel(@Req()req:any,@Param('id')id:string){return this.service.cancelDeletion(req.userContext,id);}
}
