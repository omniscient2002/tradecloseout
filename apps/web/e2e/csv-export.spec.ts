import { test, expect } from '@playwright/test';
import { serializeCsv } from '../src/lib/csv-export';

test('CSV preserves Unicode, delimiters, newlines, reserved URL characters and quotes', () => {
  const content = serializeCsv(['Name', 'Notes'], [
    ['తెలుగు #100% & plant', 'Line 1, "quoted"\r\nLine 2'],
    ['Apostrophe\'s', 'plus + hash # %'],
  ]);
  expect(content).toBe('"Name","Notes"\r\n"తెలుగు #100% & plant","Line 1, ""quoted""\r\nLine 2"\r\n"Apostrophe\'s","plus + hash # %"\r\n');
});

test('CSV neutralizes formula-leading untrusted strings, including whitespace/control prefixes', () => {
  const content = serializeCsv(['=heading', 'Text'], [
    ['=HYPERLINK("https://attacker")', ' \t+SUM(1,2)'],
    ['-1+2', '@CMD'],
    ['+10', '=1+1'],
    [12.5, -100],
  ]);
  expect(content).toContain('"\'=heading"');
  expect(content).toContain('"\'=HYPERLINK(""https://attacker"")"');
  expect(content).toContain('"\' \t+SUM(1,2)"');
  expect(content).toContain('"\'-1+2","\'@CMD"');
  expect(content).toContain('"\'+10","\'=1+1"');
  expect(content).toContain('"12.5","-100"');
});

test('CSV rejects malformed shape and non-finite numbers', () => {
  expect(() => serializeCsv(['A', 'B'], [['one']])).toThrow('CSV_EXPORT_COLUMN_MISMATCH');
  expect(() => serializeCsv(['A'], [[Infinity]])).toThrow('CSV_EXPORT_INVALID_NUMBER');
});
