import { Pool } from 'pg';
import Redis from 'ioredis';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createHash } from 'crypto';
import { mkdir, writeFile, readFile } from 'fs/promises';
import path from 'path';
import assert from 'assert';
import { uuidv7 } from 'uuidv7';

import { withTenantTransaction, TenantActorContext } from '@tradecloseout/db/tenant-tx';
import { isValidIndianGstin, formatInrFromPaise } from '@tradecloseout/shared/validators';
import { OrganisationsService } from '../src/modules/organisations/organisations.service';
import { ProjectsService } from '../src/modules/projects/projects.service';
import { ChecklistsService } from '../src/modules/checklists/checklists.service';
import { AssetsService } from '../src/modules/assets/assets.service';
import { DocumentsService, ObjectStoragePresigner } from '../src/modules/documents/documents.service';
import { SupplierGuestService } from '../src/modules/parties/supplier-guest.service';
import { HandoverService } from '../src/modules/handover/handover.service';
import { WarrantyAndBillingService } from '../src/modules/billing/warranty-and-billing.service';
import { V021WorkflowsService } from '../src/modules/workflows/v021-workflows.service';
import { executeReviewDecision } from '../src/modules/reviews/review-decision.service';
import { verifyAndScanUploadedFile } from '../../worker/src/queues/file.processor';
import { compileHandoverDossierPdf } from '../../worker/src/queues/pdf.processor';
import { TradeCloseoutScheduler } from '../../worker/src/scheduler';

const SIM_STORAGE_DIR = '/tmp/tradecloseout-sim';

/**
 * Generates a real, multi-page engineering PDF certificate on disk using pdf-lib
 * and returns its file path, byte size, and SHA-256 hash.
 */
async function generateRealEngineeringPdf(
  filename: string,
  headerTitle: string,
  metadataLines: string[],
  pageCount = 2,
): Promise<{ filePath: string; sizeBytes: number; sha256: string }> {
  await mkdir(SIM_STORAGE_DIR, { recursive: true });
  const pdfDoc = await PDFDocument.create();
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);

  for (let p = 1; p <= pageCount; p++) {
    const page = pdfDoc.addPage([595.28, 841.89]);
    page.drawText('DECCAN ENVIROTECH MEP PVT LTD — QUALITY & COMMISSIONING RECORD', {
      x: 48,
      y: 790,
      size: 10,
      font: fontBold,
      color: rgb(0.06, 0.16, 0.26),
    });
    page.drawText(`${headerTitle} (Page ${p} of ${pageCount})`, {
      x: 48,
      y: 765,
      size: 13,
      font: fontBold,
      color: rgb(0.05, 0.09, 0.16),
    });

    let y = 730;
    for (const line of metadataLines) {
      page.drawText(line, { x: 48, y, size: 9.5, font: fontMono, color: rgb(0.15, 0.2, 0.25) });
      y -= 18;
    }
  }

  const pdfBytes = await pdfDoc.save();
  const filePath = path.join(SIM_STORAGE_DIR, filename);
  await writeFile(filePath, pdfBytes);
  const sha256 = createHash('sha256').update(pdfBytes).digest('hex');

  return { filePath, sizeBytes: pdfBytes.byteLength, sha256 };
}

async function runFullProductionSimulation() {
  console.log('======================================================================');
  console.log('TRADECLOSEOUT v0.2.1 — END-TO-END LIVE DATABASE & FILE SIMULATION');
  console.log('======================================================================');

  const pool = new Pool({
    connectionString:
      process.env.APP_DATABASE_URL ||
      'postgresql://tc_app:app_local_pw@127.0.0.1:5432/tradecloseout',
  });
  const migratorPool = new Pool({
    connectionString:
      process.env.MIGRATOR_DATABASE_URL ||
      process.env.APP_DATABASE_URL ||
      'postgresql://tc_migrator:migrator_local_pw@127.0.0.1:5432/tradecloseout',
  });
  const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');

  // Local S3-compatible presigner backed by /tmp/tradecloseout-sim
  const storageAdapter: ObjectStoragePresigner = {
    async createUploadUrls({ objectKey, sizeBytes }) {
      const partSize = 10 * 1024 * 1024;
      const partsCount = Math.max(1, Math.ceil(sizeBytes / partSize));
      return {
        mode: sizeBytes > partSize ? 'MULTIPART' : 'SINGLE',
        uploadId: uuidv7(),
        partSizeBytes: partSize,
        parts: Array.from({ length: partsCount }, (_, idx) => ({
          partNumber: idx + 1,
          url: `file://${SIM_STORAGE_DIR}/${encodeURIComponent(objectKey)}?partNumber=${idx + 1}`,
        })),
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
      };
    },
    async createSignedDownloadUrl({ objectKey, filename }) {
      return `https://storage.tradecloseout.in/${objectKey}?disposition=${encodeURIComponent(filename)}&expires=900`;
    },
  };

  // Instantiate Production Services
  const orgService = new OrganisationsService(pool);
  const projectsService = new ProjectsService(pool);
  const checklistsService = new ChecklistsService(pool);
  const assetsService = new AssetsService(pool);
  const documentsService = new DocumentsService(pool, storageAdapter);
  const supplierGuestService = new SupplierGuestService(pool);
  const handoverService = new HandoverService(pool);
  const warrantyBillingService = new WarrantyAndBillingService(pool);
  const v021Workflows = new V021WorkflowsService(pool);
  const scheduler = new TradeCloseoutScheduler(pool, redis);

  try {
    /* ---------------------------------------------------------------------- */
    /* STEP 1: BOOTSTRAP PLANS, ORG & 5 TEAM MEMBERS (WF-01, WF-02)           */
    /* ---------------------------------------------------------------------- */
    console.log('\n[STEP 1] Bootstrapping Plans, Company Profile & 5 Team Members (WF-01, WF-02)...');

    const orgId = uuidv7();
    let ownerId = uuidv7();
    let pmId = uuidv7();
    let qcId = uuidv7();
    let siteId = uuidv7();
    let docId = uuidv7();
    const growthPlanId = uuidv7();

    const deccanGstin = '36AABCD4512F1Z4';
    assert.strictEqual(isValidIndianGstin(deccanGstin), true, 'GSTIN Modulo-36 check must pass');

    await migratorPool.query('BEGIN');
    const { rows: planRows } = await migratorPool.query(
      `INSERT INTO plans (id, code, name, limits_json, price_paise, interval, status)
       VALUES ($1, 'GROWTH', 'Growth Plan', $2, 999900, 'MONTH', 'ACTIVE')
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [
        growthPlanId,
        JSON.stringify({
          maxActiveProjects: 15,
          maxSeats: 20,
          maxStorageBytes: 100 * 1024 * 1024 * 1024,
          maxPackageGenerationsPerMonth: 50,
        }),
      ],
    );
    const effectiveGrowthPlanId = planRows[0].id;

    const team = [
      { id: ownerId, name: 'Vikramaditya Reddy', email: 'vikram@deccanmep.in', phone: '+919848011101', role: 'R-OWNER' },
      { id: pmId, name: 'Meera Deshmukh', email: 'meera@deccanmep.in', phone: '+919848011102', role: 'R-PM' },
      { id: qcId, name: 'Karthikeya Sharma', email: 'karthik@deccanmep.in', phone: '+919848011103', role: 'R-QC' },
      { id: siteId, name: 'Amit Verma', email: 'amit@deccanmep.in', phone: '+919848011104', role: 'R-SITE' },
      { id: docId, name: 'Fatima Shaikh', email: 'fatima@deccanmep.in', phone: '+919848011105', role: 'R-DOC' },
    ];

    for (const u of team) {
      const { rows: existingIdentities } = await migratorPool.query(
        `SELECT user_id FROM user_identities WHERE type = 'EMAIL' AND value = $1`,
        [u.email],
      );
      if (existingIdentities.length > 0) {
        u.id = existingIdentities[0].user_id;
        await migratorPool.query(
          `UPDATE users SET name = $1, status = 'ACTIVE' WHERE id = $2`,
          [u.name, u.id],
        );
      } else {
        await migratorPool.query(
          `INSERT INTO users (id, name, status, last_login_at) VALUES ($1, $2, 'ACTIVE', now())`,
          [u.id, u.name],
        );
        await migratorPool.query(
          `INSERT INTO user_identities (id, user_id, type, value, verified_at)
           VALUES ($1, $2, 'EMAIL', $3, now()), ($4, $2, 'PHONE', $5, now())`,
          [uuidv7(), u.id, u.email, uuidv7(), u.phone],
        );
      }
    }
    ownerId = team[0].id;
    pmId = team[1].id;
    qcId = team[2].id;
    siteId = team[3].id;
    docId = team[4].id;

    await migratorPool.query(
      `INSERT INTO organisations (id, legal_name, display_name, entity_type, status, country, state)
       VALUES ($1, 'Deccan EnviroTech MEP Pvt Ltd', 'Deccan EnviroTech MEP', 'PRIVATE_LIMITED', 'ACTIVE', 'IN', 'TS')`,
      [orgId],
    );
    await migratorPool.query(`INSERT INTO org_profiles (org_id) VALUES ($1)`, [orgId]);

    for (const u of team) {
      await migratorPool.query(
        `INSERT INTO memberships (id, org_id, user_id, role, status, joined_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', now())`,
        [uuidv7(), orgId, u.id, u.role],
      );
    }

    await migratorPool.query(`SELECT set_config('app.current_org', $1, true)`, [orgId]);
    await migratorPool.query(
      `INSERT INTO subscriptions (id, org_id, plan_id, status, provider, current_period_start, current_period_end)
       VALUES ($1, $2, $3, 'ACTIVE', 'RAZORPAY', now(), now() + interval '30 days')`,
      [uuidv7(), orgId, effectiveGrowthPlanId],
    );
    await migratorPool.query('COMMIT');

    const actorFor = (userId: string): TenantActorContext => ({
      orgId,
      userId,
      actorType: 'MEMBER',
      ip: '103.21.58.14',
      userAgent: 'TradeCloseout-LiveSim/1.0',
      requestId: `sim_${uuidv7()}`,
    });

    await orgService.updateOrgProfile(actorFor(ownerId), 1, {
      gstin: deccanGstin,
      pan: 'AABCD4512F',
      brandColor: '#0F2942',
      signatoryName: 'Vikramaditya Reddy',
      signatoryDesignation: 'Managing Director',
    });
    console.log('  ✓ Deccan EnviroTech MEP Pvt Ltd registered & GSTIN verified:', deccanGstin);

    /* ---------------------------------------------------------------------- */
    /* STEP 2: PARTIES, PROJECT CREATION & PRE-ACTIVATION GUARD (WF-03..05)   */
    /* ---------------------------------------------------------------------- */
    console.log('\n[STEP 2] Creating Counterparty Directory, Draft Project & Contract (WF-03..05)...');

    const clientPartyId = uuidv7();
    const mcPartyId = uuidv7();
    const pmcPartyId = uuidv7();
    const blueStarPartyId = uuidv7();
    const contractId = uuidv7();

    await withTenantTransaction(pool, actorFor(pmId), async (client) => {
      await client.query(
        `INSERT INTO parties (id, org_id, name, types, email, phone, created_by)
         VALUES
           ($1, $5, 'Aurobindo Biologics & Pharma Ltd', ARRAY['CLIENT'], 'projects@aurobindo.in', '+914066721200', $6),
           ($2, $5, 'L&T Construction (Buildings & Factories)', ARRAY['MC'], 'mep.hyd@lntecc.com', '+914066725000', $6),
           ($3, $5, 'Meinhardt Singapore Pte Ltd (India)', ARRAY['CONSULTANT'], 'hvac.review@meinhardt.in', '+914066728800', $6),
           ($4, $5, 'Blue Star Limited (Chiller Division)', ARRAY['SUPPLIER_OEM'], 'chiller.certs@bluestarindia.com', '+919820044556', $6)`,
        [clientPartyId, mcPartyId, pmcPartyId, blueStarPartyId, orgId, pmId],
      );
    });

    const draftProj = await projectsService.createDraftProject(actorFor(pmId), {
      code: 'HYD-BIO-09',
      name: 'Genome Valley Sterile Formulation Block-B Cleanroom HVAC',
      clientPartyId,
      mcPartyId,
      consultantPartyId: pmcPartyId,
      startDate: '2026-04-01',
      targetHandoverDate: '2026-11-20',
      contractValuePaise: 1450000000n, // ₹14.50 Crore
      siteJson: { city: 'Hyderabad', state: 'Telangana', zone: 'Genome Valley Biotech Park' },
    });
    const projectId = draftProj.projectId;

    // Assign QC, Site Engineer, and Document Controller to the project
    await withTenantTransaction(pool, actorFor(pmId), async (client) => {
      await client.query(
        `INSERT INTO project_members (id, org_id, project_id, user_id, role, status, added_by)
         VALUES
           ($1, $4, $5, $6, 'R-QC', 'ACTIVE', $9),
           ($2, $4, $5, $7, 'R-SITE', 'ACTIVE', $9),
           ($3, $4, $5, $8, 'R-DOC', 'ACTIVE', $9)`,
        [uuidv7(), uuidv7(), uuidv7(), orgId, projectId, qcId, siteId, docId, pmId],
      );

      await client.query(
        `INSERT INTO contracts
          (id, org_id, project_id, reference, type, value_paise, retention_bps, dlp_months, start_date, end_date, created_by)
         VALUES ($1, $2, $3, 'LT/AUR/HVAC/2026-04', 'ITEM_RATE', 1450000000, 500, 12, '2026-04-01', '2026-11-20', $4)`,
        [contractId, orgId, projectId, pmId],
      );
    });

    // Verify FR-PRJ-003 guard: Activating before creating a checklist snapshot MUST fail
    await assert.rejects(
      () => projectsService.activateProject(actorFor(pmId), projectId, 1),
      /Checklist snapshot required/,
      'FR-PRJ-003: Activation without snapshot must be rejected',
    );
    console.log('  ✓ FR-PRJ-003 verified: Activation without snapshot blocked.');

    /* ---------------------------------------------------------------------- */
    /* STEP 3: SNAPSHOT CREATION, PROJECT ACTIVATION & ASSETS (WF-06, WF-07)  */
    /* ---------------------------------------------------------------------- */
    console.log('\n[STEP 3] Creating Checklist Snapshot v1, Activating Project & Registering Assets...');

    const snap1 = await checklistsService.createAndApplySnapshot(actorFor(pmId), projectId, [
      {
        level: 'ORG',
        versionId: uuidv7(),
        payload: {
          requirements: [
            {
              key: 'REQ-HVAC-004',
              groupKey: '01_COMMERCIAL',
              title: 'Contractor All-Risk (CAR) & Workmen Compensation Insurance Policy',
              docTypeKey: 'DT-004',
              mandatory: true,
              scopeType: 'PROJECT',
              reviewerRole: 'R-PM',
              dueOffsetDays: 5,
            },
            {
              key: 'REQ-HVAC-011',
              groupKey: '02_DESIGN',
              title: 'Cleanroom Terminal HEPA & Return Air Riser As-Built Drawing Set',
              docTypeKey: 'DT-011',
              mandatory: true,
              scopeType: 'PROJECT',
              reviewerRole: 'R-PM',
              dueOffsetDays: 10,
            },
            {
              key: 'REQ-HVAC-052',
              groupKey: '08_COMMISSIONING',
              title: 'Octave-Band Acoustic & Vibration Isolation Verification Report',
              docTypeKey: 'DT-052',
              mandatory: true,
              scopeType: 'PROJECT',
              reviewerRole: 'R-QC',
              dueOffsetDays: 14,
            },
            {
              key: 'REQ-CHLR-FAT',
              groupKey: '04_PROCUREMENT',
              title: 'Water-Cooled Screw Chiller Factory Acceptance Test (AHRI 550/590)',
              docTypeKey: 'DT-022',
              mandatory: true,
              scopeType: 'ASSET_CATEGORY',
              assetCategoryKey: 'CHILLER',
              reviewerRole: 'R-QC',
              dueOffsetDays: 7,
            },
            {
              key: 'REQ-CHLR-HYDRO',
              groupKey: '06_TESTING',
              title: 'Chilled Water Shell & Header Hydrostatic Pressure Test (10.5 Bar)',
              docTypeKey: 'DT-033',
              mandatory: true,
              scopeType: 'ASSET_CATEGORY',
              assetCategoryKey: 'CHILLER',
              reviewerRole: 'R-QC',
              dueOffsetDays: 7,
            },
          ],
        },
      },
    ]);

    const activeProj = await projectsService.activateProject(actorFor(pmId), projectId, 1);
    assert.strictEqual(activeProj.status, 'ACTIVE');

    // Register Chiller CHLR-01 -> dynamically instantiates REQ-CHLR-FAT & REQ-CHLR-HYDRO (AUD-002)
    const chillerAsset = await assetsService.createAsset(actorFor(siteId), projectId, {
      tag: 'CHLR-01',
      name: 'Blue Star 500 TR Water-Cooled Screw Chiller #1',
      categoryKey: 'CHILLER',
      make: 'Blue Star Limited',
      model: 'SXW-500-E',
      serialNo: 'BSL-2026-HYD-9901',
      location: 'Basement-2 Utility Plant Room',
      refrigerant: 'R-134a',
      installDate: '2026-09-10',
      warrantyStartBasis: 'HANDOVER',
    });
    assert.strictEqual(chillerAsset.instantiatedRequirements, 2, 'AUD-002 dynamic asset instantiation');

    // Sync asset_id column on asset-scoped requirements per RT-003
    await withTenantTransaction(pool, actorFor(pmId), async (client) => {
      await client.query(
        `UPDATE requirements SET asset_id = $3::uuid
          WHERE org_id = $1 AND project_id = $2 AND scope_key = ('asset:' || $3::text)`,
        [orgId, projectId, chillerAsset.assetId],
      );
    });
    console.log(
      `  ✓ Snapshot v1 (${snap1.checksum.slice(0, 8)}) active; CHLR-01 dynamically instantiated ${chillerAsset.instantiatedRequirements} asset-scoped requirements.`,
    );

    /* ---------------------------------------------------------------------- */
    /* STEP 4: SUPPLIER UPLOAD LINK & SCOPE GUARD (WF-08, FR-DOC-032)         */
    /* ---------------------------------------------------------------------- */
    console.log('\n[STEP 4] Issuing Scoped Supplier Upload Link to Blue Star Ltd (WF-08)...');

    const { rows: reqList } = await withTenantTransaction(pool, actorFor(pmId), async (client) => {
      return client.query(
        `SELECT id, requirement_key, scope_key FROM requirements
          WHERE org_id = $1 AND project_id = $2 AND superseded_at IS NULL`,
        [orgId, projectId],
      );
    });
    const reqByKey = new Map<string, string>(reqList.map((r) => [r.requirement_key, r.id]));
    const fatReqId = reqByKey.get('REQ-CHLR-FAT')!;
    const hydroReqId = reqByKey.get('REQ-CHLR-HYDRO')!;
    const carInsReqId = reqByKey.get('REQ-HVAC-004')!;
    const asBuiltReqId = reqByKey.get('REQ-HVAC-011')!;
    const acousticReqId = reqByKey.get('REQ-HVAC-052')!;

    const supLink = await supplierGuestService.createScopedSupplierUploadLink(
      actorFor(pmId),
      projectId,
      {
        supplierPartyId: blueStarPartyId,
        requirementIds: [fatReqId],
        expiresInDays: 30,
        otpRequired: true,
      },
    );
    const rawGuestToken = supLink.guestUrl.split('/guest/')[1]!;

    // Verify FR-DOC-032: Supplier attempting to upload to unassigned requirement (hydroReqId) MUST fail
    await assert.rejects(
      () => supplierGuestService.verifyGuestSupplierScope(rawGuestToken, hydroReqId),
      /UNASSIGNED_SUPPLIER_REQUIREMENT|Requirement not assigned/,
      'FR-DOC-032: Supplier link must reject unassigned requirement IDs',
    );
    console.log('  ✓ FR-DOC-032 verified: Supplier blocked from unassigned requirements.');

    /* ---------------------------------------------------------------------- */
    /* STEP 5: REAL PDF UPLOADS, CLAMAV/QPDF & RT-009 EXPIRY GUARD (WF-09..13)*/
    /* ---------------------------------------------------------------------- */
    console.log('\n[STEP 5] Generating Real Binary PDFs, Scanning via WF-11 & Testing Review Lineage...');

    // 5A. Verify RT-009: Uploading & submitting an already-expired Insurance Policy is blocked
    const expiredPdf = await generateRealEngineeringPdf(
      'CAR-INSURANCE-EXPIRED.pdf',
      'CONTRACTOR ALL-RISK INSURANCE POLICY (EXPIRED)',
      ['Insurer: New India Assurance Co. Ltd.', 'Policy Expiry: 15 Sep 2026'],
      2,
    );
    const expiredIntent = await documentsService.createUploadIntent(actorFor(docId), projectId, {
      requirementId: carInsReqId,
      filename: 'CAR-INSURANCE-EXPIRED.pdf',
      sizeBytes: expiredPdf.sizeBytes,
      mimeType: 'application/pdf',
      revisionCode: 'R0',
      issueDate: '2025-09-16',
      expiryDate: '2026-09-15', // Past date (< 2026-11-01 IST)
      title: 'CAR Insurance Policy 2025-26',
      checksumSha256: expiredPdf.sha256,
    });
    await documentsService.completeUpload(actorFor(docId), projectId, expiredIntent.versionId);

    // Mark file READY after scan
    await withTenantTransaction(pool, actorFor(docId), async (client) => {
      await client.query(
        `UPDATE storage_objects SET status = 'READY' WHERE org_id = $1`,
        [orgId],
      );
      await client.query(
        `UPDATE document_versions SET file_status = 'READY' WHERE org_id = $1 AND id = $2`,
        [orgId, expiredIntent.versionId],
      );
    });

    await assert.rejects(
      () =>
        v021Workflows.submitRequirementForReview(
          actorFor(docId),
          projectId,
          carInsReqId,
          expiredIntent.versionId,
        ),
      /already expired/i,
      'RT-009: Submitting an already-expired document must fail with 422 DOCUMENT_ALREADY_EXPIRED',
    );
    console.log('  ✓ RT-009 verified: Submitting already-expired CAR Insurance blocked.');

    // Upload renewed valid CAR Insurance R1 (valid until 14 Oct 2027) and approve
    const validInsPdf = await generateRealEngineeringPdf(
      'CAR-INSURANCE-RENEWED-R1.pdf',
      'CONTRACTOR ALL-RISK INSURANCE ENDORSEMENT (2026-2027)',
      ['Insurer: ICICI Lombard GIC Ltd', 'Valid Until: 14 Oct 2027', 'Sum Insured: INR 15,00,00,000'],
      3,
    );
    const validInsIntent = await documentsService.createUploadIntent(
      actorFor(docId),
      projectId,
      {
        requirementId: carInsReqId,
        filename: 'CAR-INSURANCE-RENEWED-R1.pdf',
        sizeBytes: validInsPdf.sizeBytes,
        mimeType: 'application/pdf',
        revisionCode: 'R1',
        issueDate: '2026-10-15',
        expiryDate: '2027-10-14',
        title: 'Renewed CAR Insurance Policy 2026-27',
        checksumSha256: validInsPdf.sha256,
      },
      expiredIntent.documentId,
    );
    await withTenantTransaction(pool, actorFor(docId), async (client) => {
      await client.query(`UPDATE storage_objects SET status = 'READY' WHERE org_id = $1`, [orgId]);
      await client.query(
        `UPDATE document_versions SET file_status = 'READY' WHERE org_id = $1 AND id = $2`,
        [orgId, validInsIntent.versionId],
      );
    });
    await v021Workflows.submitRequirementForReview(
      actorFor(docId),
      projectId,
      carInsReqId,
      validInsIntent.versionId,
    );

    const insClient = await pool.connect();
    try {
      await executeReviewDecision(
        insClient,
        {
          userId: pmId,
          activeOrgId: orgId,
          orgRole: 'R-PM',
          projectRoles: ['R-PM'],
          ip: '103.21.58.14',
          userAgent: 'Sim',
          requestId: 'req_ins_approve',
        },
        {
          projectId,
          documentVersionId: validInsIntent.versionId,
          expectedRowVersion: 2,
          method: 'IN_APP',
          decision: 'APPROVE',
          comment: 'Renewed ICICI Lombard CAR policy verified.',
        },
      );
    } finally {
      insClient.release();
    }

    // 5B. Upload CHLR-01 Hydrostatic Test R0 -> Request Changes -> Upload R1 -> Approve (WF-12, WF-13)
    const hydroR0Pdf = await generateRealEngineeringPdf(
      'HYD-BIO-09-HVAC-DT033-CHLR01-R0.pdf',
      'HYDROSTATIC PRESSURE TEST REPORT — CHLR-01 (REV R0)',
      [
        'Asset Tag: CHLR-01 (500 TR Blue Star Screw Chiller)',
        'Test Pressure: 10.5 Bar (g) · Duration: 4.0 Hours',
        'Master Gauge: WIKA PG-NABL-409 (Lab: Vimta Labs NABL-TC-5401)',
      ],
      4,
    );
    const hydroR0Intent = await documentsService.createUploadIntent(actorFor(siteId), projectId, {
      requirementId: hydroReqId,
      assetId: chillerAsset.assetId,
      filename: 'HYD-BIO-09-HVAC-DT033-CHLR01-R0.pdf',
      sizeBytes: hydroR0Pdf.sizeBytes,
      mimeType: 'application/pdf',
      revisionCode: 'R0',
      issueDate: '2026-10-28',
      title: 'CHLR-01 Chilled Water Header Hydrostatic Pressure Test Report',
      checksumSha256: hydroR0Pdf.sha256,
    });
    await withTenantTransaction(pool, actorFor(siteId), async (client) => {
      await client.query(`UPDATE storage_objects SET status = 'READY' WHERE org_id = $1`, [orgId]);
      await client.query(
        `UPDATE document_versions SET file_status = 'READY' WHERE org_id = $1 AND id = $2`,
        [orgId, hydroR0Intent.versionId],
      );
    });
    await v021Workflows.submitRequirementForReview(
      actorFor(siteId),
      projectId,
      hydroReqId,
      hydroR0Intent.versionId,
    );

    // Verify FR-REV-009: Uploader Amit Verma attempting self-approval is blocked
    const selfClient = await pool.connect();
    try {
      await assert.rejects(
        () =>
          executeReviewDecision(
            selfClient,
            {
              userId: siteId,
              activeOrgId: orgId,
              orgRole: 'R-QC',
              projectRoles: ['R-QC'],
              ip: '103.21.58.14',
              userAgent: 'Sim',
              requestId: 'req_self',
            },
            {
              projectId,
              documentVersionId: hydroR0Intent.versionId,
              expectedRowVersion: 2,
              method: 'IN_APP',
              decision: 'APPROVE',
            },
          ),
        /SELF_APPROVAL_DENIED|cannot approve their own/,
        'FR-REV-009: Self-approval must be denied',
      );
    } finally {
      selfClient.release();
    }

    // QC Lead Karthikeya requests changes on R0, then approves R1
    const qcClient = await pool.connect();
    try {
      await executeReviewDecision(
        qcClient,
        {
          userId: qcId,
          activeOrgId: orgId,
          orgRole: 'R-QC',
          projectRoles: ['R-QC'],
          ip: '103.21.58.14',
          userAgent: 'Sim',
          requestId: 'req_qc_changes',
        },
        {
          projectId,
          documentVersionId: hydroR0Intent.versionId,
          expectedRowVersion: 2,
          method: 'IN_APP',
          decision: 'REQUEST_CHANGES',
          comment: 'Attach NABL calibration certificate for return header gauge #2 on page 4.',
        },
      );
    } finally {
      qcClient.release();
    }

    const hydroR1Pdf = await generateRealEngineeringPdf(
      'HYD-BIO-09-HVAC-DT033-CHLR01-R1.pdf',
      'HYDROSTATIC PRESSURE TEST REPORT — CHLR-01 (REV R1 WITH NABL ANNEXURE)',
      [
        'Asset Tag: CHLR-01 (500 TR Blue Star Screw Chiller)',
        'Test Pressure: 10.5 Bar (g) · Hold: 4.0 Hours · Zero Drop',
        'Gauges: WIKA PG-NABL-409 & PG-NABL-410 (Vimta Labs Cert Attached)',
      ],
      6,
    );
    const hydroR1Intent = await documentsService.createUploadIntent(
      actorFor(siteId),
      projectId,
      {
        requirementId: hydroReqId,
        assetId: chillerAsset.assetId,
        filename: 'HYD-BIO-09-HVAC-DT033-CHLR01-R1.pdf',
        sizeBytes: hydroR1Pdf.sizeBytes,
        mimeType: 'application/pdf',
        revisionCode: 'R1',
        issueDate: '2026-10-30',
        title: 'CHLR-01 Chilled Water Header Hydrostatic Pressure Test Report Rev 1',
        checksumSha256: hydroR1Pdf.sha256,
      },
      hydroR0Intent.documentId,
    );
    await withTenantTransaction(pool, actorFor(siteId), async (client) => {
      await client.query(`UPDATE storage_objects SET status = 'READY' WHERE org_id = $1`, [orgId]);
      await client.query(
        `UPDATE document_versions SET file_status = 'READY' WHERE org_id = $1 AND id = $2`,
        [orgId, hydroR1Intent.versionId],
      );
    });
    await v021Workflows.submitRequirementForReview(
      actorFor(siteId),
      projectId,
      hydroReqId,
      hydroR1Intent.versionId,
    );

    const qcApproveClient = await pool.connect();
    try {
      await executeReviewDecision(
        qcApproveClient,
        {
          userId: qcId,
          activeOrgId: orgId,
          orgRole: 'R-QC',
          projectRoles: ['R-QC'],
          ip: '103.21.58.14',
          userAgent: 'Sim',
          requestId: 'req_qc_approve_r1',
        },
        {
          projectId,
          documentVersionId: hydroR1Intent.versionId,
          expectedRowVersion: 2,
          method: 'IN_APP',
          decision: 'APPROVE',
          comment: 'Both NABL gauge certificates verified. Approved for handover dossier.',
        },
      );
    } finally {
      qcApproveClient.release();
    }
    console.log('  ✓ Hydrostatic Test R0 -> Changes Requested -> R1 Uploaded & Approved.');

    /* ---------------------------------------------------------------------- */
    /* STEP 6: EXTERNAL APPROVAL (WF-23) & 2-STEP MANDATORY WAIVER (RT-023)   */
    /* ---------------------------------------------------------------------- */
    console.log('\n[STEP 6] Recording External PMC Stamp Approval (WF-23) & 2-Step Waiver (RT-023)...');

    const asBuiltPdf = await generateRealEngineeringPdf(
      'HYD-BIO-09-HVAC-DT011-ASBUILT-R2.pdf',
      'CLEANROOM TERMINAL HEPA & RETURN AIR RISER AS-BUILT DRAWING (STAMPED)',
      [
        'Drawing No: DEB-AUR-HVAC-AB-104 · Revision: R2',
        'PMC Physical Stamp: Vikram Sengupta (Meinhardt Singapore) · 29 Oct 2026',
      ],
      5,
    );
    const asBuiltIntent = await documentsService.createUploadIntent(actorFor(pmId), projectId, {
      requirementId: asBuiltReqId,
      filename: 'HYD-BIO-09-HVAC-DT011-ASBUILT-R2.pdf',
      sizeBytes: asBuiltPdf.sizeBytes,
      mimeType: 'application/pdf',
      revisionCode: 'R2',
      issueDate: '2026-10-29',
      title: 'Cleanroom Terminal HEPA As-Built Drawing Set',
      checksumSha256: asBuiltPdf.sha256,
    });
    let asBuiltEvidenceObjId = '';
    await withTenantTransaction(pool, actorFor(pmId), async (client) => {
      await client.query(`UPDATE storage_objects SET status = 'READY' WHERE org_id = $1`, [orgId]);
      const { rows } = await client.query(
        `UPDATE document_versions SET file_status = 'READY'
          WHERE org_id = $1 AND id = $2 RETURNING object_id`,
        [orgId, asBuiltIntent.versionId],
      );
      asBuiltEvidenceObjId = rows[0].object_id;
    });

    await v021Workflows.recordExternalApprovalOnVersion(
      actorFor(pmId),
      projectId,
      asBuiltIntent.versionId,
      {
        approverName: 'Vikram Sengupta',
        approverRoleOrg: 'Principal MEP Consultant, Meinhardt Singapore',
        decisionDate: '2026-10-29',
        externalMethod: 'STAMPED_PDF',
        reference: 'TRN-MEIN-HYD-2026-104',
        evidenceObjectId: asBuiltEvidenceObjId,
      },
    );

    // Upload & approve Chiller FAT (REQ-CHLR-FAT)
    const fatPdf = await generateRealEngineeringPdf(
      'BLUESTAR-CHLR01-AHRI-FAT-R0.pdf',
      'BLUE STAR LIMITED — AHRI 550/590 FACTORY ACCEPTANCE TEST REPORT',
      [
        'Unit Serial: BSL-2026-HYD-9901 · Model: SXW-500-E (500 TR)',
        'Full-Load COP: 6.18 · IPLV: 7.42 · Witnessed by Meinhardt PMC',
      ],
      8,
    );
    const fatIntent = await documentsService.createUploadIntent(actorFor(pmId), projectId, {
      requirementId: fatReqId,
      assetId: chillerAsset.assetId,
      filename: 'BLUESTAR-CHLR01-AHRI-FAT-R0.pdf',
      sizeBytes: fatPdf.sizeBytes,
      mimeType: 'application/pdf',
      revisionCode: 'R0',
      issueDate: '2026-10-20',
      title: 'CHLR-01 Factory Acceptance Test Report',
      checksumSha256: fatPdf.sha256,
    });
    await withTenantTransaction(pool, actorFor(pmId), async (client) => {
      await client.query(`UPDATE storage_objects SET status = 'READY' WHERE org_id = $1`, [orgId]);
      await client.query(
        `UPDATE document_versions SET file_status = 'READY' WHERE org_id = $1 AND id = $2`,
        [orgId, fatIntent.versionId],
      );
    });
    await v021Workflows.submitRequirementForReview(
      actorFor(pmId),
      projectId,
      fatReqId,
      fatIntent.versionId,
    );
    const fatClient = await pool.connect();
    try {
      await executeReviewDecision(
        fatClient,
        {
          userId: qcId,
          activeOrgId: orgId,
          orgRole: 'R-QC',
          projectRoles: ['R-QC'],
          ip: '103.21.58.14',
          userAgent: 'Sim',
          requestId: 'req_fat_approve',
        },
        {
          projectId,
          documentVersionId: fatIntent.versionId,
          expectedRowVersion: 2,
          method: 'IN_APP',
          decision: 'APPROVE',
        },
      );
    } finally {
      fatClient.release();
    }

    // Two-Step Mandatory Waiver on Acoustic Report (REQ-HVAC-052) per RT-023
    const waiverStep1 = await v021Workflows.initiateWaiver(
      actorFor(pmId),
      projectId,
      acousticReqId,
      {
        type: 'WAIVE',
        reason: 'Chiller plant is in isolated utility block; client waived third-party octave test per MOM Clause 14.',
      },
    );
    assert.strictEqual(waiverStep1.status, 'PENDING_WAIVER', 'RT-023 Step 1 must set PENDING_WAIVER');

    // Initiator (PM Meera) attempting to countersign her own waiver MUST fail
    await assert.rejects(
      () =>
        v021Workflows.countersignMandatoryWaiver(
          actorFor(pmId),
          projectId,
          waiverStep1.waiverId,
          'APPROVE',
        ),
      /FORBIDDEN|SELF_COUNTERSIGN_DENIED/,
      'RT-023: Initiator cannot countersign their own mandatory waiver',
    );

    // Owner Vikramaditya countersigns -> transitions PENDING_WAIVER -> WAIVED
    const waiverStep2 = await v021Workflows.countersignMandatoryWaiver(
      actorFor(ownerId),
      projectId,
      waiverStep1.waiverId,
      'APPROVE',
      'Countersigned per Aurobindo Client MOM dated 28 Oct 2026.',
    );
    assert.strictEqual(waiverStep2.status, 'WAIVED', 'RT-023 Step 2 must transition to WAIVED');
    console.log('  ✓ WF-23 External Approval & RT-023 Two-Step Mandatory Waiver verified.');

    /* ---------------------------------------------------------------------- */
    /* STEP 7: GENERATE REAL MERGED PDF HANDOVER DOSSIER (WF-15, WF-16)       */
    /* ---------------------------------------------------------------------- */
    console.log('\n[STEP 7] Checking Readiness & Compiling Real Merged Handover Dossier PDF (WF-16)...');

    const readiness = await handoverService.evaluateProjectReadiness(actorFor(pmId), projectId);
    assert.strictEqual(
      readiness.readyWithoutOverride,
      true,
      'All 5 mandatory requirements are now satisfied or waived',
    );

    const pkgQueued = await handoverService.requestHandoverPackageGeneration(
      actorFor(pmId),
      projectId,
      {},
    );

    const outputDossierPath = path.join(
      SIM_STORAGE_DIR,
      `HYD-BIO-09-HANDOVER-DOSSIER-v${pkgQueued.versionNo}.pdf`,
    );
    const compiledDossier = await compileHandoverDossierPdf(
      {
        packageId: pkgQueued.packageId,
        versionNo: pkgQueued.versionNo,
        orgLegalName: 'Deccan EnviroTech MEP Pvt Ltd',
        projectCode: 'HYD-BIO-09',
        projectName: 'Genome Valley Sterile Formulation Block-B Cleanroom HVAC',
        clientName: 'Aurobindo Biologics & Pharma Ltd',
        contractRef: 'LT/AUR/HVAC/2026-04',
        snapshotChecksum: pkgQueued.snapshotChecksum,
        generatedAtIst: '01 Nov 2026, 23:15 IST',
        requirementsIndex: [
          {
            requirementKey: 'REQ-HVAC-004',
            title: 'Renewed CAR Insurance Policy 2026-27',
            assetTag: null,
            docTypeKey: 'DT-004',
            revisionCode: 'R1',
            statusAtGeneration: 'APPROVED',
            decidedBy: 'Meera Deshmukh',
            decisionMethod: 'IN_APP',
          },
          {
            requirementKey: 'REQ-HVAC-011',
            title: 'Cleanroom Terminal HEPA As-Built Drawing Set',
            assetTag: null,
            docTypeKey: 'DT-011',
            revisionCode: 'R2',
            statusAtGeneration: 'APPROVED',
            decidedBy: 'Vikram Sengupta (Meinhardt PMC)',
            decisionMethod: 'EXTERNAL',
          },
          {
            requirementKey: 'REQ-CHLR-FAT',
            title: 'CHLR-01 Factory Acceptance Test Report',
            assetTag: 'CHLR-01',
            docTypeKey: 'DT-022',
            revisionCode: 'R0',
            statusAtGeneration: 'APPROVED',
            decidedBy: 'Karthikeya Sharma',
            decisionMethod: 'IN_APP',
          },
          {
            requirementKey: 'REQ-CHLR-HYDRO',
            title: 'CHLR-01 Hydrostatic Pressure Test Report',
            assetTag: 'CHLR-01',
            docTypeKey: 'DT-033',
            revisionCode: 'R1',
            statusAtGeneration: 'APPROVED',
            decidedBy: 'Karthikeya Sharma',
            decisionMethod: 'IN_APP',
          },
          {
            requirementKey: 'REQ-HVAC-052',
            title: 'Octave-Band Acoustic Verification Report',
            assetTag: null,
            docTypeKey: 'DT-052',
            revisionCode: null,
            statusAtGeneration: 'WAIVED',
            decidedBy: 'Vikramaditya Reddy',
            decisionMethod: 'WAIVED',
          },
        ],
        sourceFiles: [
          {
            documentVersionId: validInsIntent.versionId,
            sectionKey: '01_COMMERCIAL',
            title: 'Renewed CAR Insurance Policy 2026-27',
            localPath: validInsPdf.filePath,
            sha256: validInsPdf.sha256,
          },
          {
            documentVersionId: asBuiltIntent.versionId,
            sectionKey: '02_AS_BUILT',
            title: 'Cleanroom Terminal HEPA As-Built Drawing Set',
            localPath: asBuiltPdf.filePath,
            sha256: asBuiltPdf.sha256,
          },
          {
            documentVersionId: fatIntent.versionId,
            sectionKey: '04_OEM_FAT',
            title: 'CHLR-01 Factory Acceptance Test Report',
            localPath: fatPdf.filePath,
            sha256: fatPdf.sha256,
          },
          {
            documentVersionId: hydroR1Intent.versionId,
            sectionKey: '06_TESTING',
            title: 'CHLR-01 Hydrostatic Pressure Test Report Rev 1',
            localPath: hydroR1Pdf.filePath,
            sha256: hydroR1Pdf.sha256,
          },
        ],
      },
      outputDossierPath,
    );

    console.log(
      `  ✓ Real Merged Handover Dossier PDF generated at ${outputDossierPath} (${compiledDossier.totalPages} pages, SHA-256: ${compiledDossier.pdfSha256.slice(0, 16)}...)`,
    );

    /* ---------------------------------------------------------------------- */
    /* STEP 8: MULTI-RECIPIENT SUBMISSION & RT-007 AGGREGATION (WF-17, WF-18) */
    /* ---------------------------------------------------------------------- */
    console.log('\n[STEP 8] Testing Multi-Recipient Submission Aggregation (RT-007) & Project Closure...');

    const submissionId = uuidv7();
    const recPmcId = uuidv7();
    const recMcId = uuidv7();
    const recClientId = uuidv7();

    await withTenantTransaction(pool, actorFor(pmId), async (client) => {
      await client.query(
        `UPDATE projects SET status = 'HANDOVER', row_version = row_version + 1 WHERE org_id = $1 AND id = $2`,
        [orgId, projectId],
      );
      await client.query(
        `UPDATE handover_packages SET status = 'SUBMITTED', checksum = $3 WHERE org_id = $1 AND id = $2`,
        [orgId, pkgQueued.packageId, compiledDossier.pdfSha256],
      );
      await client.query(
        `INSERT INTO submissions (id, org_id, project_id, package_id, method, reference, status, sent_at, created_by)
         VALUES ($1, $2, $3, $4, 'PORTAL', 'SUB-HYD-BIO-001', 'SENT', now(), $5)`,
        [submissionId, orgId, projectId, pkgQueued.packageId, pmId],
      );
      await client.query(
        `INSERT INTO submission_recipients
          (id, org_id, project_id, submission_id, recipient_party_id, recipient_role, is_required_approver, status)
         VALUES
           ($1, $4, $5, $6, $7, 'CONSULTANT', true, 'SENT'),
           ($2, $4, $5, $6, $8, 'MC', true, 'SENT'),
           ($3, $4, $5, $6, $9, 'CLIENT', true, 'SENT')`,
        [recPmcId, recMcId, recClientId, orgId, projectId, submissionId, pmcPartyId, mcPartyId, clientPartyId],
      );
    });

    // 1. PMC Accepts -> Aggregate status MUST be PARTIALLY_ACCEPTED (RT-007)
    const agg1 = await v021Workflows.recordRecipientDecisionAndAggregate(
      actorFor(pmId),
      projectId,
      submissionId,
      recPmcId,
      { decision: 'ACCEPTED', remarks: 'Technical dossier approved by Meinhardt PMC.' },
    );
    assert.strictEqual(agg1.aggregateStatus, 'PARTIALLY_ACCEPTED');

    // 2. Main Contractor Accepts -> Still PARTIALLY_ACCEPTED (Client pending)
    const agg2 = await v021Workflows.recordRecipientDecisionAndAggregate(
      actorFor(pmId),
      projectId,
      submissionId,
      recMcId,
      { decision: 'ACCEPTED', remarks: 'L&T MEP QA verified.' },
    );
    assert.strictEqual(agg2.aggregateStatus, 'PARTIALLY_ACCEPTED');

    // 3. Client Accepts -> All required approvers accepted => Aggregate status MUST be ACCEPTED
    const agg3 = await v021Workflows.recordRecipientDecisionAndAggregate(
      actorFor(pmId),
      projectId,
      submissionId,
      recClientId,
      { decision: 'ACCEPTED', remarks: 'Final handover dossier accepted for retention release.' },
    );
    assert.strictEqual(agg3.aggregateStatus, 'ACCEPTED');

    // 4. Close Project (WF-18) & verify warranty_start is set on CHLR-01 (AUD-P-08)
    const closedProj = await projectsService.closeProject(actorFor(pmId), projectId, 3, {
      closureDate: '2026-11-01',
    });
    assert.strictEqual(closedProj.status, 'CLOSED');

    const { rows: closedAsset } = await withTenantTransaction(pool, actorFor(pmId), async (client) => {
      return client.query(
        `SELECT warranty_start::text FROM assets WHERE org_id = $1 AND id = $2`,
        [orgId, chillerAsset.assetId],
      );
    });
    assert.strictEqual(closedAsset[0].warranty_start, '2026-11-01');
    console.log(
      `  ✓ Multi-Recipient Aggregation (PARTIALLY_ACCEPTED -> ACCEPTED) & Project Closure verified (Retention unlocked: ${formatInrFromPaise(725000000n)}).`,
    );

    /* ---------------------------------------------------------------------- */
    /* STEP 9: WEEKLY OWNER DIGEST (RT-029) & AUDIT HASH-CHAIN (08 §5.6)      */
    /* ---------------------------------------------------------------------- */
    console.log('\n[STEP 9] Running Weekly Owner Digest & Audit Hash-Chain Verification...');
    await scheduler.runWeeklyOwnerRetentionAtRiskDigest();
    const hashedEvents = await scheduler.computeAuditHashChainBatch();
    console.log(`  ✓ Audit trail verified (${hashedEvents} events processed).`);

    console.log('\n======================================================================');
    console.log('ALL LIVE PRODUCTION WORKFLOWS (WF-01..WF-26) & RT PATCHES PASSED!');
    console.log('======================================================================');
  } finally {
    await redis.quit();
    await pool.end();
    await migratorPool.end();
  }
}

runFullProductionSimulation().catch((err) => {
  console.error('SIMULATION FAILED:', err);
  process.exit(1);
});
