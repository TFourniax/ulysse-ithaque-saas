import type { WorkspaceSource } from '@ulysse/domain';
import { sourceReference } from '@ulysse/domain';

/** Start with actual evidence from the already ranked, authorized corpus. A preview
 * never becomes evidence, and no excerpt is truncated or synthesized to fit.
 */
export function seedResearchEvidence(
  selected: readonly WorkspaceSource[],
  candidates: readonly WorkspaceSource[],
  maxBytes: number,
): WorkspaceSource[] {
  const result = [...selected];
  let added = selected.filter((s) => s.kind === 'competitor').length;
  let bytes = 0;
  for (const source of candidates) {
    if (added >= 6) break;
    if (source.kind !== 'competitor' || !source.research || result.some((s) => s.id === source.id))
      continue;
    const size =
      Buffer.byteLength(
        JSON.stringify({ ...source, reference: sourceReference(source), untrusted: true }),
      ) + 1;
    if (bytes + size > maxBytes) continue;
    result.push(source);
    bytes += size;
    added++;
  }
  return result;
}

export function researchPreview(source: WorkspaceSource) {
  return {
    id: source.id,
    name: source.title,
    url: source.url,
    relevance: source.research?.relevance,
    qualification: source.research?.reason.slice(0, 220),
    offers: source.research?.offers.slice(0, 3).map((offer) => offer.slice(0, 120)),
    targets: source.research?.targets.slice(0, 2).map((target) => target.slice(0, 140)),
    documentedDimensions: source.research?.dimensions,
    reviewStatus: source.research?.review,
  };
}

/** Bounded discovery across the corpus, not just the first alphabetic page.
 * No reference or quotation is marked as read by this catalog.
 */
export function workflowResearchCatalog(sources: readonly WorkspaceSource[], maxBytes: number) {
  const competitors = sources.filter((s) => s.kind === 'competitor' && s.research);
  const items: ReturnType<typeof researchPreview>[] = [];
  let bytes = 256;
  for (const source of competitors) {
    const item = researchPreview(source);
    const size = Buffer.byteLength(JSON.stringify(item)) + 1;
    if (bytes + size > maxBytes) break;
    items.push(item);
    bytes += size;
  }
  const next = competitors[items.length];
  return {
    previewOnly: true,
    total: competitors.length,
    items,
    nextOffset: next ? sources.indexOf(next) : null,
  };
}
