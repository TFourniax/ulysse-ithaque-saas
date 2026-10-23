import type { ResearchCandidate, ResearchFact, ResearchProfile } from './research.ts';
import type { WorkflowBrief, WorkflowInput, WorkflowResult } from './workflows.ts';
import { sourceReference } from './workflows.ts';

const common = new Set(
  'avec dans pour des les une aux sur par ses leur leurs qui que est sont plus tout toute tous cette ces notre votre from with for the and our your services service offre offres entreprise entreprises company companies'.split(
    ' ',
  ),
);
function terms(value: string): Set<string> {
  return new Set(
    value
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3 && !common.has(word)),
  );
}
const overlap = (wanted: ReadonlySet<string>, found: ReadonlySet<string>) =>
  [...wanted].filter((term) => found.has(term)).length;

/** One fact per comparison dimension before more of the same introductory copy. */
export function researchFactsForDigest(facts: readonly ResearchFact[]): ResearchFact[] {
  const dimensions = [
    'offer',
    'target',
    'delivery',
    'price',
    'proof',
    'support',
    'integrations',
    'limits',
  ] as const;
  const groups = dimensions.map((dimension) => facts.filter((f) => f.dimension === dimension));
  const ordered: ResearchFact[] = [];
  for (let i = 0; i < Math.max(0, ...groups.map((g) => g.length)); i++)
    for (const group of groups) {
      const fact = group[i];
      if (fact) ordered.push(fact);
    }
  return ordered;
}

/** Reading priority, never a semantic qualification or a confidence score.
 * Use documented facts, not a domain's alphabetic position or a model's qualification prose.
 * Geography is a positive signal only: remote suppliers are not automatically excluded.
 */
export function rankResearchCandidates(
  candidates: readonly ResearchCandidate[],
  profile: ResearchProfile,
  brief?: WorkflowBrief,
): ResearchCandidate[] {
  const offer = terms([brief?.offer ?? '', ...profile.offers].join(' '));
  const target = terms([brief?.target ?? '', profile.target, profile.market].join(' '));
  const geography = terms(profile.geography);
  const priority = (c: ResearchCandidate) => {
    const evidence = terms(c.facts.map((f) => `${f.offer} ${f.value} ${f.quote}`).join(' '));
    const documentedTarget = terms(
      c.facts
        .filter((f) => f.dimension === 'target')
        .map((f) => `${f.value} ${f.quote}`)
        .join(' '),
    );
    return (
      4 * overlap(offer, evidence) +
      2 * overlap(target, evidence) +
      6 * overlap(target, documentedTarget) +
      3 * overlap(geography, evidence)
    );
  };
  const priorities = new Map(candidates.map((c) => [c.id, priority(c)]));
  return candidates.toSorted(
    (a, b) =>
      Number(b.own) - Number(a.own) ||
      (priorities.get(b.id) ?? 0) - (priorities.get(a.id) ?? 0) ||
      Number(b.review === 'approved') - Number(a.review === 'approved') ||
      new Set(b.facts.map((f) => f.dimension)).size -
        new Set(a.facts.map((f) => f.dimension)).size ||
      a.domain.localeCompare(b.domain),
  );
}

/** Actual citation coverage is computed by the application, not guessed by the model. */
export function withResearchCoverage(result: WorkflowResult, input: WorkflowInput): WorkflowResult {
  if (result.kind !== 'buyer' || result.outcome !== 'draft' || !input.research) return result;
  const available = new Set(
    input.sources.filter((s) => s.kind === 'competitor' && s.research).map(sourceReference),
  );
  const cited = new Set(
    result.benchmark.flatMap((f) => f.references).filter((r) => available.has(r)),
  );
  const pending = [...cited].filter((r) => input.research?.pendingReferences.includes(r)).length;
  const coverage = `Périmètre de la comparaison : alternatives citées dans ce diagnostic : ${cited.size} ; fiches concurrentes avec des informations disponibles : ${available.size}. Parmi les fiches citées, à vérifier : ${pending} ; relues et approuvées : ${cited.size - pending}. Ces nombres comptent les fiches citées, pas toutes les fiches examinées ni l’ensemble du marché. ${input.research.status === 'completed' ? 'Recherche terminée dans le périmètre prévu.' : 'Recherche partielle : les informations déjà recueillies sont conservées.'} Une fiche approuvée ne constitue pas une vérification indépendante des promesses du prestataire.`;
  return { ...result, limits: [coverage, ...result.limits.slice(0, 9)] };
}
