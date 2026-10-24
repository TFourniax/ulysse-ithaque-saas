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
  const target = terms([brief?.target ?? '', profile.target].join(' '));
  const geography = terms(profile.geography);
  const priority = (c: ResearchCandidate) => {
    const evidence = terms(c.facts.map((f) => `${f.offer} ${f.value} ${f.quote}`).join(' '));
    const documentedTarget = terms(
      c.facts
        .filter((f) => f.dimension === 'target')
        .map((f) => `${f.value} ${f.quote}`)
        .join(' '),
    );
    const need = overlap(offer, evidence);
    const audience = overlap(target, documentedTarget);
    // A broad comparison article can match many keywords. Prefer a documented
    // need/audience fit, then the provisional relationship, before lexical volume.
    // This is a reading order only: all alternatives remain available to Hermes.
    const fit =
      need > 0 && audience > 0
        ? c.relevance === 'direct'
          ? 3
          : c.relevance === 'indirect'
            ? 2
            : 1
        : 0;
    const score =
      4 * overlap(offer, evidence) +
      2 * overlap(target, evidence) +
      6 * overlap(target, documentedTarget) +
      3 * overlap(geography, evidence);
    return { fit, score };
  };
  const priorities = new Map(candidates.map((c) => [c.id, priority(c)]));
  return candidates.toSorted(
    (a, b) =>
      Number(b.own) - Number(a.own) ||
      (priorities.get(b.id)?.fit ?? 0) - (priorities.get(a.id)?.fit ?? 0) ||
      (priorities.get(b.id)?.score ?? 0) - (priorities.get(a.id)?.score ?? 0) ||
      Number(b.review === 'approved') - Number(a.review === 'approved') ||
      new Set(b.facts.map((f) => f.dimension)).size -
        new Set(a.facts.map((f) => f.dimension)).size ||
      a.domain.localeCompare(b.domain),
  );
}

/** Actual citation coverage is computed by the application, not guessed by the model. */
export function withResearchCoverage(
  result: WorkflowResult,
  input: WorkflowInput,
  suppliedReferences?: readonly string[],
): WorkflowResult {
  if (result.kind !== 'buyer' || result.outcome !== 'draft' || !input.research) return result;
  const available = new Set(
    input.sources.filter((s) => s.kind === 'competitor' && s.research).map(sourceReference),
  );
  const compared = new Set(
    result.benchmark.flatMap((f) => f.references).filter((r) => available.has(r)),
  );
  const cited = new Set(
    [...result.findings, ...result.benchmark, ...(result.uniqueness ? [result.uniqueness] : [])]
      .flatMap((f) => f.references)
      .filter((r) => available.has(r)),
  );
  const supplied =
    suppliedReferences === undefined
      ? null
      : new Set(suppliedReferences.filter((r) => available.has(r))).size;
  const pending = [...cited].filter((r) => input.research?.pendingReferences.includes(r)).length;
  const coverage = `Périmètre de la comparaison : fiches disponibles : ${available.size} ; ${supplied === null ? '' : `fiches fournies à l’analyse : ${supplied} ; `}fiches citées dans le diagnostic : ${cited.size} ; fiches utilisées dans les comparaisons : ${compared.size}. Une fiche peut décrire plusieurs offres ; une citation d’exclusion n’entre pas dans ce dernier compte. Parmi toutes les fiches citées, à vérifier : ${pending} ; relues et approuvées : ${cited.size - pending}. Ces nombres ne mesurent ni l’examen détaillé des fiches ni la couverture de tout le marché. ${input.research.status === 'completed' ? 'Recherche terminée dans le périmètre prévu.' : 'Recherche partielle : les informations déjà recueillies sont conservées.'} Une fiche approuvée ne constitue pas une vérification indépendante des promesses du prestataire.`;
  const limits = result.limits.filter(
    (l) =>
      !l.startsWith('Périmètre de la comparaison :') &&
      !l.startsWith('Couverture de cette synthèse :'),
  );
  return { ...result, limits: [coverage, ...limits.slice(0, 9)] };
}
