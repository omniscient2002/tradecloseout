import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  parseIndependentReviewArgs,reviewerConnectionConfig,
  executeIndependentAuthorityReview,
} from '../src/modules/identity/external-review-operations';

import {
  parseExternalDocumentReviewArgs,executeExternalDocumentReview,
} from '../src/modules/identity/external-document-review-operations';
import {
  parseExternalRevocationArgs,executeExternalRevocation,
} from '../src/modules/identity/external-review-revocation';

const UUID_A='11111111-1111-4111-8111-111111111111';
const UUID_B='22222222-2222-4222-8222-222222222222';
const digest='a'.repeat(64);
const argv=[
  '--org',UUID_A,'--grant',UUID_B,'--sha256',digest,
  '--case','CASE-G01-APPROVED','--attest-independent-source',
  '--attest-legal-delegation','--attest-destination',
];

describe('G01 independent human reviewer operations',()=>{
  it('requires explicit attestations and strictly typed, nonduplicated arguments',()=>{
    expect(parseIndependentReviewArgs(argv)).toEqual({
      org:UUID_A,grant:UUID_B,digest,caseRef:'CASE-G01-APPROVED',
    });
    expect(()=>parseIndependentReviewArgs(argv.slice(0,-1))).toThrow('G01_REVIEW_ATTESTATION_REQUIRED');
    expect(()=>parseIndependentReviewArgs([...argv,'--org',UUID_A])).toThrow('G01_REVIEW_ARGUMENT_INVALID');
    expect(()=>parseIndependentReviewArgs([...argv,'--password','secret'])).toThrow('G01_REVIEW_ARGUMENT_INVALID');
    expect(()=>parseIndependentReviewArgs(argv.map(x=>x===digest?'not-digest':x))).toThrow('G01_REVIEW_ARGUMENT_INVALID');
    expect(()=>parseIndependentReviewArgs(argv.map(x=>x===UUID_A?'not-uuid':x))).toThrow('G01_REVIEW_ARGUMENT_INVALID');
    expect(()=>parseIndependentReviewArgs(argv.map(x=>x==='CASE-G01-APPROVED'?'private@example.com':x))).toThrow('G01_REVIEW_ARGUMENT_INVALID');
  });

  it('requires named isolated reviewer credentials and independently verified TLS',()=>{
    const dir=mkdtempSync(path.join(tmpdir(),'tc-g01-ca-'));
    const ca=path.join(dir,'ca.pem');
    writeFileSync(ca,'-----BEGIN CERTIFICATE-----\ntest-fixture\n-----END CERTIFICATE-----\n');
    const url='postgres://reviewer_001:nonsecretfixture@review.example.com:5432/tradecloseout';
    try {
      const cfg=reviewerConnectionConfig(url,ca,[]);
      expect(cfg).toMatchObject({
        host:'review.example.com',database:'tradecloseout',user:'reviewer_001',max:1,
        ssl:{rejectUnauthorized:true,servername:'review.example.com'},
      });
      expect(()=>reviewerConnectionConfig(url,ca,[url])).toThrow('G01_REVIEWER_ISOLATED_CREDENTIALS_REQUIRED');
      expect(()=>reviewerConnectionConfig(url,undefined)).toThrow('G01_REVIEWER_ISOLATED_CREDENTIALS_REQUIRED');
      expect(()=>reviewerConnectionConfig('postgres://tc_app:pass@review.example.com/tradecloseout',ca))
        .toThrow('G01_REVIEWER_INDIVIDUAL_LOGIN_REQUIRED');
      expect(()=>reviewerConnectionConfig('postgres://postgres:pass@review.example.com/tradecloseout',ca))
        .toThrow('G01_REVIEWER_INDIVIDUAL_LOGIN_REQUIRED');
      expect(()=>reviewerConnectionConfig('postgres://reviewer:pass@review.example.com/tradecloseout?sslmode=disable',ca))
        .toThrow('G01_REVIEWER_DATABASE_URL_INVALID');
      expect(()=>reviewerConnectionConfig('http://reviewer:pass@review.example.com/tradecloseout',ca))
        .toThrow('G01_REVIEWER_DATABASE_URL_INVALID');
    } finally {rmSync(dir,{recursive:true,force:true});}
  });

  it('checks actual current and session roles before invoking signing function',async()=>{
    const make=(rows:unknown[])=>({query:jest.fn().mockResolvedValue({rows})});
    for(const role of [
      {login:'tc_app',effective_login:'tc_app',eligible:false},
      {login:'reviewer_a',effective_login:'tc_migrator',eligible:true},
      {login:'reviewer_a',effective_login:'reviewer_a',eligible:true,rolsuper:true},
      {login:'reviewer_a',effective_login:'reviewer_a',eligible:true,rolbypassrls:true},
      {login:'reviewer_a',effective_login:'reviewer_a',eligible:true,rolcreaterole:true},
    ]) {
      const db=make([role]);
      await expect(executeIndependentAuthorityReview(db as any,parseIndependentReviewArgs(argv)))
        .rejects.toThrow('G01_REVIEWER_ROLE_DENIED');
      expect(db.query).toHaveBeenCalledTimes(1);
    }
    const db={query:jest.fn()
      .mockResolvedValueOnce({rows:[{
        login:'reviewer_a',effective_login:'reviewer_a',eligible:true,
        rolsuper:false,rolbypassrls:false,rolcreaterole:false,rolcreatedb:false,
      }]})
      .mockResolvedValueOnce({rows:[{review_count:1,independently_verified:false}]})};
    await expect(executeIndependentAuthorityReview(db as any,parseIndependentReviewArgs(argv)))
      .resolves.toEqual({reviewCount:1,independentlyVerified:false});
    expect(db.query.mock.calls[1]).toEqual([
      'SELECT review_count,independently_verified FROM approve_external_guest_authority($1,$2,$3,$4)',
      [UUID_A,UUID_B,digest,'CASE-G01-APPROVED'],
    ]);
  });

  it('requires independent actual-document approval attestations and parameterized proof identity',async()=>{
    const input=[
      '--org',UUID_A,'--version',UUID_B,'--proof','33333333-3333-4333-8333-333333333333',
      '--party','44444444-4444-4444-8444-444444444444',
      '--sha256',digest,'--case','CASE-EXT-DOC-2026',
      '--attest-independent-source','--attest-document-decision','--attest-counterparty',
    ];
    const parsed=parseExternalDocumentReviewArgs(input);
    expect(parsed).toMatchObject({
      org:UUID_A,version:UUID_B,digest,caseRef:'CASE-EXT-DOC-2026',
    });
    expect(()=>parseExternalDocumentReviewArgs(input.slice(0,-1)))
      .toThrow('G01_DOCUMENT_REVIEW_ATTESTATION_REQUIRED');
    expect(()=>parseExternalDocumentReviewArgs([...input,'--party',UUID_A]))
      .toThrow('G01_DOCUMENT_REVIEW_ARGUMENT_INVALID');
    const badRole={query:jest.fn().mockResolvedValue({
      rows:[{login:'tc_app',effective_login:'tc_app',eligible:false}],
    })};
    await expect(executeExternalDocumentReview(badRole as any,parsed))
      .rejects.toThrow('G01_DOCUMENT_REVIEWER_ROLE_DENIED');
    const allowed={query:jest.fn()
      .mockResolvedValueOnce({rows:[{
        login:'independent_reviewer',effective_login:'independent_reviewer',
        eligible:true,rolsuper:false,rolbypassrls:false,
        rolcreaterole:false,rolcreatedb:false,
      }]})
      .mockResolvedValueOnce({rows:[{review_count:2,independently_verified:true}]})};
    await expect(executeExternalDocumentReview(allowed as any,parsed))
      .resolves.toEqual({reviewCount:2,independentlyVerified:true});
    expect(allowed.query.mock.calls[1]).toEqual([
      'SELECT review_count,independently_verified FROM attest_external_document_approval($1,$2,$3,$4,$5,$6)',
      [parsed.org,parsed.version,parsed.proof,parsed.party,parsed.digest,parsed.caseRef],
    ]);
  });
  it('requires explicit independent incident revocation attestation and role',async()=>{
    const args=['--kind','guest','--org',UUID_A,'--grant',UUID_B,
      '--reason','INCIDENT-G01-2026','--attest-incident-verified'];
    expect(parseExternalRevocationArgs(args)).toEqual({
      kind:'guest',org:UUID_A,grant:UUID_B,reason:'INCIDENT-G01-2026',
    });
    expect(()=>parseExternalRevocationArgs(args.slice(0,-1)))
      .toThrow('G01_REVOKE_ATTESTATION_REQUIRED');
    expect(()=>parseExternalRevocationArgs([...args,'--proof',UUID_A]))
      .toThrow('G01_REVOKE_ARGUMENT_INVALID');
    const invalid={query:jest.fn().mockResolvedValue({rows:[{
      login:'tc_app',effective_login:'tc_app',eligible:false,
    }]})};
    await expect(executeExternalRevocation(invalid as any,parseExternalRevocationArgs(args)))
      .rejects.toThrow('G01_REVOKER_ROLE_DENIED');
    expect(invalid.query).toHaveBeenCalledTimes(1);

    const allow={query:jest.fn()
      .mockResolvedValueOnce({rows:[{
        login:'reviewer_a',effective_login:'reviewer_a',eligible:true,
        rolsuper:false,rolbypassrls:false,rolcreaterole:false,rolcreatedb:false,
      }]})
      .mockResolvedValueOnce({rows:[{revoked:true}]})};
    await expect(executeExternalRevocation(allow as any,parseExternalRevocationArgs(args)))
      .resolves.toBeUndefined();
    expect(allow.query.mock.calls[1]).toEqual([
      'SELECT revoke_independent_external_guest_grant($1,$2,$3) AS revoked',
      [UUID_A,UUID_B,'INCIDENT-G01-2026'],
    ]);
    const documentArgs=['--kind','document','--org',UUID_A,
      '--version',UUID_B,'--proof','33333333-3333-4333-8333-333333333333',
      '--party','44444444-4444-4444-8444-444444444444',
      '--reason','DOCUMENT-INCIDENT-G01','--attest-incident-verified'];
    const parsed=parseExternalRevocationArgs(documentArgs);
    expect(parsed.kind).toBe('document');
    const allowDoc={query:jest.fn()
      .mockResolvedValueOnce({rows:[{
        login:'reviewer_b',effective_login:'reviewer_b',eligible:true,
        rolsuper:false,rolbypassrls:false,rolcreaterole:false,rolcreatedb:false,
      }]})
      .mockResolvedValueOnce({rows:[{revoked:true}]})};
    await expect(executeExternalRevocation(allowDoc as any,parsed))
      .resolves.toBeUndefined();
    expect(allowDoc.query.mock.calls[1][0]).toBe(
      'SELECT revoke_external_document_approval($1,$2,$3,$4,$5) AS revoked');
  });

});
