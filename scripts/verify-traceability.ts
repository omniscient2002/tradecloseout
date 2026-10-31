// scripts/verify-traceability.ts
// Mandatory CI Requirement-to-Test Traceability Gate (AUD-T-02, Blueprint §12.2)

import fs from 'node:fs';
import path from 'node:path';
import glob from 'fast-glob';

const specPath = path.resolve(__dirname, '../03-PRODUCT-REQUIREMENTS.md');
if (!fs.existsSync(specPath)) {
  console.error(`[FAIL] Spec file not found at ${specPath}`);
  process.exit(1);
}

const specContent = fs.readFileSync(specPath, 'utf8');

// Extract all FR-* and NFR-* IDs defined in 03-PRODUCT-REQUIREMENTS.md
const definedIds = new Set<string>();
const idRegex = /\b((?:N?FR)-[A-Z]+-\d{3})\b/g;
let match: RegExpExecArray | null;
while ((match = idRegex.exec(specContent)) !== null) {
  definedIds.add(match[1]);
}

// Scan all test files for requirement IDs / @traces annotations
const testFiles = glob.sync(['apps/api/test/**/*.spec.ts', 'apps/web/e2e/**/*.spec.ts', 'packages/**/*.spec.ts'], {
  cwd: path.resolve(__dirname, '..'),
  absolute: true,
});

const coveredIds = new Set<string>();

for (const file of testFiles) {
  const content = fs.readFileSync(file, 'utf8');
  let testMatch: RegExpExecArray | null;
  const fileRegex = /\b((?:N?FR)-[A-Z]+-\d{3})\b/g;
  while ((testMatch = fileRegex.exec(content)) !== null) {
    coveredIds.add(testMatch[1]);
  }
}

const missing = [...definedIds].filter((id) => !coveredIds.has(id));
if (missing.length > 0) {
  console.error(`[FAIL] ${missing.length} of ${definedIds.size} requirements have no mapped test:`, missing);
  process.exit(1);
}

console.log(`[PASS] All ${definedIds.size} requirements are covered by automated tests.`);
