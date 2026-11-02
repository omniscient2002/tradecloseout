import { readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';

/**
 * Milestone M3 Build Gate Tool (TRADECLOSEOUT-MASTER-PROMPT.md §0 Rule 4 & FR-CHK-015):
 * Ingests a real consultant/main-contractor checklist (JSON/CSV rows from Meinhardt, WSP,
 * AECOM, L&T, Shapoorji, or CPWD), maps each item against DT-001..DT-099, computes
 * coverage percentage, and outputs an L3 ClientProfile override bundle.
 */
export interface ConsultantChecklistRow {
  srNo: string;
  title: string;
  mandatory: boolean;
  stage?: string;
  reviewer?: string;
}

const KEYWORD_TO_DOCTYPE: Array<{ pattern: RegExp; code: string; name: string }> = [
  { pattern: /work order|contract|agreement/i, code: 'DT-001', name: 'Contract / Work Order' },
  { pattern: /boq|bill of quantit|price schedule/i, code: 'DT-002', name: 'BOQ / Price Schedule' },
  { pattern: /bank guarantee|pbg|abg/i, code: 'DT-003', name: 'Performance Bank Guarantee' },
  { pattern: /insurance|car policy|workmen/i, code: 'DT-004', name: 'Insurance Certificate' },
  { pattern: /labour licence|bocw|clra/i, code: 'DT-005', name: 'Labour Registration / Licence' },
  { pattern: /shop drawing|working drawing/i, code: 'DT-010', name: 'Shop Drawing' },
  { pattern: /as-built|as built/i, code: 'DT-011', name: 'As-Built Drawing' },
  { pattern: /equipment schedule/i, code: 'DT-012', name: 'Equipment Schedule' },
  { pattern: /datasheet|technical sub|catalog/i, code: 'DT-013', name: 'Manufacturer Technical Datasheet' },
  { pattern: /material submittal|mas|mar/i, code: 'DT-014', name: 'Material Submittal' },
  { pattern: /method statement|mos/i, code: 'DT-016', name: 'Method Statement' },
  { pattern: /itp|inspection and test plan/i, code: 'DT-017', name: 'Inspection and Test Plan' },
  { pattern: /purchase order|\bpo\b/i, code: 'DT-020', name: 'Purchase Order' },
  { pattern: /mir|material inspection/i, code: 'DT-021', name: 'Material Inspection Report' },
  { pattern: /fat|factory acceptance/i, code: 'DT-022', name: 'Factory Acceptance Test' },
  { pattern: /tpi|third party inspection/i, code: 'DT-023', name: 'Third-Party Inspection Report' },
  { pattern: /mtc|mill test|material test cert/i, code: 'DT-024', name: 'Material Test Certificate' },
  { pattern: /calibration|nabl/i, code: 'DT-025', name: 'Calibration Certificate' },
  { pattern: /warranty cert/i, code: 'DT-026', name: 'Warranty Certificate' },
  { pattern: /guarantee|undertaking/i, code: 'DT-027', name: 'Guarantee / Undertaking' },
  { pattern: /spare part/i, code: 'DT-028', name: 'Spare Parts List' },
  { pattern: /installation checklist/i, code: 'DT-031', name: 'Installation Checklist' },
  { pattern: /weld|brazing/i, code: 'DT-032', name: 'Weld / Brazing Log' },
  { pattern: /hydrostatic|pressure test/i, code: 'DT-033', name: 'Pressure / Hydrostatic Test Report' },
  { pattern: /refrigerant leak|nitrogen pressure|vacuum/i, code: 'DT-034', name: 'Refrigerant Leak Test Report' },
  { pattern: /duct leak|light test|smoke test/i, code: 'DT-035', name: 'Duct Leakage Test Report' },
  { pattern: /flushing|passivation|chemical clean/i, code: 'DT-036', name: 'Pipe Flushing Record' },
  { pattern: /insulation/i, code: 'DT-037', name: 'Insulation Record' },
  { pattern: /fire damper/i, code: 'DT-039', name: 'Fire Damper Test Record' },
  { pattern: /snag|punch list/i, code: 'DT-042', name: 'Snag / Punch List' },
  { pattern: /megger|earthing|electrical test/i, code: 'DT-043', name: 'Electrical Test Report' },
  { pattern: /bms point|io schedule/i, code: 'DT-045', name: 'BMS Point Schedule' },
  { pattern: /point-to-point|p2p/i, code: 'DT-046', name: 'Point-to-Point Controls Checkout' },
  { pattern: /pre-commissioning/i, code: 'DT-048', name: 'Pre-Commissioning Checklist' },
  { pattern: /commissioning report/i, code: 'DT-049', name: 'Commissioning Report' },
  { pattern: /\btab\b|air balancing|water balancing/i, code: 'DT-050', name: 'TAB Report' },
  { pattern: /performance test|capacity test/i, code: 'DT-051', name: 'Performance Test Report' },
  { pattern: /noise|vibration|acoustic/i, code: 'DT-052', name: 'Noise and Vibration Report' },
  { pattern: /water quality/i, code: 'DT-054', name: 'Water Quality Report' },
  { pattern: /iaq|indoor air quality/i, code: 'DT-055', name: 'Indoor Air Quality Report' },
  { pattern: /ist|integrated system/i, code: 'DT-056', name: 'Integrated Systems Test' },
  { pattern: /room pressure|ach|air change|cleanroom/i, code: 'DT-057', name: 'Room Pressure / ACH Verification' },
  { pattern: /o&m|operation and maintenance/i, code: 'DT-058', name: 'O&M Manual' },
  { pattern: /ppm|maintenance schedule/i, code: 'DT-060', name: 'Maintenance Schedule' },
  { pattern: /training/i, code: 'DT-061', name: 'Training Record' },
  { pattern: /completion certificate|toc|virtual completion/i, code: 'DT-062', name: 'Completion Certificate' },
  { pattern: /handover register|transmittal/i, code: 'DT-063', name: 'Handover Register' },
  { pattern: /asset register|equipment register/i, code: 'DT-064', name: 'Asset Register' },
  { pattern: /dlp|defect liability/i, code: 'DT-068', name: 'DLP Closure Certificate' },
  { pattern: /fire noc/i, code: 'DT-086', name: 'Fire NOC' },
  { pattern: /ceig|electrical inspector/i, code: 'DT-087', name: 'Electrical Inspectorate Certificate' },
  { pattern: /no-demand|no claim|ndc/i, code: 'DT-097', name: 'No-Demand Certificate' },
  { pattern: /make deviation/i, code: 'DT-098', name: 'Approved Make Deviation Approval' },
  { pattern: /igbc|griha|leed|green building/i, code: 'DT-099', name: 'Green Building Submittal' },
];

export function reconcileConsultantChecklist(
  consultantName: string,
  rows: ConsultantChecklistRow[],
) {
  const mapped: Array<{ row: ConsultantChecklistRow; matchedCode: string; matchedName: string }> = [];
  const unmapped: ConsultantChecklistRow[] = [];

  for (const r of rows) {
    const hit = KEYWORD_TO_DOCTYPE.find((k) => k.pattern.test(r.title));
    if (hit) {
      mapped.push({ row: r, matchedCode: hit.code, matchedName: hit.name });
    } else {
      unmapped.push(r);
    }
  }

  const coveragePct = rows.length > 0 ? Number(((mapped.length / rows.length) * 100).toFixed(1)) : 100;
  const l3ClientProfile = {
    profileName: `${consultantName} — Validated L3 Handover Profile`,
    schemaVersion: 'v1.0',
    coveragePct,
    passesA002HypothesisThreshold: coveragePct >= 70, // A-002 requires >= 70% coverage without code
    payload: {
      'checklist.requirements': [
        ...mapped.map((m) => ({
          key: `REQ-${m.matchedCode.replace('-', '')}`,
          title: m.row.title,
          docTypeKey: m.matchedCode,
          mandatory: m.row.mandatory,
        })),
        ...unmapped.map((u, idx) => ({
          key: `REQ-CUSTOM-${idx + 1}`,
          title: u.title,
          docTypeKey: 'DT-CUSTOM',
          mandatory: u.mandatory,
        })),
      ],
    },
  };

  return {
    consultantName,
    totalItems: rows.length,
    mappedCount: mapped.length,
    unmappedCount: unmapped.length,
    coveragePct,
    passesM3Gate: coveragePct >= 70,
    l3ClientProfile,
    checksum: createHash('sha256').update(JSON.stringify(l3ClientProfile)).digest('hex'),
  };
}

if (require.main === module) {
  const sampleMeinhardtChecklist: ConsultantChecklistRow[] = [
    { srNo: '1', title: 'Signed Work Order & Priced BOQ Schedule', mandatory: true },
    { srNo: '2', title: 'Contractor All-Risk (CAR) Insurance & Workmen Compensation', mandatory: true },
    { srNo: '3', title: 'Approved Coordinated As-Built Drawings (Redline + CAD/PDF)', mandatory: true },
    { srNo: '4', title: 'Water-Cooled Chiller AHRI 550/590 Factory Acceptance Test (FAT)', mandatory: true },
    { srNo: '5', title: 'Chilled Water Piping Hydrostatic Pressure Test (1.5x Working Pressure)', mandatory: true },
    { srNo: '6', title: 'GI Ductwork DW-144 Air Leakage Test Reports', mandatory: true },
    { srNo: '7', title: 'NABL Calibration Certificates for All Master Pressure & TAB Gauges', mandatory: true },
    { srNo: '8', title: 'NEBB / AABC Air & Hydronic Testing, Adjusting & Balancing (TAB) Report', mandatory: true },
    { srNo: '9', title: 'Cleanroom Differential Pressure & Air Changes Per Hour (ACH) Report', mandatory: true },
    { srNo: '10', title: 'Project-Specific Operation & Maintenance (O&M) Manual & PPM Schedule', mandatory: true },
    { srNo: '11', title: 'OEM 5-Year Compressor Warranty Certificate & Start Confirmation', mandatory: true },
    { srNo: '12', title: 'Client O&M Engineering Staff Training Attendance Record', mandatory: true },
    { srNo: '13', title: 'No-Demand Certificate (NDC) & Final Bill Undertaking', mandatory: true },
  ];

  const report = reconcileConsultantChecklist('Meinhardt Singapore (India Branch)', sampleMeinhardtChecklist);
  console.log(
    `✓ Milestone M3 Reconciler: ${report.mappedCount}/${report.totalItems} mapped (${report.coveragePct}% coverage — Gate Passed: ${report.passesM3Gate})`,
  );
  writeFileSync('/tmp/meinhardt-l3-profile.json', JSON.stringify(report, null, 2));
}
