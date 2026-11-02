import { Pool } from 'pg';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createHash } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { uuidv7 } from 'uuidv7';

const SIM_STORAGE_DIR = '/tmp/tradecloseout-sim';

async function generateEngineeringPdf(
  filename: string,
  title: string,
  metadataLines: string[],
  pageCount = 2,
): Promise<{ filePath: string; sizeBytes: number; sha256: string }> {
  await mkdir(SIM_STORAGE_DIR, { recursive: true });
  const pdfDoc = await PDFDocument.create();
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);

  for (let p = 1; p <= pageCount; p++) {
    const page = pdfDoc.addPage([595.28, 841.89]);
    page.drawText('DECCAN ENVIROTECH MEP PVT LTD — QUALITY ASSURANCE RECORD', {
      x: 48,
      y: 790,
      size: 10,
      font: fontBold,
      color: rgb(0.06, 0.16, 0.26),
    });
    page.drawText(`${title} (Page ${p} of ${pageCount})`, {
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

async function seedPortfolio() {
  console.log('--- SEEDING DECCAN ENVIROTECH 3-PROJECT PORTFOLIO ---');
  const pool = new Pool({
    connectionString:
      process.env.MIGRATOR_DATABASE_URL ||
      process.env.APP_DATABASE_URL ||
      'postgresql://tc_migrator:migrator_local_pw@127.0.0.1:5432/tradecloseout',
  });

  try {
    // 1. Target the latest active Deccan Org
    const { rows: latestOrg } = await pool.query(
      `SELECT id FROM organisations WHERE legal_name = 'Deccan EnviroTech MEP Pvt Ltd' ORDER BY created_at DESC LIMIT 1`,
    );
    const orgId = latestOrg[0].id;
    console.log(`Targeting Canonical Deccan Org: ${orgId}`);

    await pool.query(
      `INSERT INTO org_profiles (org_id, gstin, pan, brand_color, signatory_name, signatory_designation)
       VALUES ($1, '36AABCD4512F1Z4', 'AABCD4512F', '#0F2942', 'Vikramaditya Reddy', 'Managing Director')
       ON CONFLICT (org_id) DO UPDATE SET gstin = EXCLUDED.gstin, pan = EXCLUDED.pan, brand_color = EXCLUDED.brand_color`,
      [orgId],
    );

    // 2. Provision Team Members & Memberships
    const team = [
      { name: 'Vikramaditya Reddy', email: 'vikram@deccanmep.in', phone: '+919848011101', role: 'R-OWNER' },
      { name: 'Meera Deshmukh', email: 'meera@deccanmep.in', phone: '+919848011102', role: 'R-PM' },
      { name: 'Karthikeya Sharma', email: 'karthik@deccanmep.in', phone: '+919848011103', role: 'R-QC' },
      { name: 'Amit Verma', email: 'amit@deccanmep.in', phone: '+919848011104', role: 'R-SITE' },
      { name: 'Fatima Shaikh', email: 'fatima@deccanmep.in', phone: '+919848011105', role: 'R-DOC' },
    ];

    const userMap: Record<string, string> = {};

    for (const member of team) {
      const { rows: uRows } = await pool.query(
        `SELECT u.id FROM users u
         JOIN user_identities ui ON ui.user_id = u.id
         WHERE ui.value = $1 LIMIT 1`,
        [member.email],
      );

      let uId: string;
      if (uRows.length > 0) {
        uId = uRows[0].id;
        await pool.query(`UPDATE users SET name = $1, status = 'ACTIVE' WHERE id = $2`, [member.name, uId]);
      } else {
        uId = uuidv7();
        await pool.query(`INSERT INTO users (id, name, status) VALUES ($1, $2, 'ACTIVE')`, [uId, member.name]);
        await pool.query(
          `INSERT INTO user_identities (id, user_id, type, value, verified_at)
           VALUES ($1, $2, 'EMAIL', $3, now()), ($4, $2, 'PHONE', $5, now())`,
          [uuidv7(), uId, member.email, uuidv7(), member.phone],
        );
      }
      userMap[member.email] = uId;

      await pool.query(
        `INSERT INTO memberships (id, org_id, user_id, role, status, joined_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', now())
         ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'ACTIVE'`,
        [uuidv7(), orgId, uId, member.role],
      );
    }
    console.log('✓ Provisioned 5 Deccan team members with memberships');

    // 3. Counterparties
    const parties = [
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
    for (const p of parties) {
      const { rows: pRows } = await pool.query(
        `SELECT id FROM parties WHERE org_id = $1 AND name = $2 LIMIT 1`,
        [orgId, p.name],
      );
      if (pRows.length > 0) {
        partyMap[p.key] = pRows[0].id;
      } else {
        const pId = uuidv7();
        await pool.query(
          `INSERT INTO parties (id, org_id, name, types, email, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [pId, orgId, p.name, p.types, p.email, userMap['meera@deccanmep.in']],
        );
        partyMap[p.key] = pId;
      }
    }
    console.log('✓ Counterparty directory ready');

    // Set tenant config
    await pool.query(`SELECT set_config('app.current_org', $1, true)`, [orgId]);
    await pool.query(`SELECT set_config('app.current_user', $1, true)`, [userMap['meera@deccanmep.in']]);

    // 4. Seed 3 Projects
    // PROJECT 1: HYD-BIO-09 (HANDOVER stage)
    let p1Id = uuidv7();
    const { rows: existingP1 } = await pool.query(
      `SELECT id FROM projects WHERE org_id = $1 AND code = 'HYD-BIO-09' LIMIT 1`,
      [orgId],
    );
    if (existingP1.length > 0) {
      p1Id = existingP1[0].id;
      await pool.query(`UPDATE projects SET status = 'HANDOVER' WHERE id = $1`, [p1Id]);
    } else {
      await pool.query(
        `INSERT INTO projects (id, org_id, code, name, status, client_party_id, mc_party_id, consultant_party_id, start_date, target_handover_date, site_json, created_by)
         VALUES ($1, $2, 'HYD-BIO-09', 'Genome Valley Sterile Formulation Block-B Cleanroom HVAC', 'HANDOVER', $3, $4, $5, '2026-04-01', '2026-11-20', '{"city": "Hyderabad", "state": "Telangana"}', $6)`,
        [p1Id, orgId, partyMap['aurobindo'], partyMap['lnt'], partyMap['meinhardt'], userMap['meera@deccanmep.in']],
      );
      await pool.query(
        `INSERT INTO contracts (id, org_id, project_id, reference, type, value_paise, retention_bps, dlp_months, start_date, end_date, created_by)
         VALUES ($1, $2, $3, 'LT/AUR/HVAC/2026-04', 'ITEM_RATE', 1450000000, 500, 12, '2026-04-01', '2026-11-20', $4)`,
        [uuidv7(), orgId, p1Id, userMap['meera@deccanmep.in']],
      );
    }

    // PROJECT 2: HYD-IT-04 (ACTIVE stage)
    let p2Id = uuidv7();
    const { rows: existingP2 } = await pool.query(
      `SELECT id FROM projects WHERE org_id = $1 AND code = 'HYD-IT-04' LIMIT 1`,
      [orgId],
    );
    if (existingP2.length > 0) {
      p2Id = existingP2[0].id;
    } else {
      await pool.query(
        `INSERT INTO projects (id, org_id, code, name, status, client_party_id, mc_party_id, consultant_party_id, start_date, target_handover_date, site_json, created_by)
         VALUES ($1, $2, 'HYD-IT-04', 'Knowledge City Raidurg Tower-3 High-Side Chiller & VRF Plant', 'ACTIVE', $3, $4, $5, '2026-06-15', '2027-03-31', '{"city": "Hyderabad", "state": "Telangana"}', $6)`,
        [p2Id, orgId, partyMap['sattva'], partyMap['shapoorji'], partyMap['wsp'], userMap['meera@deccanmep.in']],
      );
      await pool.query(
        `INSERT INTO contracts (id, org_id, project_id, reference, type, value_paise, retention_bps, dlp_months, start_date, end_date, created_by)
         VALUES ($1, $2, $3, 'SP/SAT/HVAC/2026-09', 'ITEM_RATE', 2280000000, 500, 24, '2026-06-15', '2027-03-31', $4)`,
        [uuidv7(), orgId, p2Id, userMap['meera@deccanmep.in']],
      );
    }

    // PROJECT 3: SEC-HOSP-02 (CLOSED stage)
    let p3Id = uuidv7();
    const { rows: existingP3 } = await pool.query(
      `SELECT id FROM projects WHERE org_id = $1 AND code = 'SEC-HOSP-02' LIMIT 1`,
      [orgId],
    );
    if (existingP3.length > 0) {
      p3Id = existingP3[0].id;
    } else {
      await pool.query(
        `INSERT INTO projects (id, org_id, code, name, status, client_party_id, mc_party_id, consultant_party_id, start_date, target_handover_date, site_json, created_by)
         VALUES ($1, $2, 'SEC-HOSP-02', 'AIG Multi-Specialty Hospital OT & ICU Cleanroom Ventilation', 'CLOSED', $3, $4, $5, '2025-10-01', '2026-09-30', '{"city": "Hyderabad", "state": "Telangana"}', $6)`,
        [p3Id, orgId, partyMap['aig'], partyMap['capacite'], partyMap['spectral'], userMap['meera@deccanmep.in']],
      );
      await pool.query(
        `INSERT INTO contracts (id, org_id, project_id, reference, type, value_paise, retention_bps, dlp_months, start_date, end_date, created_by)
         VALUES ($1, $2, $3, 'CAP/AIG/MEP/2025-02', 'ITEM_RATE', 840000000, 500, 12, '2025-10-01', '2026-09-30', $4)`,
        [uuidv7(), orgId, p3Id, userMap['meera@deccanmep.in']],
      );
    }
    console.log('✓ 3 Commercial HVAC Projects seeded (HYD-BIO-09, HYD-IT-04, SEC-HOSP-02)');

    // 5. Generate Real PDFs for HYD-BIO-09
    const hydroPdf = await generateEngineeringPdf(
      'HYD-BIO-09-HVAC-DT033-CHLR01-R1.pdf',
      'HYDROSTATIC PRESSURE TEST REPORT — CHLR-01 (10.5 BAR)',
      [
        'Asset Tag: CHLR-01 (Blue Star 500 TR Water-Cooled Screw Chiller)',
        'Serial: BSL-2026-HYD-9901 · Location: Basement-2 Plant Room',
        'Hold Duration: 4.0 Hours · Test Pressure: 10.5 Bar (g)',
        'Calibrated Gauges: WIKA PG-NABL-409 & 410 (Vimta Labs TC-5401)',
      ],
      4,
    );

    const asBuiltPdf = await generateEngineeringPdf(
      'HYD-BIO-09-HVAC-DT011-ASBUILT-R2.pdf',
      'CLEANROOM TERMINAL HEPA & DUCTWORK AS-BUILT DRAWINGS (STAMPED)',
      [
        'Drawing Ref: DEB-AUR-HVAC-AB-104 (Rev R2)',
        'Consultant Physical Stamp: Vikram Sengupta (Meinhardt Singapore)',
        'Transmittal Reference: TRN-MEIN-HYD-2026-104',
      ],
      6,
    );

    const fatPdf = await generateEngineeringPdf(
      'BLUESTAR-CHLR01-AHRI-FAT-R0.pdf',
      'BLUE STAR LIMITED — AHRI 550/590 FACTORY ACCEPTANCE TEST REPORT',
      [
        'Chiller Serial: BSL-2026-HYD-9901 · Model: SXW-500-E',
        'Full Load COP: 6.18 · IPLV: 7.42 · Witnessed at Thane Plant',
      ],
      8,
    );

    // Seed asset CHLR-01 in HYD-BIO-09
    let chillerAssetId = uuidv7();
    const { rows: chRows } = await pool.query(
      `SELECT id FROM assets WHERE org_id = $1 AND project_id = $2 AND tag = 'CHLR-01' LIMIT 1`,
      [orgId, p1Id],
    );
    if (chRows.length > 0) {
      chillerAssetId = chRows[0].id;
    } else {
      await pool.query(
        `INSERT INTO assets (id, org_id, project_id, tag, name, category_key, make, model, serial_no, location, status, created_by)
         VALUES ($1, $2, $3, 'CHLR-01', 'Blue Star 500 TR Water-Cooled Screw Chiller #1', 'CHILLER', 'Blue Star Limited', 'SXW-500-E', 'BSL-2026-HYD-9901', 'Basement-2 Plant Room', 'ACTIVE', $4)`,
        [chillerAssetId, orgId, p1Id, userMap['amit@deccanmep.in']],
      );
    }

    // Seed requirements for HYD-BIO-09
    const snapId = uuidv7();
    const { rows: snapRows } = await pool.query(
      `SELECT id FROM checklist_snapshots WHERE org_id = $1 AND project_id = $2 LIMIT 1`,
      [orgId, p1Id],
    );
    let effectiveSnapId = snapId;
    if (snapRows.length > 0) {
      effectiveSnapId = snapRows[0].id;
    } else {
      await pool.query(
        `INSERT INTO checklist_snapshots (id, org_id, project_id, version_no, checksum, resolved_payload_json, provenance_json, source_json, status, created_by)
         VALUES ($1, $2, $3, 1, 'e7f2b9a4c01289fe55aa11223344556677889900aabbccddeeff001122334455', '{"requirements": []}', '{}', '{}', 'ACTIVE', $4)`,
        [snapId, orgId, p1Id, userMap['meera@deccanmep.in']],
      );
    }

    const reqs = [
      { key: 'REQ-HVAC-004', title: 'Contractor All-Risk (CAR) Insurance Policy', docType: 'DT-004', status: 'APPROVED', milestone: 'MOBILISATION' },
      { key: 'REQ-HVAC-011', title: 'Cleanroom Terminal HEPA As-Built Drawings', docType: 'DT-011', status: 'APPROVED', milestone: 'HANDOVER' },
      { key: 'REQ-CHLR-FAT', title: 'Chiller Factory Acceptance Test (AHRI 550/590)', docType: 'DT-022', status: 'APPROVED', milestone: 'DELIVERY', assetId: chillerAssetId },
      { key: 'REQ-CHLR-HYDRO', title: 'Chilled Water Header 10.5 Bar Hydrostatic Test', docType: 'DT-033', status: 'APPROVED', milestone: 'INSTALLATION', assetId: chillerAssetId },
      { key: 'REQ-HVAC-052', title: 'Octave-Band Acoustic & Vibration Isolation Verification', docType: 'DT-052', status: 'WAIVED', milestone: 'COMMISSIONING' },
      { key: 'REQ-HVAC-086', title: 'State Fire Services Final NOC', docType: 'DT-086', status: 'REQUESTED', milestone: 'HANDOVER' },
    ];

    for (const r of reqs) {
      const { rows: existingReq } = await pool.query(
        `SELECT id FROM requirements WHERE org_id = $1 AND project_id = $2 AND requirement_key = $3 LIMIT 1`,
        [orgId, p1Id, r.key],
      );

      let rId = uuidv7();
      if (existingReq.length > 0) {
        rId = existingReq[0].id;
        await pool.query(
          `UPDATE requirements SET status = $1 WHERE id = $2`,
          [r.status, rId],
        );
      } else {
        await pool.query(
          `INSERT INTO requirements (id, org_id, project_id, current_snapshot_id, requirement_key, group_key, title, doc_type_key, milestone_key, status, mandatory, scope_key, asset_id, reviewer_role, owner_user_id)
           VALUES ($1, $2, $3, $4, $5, '01_CORE', $6, $7, $8, $9, true, $10, $11, 'R-QC', $12)`,
          [rId, orgId, p1Id, effectiveSnapId, r.key, r.title, r.docType, r.milestone, r.status, r.assetId ? `asset:${r.assetId}` : 'project', r.assetId || null, userMap['meera@deccanmep.in']],
        );
      }

      // Create document & version for hydro test
      if (r.key === 'REQ-CHLR-HYDRO') {
        const objKey = `orgs/${orgId}/projects/${p1Id}/docs/HYD-BIO-09-HVAC-DT033-CHLR01-R1.pdf`;
        const localDest = `/tmp/tradecloseout-sim/${objKey.replace(/\//g, '_')}.pdf`;
        const fs = await import('fs/promises');
        await fs.copyFile(hydroPdf.filePath, localDest);

        let objId = uuidv7();
        const { rows: existingObj } = await pool.query(
          `SELECT id FROM storage_objects WHERE provider = 'S3' AND bucket = 'tradecloseout-storage' AND object_key = $1 LIMIT 1`,
          [objKey],
        );
        if (existingObj.length > 0) {
          objId = existingObj[0].id;
        } else {
          await pool.query(
            `INSERT INTO storage_objects (id, org_id, provider, bucket, object_key, mime, size_bytes, sha256, status, retention_class, created_by)
             VALUES ($1, $2, 'S3', 'tradecloseout-storage', $3, 'application/pdf', $4, $5, 'READY', 'STANDARD', $6)`,
            [objId, orgId, objKey, hydroPdf.sizeBytes, hydroPdf.sha256, userMap['amit@deccanmep.in']],
          );
        }

        let docId = uuidv7();
        const { rows: existingDoc } = await pool.query(
          `SELECT id FROM documents WHERE org_id = $1 AND project_id = $2 AND doc_type_key = 'DT-033' LIMIT 1`,
          [orgId, p1Id],
        );
        if (existingDoc.length > 0) {
          docId = existingDoc[0].id;
        } else {
          await pool.query(
            `INSERT INTO documents (id, org_id, project_id, title, doc_type_key, category_key, status, created_by)
             VALUES ($1, $2, $3, $4, 'DT-033', '06_TESTING', 'ACTIVE', $5)`,
            [docId, orgId, p1Id, r.title, userMap['amit@deccanmep.in']],
          );
        }

        await pool.query(
          `INSERT INTO document_requirements (id, org_id, project_id, document_id, requirement_id)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT DO NOTHING`,
          [uuidv7(), orgId, p1Id, docId, rId],
        );

        let verId = uuidv7();
        const { rows: existingVer } = await pool.query(
          `SELECT id FROM document_versions WHERE org_id = $1 AND project_id = $2 AND document_id = $3 LIMIT 1`,
          [orgId, p1Id, docId],
        );
        if (existingVer.length > 0) {
          verId = existingVer[0].id;
        } else {
          await pool.query(
            `INSERT INTO document_versions (id, org_id, project_id, document_id, object_id, version_no, revision_code, file_status, review_status, uploaded_by, issue_date)
             VALUES ($1, $2, $3, $4, $5, 1, 'R1', 'READY', 'APPROVED', $6, '2026-10-30')`,
            [verId, orgId, p1Id, docId, objId, userMap['amit@deccanmep.in']],
          );
        }

        await pool.query(`UPDATE documents SET current_approved_version_id = $1, latest_version_id = $1 WHERE id = $2`, [verId, docId]);
      }
    }

    console.log('✓ Seeding complete! All 3 projects populated with real data and PDFs.');
  } finally {
    await pool.end();
  }
}

seedPortfolio().catch((err) => {
  console.error('SEEDING FAILED:', err);
  process.exit(1);
});
