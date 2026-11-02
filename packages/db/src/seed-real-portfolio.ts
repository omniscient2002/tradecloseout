import { Pool } from 'pg';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createHash } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { uuidv7 } from 'uuidv7';

const STORAGE_DIR = '/tmp/tradecloseout-sim';

async function createRealEngineeringPdf(
  objectKey: string,
  title: string,
  lines: string[],
  pageCount = 3,
): Promise<{ sizeBytes: number; sha256: string; pageCount: number }> {
  await mkdir(STORAGE_DIR, { recursive: true });
  const doc = await PDFDocument.create();
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontMono = await doc.embedFont(StandardFonts.Courier);

  for (let p = 1; p <= pageCount; p++) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawRectangle({ x: 0, y: 814, width: 595.28, height: 28, color: rgb(0.06, 0.16, 0.26) });
    page.drawText('DECCAN ENVIROTECH MEP PVT LTD — QUALITY & COMMISSIONING RECORD', {
      x: 40,
      y: 780,
      size: 10,
      font: fontBold,
      color: rgb(0.06, 0.16, 0.26),
    });
    page.drawText(`${title} (Page ${p} of ${pageCount})`, {
      x: 40,
      y: 755,
      size: 13,
      font: fontBold,
    });
    let y = 720;
    for (const line of lines) {
      page.drawText(line, { x: 40, y, size: 9.5, font: fontMono });
      y -= 18;
    }
  }

  const bytes = await doc.save();
  const diskPath = path.join(STORAGE_DIR, `${objectKey.replace(/\//g, '_')}.pdf`);
  await writeFile(diskPath, bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return { sizeBytes: bytes.byteLength, sha256, pageCount };
}

async function seedPortfolio() {
  const pool = new Pool({
    connectionString: process.env.MIGRATOR_DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/tradecloseout',
  });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const orgId = '0192e000-0000-7000-8000-000000000001';
    await client.query(`SELECT set_config('app.current_org', $1, true)`, [orgId]);

    const personas = [
      { id: '0192e000-0000-7000-8000-000000000101', name: 'Vikramaditya Reddy', email: 'vikram@deccanmep.in', phone: '+919848011101', role: 'R-OWNER' },
      { id: '0192e000-0000-7000-8000-000000000102', name: 'Meera Deshmukh', email: 'meera@deccanmep.in', phone: '+919848011102', role: 'R-PM' },
      { id: '0192e000-0000-7000-8000-000000000103', name: 'Karthikeya Sharma', email: 'karthik@deccanmep.in', phone: '+919848011103', role: 'R-QC' },
      { id: '0192e000-0000-7000-8000-000000000104', name: 'Amit Verma', email: 'amit@deccanmep.in', phone: '+919848011104', role: 'R-SITE' },
    ];

    for (const p of personas) {
      await client.query(
        `INSERT INTO users (id, name, status) VALUES ($1, $2, 'ACTIVE') ON CONFLICT (id) DO NOTHING`,
        [p.id, p.name],
      );
      await client.query(
        `INSERT INTO user_identities (id, user_id, type, value, verified_at)
         VALUES ($1, $2, 'EMAIL', $3, now()), ($4, $2, 'PHONE', $5, now())
         ON CONFLICT (type, value) DO NOTHING`,
        [uuidv7(), p.id, p.email, uuidv7(), p.phone],
      );
    }

    await client.query(
      `INSERT INTO organisations (id, legal_name, display_name, entity_type, status, country, state)
       VALUES ($1, 'Deccan EnviroTech MEP Pvt Ltd', 'Deccan EnviroTech MEP', 'PRIVATE_LIMITED', 'ACTIVE', 'IN', 'TS')
       ON CONFLICT (id) DO NOTHING`,
      [orgId],
    );
    await client.query(
      `INSERT INTO org_profiles (org_id, gstin, pan, brand_color, signatory_name, signatory_designation)
       VALUES ($1, '36AABCD4512F1Z4', 'AABCD4512F', '#0F2942', 'Vikramaditya Reddy', 'Managing Director')
       ON CONFLICT (org_id) DO NOTHING`,
      [orgId],
    );

    for (const p of personas) {
      await client.query(
        `INSERT INTO memberships (id, org_id, user_id, role, status)
         VALUES ($1, $2, $3, $4, 'ACTIVE')
         ON CONFLICT (org_id, user_id) DO NOTHING`,
        [uuidv7(), orgId, p.id, p.role],
      );
    }

    const clientPartyId = '0192e000-0000-7000-8000-000000000201';
    const mcPartyId = '0192e000-0000-7000-8000-000000000202';
    const pmcPartyId = '0192e000-0000-7000-8000-000000000203';

    await client.query(
      `INSERT INTO parties (id, org_id, name, types, email, phone, created_by)
       VALUES
         ($1, $4, 'Aurobindo Biologics & Pharma Ltd', ARRAY['CLIENT'], 'projects@aurobindo.in', '+914066721200', $5),
         ($2, $4, 'L&T Construction (B&F Division)', ARRAY['MC'], 'mep.hyd@lntecc.com', '+914066725000', $5),
         ($3, $4, 'Meinhardt Singapore Pte Ltd (India)', ARRAY['CONSULTANT'], 'hvac@meinhardt.in', '+914066728800', $5)
       ON CONFLICT (id) DO NOTHING`,
      [clientPartyId, mcPartyId, pmcPartyId, orgId, personas[1]!.id],
    );

    const projectsSeed = [
      {
        id: '0192e000-0000-7000-8000-000000000301',
        code: 'HYD-BIO-09',
        name: 'Genome Valley Sterile Formulation Block-B Cleanroom HVAC',
        status: 'HANDOVER',
        valuePaise: 1450000000n,
        retentionBps: 500,
        handoverDate: '2026-11-20',
      },
      {
        id: '0192e000-0000-7000-8000-000000000302',
        code: 'HYD-IT-04',
        name: 'Knowledge City Raidurg Tower-3 High-Side Chiller & VRF Plant',
        status: 'ACTIVE',
        valuePaise: 2280000000n,
        retentionBps: 500,
        handoverDate: '2026-12-15',
      },
      {
        id: '0192e000-0000-7000-8000-000000000303',
        code: 'SEC-HOSP-02',
        name: 'AIG Multi-Specialty Hospital OT & ICU Cleanroom Ventilation',
        status: 'CLOSED',
        valuePaise: 840000000n,
        retentionBps: 500,
        handoverDate: '2026-10-15',
      },
    ];

    for (const prj of projectsSeed) {
      await client.query(
        `INSERT INTO projects
          (id, org_id, code, name, client_party_id, mc_party_id, consultant_party_id,
           status, target_handover_date, contract_value_paise, retention_bps, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id) DO NOTHING`,
        [
          prj.id,
          orgId,
          prj.code,
          prj.name,
          clientPartyId,
          mcPartyId,
          pmcPartyId,
          prj.status,
          prj.handoverDate,
          prj.valuePaise.toString(),
          prj.retentionBps,
          personas[1]!.id,
        ],
      );

      const snapId = uuidv7();
      await client.query(
        `INSERT INTO checklist_snapshots (id, org_id, project_id, version_no, status, checksum, created_by)
         VALUES ($1, $2, $3, 1, 'ACTIVE', $4, $5)`,
        [snapId, orgId, prj.id, createHash('sha256').update(prj.code).digest('hex'), personas[1]!.id],
      );

      const assetId = uuidv7();
      await client.query(
        `INSERT INTO assets (id, org_id, project_id, tag, name, category_key, make, model, serial_no, location, created_by)
         VALUES ($1, $2, $3, 'CHLR-01', 'Blue Star 500 TR Water-Cooled Screw Chiller #1', 'CHILLER',
                 'Blue Star Ltd', 'SXW-500-E', 'BSL-2026-HYD-9901', 'Basement-2 Plant Room', $4)`,
        [assetId, orgId, prj.id, personas[3]!.id],
      );

      const reqId = uuidv7();
      await client.query(
        `INSERT INTO requirements
          (id, org_id, project_id, current_snapshot_id, requirement_key, asset_id, scope_key,
           milestone_key, group_key, title, doc_type_key, mandatory, owner_user_id, reviewer_role, due_at, status)
         VALUES ($1, $2, $3, $4, 'REQ-HVAC-033', $5, $6, 'COMMISSIONING', '06_TESTING',
                 'Chilled Water Header & Shell Hydrostatic Pressure Test Report (10.5 Bar)',
                 'DT-033', true, $7, 'R-QC', '2026-11-10', 'IN_REVIEW')`,
        [reqId, orgId, prj.id, snapId, assetId, `asset:${assetId}`, personas[3]!.id],
      );

      const docId = uuidv7();
      const verId = uuidv7();
      const objId = uuidv7();
      const objectKey = `org/${orgId}/project/${prj.id}/doc/${docId}/v1/${objId}`;

      const pdfMeta = await createRealEngineeringPdf(
        objectKey,
        `${prj.code} — HYDROSTATIC PRESSURE TEST CERTIFICATE (10.5 BAR)`,
        [
          `Project: ${prj.code} (${prj.name})`,
          'Equipment Tag: CHLR-01 (Blue Star 500 TR Water-Cooled Screw Chiller)',
          'Serial Number: BSL-2026-HYD-9901 · Location: Basement-2 Utility Plant',
          'Working Pressure: 6.8 Bar (g) · Hydrostatic Test Pressure: 10.5 Bar (g)',
          'Hold Duration: 4.0 Hours Continuous · Observed Drop: 0.00 Bar (PASS)',
          'Master Gauge: WIKA PG-NABL-409 (Vimta Labs NABL Certificate Attached)',
          'Tested By: Amit Verma (Site Engineer) · Witnessed By: Meinhardt PMC',
        ],
        4,
      );

      await client.query(
        `INSERT INTO storage_objects (id, org_id, bucket, object_key, mime, size_bytes, sha256, status, created_by)
         VALUES ($1, $2, 'tc-private-uploads', $3, 'application/pdf', $4, $5, 'READY', $6)`,
        [objId, orgId, objectKey, pdfMeta.sizeBytes.toString(), pdfMeta.sha256, personas[3]!.id],
      );

      await client.query(
        `INSERT INTO documents (id, org_id, project_id, title, doc_type_key, status, latest_version_id, created_by)
         VALUES ($1, $2, $3, 'CHLR-01 Hydrostatic Pressure Test Report', 'DT-033', 'ACTIVE', $4, $5)`,
        [docId, orgId, prj.id, verId, personas[3]!.id],
      );

      await client.query(
        `INSERT INTO document_versions
          (id, org_id, project_id, document_id, version_no, revision_code, object_id,
           file_status, review_status, issue_date, page_count, uploaded_by)
         VALUES ($1, $2, $3, $4, 1, 'R1', $5, 'READY', 'IN_REVIEW', '2026-10-31', $6, $7)`,
        [verId, orgId, prj.id, docId, objId, pdfMeta.pageCount, personas[3]!.id],
      );

      await client.query(
        `INSERT INTO document_requirements (id, org_id, project_id, document_id, requirement_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [uuidv7(), orgId, prj.id, docId, reqId],
      );
    }

    await client.query('COMMIT');
    console.log('✓ Seeded Deccan EnviroTech MEP Pvt Ltd, 4 Personas, 3 Commercial Projects & Real Binary PDFs.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seedPortfolio().catch((err) => {
  console.error(err);
  process.exit(1);
});
