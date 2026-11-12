import { randomUUID } from 'crypto';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ReviewsService } from '../src/modules/reviews/reviews.service';

describe('G02 — bulk decision safety contract', () => {
  const ctx = {
    orgId: randomUUID(),
    userId: randomUUID(),
    actorType: 'USER' as const,
    requestId: 'bulk-review-test',
  };

  it('rejects invalid input and duplicate review identities before touching any decision', async () => {
    const service = new ReviewsService({} as any);
    const invoke = jest.spyOn(service, 'decideReview');
    for (const ids of [[], ['not-a-uuid'], [randomUUID(), randomUUID(), 'invalid'], Array(101).fill(randomUUID())]) {
      await expect(service.bulkDecisions(ctx, {
        reviewIds: ids, decision: 'APPROVE',
      })).rejects.toThrow(BadRequestException);
    }
    const valid = randomUUID();
    await expect(service.bulkDecisions(ctx, {
      reviewIds: [valid, valid], decision: 'APPROVE',
    })).rejects.toThrow(BadRequestException);
    await expect(service.bulkDecisions(ctx, {
      reviewIds: [valid], decision: 'REJECT',
    })).rejects.toThrow(BadRequestException);
    await expect(service.bulkDecisions(ctx, {
      reviewIds: [valid], decision: 'UNKNOWN' as any,
    })).rejects.toThrow(BadRequestException);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('reports independent results without leaking an authorization or database error', async () => {
    const first = randomUUID();
    const second = randomUUID();
    const service = new ReviewsService({} as any);
    const task = jest.spyOn(service, 'decideReview').mockImplementation(async (_actor, reviewId, decision) => {
      if (reviewId === second) throw new ForbiddenException('sensitive tenant metadata');
      expect(decision).toEqual({ decision: 'REJECT', comment: 'Insufficient evidence provided' });
      return { status: 'OK', decision: 'REJECT', versionId: 'version-id' };
    });
    const result = await service.bulkDecisions(ctx, {
      reviewIds: [first, second], decision: 'REJECT', comment: 'Insufficient evidence provided',
    });
    expect(task).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      count: 2,
      succeeded: 1,
      results: [
        { reviewId: first, success: true, status: 'OK', decision: 'REJECT', versionId: 'version-id' },
        { reviewId: second, success: false, errorCode: 'REVIEW_ACCESS_DENIED' },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('sensitive tenant metadata');
  });
});
