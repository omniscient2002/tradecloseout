import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  parseIndependentReviewArgs,reviewerConnectionConfig,
  executeIndependentAuthorityReview,
} from '../src/modules/identity/external-review-operations';

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
});
