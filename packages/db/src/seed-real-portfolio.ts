import { Pool } from 'pg';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createHash } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { uuidv7 } from 'uuidv7';

const SIM_STORAGE_DIR = '/tmp/tradecloseout-sim';

export async function generateEngineeringPdf(
  filename: string,
  title: string,
  metadataLines: string[],
  pageCount = 3,
): Promise<{ filePath: string; sizeBytes: number; sha256: string }> {
  await mkdir(SIM_STORAGE_DIR, { recursive: true });
  const pdfDoc = await PDFDocument.create();
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);

  for (let p = 1; p <= pageCount; p++) {
    const page = pdfDoc.addPage([595.28, 841.89]);
    page.drawRectangle({ x: 0, y: 814, width: 595.28, height: 28, color: rgb(0.06, 0.16, 0.26) });
    page.drawText('DECCAN ENVIROTECH MEP PVT LTD — QUALITY ASSURANCE & COMMISSIONING RECORD', {
      x: 36,
      y: 822,
      size: 9,
      font: fontBold,
      color: rgb(1, 1, 1),
    });
    page.drawText(`${title} (Page ${p} of ${pageCount})`, {
      x: 40,
      y: 775,
      size: 13,
      font: fontBold,
      color: rgb(0.05, 0.09, 0.16),
    });

    let y = 735;
    for (const line of metadataLines) {
      page.drawText(line, { x: 40, y, size: 9.5, font: fontMono, color: rgb(0.15, 0.2, 0.25) });
      y -= 18;
    }

    page.drawText(`Confidential · Deccan EnviroTech MEP · Form 46/IS 655 · Generated ${new Date().toISOString().split('T')[0]}`, {
      x: 40,
      y: 35,
      size: 8,
      font: fontMono,
      color: rgb(0.5, 0.5, 0.5),
    });
  }

  const pdfBytes = await pdfDoc.save();
  const filePath = path.join(SIM_STORAGE_DIR, filename);
  await writeFile(filePath, pdfBytes);
  const sha256 = createHash('sha256').update(pdfBytes).digest('hex');

  return { filePath, sizeBytes: pdfBytes.byteLength, sha256 };
}

export async function seedRealPortfolio() {
  console.log('--- SEEDING TRADECLOSEOUT ENTERPRISE HVAC PORTFOLIO ---');
  const pool = new Pool({
    connectionString:
      process.env.MIGRATOR_DATABASE_URL ||
      process.env.APP_DATABASE_URL ||
      'postgresql://tc_migrator:migrator_local_pw@127.0.0.1:5432/tradecloseout',
  });

  const client = await pool.connect();

  try {
    // 1. Seed Platform Tables: Plans, Tax Configs, Asset Categories, Template Pack
    console.log('1. Seeding Subscription Plans & Tax Configs...');
    const plans = [
      {
        id: uuidv7(),
        code: 'STARTER',
        name: 'Starter Plan',
        pricePaise: 499900n,
        limits: { maxActiveProjects: 3, maxSeats: 5, maxStorageBytes: 10 * 1024 * 1024 * 1024, maxPackageGenerationsPerMonth: 20 },
      },
      {
        id: uuidv7(),
        code: 'GROWTH',
        name: 'Growth Plan',
        pricePaise: 1249900n,
        limits: { maxActiveProjects: 10, maxSeats: 15, maxStorageBytes: 50 * 1024 * 1024 * 1024, maxPackageGenerationsPerMonth: 100 },
      },
      {
        id: uuidv7(),
        code: 'SCALE',
        name: 'Scale Enterprise Plan',
        pricePaise: 2499900n,
        limits: { maxActiveProjects: 50, maxSeats: 50, maxStorageBytes: 200 * 1024 * 1024 * 1024, maxPackageGenerationsPerMonth: 500 },
      },
    ];
    for (const pl of plans) {
      await client.query(
        `INSERT INTO plans (id, code, name, limits_json, price_paise, interval, status)
         VALUES ($1, $2, $3, $4, $5, 'MONTHLY', 'ACTIVE')
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, price_paise = EXCLUDED.price_paise, limits_json = EXCLUDED.limits_json`,
        [pl.id, pl.code, pl.name, JSON.stringify(pl.limits), pl.pricePaise.toString()],
      );
    }

    await client.query(
      `INSERT INTO billing_tax_configs (id, effective_from, sac_code, gst_rate_bps, supplier_state_code, supplier_gstin, supplier_pan, einvoice_enabled, einvoice_turnover_limit_inr, active)
       VALUES ($1, '2024-01-01', '998315', 1800, '36', '36AABCD4512F1Z4', 'AABCD4512F', false, 50000000, true)
       ON CONFLICT DO NOTHING`,
      [uuidv7()],
    );

    const categories = [
      { key: 'CHILLER', name: 'Water-Cooled / Air-Cooled Screw & Centrifugal Chillers' },
      { key: 'COOLING_TOWER', name: 'Induced Draft Crossflow/Counterflow Cooling Towers' },
      { key: 'AHU', name: 'Cleanroom / Comfort Air Handling Units & Treated Fresh Air Units' },
      { key: 'FCU', name: 'Fan Coil Units & Cassette Units' },
      { key: 'PUMP_CHW', name: 'Primary & Secondary Chilled Water Pumps' },
      { key: 'PUMP_COND', name: 'Condenser Water Circulation Pumps' },
      { key: 'BOILER', name: 'Hot Water Generators & Boilers' },
      { key: 'HEAT_EXCHANGER', name: 'Plate Heat Exchangers (PHE)' },
      { key: 'VRF_OUTDOOR', name: 'Variable Refrigerant Flow (VRF) Outdoor Units' },
      { key: 'VRF_INDOOR', name: 'VRF Indoor Units & Branch Controllers' },
      { key: 'EXHAUST_FAN', name: 'Basement Ventilation & Toilet Exhaust Fans' },
      { key: 'FIRE_DAMPER', name: 'UL 555 Motorized Fire & Smoke Dampers (MFSD)' },
      { key: 'BMS_PANEL', name: 'Building Management System DDC & Control Panels' },
      { key: 'AIR_WASHER', name: 'Evaporative Air Cooling & Air Washers' },
    ];
    for (const cat of categories) {
      await client.query(
        `INSERT INTO asset_categories (id, key, name)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [uuidv7(), cat.key, cat.name],
      );
    }

    await client.query(
      `INSERT INTO template_packs (id, trade, code, name, version, schema_version, payload_json, status)
       VALUES ($1, 'HVAC', 'TPL-HVAC-IN-001', 'Indian Commercial HVAC Standard Technical Submittal & Closeout Pack', 1, 1, '{"groups": 12, "docTypes": 98}', 'ACTIVE')
       ON CONFLICT (code, version) DO NOTHING`,
      [uuidv7()],
    );

    // 2. Organization & Profiles
    console.log('2. Provisioning Deccan EnviroTech MEP Pvt Ltd...');
    let { rows: existingOrg } = await client.query(
      `SELECT id FROM organisations WHERE legal_name = 'Deccan EnviroTech MEP Pvt Ltd' LIMIT 1`,
    );
    let orgId: string;
    if (existingOrg.length > 0) {
      orgId = existingOrg[0].id;
    } else {
      orgId = '01a1985e-9be6-7992-9aee-8598c19d2f1c';
      await client.query(
        `INSERT INTO organisations (id, legal_name, display_name, entity_type, status, country, state)
         VALUES ($1, 'Deccan EnviroTech MEP Pvt Ltd', 'Deccan EnviroTech MEP', 'PRIVATE_LIMITED', 'ACTIVE', 'IN', 'TS')
         ON CONFLICT (id) DO NOTHING`,
        [orgId],
      );
    }

    await client.query(
      `INSERT INTO org_profiles (org_id, gstin, pan, brand_color, signatory_name, signatory_designation, default_retention_months, allow_self_approval)
       VALUES ($1, '36AABCD4512F1Z4', 'AABCD4512F', '#0F2942', 'Vikramaditya Reddy', 'Managing Director', 120, false)
       ON CONFLICT (org_id) DO UPDATE SET gstin = EXCLUDED.gstin, pan = EXCLUDED.pan, brand_color = EXCLUDED.brand_color`,
      [orgId],
    );

    // Seed Active Growth Subscription for Deccan
    const { rows: growthPlan } = await client.query(`SELECT id FROM plans WHERE code = 'GROWTH' LIMIT 1`);
    if (growthPlan.length > 0) {
      await client.query(
        `INSERT INTO subscriptions (id, org_id, plan_id, status, current_period_start, current_period_end)
         VALUES ($1, $2, $3, 'ACTIVE', '2026-01-01', '2027-01-01')
         ON CONFLICT (org_id) DO UPDATE SET status = 'ACTIVE'`,
        [uuidv7(), orgId, growthPlan[0].id],
      );
    }

    // 3. Team Members
    console.log('3. Seeding Deccan Core Roles & Identities...');
    const team = [
      { name: 'Vikramaditya Reddy', email: 'vikram@deccanmep.in', phone: '+919848011101', role: 'R-OWNER' },
      { name: 'Meera Deshmukh', email: 'meera@deccanmep.in', phone: '+919848011102', role: 'R-PM' },
      { name: 'Karthikeya Sharma', email: 'karthik@deccanmep.in', phone: '+919848011103', role: 'R-QC' },
      { name: 'Amit Verma', email: 'amit@deccanmep.in', phone: '+919848011104', role: 'R-SITE' },
      { name: 'Fatima Shaikh', email: 'fatima@deccanmep.in', phone: '+919848011105', role: 'R-DOC' },
    ];
    const userMap: Record<string, string> = {};

    for (const member of team) {
      const { rows: uRows } = await client.query(
        `SELECT u.id FROM users u JOIN user_identities ui ON ui.user_id = u.id WHERE ui.value = $1 LIMIT 1`,
        [member.email],
      );
      let uId: string;
      if (uRows.length > 0) {
        uId = uRows[0].id;
        await client.query(`UPDATE users SET name = $1, status = 'ACTIVE' WHERE id = $2`, [member.name, uId]);
      } else {
        uId = uuidv7();
        await client.query(`INSERT INTO users (id, name, status) VALUES ($1, $2, 'ACTIVE')`, [uId, member.name]);
        await client.query(
          `INSERT INTO user_identities (id, user_id, type, value, verified_at)
           VALUES ($1, $2, 'EMAIL', $3, now()), ($4, $2, 'PHONE', $5, now())`,
          [uuidv7(), uId, member.email, uuidv7(), member.phone],
        );
      }
      userMap[member.email] = uId;

      await client.query(
        `INSERT INTO memberships (id, org_id, user_id, role, status, joined_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', now())
         ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'ACTIVE'`,
        [uuidv7(), orgId, uId, member.role],
      );
    }

    // 4. Counterparty Directory
    console.log('4. Seeding Counterparties & OEMs...');
    const counterparties = [
      { key: 'aurobindo', name: 'Aurobindo Biologics & Pharma Ltd', types: ['CLIENT'], email: 'projects@aurobindo.in' },
      { key: 'lnt', name: 'L&T Construction (Buildings & Factories)', types: ['MC'], email: 'mep.hyd@lntecc.com' },
      { key: 'meinhardt', name: 'Meinhardt Singapore Pte Ltd (India)', types: ['CONSULTANT'], email: 'hvac.review@meinhardt.in' },
      { key: 'sattva', name: 'Sattva Group Developers', types: ['CLIENT'], email: 'projects@sattvagroup.in' },
      { key: 'shapoorji', name: 'Shapoorji Pallonji Engineering & Construction', types: ['MC'], email: 'commercial@shapoorji.com' },
      { key: 'wsp', name: 'WSP India Consultants', types: ['CONSULTANT'], email: 'mep@wsp.com' },
      { key: 'aig', name: 'Asian Institute of Gastroenterology (AIG)', types: ['CLIENT'], email: 'facilities@aighospitals.com' },
      { key: 'capacite', name: 'Capacit\'e Infraprojects Ltd', types: ['MC'], email: 'projects@capacite.in' },
      { key: 'spectral', name: 'Spectral Services Consultants (AECOM)', types: ['CONSULTANT'], email: 'mep.india@aecom.com' },
      { key: 'bluestar', name: 'Blue Star Limited (Commercial Air Conditioning)', types: ['SUPPLIER_OEM'], email: 'chiller.certs@bluestarindia.com' },
      { key: 'daikin', name: 'Daikin Airconditioning India Pvt Ltd', types: ['SUPPLIER_OEM'], email: 'commercial@daikinindia.com' },
    ];
    const partyMap: Record<string, string> = {};
    for (const p of counterparties) {
      const { rows: pRows } = await client.query(`SELECT id FROM parties WHERE org_id = $1 AND name = $2 LIMIT 1`, [orgId, p.name]);
      if (pRows.length > 0) {
        partyMap[p.key] = pRows[0].id;
      } else {
        const pId = uuidv7();
        await client.query(
          `INSERT INTO parties (id, org_id, name, types, email, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
          [pId, orgId, p.name, p.types, p.email, userMap['meera@deccanmep.in']],
        );
        partyMap[p.key] = pId;
      }
    }

    // Bind session context
    await client.query(`SELECT set_config('app.current_org', $1, true)`, [orgId]);
    await client.query(`SELECT set_config('app.current_user', $1, true)`, [userMap['meera@deccanmep.in']]);

    // 5. Seed Real Projects
    console.log('5. Seeding 3 Projects with Rich HVAC Closeout Data...');

    async function seedDocumentWithVersion(
      projectId: string,
      reqId: string,
      docTypeKey: string,
      title: string,
      revCode: string,
      pdfFilename: string,
      pdfTitle: string,
      metaLines: string[],
      reviewStatus: 'APPROVED' | 'IN_REVIEW' | 'CHANGES_REQUESTED' | 'REJECTED',
      pages = 3,
      isExternal = false,
    ) {
      const pdf = await generateEngineeringPdf(pdfFilename, pdfTitle, metaLines, pages);
      const objKey = `orgs/${orgId}/projects/${projectId}/docs/${pdfFilename}`;
      const localDest = path.join(SIM_STORAGE_DIR, `${objKey.replace(/\//g, '_')}.pdf`);
      const fs = await import('fs/promises');
      await fs.copyFile(pdf.filePath, localDest);

      const objId = uuidv7();
      const { rows: objRows } = await client.query(
        `INSERT INTO storage_objects (id, org_id, provider, bucket, object_key, mime, size_bytes, sha256, status, retention_class, created_by)
         VALUES ($1, $2, 'S3', 'tradecloseout-storage', $3, 'application/pdf', $4, $5, 'READY', 'STANDARD', $6)
         ON CONFLICT (provider, bucket, object_key) DO UPDATE SET sha256 = EXCLUDED.sha256, size_bytes = EXCLUDED.size_bytes
         RETURNING id`,
        [objId, orgId, objKey, pdf.sizeBytes, pdf.sha256, userMap['amit@deccanmep.in']],
      );
      const effectiveObjId = objRows[0].id;

      const docId = uuidv7();
      await client.query(
        `INSERT INTO documents (id, org_id, project_id, title, doc_type_key, category_key, status, created_by)
         VALUES ($1, $2, $3, $4, $5, '06_TESTING', 'ACTIVE', $6)
         ON CONFLICT DO NOTHING`,
        [docId, orgId, projectId, title, docTypeKey, userMap['amit@deccanmep.in']],
      );

      await client.query(
        `INSERT INTO document_requirements (id, org_id, project_id, document_id, requirement_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [uuidv7(), orgId, projectId, docId, reqId],
      );

      const verId = uuidv7();
      await client.query(
        `INSERT INTO document_versions (id, org_id, project_id, document_id, object_id, version_no, revision_code, file_status, review_status, uploaded_by, issue_date)
         VALUES ($1, $2, $3, $4, $5, 1, $6, 'READY', $7, $8, '2026-10-25')
         ON CONFLICT DO NOTHING`,
        [verId, orgId, projectId, docId, effectiveObjId, revCode, reviewStatus, userMap['amit@deccanmep.in']],
      );

      await client.query(
        `UPDATE documents SET current_approved_version_id = $1, latest_version_id = $1 WHERE id = $2`,
        [verId, docId],
      );

      const revId = uuidv7();
      const reviewerUserId = isExternal ? userMap['meera@deccanmep.in'] : userMap['karthik@deccanmep.in'];
      const revStatus = reviewStatus === 'APPROVED' ? 'APPROVED' : reviewStatus === 'IN_REVIEW' ? 'IN_REVIEW' : 'PENDING';
      const revDecision = reviewStatus === 'APPROVED' ? 'APPROVE' : null;

      await client.query(
        `INSERT INTO reviews (id, org_id, project_id, document_version_id, stage_key, reviewer_subject_type, reviewer_subject_id, reviewer_user_id, method, external_method, external_approver_name, status, decision, decided_at, created_at)
         VALUES ($1, $2, $3, $4, 'DEFAULT', 'USER', $5, $5, $6, $7, $8, $9, $10, $11, now())
         ON CONFLICT DO NOTHING`,
        [
          revId,
          orgId,
          projectId,
          verId,
          reviewerUserId,
          isExternal ? 'EXTERNAL' : 'IN_APP',
          isExternal ? 'STAMPED_PDF' : null,
          isExternal ? 'Vikram Sengupta (Meinhardt)' : null,
          revStatus,
          revDecision,
          reviewStatus === 'APPROVED' ? new Date() : null,
        ],
      );

      if (reviewStatus === 'APPROVED') {
        await client.query(
          `INSERT INTO approval_overrides (id, org_id, project_id, review_id, actor_id, reason, previous_decision, new_decision)
           VALUES ($1, $2, $3, $4, $5, 'Technical verification complete per IS 655 & ASHRAE', 'PENDING', 'APPROVE')
           ON CONFLICT DO NOTHING`,
          [uuidv7(), orgId, projectId, revId, reviewerUserId],
        );
      } else if (reviewStatus === 'IN_REVIEW') {
        await client.query(
          `INSERT INTO review_comments (id, org_id, project_id, review_id, page_no, body, visibility, created_by)
           VALUES ($1, $2, $3, $4, 2, 'Verify calibration date on test gauge PG-409 before sign-off', 'EXTERNAL', $5)
           ON CONFLICT DO NOTHING`,
          [uuidv7(), orgId, projectId, revId, userMap['karthik@deccanmep.in']],
        );
      }

      return { docId, verId, objId, pdf };
    }

    // =========================================================================
    // PROJECT 1: HYD-BIO-09 (HANDOVER stage, ₹14.50 Cr contract, ₹72.50L retention)
    // Target: 6 / 10 Approved (60%)
    // =========================================================================
    let p1Id = uuidv7();
    const { rows: p1Rows } = await client.query(`SELECT id FROM projects WHERE org_id = $1 AND code = 'HYD-BIO-09' LIMIT 1`, [orgId]);
    if (p1Rows.length > 0) p1Id = p1Rows[0].id;
    else {
      await client.query(
        `INSERT INTO projects (id, org_id, code, name, status, client_party_id, mc_party_id, consultant_party_id, start_date, target_handover_date, contract_value_paise, retention_bps, site_json, created_by)
         VALUES ($1, $2, 'HYD-BIO-09', 'Genome Valley Sterile Formulation Block-B Cleanroom HVAC', 'HANDOVER', $3, $4, $5, '2026-04-01', '2026-11-20', 1450000000, 500, '{"city": "Hyderabad", "state": "Telangana"}', $6)`,
        [p1Id, orgId, partyMap['aurobindo'], partyMap['lnt'], partyMap['meinhardt'], userMap['meera@deccanmep.in']],
      );
      await client.query(
        `INSERT INTO contracts (id, org_id, project_id, reference, type, value_paise, retention_bps, dlp_months, start_date, end_date, created_by)
         VALUES ($1, $2, $3, 'LT/AUR/HVAC/2026-04', 'ITEM_RATE', 1450000000, 500, 12, '2026-04-01', '2026-11-20', $4)`,
        [uuidv7(), orgId, p1Id, userMap['meera@deccanmep.in']],
      );
    }

    // Assets for P1
    const p1Assets = [
      { tag: 'CHLR-01', name: 'Blue Star 500 TR Water-Cooled Screw Chiller #1', cat: 'CHILLER', make: 'Blue Star Limited', model: 'SXW-500-E', serial: 'BSL-2026-HYD-9901', loc: 'Basement-2 Plant Room' },
      { tag: 'CHLR-02', name: 'Blue Star 500 TR Water-Cooled Screw Chiller #2', cat: 'CHILLER', make: 'Blue Star Limited', model: 'SXW-500-E', serial: 'BSL-2026-HYD-9902', loc: 'Basement-2 Plant Room' },
      { tag: 'AHU-CR-01', name: 'Cleanroom HEPA Supply Air Handling Unit 12000 CFM', cat: 'AHU', make: 'Zeco Aircon', model: 'ZCR-120', serial: 'ZEC-2026-081', loc: 'Block-B Cleanroom Terrace' },
      { tag: 'FD-B2-01', name: 'UL-555 2-Hour Motorized Fire Damper (Plant Exhaust)', cat: 'FIRE_DAMPER', make: 'Ruskin Titus', model: 'FSD-2H', serial: 'RT-2026-441', loc: 'Shaft-3 B2 Penetration' },
    ];
    const p1AssetMap: Record<string, string> = {};
    for (const ast of p1Assets) {
      let aId = uuidv7();
      const { rows: aRows } = await client.query(`SELECT id FROM assets WHERE org_id = $1 AND project_id = $2 AND tag = $3 LIMIT 1`, [orgId, p1Id, ast.tag]);
      if (aRows.length > 0) aId = aRows[0].id;
      else {
        await client.query(
          `INSERT INTO assets (id, org_id, project_id, tag, name, category_key, make, model, serial_no, location, status, warranty_start_basis, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ACTIVE', 'HANDOVER', $11)`,
          [aId, orgId, p1Id, ast.tag, ast.name, ast.cat, ast.make, ast.model, ast.serial, ast.loc, userMap['amit@deccanmep.in']],
        );
      }
      p1AssetMap[ast.tag] = aId;
    }

    // 10 Requirements for P1 (6 Approved, 2 In Review, 1 Pending Waiver, 1 Missing -> 60% Progress)
    const p1Reqs = [
      { key: 'REQ-HVAC-004', title: 'Contractor All-Risk (CAR) Insurance & Third-Party Liability Policy', docType: 'DT-004', status: 'APPROVED', isExt: false, file: 'HYD-BIO-09-DT004-CAR-INSURANCE.pdf', titleL: 'CONTRACTOR ALL-RISK (CAR) INSURANCE POLICY' },
      { key: 'REQ-HVAC-011', title: 'Cleanroom Terminal HEPA & Ductwork As-Built Drawings (Stamped)', docType: 'DT-011', status: 'APPROVED', isExt: true, file: 'HYD-BIO-09-DT011-ASBUILT-STAMPED.pdf', titleL: 'CLEANROOM TERMINAL HEPA AS-BUILT DRAWINGS (STAMPED MEINHARDT)' },
      { key: 'REQ-CHLR-FAT', title: 'Chiller Factory Acceptance Test (AHRI 550/590 Report) — CHLR-01', docType: 'DT-022', status: 'APPROVED', isExt: false, file: 'HYD-BIO-09-DT022-CHLR01-FAT.pdf', titleL: 'CHILLER FAT CERTIFICATION — AHRI 550/590 (CHLR-01)' },
      { key: 'REQ-HVAC-030', title: 'Third-Party Inspection (TPI) Certificate for Chilled Water Header Piping', docType: 'DT-030', status: 'APPROVED', isExt: true, file: 'HYD-BIO-09-DT030-TPI-CHW-PIPING.pdf', titleL: 'TPI MATERIAL & WELD INSPECTION CERTIFICATE (TUV SUD)' },
      { key: 'REQ-HVAC-031', title: 'Condenser Water Circulation 10.5 Bar Hydrostatic Test Report', docType: 'DT-031', status: 'APPROVED', isExt: false, file: 'HYD-BIO-09-DT031-COND-HYDRO.pdf', titleL: 'CONDENSER WATER PIPING HYDROSTATIC TEST (10.5 BAR)' },
      { key: 'REQ-HVAC-041', title: 'Cleanroom Room Pressure Differential & ISO 14644-1 Particle Count Audit', docType: 'DT-041', status: 'APPROVED', isExt: false, file: 'HYD-BIO-09-DT041-PARTICLE-COUNT.pdf', titleL: 'CLEANROOM ISO 14644-1 AIRBORNE PARTICLE AUDIT' },
      { key: 'REQ-HVAC-033', title: 'Chiller Hydrostatic Pressure Test Report — CHLR-01 (10.5 Bar)', docType: 'DT-033', status: 'IN_REVIEW', isExt: false, file: 'HYD-BIO-09-DT033-CHLR01-HYDRO.pdf', titleL: 'HYDROSTATIC PRESSURE TEST REPORT — CHLR-01' },
      { key: 'REQ-HVAC-035', title: 'Cleanroom Supply Ductwork Air Leakage Test (DW/144 Class C) — AHU-CR-01', docType: 'DT-035', status: 'IN_REVIEW', isExt: false, file: 'HYD-BIO-09-DT035-DUCT-LEAKAGE.pdf', titleL: 'DUCT AIR LEAKAGE TEST RECORD (DW/144 CLASS C)' },
      { key: 'REQ-HVAC-052', title: 'Octave-Band Acoustic & Vibration Isolation Verification', docType: 'DT-052', status: 'PENDING_WAIVER', isExt: false, file: null, titleL: '' },
      { key: 'REQ-HVAC-086', title: 'State Fire Services Chief Fire Officer (CFO) Final NOC', docType: 'DT-086', status: 'REQUESTED', isExt: false, file: null, titleL: '' },
    ];

    let p1SnapshotId = uuidv7();
    const { rows: snap1Rows } = await client.query(
      `SELECT id FROM checklist_snapshots WHERE org_id = $1 AND project_id = $2 ORDER BY version_no DESC LIMIT 1`,
      [orgId, p1Id],
    );
    if (snap1Rows.length > 0) {
      p1SnapshotId = snap1Rows[0].id;
    } else {
      await client.query(
        `INSERT INTO checklist_snapshots (id, org_id, project_id, version_no, status, resolved_payload_json, provenance_json, source_json, checksum, created_by)
         VALUES ($1, $2, $3, 1, 'ACTIVE', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, $4, $5)`,
        [p1SnapshotId, orgId, p1Id, createHash('sha256').update(p1Id).digest('hex'), userMap['meera@deccanmep.in']],
      );
    }

    const p1ReqMap: Record<string, string> = {};
    for (const r of p1Reqs) {
      let rId = uuidv7();
      const { rows: rRows } = await client.query(`SELECT id FROM requirements WHERE org_id = $1 AND project_id = $2 AND requirement_key = $3 LIMIT 1`, [orgId, p1Id, r.key]);
      if (rRows.length > 0) rId = rRows[0].id;
      else {
        await client.query(
          `INSERT INTO requirements (id, org_id, project_id, current_snapshot_id, requirement_key, group_key, title, doc_type_key, status, mandatory, reviewer_role, created_at)
           VALUES ($1, $2, $3, $4, $5, '01_CORE', $6, $7, $8, true, 'R-QC', now())`,
          [rId, orgId, p1Id, p1SnapshotId, r.key, r.title, r.docType, r.status],
        );
      }
      p1ReqMap[r.key] = rId;

      if (r.file) {
        await seedDocumentWithVersion(
          p1Id,
          rId,
          r.docType,
          r.title,
          'R1',
          r.file,
          r.titleL,
          [
            `Project: HYD-BIO-09 Genome Valley Block-B · Trade: HVAC`,
            `Document Ref: TC-HYD-BIO-${r.docType}-2026`,
            `Witnessed by: Meera Deshmukh (R-PM) & Meinhardt Consultant`,
            `Standards: IS 655 / ASHRAE 90.1 / ISO 14644-1`,
          ],
          r.status as any,
          4,
          r.isExt,
        );
      }

      if (r.status === 'PENDING_WAIVER') {
        await client.query(
          `INSERT INTO waivers (id, org_id, project_id, requirement_id, type, is_mandatory_item, status, reason, requested_by, approved_by, created_at)
           VALUES ($1, $2, $3, $4, 'WAIVE', true, 'PENDING_SECOND_APPROVAL', 'Factory calibrated inertial bases installed; field acoustic survey waived by consultant', $5, $5, now())
           ON CONFLICT DO NOTHING`,
          [uuidv7(), orgId, p1Id, rId, userMap['meera@deccanmep.in']],
        );
      }
    }

    // Seed closure evidence storage object for defects
    const closurePdf = await generateEngineeringPdf('DEFECT-01-CLOSURE-EVIDENCE.pdf', 'DEFECT CLOSURE VERIFICATION & RE-TORQUE RECORD', ['Flange re-torqued to 85 Nm', 'Zero leakage verified at 6 Bar'], 1);
    const { rows: closureObjRows } = await client.query(
      `INSERT INTO storage_objects (id, org_id, provider, bucket, object_key, mime, size_bytes, sha256, status, retention_class, created_by)
       VALUES ($1, $2, 'S3', 'tradecloseout-storage', 'defects/closure-evidence-01.pdf', 'application/pdf', $3, $4, 'READY', 'STANDARD', $5)
       ON CONFLICT (provider, bucket, object_key) DO UPDATE SET sha256 = EXCLUDED.sha256, size_bytes = EXCLUDED.size_bytes
       RETURNING id`,
      [uuidv7(), orgId, closurePdf.sizeBytes, closurePdf.sha256, userMap['amit@deccanmep.in']],
    );
    const closureEvidenceObjId = closureObjRows[0].id;

    // Warranties & Defects for P1
    await client.query(
      `INSERT INTO warranty_events (id, org_id, project_id, asset_id, event_type, status, basis, oem_reference, registered_at, warranty_start, warranty_end, created_by)
       VALUES
         ($1, $2, $3, $4, 'REGISTRATION', 'CONFIRMED', 'HANDOVER', 'BSL-OEM-HYD-9901-WR', '2026-10-15', '2026-11-20', '2028-11-19', $7),
         ($5, $2, $3, $6, 'REGISTRATION', 'DISPUTED', 'COMMISSIONING', 'BSL-OEM-HYD-9902-WR', '2026-10-15', '2026-10-01', '2028-09-30', $7)
       ON CONFLICT DO NOTHING`,
      [uuidv7(), orgId, p1Id, p1AssetMap['CHLR-01'], uuidv7(), p1AssetMap['CHLR-02'], userMap['meera@deccanmep.in']],
    );

    await client.query(
      `INSERT INTO defects (id, org_id, project_id, asset_id, title, description, severity, status, raised_by, closure_evidence_object_id, closed_by, closed_at)
       VALUES
         ($1, $2, $3, $4, 'AHU-CR-01 Spring Vibration Isolator Deflection Gap < 15mm', 'Isolator #3 seated unevenly causing audible hum in Room 204', 'LOW', 'IN_PROGRESS', $5, null, null, null),
         ($6, $2, $3, $7, 'CHLR-01 Condenser Head Flange Weep at 6 Bar', 'Replaced EPDM gasket with spiral-wound metallic gasket; re-torqued', 'HIGH', 'CLOSED', $5, $8, $5, now())
       ON CONFLICT DO NOTHING`,
      [uuidv7(), orgId, p1Id, p1AssetMap['AHU-CR-01'], userMap['amit@deccanmep.in'], uuidv7(), p1AssetMap['CHLR-01'], closureEvidenceObjId],
    );

    // Active Supplier Upload Link for Blue Star Ltd
    const tokenRaw = 'sup_bluestar_hyd_bio_09';
    const tokenHash = createHash('sha256').update(tokenRaw).digest('hex');
    await client.query(
      `INSERT INTO guest_grants (id, org_id, project_id, party_id, target_email, target_phone_e164, grant_type, role, capabilities, otp_required, token_hash, status, expires_at, created_by)
       VALUES ($1, $2, $3, $4, 'chiller.certs@bluestarindia.com', '+919848099881', 'SUPPLIER_UPLOAD', 'GUEST', ARRAY['upload:own_requirements'], false, $5, 'ACTIVE', now() + interval '30 days', $6)
       ON CONFLICT (token_hash) DO NOTHING`,
      [uuidv7(), orgId, p1Id, partyMap['bluestar'], tokenHash, userMap['meera@deccanmep.in']],
    );

    // Compiled Handover Package for P1
    const p1PackagePdf = await generateEngineeringPdf(
      'HYD-BIO-09-COMPILED-HANDOVER-DOSSIER.pdf',
      'STATUTORY & TECHNICAL HANDOVER DOSSIER — HYD-BIO-09',
      [
        'Project: Genome Valley Sterile Formulation Block-B Cleanroom HVAC',
        'Client: Aurobindo Biologics & Pharma Ltd',
        'Main Contractor: L&T Construction (B&F Division)',
        'Compiled under ISO 32000-1 / Bates Numbered TC-HYD-00001..TC-HYD-00084',
      ],
      12,
    );
    const { rows: p1PkgObjRows } = await client.query(
      `INSERT INTO storage_objects (id, org_id, provider, bucket, object_key, mime, size_bytes, sha256, status, retention_class, created_by)
       VALUES ($1, $2, 'S3', 'tradecloseout-storage', 'packages/HYD-BIO-09-COMPILED-HANDOVER-DOSSIER.pdf', 'application/pdf', $3, $4, 'READY', 'STANDARD', $5)
       ON CONFLICT (provider, bucket, object_key) DO UPDATE SET sha256 = EXCLUDED.sha256, size_bytes = EXCLUDED.size_bytes
       RETURNING id`,
      [uuidv7(), orgId, p1PackagePdf.sizeBytes, p1PackagePdf.sha256, userMap['meera@deccanmep.in']],
    );
    const p1PkgObjId = p1PkgObjRows[0].id;
    await client.query(
      `INSERT INTO handover_packages (id, org_id, project_id, version_no, status, snapshot_id, snapshot_checksum, pdf_object_id, requested_by)
       VALUES ($1, $2, $3, 1, 'READY', $4, $5, $6, $7)
       ON CONFLICT DO NOTHING`,
      [uuidv7(), orgId, p1Id, p1SnapshotId, createHash('sha256').update(p1Id).digest('hex'), p1PkgObjId, userMap['meera@deccanmep.in']],
    );

    // =========================================================================
    // PROJECT 2: HYD-IT-04 (ACTIVE stage, ₹22.80 Cr contract)
    // Target: 4 / 8 Approved (50%)
    // =========================================================================
    let p2Id = uuidv7();
    const { rows: p2Rows } = await client.query(`SELECT id FROM projects WHERE org_id = $1 AND code = 'HYD-IT-04' LIMIT 1`, [orgId]);
    if (p2Rows.length > 0) p2Id = p2Rows[0].id;
    else {
      await client.query(
        `INSERT INTO projects (id, org_id, code, name, status, client_party_id, mc_party_id, consultant_party_id, start_date, target_handover_date, contract_value_paise, retention_bps, site_json, created_by)
         VALUES ($1, $2, 'HYD-IT-04', 'Knowledge City Raidurg Tower-3 High-Side Chiller & VRF Plant', 'ACTIVE', $3, $4, $5, '2026-06-15', '2027-03-31', 2280000000, 500, '{"city": "Hyderabad", "state": "Telangana"}', $6)`,
        [p2Id, orgId, partyMap['sattva'], partyMap['shapoorji'], partyMap['wsp'], userMap['meera@deccanmep.in']],
      );
      await client.query(
        `INSERT INTO contracts (id, org_id, project_id, reference, type, value_paise, retention_bps, dlp_months, start_date, end_date, created_by)
         VALUES ($1, $2, $3, 'SP/SAT/HVAC/2026-09', 'ITEM_RATE', 2280000000, 500, 24, '2026-06-15', '2027-03-31', $4)`,
        [uuidv7(), orgId, p2Id, userMap['meera@deccanmep.in']],
      );
    }

    const p2Reqs = [
      { key: 'P2-REQ-001', title: 'Tower-3 Main Plant Room General Arrangement Drawings', docType: 'DT-001', status: 'APPROVED' },
      { key: 'P2-REQ-004', title: 'Contractor All-Risk (CAR) Insurance Policy', docType: 'DT-004', status: 'APPROVED' },
      { key: 'P2-REQ-022', title: '650 TR Centrifugal Chiller Factory Acceptance Test (AHRI 550)', docType: 'DT-022', status: 'APPROVED' },
      { key: 'P2-REQ-024', title: 'Mill Test Certificates for Chilled Water Schedule 40 Piping', docType: 'DT-024', status: 'APPROVED' },
      { key: 'P2-REQ-033', title: 'Riser Hydrostatic Pressure Testing Report (12 Bar)', docType: 'DT-033', status: 'IN_REVIEW' },
      { key: 'P2-REQ-036', title: 'BMS DDC Point-to-Point Loop Check Register', docType: 'DT-036', status: 'IN_REVIEW' },
      { key: 'P2-REQ-042', title: 'Cooling Tower Drift Loss & Thermal Performance Test', docType: 'DT-042', status: 'REQUESTED' },
      { key: 'P2-REQ-070', title: 'Subcontractor Substantial Completion Certificate', docType: 'DT-070', status: 'REQUESTED' },
    ];
    let p2SnapshotId = uuidv7();
    const { rows: snap2Rows } = await client.query(
      `SELECT id FROM checklist_snapshots WHERE org_id = $1 AND project_id = $2 ORDER BY version_no DESC LIMIT 1`,
      [orgId, p2Id],
    );
    if (snap2Rows.length > 0) {
      p2SnapshotId = snap2Rows[0].id;
    } else {
      await client.query(
        `INSERT INTO checklist_snapshots (id, org_id, project_id, version_no, status, resolved_payload_json, provenance_json, source_json, checksum, created_by)
         VALUES ($1, $2, $3, 1, 'ACTIVE', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, $4, $5)`,
        [p2SnapshotId, orgId, p2Id, createHash('sha256').update(p2Id).digest('hex'), userMap['meera@deccanmep.in']],
      );
    }

    for (const r of p2Reqs) {
      let rId = uuidv7();
      const { rows: rRows } = await client.query(`SELECT id FROM requirements WHERE org_id = $1 AND project_id = $2 AND requirement_key = $3 LIMIT 1`, [orgId, p2Id, r.key]);
      if (rRows.length > 0) rId = rRows[0].id;
      else {
        await client.query(
          `INSERT INTO requirements (id, org_id, project_id, current_snapshot_id, requirement_key, group_key, title, doc_type_key, status, mandatory, reviewer_role, created_at)
           VALUES ($1, $2, $3, $4, $5, '01_CORE', $6, $7, $8, true, 'R-QC', now())`,
          [rId, orgId, p2Id, p2SnapshotId, r.key, r.title, r.docType, r.status],
        );
      }
      if (r.status === 'APPROVED' || r.status === 'IN_REVIEW') {
        await seedDocumentWithVersion(
          p2Id,
          rId,
          r.docType,
          r.title,
          'R1',
          `HYD-IT-04-${r.docType}.pdf`,
          `HYD-IT-04 — ${r.title.toUpperCase()}`,
          [
            `Project: HYD-IT-04 Knowledge City Tower-3 · Sattva / Shapoorji`,
            `Document: ${r.key} (${r.docType})`,
            `Specification: WSP India MEP Package Specifications`,
          ],
          r.status as any,
          3,
        );
      }
    }

    // =========================================================================
    // PROJECT 3: SEC-HOSP-02 (CLOSED stage, ₹8.40 Cr contract)
    // Target: 8 / 8 Approved (100% CLOSED)
    // =========================================================================
    let p3Id = uuidv7();
    const { rows: p3Rows } = await client.query(`SELECT id FROM projects WHERE org_id = $1 AND code = 'SEC-HOSP-02' LIMIT 1`, [orgId]);
    if (p3Rows.length > 0) p3Id = p3Rows[0].id;
    else {
      await client.query(
        `INSERT INTO projects (id, org_id, code, name, status, client_party_id, mc_party_id, consultant_party_id, start_date, target_handover_date, contract_value_paise, retention_bps, site_json, created_by)
         VALUES ($1, $2, 'SEC-HOSP-02', 'AIG Multi-Specialty Hospital OT & ICU Cleanroom Ventilation', 'CLOSED', $3, $4, $5, '2025-10-01', '2026-09-30', 840000000, 500, '{"city": "Hyderabad", "state": "Telangana"}', $6)`,
        [p3Id, orgId, partyMap['aig'], partyMap['capacite'], partyMap['spectral'], userMap['meera@deccanmep.in']],
      );
      await client.query(
        `INSERT INTO contracts (id, org_id, project_id, reference, type, value_paise, retention_bps, dlp_months, start_date, end_date, created_by)
         VALUES ($1, $2, $3, 'CAP/AIG/MEP/2025-02', 'ITEM_RATE', 840000000, 500, 12, '2025-10-01', '2026-09-30', $4)`,
        [uuidv7(), orgId, p3Id, userMap['meera@deccanmep.in']],
      );
    }

    const p3Reqs = [
      { key: 'P3-REQ-004', title: 'CAR Insurance Policy & Workmens Compensation', docType: 'DT-004' },
      { key: 'P3-REQ-011', title: 'OT Suite Supply & Return Air As-Built Drawings', docType: 'DT-011' },
      { key: 'P3-REQ-022', title: 'Medical Cleanroom Chiller AHRI FAT Report', docType: 'DT-022' },
      { key: 'P3-REQ-033', title: 'Chilled Water Line 10.5 Bar Hydrostatic Certification', docType: 'DT-033' },
      { key: 'P3-REQ-039', title: 'Fire & Smoke Damper 2-Hour Integrity Test', docType: 'DT-039' },
      { key: 'P3-REQ-041', title: 'NABH Hospital OT Airborne Particle & ACH Audit Report', docType: 'DT-041' },
      { key: 'P3-REQ-068', title: 'Final Handover Acceptance & DLP Completion Certificate', docType: 'DT-068' },
      { key: 'P3-REQ-086', title: 'Chief Fire Officer Final Fire NOC', docType: 'DT-086' },
    ];
    let p3SnapshotId = uuidv7();
    const { rows: snap3Rows } = await client.query(
      `SELECT id FROM checklist_snapshots WHERE org_id = $1 AND project_id = $2 ORDER BY version_no DESC LIMIT 1`,
      [orgId, p3Id],
    );
    if (snap3Rows.length > 0) {
      p3SnapshotId = snap3Rows[0].id;
    } else {
      await client.query(
        `INSERT INTO checklist_snapshots (id, org_id, project_id, version_no, status, resolved_payload_json, provenance_json, source_json, checksum, created_by)
         VALUES ($1, $2, $3, 1, 'ACTIVE', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, $4, $5)`,
        [p3SnapshotId, orgId, p3Id, createHash('sha256').update(p3Id).digest('hex'), userMap['meera@deccanmep.in']],
      );
    }

    for (const r of p3Reqs) {
      let rId = uuidv7();
      const { rows: rRows } = await client.query(`SELECT id FROM requirements WHERE org_id = $1 AND project_id = $2 AND requirement_key = $3 LIMIT 1`, [orgId, p3Id, r.key]);
      if (rRows.length > 0) rId = rRows[0].id;
      else {
        await client.query(
          `INSERT INTO requirements (id, org_id, project_id, current_snapshot_id, requirement_key, group_key, title, doc_type_key, status, mandatory, reviewer_role, created_at)
           VALUES ($1, $2, $3, $4, $5, '01_CORE', $6, $7, 'APPROVED', true, 'R-QC', now())`,
          [rId, orgId, p3Id, p3SnapshotId, r.key, r.title, r.docType],
        );
      }
      await seedDocumentWithVersion(
        p3Id,
        rId,
        r.docType,
        r.title,
        'R1',
        `SEC-HOSP-02-${r.docType}.pdf`,
        `SEC-HOSP-02 — ${r.title.toUpperCase()}`,
        [
          `Project: SEC-HOSP-02 AIG Hospitals OT Cleanroom HVAC`,
          `Client: Asian Institute of Gastroenterology`,
          `Consultant: Spectral Services Consultants (AECOM)`,
          `NABH / ISO 14644 Verified Complete`,
        ],
        'APPROVED',
        2,
      );
    }

    const p3PackagePdf = await generateEngineeringPdf('SEC-HOSP-02-FINAL-DOSSIER.pdf', 'AIG HOSPITAL MEDICAL OT CLOSEOUT DOSSIER', ['Complete Closeout Dossier - 100% Certified'], 16);
    const { rows: p3PkgObjRows } = await client.query(
      `INSERT INTO storage_objects (id, org_id, provider, bucket, object_key, mime, size_bytes, sha256, status, retention_class, created_by)
       VALUES ($1, $2, 'S3', 'tradecloseout-storage', 'packages/SEC-HOSP-02-FINAL-DOSSIER.pdf', 'application/pdf', $3, $4, 'READY', 'STANDARD', $5)
       ON CONFLICT (provider, bucket, object_key) DO UPDATE SET sha256 = EXCLUDED.sha256, size_bytes = EXCLUDED.size_bytes
       RETURNING id`,
      [uuidv7(), orgId, p3PackagePdf.sizeBytes, p3PackagePdf.sha256, userMap['meera@deccanmep.in']],
    );
    const p3PkgObjId = p3PkgObjRows[0].id;
    await client.query(
      `INSERT INTO handover_packages (id, org_id, project_id, version_no, status, snapshot_id, snapshot_checksum, pdf_object_id, requested_by)
       VALUES ($1, $2, $3, 1, 'READY', $4, $5, $6, $7)
       ON CONFLICT DO NOTHING`,
      [uuidv7(), orgId, p3Id, p3SnapshotId, createHash('sha256').update(p3Id).digest('hex'), p3PkgObjId, userMap['meera@deccanmep.in']],
    );

    console.log('✓ Seeding complete! All 3 projects populated with rich multi-status HVAC data & real PDFs.');
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  seedRealPortfolio().catch((err) => {
    console.error('SEEDING FAILED:', err);
    process.exit(1);
  });
}
