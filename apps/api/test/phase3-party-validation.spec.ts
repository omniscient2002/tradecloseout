import { BadRequestException } from '@nestjs/common';
import { normalizeCreateParty, PartiesService } from '../src/modules/parties/parties.service';

describe('PH3-G04-001: counterparty validation', () => {
  it('accepts multiple declared party roles and canonical contact fields', () => {
    expect(normalizeCreateParty({
      name: '  Example Engineering ',
      types: ['CLIENT', 'CONSULTANT'],
      email: ' Info@Example.COM ',
      phone: '+91 9876543210',
    })).toEqual({
      name: 'Example Engineering',
      types: ['CLIENT', 'CONSULTANT'],
      gstin: undefined,
      email: 'info@example.com',
      phone: '+91 9876543210',
    });
  });

  it('preserves legacy supplier default when type was omitted', () => {
    expect(normalizeCreateParty({ name: 'Trusted Supplier' }).types).toEqual(['SUPPLIER_OEM']);
  });

  it.each([
    null,
    [],
    { name: 'A', types: ['CLIENT'] },
    { name: 'Valid Company', types: ['UNKNOWN_SUPPLIER_TYPE'] },
    { name: 'Valid Company', types: [] },
    { name: 'Valid Company', types: ['CLIENT', 'CLIENT'] },
    { name: 'Valid Company', types: 'CLIENT' },
    { name: 'Valid Company', types: ['CLIENT'], email: 'not-an-address' },
    { name: 'Valid Company', types: ['CLIENT'], email: 123 },
    { name: 'Valid Company', types: ['CLIENT'], phone: 'call me' },
    { name: 'Valid Company', types: ['CLIENT'], phone: 900 },
    { name: 'Valid Company', types: ['CLIENT'], gstin: 'INVALID' },
    { name: 'Valid Company', types: ['CLIENT'], isVerified: true },
  ])('rejects invalid party data before entering a transaction (%#)', (value) => {
    expect(() => normalizeCreateParty(value)).toThrow(BadRequestException);
  });

  it('rejects invalid content before any database operation', async () => {
    const db = { withTenantContext: jest.fn() } as any;
    const service = new PartiesService(db);
    await expect(service.createParty(
      { orgId: 'org', userId: 'user', actorType: 'USER', requestId: 'test' },
      { name: 'Supplier', types: ['FAKE_APPROVER'] },
    )).rejects.toThrow(BadRequestException);
    expect(db.withTenantContext).not.toHaveBeenCalled();
  });
});
