import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsArray,
  ArrayUnique,
  Matches,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const ALLOWED_MIME_LIST = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/vnd.dwg',
  'application/zip',
] as const;

export class CreateUploadIntentDto {
  @IsString()
  @IsIn(ALLOWED_MIME_LIST, {
    message: 'mimeType must be one of the supported document types (SVG is strictly banned).',
  })
  mimeType!: string;

  @IsInt()
  @Min(1, { message: 'sizeBytes must be greater than 0' })
  @Max(104857600, { message: 'sizeBytes exceeds maximum upload size of 100MB' })
  sizeBytes!: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  filename?: string;

  @IsOptional()
  @IsString()
  categoryKey?: string;

  @IsOptional()
  @IsString()
  docTypeKey?: string;

  @IsOptional()
  @IsString()
  revisionCode?: string;

  @IsOptional()
  @IsUUID('all', { message: 'requirementId must be a valid UUID' })
  requirementId?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  requirementIds?: string[];

  @IsOptional()
  @IsUUID('all', { message: 'assetId must be a valid UUID' })
  assetId?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  assetIds?: string[];

  @IsOptional()
  @IsUUID('all', { message: 'documentId must be a valid UUID' })
  documentId?: string;

  @IsOptional()
  @IsString()
  issueDate?: string;

  @IsOptional()
  @IsString()
  expiryDate?: string | null;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-fA-F0-9]{64}$/)
  checksumSha256?: string;
}

export class CompleteUploadDto {
  @IsOptional()
  @IsString()
  checksumSha256?: string;

  @IsOptional()
  @IsBoolean()
  isEicarTestVirus?: boolean;

  @IsOptional()
  @IsString()
  samplePayload?: string;

  @IsOptional()
  parts?: Array<{ partNumber: number; etag?: string }>;
}
