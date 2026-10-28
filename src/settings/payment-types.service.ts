import { Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreatePaymentTypeInput,
  UpdatePaymentTypeInput,
} from './settings.schemas.js';

@Injectable()
export class PaymentTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(activeOnly: boolean) {
    return this.prisma.paymentType.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async create(input: CreatePaymentTypeInput, actorId: string) {
    const type = await this.prisma.paymentType.create({ data: input });
    await this.audit.log({
      userId: actorId,
      action: 'PAYMENT_TYPE_CREATE',
      entity: 'PaymentType',
      entityId: type.id,
      after: type,
    });
    return type;
  }

  async update(id: string, input: UpdatePaymentTypeInput, actorId: string) {
    const before = await this.prisma.paymentType.findUniqueOrThrow({
      where: { id },
    });
    const type = await this.prisma.paymentType.update({
      where: { id },
      data: input,
    });
    await this.audit.log({
      userId: actorId,
      action: 'PAYMENT_TYPE_UPDATE',
      entity: 'PaymentType',
      entityId: id,
      before,
      after: type,
    });
    return type;
  }
}
