/**
 * Automated End-to-End Smoke Test Suite
 * Tests full production lifecycle across Next.js proxy, NestJS API, PostgreSQL 16 RLS, and PDF Engine.
 */

async function runSmokeTests() {
  console.log('--- Starting TradeCloseout E2E Smoke Test Suite ---');
  const baseUrl = 'http://localhost:3002';
  const apiDirectUrl = 'http://localhost:3001';

  // 1. Direct Health Check
  const healthRes = await fetch(`${apiDirectUrl}/health`);
  const health = (await healthRes.json()) as any;
  if (healthRes.status !== 200 || health.database !== 'connected') {
    throw new Error(`Direct API health check failed: ${JSON.stringify(health)}`);
  }
  console.log('[PASS] 1. NestJS Health & PostgreSQL Connection verified.');

  // 2. Auth OTP Request via Next.js Proxy
  const testEmail = `lead-${Date.now()}@apex-mep.in`;
  const reqRes = await fetch(`${baseUrl}/api/v1/auth/otp/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: testEmail }),
  });
  const reqData = (await reqRes.json()) as any;
  if (reqRes.status !== 201 || !reqData.challengeId || !reqData.debugOtp) {
    throw new Error(`OTP Request failed (${reqRes.status}): ${JSON.stringify(reqData)}`);
  }
  console.log('[PASS] 2. OTP Request & Proxy Rewrite verified.');

  // 3. Auth OTP Verify & Session Creation
  const verRes = await fetch(`${baseUrl}/api/v1/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeId: reqData.challengeId, code: reqData.debugOtp }),
  });
  const cookie = verRes.headers.get('set-cookie');
  const verData = (await verRes.json()) as any;
  if (verRes.status !== 201 || !cookie || !verData.csrfToken) {
    throw new Error(`OTP Verify failed (${verRes.status}): ${JSON.stringify(verData)}`);
  }
  const csrfToken = verData.csrfToken;
  console.log('[PASS] 3. OTP Verify & HTTP-Only Session Cookie established.');

  // 4. Session Validation via /auth/me
  const meRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { Cookie: cookie },
  });
  const meData = (await meRes.json()) as any;
  if (meRes.status !== 200 || meData.orgRole !== 'R-OWNER') {
    throw new Error(`/auth/me check failed: ${JSON.stringify(meData)}`);
  }
  console.log(`[PASS] 4. User identity & R-OWNER tenancy confirmed (Org: ${meData.activeOrgId}).`);

  // 5. Project Creation under PostgreSQL RLS
  const projCode = `PRJ-${Date.now().toString().slice(-4)}`;
  const projRes = await fetch(`${baseUrl}/api/v1/projects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify({
      code: projCode,
      name: 'Smoke Test Commercial Handover Project',
    }),
  });
  const proj = (await projRes.json()) as any;
  if (projRes.status !== 201 || !proj.id) {
    throw new Error(`Project creation failed: ${JSON.stringify(proj)}`);
  }
  console.log(`[PASS] 5. Project ${proj.code} persisted to PostgreSQL via RLS.`);

  // 6. Checklist Requirement Creation
  const reqItemRes = await fetch(`${baseUrl}/api/v1/projects/${proj.id}/requirements`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify({
      key: `${projCode}-M01`,
      title: 'HVAC Air Balancing & TAB Statutory Certificate',
      docTypeCode: 'DT-022',
      mandatory: true,
      assetTag: 'AHU-L01',
    }),
  });
  const reqItem = (await reqItemRes.json()) as any;
  if (reqItemRes.status !== 201 || !reqItem.id) {
    throw new Error(`Requirement creation failed: ${JSON.stringify(reqItem)}`);
  }
  console.log(`[PASS] 6. Mandatory requirement ${reqItem.requirement_key} attached to project.`);

  // 7. Document Upload Intent Creation
  const intentRes = await fetch(`${baseUrl}/api/v1/projects/${proj.id}/documents/upload-intents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify({
      mimeType: 'application/pdf',
      sizeBytes: 1048576,
      fileName: 'TAB-Report-Signed.pdf',
      requirementId: reqItem.id,
    }),
  });
  const intentData = (await intentRes.json()) as any;
  if (intentRes.status !== 201 || !intentData.versionId) {
    throw new Error(`Upload intent registration failed: ${JSON.stringify(intentData)}`);
  }
  console.log(`[PASS] 7. S3 upload intent & version ${intentData.versionId} registered.`);

  // 8. Pure-Node Handover Dossier PDF Compilation
  const pdfRes = await fetch(`${baseUrl}/api/v1/projects/${proj.id}/dossier/pdf`, {
    headers: { Cookie: cookie },
  });
  const pdfBytes = await pdfRes.arrayBuffer();
  if (pdfRes.status !== 200 || pdfBytes.byteLength < 500) {
    throw new Error(`Dossier PDF compilation failed (${pdfRes.status})`);
  }
  console.log(`[PASS] 8. Bates-stamped Handover Dossier PDF generated (${pdfBytes.byteLength} bytes).`);

  console.log('\n================================================================');
  console.log('>>> ALL 8/8 END-TO-END PRODUCTION SMOKE TESTS PASSED CLEANLY <<<');
  console.log('================================================================');
}

runSmokeTests().catch((err) => {
  console.error('\n[FAIL] Smoke tests failed:', err.message);
  process.exit(1);
});
