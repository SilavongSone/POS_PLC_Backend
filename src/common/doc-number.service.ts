import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { localDateParts } from './time.js';

type Tx = Prisma.TransactionClient;

/**
 * Gap-free running document numbers. Call inside the transaction that creates the
 * document so a rollback also rolls back the counter.
 */
@Injectable()
export class DocNumberService {
  /** Daily number, e.g. daily(tx, 'S-R1') → "S-R1-261026-0001". */
  async daily(tx: Tx, prefix: string, at = new Date()): Promise<string> {
    const { year, month, day } = localDateParts(at);
    const scope = `${prefix}-${year.slice(2)}${month}${day}`;
    const n = await this.next(tx, scope);
    return `${scope}-${String(n).padStart(4, '0')}`;
  }

  /** Yearly number, e.g. yearly(tx, 'INV') → "INV-2026-000001". */
  async yearly(tx: Tx, prefix: string, at = new Date()): Promise<string> {
    const scope = `${prefix}-${localDateParts(at).year}`;
    const n = await this.next(tx, scope);
    return `${scope}-${String(n).padStart(6, '0')}`;
  }

  /** Never-resetting number, e.g. sequential(tx, 'C', 5) → "C00012". */
  async sequential(tx: Tx, prefix: string, width = 6): Promise<string> {
    const n = await this.next(tx, prefix);
    return `${prefix}${String(n).padStart(width, '0')}`;
  }

  private async next(tx: Tx, key: string): Promise<number> {
    const [row] = await tx.$queryRaw<{ value: number }[]>`
      INSERT INTO "DocSequence" ("key", "value") VALUES (${key}, 1)
      ON CONFLICT ("key") DO UPDATE SET "value" = "DocSequence"."value" + 1
      RETURNING "value"`;
    return row.value;
  }
}
