import { randomUUID } from 'node:crypto';
import type { Context, ResearchTask, ResearchPage } from '@ulysse/domain';
import {
  canonicalResearchUrl,
  isDomainError,
  researchDomain,
  validateResearchExtraction,
} from '@ulysse/domain';
import type { Pool } from '@ulysse/database';
import { PgResearchStore } from '@ulysse/database';
import type { PublicPageReader, SearchProvider } from '@ulysse/connectors';
import { BraveSearchProvider, ResearchWebError, SafePublicPageReader } from '@ulysse/connectors';
import { z } from 'zod';
import type { AgentConfig } from './agent-runtime.ts';
import { ProviderCallError } from './agent-errors.ts';
import {
  createResearchModel,
  ResearchModelError,
  type ResearchDiagnostics,
  type ResearchModel,
  type ResearchModelInput,
  type ResearchUsage,
} from './research-model.ts';

export const ResearchConfig = z.object({
  RESEARCH_SEARCH_PROVIDER: z.enum(['none', 'brave']).default('none'),
  BRAVE_SEARCH_API_KEY: z.string().min(16).optional(),
  RESEARCH_SEARCH_PRICE_USD: z.coerce.number().positive().max(0.05).default(0.005),
});
export function researchRuntime(
  pool: Pool,
  agent: AgentConfig,
  env: NodeJS.ProcessEnv = process.env,
): ResearchRuntime {
  const config = ResearchConfig.parse(
    Object.fromEntries(Object.entries(env).filter(([, v]) => v !== '')),
  );
  return new ResearchRuntime(pool, {
    search:
      config.RESEARCH_SEARCH_PROVIDER === 'brave' && config.BRAVE_SEARCH_API_KEY
        ? new BraveSearchProvider(config.BRAVE_SEARCH_API_KEY, config.RESEARCH_SEARCH_PRICE_USD)
        : null,
    reader: new SafePublicPageReader(),
    model: createResearchModel(agent),
    session: agent.AGENT_SESSION_ID ?? 'research-disabled',
    sessionBudget: agent.AGENT_SESSION_BUDGET_USD ?? 0,
    monthBudget: agent.AGENT_MONTH_BUDGET_USD ?? 0,
  });
}
type Settings = {
  search: SearchProvider | null;
  reader: PublicPageReader;
  model: ResearchModel | null;
  session: string;
  sessionBudget: number;
  monthBudget: number;
};
export class ResearchRuntime {
  readonly store: PgResearchStore;
  readonly settings: Settings;
  constructor(pool: Pool, settings: Settings) {
    this.store = new PgResearchStore(pool);
    this.settings = settings;
  }
  async reserve(
    ctx: Context,
    task: ResearchTask,
    kind: 'search' | 'model',
    cost: number,
  ): Promise<string | null> {
    const id = randomUUID();
    const accepted = await this.store.transaction(
      ctx,
      async (_tx, sql) =>
        (
          await sql.query<{ accepted: boolean }>(
            'SELECT app.reserve_research_call($1,$2,$3,$4,$5,$6,$7,$8,$9) AS accepted',
            [
              id,
              task.campaignId,
              task.id,
              task.lease,
              kind,
              cost,
              this.settings.session,
              this.settings.sessionBudget,
              this.settings.monthBudget,
            ],
          )
        ).rows[0]?.accepted,
    );
    if (accepted)
      await this.store.transaction(ctx, async (_tx, sql) => {
        await sql.query('UPDATE research_calls SET metadata=$3 WHERE tenant_id=$1 AND id=$2', [
          ctx.tenantId,
          id,
          JSON.stringify({
            identity: kind === 'model' ? this.settings.model?.identity : this.settings.search?.name,
            unitPriceOrBoundUsd: cost,
          }),
        ]);
      });
    return accepted ? id : null;
  }
  async settle(ctx: Context, id: string, usage: ResearchUsage): Promise<void> {
    // Accounting survives cancellation or publication refusal: the call may already be billed.
    await this.store.transaction(ctx, async (_tx, sql) => {
      await sql.query(
        'UPDATE research_calls SET cost_usd=$3,cost_state=$4,input_tokens=$5,output_tokens=$6 WHERE tenant_id=$1 AND id=$2',
        [ctx.tenantId, id, usage.cost, usage.state, usage.inputTokens, usage.outputTokens],
      );
    });
  }
  async recordModelCall(
    ctx: Context,
    id: string,
    code: string | null,
    diagnostics?: ResearchDiagnostics,
  ): Promise<void> {
    await this.store.transaction(ctx, async (_tx, sql) => {
      await sql.query(
        'UPDATE research_calls SET metadata=metadata || $3::jsonb WHERE tenant_id=$1 AND id=$2',
        [
          ctx.tenantId,
          id,
          JSON.stringify({ outcome: code ?? 'validated', ...(diagnostics ?? {}) }),
        ],
      );
    });
  }
  async run(
    ctx: Context,
    id: string,
    signal: AbortSignal = AbortSignal.timeout(105000),
  ): Promise<void> {
    const claimed = await this.store.claim(ctx, id);
    if (!claimed) return;
    const { task, campaign } = claimed;
    const { body } = task;
    let modelCall: string | null = null;
    let modelBound = 0;
    let diagnostics: ResearchDiagnostics | undefined;
    let phase: 'execution' | 'publication' = 'execution';
    try {
      if (!this.settings.search || !this.settings.model) {
        await this.store.pause(ctx, task, 'research_provider_unavailable');
        return;
      }
      if (body.kind === 'search') {
        const price = this.settings.search.costPerCallUsd;
        const call = await this.reserve(ctx, task, 'search', price);
        if (!call) {
          await this.store.pause(ctx, task, 'budget_reached');
          return;
        }
        const result = await this.settings.search.search(body.search, signal);
        await this.settle(ctx, call, {
          cost: price,
          state: 'estimated',
          inputTokens: 0,
          outputTokens: 0,
        });
        await this.store.complete(ctx, task, async (_tx, sql, c) => {
          let fresh = 0;
          for (const [rank, resultItem] of result.results.entries()) {
            const url = canonicalResearchUrl(resultItem.url);
            const found = await this.store.discover(sql, ctx.tenantId, c, url, resultItem.title);
            if (found.fresh) fresh++;
            await this.store.addTask(
              sql,
              ctx.tenantId,
              id,
              { kind: 'read', url, depth: 0 },
              body.search.axis === 'enrichment' ? 19 : 20 + Math.floor(rank / 3) * 4,
            );
          }
          if (result.more && fresh > 0 && body.search.page < 9 && body.search.axis !== 'enrichment')
            await this.store.addTask(
              sql,
              ctx.tenantId,
              id,
              { kind: 'search', search: { ...body.search, page: body.search.page + 1 } },
              30 + body.search.page,
            );
          return {
            query: body.search.query,
            axis: body.search.axis,
            page: body.search.page,
            results: result.results.length,
            newDomains: fresh,
            more: result.more,
            stop: !result.more
              ? 'provider_end'
              : fresh === 0
                ? 'no_new_domains'
                : body.search.page === 9
                  ? 'provider_page_limit'
                  : null,
          };
        });
        return;
      }
      if (body.kind === 'read') {
        const page = await this.settings.reader.read(body.url, signal);
        await this.store.complete(ctx, task, async (_tx, sql, c) => {
          const { candidate } = await this.store.discover(
            sql,
            ctx.tenantId,
            c,
            body.url,
            page.title,
          );
          const saved = await sql.query(
            'INSERT INTO research_pages(tenant_id,campaign_id,candidate_id,id,url,body) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,campaign_id,url) DO NOTHING',
            [ctx.tenantId, id, candidate.id, page.id, page.url, JSON.stringify(page)],
          );
          if (saved.rowCount) {
            const { text: _text, links: _links, ...meta } = page;
            candidate.pages.push(meta);
            candidate.errors = candidate.errors.filter((e) => e.url !== body.url);
            candidate.review = 'pending';
            candidate.corrections = [];
            await this.store.saveCandidate(sql, ctx.tenantId, candidate);
            await this.store.addTask(
              sql,
              ctx.tenantId,
              id,
              { kind: 'extract', pageId: page.id, candidateId: candidate.id },
              1,
            );
          }
          if (body.depth < 2) {
            for (const link of page.links.filter(
              (l) =>
                researchDomain(l.url) === candidate.domain &&
                /offre|service|solution|produit|tarif|pricing|price|audit|automat|integrat|case|client|reference|maintenance|support/iu.test(
                  `${new URL(l.url).pathname} ${l.label}`,
                ),
            ))
              await this.store.addTask(
                sql,
                ctx.tenantId,
                id,
                { kind: 'read', url: link.url, depth: body.depth + 1 },
                candidate.own ? 3 : 21 + body.depth,
              );
          }
          return { url: page.url, hash: page.hash, truncated: page.truncated };
        });
        return;
      }
      let page: ResearchPage | undefined;
      if (body.kind === 'extract')
        page = await this.store.transaction(ctx, (_tx, sql) =>
          this.store.page(sql, ctx.tenantId, body.pageId),
        );
      const input: ResearchModelInput = page
        ? { kind: 'extract', profile: campaign.profile, page }
        : { kind: 'plan', profile: campaign.profile };
      const bound = this.settings.model.estimate(input);
      const call = await this.reserve(ctx, task, 'model', bound);
      if (!call) {
        await this.store.pause(ctx, task, 'budget_reached');
        return;
      }
      modelCall = call;
      modelBound = bound;
      const response = await this.settings.model.generate(input, signal);
      diagnostics = response.diagnostics;
      if (response.usage) {
        await this.settle(ctx, call, response.usage);
        if (response.usage.cost > bound) {
          await this.recordModelCall(ctx, call, 'provider_cost_exceeded', diagnostics);
          await this.store.pause(ctx, task, 'provider_cost_exceeded');
          return;
        }
      }
      const result = response.result;
      phase = 'publication';
      if ('queries' in result) {
        await this.store.complete(ctx, task, async (_tx, sql) => {
          for (const search of result.queries)
            await this.store.addTask(sql, ctx.tenantId, id, { kind: 'search', search }, 10);
          return { queries: result.queries };
        });
      } else if (body.kind === 'extract' && page) {
        validateResearchExtraction(result, page);
        const evidence = page;
        await this.store.complete(ctx, task, async (_tx, sql, c) => {
          const candidate = await this.store.candidate(sql, ctx.tenantId, body.candidateId);
          candidate.name = result.name;
          if (
            candidate.relevance === 'unqualified' ||
            ['direct', 'indirect', 'substitute'].includes(result.relevance)
          ) {
            candidate.relevance = result.relevance;
            candidate.reason = result.reason;
          }
          if (!['directory', 'irrelevant'].includes(result.relevance))
            for (const fact of result.facts) {
              if (
                !candidate.facts.some(
                  (f) =>
                    f.offer === fact.offer &&
                    f.dimension === fact.dimension &&
                    f.quote === fact.quote,
                )
              )
                candidate.facts.push({
                  ...fact,
                  id: randomUUID(),
                  pageId: evidence.id,
                  quality: 'vendor_claim',
                });
            }
          candidate.review = 'pending';
          candidate.corrections = [];
          candidate.errors = candidate.errors.filter((e) => e.url !== evidence.url);
          await this.store.saveCandidate(sql, ctx.tenantId, candidate);
          if (['direct', 'indirect', 'substitute'].includes(candidate.relevance))
            await this.store.addTask(
              sql,
              ctx.tenantId,
              id,
              {
                kind: 'search',
                search: {
                  axis: 'enrichment',
                  query: `site:${candidate.domain} offres tarifs prix intégrations cas clients maintenance`,
                  page: 0,
                },
              },
              22,
            );
          if (!candidate.own && ['direct', 'indirect', 'substitute'].includes(candidate.relevance))
            await this.store.addTask(
              sql,
              ctx.tenantId,
              id,
              {
                kind: 'search',
                search: {
                  axis: 'alternative',
                  query:
                    `${candidate.name} alternatives ${c.profile.market} ${c.profile.target}`.slice(
                      0,
                      350,
                    ),
                  page: 0,
                },
              },
              32,
            );
          for (const url of result.competitorLinks) {
            if (researchDomain(url) !== candidate.domain) {
              await this.store.discover(sql, ctx.tenantId, c, url, researchDomain(url));
              await this.store.addTask(sql, ctx.tenantId, id, { kind: 'read', url, depth: 0 }, 24);
            }
          }
          return {
            candidateId: candidate.id,
            facts: result.facts.length,
            relevance: result.relevance,
          };
        });
      } else throw new Error('research_result_invalid');
      await this.recordModelCall(ctx, call, null, diagnostics);
    } catch (error) {
      if (error instanceof ResearchModelError && modelCall) {
        diagnostics = error.diagnostics;
        if (error.usage) {
          await this.settle(ctx, modelCall, error.usage);
          if (error.usage.cost > modelBound) {
            await this.recordModelCall(ctx, modelCall, 'provider_cost_exceeded', diagnostics);
            await this.store.pause(ctx, task, 'provider_cost_exceeded');
            return;
          }
        }
      }
      const evidenceErrors: Record<string, string> = {
        'ungrounded research fact': 'research_quote_unmatched',
        'unread discovery link': 'research_link_unobserved',
        'unqualified extraction': 'research_classification_invalid',
      };
      const code =
        error instanceof ResearchWebError ||
        error instanceof ProviderCallError ||
        error instanceof ResearchModelError
          ? error.code
          : isDomainError(error) && Object.hasOwn(evidenceErrors, error.detail ?? '')
            ? (evidenceErrors[error.detail ?? ''] ?? 'research_evidence_invalid')
            : error instanceof z.ZodError
              ? 'research_schema_invalid'
              : phase === 'publication'
                ? 'research_publication_failed'
                : 'research_step_failed';
      if (modelCall) await this.recordModelCall(ctx, modelCall, code, diagnostics);
      if (
        error instanceof ProviderCallError &&
        ['provider_http_429', 'provider_http_503'].includes(code)
      ) {
        if (await this.store.deferProvider(ctx, task, code, error.retryAfterSeconds)) return;
      }
      if (
        body.kind === 'search' ||
        ((body.kind === 'extract' || body.kind === 'plan') &&
          /provider_http_|provider_timeout/u.test(code))
      ) {
        await this.store.pause(ctx, task, code);
        return;
      }
      await this.store.complete(
        ctx,
        task,
        async (_tx, sql, c) => {
          if (body.kind === 'read') {
            const { candidate } = await this.store.discover(
              sql,
              ctx.tenantId,
              c,
              body.url,
              researchDomain(body.url),
            );
            candidate.errors.push({ url: body.url, code });
            await this.store.saveCandidate(sql, ctx.tenantId, candidate);
          }
          if (body.kind === 'extract') {
            const candidate = await this.store.candidate(sql, ctx.tenantId, body.candidateId);
            const evidence = await this.store.page(sql, ctx.tenantId, body.pageId);
            candidate.errors = candidate.errors.filter((e) => e.url !== evidence.url);
            candidate.errors.push({ url: evidence.url, code });
            await this.store.saveCandidate(sql, ctx.tenantId, candidate);
          }
          return { code };
        },
        code,
      );
    }
  }
}
