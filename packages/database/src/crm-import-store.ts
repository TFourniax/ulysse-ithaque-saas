import { randomUUID } from 'node:crypto';
import type {
  Connection,
  Context,
  CrmFile,
  CrmMatch,
  CrmPreview,
  CrmResolution,
  OpportunityFields,
  TenantTx,
} from '@ulysse/domain';
import {
  CRM_FILE_PROVIDER,
  ensure,
  fingerprintOf,
  persistSourceRecord,
  requirePermission,
  requireScope,
  validateFields,
} from '@ulysse/domain';
import type { PoolClient } from 'pg';
import { PgAgentStore } from './agent-store.ts';
import type { Row } from './rows.ts';
import { int, json, str, strOrNull } from './rows.ts';

const ids = { next: () => randomUUID() };
type Item = {
  id: string;
  identity: string;
  title: string;
  company: string;
  revision: number;
  hash: string;
};
export type CrmImportSummary = {
  id: string;
  filename: string;
  connectionId: string | null;
  status: string;
  createdAt: string;
  result: { created: number; updated: number; unchanged: number; skipped: number } | null;
  errorCode: string | null;
};
function businessHash(fields: OpportunityFields): string {
  // File arrival is provenance, not a business change. Keep timestamps of unchanged materials.
  return fingerprintOf({
    ...fields,
    commercial: fields.commercial
      ? {
          ...fields.commercial,
          materials: fields.commercial.materials.map(({ occurredAt: _date, ...m }) => m),
        }
      : undefined,
  });
}
const normalizedName = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');
const snapshot = (items: Item[]) =>
  fingerprintOf(items.map((i) => [i.id, i.revision, i.identity, i.hash]));

export class PgCrmImportStore extends PgAgentStore {
  private async items(
    sql: PoolClient,
    tenantId: string,
    connectionId: string | null,
  ): Promise<Item[]> {
    if (!connectionId) return [];
    const rows = await sql.query<Row>(
      'SELECT * FROM crm_import_items WHERE tenant_id=$1 AND connection_id=$2 ORDER BY id',
      [tenantId, connectionId],
    );
    return rows.rows.map((r) => ({
      id: str(r, 'id'),
      identity: str(r, 'identity_hash'),
      title: str(r, 'title'),
      company: str(r, 'company'),
      revision: int(r, 'revision'),
      hash: str(r, 'content_hash'),
    }));
  }
  private async connection(tx: TenantTx, id: string): Promise<Connection> {
    const c = await tx.getConnection(id, { forUpdate: true });
    ensure(c && c.provider === CRM_FILE_PROVIDER, 'NOT_FOUND');
    ensure(c.status === 'active', 'CONNECTION_INACTIVE');
    return c;
  }
  async preview(
    ctx: Context,
    filename: string,
    file: CrmFile,
    connectionId: string | null,
  ): Promise<CrmPreview> {
    const actor = requirePermission(ctx, 'connection:manage');
    return this.transaction(ctx, async (tx, sql) => {
      await tx.lock('crm-import');
      if (connectionId) await this.connection(tx, connectionId);
      const items = await this.items(sql, ctx.tenantId, connectionId);
      const identities = new Map<string, number>();
      for (const r of file.rows) identities.set(r.identity, (identities.get(r.identity) ?? 0) + 1);
      const rows: CrmMatch[] = file.rows.map((r) => {
        const exact = items.filter((i) => i.identity === r.identity);
        const possible = exact.length
          ? exact
          : items.filter(
              (i) =>
                (r.company && normalizedName(i.company) === normalizedName(r.company)) ||
                normalizedName(i.title) === normalizedName(r.title),
            );
        const match = exact.length === 1 && identities.get(r.identity) === 1 ? exact[0] : undefined;
        const action = !r.fields
          ? 'invalid'
          : match
            ? businessHash(r.fields) === match.hash
              ? 'unchanged'
              : 'update'
            : possible.length || (identities.get(r.identity) ?? 0) > 1
              ? 'choose'
              : 'create';
        return {
          ...r,
          action,
          targetId: match?.id ?? null,
          choices: possible.map((i) => ({ id: i.id, title: i.title, company: i.company })),
        };
      });
      const id = randomUUID(),
        expiresAt = new Date(Date.now() + 86400000).toISOString();
      const preview: CrmPreview = {
        id,
        connectionId,
        filename,
        columns: file.columns,
        rows,
        missing: items.filter((i) => !rows.some((r) => r.targetId === i.id)).length,
        expiresAt,
      };
      // Bound abandoned upload retention and per-user staging growth.
      await sql.query(
        "UPDATE crm_import_batches SET preview=NULL,selections=NULL,status='cancelled' WHERE tenant_id=$1 AND created_by=$2 AND status='preview'",
        [ctx.tenantId, actor.userId],
      );
      await sql.query(
        "INSERT INTO crm_import_batches(tenant_id,id,connection_id,created_by,filename,status,preview,snapshot,expires_at) VALUES($1,$2,$3,$4,$5,'preview',$6,$7,$8)",
        [
          ctx.tenantId,
          id,
          connectionId,
          actor.userId,
          filename,
          JSON.stringify(preview),
          snapshot(items),
          expiresAt,
        ],
      );
      await this.audit(tx, ctx, 'crm.preview_created', id, { rows: rows.length });
      return preview;
    });
  }
  async confirm(
    ctx: Context,
    id: string,
    resolutions: CrmResolution[],
  ): Promise<{ id: string; connectionId: string; status: string }> {
    const actor = requirePermission(ctx, 'connection:manage');
    return this.transaction(ctx, async (tx, sql) => {
      await tx.lock('crm-import');
      const row = (
        await sql.query<Row>(
          'SELECT * FROM crm_import_batches WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
          [ctx.tenantId, id],
        )
      ).rows[0];
      ensure(row, 'NOT_FOUND');
      ensure(str(row, 'created_by') === actor.userId, 'FORBIDDEN');
      const oldConnection = strOrNull(row, 'connection_id');
      const state = str(row, 'status');
      if ((state === 'queued' || state === 'completed') && oldConnection) {
        await this.connection(tx, oldConnection);
        return { id, connectionId: oldConnection, status: state };
      }
      ensure(state === 'preview' && Date.parse(str(row, 'expires_at')) > Date.now(), 'EXPIRED');
      const preview = json<CrmPreview>(row, 'preview');
      if (oldConnection) await this.connection(tx, oldConnection);
      const items = await this.items(sql, ctx.tenantId, oldConnection);
      ensure(snapshot(items) === str(row, 'snapshot'), 'REVISION_CONFLICT');
      const pending = await sql.query(
        "SELECT 1 FROM crm_import_batches WHERE tenant_id=$1 AND connection_id=$2 AND status='queued'",
        [ctx.tenantId, oldConnection],
      );
      ensure(!pending.rowCount, 'REVISION_CONFLICT', 'import pending');
      const byRow = new Map(resolutions.map((r) => [r.row, r.target]));
      ensure(
        byRow.size === resolutions.length &&
          resolutions.every((r) => preview.rows.some((p) => p.row === r.row)),
        'INVALID_INPUT',
      );
      const used = new Set<string>();
      const selections = preview.rows.flatMap((r) => {
        const target =
          byRow.get(r.row) ??
          (r.action === 'invalid' ? 'skip' : r.action === 'choose' ? '' : (r.targetId ?? 'new'));
        if (target === 'skip') return [];
        ensure(r.fields && target, 'INVALID_INPUT', 'unresolved row');
        if (target !== 'new')
          ensure(
            items.some((i) => i.id === target) &&
              (r.targetId === target || r.choices.some((c) => c.id === target)),
            'NOT_FOUND',
          );
        const itemId = target === 'new' ? randomUUID() : target;
        ensure(!used.has(itemId), 'INVALID_INPUT', 'duplicate target');
        used.add(itemId);
        return [{ row: r.row, itemId }];
      });
      ensure(selections.length > 0, 'INVALID_INPUT', 'no rows');
      const at = new Date().toISOString();
      const connectionId = oldConnection ?? randomUUID();
      if (!oldConnection)
        await tx.insertConnection({
          tenantId: ctx.tenantId,
          id: connectionId,
          provider: CRM_FILE_PROVIDER,
          displayName: 'Affaires importées par fichier',
          status: 'active',
          config: {},
          credentialRef: null,
          grantedScopes: ['opportunities:read'],
          syncIntervalMinutes: 10080,
          cursor: null,
          passStartedAt: null,
          lastSyncStartedAt: null,
          lastSuccessAt: null,
          dataAsOf: null,
          lastErrorCode: null,
          lastErrorAt: null,
          consecutiveFailures: 0,
          nextSyncAt: null,
          createdBy: actor.userId,
          createdAt: at,
          updatedAt: at,
          revokedAt: null,
          revokedBy: null,
        });
      await sql.query(
        "UPDATE crm_import_batches SET status='queued',connection_id=$3,selections=$4 WHERE tenant_id=$1 AND id=$2",
        [ctx.tenantId, id, connectionId, JSON.stringify(selections)],
      );
      await tx.enqueueOutbox({
        tenantId: ctx.tenantId,
        id: randomUUID(),
        eventType: 'connection.sync_requested',
        subjectType: 'connection',
        subjectId: connectionId,
        payload: { trigger: 'manual' },
        createdAt: at,
      });
      await this.audit(tx, ctx, 'crm.import_requested', id, { rows: selections.length });
      return { id, connectionId, status: 'queued' };
    });
  }
  async apply(ctx: Context, connectionId: string): Promise<void> {
    requireScope(ctx, 'source:ingest', connectionId);
    await this.transaction(ctx, async (tx, sql) => {
      await tx.lock('crm-import');
      const connection = await tx.getConnection(connectionId, { forUpdate: true });
      if (
        !connection ||
        connection.status !== 'active' ||
        connection.provider !== CRM_FILE_PROVIDER
      )
        return;
      const batch = (
        await sql.query<Row>(
          "SELECT * FROM crm_import_batches WHERE tenant_id=$1 AND connection_id=$2 AND status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE",
          [ctx.tenantId, connectionId],
        )
      ).rows[0];
      if (!batch) return;
      const id = str(batch, 'id'),
        preview = json<CrmPreview>(batch, 'preview');
      const selections = json<{ row: number; itemId: string }[]>(batch, 'selections');
      const result = {
        created: 0,
        updated: 0,
        unchanged: 0,
        skipped: preview.rows.length - selections.length,
      };
      const at = new Date().toISOString(),
        observedAt = str(batch, 'created_at');
      for (const selection of selections) {
        const r = preview.rows.find((r) => r.row === selection.row);
        ensure(r?.fields, 'INVALID_INPUT');
        let fields = validateFields(r.fields);
        const previous = await tx.getOpportunityByExternalId(connectionId, selection.itemId);
        const hash = businessHash(fields);
        if (previous && businessHash(previous.fields) === hash) fields = previous.fields;
        const outcome = await persistSourceRecord(
          tx,
          ids,
          connection,
          {
            entityType: 'opportunity',
            externalId: selection.itemId,
            providerVersion: id,
            etag: null,
            sourceModifiedAt: null,
            deleted: false,
            fields,
          },
          observedAt,
          Date.now(),
        );
        if (outcome === 'created') result.created++;
        else if (outcome === 'revised') result.updated++;
        else result.unchanged++;
        await sql.query(
          `INSERT INTO crm_import_items(tenant_id,connection_id,id,identity_hash,source_id,title,company,revision,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,1,$8)
          ON CONFLICT(tenant_id,id) DO UPDATE SET identity_hash=EXCLUDED.identity_hash,source_id=EXCLUDED.source_id,title=EXCLUDED.title,company=EXCLUDED.company,
          revision=crm_import_items.revision+CASE WHEN crm_import_items.content_hash<>EXCLUDED.content_hash OR crm_import_items.identity_hash<>EXCLUDED.identity_hash THEN 1 ELSE 0 END,content_hash=EXCLUDED.content_hash`,
          [
            ctx.tenantId,
            connectionId,
            selection.itemId,
            r.identity,
            r.sourceId,
            r.title,
            r.company,
            hash,
          ],
        );
      }
      await tx.updateConnection({
        ...connection,
        lastSuccessAt: at,
        dataAsOf: observedAt,
        lastSyncStartedAt: at,
        lastErrorCode: null,
        lastErrorAt: null,
        consecutiveFailures: 0,
        nextSyncAt: null,
        updatedAt: at,
      });
      await sql.query(
        "UPDATE crm_import_batches SET status='completed',preview=NULL,selections=NULL,result=$3,completed_at=$4 WHERE tenant_id=$1 AND id=$2",
        [ctx.tenantId, id, JSON.stringify(result), at],
      );
      await this.audit(tx, ctx, 'crm.import_completed', id, result);
      await tx.enqueueOutbox({
        tenantId: ctx.tenantId,
        id: randomUUID(),
        eventType: 'source.changed',
        subjectType: 'connection',
        subjectId: connectionId,
        payload: { changed: result.created + result.updated, complete: true },
        createdAt: at,
      });
    });
  }
  async fail(ctx: Context, connectionId: string): Promise<void> {
    requireScope(ctx, 'source:ingest', connectionId);
    await this.transaction(ctx, async (tx, sql) => {
      await tx.lock('crm-import');
      const c = await tx.getConnection(connectionId, { forUpdate: true });
      if (!c || c.status !== 'active') return;
      await sql.query(
        "UPDATE crm_import_batches SET status='failed',error_code='import_failed' WHERE tenant_id=$1 AND connection_id=$2 AND status='queued'",
        [ctx.tenantId, connectionId],
      );
    });
  }
  async retry(ctx: Context, id: string): Promise<void> {
    requirePermission(ctx, 'connection:manage');
    await this.transaction(ctx, async (tx, sql) => {
      await tx.lock('crm-import');
      const row = (
        await sql.query<Row>(
          'SELECT * FROM crm_import_batches WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
          [ctx.tenantId, id],
        )
      ).rows[0];
      ensure(row, 'NOT_FOUND');
      ensure(str(row, 'status') === 'failed' && row.preview !== null, 'INVALID_TRANSITION');
      const connectionId = str(row, 'connection_id');
      await this.connection(tx, connectionId);
      // A later successful import must not be overwritten by an old failed attempt.
      ensure(
        snapshot(await this.items(sql, ctx.tenantId, connectionId)) === str(row, 'snapshot'),
        'REVISION_CONFLICT',
      );
      const pending = await sql.query(
        "SELECT 1 FROM crm_import_batches WHERE tenant_id=$1 AND connection_id=$2 AND status='queued'",
        [ctx.tenantId, connectionId],
      );
      ensure(!pending.rowCount, 'REVISION_CONFLICT');
      await sql.query(
        "UPDATE crm_import_batches SET status='queued',error_code=NULL WHERE tenant_id=$1 AND id=$2",
        [ctx.tenantId, id],
      );
      await tx.enqueueOutbox({
        tenantId: ctx.tenantId,
        id: randomUUID(),
        eventType: 'connection.sync_requested',
        subjectType: 'connection',
        subjectId: connectionId,
        payload: { trigger: 'manual' },
        createdAt: new Date().toISOString(),
      });
      await this.audit(tx, ctx, 'crm.import_retried', id, {});
    });
  }
  async cancelPreview(ctx: Context, id: string): Promise<void> {
    const actor = requirePermission(ctx, 'connection:manage');
    await this.transaction(ctx, async (_tx, sql) => {
      const updated = await sql.query(
        "UPDATE crm_import_batches SET status='cancelled',preview=NULL,selections=NULL WHERE tenant_id=$1 AND id=$2 AND created_by=$3 AND status='preview'",
        [ctx.tenantId, id, actor.userId],
      );
      ensure(updated.rowCount === 1, 'REVISION_CONFLICT');
    });
  }
  async listImports(ctx: Context): Promise<CrmImportSummary[]> {
    requirePermission(ctx, 'connection:read');
    return this.transaction(ctx, async (_tx, sql) => {
      const rows = await sql.query<Row>(
        "SELECT b.* FROM crm_import_batches b LEFT JOIN connections c ON c.tenant_id=b.tenant_id AND c.id=b.connection_id WHERE b.tenant_id=$1 AND (b.connection_id IS NULL OR c.status<>'revoked') AND b.status<>'cancelled' ORDER BY b.created_at DESC LIMIT 30",
        [ctx.tenantId],
      );
      return rows.rows.map((r) => ({
        id: str(r, 'id'),
        filename: str(r, 'filename'),
        connectionId: strOrNull(r, 'connection_id'),
        status: str(r, 'status'),
        createdAt: str(r, 'created_at'),
        result: json<CrmImportSummary['result']>(r, 'result'),
        errorCode: strOrNull(r, 'error_code'),
      }));
    });
  }
  private async audit(
    tx: TenantTx,
    ctx: Context,
    eventType: string,
    id: string,
    metadata: Record<string, number>,
  ) {
    await tx.appendAudit({
      tenantId: ctx.tenantId,
      id: randomUUID(),
      actorType: ctx.actor.kind === 'user' ? 'user' : 'service',
      actorId: ctx.actor.kind === 'user' ? ctx.actor.userId : ctx.actor.serviceId,
      eventType,
      resourceType: 'crm_import',
      resourceId: id,
      revision: null,
      correlationId: ctx.correlationId,
      metadata,
      createdAt: new Date().toISOString(),
    });
  }
}
