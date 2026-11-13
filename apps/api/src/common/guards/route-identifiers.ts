import { BadRequestException } from '@nestjs/common';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidParameters = new Set([
  'id', 'orgId', 'projectId', 'documentId', 'versionId', 'documentVersionId',
  'requirementId', 'assetId', 'reviewId', 'packageId', 'submissionId',
  'revalidationId', 'userId', 'contractId', 'recipientId', 'exportId',
]);

/** Token/key route segments are separate contracts; resource IDs are UUIDs. */
export function validateRouteIdentifiers(params: Record<string, unknown> = {}): void {
  for (const [key, value] of Object.entries(params)) {
    if (!uuidParameters.has(key) || (key === 'orgId' && value === 'current')) continue;
    if (typeof value !== 'string' || !uuid.test(value)) {
      throw new BadRequestException({ code: 'INVALID_RESOURCE_ID' });
    }
  }
}
