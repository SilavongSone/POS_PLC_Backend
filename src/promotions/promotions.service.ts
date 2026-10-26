import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreatePromotionInput,
  UpdatePromotionInput,
} from './promotions.schemas.js';

const include = {
  items: {
    include: {
      product: { select: { id: true, sku: true, name: true } },
      category: { select: { id: true, name: true, slug: true } },
    },
  },
} satisfies Prisma.PromotionInclude;

@Injectable()
export class PromotionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(current?: boolean) {
    const now = new Date();
    return this.prisma.promotion.findMany({
      where: current
        ? {
            isActive: true,
            startsAt: { lte: now },
            OR: [{ endsAt: null }, { endsAt: { gt: now } }],
          }
        : undefined,
      orderBy: [{ isActive: 'desc' }, { startsAt: 'desc' }],
      take: 200,
      include,
    });
  }

  get(id: string) {
    return this.prisma.promotion.findUniqueOrThrow({ where: { id }, include });
  }

  async create(input: CreatePromotionInput, actorId: string) {
    await this.assertTargets(input.targets);
    const { targets, ...data } = input;
    const promo = await this.prisma.promotion.create({
      data: { ...data, items: { create: targets } },
      include,
    });
    await this.audit.log({
      userId: actorId,
      action: 'PROMOTION_CREATE',
      entity: 'Promotion',
      entityId: promo.id,
      after: promo,
    });
    return promo;
  }

  async update(id: string, input: UpdatePromotionInput, actorId: string) {
    const before = await this.get(id);
    const { targets, ...data } = input;
    const start = data.startsAt ?? before.startsAt;
    const end = data.endsAt === undefined ? before.endsAt : data.endsAt;
    if (end && end <= start)
      throw new BadRequestException('Must end after it starts');
    if (
      (data.discountType ?? before.discountType) === 'PERCENT' &&
      Number(data.value ?? before.value) > 100
    ) {
      throw new BadRequestException('A percentage cannot exceed 100');
    }
    if (targets) await this.assertTargets(targets);
    const promo = await this.prisma.$transaction(async (tx) => {
      if (targets) {
        await tx.promotionItem.deleteMany({ where: { promotionId: id } });
        await tx.promotionItem.createMany({
          data: targets.map((t) => ({ ...t, promotionId: id })),
        });
      }
      return tx.promotion.update({ where: { id }, data, include });
    });
    await this.audit.log({
      userId: actorId,
      action: 'PROMOTION_UPDATE',
      entity: 'Promotion',
      entityId: id,
      before,
      after: promo,
    });
    return promo;
  }

  private async assertTargets(targets: CreatePromotionInput['targets']) {
    const productIds = targets.flatMap((t) =>
      'productId' in t ? [t.productId] : [],
    );
    const categoryIds = targets.flatMap((t) =>
      'categoryId' in t ? [t.categoryId] : [],
    );
    const [p, c] = await Promise.all([
      this.prisma.product.count({ where: { id: { in: productIds } } }),
      this.prisma.category.count({ where: { id: { in: categoryIds } } }),
    ]);
    if (p !== new Set(productIds).size || c !== new Set(categoryIds).size) {
      throw new BadRequestException('Unknown product or category in targets');
    }
  }
}
