import { ConflictException, Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateLabelTemplateInput,
  UpdateLabelTemplateInput,
} from './label-templates.schemas.js';

/** Barcode label layouts shared by every device of the company. */
@Injectable()
export class LabelTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.labelTemplate.findMany({
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  private async assertFree(name: string, exceptId?: string) {
    const taken = await this.prisma.labelTemplate.findFirst({
      where: { name, ...(exceptId && { id: { not: exceptId } }) },
    });
    if (taken) {
      throw new ConflictException({
        message: 'A label template with this name already exists',
        code: 'LABEL_TEMPLATE_EXISTS',
      });
    }
  }

  async create(input: CreateLabelTemplateInput, actorId: string) {
    await this.assertFree(input.name);
    const template = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) await this.clearDefault(tx);
      return tx.labelTemplate.create({
        data: { ...input, elements: input.elements as Prisma.InputJsonValue },
      });
    });
    await this.audit.log({
      userId: actorId,
      action: 'LABEL_TEMPLATE_CREATE',
      entity: 'LabelTemplate',
      entityId: template.id,
      after: template,
    });
    return template;
  }

  async update(id: string, input: UpdateLabelTemplateInput, actorId: string) {
    const before = await this.prisma.labelTemplate.findUniqueOrThrow({
      where: { id },
    });
    if (input.name && input.name !== before.name) {
      await this.assertFree(input.name, id);
    }
    const template = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) await this.clearDefault(tx);
      return tx.labelTemplate.update({
        where: { id },
        data: {
          ...input,
          elements: input.elements as Prisma.InputJsonValue | undefined,
        },
      });
    });
    await this.audit.log({
      userId: actorId,
      action: 'LABEL_TEMPLATE_UPDATE',
      entity: 'LabelTemplate',
      entityId: id,
      before,
      after: template,
    });
    return template;
  }

  async remove(id: string, actorId: string) {
    const template = await this.prisma.labelTemplate.findUniqueOrThrow({
      where: { id },
    });
    await this.prisma.labelTemplate.delete({ where: { id } });
    await this.audit.log({
      userId: actorId,
      action: 'LABEL_TEMPLATE_DELETE',
      entity: 'LabelTemplate',
      entityId: id,
      before: template,
    });
  }

  /** Only one template is the default one. */
  private clearDefault(tx: Prisma.TransactionClient) {
    return tx.labelTemplate.updateMany({
      where: { isDefault: true },
      data: { isDefault: false },
    });
  }
}
