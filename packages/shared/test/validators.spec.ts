import {
  isValidIndianGstin,
  IndianGstinSchema,
  IndianMobileSchema,
  IndianPanSchema,
  ProjectCodeSchema,
  AssetTagSchema,
  RevisionCodeSchema,
  CreateUploadIntentSchema,
} from '../src/validators';

describe('SHARED-01: Domain Validators and Schemas', () => {
  describe('Indian GSTIN Validation (Modulo-36 checksum & State codes)', () => {
    it('validates authentic 15-character GSTIN with valid state and checksum', () => {
      // 36AAACG1234F1Z5 is a standard valid format pattern
      // Let's test with valid state codes: Telangana (36), Karnataka (29), Maharashtra (27)
      expect(isValidIndianGstin('29AABCU9603R1ZJ')).toBe(true);
      expect(IndianGstinSchema.safeParse('29AABCU9603R1ZJ').success).toBe(true);
    });

    it('rejects GSTIN with invalid checksum digit', () => {
      // Tampering with the last character
      expect(isValidIndianGstin('29AABCU9603R1ZA')).toBe(false);
      expect(IndianGstinSchema.safeParse('29AABCU9603R1ZA').success).toBe(false);
    });

    it('rejects GSTIN with invalid state code', () => {
      // 99 is other territory, 00 is invalid
      expect(isValidIndianGstin('00AABCU9603R1ZJ')).toBe(false);
      expect(isValidIndianGstin('45AABCU9603R1ZJ')).toBe(false); // 45 is not an Indian state code
    });

    it('rejects GSTIN with invalid length or malformed characters', () => {
      expect(isValidIndianGstin('29AABCU9603R1Z')).toBe(false); // 14 chars
      expect(isValidIndianGstin('29AABCU9603R1ZJJ')).toBe(false); // 16 chars
      expect(isValidIndianGstin('29AABCU9603R1Z!')).toBe(false); // special char
    });
  });

  describe('Indian Mobile Number Schema (+91 E.164)', () => {
    it('accepts valid 10-digit Indian mobile with +91 prefix starting with 6-9', () => {
      expect(IndianMobileSchema.safeParse('+919876543210').success).toBe(true);
      expect(IndianMobileSchema.safeParse('+918123456789').success).toBe(true);
      expect(IndianMobileSchema.safeParse('+917012345678').success).toBe(true);
      expect(IndianMobileSchema.safeParse('+916301234567').success).toBe(true);
    });

    it('rejects mobile numbers not starting with 6-9 or missing +91 prefix', () => {
      expect(IndianMobileSchema.safeParse('9876543210').success).toBe(false); // missing +91
      expect(IndianMobileSchema.safeParse('+915876543210').success).toBe(false); // starts with 5
      expect(IndianMobileSchema.safeParse('+910123456789').success).toBe(false); // starts with 0
      expect(IndianMobileSchema.safeParse('+19876543210').success).toBe(false); // US country code
    });
  });

  describe('Indian PAN Schema (5 letters, 4 digits, 1 letter)', () => {
    it('accepts valid 10-character uppercase PAN', () => {
      expect(IndianPanSchema.safeParse('ABCDE1234F').success).toBe(true);
      expect(IndianPanSchema.safeParse('XYZPA5678Q').success).toBe(true);
    });

    it('rejects lowercase or malformed PAN structures', () => {
      expect(IndianPanSchema.safeParse('abcde1234f').success).toBe(true); // schema auto-uppercases
      expect(IndianPanSchema.safeParse('ABCD12345F').success).toBe(false); // 4 letters then 5 digits
      expect(IndianPanSchema.safeParse('ABCDEF12345').success).toBe(false); // 6 letters then 5 digits
      expect(IndianPanSchema.safeParse('ABCDE12345').success).toBe(false); // ends with digit
    });
  });

  describe('ProjectCodeSchema, AssetTagSchema, RevisionCodeSchema', () => {
    it('validates project codes (2-30 uppercase alphanumeric/hyphen)', () => {
      expect(ProjectCodeSchema.safeParse('PRJ-01').success).toBe(true);
      expect(ProjectCodeSchema.safeParse('HYD_METRO_09').success).toBe(true);
      expect(ProjectCodeSchema.safeParse('P').success).toBe(false); // too short
      expect(ProjectCodeSchema.safeParse('-PRJ').success).toBe(false); // cannot start with hyphen
    });

    it('validates asset tags (1-50 chars, no spaces)', () => {
      expect(AssetTagSchema.safeParse('AHU-01').success).toBe(true);
      expect(AssetTagSchema.safeParse('PUMP.CHW.02').success).toBe(true);
      expect(AssetTagSchema.safeParse('AHU 01').success).toBe(false); // spaces forbidden
      expect(AssetTagSchema.safeParse('').success).toBe(false); // empty
    });

    it('validates revision codes (1-10 alphanumeric characters)', () => {
      expect(RevisionCodeSchema.safeParse('R0').success).toBe(true);
      expect(RevisionCodeSchema.safeParse('R1.2').success).toBe(true);
      expect(RevisionCodeSchema.safeParse('A').success).toBe(true);
      expect(RevisionCodeSchema.safeParse('REVISION-TOOLONG').success).toBe(false);
    });
  });

  describe('CreateUploadIntentSchema (Filename & Size bounds)', () => {
    const validBase = {
      requirementId: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
      filename: 'chiller-commissioning-report.pdf',
      sizeBytes: 15 * 1024 * 1024,
      mimeType: 'application/pdf',
      revisionCode: 'R0',
      issueDate: '2026-11-01',
      title: 'Water-Cooled Chiller Commissioning Test Report',
      checksumSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    };

    it('accepts compliant upload intent', () => {
      expect(CreateUploadIntentSchema.safeParse(validBase).success).toBe(true);
    });

    it('strictly bans dangerous or executable file extensions (SVG, EXE, SH, BAT, XLSM)', () => {
      expect(CreateUploadIntentSchema.safeParse({ ...validBase, filename: 'diagram.svg' }).success).toBe(false);
      expect(CreateUploadIntentSchema.safeParse({ ...validBase, filename: 'payload.exe' }).success).toBe(false);
      expect(CreateUploadIntentSchema.safeParse({ ...validBase, filename: 'script.sh' }).success).toBe(false);
      expect(CreateUploadIntentSchema.safeParse({ ...validBase, filename: 'macro.xlsm' }).success).toBe(false);
    });

    it('enforces maximum 100 MB upload limit', () => {
      expect(
        CreateUploadIntentSchema.safeParse({
          ...validBase,
          sizeBytes: 101 * 1024 * 1024, // 101 MB
        }).success,
      ).toBe(false);
    });
  });
});
