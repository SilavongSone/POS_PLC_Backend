import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { hasPermission } from '../common/permissions.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { HeldBillInput } from './sales.schemas.js';

/** Parked carts. They do not reserve stock; the cart is re-priced when resumed. */
@Injectable()
export class HeldBillsService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.heldBill.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        cashier: { select: { id: true, fullName: true } },
        customer: { select: { id: true, name: true } },
      },
    });
  }

  get(id: string) {
    return this.prisma.heldBill.findUniqueOrThrow({
      where: { id },
      include: { customer: { select: { id: true, name: true } } },
    });
  }

  async create(input: HeldBillInput, user: AuthUser) {
    if (input.customerId)
      await this.prisma.customer.findUniqueOrThrow({
        where: { id: input.customerId },
      });
    return this.prisma.heldBill.create({
      data: {
        label: input.label,
        customerId: input.customerId,
        cashierId: user.id,
        cart: input.cart as Prisma.InputJsonValue,
      },
    });
  }

  async remove(id: string, user: AuthUser) {
    const bill = await this.prisma.heldBill.findUniqueOrThrow({
      where: { id },
    });
    if (
      bill.cashierId !== user.id &&
      !hasPermission(user.permissions, 'sale.void')
    ) {
      throw new ForbiddenException(
        "Only its cashier or a manager can discard another cashier's bill",
      );
    }
    await this.prisma.heldBill.delete({ where: { id } });
  }
}
