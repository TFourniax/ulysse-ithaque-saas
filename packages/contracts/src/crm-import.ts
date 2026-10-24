import { z } from 'zod';
export const CrmColumnRole = z.enum([
  'ignore',
  'title',
  'company',
  'externalId',
  'pipeline',
  'stage',
  'amount',
  'currency',
  'lastInteractionAt',
  'nextStep',
  'nextStepDueAt',
  'ownerName',
  'segment',
  'opposed',
  'pauseUntil',
  'visibility',
  'facts',
  'hypotheses',
  'objectives',
  'risks',
  'competitors',
  'history',
]);
export type CrmColumnRoleDto = z.infer<typeof CrmColumnRole>;
export const CrmAdjustments = z
  .object({
    numberFormat: z.enum(['auto', 'fr', 'en']).optional(),
    defaultCurrency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/)
      .optional(),
    cells: z
      .array(
        z
          .object({
            row: z.number().int().min(2).max(2001),
            column: z.number().int().min(0).max(199),
            value: z.string().max(48000),
          })
          .strict(),
      )
      .max(10000)
      .optional(),
    rowCurrencies: z
      .array(
        z
          .object({
            row: z.number().int().min(2).max(2001),
            currency: z
              .string()
              .trim()
              .regex(/^[A-Za-z]{3}$/),
          })
          .strict(),
      )
      .max(2000)
      .optional(),
  })
  .strict();
export type CrmAdjustmentsDto = z.infer<typeof CrmAdjustments>;
export const CrmUpload = z
  .object({
    filename: z.string().trim().min(1).max(200),
    text: z
      .string()
      .min(1)
      .max(5 * 1024 * 1024),
    connectionId: z.uuid().nullable(),
    mapping: z.array(CrmColumnRole).max(200).optional(),
    adjustments: CrmAdjustments.optional(),
  })
  .strict();
export const CrmPreview = z.object({
  id: z.uuid(),
  connectionId: z.uuid().nullable(),
  filename: z.string(),
  expiresAt: z.iso.datetime(),
  missing: z.number().int().nonnegative(),
  columns: z.array(z.object({ index: z.number().int(), label: z.string(), role: CrmColumnRole })),
  rows: z.array(
    z.object({
      row: z.number().int(),
      title: z.string(),
      company: z.string(),
      errors: z.array(z.string()),
      warnings: z.array(z.string()),
      action: z.enum(['create', 'update', 'unchanged', 'choose', 'invalid']),
      targetId: z.uuid().nullable(),
      choices: z.array(z.object({ id: z.uuid(), title: z.string(), company: z.string() })),
      details: z.array(z.object({ label: z.string(), value: z.string() })),
      editableCells: z
        .array(z.object({ column: z.number().int(), original: z.string(), value: z.string() }))
        .optional(),
      currencyOverride: z.string().optional(),
      correctionCount: z.number().int().nonnegative().optional(),
    }),
  ),
});
export type CrmPreviewDto = z.infer<typeof CrmPreview>;
export const CrmConfirm = z
  .object({
    resolutions: z
      .array(
        z
          .object({
            row: z.number().int().min(2),
            target: z.union([z.uuid(), z.literal('new'), z.literal('skip')]),
          })
          .strict(),
      )
      .max(2000),
  })
  .strict();
export const CrmImportSummary = z.object({
  id: z.uuid(),
  filename: z.string(),
  connectionId: z.uuid().nullable(),
  status: z.enum(['preview', 'queued', 'completed', 'failed', 'cancelled']),
  createdAt: z.iso.datetime(),
  result: z
    .object({
      created: z.number().int(),
      updated: z.number().int(),
      unchanged: z.number().int(),
      skipped: z.number().int(),
    })
    .nullable(),
  errorCode: z.string().nullable(),
});
export type CrmImportSummaryDto = z.infer<typeof CrmImportSummary>;
