import { SetMetadata } from '@nestjs/common';

export const REQUIRE_IDEMPOTENCY_KEY = 'REQUIRE_IDEMPOTENCY';

/**
 * Marks a controller method as requiring an Idempotency-Key header.
 * Requests without an Idempotency-Key will be rejected with 400 Bad Request.
 */
export const RequireIdempotency = () => SetMetadata(REQUIRE_IDEMPOTENCY_KEY, true);
