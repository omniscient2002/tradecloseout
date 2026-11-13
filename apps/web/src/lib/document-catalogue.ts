// Existing explicit document classifications shared by checklist entry and import.
export const KEYWORD_RULES: Array<{
  pattern: RegExp;
  code: string;
  name: string;
}> = [
  {
    pattern: /work order|contract|agreement/i,
    code: "DT-001",
    name: "Contract / Work Order",
  },
  {
    pattern: /boq|bill of quantit|price schedule/i,
    code: "DT-002",
    name: "BOQ / Price Schedule",
  },
  {
    pattern: /bank guarantee|pbg|abg/i,
    code: "DT-003",
    name: "Performance Bank Guarantee",
  },
  {
    pattern: /insurance|car policy|workmen/i,
    code: "DT-004",
    name: "Insurance Certificate",
  },
  {
    pattern: /labour licence|bocw|clra/i,
    code: "DT-005",
    name: "Labour Registration / Licence",
  },
  {
    pattern: /shop drawing|working drawing/i,
    code: "DT-010",
    name: "Shop Drawing",
  },
  { pattern: /as-built|as built/i, code: "DT-011", name: "As-Built Drawing" },
  {
    pattern: /equipment schedule/i,
    code: "DT-012",
    name: "Equipment Schedule",
  },
  {
    pattern: /datasheet|technical sub|catalog/i,
    code: "DT-013",
    name: "Manufacturer Technical Datasheet",
  },
  {
    pattern: /material submittal|mas|mar/i,
    code: "DT-014",
    name: "Material Submittal",
  },
  {
    pattern: /method statement|mos/i,
    code: "DT-016",
    name: "Method Statement",
  },
  {
    pattern: /itp|inspection and test plan/i,
    code: "DT-017",
    name: "Inspection and Test Plan",
  },
  { pattern: /purchase order|\bpo\b/i, code: "DT-020", name: "Purchase Order" },
  {
    pattern: /mir|material inspection/i,
    code: "DT-021",
    name: "Material Inspection Report",
  },
  {
    pattern: /fat|factory acceptance/i,
    code: "DT-022",
    name: "Factory Acceptance Test",
  },
  {
    pattern: /tpi|third party inspection/i,
    code: "DT-023",
    name: "Third-Party Inspection Report",
  },
  {
    pattern: /mtc|mill test|material test cert/i,
    code: "DT-024",
    name: "Material Test Certificate",
  },
  {
    pattern: /calibration|nabl/i,
    code: "DT-025",
    name: "Calibration Certificate",
  },
  { pattern: /warranty cert/i, code: "DT-026", name: "Warranty Certificate" },
  {
    pattern: /guarantee|undertaking/i,
    code: "DT-027",
    name: "Guarantee / Undertaking",
  },
  { pattern: /spare part/i, code: "DT-028", name: "Spare Parts List" },
  {
    pattern: /installation checklist/i,
    code: "DT-031",
    name: "Installation Checklist",
  },
  { pattern: /weld|brazing/i, code: "DT-032", name: "Weld / Brazing Log" },
  {
    pattern: /hydrostatic|pressure test/i,
    code: "DT-033",
    name: "Pressure / Hydrostatic Test Report",
  },
  {
    pattern: /refrigerant leak|nitrogen pressure|vacuum/i,
    code: "DT-034",
    name: "Refrigerant Leak Test Report",
  },
  {
    pattern: /duct leak|light test|smoke test/i,
    code: "DT-035",
    name: "Duct Leakage Test Report",
  },
  {
    pattern: /flushing|passivation|chemical clean/i,
    code: "DT-036",
    name: "Pipe Flushing Record",
  },
  { pattern: /fire damper/i, code: "DT-039", name: "Fire Damper Test Record" },
  {
    pattern: /megger|earthing|electrical test/i,
    code: "DT-043",
    name: "Electrical Test Report",
  },
  {
    pattern: /bms point|io schedule/i,
    code: "DT-045",
    name: "BMS Point Schedule",
  },
  {
    pattern: /point-to-point|p2p/i,
    code: "DT-046",
    name: "Point-to-Point Controls Checkout",
  },
  {
    pattern: /commissioning report/i,
    code: "DT-049",
    name: "Commissioning Report",
  },
  {
    pattern: /\btab\b|air balancing|water balancing/i,
    code: "DT-050",
    name: "TAB Report",
  },
  {
    pattern: /noise|vibration|acoustic/i,
    code: "DT-052",
    name: "Noise and Vibration Report",
  },
  {
    pattern: /room pressure|ach|air change|cleanroom/i,
    code: "DT-057",
    name: "Room Pressure / ACH Verification",
  },
  {
    pattern: /o&m|operation and maintenance/i,
    code: "DT-058",
    name: "O&M Manual",
  },
  {
    pattern: /ppm|maintenance schedule/i,
    code: "DT-060",
    name: "Maintenance Schedule",
  },
  { pattern: /training/i, code: "DT-061", name: "Training Record" },
  {
    pattern: /completion certificate|toc|virtual completion/i,
    code: "DT-062",
    name: "Completion Certificate",
  },
  { pattern: /fire noc/i, code: "DT-086", name: "Fire NOC" },
  {
    pattern: /ceig|electrical inspector/i,
    code: "DT-087",
    name: "Electrical Inspectorate Certificate",
  },
  {
    pattern: /no-demand|no claim|ndc/i,
    code: "DT-097",
    name: "No-Demand Certificate",
  },
];

export const DOCUMENT_TYPES = KEYWORD_RULES.map(({ code, name }) => ({
  code,
  name,
}));

export function documentTypeLabel(code?: string | null): string {
  if (!code) return "Not classified";
  return (
    DOCUMENT_TYPES.find((type) => type.code === code)?.name ||
    "Other project document"
  );
}
