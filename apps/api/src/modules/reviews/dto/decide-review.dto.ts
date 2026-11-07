import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator';

export class DecideVersionReviewDto {
  @IsOptional()
  @IsNumber()
  expectedRowVersion?: number;

  @IsOptional()
  @IsString()
  method?: string;

  @IsString()
  @IsIn(['APPROVE', 'APPROVED', 'REQUEST_CHANGES', 'CHANGES_REQUESTED', 'REJECT', 'REJECTED'], {
    message: 'decision must be one of: APPROVE, APPROVED, REQUEST_CHANGES, CHANGES_REQUESTED, REJECT, REJECTED',
  })
  decision!: 'APPROVE' | 'APPROVED' | 'REQUEST_CHANGES' | 'CHANGES_REQUESTED' | 'REJECT' | 'REJECTED';

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsString()
  occurredAt?: string;

  @IsOptional()
  @IsIn(['INSTANT', 'DATE', 'UNKNOWN'])
  occurredAtPrecision?: 'INSTANT' | 'DATE' | 'UNKNOWN';

  @IsOptional()
  @IsString()
  backdatingReason?: string;
}
