const ID='[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}';
// Explicit operation contract. Adding a new GET route does not grant suspended access.
const READS=[
 /^\/api\/v1\/auth\/(me|orgs|session\/bootstrap|mfa\/status)$/,
 new RegExp(`^/api/v1/orgs/(current|${ID})(/(dashboard|date-preferences|subscription|invoices))?$`,'i'),
 /^\/api\/v1\/billing\/(plans|invoices)$/,
 /^\/api\/v1\/projects$/,
 new RegExp(`^/api/v1/projects/${ID}(/(dashboard|contracts|specifications|members|requirements|checklist|documents|assets|reviews|readiness|handover/readiness|packages/readiness|packages|archive-exports|warranty-events|commercial-readiness|defects))?$`,'i'),
 new RegExp(`^/api/v1/projects/${ID}/assets/(export|${ID}(/(passport|history))?)$`,'i'),
 new RegExp(`^/api/v1/projects/${ID}/packages/${ID}(/download)?$`,'i'),
 new RegExp(`^/api/v1/projects/${ID}/archive-exports/${ID}$`,'i'),
 new RegExp(`^/api/v1/projects/${ID}/document-versions/${ID}(/stream)?$`,'i'),
 new RegExp(`^/api/v1/(documents|packages)/${ID}$`,'i'),
 new RegExp(`^/api/v1/document-versions/${ID}/(download-url|preview-url|stream)$`,'i'),
];
const ASSURANCE=new Set(['POST /api/v1/auth/mfa/enroll/start','POST /api/v1/auth/mfa/enroll/confirm','POST /api/v1/auth/mfa/verify','POST /api/v1/auth/mfa/recovery']);
export function isRetainedOrganisationOperation(method:string,path:string):boolean{
 return method==='GET'?READS.some(pattern=>pattern.test(path)):ASSURANCE.has(`${method} ${path}`);
}
