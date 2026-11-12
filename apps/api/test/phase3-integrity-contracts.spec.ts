import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { normalizeInspectionWitnessAssignments } from '../src/modules/commissioning/commissioning.service';
import { requireImmutableObjectVersionId } from '../src/modules/documents/s3-storage.service';
import { assertReviewVersionNotTerminal } from '../src/modules/reviews/reviews.service';

describe('Phase 3 fail-closed evidence integrity contracts', () => {
  it('PH3-G12-001: permits plain witness assignments without inventing authority', () => {
    expect(normalizeInspectionWitnessAssignments([
      { partyName: 'Client', representativeName: 'Representative', role: 'Observer' },
    ])).toEqual([{ partyName: 'Client', representativeName: 'Representative', role: 'Observer' }]);
    expect(normalizeInspectionWitnessAssignments(undefined)).toEqual([]);
  });

  it.each([
    [{ partyName: 'Client', representativeName: 'Person', role: 'Observer', isVerified: true }],
    [{ partyName: 'Client', representativeName: 'Person', role: 'Observer', attestationType: 'AUTHENTICATED_ATTESTATION' }],
    [{ partyName: 'Client', representativeName: 'Person', role: 'Observer', signedByUserId: 'other' }],
    [{ partyName: 'Client', representativeName: 'Person', role: 'Observer', signedAt: '2026-11-12' }],
    [{ partyName: 'Client', representativeName: 'Person', role: 'Observer', proof: { signedByUserId: 'other' } }],
    [{ partyName: 'Client', representativeName: 'Person', role: 'Observer', __proto_marker__: true }],
    [{ partyName: 'Client', representativeName: 'Person' }],
    'invalid',
    Array.from({ length: 21 }, () => ({ partyName: 'A', representativeName: 'B', role: 'C' })),
  ])('PH3-G12-001: rejects untrusted witness payload %#', (value) => {
    expect(() => normalizeInspectionWitnessAssignments(value)).toThrow(BadRequestException);
  });

  it('PH3-G10-002: accepts a real opaque provider version', () => {
    expect(requireImmutableObjectVersionId('3Lg3u34X')).toBe('3Lg3u34X');
  });

  it.each([undefined, null, '', ' ', 'null', 'NULL', ' Null '])(
    'PH3-G10-002: rejects mutable provider receipt %p',
    (value) => {
      expect(() => requireImmutableObjectVersionId(value)).toThrow(ServiceUnavailableException);
    },
  );

  it.each(['APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'SUPERSEDED'])(
    'PH3-G11-001: rejects a second terminal outcome from %s',
    (status) => {
      expect(() => assertReviewVersionNotTerminal(status)).toThrow(ConflictException);
    },
  );

  it.each(['IN_REVIEW', 'PENDING'])(
    'PH3-G11-001: allows normal undecided state %s', (status) => {
      expect(() => assertReviewVersionNotTerminal(status)).not.toThrow();
    },
  );
});
