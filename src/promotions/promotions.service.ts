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
  gifts: {
    include: { product: { select: { id: true, sku: true, name: true } } },
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
    const { targets, gifts = [], ...data } = input;
    if (data.type === 'GIFT' && !gifts.length)
      throw new BadRequestException('Choose the gift product');
    await this.assertGifts(gifts);
    const promo = await this.prisma.promotion.create({
      data: {
        ...data,
        getQty: data.type === 'DISCOUNT' ? null : data.getQty,
        items: { create: targets },
        gifts: {
          create: (data.type === 'GIFT' ? gifts : []).map((productId) => ({
            productId,
          })),
        },
      },
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
    const { targets, gifts, ...data } = input;
    const type = data.type ?? before.type;
    if (type !== 'DISCOUNT') {
      if ((data.discountType ?? before.discountType) !== 'PERCENT')
        throw new BadRequestException('Free units are a percentage off');
      if (!(data.getQty ?? before.getQty))
        throw new BadRequestException('How many are given');
    }
    if (
      type === 'GIFT' &&
      !(gifts ?? before.gifts.map((g) => g.productId)).length
    )
      throw new BadRequestException('Choose the gift product');
    if (gifts) await this.assertGifts(gifts);
    if (type === 'DISCOUNT') data.getQty = null;
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
      if (gifts || type !== 'GIFT') {
        await tx.promotionGift.deleteMany({ where: { promotionId: id } });
        if (type === 'GIFT')
          await tx.promotionGift.createMany({
            data: (gifts ?? []).map((productId) => ({
              productId,
              promotionId: id,
            })),
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

  /** Gift products must exist and be sold one by one (no services or bundles). */
  private async assertGifts(ids: string[]) {
    if (!ids.length) return;
    const found = await this.prisma.product.count({
      where: { id: { in: ids }, type: 'STANDARD' },
    });
    if (found !== new Set(ids).size)
      throw new BadRequestException('A gift must be a regular product');
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
