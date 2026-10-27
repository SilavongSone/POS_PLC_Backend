import { z } from 'zod';
import { PERMISSIONS } from '../common/permissions.js';

/** Company code (e.g. "plc"); optional when the server has DEFAULT_TENANT_CODE. */
const tenantCode = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,30}$/, 'Invalid company code')
  .optional();

export const loginSchema = z.object({
  tenantCode,
  username: z.string().trim().min(1).max(50),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

const pin = z.string().regex(/^\d{4,6}$/, 'PIN must be 4–6 digits');

export const pinLoginSchema = z.object({
  tenantCode,
  username: z.string().trim().min(1).max(50),
  pin,
});
export type PinLoginInput = z.infer<typeof pinLoginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1).max(200),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(200),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const setPinSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  pin,
});
export type SetPinInput = z.infer<typeof setPinSchema>;

export const approveSchema = z
  .object({
    username: z.string().trim().min(1).max(50),
    pin: pin.optional(),
    password: z.string().min(1).max(200).optional(),
    permission: z.enum(PERMISSIONS),
  })
  .refine((v) => Boolean(v.pin) !== Boolean(v.password), {
    message: 'Send either pin or password',
    path: ['pin'],
  });
export type ApproveInput = z.infer<typeof approveSchema>;
