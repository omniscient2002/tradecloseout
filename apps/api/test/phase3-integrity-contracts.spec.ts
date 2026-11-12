import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { normalizeInspectionWitnessAssignments } from '../src/modules/commissioning/commissioning.service';
import { requireImmutableObjectVersionId } from '../src/modules/documents/s3-storage.service';
import { isImmutableEvidenceVersion } from '../src/modules/documents/documents.service';
import { countQpdfLiveObjects } from '../../worker/src/queues/file.processor';
import { assertReviewVersionNotTerminal } from '../src/modules/reviews/reviews.service';

describe('Phase 3 fail-closed evidence integrity contracts', () => {
  it('PH3-G10-001: counts both compressed and uncompressed xref entries', () => {
    expect(countQpdfLiveObjects([
      '1/0: uncompressed; offset = 100',
      '2/0: compressed; stream = 9, index = 0',
      '3/0: compressed; stream = 9, index = 1',
      '4/0: free; next = 0',
    ].join('\n'))).toBe(3);
  });

  it('PH3-G10-001: detects compressed-object limit bypass and malformed inventory', () => {
    const xref = Array.from({ length: 25001 }, (_, i) =>
      `${i + 1}/0: compressed; stream = 3, index = ${i}`).join('\n');
    expect(countQpdfLiveObjects(xref)).toBeGreaterThan(25000);
    expect(() => countQpdfLiveObjects('')).toThrow('PDF_XREF_EMPTY');
    expect(() => countQpdfLiveObjects('1/0: unsupported entry')).toThrow('PDF_XREF_UNRECOGNIZED_ENTRY');
  });

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

  it.each([undefined, null, '', ' ', 'null', 'NULL', ' Null '])(
    'PH3-G10-002: blocks legacy mutable evidence version %p from downloads',
    (version) => {
      expect(isImmutableEvidenceVersion(version)).toBe(false);
    },
  );

  it('PH3-G10-002: permits an actual pinned provider version for download', () => {
    expect(isImmutableEvidenceVersion('3Lg3u34X')).toBe(true);
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
