import { SetMetadata } from '@nestjs/common';

export const OMIT_GENERIC_IDEMPOTENCY_RECEIPT = 'omit_generic_idempotency_receipt';

/**
 * Secret-bearing authentication actions must not persist their response to the
 * general tenant idempotency table. Such endpoints require a separately
 * reviewed, session-bound retry/recovery contract if retry-safety is mandatory.
 */
export const NoGenericIdempotencyReceipt = () => SetMetadata(OMIT_GENERIC_IDEMPOTENCY_RECEIPT, true);
