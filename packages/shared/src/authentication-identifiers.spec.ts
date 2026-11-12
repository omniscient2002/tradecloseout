import { canonicalAuthenticationEmail, canonicalAuthenticationPhone, isSafeIdentityName } from './validators';

describe('G01-016 canonical authentication identities',()=>{
  it('uses one case/IDNA representation without guessing another contact',()=>{
    expect(canonicalAuthenticationEmail(' User+tag@BÜCHER.example ')).toBe('user+tag@xn--bcher-kva.example');
    expect(canonicalAuthenticationEmail('user+tag@xn--bcher-kva.example')).toBe('user+tag@xn--bcher-kva.example');
    expect(canonicalAuthenticationPhone(' +919876543210 ')).toBe('+919876543210');
  });
  it.each([null,[],{},true,123,'a..b@example.test','.a@example.test','a.@example.test',
    'a@%65xample.test','a@example.test/path','a@example.test:443','a@example.test\u0000',
    'a@exam\u200bple.test','a@-example.test','a@example..test','x'.repeat(65)+'@example.test'])
    ('rejects malformed email without JavaScript coercion (case %#)',value=>{
      expect(canonicalAuthenticationEmail(value)).toBeNull();
    });
  it.each([null,[],{},123,'9876543210','+911234567890','+919876543210\r','+91 9876543210','+91987654321\u200b0'])
    ('rejects malformed phone (case %#)',value=>{expect(canonicalAuthenticationPhone(value)).toBeNull();});
  it('allows real Unicode names but rejects controls and unpaired surrogates',()=>{
    expect(isSafeIdentityName('శ్రీ వినాయక',120)).toBe(true);
    expect(isSafeIdentityName('name\u0000suffix',120)).toBe(false);
    expect(isSafeIdentityName('name\ud800suffix',120)).toBe(false);
  });
});
