import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class ExternalApprovalDto {
  @IsIn(['APPROVE']) decision!: 'APPROVE';
  @IsIn(['STAMPED_PDF', 'EMAIL', 'PORTAL', 'PHYSICAL']) externalMethod!: 'STAMPED_PDF' | 'EMAIL' | 'PORTAL' | 'PHYSICAL';
  @IsUUID() externalPartyId!: string;
  @IsString() @MinLength(1) @MaxLength(200) externalApproverName!: string;
  @IsString() @MinLength(1) @MaxLength(200) externalApproverRole!: string;
  @IsString() @MinLength(1) @MaxLength(300) externalReference!: string;
  @IsDateString() decidedAt!: string;
  @IsOptional() @IsUUID() proofVersionId?: string;
  @IsOptional() @IsUUID() evidenceObjectId?: string;
  @IsOptional() @IsString() @MaxLength(4000) comment?: string;
  @IsOptional() @IsDateString() occurredAt?: string;
  @IsOptional() @IsIn(['INSTANT', 'DATE', 'UNKNOWN']) occurredAtPrecision?: 'INSTANT' | 'DATE' | 'UNKNOWN';
  @IsOptional() @IsString() @MaxLength(2000) backdatingReason?: string;
}
