import { CrmUpload, CrmPreview, CrmConfirm, CrmImportSummary, IdParam } from '@ulysse/contracts';
import { CrmCsvError, CRM_MAX_BYTES, parseCrmCsv } from '@ulysse/connectors';
import { PgCrmImportStore } from '@ulysse/database';
import type { Context } from '@ulysse/domain';
import { requirePermission } from '@ulysse/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ApiDeps } from '../deps.ts';
import { HttpError } from '../http.ts';

export function registerCrmImportRoutes(
  scope: FastifyInstance,
  deps: ApiDeps,
  ctxOf: (req: FastifyRequest) => Context,
): void {
  const app = scope.withTypeProvider<ZodTypeProvider>(),
    store = new PgCrmImportStore(deps.pool);
  app.get(
    '/crm/imports',
    { schema: { tags: ['crm'], response: { 200: z.array(CrmImportSummary) } } },
    async (req) => z.array(CrmImportSummary).parse(await store.listImports(ctxOf(req))),
  );
  app.post(
    '/crm/imports/preview',
    {
      // JSON escaping can expand the original CSV; the parser independently limits decoded bytes.
      bodyLimit: CRM_MAX_BYTES * 6 + 65536,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { tags: ['crm'], body: CrmUpload, response: { 201: CrmPreview } },
    },
    async (req, reply) => {
      const ctx = ctxOf(req);
      requirePermission(ctx, 'connection:manage');
      if (!req.body.filename.toLowerCase().endsWith('.csv'))
        throw new HttpError(
          422,
          'VALIDATION',
          'Choisissez un fichier CSV. Depuis Excel, utilisez « Enregistrer sous → CSV UTF-8 ».',
        );
      try {
        const parsed = parseCrmCsv(
          req.body.text,
          req.body.mapping,
          new Date().toISOString(),
          req.body.adjustments,
        );
        const preview = await store.preview(ctx, req.body.filename, parsed, req.body.connectionId);
        const rows = preview.rows.map((r) => {
          const f = r.fields;
          return {
            ...r,
            details: f
              ? [
                  {
                    label: 'État',
                    value: f.stage === 'won' ? 'Gagnée' : f.stage === 'lost' ? 'Perdue' : 'Ouverte',
                  },
                  {
                    label: 'Montant potentiel',
                    value:
                      f.amount.state === 'present'
                        ? `${f.amount.value.amount} ${f.amount.value.currency}`
                        : f.amount.state === 'empty'
                          ? 'Non renseigné'
                          : 'Non fourni',
                  },
                  {
                    label: 'Prochaine action',
                    value:
                      f.nextStep.state === 'present'
                        ? f.nextStep.value
                        : f.nextStep.state === 'empty'
                          ? 'Non renseignée'
                          : 'Non fournie',
                  },
                  {
                    label: 'Dernière interaction',
                    value:
                      f.lastInteractionAt.state === 'present'
                        ? f.lastInteractionAt.value
                        : f.lastInteractionAt.state === 'empty'
                          ? 'Non renseignée'
                          : 'Non fournie',
                  },
                  {
                    label: 'Informations conservées',
                    value: (f.commercial?.materials.map((m) => m.title) ?? [])
                      .filter((v, i, a) => a.indexOf(v) === i)
                      .join(', '),
                  },
                ]
              : [],
          };
        });
        return await reply.status(201).send(CrmPreview.parse({ ...preview, rows }));
      } catch (error) {
        if (error instanceof CrmCsvError) throw new HttpError(422, 'VALIDATION', error.message);
        throw error;
      }
    },
  );
  app.post(
    '/crm/imports/:id/confirm',
    {
      bodyLimit: 256 * 1024,
      schema: {
        tags: ['crm'],
        params: IdParam,
        body: CrmConfirm,
        response: { 202: z.object({ id: z.uuid(), connectionId: z.uuid(), status: z.string() }) },
      },
    },
    async (req, reply) =>
      reply.status(202).send(await store.confirm(ctxOf(req), req.params.id, req.body.resolutions)),
  );
  for (const operation of ['retry', 'cancel'] as const)
    app.post(
      `/crm/imports/:id/${operation}`,
      {
        schema: {
          tags: ['crm'],
          params: IdParam,
          body: z.object({}).strict(),
          response: { 200: z.object({ status: z.literal('recorded') }) },
        },
      },
      async (req) => {
        if (operation === 'retry') await store.retry(ctxOf(req), req.params.id);
        else await store.cancelPreview(ctxOf(req), req.params.id);
        return { status: 'recorded' as const };
      },
    );
}
