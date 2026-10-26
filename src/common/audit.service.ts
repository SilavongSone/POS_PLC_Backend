import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type AuditEntry = {
  userId: string | null;
  /** e.g. "SALE_VOID", "PRODUCT_PRICE_BULK_UPDATE" */
  action: string;
  entity: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
};

/** Writes AuditLog rows; pass `tx` to record inside the same transaction as the change. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    await (tx ?? this.prisma).auditLog.create({
      data: {
        userId: entry.userId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        before: toJson(entry.before),
        after: toJson(entry.after),
      },
    });
  }
}

/** Decimal/Date-safe JSON for audit snapshots. */
function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
