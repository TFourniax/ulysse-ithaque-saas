import type {
  AnalysisDto,
  AuditEntry,
  CompanyContextContentDto,
  CompanyContextDto,
  Connection,
  ConnectorInfo,
  DoctrineDto,
  Me,
  MemberDto,
  OpportunityDto,
  QualityReport,
  RecommendationDetail,
  RecommendationSummary,
  RuleCatalogEntryDto,
  SyncRunDto,
} from '@ulysse/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/** Structured API error: the UI always shows the message and the correlation id. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly correlationId: string | null;

  constructor(status: number, code: string, message: string, correlationId: string | null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
  }
}

let csrfToken: string | null = null;

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
};

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['x-csrf-token'] = csrfToken;
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Serveur injoignable. Vérifiez votre connexion.', null);
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (
      payload as { error?: { code?: string; message?: string; correlationId?: string } } | null
    )?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'INTERNAL',
      error?.message ?? response.statusText,
      error?.correlationId ?? response.headers.get('x-correlation-id'),
    );
  }
  return payload as T;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function loginUrl(
  returnTo: string = window.location.pathname + window.location.search,
): string {
  return `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}

// --- Session ---------------------------------------------------------------------

export function useMe() {
  return useQuery<Me | null>({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        const me = await api<Me>('/v1/me');
        csrfToken = me.csrfToken;
        return me;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 60_000,
  });
}

export function useSelectTenant() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (tenantId: string) =>
      api<Me>('/v1/session/tenant', { method: 'PUT', body: { tenantId } }),
    onSuccess: (me) => {
      csrfToken = me.csrfToken;
      // Never reuse cached data of the previous tenant.
      client.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      client.setQueryData(['me'], me);
    },
  });
}

export async function logout(client: QueryClient): Promise<void> {
  const result = await api<{ redirectTo: string }>('/auth/logout', { method: 'POST' });
  client.clear();
  window.location.assign(result.redirectTo);
}

// --- Recommendations ---------------------------------------------------------------

type Page<T> = { items: T[]; nextCursor: string | null };
export type View = 'open' | 'decided' | 'closed' | 'all';

export function useRecommendations(tenantId: string, view: View) {
  return useInfiniteQuery({
    queryKey: ['recommendations', tenantId, view],
    queryFn: ({ pageParam }) =>
      api<Page<RecommendationSummary>>(
        `/v1/recommendations?view=${view}&limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: 30_000,
  });
}

export function useRecommendation(tenantId: string, id: string) {
  return useQuery({
    queryKey: ['recommendation', tenantId, id],
    queryFn: () => api<RecommendationDetail>(`/v1/recommendations/${id}`),
  });
}

export type MutationResult = { recommendation: RecommendationSummary; replayed: boolean };

export function useDecision(tenantId: string, id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      decision: 'approve' | 'reject';
      expectedRevision: number;
      reason: string | null;
      quality: string | null;
      key: string;
    }) =>
      api<MutationResult>(`/v1/recommendations/${id}/decisions`, {
        method: 'POST',
        body: {
          decision: input.decision,
          expectedRevision: input.expectedRevision,
          reason: input.reason,
          quality: input.quality,
        },
        idempotencyKey: input.key,
      }),
    onSettled: () => invalidateRecommendations(client, tenantId, id),
  });
}

export function useRevision(tenantId: string, id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      expectedRevision: number;
      proposedAction: string;
      note: string | null;
      submit: boolean;
      key: string;
    }) =>
      api<MutationResult>(`/v1/recommendations/${id}/revisions`, {
        method: 'POST',
        body: {
          expectedRevision: input.expectedRevision,
          proposedAction: input.proposedAction,
          note: input.note,
          submit: input.submit,
        },
        idempotencyKey: input.key,
      }),
    onSettled: () => invalidateRecommendations(client, tenantId, id),
  });
}

function invalidateRecommendations(
  client: QueryClient,
  tenantId: string,
  id: string,
): Promise<void> {
  return Promise.all([
    client.invalidateQueries({ queryKey: ['recommendation', tenantId, id] }),
    client.invalidateQueries({ queryKey: ['recommendations', tenantId] }),
    client.invalidateQueries({ queryKey: ['audit', tenantId] }),
    client.invalidateQueries({ queryKey: ['quality-report', tenantId] }),
  ]).then(() => undefined);
}

// --- Context, connections, audit, administration ------------------------------------

export function useOpportunities(tenantId: string) {
  return useInfiniteQuery({
    queryKey: ['opportunities', tenantId],
    queryFn: ({ pageParam }) =>
      api<Page<OpportunityDto>>(
        `/v1/opportunities?limit=50${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useAnalyses(tenantId: string) {
  return useQuery({
    queryKey: ['analyses', tenantId],
    queryFn: () => api<AnalysisDto[]>('/v1/analyses?limit=5'),
    refetchInterval: 30_000,
  });
}

export function useQualityReport(tenantId: string, days: number) {
  return useQuery({
    queryKey: ['quality-report', tenantId, days],
    queryFn: () => {
      const to = new Date();
      const from = new Date(to.getTime() - days * 86_400_000);
      const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
      return api<QualityReport>(`/v1/reports/quality?${query.toString()}`);
    },
  });
}

export function useConnections(tenantId: string) {
  return useQuery({
    queryKey: ['connections', tenantId],
    queryFn: () => api<Connection[]>('/v1/connections'),
    refetchInterval: 15_000,
  });
}

export function useConnectors(tenantId: string) {
  return useQuery({
    queryKey: ['connectors', tenantId],
    queryFn: () => api<ConnectorInfo[]>('/v1/connectors'),
    staleTime: 300_000,
  });
}

export function useSyncRuns(tenantId: string, connectionId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['sync-runs', tenantId, connectionId],
    queryFn: () => api<SyncRunDto[]>(`/v1/connections/${connectionId}/sync-runs`),
    enabled,
  });
}

export function useConnectionActions(tenantId: string) {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: ['connections', tenantId] });
  return {
    sync: useMutation({
      mutationFn: (id: string) =>
        api<{ queued: true }>(`/v1/connections/${id}/sync`, { method: 'POST', body: {} }),
      onSettled: refresh,
    }),
    revoke: useMutation({
      mutationFn: (id: string) => api<Connection>(`/v1/connections/${id}`, { method: 'DELETE' }),
      onSettled: async () => {
        await refresh();
        await client.invalidateQueries({ queryKey: ['recommendations', tenantId] });
      },
    }),
    create: useMutation({
      mutationFn: (input: {
        provider: string;
        displayName: string;
        config: Record<string, string>;
      }) => api<Connection>('/v1/connections', { method: 'POST', body: input }),
      onSettled: refresh,
    }),
  };
}

export function useAudit(tenantId: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['audit', tenantId],
    queryFn: ({ pageParam }) =>
      api<Page<AuditEntry>>(
        `/v1/audit?limit=50${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

export function useMembers(tenantId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['members', tenantId],
    queryFn: () => api<MemberDto[]>('/v1/members'),
    enabled,
  });
}

export function useMemberActions(tenantId: string) {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: ['members', tenantId] });
  return {
    changeRole: useMutation({
      mutationFn: (input: { userId: string; role: 'owner' | 'reviewer' | 'viewer' }) =>
        api<MemberDto>(`/v1/members/${input.userId}`, {
          method: 'PATCH',
          body: { role: input.role },
        }),
      onSettled: refresh,
    }),
    revoke: useMutation({
      mutationFn: (userId: string) => api<MemberDto>(`/v1/members/${userId}`, { method: 'DELETE' }),
      onSettled: refresh,
    }),
  };
}

export function useDoctrines(tenantId: string) {
  return useQuery({
    queryKey: ['doctrines', tenantId],
    queryFn: () => api<DoctrineDto[]>('/v1/doctrines'),
  });
}

export function useRules(tenantId: string) {
  return useQuery({
    queryKey: ['rules', tenantId],
    queryFn: () => api<RuleCatalogEntryDto[]>('/v1/rules'),
    staleTime: 300_000,
  });
}

export function useDoctrineActions(tenantId: string) {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: ['doctrines', tenantId] });
  return {
    draft: useMutation({
      mutationFn: (input: {
        key: string;
        title: string;
        origin: string;
        usageRights: string;
        content: unknown;
      }) => api<DoctrineDto>('/v1/doctrines', { method: 'POST', body: input }),
      onSettled: refresh,
    }),
    validate: useMutation({
      mutationFn: (input: { id: string; note: string | null }) =>
        api<DoctrineDto>(`/v1/doctrines/${input.id}/validate`, {
          method: 'POST',
          body: { note: input.note },
        }),
      onSettled: refresh,
    }),
    retire: useMutation({
      mutationFn: (id: string) =>
        api<DoctrineDto>(`/v1/doctrines/${id}/retire`, { method: 'POST', body: {} }),
      onSettled: refresh,
    }),
  };
}

export function useCompanyContext(tenantId: string) {
  return useQuery({
    queryKey: ['context', tenantId],
    queryFn: () => api<{ context: CompanyContextDto | null }>('/v1/context'),
  });
}

export function useUpdateContext(tenantId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { content: CompanyContextContentDto; note: string | null }) =>
      api<CompanyContextDto>('/v1/context', { method: 'PUT', body: input }),
    onSettled: () => client.invalidateQueries({ queryKey: ['context', tenantId] }),
  });
}
