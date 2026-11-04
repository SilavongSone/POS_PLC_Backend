import { z } from 'zod';

export const firstNameSchema = z.string().trim().min(1).max(60);
export const lastNameSchema = z.string().trim().max(60).nullable();

export type PersonName = {
  firstName: string;
  lastName: string | null;
  /** "firstName lastName" (Lao order: given name first). */
  fullName: string;
};

/** Name columns from a given and a family name. */
export function personName(first: string, last?: string | null): PersonName {
  const firstName = first.trim();
  const lastName = last?.trim() || null;
  return {
    firstName,
    lastName,
    fullName: lastName ? `${firstName} ${lastName}` : firstName,
  };
}

/**
 * Name columns for a create/update: from firstName/lastName (merged with the saved ones),
 * or a whole fullName from older clients. Undefined = name unchanged.
 */
export function nameFromInput(
  input: { firstName?: string; lastName?: string | null; fullName?: string },
  before?: { firstName: string | null; lastName: string | null; fullName: string },
): PersonName | undefined {
  if (input.firstName !== undefined || input.lastName !== undefined) {
    return personName(
      input.firstName ?? before?.firstName ?? before?.fullName ?? '',
      input.lastName !== undefined ? input.lastName : before?.lastName,
    );
  }
  if (input.fullName !== undefined)
    return { firstName: input.fullName, lastName: null, fullName: input.fullName };
  return undefined;
}
