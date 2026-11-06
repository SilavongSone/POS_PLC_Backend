import { contactSchema, toInternationalPhone } from './contact.js';

describe('contact', () => {
  it('stores Lao numbers with the country code', () => {
    expect(toInternationalPhone('020 5555 1234')).toBe('+8562055551234');
    expect(toInternationalPhone('20 5555 1234')).toBe('+8562055551234');
    expect(toInternationalPhone('856 20 5555 1234')).toBe('+8562055551234');
    expect(toInternationalPhone('+856-21-212-345')).toBe('+85621212345');
    expect(toInternationalPhone('0066 81 234 5678')).toBe('+66812345678');
    expect(toInternationalPhone('12')).toBeNull();
    expect(toInternationalPhone('')).toBeNull();
  });

  it('accepts empty channels and refuses bad links', () => {
    expect(contactSchema.parse({}).facebookUrl).toBe('');
    expect(contactSchema.parse({ whatsapp: '020 5555 1234' }).whatsapp).toBe(
      '+8562055551234',
    );
    expect(
      contactSchema.safeParse({ facebookUrl: 'facebook.com/plc' }).success,
    ).toBe(false);
    expect(contactSchema.safeParse({ email: 'no-at' }).success).toBe(false);
    expect(contactSchema.safeParse({ phone: '12' }).success).toBe(false);
  });
});
