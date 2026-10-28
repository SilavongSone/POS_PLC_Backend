import { z } from 'zod';
import { pageQuerySchema } from '../common/pagination.js';
import { paymentSchema } from '../sales/sales.schemas.js';

const text = (max: number) => z.string().trim().max(max);
const dateTime = z.iso.datetime({ offset: true }).transform((d) => new Date(d));

export const createTicketSchema = z
  .object({
    customerId: z.uuid(),
    /** Branch receiving the device; may be omitted when the user has one branch. */
    branchId: z.uuid().optional(),
    /** Serial of a unit sold by the shop: fills in the device and warranty. */
    serial: text(100).optional(),
    deviceName: text(150).optional(),
    deviceSerial: text(100).optional(),
    accessories: text(300).optional(),
    problem: text(2000).min(1),
    promisedAt: dateTime.optional(),
  })
  .refine((t) => t.serial || t.deviceName, {
    message: 'Give the serial or the device name',
    path: ['deviceName'],
  });

export const updateTicketSchema = z
  .object({
    diagnosis: text(2000).nullable(),
    promisedAt: dateTime.nullable(),
    underWarranty: z.boolean(),
    warrantyDays: z.number().int().min(0).max(3650),
    warrantyTerms: text(2000).nullable(),
    supplierId: z.uuid().nullable(),
    accessories: text(300).nullable(),
  })
  .partial();

export const ticketLinesSchema = z.object({
  lines: z
    .array(
      z
        .object({
          type: z.enum(['PART', 'LABOR']),
          /** Parts from stock (taken out on delivery). */
          productId: z.uuid().optional(),
          description: text(200).min(1),
          quantity: z.number().int().min(1).max(1000).default(1),
          unitPriceLak: z.coerce.number().int().min(0).max(1e13),
        })
        .refine((l) => l.type === 'PART' || !l.productId, {
          message: 'Labour lines have no product',
          path: ['productId'],
        }),
    )
    .max(100),
});

export const ticketStatusSchema = z.object({
  status: z.enum([
    'DIAGNOSING',
    'QUOTED',
    'WAITING_PARTS',
    'SENT_TO_VENDOR',
    'REPAIRING',
    'READY',
    'CANCELLED',
  ]),
  note: text(500).optional(),
});

export const deliverTicketSchema = z.object({
  /** Needed when there is something to charge. */
  registerId: z.uuid().optional(),
  payments: z.array(paymentSchema).max(10).default([]),
  /** Serials of serialized parts used, by product id. */
  partSerials: z.record(z.uuid(), z.array(text(100).min(1))).default({}),
  note: text(500).optional(),
});

export const listTicketsSchema = pageQuerySchema.extend({
  status: ticketStatusSchema.shape.status
    .or(z.enum(['RECEIVED', 'DELIVERED']))
    .optional(),
  customerId: z.uuid().optional(),
  open: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;
export type TicketLinesInput = z.infer<typeof ticketLinesSchema>;
export type DeliverTicketInput = z.infer<typeof deliverTicketSchema>;
export type ListTicketsQuery = z.infer<typeof listTicketsSchema>;
