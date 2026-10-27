import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RequireFeature } from '../tenancy/require-feature.decorator.js';
import { pageArgs, pageQuerySchema, toPage } from './pagination.js';
import { startOfLocalDay } from './time.js';
import { zod } from './zod-validation.pipe.js';

const isoDate = z.iso.date();
const listAuditLogsSchema = pageQuerySchema.extend({
  /** e.g. SALE_VOID, PRODUCT_PRICE_BULK_UPDATE */
  action: z.string().trim().max(60).optional(),
  entity: z.string().trim().max(60).optional(),
  entityId: z.string().trim().max(60).optional(),
  userId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
type ListAuditLogsQuery = z.infer<typeof listAuditLogsSchema>;

/** Who did what: voids, price changes, discounts, settings, users, stock … */
@ApiTags('audit-logs')
@ApiBearerAuth()
@RequireFeature('auditLog')
@RequirePermissions('auditLog.view')
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({
    summary:
      'Audit trail, newest first (?action, entity, entityId, userId, from, to)',
  })
  async list(@Query(zod(listAuditLogsSchema)) q: ListAuditLogsQuery) {
    const where: Prisma.AuditLogWhereInput = {
      action: q.action,
      entity: q.entity,
      entityId: q.entityId,
      userId: q.userId,
      createdAt: {
        gte: q.from ? startOfLocalDay(q.from) : undefined,
        lt: q.to
          ? new Date(startOfLocalDay(q.to).getTime() + 86_400_000)
          : undefined,
      },
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, username: true, fullName: true } },
        },
        ...pageArgs(q),
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return toPage(items, total, q);
  }
}
