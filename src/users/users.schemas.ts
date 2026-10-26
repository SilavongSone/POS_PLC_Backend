import { z } from 'zod';
import { ALL_PERMISSIONS, PERMISSIONS } from '../common/permissions.js';
import { pageQuerySchema, queryBoolean } from '../common/pagination.js';

const username = z
  .string()
  .trim()
  .min(3)
  .max(50)
  .regex(/^[a-zA-Z0-9._-]+$/, 'Use letters, digits, dot, dash or underscore');
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(200);
const pin = z.string().regex(/^\d{4,6}$/, 'PIN must be 4–6 digits');

export const listUsersSchema = pageQuerySchema.extend({
  groupId: z.uuid().optional(),
  isActive: queryBoolean.optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersSchema>;

export const createUserSchema = z.object({
  username,
  fullName: z.string().trim().min(1).max(100),
  password,
  groupId: z.uuid(),
  pin: pin.optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    fullName: z.string().trim().min(1).max(100),
    groupId: z.uuid(),
    isActive: z.boolean(),
  })
  .partial();
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const resetPasswordSchema = z.object({ newPassword: password });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const setPinSchema = z.object({ pin });
export type SetPinInput = z.infer<typeof setPinSchema>;

const permissionList = z
  .array(z.enum([ALL_PERMISSIONS, ...PERMISSIONS]))
  .transform((list) => [...new Set(list)]);

export const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(50),
  permissions: permissionList,
});
export type CreateGroupInput = z.infer<typeof createGroupSchema>;

export const updateGroupSchema = createGroupSchema.partial();
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;
