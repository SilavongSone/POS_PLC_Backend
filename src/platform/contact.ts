import { z } from 'zod';

/**
 * How shops and visitors reach PLC (sales and support), set by the Super Admin and shown on
 * the website, the sign-in pages and inside the app. Empty = not shown.
 */
export const CONTACT_KEY = 'contact';

/**
 * Phone numbers are stored in international form (+856…): staff type them the Lao way
 * ("020 5555 5555", "856 20 …") and links such as tel: and wa.me need the country code.
 */
export function toInternationalPhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  // Lao numbers: 020 / 030 mobiles and 021 landlines, typed with the leading 0.
  else if (digits.startsWith('0')) digits = `856${digits.slice(1)}`;
  else if (/^(20|30|21)\d{7,8}$/.test(digits)) digits = `856${digits}`;
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}

const phone = z
  .string()
  .trim()
  .max(30)
  .transform((v, ctx) => {
    if (!v) return '';
    const out = toInternationalPhone(v);
    if (!out) {
      ctx.addIssue({ code: 'custom', message: 'Phone number: 8-15 digits' });
      return z.NEVER;
    }
    return out;
  });
const link = z
  .string()
  .trim()
  .max(300)
  .refine((v) => !v || /^https:\/\/\S+$/i.test(v), 'Link must start with https://');
const text = (max: number) => z.string().trim().max(max);

export const contactSchema = z.object({
  /** Main number for calls. */
  phone: phone.default(''),
  /** A second line (sales / support). */
  phone2: phone.default(''),
  /** WhatsApp number (often the same as the phone). */
  whatsapp: phone.default(''),
  facebookUrl: link.default(''),
  messengerUrl: link.default(''),
  lineUrl: link.default(''),
  tiktokUrl: link.default(''),
  youtubeUrl: link.default(''),
  email: z
    .string()
    .trim()
    .max(150)
    .refine((v) => !v || z.email().safeParse(v).success, 'E-mail address')
    .default(''),
  address: text(300).default(''),
  mapsUrl: link.default(''),
  /** Opening hours as typed, e.g. "Mon-Sat 8:00-17:00". */
  hours: text(150).default(''),
});
export type Contact = z.output<typeof contactSchema>;

export const EMPTY_CONTACT: Contact = contactSchema.parse({});
