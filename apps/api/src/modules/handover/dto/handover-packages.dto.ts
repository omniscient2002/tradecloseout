import { IsArray, IsEmail, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class GenerateHandoverPackageDto {
  @IsOptional()
  @IsArray()
  excludedRequirementIds?: Array<{ requirementId: string; reason: string }>;
}

export class SubmissionRecipientInputDto {
  @IsOptional()
  @IsString()
  partyId?: string;

  @IsEmail({}, { message: 'Recipient must have a valid email address.' })
  email!: string;

  @IsString()
  name!: string;

  @IsOptional()
  isRequiredApprover?: boolean;

  @IsOptional()
  @IsString()
  role?: string;
}

export class SubmitPackageDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubmissionRecipientInputDto)
  recipients!: SubmissionRecipientInputDto[];

  @IsOptional()
  @IsString()
  coverNote?: string;
}
