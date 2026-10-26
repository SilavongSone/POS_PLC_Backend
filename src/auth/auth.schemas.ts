import { z } from 'zod';

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(50),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

const pin = z.string().regex(/^\d{4,6}$/, 'PIN must be 4–6 digits');

export const pinLoginSchema = z.object({
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
